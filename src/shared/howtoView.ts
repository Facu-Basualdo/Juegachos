import type { HowTo, HowToIcon } from "./howto";

/**
 * Dibuja un `HowTo` (ver `howto.ts`): una intro opcional y una tarjeta por accion con
 * su titulo grande y los iconos abajo. Lo usan el briefing de la sala
 * (`RoomOverlay.showBriefing`) y la pantalla de inicio de cada juego (`HowToPanel`).
 *
 * Las teclas son HTML (tapitas con sombra) y el mouse, el dedo, el joystick y
 * compañia son SVG inline: nada de emojis ni imagenes sueltas.
 *
 * **Se adapta solo al estilo de donde lo pongan:** la tinta es `currentColor` y la
 * tipografia se hereda, y los fondos de las tarjetas y las teclas salen de mezclar
 * ese color con transparente (`color-mix`). En un juego oscuro queda claro sobre
 * oscuro y en uno claro al reves, sin clasificar juego por juego. El acento (el
 * dedo que toca, el clic, los botones en pantalla) es `--ht-accent`, que el
 * `HowToPanel` toma del `accent` del juego.
 */

const STYLE_ID = "mg-ht-styles";

const CSS = `
.mg-ht-replaced { display: none !important; }
.mg-ht { --ht-accent: #00c2d6; color: inherit; font-family: inherit; text-align: center; }
.mg-ht__intro { font-size: 15px; font-weight: 600; line-height: 1.4; opacity: 0.85; margin: 0 auto 14px; max-width: 480px; }
/* Flex y no grid: con un numero impar de acciones la ultima ocupa su fila entera en
   vez de dejar un hueco al lado. */
.mg-ht__grid { display: flex; flex-wrap: wrap; justify-content: center; gap: 10px; }
.mg-ht__card {
  flex: 1 1 230px; min-width: 0; box-sizing: border-box;
  background: color-mix(in srgb, currentColor 7%, transparent);
  border: 2px solid color-mix(in srgb, currentColor 18%, transparent); border-radius: 14px;
  padding: 12px 10px 14px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px;
}
.mg-ht__title { font-size: 21px; font-weight: 900; letter-spacing: 1.2px; text-transform: uppercase; line-height: 1; }
.mg-ht__icons { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 8px 10px; }
.mg-ht__or { font-size: 12px; font-weight: 800; opacity: 0.45; text-transform: uppercase; }
.mg-ht__item { display: flex; flex-direction: column; align-items: center; gap: 3px; }
.mg-ht__cap { font-size: 10px; font-weight: 800; letter-spacing: 0.6px; text-transform: uppercase; opacity: 0.65; }
.mg-ht__note { font-size: 11px; font-weight: 700; opacity: 0.7; margin-top: -2px; }
.mg-ht__svg { width: 44px; height: 44px; display: block; }
.mg-ht__svg--wide { width: 60px; }
.mg-ht .ht-a { fill: var(--ht-accent); }
.mg-ht .ht-as { stroke: var(--ht-accent); }
.mg-ht .ht-f { fill: color-mix(in srgb, currentColor 10%, transparent); }
.mg-kgrid { display: grid; grid-template-columns: repeat(3, auto); gap: 3px; justify-content: center; }
.mg-krow { display: flex; gap: 3px; }
.mg-kc {
  min-width: 26px; height: 26px; padding: 0 5px; box-sizing: border-box;
  display: inline-flex; align-items: center; justify-content: center;
  background: color-mix(in srgb, currentColor 10%, transparent); color: inherit;
  border: 2px solid currentColor; border-radius: 6px; box-shadow: 0 2.5px 0 currentColor;
  font-size: 13px; font-weight: 900; line-height: 1; font-family: inherit;
}
.mg-kc--wide { padding: 0 12px; font-size: 11px; letter-spacing: 1px; }
.mg-kc--space { min-width: 96px; }
.mg-kc--blank { visibility: hidden; }
.mg-kc svg { width: 11px; height: 11px; display: block; fill: currentColor; }
.mg-hb {
  display: inline-flex; align-items: center; justify-content: center; padding: 8px 14px;
  border-radius: 10px; background: var(--ht-accent); color: #111; border: 2px solid currentColor;
  font-size: 12px; font-weight: 900; letter-spacing: 1.2px;
}
/* Version chica: la pantalla de inicio de cada juego ya tiene su titulo, su texto y
   el "toca para empezar", asi que las tarjetas tienen que ocupar poco. */
.mg-ht--compact { margin: 12px auto 4px; max-width: 560px; width: 100%; }
.mg-ht--compact .mg-ht__grid { gap: 8px; }
/* El blur separa las tarjetas de la escena que se ve detras en los juegos cuya
   pantalla de inicio es transparente (Skyline, Bounce Rush). */
.mg-ht--compact .mg-ht__card {
  flex-basis: 160px; padding: 8px 8px 9px; gap: 6px; border-radius: 12px;
  background: color-mix(in srgb, currentColor 10%, transparent);
  -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px);
}
.mg-ht--compact .mg-ht__title { font-size: 15px; letter-spacing: 1px; }
.mg-ht--compact .mg-ht__svg { width: 34px; height: 34px; }
.mg-ht--compact .mg-ht__svg--wide { width: 46px; }
.mg-ht--compact .mg-kc { min-width: 22px; height: 22px; font-size: 11px; border-width: 1.5px; box-shadow: 0 2px 0 currentColor; }
.mg-ht--compact .mg-kc--space { min-width: 76px; }
.mg-ht--compact .mg-hb { padding: 6px 10px; font-size: 10px; }
.mg-ht--compact .mg-ht__or { font-size: 10px; }
.mg-ht--compact .mg-ht__cap { font-size: 9px; }
.mg-ht--compact .mg-ht__note { font-size: 10px; }
`;

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.append(style);
}

/** Flecha de tecla, apuntando hacia arriba y rotada segun la direccion. */
function arrowSvg(rot: number): string {
  return `<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M6 1.5 11 9.5H1Z" transform="rotate(${rot} 6 6)"/></svg>`;
}

function cap(content: string, extra = ""): string {
  return `<span class="mg-kc${extra ? ` ${extra}` : ""}">${content}</span>`;
}

const UP = arrowSvg(0);
const RIGHT = arrowSvg(90);
const DOWN = arrowSvg(180);
const LEFT = arrowSvg(270);

/** Grupo de cuatro teclas en cruz: una arriba al medio y tres abajo. */
function cross(up: string, left: string, down: string, right: string): string {
  return `<span class="mg-kgrid">${cap("", "mg-kc--blank")}${cap(up)}${cap("", "mg-kc--blank")}${cap(left)}${cap(down)}${cap(right)}</span>`;
}

function row(...caps: string[]): string {
  return `<span class="mg-krow">${caps.map((c) => cap(c)).join("")}</span>`;
}

function svg(body: string, wide = false): string {
  const vb = wide ? "0 0 60 44" : "0 0 44 44";
  return `<svg class="mg-ht__svg${wide ? " mg-ht__svg--wide" : ""}" viewBox="${vb}" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

const MOUSE_BODY = `<rect x="12" y="4" width="20" height="34" rx="10"/><path d="M22 4v11M12 15h20"/>`;
const MOUSE_LEFT = `<path class="ht-a" d="M22 4a10 10 0 0 0-10 10v1h10Z"/>`;
/** Mano con el indice para arriba (la punta del dedo en ~(21, 6)). */
const FINGER = `<path class="ht-f" d="M17 25V10a4 4 0 0 1 8 0v10l6.5 1.4a4 4 0 0 1 3.1 4.5L33.4 35a5 5 0 0 1-5 4.2H21a5 5 0 0 1-4-2l-5.6-7.6a3 3 0 0 1 4.6-3.8Z"/>`;

function iconHtml(icon: HowToIcon): { html: string; caption: string } {
  if (icon.startsWith("key:")) return { html: cap(escapeHtml(icon.slice(4))), caption: "" };
  if (icon.startsWith("keys:")) return { html: row(...icon.slice(5).split(" ").filter(Boolean).map(escapeHtml)), caption: "" };
  if (icon.startsWith("btn:")) return { html: `<span class="mg-hb">${escapeHtml(icon.slice(4))}</span>`, caption: "en pantalla" };
  switch (icon) {
    case "wasd":
      return { html: cross("W", "A", "S", "D"), caption: "" };
    case "arrows":
      return { html: cross(UP, LEFT, DOWN, RIGHT), caption: "" };
    case "ad":
      return { html: row("A", "D"), caption: "" };
    case "arrows-lr":
      return { html: row(LEFT, RIGHT), caption: "" };
    case "ws":
      return { html: row("W", "S"), caption: "" };
    case "arrows-ud":
      return { html: row(UP, DOWN), caption: "" };
    case "arrow-up":
      return { html: row(UP), caption: "" };
    case "arrow-down":
      return { html: row(DOWN), caption: "" };
    case "space":
      return { html: cap("ESPACIO", "mg-kc--wide mg-kc--space"), caption: "" };
    case "enter":
      return { html: cap("ENTER", "mg-kc--wide"), caption: "" };
    case "esc":
      return { html: cap("ESC", "mg-kc--wide"), caption: "" };
    case "keyboard":
      return {
        html: svg(
          `<rect x="4" y="11" width="36" height="23" rx="3"/><path d="M10 17h2M16 17h2M22 17h2M28 17h2M34 17h0M10 22h2M16 22h2M22 22h2M28 22h2M14 28h16" stroke-width="2.2"/>`,
        ),
        caption: "teclado",
      };
    case "click":
      return { html: svg(`${MOUSE_BODY}${MOUSE_LEFT}`), caption: "clic" };
    case "mouse":
      return {
        html: svg(`<g transform="translate(8 0)">${MOUSE_BODY}</g><path d="M9 16c-3 3-3 9 0 12M4 13c-5 5-5 13 0 18M51 16c3 3 3 9 0 12M56 13c5 5 5 13 0 18" stroke-width="2.2"/>`, true),
        caption: "mouse",
      };
    case "drag":
      return {
        html: svg(`<g transform="translate(-2 0)">${MOUSE_BODY}${MOUSE_LEFT}</g><path class="ht-as" d="M38 22h18m-5-5 5 5-5 5" stroke-width="3"/>`, true),
        caption: "arrastrá",
      };
    case "wheel":
      return { html: svg(`${MOUSE_BODY}<rect class="ht-a" x="20" y="7" width="4" height="8" rx="2" stroke="none"/>`), caption: "rueda" };
    case "tap":
      return {
        html: svg(`<path class="ht-as" d="M12.5 8.5a9 9 0 0 1 3.5-5M29.5 8.5a9 9 0 0 0-3.5-5" stroke-width="2.6"/>${FINGER}`),
        caption: "tocá",
      };
    case "hold":
      return {
        html: svg(`<circle class="ht-a" cx="21" cy="7" r="6.5" stroke="none" opacity="0.55"/>${FINGER}`),
        caption: "mantené",
      };
    case "swipe":
      return {
        html: svg(`<g transform="translate(9 3)">${FINGER}</g><path class="ht-as" d="M6 6h48m-5-4 5 4-5 4M11 2 6 6l5 4" stroke-width="2.6"/>`, true),
        caption: "arrastrá",
      };
    case "tap-sides":
      return {
        html: svg(
          `<rect x="13" y="3" width="34" height="38" rx="5"/><path d="M30 8v28" stroke-dasharray="3 3" stroke-width="2"/><path class="ht-as" d="M22 22h-5m3-3-3 3 3 3M38 22h5m-3-3 3 3-3 3" stroke-width="2.6"/>`,
          true,
        ),
        caption: "tocá un lado",
      };
    case "joystick":
      return { html: svg(`<circle cx="22" cy="22" r="16"/><circle class="ht-a" cx="26" cy="18" r="7"/>`), caption: "joystick" };
    case "mic":
      return {
        html: svg(`<rect class="ht-a" x="16" y="4" width="12" height="20" rx="6"/><path d="M11 20a11 11 0 0 0 22 0M22 31v7M16 38h12"/>`),
        caption: "tu voz",
      };
    case "headphones":
      return {
        html: svg(`<path d="M8 29v-6a14 14 0 0 1 28 0v6"/><rect class="ht-a" x="5" y="26" width="8" height="12" rx="3"/><rect class="ht-a" x="31" y="26" width="8" height="12" rx="3"/>`),
        caption: "auriculares",
      };
  }
  return { html: "", caption: "" };
}

/**
 * Arma el bloque. `intro: false` lo omite (la pantalla de inicio de cada juego ya
 * tiene su propio texto); `compact` achica las tarjetas.
 */
export function renderHowTo(howTo: HowTo, opts: { intro?: boolean; compact?: boolean } = {}): HTMLElement {
  ensureStyles();
  const root = document.createElement("div");
  root.className = `mg-ht${opts.compact ? " mg-ht--compact" : ""}`;
  if (howTo.intro && opts.intro !== false) {
    const intro = document.createElement("p");
    intro.className = "mg-ht__intro";
    intro.textContent = howTo.intro;
    root.append(intro);
  }
  const grid = document.createElement("div");
  grid.className = "mg-ht__grid";
  for (const action of howTo.actions) {
    const card = document.createElement("div");
    card.className = "mg-ht__card";
    const title = document.createElement("div");
    title.className = "mg-ht__title";
    title.textContent = action.title;
    const icons = document.createElement("div");
    icons.className = "mg-ht__icons";
    icons.innerHTML = action.icons
      .map((icon) => {
        const { html, caption } = iconHtml(icon);
        return `<span class="mg-ht__item">${html}${caption ? `<span class="mg-ht__cap">${caption}</span>` : ""}</span>`;
      })
      .join(`<span class="mg-ht__or">o</span>`);
    card.append(title, icons);
    if (action.note) {
      const note = document.createElement("div");
      note.className = "mg-ht__note";
      note.textContent = action.note;
      card.append(note);
    }
    grid.append(card);
  }
  root.append(grid);
  return root;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
}
