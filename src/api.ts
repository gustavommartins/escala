// Ponte entre a interface e os comandos em Rust (src-tauri/src/commands.rs).
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export interface VideoInfo {
  width: number;
  height: number;
  duration_s: number;
  size_bytes: number;
  audio_codec: string | null;
  video_codec: string | null;
  hdr: boolean;
}

export interface Resolution {
  height: number;
  label: string;
  recommended: boolean;
}

export interface ProbeResult {
  name: string;
  info: VideoInfo;
  resolutions: Resolution[];
}

export interface ConvertResult {
  output: string;
  output_size: number;
}

export interface JobProgress {
  job_id: string;
  percent: number;
  speed: number | null;
  eta_s: number | null;
  finalizing: boolean;
}

export const probeVideo = (path: string) => invoke<ProbeResult>("probe_video", { path });
export const thumbnail = (path: string, info: VideoInfo) => invoke<string>("thumbnail", { path, info });
export const convertVideo = (jobId: string, path: string, height: number, hwaccel: boolean) =>
  invoke<ConvertResult>("convert_video", { jobId, path, height, hwaccel });
export const cancelConversion = (jobId: string) => invoke<void>("cancel_conversion", { jobId });
export const cancelAll = () => invoke<void>("cancel_all");
export const recommendedParallelism = () => invoke<number>("recommended_parallelism");

export const onProgress = (cb: (p: JobProgress) => void) =>
  listen<JobProgress>("convert://progress", (e) => cb(e.payload));
