import "./style.css";
import { Game } from "./game/Game";

const app = document.querySelector<HTMLDivElement>("#app")!;
// El letrero del casino se pinta en canvas con Monoton: se esperan las fuentes (con tope).
const fonts = ["400 40px Monoton", "400 40px Bungee", "400 16px Righteous"];
const ready = document.fonts?.load
  ? Promise.race([Promise.all(fonts.map((f) => document.fonts.load(f))), new Promise((r) => setTimeout(r, 1800))])
  : Promise.resolve();
void ready.then(() => new Game(app));
