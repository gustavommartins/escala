// Versão do app no rodapé.
import { getVersion } from "@tauri-apps/api/app";
import { t } from "./i18n";

let version = "";

export function renderFooter() {
  document.getElementById("footer-version")!.textContent = version ? t("footer.version", { version }) : "";
}

export async function initFooter() {
  try {
    version = await getVersion();
  } catch {
    // fora do Tauri (ex.: navegador): sem versão
  }
  renderFooter();
}
