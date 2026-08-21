import type { GameEntry } from "../../games";

export const meta: GameEntry = {
  id: "barra-libre",
  title: "Barra Libre",
  description: "Atiende las cuatro barras del bar: llena jarras, sírvelas deslizando y ataja los vasos vacíos antes de que un cliente llegue a la canilla.",
  path: "/games/barra-libre/",
  controls: "Tocá o hacé clic en cada barra para llenar las jarras, servirlas y atajar los vasos vacíos.",
  accent: "#ffb454",
  category: "Arcade",
  order: 190,
  added: "2026-07-03",
  mobile: true,

  roomTimeLimitSec: 120,
};
