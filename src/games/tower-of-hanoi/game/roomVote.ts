import {
  createMatchState,
  CREATE_FALLBACK_MS,
  fetchMatchState,
  updateMatchState,
} from "../../../shared/room/matchState";
import type { RoomMode } from "../../../shared/room/roomMode";
import { DISC_OPTIONS, DEFAULT_DISCS, VOTE_POLL_MS, VOTE_TIMEOUT_MS } from "./constants";
import type { Hud } from "./Hud";

/**
 * Estado durable de la votacion de discos de una ronda (una fila jsonb en
 * public.room_match_state, como los tableros compartidos). No es un tablero
 * compartido: todos juegan su propia torre, solo se comparte la cantidad de
 * discos votada. Mismo patron que el resto de las salas: escribir -> ping "sync"
 * -> los demas refetchean, mas un poll de respaldo.
 */
interface DiscVoteState {
  phase: "voting" | "playing";
  /** nickname -> discos votados. */
  votes: Record<string, number>;
  /** Discos ganadores una vez cerrada la votacion. */
  discs: number | null;
  /** Epoch ms (reloj del host) del inicio de la votacion, para el tope. */
  startedAt: number;
}

/**
 * Controla la votacion de discos previa a jugar en modo sala. El host crea la
 * fila, todos votan, el host tallya (mayoria; empate al azar) al votar todos o
 * al vencer el tope y fija los discos. Cuando la fase pasa a "playing" avisa al
 * juego con los discos elegidos, que arranca su propio countdown.
 */
export class RoomVote {
  private state: DiscVoteState | null = null;
  private version = 0;
  private resolved = false;
  private booted = false;
  private writing = false;

  private readonly room: RoomMode;
  private readonly hud: Hud;
  private readonly onResolved: (discs: number) => void;

  constructor(room: RoomMode, hud: Hud, onResolved: (discs: number) => void) {
    this.room = room;
    this.hud = hud;
    this.onResolved = onResolved;
  }

  start(): void {
    // Se muestra el overlay ya con el handler real: los clics antes de que
    // cargue el estado compartido caen en la guarda de castVote (no-op) y una
    // vez cargado el jugador vuelve a votar.
    this.hud.showDiscVote({
      options: DISC_OPTIONS,
      counts: {},
      myVote: null,
      onVote: (discs) => void this.castVote(discs),
    });
    this.room.onSync(() => void this.refresh());
    window.setInterval(() => void this.refresh(), VOTE_POLL_MS);
    window.setInterval(() => void this.maybeClose(), 1000);
    void this.boot();
  }

  /**
   * Espera (o crea, si es host) la fila de votacion de la ronda. Si el host no
   * aparece (se desconecto antes de cargar la ronda), pasado CREATE_FALLBACK_MS
   * la crea cualquier jugador: el insert es idempotente por PK, gana el primero.
   */
  private async boot(): Promise<void> {
    if (this.booted) return;
    this.booted = true;
    const since = Date.now();
    for (;;) {
      if (this.state) return;
      const row = await fetchMatchState<DiscVoteState>(this.room.code, this.room.round());
      if (row) {
        this.apply(row.state, row.version);
        return;
      }
      if (this.room.isHost() || Date.now() - since > CREATE_FALLBACK_MS) {
        const initial: DiscVoteState = {
          phase: "voting",
          votes: {},
          discs: null,
          startedAt: Date.now(),
        };
        const ok = await createMatchState(this.room.code, this.room.round(), initial);
        if (ok) this.room.ping();
        continue;
      }
      await new Promise((resolve) => setTimeout(resolve, 800));
    }
  }

  private async refresh(): Promise<void> {
    const row = await fetchMatchState<DiscVoteState>(this.room.code, this.room.round());
    if (row && row.version > this.version) this.apply(row.state, row.version);
  }

  private async forceRefresh(): Promise<void> {
    const row = await fetchMatchState<DiscVoteState>(this.room.code, this.room.round());
    if (row) this.apply(row.state, row.version, true);
  }

  private apply(state: DiscVoteState, version: number, force = false): void {
    if (!force && this.state && version <= this.version) return;
    this.state = state;
    this.version = version;

    if (state.phase === "playing" && state.discs !== null) {
      if (this.resolved) return;
      this.resolved = true;
      this.onResolved(state.discs);
      return;
    }
    this.render();
  }

  private render(): void {
    const state = this.state;
    if (!state || this.resolved) return;
    const counts: Record<number, number> = {};
    for (const discs of Object.values(state.votes)) counts[discs] = (counts[discs] ?? 0) + 1;

    this.hud.showDiscVote({
      options: DISC_OPTIONS,
      counts,
      myVote: state.votes[this.room.me] ?? null,
      onVote: (discs) => void this.castVote(discs),
    });
  }

  private async castVote(discs: number): Promise<void> {
    if (!this.state || this.resolved || this.writing) return;
    this.writing = true;
    try {
      // Reintenta ante conflicto de version: si otro jugador voto primero, se
      // readopta su estado y se vuelve a aplicar el voto propio encima, asi los
      // votos simultaneos se combinan en vez de perderse.
      for (let attempt = 0; attempt < 6; attempt++) {
        const state = this.state;
        if (!state || state.phase !== "voting" || this.resolved) return;

        const expected = this.version;
        const next: DiscVoteState = {
          ...state,
          votes: { ...state.votes, [this.room.me]: discs },
        };
        // Local-first: el voto se ve al instante.
        this.state = next;
        this.version = expected + 1;
        this.render();

        const ok = await updateMatchState(this.room.code, this.room.round(), next, expected);
        if (ok) {
          this.room.ping();
          return;
        }
        await this.forceRefresh();
      }
    } finally {
      this.writing = false;
    }
  }

  /** Host: cierra la votacion cuando todos votaron o vence el tope. */
  private async maybeClose(): Promise<void> {
    const state = this.state;
    if (!state || state.phase !== "voting" || this.resolved || this.writing) return;
    if (!this.room.isHost()) return;

    const players = this.room.players();
    const allVoted = players.length > 0 && players.every((p) => state.votes[p] !== undefined);
    const timedOut = Date.now() - state.startedAt >= VOTE_TIMEOUT_MS;
    if (!allVoted && !timedOut) return;

    const winner = this.tally(state.votes);
    const expected = this.version;
    const next: DiscVoteState = { ...state, phase: "playing", discs: winner };
    this.state = next;
    this.version = expected + 1;

    this.writing = true;
    const ok = await updateMatchState(this.room.code, this.room.round(), next, expected);
    this.writing = false;
    if (ok) {
      this.room.ping();
      this.apply(next, this.version, true);
    } else {
      await this.forceRefresh();
    }
  }

  /** Mayoria; empate al azar. Sin votos, cae en el default. */
  private tally(votes: Record<string, number>): number {
    const counts = new Map<number, number>();
    for (const discs of Object.values(votes)) counts.set(discs, (counts.get(discs) ?? 0) + 1);
    if (counts.size === 0) return DEFAULT_DISCS;
    const max = Math.max(...counts.values());
    const top = [...counts.keys()].filter((d) => counts.get(d) === max);
    return top[Math.floor(Math.random() * top.length)];
  }
}
