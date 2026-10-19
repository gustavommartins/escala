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
  thumbnail,
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
import { icon, icons, type IconName } from "./icons";
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
import { initFooter, renderFooter } from "./footer";

const PROBE_CONCURRENCY = 4;
const THUMB_CONCURRENCY = 2;
const MAX_PARALLEL = 4;
const PARALLEL_KEY = "escala.parallel";
const HWACCEL_KEY = "escala.hwaccel";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

let items: QueueItem[] = [];
let globalHeight: number | null = null;
let parallel = 1;
// Decodificação por hardware fica desligada até o benchmark (npm run bench) provar ganho com amostras reais.
let hwaccel = false;

const rows = new Map<string, HTMLElement>();
const thumbs = new Map<string, string>(); // caminho -> data URL ("" se falhou)
const probeQueue: QueueItem[] = [];
const thumbQueue: QueueItem[] = [];
let probing = 0;
let thumbBusy = 0;

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

function number(value: number, digits: number): string {
  return new Intl.NumberFormat(getLang(), { maximumFractionDigits: digits }).format(value);
}

function formatSize(bytes: number): string {
  const mb = Math.abs(bytes) / 1024 / 1024;
  return mb >= 1024 ? `${number(mb / 1024, 1)} GB` : `${number(mb, 0)} MB`;
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

/** Anuncia eventos relevantes (concluído, erro) a leitores de tela sem narrar cada tick de progresso. */
function announce(message: string) {
  const live = $("live");
  live.textContent = "";
  requestAnimationFrame(() => (live.textContent = message));
}

function itemById(id: string): QueueItem | undefined {
  return items.find((i) => i.id === id);
}

/** Troca `data-icon="nome"` por SVG nos elementos estáticos do HTML. */
function applyIcons() {
  document.querySelectorAll<HTMLElement>("[data-icon]").forEach((node) => {
    const name = node.dataset.icon as IconName;
    if (node.classList.contains("sym")) {
      node.innerHTML = icons[name];
      node.setAttribute("aria-hidden", "true");
    } else {
      node.replaceChildren(icon(name));
    }
  });
}

// ---------- Controles ----------

/** Segmented control com seleção única e navegação por setas. */
function renderSegmented(
  box: HTMLElement,
  options: { value: number; label: string }[],
  current: number | null,
  onChange: (value: number) => void,
) {
  const focusedIndex = box.contains(document.activeElement)
    ? [...box.querySelectorAll("button")].indexOf(document.activeElement as HTMLButtonElement)
    : -1;
  box.replaceChildren();
  const buttons = options.map((o) => {
    const btn = el("button", "", o.label);
    btn.setAttribute("role", "radio");
    const checked = o.value === current;
    btn.setAttribute("aria-checked", String(checked));
    btn.tabIndex = checked || (current === null && o === options[0]) ? 0 : -1;
    btn.addEventListener("click", () => onChange(o.value));
    return btn;
  });
  buttons.forEach((btn, i) => {
    btn.addEventListener("keydown", (e) => {
      const step =
        e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
      if (!step) return;
      e.preventDefault();
      const next = (i + step + options.length) % options.length;
      onChange(options[next].value);
      requestAnimationFrame(() => box.querySelectorAll<HTMLElement>("button")[next]?.focus());
    });
  });
  box.append(...buttons);
  if (focusedIndex >= 0) buttons[focusedIndex]?.focus();
}

/** Mantém o foco dentro de `container` enquanto ele estiver aberto (Tab circular). */
function trapFocus(container: HTMLElement, e: KeyboardEvent) {
  if (e.key !== "Tab") return;
  const focusable = [...container.querySelectorAll<HTMLElement>("button, select, input, [tabindex='0']")].filter(
    (n) => !n.hasAttribute("disabled") && n.offsetParent !== null,
  );
  if (focusable.length === 0) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

/** Alerta de confirmação; devolve `true` se o usuário confirmou a ação destrutiva. */
function confirmCancelAll(): Promise<boolean> {
  const alert = $("alert");
  const keep = $("alert-keep");
  const confirmBtn = $("alert-confirm");
  const previous = document.activeElement as HTMLElement | null;
  alert.hidden = false;
  keep.focus(); // o padrão é a opção não destrutiva
  return new Promise((resolve) => {
    const finish = (value: boolean) => {
      alert.hidden = true;
      alert.removeEventListener("keydown", onKey);
      alert.removeEventListener("click", onBackdrop);
      keep.removeEventListener("click", onKeep);
      confirmBtn.removeEventListener("click", onConfirm);
      previous?.focus();
      resolve(value);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        finish(false);
      } else {
        trapFocus(alert, e);
      }
    };
    const onBackdrop = (e: MouseEvent) => {
      if (e.target === alert) finish(false);
    };
    const onKeep = () => finish(false);
    const onConfirm = () => finish(true);
    alert.addEventListener("keydown", onKey);
    alert.addEventListener("click", onBackdrop);
    keep.addEventListener("click", onKeep);
    confirmBtn.addEventListener("click", onConfirm);
  });
}

// ---------- Análise (probe) e miniaturas ----------

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
    item.status = item.probe.resolutions.length === 0 ? "skipped" : "ready";
  } catch (e) {
    item.status = "error";
    item.error = String(e);
  }
  if (!itemById(item.id)) return;
  syncGlobalHeight();
  renderAll();
  if (item.probe) requestThumb(item);
}

function requestThumb(item: QueueItem) {
  if (thumbs.has(item.path)) return;
  thumbQueue.push(item);
  pumpThumbs();
}

function pumpThumbs() {
  while (thumbBusy < THUMB_CONCURRENCY && thumbQueue.length > 0) {
    const item = thumbQueue.shift()!;
    if (!itemById(item.id) || thumbs.has(item.path)) continue;
    thumbBusy++;
    void thumbnail(item.path, item.probe!.info)
      .then((url) => thumbs.set(item.path, url))
      .catch(() => thumbs.set(item.path, "")) // sem miniatura: fica o placeholder
      .finally(() => {
        thumbBusy--;
        if (itemById(item.id)) updateRow(item);
        pumpThumbs();
      });
  }
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

function enqueue(item: QueueItem) {
  item.target = effectiveHeight(item, globalHeight)!;
  item.status = "queued";
  item.percent = 0;
  item.speed = item.etaS = undefined;
  item.error = undefined;
}

function convertAll() {
  for (const item of items) if (startable(item, globalHeight)) enqueue(item);
  renderAll();
  pump();
}

function retryItem(item: QueueItem) {
  if (!startable(item, globalHeight)) return;
  enqueue(item);
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
    announce(`${item.name}: ${t("queue.done", { size: formatSize(result.output_size), original: formatSize(item.probe?.info.size_bytes ?? 0) })}`);
  } catch (e) {
    if (String(e) === "cancelled") {
      item.status = "cancelled";
    } else {
      item.status = "error";
      item.error = String(e);
      announce(`${item.name}: ${errorMessage(item.error)}`);
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

async function onCancelAll() {
  const running = items.some((i) => i.status === "converting" || i.status === "finalizing");
  if (running && !(await confirmCancelAll())) return;
  for (const item of items) if (item.status === "queued") item.status = "ready";
  void cancelAll();
  renderAll();
}

function clearFinished() {
  items = items.filter((i) => !["done", "skipped", "cancelled"].includes(i.status));
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
  updateRow(item);
  renderOverall();
}

// ---------- Renderização ----------

function syncGlobalHeight() {
  const options = globalOptions(items);
  if (!options.some((r) => r.height === globalHeight)) globalHeight = defaultHeight(options);
}

function iconButton(
  name: IconName,
  label: string,
  act: string,
  onClick: () => void,
  className = "btn-icon",
): HTMLButtonElement {
  const btn = el("button", className);
  btn.append(icon(name));
  btn.setAttribute("aria-label", label);
  btn.title = label;
  btn.dataset.act = act;
  btn.addEventListener("click", onClick);
  return btn;
}

function progressBar(item: QueueItem, indeterminate: boolean): HTMLElement {
  const track = el("div", `progress${indeterminate ? " indeterminate" : ""}`);
  track.setAttribute("role", "progressbar");
  track.setAttribute("aria-label", item.name);
  if (!indeterminate) track.setAttribute("aria-valuenow", String(Math.round(item.percent)));
  const fill = el("div", "progress-bar");
  if (!indeterminate) fill.style.width = `${Math.round(item.percent)}%`;
  track.append(fill);
  return track;
}

function progressText(item: QueueItem): string {
  if (item.percent <= 0 && item.speed === undefined) return t("queue.preparing");
  const parts: string[] = [];
  if (item.speed) parts.push(`${number(item.speed, 1)}×`);
  if (item.etaS !== undefined) parts.push(t("queue.remaining", { time: formatDuration(item.etaS) }));
  return parts.join(" · ");
}

function statusLine(item: QueueItem): HTMLElement {
  const box = el("div", "row-status");
  const info = item.probe?.info;
  const shortSide = info ? Math.min(info.width, info.height) : 0;
  const withIcon = (name: IconName, text: string, tone: string) => {
    box.classList.add(tone);
    box.append(icon(name, "state-icon"), el("span", "", text));
  };

  switch (item.status) {
    case "probing":
      box.append(el("span", "spinner"), el("span", "", t("queue.analyzing")));
      break;
    case "skipped":
      box.append(el("span", "", t("queue.skipped", { height: shortSide })));
      break;
    case "ready": {
      const h = effectiveHeight(item, globalHeight);
      box.append(el("span", "", h ? `→ ${h}p` : t("queue.skipped", { height: shortSide })));
      break;
    }
    case "queued":
      box.append(el("span", "", t("queue.waiting")));
      break;
    case "converting": {
      const started = item.percent > 0 || item.speed !== undefined;
      box.append(progressBar(item, !started), el("span", "progress-text", progressText(item)));
      break;
    }
    case "finalizing":
      box.append(progressBar(item, true), el("span", "", t("queue.finalizing")));
      break;
    case "done":
      withIcon(
        "checkmarkCircle",
        t("queue.done", { size: formatSize(item.outputSize ?? 0), original: formatSize(info?.size_bytes ?? 0) }),
        "ok",
      );
      break;
    case "error":
      withIcon("exclamationTriangle", errorMessage(item.error), "fail");
      break;
    case "cancelled":
      box.append(el("span", "", t("queue.cancelled")));
      break;
  }
  return box;
}

function overrideSelect(item: QueueItem): HTMLSelectElement | null {
  const resolutions = item.probe?.resolutions ?? [];
  if (resolutions.length === 0) return null;
  const select = el("select", "popup");
  select.dataset.act = "override";
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

function accessory(item: QueueItem): HTMLElement {
  const box = el("div", "row-accessory");
  const remove = () => iconButton("xmark", t("queue.remove"), "remove", () => removeItem(item));
  switch (item.status) {
    case "ready": {
      const select = overrideSelect(item);
      if (select) box.append(select);
      box.append(remove());
      break;
    }
    case "queued":
      box.append(iconButton("xmark", t("common.cancel"), "cancel", () => cancelItem(item)));
      break;
    case "converting":
    case "finalizing":
      if (item.status === "converting" && item.percent > 0) {
        box.append(el("span", "row-percent", `${number(Math.round(item.percent), 0)}%`));
      }
      box.append(iconButton("stop", t("queue.stop"), "stop", () => cancelItem(item), "btn-icon tint"));
      break;
    case "done": {
      const reveal = el("button", "btn", t("done.reveal"));
      reveal.dataset.act = "reveal";
      reveal.addEventListener("click", () => void revealItemInDir(item.output!));
      box.append(reveal, remove());
      break;
    }
    case "error":
    case "cancelled":
      if (startable(item, globalHeight)) {
        box.append(iconButton("arrowClockwise", t("queue.retry"), "retry", () => retryItem(item)));
      }
      box.append(remove());
      break;
    default:
      box.append(remove());
  }
  return box;
}

function thumbElement(item: QueueItem): HTMLElement {
  const box = el("div", "thumb");
  const url = thumbs.get(item.path);
  if (url) {
    const img = el("img");
    img.src = url;
    img.alt = "";
    box.append(img);
  } else {
    box.append(icon("film"));
  }
  return box;
}

function renderRow(item: QueueItem, entering: boolean): HTMLElement {
  const row = el("div", `row queue-row${entering ? " enter" : ""}${item.status === "skipped" ? " dim" : ""}`);
  row.dataset.id = item.id;

  const body = el("div", "row-body");
  body.append(el("div", "row-title selectable", item.name));
  const info = item.probe?.info;
  if (info) {
    body.append(
      el("div", "row-meta", `${info.width}×${info.height} · ${formatDuration(info.duration_s)} · ${formatSize(info.size_bytes)}`),
    );
  }
  body.append(statusLine(item));

  row.append(thumbElement(item), body, accessory(item));
  return row;
}

/** Troca uma linha preservando o foco do teclado (identificado por `data-act`). */
function replaceRow(old: HTMLElement, fresh: HTMLElement) {
  const focused = old.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset.act : undefined;
  old.replaceWith(fresh);
  if (focused) fresh.querySelector<HTMLElement>(`[data-act="${focused}"]`)?.focus();
}

/** Tudo que muda a estrutura da linha; progresso e tempo restante ficam de fora (são atualizados no lugar). */
function fingerprint(item: QueueItem): string {
  return [
    item.status,
    item.percent > 0 || item.speed !== undefined,
    item.override ?? "",
    effectiveHeight(item, globalHeight) ?? "",
    startable(item, globalHeight),
    item.probe ? 1 : 0,
    thumbs.get(item.path) ? 1 : 0,
    item.error ?? "",
    item.outputSize ?? "",
    getLang(),
  ].join("|");
}

/** Atualiza barra, % e texto de uma linha em conversão sem recriar nós (cliques e foco continuam válidos). */
function patchProgress(row: HTMLElement, item: QueueItem) {
  const bar = row.querySelector<HTMLElement>(".progress");
  const fill = row.querySelector<HTMLElement>(".progress-bar");
  if (bar && fill && !bar.classList.contains("indeterminate")) {
    const pct = Math.round(item.percent);
    fill.style.width = `${pct}%`;
    bar.setAttribute("aria-valuenow", String(pct));
  }
  const text = row.querySelector<HTMLElement>(".progress-text");
  if (text) text.textContent = progressText(item);
  const percent = row.querySelector<HTMLElement>(".row-percent");
  if (percent) percent.textContent = `${number(Math.round(item.percent), 0)}%`;
}

const prints = new Map<string, string>();

function updateRow(item: QueueItem) {
  const old = rows.get(item.id);
  if (!old) return;
  const print = fingerprint(item);
  if (prints.get(item.id) === print) {
    patchProgress(old, item);
    return;
  }
  const fresh = renderRow(item, false);
  replaceRow(old, fresh);
  rows.set(item.id, fresh);
  prints.set(item.id, print);
}

function syncList() {
  const ids = new Set(items.map((i) => i.id));
  for (const [id, node] of rows) {
    if (!ids.has(id)) {
      node.remove();
      rows.delete(id);
      prints.delete(id);
    }
  }
  const list = $("queue-list");
  for (const item of items) {
    if (rows.has(item.id)) {
      updateRow(item);
    } else {
      const fresh = renderRow(item, true);
      rows.set(item.id, fresh);
      prints.set(item.id, fingerprint(item));
      list.append(fresh);
    }
  }
}

function renderOverall() {
  const active = hasActive(items);
  $("overall").hidden = !active;
  if (!active) return;
  const pct = Math.round(overallPercent(items));
  $("overall-percent").textContent = `${pct}%`;
  $("overall-bar").style.width = `${pct}%`;
  $("overall-bar").parentElement!.setAttribute("aria-valuenow", String(pct));
}

function renderAll() {
  const hasItems = items.length > 0;
  $("view-drop").hidden = hasItems;
  $("view-queue").hidden = !hasItems;
  $("btn-add").hidden = !hasItems;
  const count = $("toolbar-count");
  count.hidden = !hasItems;
  count.textContent = hasItems ? t("queue.count", { count: items.length }) : "";

  const active = hasActive(items);
  const anyStartable = items.some((i) => startable(i, globalHeight));
  const convert = $<HTMLButtonElement>("btn-convert-all");
  convert.hidden = !hasItems || (active && !anyStartable);
  convert.disabled = !anyStartable;
  $("btn-cancel-all").hidden = !active;
  $("btn-clear").hidden = !items.some((i) => ["done", "skipped", "cancelled"].includes(i.status));
  renderOverall();

  if (hasItems) {
    renderSegmented(
      $("global-options"),
      globalOptions(items).map((r) => ({ value: r.height, label: r.label })),
      globalHeight,
      (height) => {
        globalHeight = height;
        renderAll();
      },
    );
    syncList();
  }

  const { count: doneCount, savedBytes } = summary(items);
  const sum = $("queue-summary");
  sum.hidden = active || doneCount === 0;
  if (!sum.hidden) sum.textContent = t("queue.summary", { count: doneCount, saved: formatSize(Math.max(0, savedBytes)) });

}

// ---------- Configurações ----------

function renderParallel() {
  renderSegmented(
    $("parallel-seg"),
    Array.from({ length: MAX_PARALLEL }, (_, i) => ({ value: i + 1, label: String(i + 1) })),
    parallel,
    (value) => {
      parallel = value;
      writeSetting(PARALLEL_KEY, String(value));
      renderParallel();
      pump();
    },
  );
}

function initSettings() {
  const sheet = $("settings");
  const lang = $<HTMLSelectElement>("lang-select");
  for (const l of LANGUAGES) lang.add(new Option(l.name, l.code));
  lang.value = getLang();

  renderParallel();

  const hw = $<HTMLInputElement>("hwaccel-check");
  hw.checked = hwaccel;
  hw.addEventListener("change", () => {
    hwaccel = hw.checked;
    writeSetting(HWACCEL_KEY, String(hwaccel));
  });

  const close = () => {
    sheet.hidden = true;
    $("btn-settings").focus();
  };
  $("btn-settings").addEventListener("click", () => {
    sheet.hidden = false;
    $("btn-settings-close").focus();
  });
  $("btn-settings-close").addEventListener("click", close);
  sheet.addEventListener("click", (e) => {
    if (e.target === sheet) close();
  });
  sheet.addEventListener("keydown", (e) => trapFocus(sheet, e));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !sheet.hidden && $("alert").hidden) close();
  });
  lang.addEventListener("change", () => {
    setLang(lang.value as Lang);
    applyTranslations();
    showError("");
    renderAll();
    renderParallel();
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
  applyIcons();

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
  $("btn-cancel-all").addEventListener("click", () => void onCancelAll());
  $("btn-clear").addEventListener("click", clearFinished);

  void initFooter();
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
