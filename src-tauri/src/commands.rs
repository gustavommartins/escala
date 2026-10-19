//! Comandos chamados pelo front-end. Usam o FFmpeg/ffprobe embutidos (sidecars).

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

use crate::video::{self, EncodeOpts, ProgressTracker, ProgressUpdate, Resolution, VideoInfo};

/// Limite rígido de conversões simultâneas (a UI escolhe quantas rodam de fato).
const MAX_JOBS: usize = 4;

#[derive(Default)]
struct Job {
    child: Option<CommandChild>,
    cancel_requested: bool,
}

#[derive(Default)]
pub struct Conversions {
    jobs: Mutex<HashMap<String, Job>>,
    /// Saídas escolhidas por jobs que ainda não gravaram em disco: evita dois jobs com o mesmo nome.
    reserved: Mutex<HashSet<PathBuf>>,
    /// Cancelamentos que chegaram antes de `convert_video` registrar o job.
    early_cancels: Mutex<HashSet<String>>,
}

impl Conversions {
    fn is_cancelled(&self, id: &str) -> bool {
        self.jobs.lock().unwrap().get(id).is_none_or(|j| j.cancel_requested)
    }

    fn kill_child(&self, id: &str) {
        if let Some(job) = self.jobs.lock().unwrap().get_mut(id)
            && let Some(child) = job.child.take()
        {
            let _ = child.kill();
        }
    }

    fn cancel(&self, id: &str) {
        let mut jobs = self.jobs.lock().unwrap();
        if let Some(job) = jobs.get_mut(id) {
            job.cancel_requested = true;
            if let Some(child) = job.child.take() {
                let _ = child.kill();
            }
        } else {
            self.early_cancels.lock().unwrap().insert(id.to_string());
        }
    }
}

#[derive(Serialize)]
pub struct ProbeResult {
    pub name: String,
    pub info: VideoInfo,
    pub resolutions: Vec<Resolution>,
}

#[derive(Serialize)]
pub struct ConvertResult {
    pub output: String,
    pub output_size: u64,
}

#[derive(Clone, Serialize)]
struct JobProgress {
    job_id: String,
    #[serde(flatten)]
    update: ProgressUpdate,
}

const ERR_SIDECAR: &str = "err_sidecar";

#[tauri::command]
pub async fn probe_video(app: AppHandle, path: String) -> Result<ProbeResult, String> {
    let output = app
        .shell()
        .sidecar("ffprobe")
        .map_err(|_| ERR_SIDECAR.to_string())?
        .args(["-v", "error", "-print_format", "json", "-show_streams", "-show_format", &path])
        .output()
        .await
        .map_err(|_| ERR_SIDECAR.to_string())?;

    if !output.status.success() {
        return Err("err_not_video".into());
    }

    let info = video::parse_ffprobe_json(&String::from_utf8_lossy(&output.stdout))?;
    let resolutions = video::available_resolutions(&info);
    let name = PathBuf::from(&path)
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();

    Ok(ProbeResult { name, info, resolutions })
}

#[tauri::command]
pub async fn convert_video(
    app: AppHandle,
    state: State<'_, Conversions>,
    job_id: String,
    path: String,
    height: u32,
    hwaccel: bool,
) -> Result<ConvertResult, String> {
    {
        let mut jobs = state.jobs.lock().unwrap();
        if jobs.contains_key(&job_id) || jobs.len() >= MAX_JOBS {
            return Err("err_busy".into());
        }
        let cancelled_early = state.early_cancels.lock().unwrap().remove(&job_id);
        jobs.insert(job_id.clone(), Job { cancel_requested: cancelled_early, ..Job::default() });
    }
    let result = run_conversion(&app, &state, &job_id, path, height, hwaccel).await;
    state.jobs.lock().unwrap().remove(&job_id);
    result
}

async fn run_conversion(
    app: &AppHandle,
    state: &State<'_, Conversions>,
    job_id: &str,
    path: String,
    height: u32,
    hwaccel: bool,
) -> Result<ConvertResult, String> {
    let input = PathBuf::from(&path);
    let probe = probe_video(app.clone(), path).await?;
    if state.is_cancelled(job_id) {
        return Err("cancelled".into());
    }
    if !probe.resolutions.iter().any(|r| r.height == height) {
        return Err("err_res_unavailable".into());
    }

    let output = {
        let mut reserved = state.reserved.lock().unwrap();
        let out = video::output_path_with(&input, height, |p| p.exists() || reserved.contains(p));
        reserved.insert(out.clone());
        out
    };
    let result = encode(app, state, job_id, &input, &output, height, &probe.info, hwaccel).await;
    state.reserved.lock().unwrap().remove(&output);
    result
}

#[allow(clippy::too_many_arguments)]
async fn encode(
    app: &AppHandle,
    state: &State<'_, Conversions>,
    job_id: &str,
    input: &Path,
    output: &Path,
    height: u32,
    info: &VideoInfo,
    hwaccel: bool,
) -> Result<ConvertResult, String> {
    let mut use_hw = hwaccel;
    loop {
        let ok = run_ffmpeg(app, state, job_id, input, output, height, info, use_hw).await?;
        let cancelled = state.is_cancelled(job_id);
        if ok && !cancelled {
            let output_size = std::fs::metadata(output).map(|m| m.len()).unwrap_or(0);
            return Ok(ConvertResult { output: output.to_string_lossy().into_owned(), output_size });
        }
        let _ = std::fs::remove_file(output);
        if cancelled {
            return Err("cancelled".into());
        }
        if use_hw {
            // Driver/GPU sem suporte ao decoder: tenta de novo só com software.
            use_hw = false;
            continue;
        }
        return Err("err_failed".into());
    }
}

/// Roda o ffmpeg uma vez; `Ok(true)` se terminou com código 0.
#[allow(clippy::too_many_arguments)]
async fn run_ffmpeg(
    app: &AppHandle,
    state: &State<'_, Conversions>,
    job_id: &str,
    input: &Path,
    output: &Path,
    height: u32,
    info: &VideoInfo,
    hwaccel: bool,
) -> Result<bool, String> {
    let args = video::build_ffmpeg_args(input, output, height, info, EncodeOpts { hwaccel });
    let (mut rx, child) = app
        .shell()
        .sidecar("ffmpeg")
        .map_err(|_| ERR_SIDECAR.to_string())?
        .args(args)
        .spawn()
        .map_err(|_| ERR_SIDECAR.to_string())?;

    {
        // Guarda o processo; cobre o cancelamento pedido entre o probe e o spawn.
        let mut jobs = state.jobs.lock().unwrap();
        match jobs.get_mut(job_id) {
            Some(job) if !job.cancel_requested => job.child = Some(child),
            _ => {
                let _ = child.kill();
                return Ok(false);
            }
        }
    }

    let mut tracker = ProgressTracker::new(info.duration_s);
    let mut exit_ok = false;
    let mut stderr_tail = String::new();

    while let Some(event) = rx.recv().await {
        match event {
            CommandEvent::Stdout(line) => {
                if let Some(update) = tracker.feed(&String::from_utf8_lossy(&line)) {
                    let _ = app.emit("convert://progress", JobProgress { job_id: job_id.to_string(), update });
                }
            }
            CommandEvent::Stderr(line) => {
                stderr_tail = String::from_utf8_lossy(&line).trim().to_string();
            }
            CommandEvent::Terminated(payload) => {
                exit_ok = payload.code == Some(0);
                break;
            }
            CommandEvent::Error(e) => {
                eprintln!("erro no ffmpeg: {e}");
                state.kill_child(job_id);
                break;
            }
            _ => {}
        }
    }

    if let Some(job) = state.jobs.lock().unwrap().get_mut(job_id) {
        job.child = None;
    }
    if !exit_ok {
        eprintln!("ffmpeg falhou (hwaccel={hwaccel}): {stderr_tail}");
    }
    Ok(exit_ok)
}

#[tauri::command]
pub fn cancel_conversion(state: State<'_, Conversions>, job_id: String) {
    state.cancel(&job_id);
}

#[tauri::command]
pub fn cancel_all(state: State<'_, Conversions>) {
    let ids: Vec<String> = state.jobs.lock().unwrap().keys().cloned().collect();
    for id in ids {
        state.cancel(&id);
    }
}

/// Sugestão de conversões simultâneas: o x264 já usa todos os núcleos, então só
/// compensa paralelizar em máquinas com bastante CPU (ajustar após `npm run bench`).
#[tauri::command]
pub fn recommended_parallelism() -> u32 {
    let cores = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4);
    if cores >= 8 { 2 } else { 1 }
}

/// Garante que o app registre o estado compartilhado.
pub fn manage(app: &AppHandle) {
    app.manage(Conversions::default());
}
