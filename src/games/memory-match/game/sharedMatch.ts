import {
  createMatchState,
  CREATE_FALLBACK_MS,
  fetchMatchState,
  updateMatchState,
} from "../../../shared/room/matchState";
import type { RoomMode } from "../../../shared/room/roomMode";
import {
  applyFlip,
  boardDimsFor,
  canFlip,
  createState,
  currentPlayer,
  isComplete,
  pairsOf,
  skipTurn,
  type MemoryState,
} from "./board";
import { AFK_ABSENT_SKIP_MS, AFK_SKIP_MS, MATCH_POLL_MS, REVEAL_HOLD_MS } from "./constants";
import type { Hud } from "./Hud";
import { SoundEffects } from "./SoundEffects";

/**
 * Controlador del tablero compartido (modo sala). Sincronizacion identica al
 * resto de las salas: escribir en room_match_state -> ping "sync" -> los demas
 * refetchean (mas un poll de respaldo). El unico que escribe es el jugador de
 * turno (local-first para que su flip se sienta instantaneo), con version
 * optimista; ante conflicto se refetchea y gana la DB. El host ademas saltea
 * turnos AFK y crea el tablero inicial.
 */
export class SharedMatch {
  private state: MemoryState | null = null;
  private version = 0;
  /** Ultimo reveal ya animado (los que llegan por refetch se animan una vez). */
  private lastAnimSeq = 0;
  private animating = false;
  private pending: { state: MemoryState; version: number } | null = null;
  /** Cartas mostradas temporalmente durante el reveal de un fallo. */
  private holdUp: number[] = [];
  private lastChangeAt = Date.now();
  private finished = false;
  private boardBuilt = false;
  /** Serializa las escrituras: dos flips rapidos deben llegar en orden. */
  private writeChain: Promise<void> = Promise.resolve();

  private readonly room: RoomMode;
  private readonly hud: Hud;
  private readonly onFinished: () => void;

  constructor(room: RoomMode, hud: Hud, onFinished: () => void) {
    this.room = room;
    this.hud = hud;
    this.onFinished = onFinished;
  }

  start(): void {
    this.hud.setTurnText("Preparando el tablero...");
    this.room.onSync(() => void this.refresh());
    window.setInterval(() => void this.refresh(), MATCH_POLL_MS);
    window.setInterval(() => void this.maybeSkipAfk(), 1000);
    void this.boot();
  }

  /** Pares propios: puntaje de la ronda (y parcial por timeout). */
  myPairs(): number {
    return this.state ? pairsOf(this.state, this.room.me) : 0;
  }

  /**
   * Espera (o crea, si somos el host) el estado inicial de la ronda. El insert
   * ante la carrera host-viejo/host-nuevo lo gana el primero; despues todos
   * releen lo que haya quedado.
   *
   * Si el host no aparece (se desconecto antes de cargar la ronda), pasado
   * CREATE_FALLBACK_MS lo crea cualquier jugador: si no, la sala entera se
   * quedaba en "Preparando el tablero..." hasta que alguien tomara el control.
   */
  private async boot(): Promise<void> {
    const since = Date.now();
    for (;;) {
      if (this.state) return; // un refresh concurrente ya lo adopto
      const row = await fetchMatchState<MemoryState>(this.room.code, this.room.round());
      if (row) {
        this.apply(row.state, row.version);
        return;
      }
      const players = this.room.players();
      const mayCreate = this.room.isHost() || Date.now() - since > CREATE_FALLBACK_MS;
      if (mayCreate && players.length > 0) {
        const dims = boardDimsFor(players.length);
        const ok = await createMatchState(
          this.room.code,
          this.room.round(),
          createState(dims.pairs, players),
        );
        if (ok) this.room.ping();
        continue;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  private async refresh(): Promise<void> {
    const row = await fetchMatchState<MemoryState>(this.room.code, this.room.round());
    if (row && row.version > this.version) this.apply(row.state, row.version);
  }

  /** Relee descartando el estado local (tras un conflicto de escritura). */
  private async forceRefresh(): Promise<void> {
    const row = await fetchMatchState<MemoryState>(this.room.code, this.room.round());
    if (row) this.apply(row.state, row.version, true);
  }

  private apply(state: MemoryState, version: number, force = false): void {
    if (!force && this.state && version <= this.version) return;
    if (this.animating) {
      // No pisar la animacion en curso: se aplica al terminar.
      this.pending = { state, version };
      return;
    }

    if (version !== this.version) this.lastChangeAt = Date.now();
    this.state = state;
    this.version = version;

    if (!this.boardBuilt) this.buildBoard();

    // Intento resuelto por otro cliente que aun no animamos: en un fallo hay
    // que mostrar ambas cartas un momento (el estado final ya las tiene boca
    // abajo). Los propios ya se animaron en onCardClick.
    const reveal = state.reveal;
    if (reveal && reveal.seq > this.lastAnimSeq) {
      this.lastAnimSeq = reveal.seq;
      if (reveal.matchedBy === null) {
        SoundEffects.playFail();
        this.holdReveal([reveal.a, reveal.b]);
        return;
      }
      SoundEffects.playMatch();
    }

    this.render();
    this.checkComplete();
  }

  private buildBoard(): void {
    const state = this.state!;
    this.boardBuilt = true;
    const cols = state.cards.length <= 16 ? 4 : 6;
    this.hud.setupBoard(cols, state.cards, (index) => this.onCardClick(index));
  }

  private onCardClick(index: number): void {
    const state = this.state;
    if (!state || this.animating || this.finished) return;
    if (!canFlip(state, this.room.me, index)) return;

    const expected = this.version;
    const next = applyFlip(state, this.room.me, index);

    // Local-first: el flip propio se ve al instante, la escritura va detras.
    this.state = next;
    this.version = expected + 1;
    this.lastChangeAt = Date.now();
    SoundEffects.playFlip();
    this.queueWrite(next, expected);

    const reveal = next.reveal;
    if (reveal) {
      this.lastAnimSeq = reveal.seq;
      if (reveal.matchedBy === null) {
        SoundEffects.playFail();
        this.holdReveal([reveal.a, reveal.b]);
        return;
      }
      SoundEffects.playMatch();
    }
    this.render();
    this.checkComplete();
  }

  /** Muestra las dos cartas del fallo un momento y despues las da vuelta. */
  private holdReveal(indices: number[]): void {
    this.animating = true;
    this.holdUp = indices;
    this.render();
    window.setTimeout(() => {
      this.holdUp = [];
      this.animating = false;
      this.render();
      const pending = this.pending;
      this.pending = null;
      if (pending) this.apply(pending.state, pending.version, true);
      else this.checkComplete();
    }, REVEAL_HOLD_MS);
  }

  /**
   * Host: si el jugador de turno no mueve en AFK_SKIP_MS, pasa el turno.
   *
   * Un jugador **desconectado** no se espera: no va a mover nunca, asi que se lo
   * saltea a los AFK_ABSENT_SKIP_MS y, en la misma escritura, se saltea a todos
   * los ausentes que vengan detras. Sin esto, cada vuelta de turnos regalaba la
   * ventana AFK completa (20s) por cada jugador que se fue, que con dos o tres
   * caidos deja el tablero practicamente parado.
   */
  private async maybeSkipAfk(): Promise<void> {
    const state = this.state;
    if (!state || this.finished || this.animating || !this.room.isHost()) return;
    if (isComplete(state)) return;

    // Con la lista de presentes vacia (canal aun sin sincronizar) no se asume
    // que se fueron todos: se usa la ventana AFK de siempre.
    const present = this.room.presentPlayers();
    const absent = present.length > 0 && !present.includes(currentPlayer(state));
    if (Date.now() - this.lastChangeAt < (absent ? AFK_ABSENT_SKIP_MS : AFK_SKIP_MS)) return;

    this.lastChangeAt = Date.now(); // un intento por ventana de inactividad
    const expected = this.version;
    const next = absent ? this.skipAbsent(state, present) : skipTurn(state);
    this.state = next;
    this.version = expected + 1;
    this.render();
    this.queueWrite(next, expected);
  }

  /** Saltea el turno y sigue salteando mientras el que sigue este desconectado. */
  private skipAbsent(state: MemoryState, present: string[]): MemoryState {
    let next = skipTurn(state);
    for (let i = 0; i < state.turnOrder.length && !present.includes(currentPlayer(next)); i++) {
      next = skipTurn(next);
    }
    return next;
  }

  /**
   * Encadena la escritura detras de las anteriores: dos movimientos rapidos
   * del mismo cliente no deben carrerear entre si en la red. Ante conflicto
   * de version se readopta lo que diga la DB.
   */
  private queueWrite(next: MemoryState, expected: number): void {
    this.writeChain = this.writeChain.then(async () => {
      const ok = await updateMatchState(this.room.code, this.room.round(), next, expected);
      if (ok) this.room.ping();
      else await this.forceRefresh();
    });
  }

  private render(): void {
    const state = this.state;
    if (!state) return;

    const faceUp = state.cards.map(
      (_, i) =>
        state.matchedBy[i] !== null || state.flipped.includes(i) || this.holdUp.includes(i),
    );
    const owners = state.matchedBy.map((owner) =>
      owner === null ? null : Math.max(0, state.turnOrder.indexOf(owner)),
    );
    this.hud.renderCards(faceUp, owners);

    const me = this.room.me;
    this.hud.setStats(pairsOf(state, me));

    const complete = isComplete(state);
    if (complete) {
      this.hud.setTurnText("Tablero completo");
    } else {
      const turnPlayer = currentPlayer(state);
      const mine = turnPlayer === me;
      this.hud.setTurnText(mine ? "Tu turno" : `Turno de ${turnPlayer}`, mine);
    }

    this.hud.showPlayers(
      state.turnOrder.map((player, idx) => ({
        player,
        pairs: pairsOf(state, player),
        colorIdx: idx,
        isTurn: !complete && idx === state.turn,
        isMe: player === me,
      })),
    );
  }

  private checkComplete(): void {
    const state = this.state;
    if (!state || this.finished || !isComplete(state)) return;
    this.finished = true;
    SoundEffects.playVictory();
    this.render();
    this.room.reportScore(pairsOf(state, this.room.me));
    this.onFinished();
  }
}
