import "./style.css";
import { initPhysics } from "./game/physics";
import { Game } from "./game/Game";

const app = document.querySelector<HTMLDivElement>("#app")!;

// Rapier compila a WASM: hay que inicializarlo antes de crear el mundo.
void initPhysics().then(() => new Game(app));
