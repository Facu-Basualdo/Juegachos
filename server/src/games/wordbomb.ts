import type { Server } from "socket.io";
import { checkWord, randomFragment } from "../dictionary.js";
import { GameRoom, registerGame, type RoomSim } from "../rooms.js";
import type { WbEmoteId, WbGameover, WbPlayerView, WbState } from "../protocol.js";

/**
 * Bomba Palabra: por turnos, aparece un fragmento (silaba/combo) y el jugador de
 * turno tiene hasta que se agote la mecha para escribir una palabra real que lo
 * contenga y no se haya usado. Si la mecha explota pierde una vida; al quedarse
 * sin vidas queda eliminado. Gana el ultimo en pie.
 *
 * El server es autoritativo (turno, mecha, vidas, validacion contra el
 * diccionario) y difunde `wb:state` en cada cambio; los clientes animan la mecha
 * localmente entre snapshots. El deadline de ronda de Supabase sigue siendo el
 * corte duro; normalmente la partida termina por eliminacion antes.
 */

/** Vidas iniciales por jugador. */
const STARTING_LIVES = 3;
/** Mecha base; se acorta a medida que avanza la partida (piso FUSE_MIN). */
const FUSE_BASE_MS = 13000;
const FUSE_STEP_MS = 150;
const FUSE_MIN_MS = 6000;
/** Espera desde el primer jugador para que se conecten los del roster antes de
 * arrancar (los que falten quedan afuera y miran). */
const START_GRACE_MS = 8000;
/**
 * Reacciones permitidas. Es un allowlist cerrado a proposito: el cliente manda un
 * id, no un glifo, y cada id se dibuja como una cara del personaje. Debe coincidir
 * con `EMOTES` en `src/games/word-bomb/game/constants.ts` (tipos duplicados por la
 * regla de decoupling del repo).
 */
const EMOTES: ReadonlySet<string> = new Set<WbEmoteId>([
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
}

function fuseFor(accepted: number): number {
  return Math.max(FUSE_MIN_MS, FUSE_BASE_MS - accepted * FUSE_STEP_MS);
}

class WordBombSim implements RoomSim {
  private phase: "waiting" | "playing" | "over" = "waiting";
  private players: Player[] = [];
  private roster: string[] = [];
  private turnIdx = 0;
  private fragment: string | null = null;
  private deadline: number | null = null;
  /** Duracion de la mecha del turno actual (para que el cliente dibuje la fraccion). */
  private fuseTotal = FUSE_BASE_MS;
  private fuseTimer: ReturnType<typeof setTimeout> | null = null;
  private startTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly used = new Set<string>();
  private accepted = 0;
  private acceptSeq = 0;
  private lastAccepted: WbState["lastAccepted"] = null;
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
    if (this.phase === "over") this.room.emitTo(nickname, "wb:gameover", this.gameoverPayload());
  }

  leave(_nickname: string): void {
    // No se elimina al desconectar: si la partida sigue, la mecha castiga su turno
    // como a un AFK; si vuelve (recarga de pagina) se reengancha. Solo refresca las
    // luces de "conectado".
    if (this.phase !== "over") this.broadcastState();
  }

  message(nickname: string, event: string, payload: unknown): void {
    if (event === "wb:submit") {
      const word = readString(payload, "word");
      if (word !== null) this.submit(nickname, word);
    } else if (event === "wb:typing") {
      const text = readString(payload, "text");
      if (text !== null && this.phase === "playing" && this.current()?.nickname === nickname) {
        this.room.broadcast("wb:typing", { player: nickname, text: text.slice(0, 40) });
      }
    } else if (event === "wb:emote") {
      const emote = readString(payload, "emote");
      if (emote !== null) this.emote(nickname, emote);
    }
  }

  /**
   * Reaccion: puro relay, no toca el estado de la partida ni entra en `wb:state`
   * (es efimera: quien se reengancha no revive las de antes). Reacciona cualquiera
   * y en cualquier momento — tambien el eliminado, que es medio la gracia — pero
   * solo con un id del allowlist y respetando el cooldown.
   */
  private emote(nickname: string, emote: string): void {
    if (!EMOTES.has(emote)) return;
    const now = Date.now();
    const last = this.lastEmoteAt.get(nickname) ?? 0;
    if (now - last < EMOTE_COOLDOWN_MS) return;
    this.lastEmoteAt.set(nickname, now);
    this.room.broadcast("wb:emote", { player: nickname, emote });
  }

  dispose(): void {
    if (this.fuseTimer !== null) clearTimeout(this.fuseTimer);
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
    this.players = seats.map((nickname) => ({ nickname, lives: STARTING_LIVES, alive: true }));
    this.phase = "playing";
    this.turnIdx = 0;
    this.newTurn();
  }

  private newTurn(): void {
    this.fragment = randomFragment();
    this.fuseTotal = fuseFor(this.accepted);
    this.deadline = Date.now() + this.fuseTotal;
    this.armFuse();
    this.broadcastState();
  }

  private armFuse(): void {
    if (this.fuseTimer !== null) clearTimeout(this.fuseTimer);
    const ms = this.deadline !== null ? this.deadline - Date.now() : FUSE_BASE_MS;
    this.fuseTimer = setTimeout(() => this.onFuseExpire(), Math.max(0, ms));
  }

  private onFuseExpire(): void {
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
    this.advanceTurn();
    this.newTurn();
  }

  private submit(nickname: string, word: string): void {
    if (this.phase !== "playing") return;
    const player = this.current();
    if (!player || player.nickname !== nickname) {
      this.room.emitTo(nickname, "wb:invalid", { reason: "not-your-turn" });
      return;
    }
    const { result, normalized } = checkWord(word, this.fragment ?? "");
    if (result !== "ok") {
      this.room.emitTo(nickname, "wb:invalid", { reason: result });
      return;
    }
    if (this.used.has(normalized)) {
      this.room.emitTo(nickname, "wb:invalid", { reason: "already-used" });
      return;
    }
    // Palabra valida: se acepta, pasa el turno y arranca una mecha mas corta.
    this.used.add(normalized);
    this.accepted += 1;
    this.acceptSeq += 1;
    this.lastAccepted = { player: nickname, word: normalized, seq: this.acceptSeq };
    this.advanceTurn();
    this.newTurn();
  }

  private finish(): void {
    this.phase = "over";
    this.fragment = null;
    this.deadline = null;
    if (this.fuseTimer !== null) {
      clearTimeout(this.fuseTimer);
      this.fuseTimer = null;
    }
    this.broadcastState();
    this.room.broadcast("wb:gameover", this.gameoverPayload());
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

  private playerViews(): WbPlayerView[] {
    return this.players.map((p) => ({
      nickname: p.nickname,
      lives: p.lives,
      alive: p.alive,
      connected: this.room.isConnected(p.nickname),
    }));
  }

  private broadcastState(): void {
    const fuseMs = this.deadline !== null ? Math.max(0, this.deadline - Date.now()) : null;
    const state: WbState = {
      phase: this.phase,
      turn: this.phase === "playing" ? this.current()?.nickname ?? null : null,
      fragment: this.fragment,
      deadline: this.deadline,
      fuseMs,
      fuseTotalMs: this.deadline !== null ? this.fuseTotal : null,
      players: this.playerViews(),
      usedCount: this.accepted,
      lastAccepted: this.lastAccepted,
    };
    this.room.broadcast("wb:state", state);
  }

  private gameoverPayload(): WbGameover {
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
  const roster = Array.isArray(p.roster) ? p.roster.filter((x): x is string => typeof x === "string") : [];
  return { nickname, roster };
}

/** Engancha el juego en el namespace `/wordbomb`. */
export function registerWordBomb(io: Server): void {
  registerGame(io, "/wordbomb", "wb:join", parseJoin, (room) => new WordBombSim(room));
}
