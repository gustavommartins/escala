// Ponte entre a interface e os comandos em Rust (src-tauri/src/commands.rs).
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export interface VideoInfo {
  width: number;
  height: number;
  duration_s: number;
  size_bytes: number;
  audio_codec: string | null;
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

export const probeVideo = (path: string) => invoke<ProbeResult>("probe_video", { path });
export const convertVideo = (path: string, height: number) =>
  invoke<ConvertResult>("convert_video", { path, height });
export const cancelConversion = () => invoke<void>("cancel_conversion");

export const onProgress = (cb: (percent: number) => void) =>
  listen<{ percent: number }>("convert://progress", (e) => cb(e.payload.percent));
