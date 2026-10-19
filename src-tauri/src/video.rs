//! Lógica pura do conversor: sem I/O, fácil de testar.
//!
//! Os "padrões de qualidade" do app estão todos aqui (CRF, preset, áudio).

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// Qualidade do H.264: 18 é considerado "visualmente sem perdas". Menor = melhor e maior arquivo.
pub const CRF: &str = "18";
/// Mais lento = arquivo menor na mesma qualidade.
pub const PRESET: &str = "medium";
/// Áudio é recodificado para AAC nesta taxa quando não dá para copiar.
pub const AUDIO_BITRATE: &str = "192k";

/// Resoluções oferecidas (altura em pixels, nome amigável).
const RESOLUTIONS: &[(u32, &str)] = &[
    (2160, "4K"),
    (1440, "2K"),
    (1080, "Full HD"),
    (720, "HD"),
    (480, "SD"),
];

/// Resolução recomendada quando disponível.
const RECOMMENDED: u32 = 1080;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct VideoInfo {
    pub width: u32,
    pub height: u32,
    pub duration_s: f64,
    pub size_bytes: u64,
    pub audio_codec: Option<String>,
    /// Índice do stream de vídeo principal (ignora capas embutidas).
    pub video_index: u32,
    /// Vídeo HDR (PQ/HLG): precisa de tone-mapping para sair correto em 8 bits.
    pub hdr: bool,
    /// Codec do stream de vídeo principal (ex.: "hevc"); decide se vale usar decodificação por hardware.
    pub video_codec: Option<String>,
}

/// Opções de execução que não alteram a qualidade da saída.
#[derive(Debug, Clone, Copy, Default)]
pub struct EncodeOpts {
    /// Decodificação por hardware (D3D11VA). Só acelera a leitura; o encode continua x264.
    pub hwaccel: bool,
}

/// Codecs que o D3D11VA decodifica de forma confiável.
fn hwaccel_supported(codec: Option<&str>) -> bool {
    matches!(codec, Some("h264") | Some("hevc") | Some("av1") | Some("vp9"))
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Resolution {
    /// Altura alvo (lado menor do vídeo).
    pub height: u32,
    pub label: String,
    pub recommended: bool,
}

impl VideoInfo {
    /// Lado menor: em vídeo vertical (ex.: 2160x3840) vale a largura.
    pub fn short_side(&self) -> u32 {
        self.width.min(self.height)
    }
}

/// Opções estritamente menores que o vídeo original.
pub fn available_resolutions(info: &VideoInfo) -> Vec<Resolution> {
    let short = info.short_side();
    RESOLUTIONS
        .iter()
        .filter(|(h, _)| *h < short)
        .map(|(h, name)| Resolution {
            height: *h,
            label: format!("{h}p — {name}"),
            recommended: *h == RECOMMENDED,
        })
        .collect()
}

/// Filtro de vídeo: escala para `target` (lado menor) e, se HDR, tone-mapping para SDR.
fn video_filter(info: &VideoInfo, target: u32) -> String {
    // Mantém proporção; -2 garante dimensão par (exigência do H.264).
    let scale = if info.width >= info.height {
        format!("scale=-2:{target}:flags=lanczos")
    } else {
        format!("scale={target}:-2:flags=lanczos")
    };
    // HDR → SDR (BT.709) para não sair com cores lavadas.
    if info.hdr {
        format!(
            "{scale},zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,             tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p"
        )
    } else {
        scale
    }
}

/// Argumentos do ffmpeg. `target` é o lado menor desejado.
pub fn build_ffmpeg_args(
    input: &Path,
    output: &Path,
    target: u32,
    info: &VideoInfo,
    opts: EncodeOpts,
) -> Vec<String> {
    let filter = video_filter(info, target);
    let video_map = format!("0:v:{}", info.video_index);

    // Só arquivos locais: um "vídeo" que na verdade é uma playlist não pode puxar rede nem outros arquivos.
    let mut args: Vec<String> =
        ["-hide_banner", "-nostdin", "-y", "-protocol_whitelist", "file,pipe"].map(String::from).to_vec();
    // Opções de entrada (como -hwaccel) precisam vir antes do -i.
    if opts.hwaccel && hwaccel_supported(info.video_codec.as_deref()) {
        args.extend(["-hwaccel", "d3d11va"].map(String::from));
    }
    args.push("-i".into());
    args.push(input.to_string_lossy().into_owned());

    args.extend(
        [
            "-map", &video_map, "-map", "0:a:0?",
            "-vf", &filter,
            "-c:v", "libx264", "-preset", PRESET, "-crf", CRF,
            "-pix_fmt", "yuv420p",
            "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709",
        ]
        .iter()
        .map(|s| s.to_string()),
    );

    if audio_is_copyable(info.audio_codec.as_deref()) {
        args.extend(["-c:a", "copy"].map(String::from));
    } else {
        args.extend(["-c:a", "aac", "-b:a", AUDIO_BITRATE].map(String::from));
    }

    args.extend(
        ["-movflags", "+faststart", "-progress", "pipe:1", "-nostats"].map(String::from),
    );
    args.push(output.to_string_lossy().into_owned());
    args
}

/// Argumentos do ffmpeg para uma miniatura: um quadro JPEG (180p) escrito em stdout.
/// Quadro em 10% da duração, no máximo 30 s.
pub fn build_thumbnail_args(input: &Path, info: &VideoInfo) -> Vec<String> {
    let t = if info.duration_s > 0.0 { (info.duration_s * 0.1).min(30.0) } else { 0.0 };
    let ss = format!("{t:.2}");
    let input_s = input.to_string_lossy().into_owned();
    let video_map = format!("0:v:{}", info.video_index);
    let filter = video_filter(info, 180);

    [
        "-hide_banner", "-nostdin", "-v", "error",
        "-protocol_whitelist", "file,pipe",
        "-ss", &ss,
        "-i", &input_s,
        "-map", &video_map,
        "-frames:v", "1",
        "-vf", &filter,
        "-f", "image2pipe", "-c:v", "mjpeg", "-q:v", "4",
        "pipe:1",
    ]
    .iter()
    .map(|s| s.to_string())
    .collect()
}

fn audio_is_copyable(codec: Option<&str>) -> bool {
    matches!(codec, Some("aac") | Some("mp3"))
}

/// `pasta/video.mov` + 1080 → `pasta/video_1080p.mp4` (ou `video_1080p (2).mp4` se `exists` disser que já existe).
pub(crate) fn output_path_with(input: &Path, target: u32, exists: impl Fn(&Path) -> bool) -> PathBuf {
    let dir = input.parent().unwrap_or_else(|| Path::new("."));
    let stem = input
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "video".into());

    let mut candidate = dir.join(format!("{stem}_{target}p.mp4"));
    let mut n = 2;
    while exists(&candidate) {
        candidate = dir.join(format!("{stem}_{target}p ({n}).mp4"));
        n += 1;
    }
    candidate
}

/// Estado de progresso enviado ao front-end.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct ProgressUpdate {
    /// 0.0–100.0
    pub percent: f64,
    /// Velocidade relativa ao tempo real (ex.: 1.85 = 1,85×).
    pub speed: Option<f64>,
    /// Segundos restantes estimados.
    pub eta_s: Option<f64>,
    /// O ffmpeg terminou de codificar e está fechando o arquivo (+faststart).
    pub finalizing: bool,
}

/// Acumula as linhas do `-progress` (`chave=valor`, um bloco por atualização).
pub struct ProgressTracker {
    duration_s: f64,
    out_time_s: Option<f64>,
    speed: Option<f64>,
}

impl ProgressTracker {
    pub fn new(duration_s: f64) -> Self {
        Self { duration_s, out_time_s: None, speed: None }
    }

    /// Alimenta uma linha; devolve uma atualização quando o bloco fecha (`progress=...`).
    pub fn feed(&mut self, line: &str) -> Option<ProgressUpdate> {
        let line = line.trim();
        if line == "progress=end" {
            return Some(ProgressUpdate { percent: 100.0, speed: None, eta_s: Some(0.0), finalizing: true });
        }
        if line == "progress=continue" {
            return self.snapshot();
        }
        // out_time_us e out_time_ms são ambos em microssegundos no ffmpeg.
        if let Some(v) = line.strip_prefix("out_time_us=").or_else(|| line.strip_prefix("out_time_ms=")) {
            self.out_time_s = v.parse::<f64>().ok().map(|us| us / 1_000_000.0); // "N/A" cai aqui
        } else if let Some(v) = line.strip_prefix("speed=") {
            self.speed = v.trim().trim_end_matches('x').trim().parse().ok().filter(|s: &f64| *s > 0.0);
        }
        None
    }

    fn snapshot(&self) -> Option<ProgressUpdate> {
        if self.duration_s <= 0.0 {
            return None;
        }
        let t = self.out_time_s?.max(0.0);
        let percent = (t / self.duration_s).clamp(0.0, 1.0) * 100.0;
        let eta_s = self.speed.map(|s| ((self.duration_s - t) / s).max(0.0));
        Some(ProgressUpdate { percent, speed: self.speed, eta_s, finalizing: false })
    }
}

#[derive(Deserialize)]
struct ProbeOutput {
    #[serde(default)]
    streams: Vec<ProbeStream>,
    format: Option<ProbeFormat>,
}

#[derive(Deserialize)]
struct ProbeStream {
    index: Option<u32>,
    color_transfer: Option<String>,
    #[serde(default)]
    disposition: std::collections::HashMap<String, i64>,
    codec_type: Option<String>,
    codec_name: Option<String>,
    width: Option<u32>,
    height: Option<u32>,
    duration: Option<String>,
    #[serde(default)]
    tags: std::collections::HashMap<String, String>,
    #[serde(default)]
    side_data_list: Vec<SideData>,
}

#[derive(Deserialize)]
struct SideData {
    rotation: Option<f64>,
}

#[derive(Deserialize)]
struct ProbeFormat {
    duration: Option<String>,
    size: Option<String>,
}

/// Lê o JSON do `ffprobe -print_format json -show_streams -show_format`.
pub fn parse_ffprobe_json(json: &str) -> Result<VideoInfo, String> {
    let out: ProbeOutput =
        serde_json::from_str(json).map_err(|_| "err_unreadable".to_string())?;

    let video = out
        .streams
        .iter()
        .find(|s| {
            s.codec_type.as_deref() == Some("video")
                && s.width.is_some()
                && s.disposition.get("attached_pic").copied().unwrap_or(0) == 0
        })
        .ok_or("err_no_video_stream")?;

    let (mut width, mut height) = (video.width.unwrap_or(0), video.height.unwrap_or(0));

    // Celulares gravam em pé como paisagem + rotação; a dimensão "real" é trocada.
    let rotation = video
        .side_data_list
        .iter()
        .find_map(|d| d.rotation)
        .or_else(|| video.tags.get("rotate").and_then(|r| r.parse().ok()))
        .unwrap_or(0.0);
    if (rotation.abs() as i64 / 90) % 2 == 1 {
        std::mem::swap(&mut width, &mut height);
    }

    let duration_s = out
        .format
        .as_ref()
        .and_then(|f| f.duration.as_deref())
        .or(video.duration.as_deref())
        .and_then(|d| d.parse().ok())
        .unwrap_or(0.0);

    let size_bytes = out
        .format
        .as_ref()
        .and_then(|f| f.size.as_deref())
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);

    let audio_codec = out
        .streams
        .iter()
        .find(|s| s.codec_type.as_deref() == Some("audio"))
        .and_then(|s| s.codec_name.clone());

    let hdr = matches!(video.color_transfer.as_deref(), Some("smpte2084") | Some("arib-std-b67"));
    let video_index = video.index.unwrap_or(0);
    // O índice global vira índice entre os vídeos.
    let video_index = out.streams.iter()
        .filter(|s| s.codec_type.as_deref() == Some("video") && s.index.unwrap_or(0) < video_index)
        .count() as u32;

    let video_codec = video.codec_name.clone();

    Ok(VideoInfo { width, height, duration_s, size_bytes, audio_codec, video_index, hdr, video_codec })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn info(w: u32, h: u32, audio: Option<&str>) -> VideoInfo {
        VideoInfo {
            width: w,
            height: h,
            duration_s: 10.0,
            size_bytes: 1000,
            audio_codec: audio.map(String::from),
            video_index: 0,
            hdr: false,
            video_codec: Some("hevc".into()),
        }
    }

    fn heights(info: &VideoInfo) -> Vec<u32> {
        available_resolutions(info).iter().map(|r| r.height).collect()
    }

    #[test]
    fn resolutions_for_4k() {
        assert_eq!(heights(&info(3840, 2160, None)), vec![1440, 1080, 720, 480]);
    }

    #[test]
    fn resolutions_for_1080p() {
        assert_eq!(heights(&info(1920, 1080, None)), vec![720, 480]);
    }

    #[test]
    fn resolutions_for_vertical_use_short_side() {
        assert_eq!(heights(&info(2160, 3840, None)), vec![1440, 1080, 720, 480]);
    }

    #[test]
    fn only_1080_is_recommended() {
        let rec: Vec<u32> = available_resolutions(&info(3840, 2160, None))
            .iter()
            .filter(|r| r.recommended)
            .map(|r| r.height)
            .collect();
        assert_eq!(rec, vec![1080]);
    }

    #[test]
    fn args_have_quality_settings_and_copy_audio() {
        let a = build_ffmpeg_args(Path::new("in.mov"), Path::new("out.mp4"), 1080, &info(3840, 2160, Some("aac")), EncodeOpts::default());
        let joined = a.join(" ");
        assert!(joined.contains("-crf 18"));
        assert!(joined.contains("scale=-2:1080:flags=lanczos"));
        assert!(joined.contains("-movflags +faststart"));
        assert!(joined.contains("-c:a copy"));
        assert_eq!(a.last().unwrap(), "out.mp4");
    }

    #[test]
    fn args_reencode_unsupported_audio() {
        let a = build_ffmpeg_args(Path::new("in.mkv"), Path::new("out.mp4"), 720, &info(1920, 1080, Some("opus")), EncodeOpts::default());
        assert!(a.join(" ").contains("-c:a aac -b:a 192k"));
    }

    #[test]
    fn args_scale_vertical_by_width() {
        let a = build_ffmpeg_args(Path::new("in.mp4"), Path::new("out.mp4"), 1080, &info(2160, 3840, None), EncodeOpts::default());
        assert!(a.join(" ").contains("scale=1080:-2:flags=lanczos"));
    }

    #[test]
    fn output_path_avoids_collision() {
        let existing = [PathBuf::from("/v/a_1080p.mp4"), PathBuf::from("/v/a_1080p (2).mp4")];
        let p = output_path_with(Path::new("/v/a.mov"), 1080, |c| existing.iter().any(|e| e == c));
        assert_eq!(p, PathBuf::from("/v/a_1080p (3).mp4"));
    }

    #[test]
    fn output_path_simple() {
        let p = output_path_with(Path::new("/v/a.mov"), 720, |_| false);
        assert_eq!(p, PathBuf::from("/v/a_720p.mp4"));
    }

    #[test]
    fn progress_tracker_reports_percent_speed_eta() {
        let mut t = ProgressTracker::new(10.0);
        assert_eq!(t.feed("out_time_us=5000000"), None);
        assert_eq!(t.feed("speed=2.0x"), None);
        let u = t.feed("progress=continue").unwrap();
        assert_eq!(u.percent, 50.0);
        assert_eq!(u.speed, Some(2.0));
        assert_eq!(u.eta_s, Some(2.5));
        assert!(!u.finalizing);
    }

    #[test]
    fn progress_tracker_handles_na_and_end() {
        let mut t = ProgressTracker::new(10.0);
        t.feed("out_time_us=N/A");
        t.feed("speed=N/A");
        assert_eq!(t.feed("progress=continue"), None);
        let end = t.feed("progress=end").unwrap();
        assert!(end.finalizing);
        assert_eq!(end.percent, 100.0);
        assert_eq!(ProgressTracker::new(0.0).feed("progress=continue"), None);
    }

    #[test]
    fn progress_tracker_clamps_past_duration() {
        let mut t = ProgressTracker::new(10.0);
        t.feed("out_time_us=99000000");
        assert_eq!(t.feed("progress=continue").unwrap().percent, 100.0);
    }

    #[test]
    fn hwaccel_goes_before_input_and_only_for_supported_codecs() {
        let on = EncodeOpts { hwaccel: true };
        let a = build_ffmpeg_args(Path::new("in.mp4"), Path::new("o.mp4"), 720, &info(1920, 1080, None), on);
        let hw = a.iter().position(|x| x == "-hwaccel").unwrap();
        assert!(hw < a.iter().position(|x| x == "-i").unwrap());
        let mut other = info(1920, 1080, None);
        other.video_codec = Some("mpeg4".into());
        let b = build_ffmpeg_args(Path::new("in.mp4"), Path::new("o.mp4"), 720, &other, on);
        assert!(!b.contains(&"-hwaccel".to_string()));
        let c = build_ffmpeg_args(Path::new("in.mp4"), Path::new("o.mp4"), 720, &info(1920, 1080, None), EncodeOpts::default());
        assert!(!c.contains(&"-hwaccel".to_string()));
    }

    #[test]
    fn output_path_respects_reserved() {
        let p = output_path_with(Path::new("/v/a.mov"), 720, |c| c == Path::new("/v/a_720p.mp4"));
        assert_eq!(p, PathBuf::from("/v/a_720p (2).mp4"));
    }

    #[test]
    fn ffprobe_parsing() {
        let json = r#"{
          "streams": [
            {"codec_type":"video","codec_name":"hevc","width":3840,"height":2160},
            {"codec_type":"audio","codec_name":"aac"}
          ],
          "format": {"duration":"12.5","size":"123456"}
        }"#;
        let i = parse_ffprobe_json(json).unwrap();
        assert_eq!(i, VideoInfo {
            width: 3840, height: 2160, duration_s: 12.5, size_bytes: 123456,
            audio_codec: Some("aac".into()),
            video_index: 0,
            hdr: false,
            video_codec: Some("hevc".into()),
        });
    }

    #[test]
    fn ffprobe_rotation_swaps_dimensions() {
        let json = r#"{
          "streams": [
            {"codec_type":"video","width":3840,"height":2160,"side_data_list":[{"rotation":-90}]}
          ],
          "format": {"duration":"1","size":"1"}
        }"#;
        let i = parse_ffprobe_json(json).unwrap();
        assert_eq!((i.width, i.height), (2160, 3840));
    }

    #[test]
    fn ffprobe_detects_hdr_and_skips_cover_art() {
        let json = r#"{
          "streams": [
            {"index":0,"codec_type":"video","width":600,"height":600,"disposition":{"attached_pic":1}},
            {"index":1,"codec_type":"video","width":3840,"height":2160,"color_transfer":"smpte2084"}
          ],
          "format": {"duration":"1","size":"1"}
        }"#;
        let i = parse_ffprobe_json(json).unwrap();
        assert!(i.hdr);
        assert_eq!((i.width, i.video_index), (3840, 1));
        let mut hdr = i.clone();
        hdr.video_index = 1;
        let a = build_ffmpeg_args(Path::new("a.mkv"), Path::new("o.mp4"), 1080, &hdr, EncodeOpts::default()).join(" ");
        assert!(a.contains("-map 0:v:1") && a.contains("tonemap=hable"));
    }

    #[test]
    fn thumbnail_seeks_before_input() {
        let a = build_thumbnail_args(Path::new("in.mp4"), &info(1920, 1080, None));
        let ss = a.iter().position(|x| x == "-ss").unwrap();
        assert!(ss < a.iter().position(|x| x == "-i").unwrap());
        assert_eq!(a[ss + 1], "1.00");
    }

    #[test]
    fn thumbnail_zero_duration_seeks_zero() {
        let mut i = info(1920, 1080, None);
        i.duration_s = 0.0;
        let a = build_thumbnail_args(Path::new("in.mp4"), &i);
        let ss = a.iter().position(|x| x == "-ss").unwrap();
        assert_eq!(a[ss + 1], "0.00");
    }

    #[test]
    fn thumbnail_seek_capped_at_30s() {
        let mut i = info(1920, 1080, None);
        i.duration_s = 1000.0;
        let a = build_thumbnail_args(Path::new("in.mp4"), &i);
        let ss = a.iter().position(|x| x == "-ss").unwrap();
        assert_eq!(a[ss + 1], "30.00");
    }

    #[test]
    fn thumbnail_hdr_uses_tonemap() {
        let mut i = info(3840, 2160, None);
        i.hdr = true;
        let a = build_thumbnail_args(Path::new("in.mkv"), &i).join(" ");
        assert!(a.contains("tonemap"));
    }

    #[test]
    fn thumbnail_outputs_jpeg_to_pipe() {
        let a = build_thumbnail_args(Path::new("in.mp4"), &info(1920, 1080, None));
        assert_eq!(a.last().unwrap(), "pipe:1");
        assert!(a.join(" ").contains("-c:v mjpeg"));
    }

    #[test]
    fn ffprobe_without_video_fails() {
        let json = r#"{"streams":[{"codec_type":"audio"}],"format":{}}"#;
        assert!(parse_ffprobe_json(json).is_err());
    }
}
