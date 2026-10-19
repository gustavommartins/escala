import { open } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import {
  cancelAll,
  cancelConversion,
  convertVideo,
  onProgress,
  probeVideo,
  recommendedParallelism,
  type JobProgress,
} from "./api";
import {
  LANGUAGES,
  applyTranslations,
  errorMessage,
  getLang,
  loadLang,
  setLang,
  t,
  type Lang,
} from "./i18n";
import {
  VIDEO_EXTENSIONS,
  defaultHeight,
  effectiveHeight,
  globalOptions,
  hasActive,
  isActive,
  makeItems,
  nextToStart,
  overallPercent,
  startable,
  summary,
  type QueueItem,
} from "./queue";
import { initFooter, notifyIdle, renderFooter } from "./updater";

const PROBE_CONCURRENCY = 4;
const MAX_PARALLEL = 4;
const PARALLEL_KEY = "escala.parallel";
const HWACCEL_KEY = "escala.hwaccel";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

let items: QueueItem[] = [];
let globalHeight: number | null = null;
let parallel = 1;
// Decodificação por hardware fica desligada até o benchmark (npm run bench) provar ganho com amostras reais.
let hwaccel = false;

const probeQueue: QueueItem[] = [];
let probing = 0;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text = ""): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function readSetting(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeSetting(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // vale só nesta sessão
  }
}

function formatSize(bytes: number): string {
  const mb = Math.abs(bytes) / 1024 / 1024;
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb.toFixed(0)} MB`;
}

function formatDuration(seconds: number): string {
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

function showError(message: string) {
  for (const id of ["drop-error", "queue-error"]) {
    const node = $(id);
    node.textContent = message;
    node.hidden = !message;
  }
}

function itemById(id: string): QueueItem | undefined {
  return items.find((i) => i.id === id);
}

// ---------- Análise (probe) com feedback imediato ----------

function enqueueProbes(added: QueueItem[]) {
  probeQueue.push(...added);
  pumpProbes();
}

function pumpProbes() {
  while (probing < PROBE_CONCURRENCY && probeQueue.length > 0) {
    const item = probeQueue.shift()!;
    if (!itemById(item.id)) continue; // removido antes de começar
    probing++;
    void runProbe(item).finally(() => {
      probing--;
      pumpProbes();
    });
  }
}

async function runProbe(item: QueueItem) {
  try {
    item.probe = await probeVideo(item.path);
    if (item.probe.resolutions.length === 0) item.status = "skipped";
    else item.status = "ready";
  } catch (e) {
    item.status = "error";
    item.error = String(e);
  }
  if (!itemById(item.id)) return;
  syncGlobalHeight();
  renderAll();
}

function addPaths(paths: string[]) {
  const { added, rejected } = makeItems(items, paths);
  showError(rejected > 0 && added.length === 0 ? t("error.badExtension") : "");
  if (added.length === 0) return;
  items.push(...added);
  renderAll();
  enqueueProbes(added);
}

// ---------- Conversão ----------

function convertAll() {
  for (const item of items) {
    if (!startable(item, globalHeight)) continue;
    item.target = effectiveHeight(item, globalHeight)!;
    item.status = "queued";
    item.percent = 0;
    item.speed = item.etaS = undefined;
    item.error = undefined;
  }
  renderAll();
  pump();
}

function pump() {
  for (const item of nextToStart(items, parallel)) {
    item.status = "converting";
    renderAll();
    void run(item);
  }
}

async function run(item: QueueItem) {
  try {
    const result = await convertVideo(item.id, item.path, item.target!, hwaccel);
    item.status = "done";
    item.percent = 100;
    item.output = result.output;
    item.outputSize = result.output_size;
  } catch (e) {
    if (String(e) === "cancelled") {
      item.status = "cancelled";
    } else {
      item.status = "error";
      item.error = String(e);
    }
  }
  renderAll();
  pump();
}

function cancelItem(item: QueueItem) {
  if (item.status === "queued") {
    item.status = "ready";
    renderAll();
  } else {
    void cancelConversion(item.id);
  }
}

function removeItem(item: QueueItem) {
  if (isActive(item)) return;
  items = items.filter((i) => i !== item);
  syncGlobalHeight();
  renderAll();
}

function onJobProgress(p: JobProgress) {
  const item = itemById(p.job_id);
  if (!item || (item.status !== "converting" && item.status !== "finalizing")) return;
  item.percent = p.percent;
  item.speed = p.speed ?? undefined;
  item.etaS = p.eta_s ?? undefined;
  if (p.finalizing) item.status = "finalizing";
  renderAll();
}

// ---------- Renderização ----------

function syncGlobalHeight() {
  const options = globalOptions(items);
  if (!options.some((r) => r.height === globalHeight)) globalHeight = defaultHeight(options);
}

function renderChips() {
  const box = $("global-options");
  box.replaceChildren();
  for (const r of globalOptions(items)) {
    const chip = el("button", "chip", r.label);
    chip.setAttribute("role", "radio");
    chip.setAttribute("aria-checked", String(r.height === globalHeight));
    chip.addEventListener("click", () => {
      globalHeight = r.height;
      renderAll();
    });
    box.append(chip);
  }
}

function statusLine(item: QueueItem): HTMLElement {
  const box = el("div", "item-status");
  const info = item.probe?.info;
  const shortSide = info ? Math.min(info.width, info.height) : 0;
  const bar = (indeterminate: boolean) => {
    const track = el("div", `progress${indeterminate ? " indeterminate" : ""}`);
    const fill = el("div", "progress-bar");
    if (!indeterminate) fill.style.width = `${Math.round(item.percent)}%`;
    track.append(fill);
    return track;
  };

  switch (item.status) {
    case "probing":
      box.append(el("span", "spinner"), el("span", "secondary", t("queue.analyzing")));
      break;
    case "skipped":
      box.append(el("span", "secondary", t("queue.skipped", { height: shortSide })));
      break;
    case "ready": {
      const h = effectiveHeight(item, globalHeight);
      box.append(el("span", "secondary", h ? `→ ${h}p` : t("queue.skipped", { height: shortSide })));
      break;
    }
    case "queued":
      box.append(el("span", "secondary", t("queue.waiting")));
      break;
    case "converting": {
      const started = item.percent > 0 || item.speed !== undefined;
      box.append(bar(!started));
      if (!started) {
        box.append(el("span", "secondary", t("queue.preparing")));
      } else {
        const parts = [`${Math.round(item.percent)}%`];
        if (item.speed) parts.push(t("queue.speed", { speed: item.speed.toFixed(1) }));
        if (item.etaS !== undefined) parts.push(t("queue.remaining", { time: formatDuration(item.etaS) }));
        box.append(el("span", "secondary", parts.join(" · ")));
      }
      break;
    }
    case "finalizing":
      box.append(bar(true), el("span", "secondary", t("queue.finalizing")));
      break;
    case "done":
      box.append(
        el("span", "secondary", t("queue.done", {
          size: formatSize(item.outputSize ?? 0),
          original: formatSize(info?.size_bytes ?? 0),
        })),
      );
      break;
    case "error":
      box.append(el("span", "error-text", errorMessage(item.error)));
      break;
    case "cancelled":
      box.append(el("span", "secondary", t("queue.cancelled")));
      break;
  }
  return box;
}

function overrideSelect(item: QueueItem): HTMLSelectElement | null {
  const resolutions = item.probe?.resolutions ?? [];
  if (resolutions.length === 0 || !["ready", "cancelled", "error"].includes(item.status)) return null;
  const select = el("select", "item-select");
  select.setAttribute("aria-label", t("queue.resolution"));
  select.add(new Option(t("queue.sameAsAll"), ""));
  for (const r of resolutions) select.add(new Option(r.label, String(r.height)));
  select.value = item.override ? String(item.override) : "";
  select.addEventListener("change", () => {
    item.override = select.value ? Number(select.value) : undefined;
    renderAll();
  });
  return select;
}

function renderRow(item: QueueItem): HTMLElement {
  const row = el("div", "card item");
  const top = el("div", "item-top");
  top.append(el("div", "file-name", item.name));

  const actions = el("div", "item-actions");
  if (item.status === "done" && item.output) {
    const reveal = el("button", "link-btn", t("done.reveal"));
    reveal.addEventListener("click", () => void revealItemInDir(item.output!));
    actions.append(reveal);
  }
  if (isActive(item)) {
    const cancel = el("button", "link-btn", t("common.cancel"));
    cancel.addEventListener("click", () => cancelItem(item));
    actions.append(cancel);
  } else {
    const remove = el("button", "icon-small", "✕");
    remove.setAttribute("aria-label", t("queue.remove"));
    remove.addEventListener("click", () => removeItem(item));
    actions.append(remove);
  }
  top.append(actions);
  row.append(top);

  const info = item.probe?.info;
  if (info) {
    row.append(
      el("div", "secondary item-meta", `${info.width}×${info.height} · ${formatDuration(info.duration_s)} · ${formatSize(info.size_bytes)}`),
    );
  }
  row.append(statusLine(item));
  const select = overrideSelect(item);
  if (select) row.append(select);
  return row;
}

function renderAll() {
  $("view-drop").hidden = items.length > 0;
  $("view-queue").hidden = items.length === 0;
  if (items.length === 0) return;

  if (!hasActive(items)) notifyIdle();
  renderChips();
  $("queue-list").replaceChildren(...items.map(renderRow));

  const active = hasActive(items);
  ($("btn-convert-all") as HTMLButtonElement).disabled = !items.some((i) => startable(i, globalHeight));
  $("btn-convert-all").hidden = active && !items.some((i) => startable(i, globalHeight));
  $("btn-cancel-all").hidden = !active;

  const overall = $("overall");
  overall.hidden = !active;
  if (active) {
    const pct = Math.round(overallPercent(items));
    $("overall-percent").textContent = `${pct}%`;
    $("overall-bar").style.width = `${pct}%`;
  }

  const { count, savedBytes } = summary(items);
  const sum = $("queue-summary");
  sum.hidden = active || count === 0;
  if (!sum.hidden) sum.textContent = t("queue.summary", { count, saved: formatSize(Math.max(0, savedBytes)) });
}

// ---------- Configurações ----------

function initSettings() {
  const sheet = $("settings");
  const lang = $<HTMLSelectElement>("lang-select");
  for (const l of LANGUAGES) lang.add(new Option(l.name, l.code));
  lang.value = getLang();

  const par = $<HTMLSelectElement>("parallel-select");
  for (let n = 1; n <= MAX_PARALLEL; n++) par.add(new Option(String(n), String(n)));
  par.value = String(parallel);
  par.addEventListener("change", () => {
    parallel = Number(par.value);
    writeSetting(PARALLEL_KEY, par.value);
    pump();
  });

  const hw = $<HTMLInputElement>("hwaccel-check");
  hw.checked = hwaccel;
  hw.addEventListener("change", () => {
    hwaccel = hw.checked;
    writeSetting(HWACCEL_KEY, String(hwaccel));
  });

  const close = () => {
    sheet.hidden = true;
  };
  $("btn-settings").addEventListener("click", () => {
    sheet.hidden = false;
    lang.focus();
  });
  $("btn-settings-close").addEventListener("click", close);
  sheet.addEventListener("click", (e) => {
    if (e.target === sheet) close();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
  });
  lang.addEventListener("change", () => {
    setLang(lang.value as Lang);
    applyTranslations();
    showError("");
    renderAll();
    renderFooter();
  });
}

async function pickFiles() {
  const selected = await open({
    multiple: true,
    filters: [{ name: t("filter.name"), extensions: VIDEO_EXTENSIONS }],
  });
  if (Array.isArray(selected)) addPaths(selected);
  else if (typeof selected === "string") addPaths([selected]);
}

async function init() {
  loadLang();
  applyTranslations();

  const saved = Number(readSetting(PARALLEL_KEY));
  parallel = saved >= 1 && saved <= MAX_PARALLEL ? saved : 1;
  if (!saved) {
    try {
      parallel = Math.min(MAX_PARALLEL, Math.max(1, await recommendedParallelism()));
    } catch {
      // mantém 1
    }
  }
  hwaccel = readSetting(HWACCEL_KEY) === "true";

  initSettings();
  $("btn-pick").addEventListener("click", pickFiles);
  $("btn-add").addEventListener("click", pickFiles);
  $("btn-convert-all").addEventListener("click", convertAll);
  $("btn-cancel-all").addEventListener("click", () => {
    for (const item of items) if (item.status === "queued") item.status = "ready";
    void cancelAll();
    renderAll();
  });

  void initFooter(() => hasActive(items));
  await onProgress(onJobProgress);

  const zone = $("dropzone");
  await getCurrentWebview().onDragDropEvent((event) => {
    const type = event.payload.type;
    const hovering = type === "enter" || type === "over";
    zone.classList.toggle("hover", hovering);
    document.body.classList.toggle("drag-over", hovering);
    if (type === "drop") addPaths(event.payload.paths);
  });
}

init();
