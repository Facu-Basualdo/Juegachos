import { Worker } from "node:worker_threads";
import { chooseBotAction, type BotAction, type BotLevel } from "./pool-bot.js";
import type { BotView } from "./pool-match.js";
import { mulberry32 } from "./pool-rack.js";

/**
 * El bot "parejo" de Poolnight simula decenas de tiros antes de elegir (medido: 3-20 ms
 * por decision en una PC de escritorio, varias veces mas en la netbook que hostea el
 * server). Node corre todas las salas en UN hilo, asi que ese calculo frenaba a la vez
 * la fisica de PONG, Manchon y el resto de las salas abiertas: un tiron visible en los
 * juegos de tiempo real cada vez que pensaba un bot. Por eso piensa en un worker.
 *
 * Un solo worker compartido por todas las salas (la maquina tiene 2 nucleos: uno para
 * el loop principal, otro para los bots). Si el worker no arranca, se cae o no contesta
 * a tiempo, el bot piensa en el hilo principal como antes: un tiron es mejor que una
 * mesa colgada esperando un tiro que no llega.
 */

/** Tope de espera de una respuesta del worker antes de pensar en el hilo principal. */
const THINK_TIMEOUT_MS = 2000;

interface Pending {
  resolve: (a: BotAction) => void;
  fallback: () => void;
  timer: ReturnType<typeof setTimeout>;
}

let worker: Worker | null = null;
/** El worker fallo: desde ahi todo se piensa en el hilo principal. */
let broken = false;
let nextId = 1;
const pending = new Map<number, Pending>();

function getWorker(): Worker | null {
  if (broken) return null;
  if (worker) return worker;
  try {
    // En dev (tsx) este archivo es .ts y el worker tambien; compilado, los dos son .js.
    const ext = import.meta.url.endsWith(".ts") ? ".ts" : ".js";
    const w = new Worker(new URL(`./pool-bot-worker${ext}`, import.meta.url));
    w.on("message", (msg: { id: number; action?: BotAction; error?: string }) => {
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.action) p.resolve(msg.action);
      else {
        console.warn(`[pool] el bot fallo en el worker: ${msg.error ?? "?"}`);
        p.fallback();
      }
    });
    const fail = (why: string): void => {
      if (broken) return;
      broken = true;
      worker = null;
      console.warn(`[pool] worker del bot caido (${why}); el bot piensa en el hilo principal`);
      for (const [id, p] of pending) {
        pending.delete(id);
        clearTimeout(p.timer);
        p.fallback();
      }
    };
    w.on("error", (e) => fail(e instanceof Error ? e.message : String(e)));
    w.on("exit", (code) => fail(`exit ${code}`));
    // Que el worker no mantenga vivo el proceso por si solo.
    w.unref();
    worker = w;
    return w;
  } catch (e) {
    broken = true;
    console.warn(`[pool] no se pudo crear el worker del bot: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

/**
 * Decide la accion del bot sin bloquear el loop principal. `seed` alimenta el azar del
 * bot (en el worker no existe el generador del sim). Nunca rechaza: ante cualquier
 * problema resuelve pensando en el hilo principal.
 */
export function thinkBot(view: BotView, level: BotLevel, seed: number): Promise<BotAction> {
  const local = (): BotAction => chooseBotAction(view, level, mulberry32(seed));
  const w = getWorker();
  if (!w) return Promise.resolve(local());

  return new Promise<BotAction>((resolve) => {
    const id = nextId++;
    const fallback = (): void => resolve(local());
    const timer = setTimeout(() => {
      if (!pending.delete(id)) return;
      console.warn("[pool] el worker del bot no contesto a tiempo; se piensa en el hilo principal");
      fallback();
    }, THINK_TIMEOUT_MS);
    pending.set(id, { resolve, fallback, timer });
    try {
      w.postMessage({ id, view, level, seed });
    } catch {
      pending.delete(id);
      clearTimeout(timer);
      fallback();
    }
  });
}
