import "./style.css";
import { Game } from "./game/Game";

const app = document.querySelector<HTMLDivElement>("#app")!;
// Los rotulos van en Cinzel: se espera la fuente (con tope) para no pintar con la de reemplazo.
const ready = document.fonts?.load ? Promise.race([document.fonts.load("600 16px Cinzel"), new Promise((r) => setTimeout(r, 1500))]) : Promise.resolve();
void ready.then(() => new Game(app));
