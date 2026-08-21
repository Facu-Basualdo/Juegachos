/**
 * Contrato comun de los tres niveles de Hackerman. Cada nivel es un subjuego
 * autonomo (fingerprint clone, decodificador, bruteforce) que se monta en el
 * mismo contenedor del stage y avisa cuando quedo resuelto.
 *
 * El cronometro y la maquina de estados viven en `Game.ts`; el nivel solo se
 * ocupa de su propia mecanica y reporta progreso via el contexto.
 */
export interface LevelContext {
  /** El nivel quedo completamente resuelto: `Game` avanza al siguiente. */
  onSolved: () => void;
  /**
   * Un paso intermedio se completo (una senal, un codigo). `Game` lo usa para
   * persistir la partida en sala (anti-F5) y no vale como fin de nivel.
   */
  onProgress: () => void;
  /** Actualiza la linea de estado del HUD (p.ej. "SENAL 2/6"). */
  setStatus: (text: string) => void;
}

export interface HackLevel {
  /** Id corto (para snapshots / debug). */
  readonly id: string;
  /** Titulo mostrado en el HUD y el banner del nivel. */
  readonly title: string;
  /** Una linea de "como se juega" para el banner del nivel. */
  readonly controls: string;
  /** Construye el DOM del nivel dentro de `host`. */
  mount(host: HTMLElement): void;
  /** (Re)genera el puzzle y arranca desde cero. */
  begin(): void;
  /**
   * Avance por frame (segundos). Opcional: solo lo implementan los niveles con
   * animacion propia (p.ej. BruteForce, cuyas columnas scrollean). `Game` lo
   * llama en cada tick mientras el nivel esta activo.
   */
  update?(dt: number): void;
  /** Input de teclado (solo se llama mientras el nivel esta activo). */
  handleKey(e: KeyboardEvent): void;
  /** Permite sincronizar y mostrar el tiempo acumulado de la corrida dentro de la interfaz del nivel. */
  updateTime?(centis: number): void;
  /** Libera timers / listeners propios. El DOM lo limpia `Game` vaciando el host. */
  destroy(): void;
}

/** PRNG deterministico (mulberry32) para generar los puzzles. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
