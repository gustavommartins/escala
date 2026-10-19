// Ícones inline no estilo SF Symbols (viewBox 24x24, tamanho controlado pelo CSS via 1em).
// Strings são constantes do código; nenhuma entrada de usuário é interpolada.

export type IconName =
  | "film"
  | "plus"
  | "gear"
  | "xmark"
  | "xmarkCircle"
  | "checkmarkCircle"
  | "exclamationTriangle"
  | "folder"
  | "arrowClockwise"
  | "trash"
  | "stop"
  | "arrowDownCircle"
  | "sparkles";

const SVG_OPEN = 'xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="1em" height="1em"';
const STROKE_ATTRS = 'fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"';

function stroked(body: string): string {
  return `<svg ${SVG_OPEN} ${STROKE_ATTRS}>${body}</svg>`;
}

function filled(body: string): string {
  return `<svg ${SVG_OPEN} fill="currentColor" fill-rule="evenodd">${body}</svg>`;
}

export const icons: Record<IconName, string> = {
  film: stroked(
    '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M7 5v14M17 5v14"/>'
  ),
  plus: stroked('<path d="M12 5v14M5 12h14"/>'),
  gear: stroked(
    '<circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2.5"/>' +
      '<path d="M12 6V2.5M12 18v3.5M6 12H2.5M18 12h3.5M7.76 7.76L5.28 5.28M16.24 7.76L18.72 5.28M7.76 16.24L5.28 18.72M16.24 16.24L18.72 18.72"/>'
  ),
  xmark: stroked('<path d="M6 6l12 12M18 6L6 18"/>'),
  xmarkCircle: filled(
    '<path d="M2 12a10 10 0 1 0 20 0a10 10 0 1 0-20 0z"/>' +
      '<path d="M8.85 7.15L12 10.3L15.15 7.15L16.85 8.85L13.7 12L16.85 15.15L15.15 16.85L12 13.7L8.85 16.85L7.15 15.15L10.3 12L7.15 8.85Z"/>'
  ),
  checkmarkCircle: filled(
    '<path d="M2 12a10 10 0 1 0 20 0a10 10 0 1 0-20 0z"/>' +
      '<path d="M6.72 13.28L10.5 17.06L17.28 10.28L15.72 8.72L10.5 13.94L8.28 11.72Z"/>'
  ),
  exclamationTriangle: stroked(
    '<path d="M10.3 4.3a2 2 0 0 1 3.4 0l7.6 13.1a2 2 0 0 1-1.7 3H4.4a2 2 0 0 1-1.7-3z"/>' +
      '<path d="M12 9.5v4.5M12 17.2h.01"/>'
  ),
  folder: stroked(
    '<path d="M3 7.5a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'
  ),
  arrowClockwise: stroked(
    '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3L19.5 4.5"/><path d="M19.5 9V4.5H15"/>'
  ),
  trash: stroked(
    '<path d="M4 7h16"/><path d="M9.5 7V4.5h5V7"/><path d="M6 7l1 12.5h10L18 7"/>'
  ),
  stop: filled(
    '<path d="M2 12a10 10 0 1 0 20 0a10 10 0 1 0-20 0z"/>' +
      '<path d="M9.8 8h4.4a1.8 1.8 0 0 1 1.8 1.8v4.4a1.8 1.8 0 0 1-1.8 1.8H9.8a1.8 1.8 0 0 1-1.8-1.8V9.8A1.8 1.8 0 0 1 9.8 8z"/>'
  ),
  arrowDownCircle: stroked(
    '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v8M8.5 12.5L12 16l3.5-3.5"/>'
  ),
  sparkles: stroked(
    '<path d="M10 5.5Q11 12 17.5 13Q11 14 10 20.5Q9 14 2.5 13Q9 12 10 5.5Z"/>' +
      '<path d="M18 2.5Q18.4 4.6 20.5 5Q18.4 5.4 18 7.5Q17.6 5.4 15.5 5Q17.6 4.6 18 2.5Z"/>'
  ),
};

export function icon(name: IconName, className = ""): HTMLElement {
  const span = document.createElement("span");
  span.className = `sym ${className}`;
  span.setAttribute("aria-hidden", "true");
  span.innerHTML = icons[name];
  return span;
}
