import type { HowTo, HowToIcon } from "../howto";

/**
 * Dibuja un `HowTo` (ver `src/shared/howto.ts`) para el briefing de la sala: la
 * intro de dos renglones y una tarjeta por accion con su titulo grande y los iconos
 * abajo. Las teclas son HTML (tapitas con sombra) y el mouse, el dedo, el joystick y
 * compañia son SVG inline: nada de emojis ni imagenes sueltas, y el color sale de la
 * misma paleta del RoomOverlay (tinta #111 sobre crema, acento cyan).
 */

/** Estilos: el RoomOverlay los suma a los suyos (se inyectan una sola vez). */
export const HOWTO_CSS = `
.mg-room__box--wide { max-width: 620px; }
.mg-howto { margin: 0 0 16px; }
.mg-howto__intro {
  font-size: 15px; font-weight: 600; line-height: 1.4; color: #3d3b31;
  margin: 0 auto 14px; max-width: 480px;
}
/* Flex y no grid: con un numero impar de acciones la ultima ocupa su fila entera en
   vez de dejar un hueco al lado. */
.mg-howto__grid { display: flex; flex-wrap: wrap; justify-content: center; gap: 10px; }
.mg-howto__card {
  flex: 1 1 230px; min-width: 0; box-sizing: border-box;
  background: #ffffff; border: 2px solid rgba(17, 17, 17, 0.14); border-radius: 14px;
  padding: 12px 10px 14px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px;
}
.mg-howto__title {
  font-size: 21px; font-weight: 900; letter-spacing: 1.2px; text-transform: uppercase; line-height: 1;
}
.mg-howto__icons { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 8px 10px; }
.mg-howto__or { font-size: 12px; font-weight: 800; color: #9a988a; text-transform: uppercase; }
.mg-howto__item { display: flex; flex-direction: column; align-items: center; gap: 3px; }
.mg-howto__cap { font-size: 10px; font-weight: 800; letter-spacing: 0.6px; text-transform: uppercase; color: #6f6d5e; }
.mg-howto__note { font-size: 11px; font-weight: 700; color: #6f6d5e; margin-top: -2px; }
.mg-howto__svg { width: 44px; height: 44px; display: block; }
.mg-howto__svg--wide { width: 60px; }
/* Celu: la caja ancha pierde relleno y las tarjetas se compactan, asi entran hasta
   cuatro acciones sin scroll y la intro queda en dos renglones. */
@media (max-width: 480px) {
  .mg-room__box--wide { padding: 20px 14px; }
  .mg-howto__intro { font-size: 14px; margin-bottom: 12px; }
  .mg-howto__grid { gap: 8px; }
  .mg-howto__card { padding: 9px 8px 10px; gap: 7px; }
  .mg-howto__title { font-size: 18px; }
}
.mg-kgrid { display: grid; grid-template-columns: repeat(3, auto); gap: 3px; justify-content: center; }
.mg-krow { display: flex; gap: 3px; }
.mg-kc {
  min-width: 26px; height: 26px; padding: 0 5px; box-sizing: border-box;
  display: inline-flex; align-items: center; justify-content: center;
  background: #ffffff; border: 2px solid #111; border-radius: 6px; box-shadow: 0 2.5px 0 #111;
  font-size: 13px; font-weight: 900; color: #111; line-height: 1;
}
.mg-kc--wide { padding: 0 12px; font-size: 11px; letter-spacing: 1px; }
.mg-kc--space { min-width: 96px; }
.mg-kc--blank { visibility: hidden; }
.mg-kc svg { width: 11px; height: 11px; display: block; }
.mg-hb {
  display: inline-flex; align-items: center; justify-content: center; padding: 8px 14px;
  border-radius: 10px; background: #111; color: #efeee6; border: 2px solid #111;
  font-size: 12px; font-weight: 900; letter-spacing: 1.2px;
}
`;

const ACCENT = "#00c2d6";
const INK = "#111";

/** Flecha de tecla, apuntando hacia arriba y rotada segun la direccion. */
function arrowSvg(rot: number): string {
  return `<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M6 1.5 11 9.5H1Z" fill="${INK}" transform="rotate(${rot} 6 6)"/></svg>`;
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
  return `<svg class="mg-howto__svg${wide ? " mg-howto__svg--wide" : ""}" viewBox="${vb}" fill="none" stroke="${INK}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

const MOUSE_BODY = `<rect x="12" y="4" width="20" height="34" rx="10"/><path d="M22 4v11M12 15h20"/>`;
/** Mano con el indice para arriba (la punta del dedo en ~(21, 6)). */
const FINGER = `<path d="M17 25V10a4 4 0 0 1 8 0v10l6.5 1.4a4 4 0 0 1 3.1 4.5L33.4 35a5 5 0 0 1-5 4.2H21a5 5 0 0 1-4-2l-5.6-7.6a3 3 0 0 1 4.6-3.8Z" fill="#ffffff"/>`;

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
      return {
        html: svg(`${MOUSE_BODY}<path d="M22 4a10 10 0 0 0-10 10v1h10Z" fill="${ACCENT}"/>`),
        caption: "clic",
      };
    case "mouse":
      return {
        html: svg(`<g transform="translate(8 0)">${MOUSE_BODY}</g><path d="M9 16c-3 3-3 9 0 12M4 13c-5 5-5 13 0 18M51 16c3 3 3 9 0 12M56 13c5 5 5 13 0 18" stroke-width="2.2"/>`, true),
        caption: "mouse",
      };
    case "drag":
      return {
        html: svg(`<g transform="translate(-2 0)">${MOUSE_BODY}<path d="M22 4a10 10 0 0 0-10 10v1h10Z" fill="${ACCENT}"/></g><path d="M38 22h18m-5-5 5 5-5 5" stroke="${ACCENT}" stroke-width="3"/>`, true),
        caption: "arrastrá",
      };
    case "wheel":
      return {
        html: svg(`${MOUSE_BODY}<rect x="20" y="7" width="4" height="8" rx="2" fill="${ACCENT}" stroke="none"/>`),
        caption: "rueda",
      };
    case "tap":
      return {
        html: svg(`<path d="M12.5 8.5a9 9 0 0 1 3.5-5M29.5 8.5a9 9 0 0 0-3.5-5" stroke="${ACCENT}" stroke-width="2.6"/>${FINGER}`),
        caption: "tocá",
      };
    case "hold":
      return {
        html: svg(`<circle cx="21" cy="7" r="6.5" fill="${ACCENT}" stroke="none" opacity="0.55"/>${FINGER}`),
        caption: "mantené",
      };
    case "swipe":
      return {
        html: svg(`<g transform="translate(9 3)">${FINGER}</g><path d="M6 6h48m-5-4 5 4-5 4M11 2 6 6l5 4" stroke="${ACCENT}" stroke-width="2.6"/>`, true),
        caption: "arrastrá",
      };
    case "tap-sides":
      return {
        html: svg(
          `<rect x="13" y="3" width="34" height="38" rx="5"/><path d="M30 8v28" stroke-dasharray="3 3" stroke-width="2"/><path d="M22 22h-5m3-3-3 3 3 3M38 22h5m-3-3 3 3-3 3" stroke="${ACCENT}" stroke-width="2.6"/>`,
          true,
        ),
        caption: "tocá un lado",
      };
    case "joystick":
      return {
        html: svg(`<circle cx="22" cy="22" r="16"/><circle cx="26" cy="18" r="7" fill="${ACCENT}"/>`),
        caption: "joystick",
      };
    case "mic":
      return {
        html: svg(`<rect x="16" y="4" width="12" height="20" rx="6" fill="${ACCENT}"/><path d="M11 20a11 11 0 0 0 22 0M22 31v7M16 38h12"/>`),
        caption: "tu voz",
      };
    case "headphones":
      return {
        html: svg(`<path d="M8 29v-6a14 14 0 0 1 28 0v6"/><rect x="5" y="26" width="8" height="12" rx="3" fill="${ACCENT}"/><rect x="31" y="26" width="8" height="12" rx="3" fill="${ACCENT}"/>`),
        caption: "auriculares",
      };
  }
  return { html: "", caption: "" };
}

export function renderHowTo(howTo: HowTo): HTMLElement {
  const root = document.createElement("div");
  root.className = "mg-howto";
  if (howTo.intro) {
    const intro = document.createElement("p");
    intro.className = "mg-howto__intro";
    intro.textContent = howTo.intro;
    root.append(intro);
  }
  const grid = document.createElement("div");
  grid.className = "mg-howto__grid";
  for (const action of howTo.actions) {
    const card = document.createElement("div");
    card.className = "mg-howto__card";
    const title = document.createElement("div");
    title.className = "mg-howto__title";
    title.textContent = action.title;
    const icons = document.createElement("div");
    icons.className = "mg-howto__icons";
    icons.innerHTML = action.icons
      .map((icon) => {
        const { html, caption } = iconHtml(icon);
        return `<span class="mg-howto__item">${html}${caption ? `<span class="mg-howto__cap">${caption}</span>` : ""}</span>`;
      })
      .join(`<span class="mg-howto__or">o</span>`);
    card.append(title, icons);
    if (action.note) {
      const note = document.createElement("div");
      note.className = "mg-howto__note";
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
