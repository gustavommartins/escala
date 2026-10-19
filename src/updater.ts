// Versão no rodapé + atualização automática (baixa em segundo plano, reinicia só quando o usuário confirma).
import { getVersion } from "@tauri-apps/api/app";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { t } from "./i18n";

const CHECK_DELAY_MS = 3000;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

let version = "";
let update: Update | null = null;
let percent = 0;
let state: "idle" | "downloading" | "ready" | "waiting" = "idle";
let isBusy: () => boolean = () => false;

export function renderFooter() {
  $("footer-version").textContent = version ? t("footer.version", { version }) : "";
  const status = $("update-status");
  const button = $<HTMLButtonElement>("btn-update");
  status.hidden = state === "idle";
  button.hidden = state !== "ready";
  if (!update) return;
  if (state === "downloading") status.textContent = t("update.downloading", { version: update.version, percent });
  else if (state === "ready") status.textContent = t("update.ready", { version: update.version });
  else if (state === "waiting") status.textContent = t("update.waiting");
  button.textContent = t("update.restart");
}

async function restartNow() {
  if (!update) return;
  await update.install();
  await relaunch();
}

/** Chamado quando a fila esvazia: conclui um reinício que ficou esperando as conversões. */
export function notifyIdle() {
  if (state === "waiting" && !isBusy()) void restartNow().catch((e) => console.warn("restart failed", e));
}

async function downloadUpdate(found: Update) {
  update = found;
  state = "downloading";
  percent = 0;
  renderFooter();
  let total = 0;
  let received = 0;
  await found.download((event) => {
    if (event.event === "Started") total = event.data.contentLength ?? 0;
    else if (event.event === "Progress") {
      received += event.data.chunkLength;
      percent = total ? Math.min(100, Math.round((received / total) * 100)) : 0;
      renderFooter();
    }
  });
  state = "ready";
  renderFooter();
}

export async function initFooter(busy: () => boolean) {
  isBusy = busy;
  try {
    version = await getVersion();
  } catch {
    // fora do Tauri (ex.: navegador): sem versão
  }
  $("btn-update").addEventListener("click", () => {
    if (isBusy()) {
      state = "waiting";
      renderFooter();
    } else {
      void restartNow().catch((e) => console.warn("restart failed", e));
    }
  });
  renderFooter();

  if (import.meta.env.DEV) return;
  setTimeout(async () => {
    try {
      const found = await check();
      if (found) await downloadUpdate(found);
    } catch (e) {
      // offline ou sem release: não incomoda o usuário
      console.warn("update check failed", e);
      state = "idle";
      renderFooter();
    }
  }, CHECK_DELAY_MS);
}
