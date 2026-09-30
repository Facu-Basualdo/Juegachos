import "./style.css";
import { startDevHub } from "./game/devRoom";
import { Hub } from "./game/Hub";

/**
 * La Isla: la sala 3D. Ver CLAUDE.md y DESIGN.md de esta carpeta, y
 * `src/shared/room/hub.ts` para como se engancha con el resto de las salas.
 */
const app = document.querySelector<HTMLDivElement>("#app")!;
const hub = new Hub(app);
// `?dev=` va primero: tambien trae `code`, y no tiene que abrir una sala real.
if (!startDevHub(hub) && !hub.startRoom()) hub.showNoRoom();
