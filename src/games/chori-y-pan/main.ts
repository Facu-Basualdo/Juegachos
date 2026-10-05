import "./style.css";
import { Game } from "./game/Game";

const app = document.querySelector<HTMLDivElement>("#app")!;
// Se esperan las fuentes (con tope). Un error de fuentes no puede frenar el juego:
// por eso cada carga atrapa su propio rechazo.
const fonts = ['400 40px "Luckiest Guy"', '400 16px "Baloo 2"'];
const ready = document.fonts?.load
  ? Promise.race([Promise.all(fonts.map((f) => document.fonts.load(f).catch(() => []))), new Promise((r) => setTimeout(r, 1500))])
  : Promise.resolve();
void ready.then(() => new Game(app));
