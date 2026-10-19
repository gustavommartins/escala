// Modelo da fila de conversão: funções puras (sem DOM nem Tauri), fáceis de testar.
import type { ProbeResult, Resolution } from "./api";

export const VIDEO_EXTENSIONS = ["mp4", "mov", "mkv", "avi", "webm", "m4v"];

export type Status =
  | "probing"
  | "ready"
  | "skipped" // já é pequeno demais para reduzir
  | "queued"
  | "converting"
  | "finalizing"
  | "done"
  | "error"
  | "cancelled";

export interface QueueItem {
  id: string;
  path: string;
  name: string;
  status: Status;
  probe?: ProbeResult;
  /** Resolução escolhida só para este item; vence a global. */
  override?: number;
  /** Altura efetiva fixada ao entrar na fila de conversão. */
  target?: number;
  percent: number;
  speed?: number;
  etaS?: number;
  output?: string;
  outputSize?: number;
  /** Código de erro do Rust (ex.: "err_failed") ou chave de UI. */
  error?: string;
}

let counter = 0;

function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

export function isVideoPath(path: string): boolean {
  return VIDEO_EXTENSIONS.includes(path.split(".").pop()?.toLowerCase() ?? "");
}

/** Cria itens novos para os caminhos válidos que ainda não estão na fila. */
export function makeItems(existing: QueueItem[], paths: string[]): { added: QueueItem[]; rejected: number } {
  const seen = new Set(existing.map((i) => i.path));
  const added: QueueItem[] = [];
  let rejected = 0;
  for (const path of paths) {
    if (!isVideoPath(path)) {
      rejected++;
      continue;
    }
    if (seen.has(path)) continue;
    seen.add(path);
    added.push({ id: `job-${++counter}`, path, name: fileName(path), status: "probing", percent: 0 });
  }
  return { added, rejected };
}

/** Altura a converter para o item, ou `null` se não há como (vai aparecer como pulado). */
export function effectiveHeight(item: QueueItem, globalHeight: number | null): number | null {
  const height = item.override ?? globalHeight;
  if (height === null || !item.probe) return null;
  return item.probe.resolutions.some((r) => r.height === height) ? height : null;
}

/** União das resoluções oferecidas pelos vídeos já analisados (maior primeiro). */
export function globalOptions(items: QueueItem[]): Resolution[] {
  const byHeight = new Map<number, Resolution>();
  for (const item of items) {
    for (const r of item.probe?.resolutions ?? []) byHeight.set(r.height, r);
  }
  return [...byHeight.values()].sort((a, b) => b.height - a.height);
}

/** Resolução global inicial: a recomendada, ou a maior disponível. */
export function defaultHeight(options: Resolution[]): number | null {
  return (options.find((r) => r.recommended) ?? options[0])?.height ?? null;
}

/** Itens que podem entrar na fila ao clicar em "Converter tudo". */
export function startable(item: QueueItem, globalHeight: number | null): boolean {
  return ["ready", "cancelled", "error"].includes(item.status) && effectiveHeight(item, globalHeight) !== null;
}

/** Próximos itens `queued` a iniciar respeitando o limite de simultâneos. */
export function nextToStart(items: QueueItem[], limit: number): QueueItem[] {
  const running = items.filter((i) => i.status === "converting" || i.status === "finalizing").length;
  return items.filter((i) => i.status === "queued").slice(0, Math.max(0, limit - running));
}

export function isActive(item: QueueItem): boolean {
  return ["queued", "converting", "finalizing"].includes(item.status);
}

export function hasActive(items: QueueItem[]): boolean {
  return items.some(isActive);
}

/** Progresso do lote (0–100) ponderado pela duração dos vídeos que participam da conversão. */
export function overallPercent(items: QueueItem[]): number {
  let total = 0;
  let done = 0;
  for (const item of items) {
    if (!isActive(item) && item.status !== "done") continue;
    const weight = item.probe?.info.duration_s || 1;
    total += weight;
    done += weight * (item.status === "done" ? 100 : item.percent);
  }
  return total > 0 ? done / total : 0;
}

export function summary(items: QueueItem[]): { count: number; savedBytes: number } {
  let count = 0;
  let savedBytes = 0;
  for (const item of items) {
    if (item.status !== "done") continue;
    count++;
    savedBytes += (item.probe?.info.size_bytes ?? 0) - (item.outputSize ?? 0);
  }
  return { count, savedBytes };
}
