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

/// Argumentos do ffmpeg. `target` é o lado menor desejado.
pub fn build_ffmpeg_args(input: &Path, output: &Path, target: u32, info: &VideoInfo) -> Vec<String> {
    // Mantém proporção; -2 garante dimensão par (exigência do H.264).
    let scale = if info.width >= info.height {
        format!("scale=-2:{target}:flags=lanczos")
    } else {
        format!("scale={target}:-2:flags=lanczos")
    };
    // HDR → SDR (BT.709) para não sair com cores lavadas.
    let filter = if info.hdr {
        format!(
            "{scale},zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,             tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p"
        )
    } else {
        scale
    };
    let video_map = format!("0:v:{}", info.video_index);

    let mut args: Vec<String> = [
        "-hide_banner", "-nostdin", "-y", "-i",
    ]
    .iter()
    .map(|s| s.to_string())
    .collect();
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

fn audio_is_copyable(codec: Option<&str>) -> bool {
    matches!(codec, Some("aac") | Some("mp3"))
}

/// `pasta/video.mov` + 1080 → `pasta/video_1080p.mp4` (ou `video_1080p (2).mp4` se já existir).
pub fn output_path(input: &Path, target: u32) -> PathBuf {
    output_path_with(input, target, |p| p.exists())
}

fn output_path_with(input: &Path, target: u32, exists: impl Fn(&Path) -> bool) -> PathBuf {
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

/// Interpreta uma linha do `-progress`: devolve 0.0–1.0 ou `None`.
pub fn parse_progress(line: &str, duration_s: f64) -> Option<f64> {
    let line = line.trim();
    if line == "progress=end" {
        return Some(1.0);
    }
    // out_time_us e out_time_ms são ambos em microssegundos no ffmpeg.
    let value = line
        .strip_prefix("out_time_us=")
        .or_else(|| line.strip_prefix("out_time_ms="))?;
    let micros: f64 = value.parse().ok()?; // "N/A" cai aqui
    if duration_s <= 0.0 {
        return None;
    }
    Some((micros / 1_000_000.0 / duration_s).clamp(0.0, 1.0))
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

    Ok(VideoInfo { width, height, duration_s, size_bytes, audio_codec, video_index, hdr })
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
        let a = build_ffmpeg_args(Path::new("in.mov"), Path::new("out.mp4"), 1080, &info(3840, 2160, Some("aac")));
        let joined = a.join(" ");
        assert!(joined.contains("-crf 18"));
        assert!(joined.contains("scale=-2:1080:flags=lanczos"));
        assert!(joined.contains("-movflags +faststart"));
        assert!(joined.contains("-c:a copy"));
        assert_eq!(a.last().unwrap(), "out.mp4");
    }

    #[test]
    fn args_reencode_unsupported_audio() {
        let a = build_ffmpeg_args(Path::new("in.mkv"), Path::new("out.mp4"), 720, &info(1920, 1080, Some("opus")));
        assert!(a.join(" ").contains("-c:a aac -b:a 192k"));
    }

    #[test]
    fn args_scale_vertical_by_width() {
        let a = build_ffmpeg_args(Path::new("in.mp4"), Path::new("out.mp4"), 1080, &info(2160, 3840, None));
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
    fn progress_parsing() {
        assert_eq!(parse_progress("out_time_us=5000000", 10.0), Some(0.5));
        assert_eq!(parse_progress("out_time_us=N/A", 10.0), None);
        assert_eq!(parse_progress("out_time_us=99000000", 10.0), Some(1.0));
        assert_eq!(parse_progress("progress=end", 10.0), Some(1.0));
        assert_eq!(parse_progress("frame=10", 10.0), None);
        assert_eq!(parse_progress("out_time_us=1000", 0.0), None);
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
        let a = build_ffmpeg_args(Path::new("a.mkv"), Path::new("o.mp4"), 1080, &hdr).join(" ");
        assert!(a.contains("-map 0:v:1") && a.contains("tonemap=hable"));
    }

    #[test]
    fn ffprobe_without_video_fails() {
        let json = r#"{"streams":[{"codec_type":"audio"}],"format":{}}"#;
        assert!(parse_ffprobe_json(json).is_err());
    }
}
