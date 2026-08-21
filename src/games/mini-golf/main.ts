import "./style.css";
import { Game } from "./game/Game";

const app = document.getElementById("app");
if (app) new Game(app);
