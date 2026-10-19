//! Comandos chamados pelo front-end. Usam o FFmpeg/ffprobe embutidos (sidecars).

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

use crate::video::{self, Resolution, VideoInfo};

#[derive(Default)]
pub struct Conversion {
    child: Mutex<Option<CommandChild>>,
    busy: AtomicBool,
    cancel_requested: AtomicBool,
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
struct Progress {
    percent: f64,
}

const ERR_SIDECAR: &str = "Não consegui iniciar o conversor embutido. Reinstale o app.";

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
        return Err("Este arquivo não parece ser um vídeo válido.".into());
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
    state: State<'_, Conversion>,
    path: String,
    height: u32,
) -> Result<ConvertResult, String> {
    // Reserva atômica: só uma conversão por vez, inclusive durante o probe.
    if state.busy.swap(true, Ordering::SeqCst) {
        return Err("Já existe uma conversão em andamento.".into());
    }
    state.cancel_requested.store(false, Ordering::SeqCst);
    let result = run_conversion(&app, &state, path, height).await;
    state.busy.store(false, Ordering::SeqCst);
    result
}

async fn run_conversion(
    app: &AppHandle,
    state: &State<'_, Conversion>,
    path: String,
    height: u32,
) -> Result<ConvertResult, String> {
    let input = PathBuf::from(&path);
    let probe = probe_video(app.clone(), path).await?;
    if state.cancel_requested.load(Ordering::SeqCst) {
        return Err("cancelado".into());
    }
    if !probe.resolutions.iter().any(|r| r.height == height) {
        return Err("Essa resolução não está disponível para este vídeo.".into());
    }

    let output = video::output_path(&input, height);
    let args = video::build_ffmpeg_args(&input, &output, height, &probe.info);

    let (mut rx, child) = app
        .shell()
        .sidecar("ffmpeg")
        .map_err(|_| ERR_SIDECAR.to_string())?
        .args(args)
        .spawn()
        .map_err(|_| ERR_SIDECAR.to_string())?;

    *state.child.lock().unwrap() = Some(child);
    // Cancelamento pedido entre o probe e o spawn.
    if state.cancel_requested.load(Ordering::SeqCst) {
        if let Some(c) = state.child.lock().unwrap().take() {
            let _ = c.kill();
        }
    }

    let duration = probe.info.duration_s;
    let mut exit_ok = false;
    let mut stderr_tail = String::new();

    while let Some(event) = rx.recv().await {
        match event {
            CommandEvent::Stdout(line) => {
                if let Some(p) = video::parse_progress(&String::from_utf8_lossy(&line), duration) {
                    let _ = app.emit("convert://progress", Progress { percent: p * 100.0 });
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
                if let Some(c) = state.child.lock().unwrap().take() {
                    let _ = c.kill();
                }
                break;
            }
            _ => {}
        }
    }

    state.child.lock().unwrap().take();
    let cancelled = state.cancel_requested.load(Ordering::SeqCst);

    if cancelled {
        let _ = std::fs::remove_file(&output);
        return Err("cancelado".into());
    }
    if !exit_ok {
        let _ = std::fs::remove_file(&output);
        eprintln!("ffmpeg falhou: {stderr_tail}");
        return Err("A conversão falhou. O arquivo pode estar corrompido ou protegido.".into());
    }

    let output_size = std::fs::metadata(&output).map(|m| m.len()).unwrap_or(0);
    Ok(ConvertResult { output: output.to_string_lossy().into_owned(), output_size })
}

#[tauri::command]
pub fn cancel_conversion(state: State<'_, Conversion>) {
    state.cancel_requested.store(true, Ordering::SeqCst);
    if let Some(child) = state.child.lock().unwrap().take() {
        let _ = child.kill();
    }
}

/// Garante que o app registre o estado compartilhado.
pub fn manage(app: &AppHandle) {
    app.manage(Conversion::default());
}
