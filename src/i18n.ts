// Traduções da interface. Para adicionar um idioma: crie uma entrada em `dictionaries`
// (mesmas chaves de `en`) e inclua-o em `LANGUAGES`.

export type Lang = "en" | "pt" | "es";

export const LANGUAGES: { code: Lang; name: string }[] = [
  { code: "en", name: "English" },
  { code: "pt", name: "Português" },
  { code: "es", name: "Español" },
];

const DEFAULT_LANG: Lang = "en";
const STORAGE_KEY = "escala.lang";

const en = {
  "app.title": "Escala",
  "drop.title": "Drag your videos here",
  "drop.subtitle": "MP4, MOV, MKV, AVI, WEBM or M4V — several at once",
  "drop.or": "or",
  "drop.pick": "Choose files…",
  "options.convertTo": "Convert to",
  "options.recommended": "Recommended",
  "options.hint": "Quality is preserved: the app uses settings that keep the picture visually identical.",
  "common.back": "Back",
  "common.convert": "Convert",
  "common.cancel": "Cancel",
  "done.reveal": "Show in folder",
  "settings.title": "Settings",
  "settings.language": "Language",
  "settings.close": "Close",
  "filter.name": "Videos",
  "queue.analyzing": "Analyzing video…",
  "queue.preparing": "Preparing…",
  "queue.finalizing": "Finalizing…",
  "queue.waiting": "Waiting",
  "queue.remaining": "~{time} left",
  "queue.speed": "{speed}× speed",
  "queue.skipped": "Skipped: already {height}p",
  "queue.add": "Add videos",
  "queue.convertAll": "Convert all",
  "queue.cancelAll": "Cancel all",
  "queue.remove": "Remove",
  "queue.done": "Done: {size} (original: {original})",
  "queue.cancelled": "Cancelled",
  "queue.summary": "{count} converted · saved {saved}",
  "queue.overall": "Overall progress",
  "queue.resolution": "Resolution",
  "queue.sameAsAll": "Same as all",
  "settings.parallel": "Simultaneous conversions",
  "settings.hwaccel": "Hardware decoding",
  "settings.section.general": "General",
  "settings.section.performance": "Performance",
  "settings.hwaccel.footer": "Only speeds up reading 4K videos. Output quality is identical.",
  "settings.parallel.footer": "More at once uses more CPU.",
  "settings.done": "Done",
  "queue.count": "{count} videos",
  "queue.clearDone": "Clear finished",
  "queue.retry": "Try again",
  "queue.stop": "Stop",
  "confirm.cancelAll.title": "Cancel all conversions?",
  "confirm.cancelAll.body": "Files being converted will be discarded.",
  "confirm.keep": "Keep converting",
  "footer.version": "Escala v{version}",
  "error.badExtension": "Choose a video file (MP4, MOV, MKV, AVI, WEBM or M4V).",
  "error.alreadySmall": "This video is already {height}p — there is no smaller resolution to convert to.",
  "error.err_sidecar": "Could not start the built-in converter. Please reinstall the app.",
  "error.err_not_video": "This file does not seem to be a valid video.",
  "error.err_no_video_stream": "This file does not seem to contain video.",
  "error.err_unreadable": "Could not read the video information.",
  "error.err_busy": "A conversion is already in progress.",
  "error.err_res_unavailable": "That resolution is not available for this video.",
  "error.err_failed": "The conversion failed. The file may be corrupted or protected.",
  "error.unknown": "Something went wrong: {message}",
};

export type Key = keyof typeof en;

const pt: Record<Key, string> = {
  "app.title": "Escala",
  "drop.title": "Arraste seus vídeos aqui",
  "drop.subtitle": "MP4, MOV, MKV, AVI, WEBM ou M4V — vários de uma vez",
  "drop.or": "ou",
  "drop.pick": "Escolher arquivos…",
  "options.convertTo": "Converter para",
  "options.recommended": "Recomendado",
  "options.hint": "A qualidade é preservada: o app usa configurações que mantêm a imagem visualmente idêntica.",
  "common.back": "Voltar",
  "common.convert": "Converter",
  "common.cancel": "Cancelar",
  "done.reveal": "Mostrar na pasta",
  "settings.title": "Configurações",
  "settings.language": "Idioma",
  "settings.close": "Fechar",
  "filter.name": "Vídeos",
  "queue.analyzing": "Analisando vídeo…",
  "queue.preparing": "Preparando…",
  "queue.finalizing": "Finalizando…",
  "queue.waiting": "Aguardando",
  "queue.remaining": "~{time} restantes",
  "queue.speed": "velocidade {speed}×",
  "queue.skipped": "Pulado: já tem {height}p",
  "queue.add": "Adicionar vídeos",
  "queue.convertAll": "Converter tudo",
  "queue.cancelAll": "Cancelar tudo",
  "queue.remove": "Remover",
  "queue.done": "Pronto: {size} (original: {original})",
  "queue.cancelled": "Cancelado",
  "queue.summary": "{count} convertidos · economia de {saved}",
  "queue.overall": "Progresso geral",
  "queue.resolution": "Resolução",
  "queue.sameAsAll": "Igual a todos",
  "settings.parallel": "Conversões simultâneas",
  "settings.hwaccel": "Decodificação por hardware",
  "settings.section.general": "Geral",
  "settings.section.performance": "Desempenho",
  "settings.hwaccel.footer": "Só acelera a leitura de vídeos 4K. A qualidade do resultado é idêntica.",
  "settings.parallel.footer": "Mais ao mesmo tempo usa mais CPU.",
  "settings.done": "OK",
  "queue.count": "{count} vídeos",
  "queue.clearDone": "Limpar concluídos",
  "queue.retry": "Tentar de novo",
  "queue.stop": "Parar",
  "confirm.cancelAll.title": "Cancelar todas as conversões?",
  "confirm.cancelAll.body": "Os arquivos em conversão serão descartados.",
  "confirm.keep": "Continuar convertendo",
  "footer.version": "Escala v{version}",
  "error.badExtension": "Escolha um arquivo de vídeo (MP4, MOV, MKV, AVI, WEBM ou M4V).",
  "error.alreadySmall": "Este vídeo já tem {height}p — não há uma resolução menor para converter.",
  "error.err_sidecar": "Não consegui iniciar o conversor embutido. Reinstale o app.",
  "error.err_not_video": "Este arquivo não parece ser um vídeo válido.",
  "error.err_no_video_stream": "Este arquivo não parece conter vídeo.",
  "error.err_unreadable": "Não consegui ler as informações do vídeo.",
  "error.err_busy": "Já existe uma conversão em andamento.",
  "error.err_res_unavailable": "Essa resolução não está disponível para este vídeo.",
  "error.err_failed": "A conversão falhou. O arquivo pode estar corrompido ou protegido.",
  "error.unknown": "Algo deu errado: {message}",
};

const es: Record<Key, string> = {
  "app.title": "Escala",
  "drop.title": "Arrastra tus videos aquí",
  "drop.subtitle": "MP4, MOV, MKV, AVI, WEBM o M4V — varios a la vez",
  "drop.or": "o",
  "drop.pick": "Elegir archivos…",
  "options.convertTo": "Convertir a",
  "options.recommended": "Recomendado",
  "options.hint": "La calidad se conserva: la app usa ajustes que mantienen la imagen visualmente idéntica.",
  "common.back": "Atrás",
  "common.convert": "Convertir",
  "common.cancel": "Cancelar",
  "done.reveal": "Mostrar en la carpeta",
  "settings.title": "Ajustes",
  "settings.language": "Idioma",
  "settings.close": "Cerrar",
  "filter.name": "Videos",
  "queue.analyzing": "Analizando video…",
  "queue.preparing": "Preparando…",
  "queue.finalizing": "Finalizando…",
  "queue.waiting": "En espera",
  "queue.remaining": "~{time} restantes",
  "queue.speed": "velocidad {speed}×",
  "queue.skipped": "Omitido: ya tiene {height}p",
  "queue.add": "Añadir videos",
  "queue.convertAll": "Convertir todo",
  "queue.cancelAll": "Cancelar todo",
  "queue.remove": "Quitar",
  "queue.done": "Listo: {size} (original: {original})",
  "queue.cancelled": "Cancelado",
  "queue.summary": "{count} convertidos · ahorro de {saved}",
  "queue.overall": "Progreso general",
  "queue.resolution": "Resolución",
  "queue.sameAsAll": "Igual que todos",
  "settings.parallel": "Conversiones simultáneas",
  "settings.hwaccel": "Decodificación por hardware",
  "settings.section.general": "General",
  "settings.section.performance": "Rendimiento",
  "settings.hwaccel.footer": "Solo acelera la lectura de videos 4K. La calidad del resultado es idéntica.",
  "settings.parallel.footer": "Más a la vez usa más CPU.",
  "settings.done": "Listo",
  "queue.count": "{count} videos",
  "queue.clearDone": "Limpiar terminados",
  "queue.retry": "Reintentar",
  "queue.stop": "Detener",
  "confirm.cancelAll.title": "¿Cancelar todas las conversiones?",
  "confirm.cancelAll.body": "Los archivos en conversión se descartarán.",
  "confirm.keep": "Seguir convirtiendo",
  "footer.version": "Escala v{version}",
  "error.badExtension": "Elige un archivo de video (MP4, MOV, MKV, AVI, WEBM o M4V).",
  "error.alreadySmall": "Este video ya tiene {height}p — no hay una resolución menor a la que convertir.",
  "error.err_sidecar": "No pude iniciar el conversor integrado. Reinstala la app.",
  "error.err_not_video": "Este archivo no parece ser un video válido.",
  "error.err_no_video_stream": "Este archivo no parece contener video.",
  "error.err_unreadable": "No pude leer la información del video.",
  "error.err_busy": "Ya hay una conversión en curso.",
  "error.err_res_unavailable": "Esa resolución no está disponible para este video.",
  "error.err_failed": "La conversión falló. El archivo puede estar dañado o protegido.",
  "error.unknown": "Algo salió mal: {message}",
};

const dictionaries: Record<Lang, Record<Key, string>> = { en, pt, es };

let current: Lang = DEFAULT_LANG;

function isLang(value: unknown): value is Lang {
  return LANGUAGES.some((l) => l.code === value);
}

export function getLang(): Lang {
  return current;
}

/** Idioma do sistema (ex.: "pt-BR" → "pt"); cai no padrão (inglês) se não for suportado. */
function systemLang(): Lang {
  for (const tag of navigator.languages?.length ? navigator.languages : [navigator.language]) {
    const base = tag.toLowerCase().split("-")[0];
    if (isLang(base)) return base;
  }
  return DEFAULT_LANG;
}

export function loadLang(): Lang {
  current = systemLang();
  try {
    // A escolha manual do usuário tem prioridade sobre o idioma do sistema.
    const saved = localStorage.getItem(STORAGE_KEY);
    if (isLang(saved)) current = saved;
  } catch {
    // sem armazenamento: usa o idioma do sistema
  }
  document.documentElement.lang = current;
  return current;
}

export function setLang(lang: Lang) {
  current = lang;
  document.documentElement.lang = lang;
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // não persistiu, mas vale nesta sessão
  }
}

export function t(key: Key, params: Record<string, string | number> = {}): string {
  let text = dictionaries[current][key] ?? en[key];
  for (const [name, value] of Object.entries(params)) {
    text = text.split(`{${name}}`).join(String(value));
  }
  return text;
}

/** Traduz um erro vindo do Rust (código como "err_failed") ou uma mensagem desconhecida. */
export function errorMessage(error: unknown): string {
  const code = String(error);
  const key = `error.${code}` as Key;
  return key in en ? t(key) : t("error.unknown", { message: code });
}

/** Aplica as traduções a todos os elementos com data-i18n / data-i18n-label. */
export function applyTranslations(root: ParentNode = document) {
  root.querySelectorAll<HTMLElement>("[data-i18n]").forEach((el) => {
    el.textContent = t(el.dataset.i18n as Key);
  });
  root.querySelectorAll<HTMLElement>("[data-i18n-label]").forEach((el) => {
    el.setAttribute("aria-label", t(el.dataset.i18nLabel as Key));
  });
}
