import "./style.css";
import { startDevHub } from "./game/devRoom";
import { Hub } from "./game/Hub";

/**
 * La Feria: la sala 3D. Ver CLAUDE.md y DESIGN.md de esta carpeta, y
 * `src/shared/room/hub.ts` para como se engancha con el resto de las salas.
 */
const app = document.querySelector<HTMLDivElement>("#app")!;

function start(): void {
  const hub = new Hub(app);
  // `?dev=` va primero: tambien trae `code`, y no tiene que abrir una sala real.
  if (!startDevHub(hub) && !hub.startRoom()) hub.showNoRoom();
}

// Los carteles de la escena (titulos de los afiches, LISTO, LA TORRE) se pintan en
// canvas una sola vez: si la fuente del HUD todavia no cargo, quedan con la de
// reemplazo. Se espera la fuente, con un tope para no colgar la pagina sin red.
let started = false;
const go = (): void => {
  if (started) return;
  started = true;
  start();
};
window.setTimeout(go, 1500);
void document.fonts
  .load("32px 'VT323'")
  .catch(() => undefined)
  .then(go);
