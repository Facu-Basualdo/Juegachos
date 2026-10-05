import { parentPort } from "node:worker_threads";
import { chooseBotAction, type BotLevel } from "./pool-bot.js";
import type { BotView } from "./pool-match.js";
import { mulberry32 } from "./pool-rack.js";

/**
 * Hilo aparte donde piensa el bot de Poolnight (ver pool-bot-thinker.ts). Recibe la
 * vista de la mesa, el nivel y una semilla, y devuelve la accion. No guarda nada entre
 * pedidos: cada uno trae todo lo que necesita.
 */

interface ThinkRequest {
  id: number;
  view: BotView;
  level: BotLevel;
  seed: number;
}

parentPort?.on("message", (req: ThinkRequest) => {
  try {
    const action = chooseBotAction(req.view, req.level, mulberry32(req.seed));
    parentPort?.postMessage({ id: req.id, action });
  } catch (e) {
    parentPort?.postMessage({ id: req.id, error: e instanceof Error ? e.message : String(e) });
  }
});
