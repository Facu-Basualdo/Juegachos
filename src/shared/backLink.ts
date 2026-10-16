/**
 * Boton "volver al menu" generico de todos los juegos. Lo carga cada
 * `games/<id>/index.html`, al lado del link que ya trae el HTML:
 *
 *   <a href="/" class="mg-back">&larr; menú</a>
 *   <script type="module" src="/src/shared/backLink.ts"></script>
 *
 * El `<a>` vive en el HTML y no lo crea este modulo: asi el link existe sin
 * JavaScript. Este modulo le pone el estilo (la pastilla de la landing, la misma
 * en todos los juegos, con la paleta hardcodeada como el `RoomOverlay`) y, en una
 * sala, lo convierte en "salir de la sala" con confirmacion.
 *
 * Posicion: arriba a la izquierda. Un juego que tiene su HUD ahi lo mueve desde
 * su propio `style.css` con las variables `--mg-back-top` / `--mg-back-left` /
 * `--mg-back-right` / `--mg-back-bottom` sobre `:root` (pisar la regla `.mg-back`
 * no sirve: este CSS se inyecta despues que el del juego).
 */

const STYLE_ID = "mg-back-styles";

const CSS = `
.mg-back {
  position: fixed;
  top: var(--mg-back-top, 12px);
  left: var(--mg-back-left, 12px);
  right: var(--mg-back-right, auto);
  bottom: var(--mg-back-bottom, auto);
  z-index: 10001;
  display: inline-flex; align-items: center; gap: 8px;
  padding: 6px 13px; border-radius: 999px;
  border: 2px solid #111; background: #efeee6; color: #111;
  font-family: "Archivo", "Helvetica Neue", Arial, sans-serif;
  font-size: 12px; font-weight: 800; letter-spacing: 1px; line-height: 1.2;
  text-decoration: none; text-transform: lowercase; white-space: nowrap;
  box-shadow: 0 3px 0 -1px rgba(17, 17, 17, 0.25);
  -webkit-tap-highlight-color: transparent; user-select: none;
  transition: background 0.15s ease, color 0.15s ease, transform 0.12s ease;
}
.mg-back:hover { background: #111; color: #efeee6; }
.mg-back:active { transform: translateY(1px); }
.mg-back:focus-visible { outline: 3px solid #00f0ff; outline-offset: 2px; }
.mg-back[hidden] { display: none; }
.mg-back--confirm, .mg-back--confirm:hover { background: #efeee6; color: #111; cursor: default; }
.mg-back__btn {
  padding: 3px 10px; border-radius: 999px; border: 2px solid #111;
  background: none; color: #111; font: inherit; text-transform: inherit; cursor: pointer;
}
.mg-back__btn:hover { background: #111; color: #efeee6; }
.mg-back__btn--yes { background: #111; color: #efeee6; }
.mg-back__btn--yes:hover { background: #c81d4a; border-color: #c81d4a; }
`;

/** Cuanto queda abierta la confirmacion sin tocar nada antes de volver a cerrarse. */
const CONFIRM_MS = 5000;

function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}

function inRoom(): boolean {
  return new URLSearchParams(window.location.search).has("room");
}

function wireRoomExit(link: HTMLAnchorElement): void {
  link.textContent = "← salir de la sala";

  // La confirmacion es un panel aparte, no botones adentro del <a>.
  const panel = document.createElement("div");
  panel.className = "mg-back mg-back--confirm";
  panel.setAttribute("role", "group");
  panel.hidden = true;
  const ask = document.createElement("span");
  ask.textContent = "¿salir de la sala?";
  const yes = makeButton("salir", "mg-back__btn mg-back__btn--yes");
  const no = makeButton("seguir", "mg-back__btn");
  panel.append(ask, yes, no);
  stopGameInput(panel);
  link.after(panel);

  let timer = 0;
  const close = (): void => {
    window.clearTimeout(timer);
    panel.hidden = true;
    link.hidden = false;
  };

  link.addEventListener("click", (e) => {
    e.preventDefault();
    link.hidden = true;
    panel.hidden = false;
    no.focus();
    timer = window.setTimeout(close, CONFIRM_MS);
  });
  yes.addEventListener("click", () => {
    window.location.href = link.href;
  });
  no.addEventListener("click", () => {
    close();
    no.blur();
  });
}

function makeButton(text: string, className: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = text;
  return button;
}

/**
 * Los juegos escuchan el toque y las teclas de arranque en window / el container:
 * tocar el boton (o apretar Enter con el foco en el) no puede, ademas, arrancar o
 * reiniciar la partida.
 */
function stopGameInput(el: HTMLElement): void {
  for (const type of ["pointerdown", "mousedown", "touchstart", "keydown"] as const) {
    el.addEventListener(type, (e) => e.stopPropagation(), { passive: true });
  }
}

function mount(): void {
  const link = document.querySelector<HTMLAnchorElement>("a.mg-back");
  if (!link) return;
  injectStyles();
  stopGameInput(link);
  if (inRoom()) wireRoomExit(link);
}

mount();
