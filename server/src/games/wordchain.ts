import type { Server } from "socket.io";
import { checkChainWord, hasInitial, randomInitial } from "../dictionary.js";
import { GameRoom, registerGame, type RoomSim } from "../rooms.js";
import type { WcEmoteId, WcGameover, WcPlayerView, WcState } from "../protocol.js";

/**
 * Cadena de Palabras: fork de Bomba Palabra con otra mecanica. Al primer jugador le
 * toca una letra al azar y tiene que escribir una palabra real que EMPIECE con ella;
 * la ULTIMA letra de esa palabra es el reto del siguiente ("tronco" -> "o"). Y asi la
 * cadena da la vuelta a la mesa. Una sola vida: si se te acaba el reloj, quedas
 * eliminado en el acto. Gana el ultimo en pie.
 *
 * El server es autoritativo (turno, reloj, validacion contra el diccionario, palabras
 * usadas) y difunde `wc:state` en cada cambio; los clientes animan el anillo del reloj
 * localmente entre snapshots. El deadline de ronda de Supabase sigue siendo el corte
 * duro; normalmente la partida termina por eliminacion antes.
 */

/** Una sola vida: un timeout te elimina. Es la diferencia central con Bomba Palabra. */
const STARTING_LIVES = 1;
/** Reloj del turno; se acorta con cada eslabon forjado, con piso CLOCK_MIN. */
const CLOCK_BASE_MS = 12000;
const CLOCK_STEP_MS = 200;
const CLOCK_MIN_MS = 5000;
/** Espera desde el primer jugador para que se conecten los del roster antes de
 * arrancar (los que falten quedan afuera y miran). */
const START_GRACE_MS = 8000;
/**
 * Reacciones permitidas. Allowlist cerrado: el cliente manda un id, no un glifo, y
 * cada id se dibuja como una cara del personaje. Debe coincidir con `EMOTES` en
 * `src/games/word-chain/game/constants.ts` (tipos duplicados por la regla de
 * decoupling del repo).
 */
const EMOTES: ReadonlySet<string> = new Set<WcEmoteId>([
  "risa",
  "sorpresa",
  "enojo",
  "burla",
  "llanto",
]);
/** Una reaccion por jugador cada tanto: sin esto la mesa se llena de spam. */
const EMOTE_COOLDOWN_MS = 1000;

interface Player {
  nickname: string;
  lives: number;
  alive: boolean;
  /** Eslabones forjados por este jugador (palabras aceptadas). */
  links: number;
}

/** El reloj se acorta a medida que la cadena crece: la mesa se acelera sola. */
function clockFor(chainLength: number): number {
  return Math.max(CLOCK_MIN_MS, CLOCK_BASE_MS - chainLength * CLOCK_STEP_MS);
}

class WordChainSim implements RoomSim {
  private phase: "waiting" | "playing" | "over" = "waiting";
  private players: Player[] = [];
  private roster: string[] = [];
  private turnIdx = 0;
  /** Letra con la que debe empezar la palabra del turno actual. */
  private letter: string | null = null;
  private deadline: number | null = null;
  /** Duracion del reloj del turno actual (para que el cliente dibuje la fraccion). */
  private clockTotal = CLOCK_BASE_MS;
  private clockTimer: ReturnType<typeof setTimeout> | null = null;
  private startTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly used = new Set<string>();
  private chainLength = 0;
  private acceptSeq = 0;
  private lastAccepted: WcState["lastAccepted"] = null;
  private readonly eliminationOrder: string[] = [];
  /** Ultima reaccion aceptada por jugador (epoch ms), para el cooldown. */
  private readonly lastEmoteAt = new Map<string, number>();

  constructor(private readonly room: GameRoom) {}

  join(nickname: string, roster: string[]): void {
    if (roster.length > 0) this.roster = roster;

    if (this.phase === "waiting") {
      if (this.startTimer === null) {
        this.startTimer = setTimeout(() => this.start(), START_GRACE_MS);
      }
      // Arranca apenas esten todos los del roster conectados.
      if (this.roster.length > 0 && this.roster.every((n) => this.room.isConnected(n))) {
        this.start();
      }
    }

    this.broadcastState();
    if (this.phase === "over") this.room.emitTo(nickname, "wc:gameover", this.gameoverPayload());
  }

  leave(_nickname: string): void {
    // Desconectarse no elimina por si mismo: el reloj castiga su turno como a un AFK
    // (y con una vida, ese timeout si lo elimina). Si vuelve antes, se reengancha.
    if (this.phase !== "over") this.broadcastState();
  }

  message(nickname: string, event: string, payload: unknown): void {
    if (event === "wc:submit") {
      const word = readString(payload, "word");
      if (word !== null) this.submit(nickname, word);
    } else if (event === "wc:typing") {
      const text = readString(payload, "text");
      if (text !== null && this.phase === "playing" && this.current()?.nickname === nickname) {
        this.room.broadcast("wc:typing", { player: nickname, text: text.slice(0, 40) });
      }
    } else if (event === "wc:emote") {
      const emote = readString(payload, "emote");
      if (emote !== null) this.emote(nickname, emote);
    }
  }

  /**
   * Reaccion: puro relay, no toca el estado de la partida ni entra en `wc:state` (es
   * efimera: quien se reengancha no revive las de antes). Reacciona cualquiera y en
   * cualquier momento — tambien el eliminado, que es medio la gracia — pero solo con
   * un id del allowlist y respetando el cooldown.
   */
  private emote(nickname: string, emote: string): void {
    if (!EMOTES.has(emote)) return;
    const now = Date.now();
    const last = this.lastEmoteAt.get(nickname) ?? 0;
    if (now - last < EMOTE_COOLDOWN_MS) return;
    this.lastEmoteAt.set(nickname, now);
    this.room.broadcast("wc:emote", { player: nickname, emote });
  }

  dispose(): void {
    if (this.clockTimer !== null) clearTimeout(this.clockTimer);
    if (this.startTimer !== null) clearTimeout(this.startTimer);
  }

  // ---------- Ciclo de partida ----------

  private start(): void {
    if (this.phase !== "waiting") return;
    if (this.startTimer !== null) {
      clearTimeout(this.startTimer);
      this.startTimer = null;
    }
    // Jugadores = los del roster que estan conectados, en el orden del roster
    // (joined_at de Supabase), asi todos los clientes derivan el mismo turno.
    const seats = this.roster.filter((n) => this.room.isConnected(n));
    if (seats.length === 0) return; // nadie realmente conectado; se reintenta al proximo join
    this.players = seats.map((nickname) => ({
      nickname,
      lives: STARTING_LIVES,
      alive: true,
      links: 0,
    }));
    this.phase = "playing";
    this.turnIdx = 0;
    // La primera letra se sortea entre las que tienen muchas palabras detras.
    this.newTurn(randomInitial());
  }

  /** Abre el turno con la letra dada y arranca el reloj. */
  private newTurn(letter: string): void {
    this.letter = letter;
    this.clockTotal = clockFor(this.chainLength);
    this.deadline = Date.now() + this.clockTotal;
    this.armClock();
    this.broadcastState();
  }

  private armClock(): void {
    if (this.clockTimer !== null) clearTimeout(this.clockTimer);
    const ms = this.deadline !== null ? this.deadline - Date.now() : CLOCK_BASE_MS;
    this.clockTimer = setTimeout(() => this.onClockExpire(), Math.max(0, ms));
  }

  /** Se acabo el tiempo: con una sola vida, el jugador de turno queda eliminado. */
  private onClockExpire(): void {
    if (this.phase !== "playing") return;
    const player = this.current();
    if (!player) return;
    player.lives -= 1;
    if (player.lives <= 0) {
      player.alive = false;
      this.eliminationOrder.push(player.nickname);
    }
    if (this.aliveCount() <= 1) {
      this.finish();
      return;
    }
    // La cadena no avanzo: el siguiente hereda la misma letra que mato al anterior.
    this.advanceTurn();
    this.newTurn(this.letter ?? randomInitial());
  }

  private submit(nickname: string, word: string): void {
    if (this.phase !== "playing") return;
    const player = this.current();
    if (!player || player.nickname !== nickname) {
      this.room.emitTo(nickname, "wc:invalid", { reason: "not-your-turn" });
      return;
    }
    const { result, normalized } = checkChainWord(word, this.letter ?? "");
    if (result !== "ok") {
      this.room.emitTo(nickname, "wc:invalid", { reason: result });
      return;
    }
    if (this.used.has(normalized)) {
      this.room.emitTo(nickname, "wc:invalid", { reason: "already-used" });
      return;
    }
    // Eslabon forjado: se acepta, y su ULTIMA letra es el reto del siguiente.
    this.used.add(normalized);
    this.chainLength += 1;
    this.acceptSeq += 1;
    player.links += 1;
    this.lastAccepted = { player: nickname, word: normalized, seq: this.acceptSeq };
    // Las letras pobres se juegan igual (fax -> x): es parte del riesgo. Solo se
    // sortea otra si la letra no tiene NINGUNA palabra detras, que dejaria la cadena
    // muerta y no seria un reto sino un bug.
    const next = normalized[normalized.length - 1];
    this.advanceTurn();
    this.newTurn(hasInitial(next) ? next : randomInitial());
  }

  private finish(): void {
    this.phase = "over";
    this.letter = null;
    this.deadline = null;
    if (this.clockTimer !== null) {
      clearTimeout(this.clockTimer);
      this.clockTimer = null;
    }
    this.broadcastState();
    this.room.broadcast("wc:gameover", this.gameoverPayload());
  }

  // ---------- Helpers ----------

  private current(): Player | null {
    return this.players[this.turnIdx] ?? null;
  }

  private aliveCount(): number {
    return this.players.filter((p) => p.alive).length;
  }

  private advanceTurn(): void {
    if (this.players.length === 0) return;
    for (let i = 0; i < this.players.length; i++) {
      this.turnIdx = (this.turnIdx + 1) % this.players.length;
      if (this.players[this.turnIdx].alive) return;
    }
  }

  private playerViews(): WcPlayerView[] {
    return this.players.map((p) => ({
      nickname: p.nickname,
      alive: p.alive,
      connected: this.room.isConnected(p.nickname),
      links: p.links,
    }));
  }

  private broadcastState(): void {
    const clockMs = this.deadline !== null ? Math.max(0, this.deadline - Date.now()) : null;
    const state: WcState = {
      phase: this.phase,
      turn: this.phase === "playing" ? this.current()?.nickname ?? null : null,
      letter: this.letter,
      deadline: this.deadline,
      clockMs,
      clockTotalMs: this.deadline !== null ? this.clockTotal : null,
      players: this.playerViews(),
      chainLength: this.chainLength,
      lastAccepted: this.lastAccepted,
    };
    this.room.broadcast("wc:state", state);
  }

  private gameoverPayload(): WcGameover {
    const survivors = this.players.filter((p) => p.alive).map((p) => p.nickname);
    // Los eliminados mas tarde quedan mejor rankeados (2do, 3ro, ...).
    const eliminated = [...this.eliminationOrder].reverse();
    const order = [...survivors, ...eliminated];
    return { ranking: order.map((nickname, i) => ({ nickname, place: i + 1 })) };
  }
}

function readString(payload: unknown, key: string): string | null {
  if (payload && typeof payload === "object" && key in payload) {
    const v = (payload as Record<string, unknown>)[key];
    if (typeof v === "string") return v;
  }
  return null;
}

/** Roster + nickname del mensaje de join. */
function parseJoin(payload: unknown): { nickname: string; roster: string[] } | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  const nickname = typeof p.nickname === "string" ? p.nickname : null;
  if (!nickname) return null;
  const roster = Array.isArray(p.roster)
    ? p.roster.filter((x): x is string => typeof x === "string")
    : [];
  return { nickname, roster };
}

/** Engancha el juego en el namespace `/wordchain`. */
export function registerWordChain(io: Server): void {
  registerGame(io, "/wordchain", "wc:join", parseJoin, (room) => new WordChainSim(room));
}
