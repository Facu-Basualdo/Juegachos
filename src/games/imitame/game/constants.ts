import type { EffectId } from "./ImitameTransport";

/** Etiquetas y paso del countdown 3/2/1/YA compartido con todo el repo. */
export const COUNTDOWN_LABELS = ["3", "2", "1", "YA"] as const;
export const COUNTDOWN_STEP = 700;

/**
 * Ventana de grabacion de cada toma. **Espeja `RECORD_MS` de
 * `server/src/games/imitame.ts`**: el server abre la fase `record` con ese largo y
 * el cliente corta su grabacion con su propio timer (no con el deadline del server),
 * asi la latencia no le come segundos a nadie.
 */
export const RECORD_MS = 4500;

/** "3 / 2 / 1" antes de grabar: la fase `ready` del server dura esto x3. Espeja `READY_MS`. */
export const READY_STEP_MS = 1000;

/** Antes de cada toma, el micro vuela a la cara del que le toca. Espeja `PRE_SLOT_MS` del server. */
export const PRE_SLOT_MS = 1500;

/** Tasa a la que se baja la toma antes de analizarla y mandarla (voz: sobra). */
export const TAKE_TARGET_RATE = 11025;

/** Tope de bytes de una toma (mu-law, 1 byte por muestra). Espeja `MAX_TAKE_BYTES` del server. */
export const MAX_TAKE_BYTES = 80000;

/**
 * Lo que puede salir en la ruleta. `mult` multiplica el puntaje crudo de la PROXIMA
 * toma del que le toco. Los multiplicadores **espejan `EFFECTS` del server** (el
 * arbitro es el server; aca solo se muestran). El orden de la lista es el orden de
 * las porciones de la ruleta.
 */
export const EFFECTS: Record<
  EffectId,
  { label: string; short: string; mult: number; kind: "bonus" | "sabotage" | "none"; color: string }
> = {
  doble: { label: "Puntos dobles", short: "x2", mult: 2, kind: "bonus", color: "#ffd23f" },
  eco: { label: "Eco", short: "ECO", mult: 0.8, kind: "sabotage", color: "#35d6e8" },
  mas: { label: "Puntos y medio", short: "x1.5", mult: 1.5, kind: "bonus", color: "#8be04e" },
  saturado: { label: "Saturado", short: "SATURA", mult: 0.8, kind: "sabotage", color: "#ff8a3d" },
  salvado: { label: "Se salvo", short: "NADA", mult: 1, kind: "none", color: "#fff4e0" },
  helio: { label: "Voz de helio", short: "HELIO", mult: 0.8, kind: "sabotage", color: "#b388ff" },
  cortado: { label: "Cortado", short: "CORTE", mult: 0.7, kind: "sabotage", color: "#ff4f9a" },
  pedo: { label: "Te lo cambian por un pedo", short: "PEDO", mult: 0.5, kind: "sabotage", color: "#a0773a" },
};

export const WHEEL_ORDER = Object.keys(EFFECTS) as EffectId[];
