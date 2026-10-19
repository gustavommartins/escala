import { open } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import {
  cancelConversion,
  convertVideo,
  onProgress,
  probeVideo,
  type ProbeResult,
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

const VIDEO_EXTENSIONS = ["mp4", "mov", "mkv", "avi", "webm", "m4v"];

type View = "drop" | "options" | "progress" | "done";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

let currentPath = "";
let probe: ProbeResult | null = null;
let selectedHeight: number | null = null;
let outputPath = "";
let busy = false;

function show(view: View) {
  for (const v of ["drop", "options", "progress", "done"] as View[]) {
    $(`view-${v}`).hidden = v !== view;
  }
}

function formatSize(bytes: number): string {
  const mb = bytes / 1024 / 1024;
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb.toFixed(0)} MB`;
}

function formatDuration(seconds: number): string {
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

function showDropError(message: string) {
  const el = $("drop-error");
  el.textContent = message;
  el.hidden = !message;
}

async function loadFile(path: string) {
  if (busy) return;
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  if (!VIDEO_EXTENSIONS.includes(ext)) {
    showDropError(t("error.badExtension"));
    return;
  }
  showDropError("");
  try {
    probe = await probeVideo(path);
  } catch (e) {
    showDropError(errorMessage(e));
    return;
  }
  if (probe.resolutions.length === 0) {
    showDropError(t("error.alreadySmall", { height: Math.min(probe.info.width, probe.info.height) }));
    return;
  }
  currentPath = path;
  renderOptions(probe);
  show("options");
}

function renderOptions(p: ProbeResult) {
  $("file-name").textContent = p.name;
  $("file-meta").textContent =
    `${p.info.width}×${p.info.height} · ${formatDuration(p.info.duration_s)} · ${formatSize(p.info.size_bytes)}`;

  const list = $("options");
  list.replaceChildren();
  const preselect = p.resolutions.find((r) => r.recommended) ?? p.resolutions[0];
  const keep = p.resolutions.find((r) => r.height === selectedHeight);

  for (const r of p.resolutions) {
    const btn = document.createElement("button");
    btn.className = "option";
    btn.setAttribute("role", "radio");
    btn.dataset.height = String(r.height);
    btn.innerHTML = `<span></span>${r.recommended ? '<span class="badge"></span>' : ""}`;
    btn.firstElementChild!.textContent = r.label;
    const badge = btn.querySelector(".badge");
    if (badge) badge.textContent = t("options.recommended");
    btn.addEventListener("click", () => select(r.height));
    list.append(btn);
  }
  select((keep ?? preselect).height);
}

function select(height: number) {
  selectedHeight = height;
  for (const el of $("options").children) {
    el.setAttribute("aria-checked", String((el as HTMLElement).dataset.height === String(height)));
  }
  ($("btn-convert") as HTMLButtonElement).disabled = false;
}

async function startConversion() {
  if (!probe || selectedHeight === null || busy) return;
  busy = true;
  $("progress-name").textContent = `${probe.name} → ${selectedHeight}p`;
  setProgress(0);
  show("progress");

  try {
    const result = await convertVideo(currentPath, selectedHeight);
    outputPath = result.output;
    $("done-info").textContent = t("done.info", {
      size: formatSize(result.output_size),
      original: formatSize(probe.info.size_bytes),
    });
    show("done");
  } catch (e) {
    if (String(e) === "cancelled") {
      show("options");
    } else {
      reset();
      showDropError(errorMessage(e));
    }
  } finally {
    busy = false;
  }
}

function setProgress(percent: number) {
  const p = Math.round(percent);
  $("progress-bar").style.width = `${p}%`;
  $("progress-percent").textContent = `${p}%`;
}

function reset() {
  probe = null;
  currentPath = "";
  selectedHeight = null;
  show("drop");
}

async function pickFile() {
  const selected = await open({
    multiple: false,
    filters: [{ name: t("filter.name"), extensions: VIDEO_EXTENSIONS }],
  });
  if (typeof selected === "string") await loadFile(selected);
}

function initSettings() {
  const sheet = $("settings");
  const select = $<HTMLSelectElement>("lang-select");
  for (const l of LANGUAGES) select.add(new Option(l.name, l.code));
  select.value = getLang();

  const close = () => {
    sheet.hidden = true;
  };
  $("btn-settings").addEventListener("click", () => {
    sheet.hidden = false;
    select.focus();
  });
  $("btn-settings-close").addEventListener("click", close);
  sheet.addEventListener("click", (e) => {
    if (e.target === sheet) close();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
  });
  select.addEventListener("change", () => {
    setLang(select.value as Lang);
    applyTranslations();
    if (probe && !$("view-options").hidden) renderOptions(probe);
    showDropError("");
  });
}

async function init() {
  loadLang();
  applyTranslations();
  initSettings();
  $("btn-pick").addEventListener("click", pickFile);
  $("btn-back").addEventListener("click", reset);
  $("btn-convert").addEventListener("click", startConversion);
  $("btn-cancel").addEventListener("click", () => cancelConversion());
  $("btn-another").addEventListener("click", reset);
  $("btn-reveal").addEventListener("click", () => revealItemInDir(outputPath));

  await onProgress(setProgress);

  const zone = $("dropzone");
  await getCurrentWebview().onDragDropEvent(async (event) => {
    const type = event.payload.type;
    if (type === "enter" || type === "over") zone.classList.add("hover");
    else zone.classList.remove("hover");
    if (type === "drop" && !$("view-drop").hidden) {
      const first = event.payload.paths[0];
      if (first) await loadFile(first);
    }
  });
}

init();
