import {
  createMatchState,
  CREATE_FALLBACK_MS,
  fetchMatchState,
  updateMatchState,
} from "../../../shared/room/matchState";
import type { RoomMode } from "../../../shared/room/roomMode";
import { AFK_ABSENT_MOVE_MS, AFK_MOVE_MS, MATCH_POLL_MS } from "./constants";
import type { Hud } from "./Hud";
import {
  applyMove,
  createState,
  legalMoves,
  otherPlayer,
  type C4State,
} from "./logic";
import { SoundEffects } from "./SoundEffects";

/**
 * Estado durable de una partida de sala: el tablero + los nicknames de los dos
 * asientos (jugador 0 = players[0], jugador 1 = players[1]) y un correlativo de
 * jugadas para que los clientes remotos suenen cada movimiento una sola vez.
 */
interface C4MatchState extends C4State {
  players: [string, string];
  seq: number;
}

function applyRoomMove(state: C4MatchState, col: number): C4MatchState {
  const base = applyMove(state, col);
  return { ...base, players: state.players, seq: state.seq + 1 };
}

/**
 * Controlador del tablero compartido (modo sala, PvP). Misma sincronizacion que
 * el resto de las salas: el jugador de turno escribe en room_match_state (con
 * version optimista) -> ping "sync" -> los demas refetchean, mas un poll de
 * respaldo. El host crea el tablero inicial y, si un jugador se queda AFK, mueve
 * por el (columna al azar) para que la partida avance.
 */
export interface SharedMatchOpts {
  /** Fila de room_match_state de este tablero (una por pareja en la ronda). */
  boardNo: number;
  /** Los dos asientos [cian, rosa] de esta pareja. */
  seats: [string, string];
  /**
   * Pasivo: el host administra un tablero que no juega (lo crea y destraba AFK)
   * sin tocar el HUD, sonido ni reportar puntaje. Solo para el host; los dos
   * jugadores del tablero corren su propia instancia activa.
   */
  passive?: boolean;
  /**
   * Espectador: renderiza un tablero ajeno en el HUD (mira otra partida tras
   * terminar la propia) pero no juega, no reporta puntaje, no crea el tablero ni
   * administra el AFK. `onFinished` avisa cuando la partida mirada termina para
   * saltar a otra.
   */
  spectate?: boolean;
}

export class SharedMatch {
  private state: C4MatchState | null = null;
  private version = 0;
  private lastAnimSeq = 0;
  private lastChangeAt = Date.now();
  private finished = false;
  private disposed = false;
  /** Handles de los intervalos, para poder frenarlos al descartar la instancia. */
  private timers: number[] = [];
  /** Serializa las escrituras: dos jugadas rapidas deben llegar en orden. */
  private writeChain: Promise<void> = Promise.resolve();

  private readonly room: RoomMode;
  private readonly hud: Hud;
  private readonly onFinished: () => void;
  private readonly boardNo: number;
  private readonly seats: [string, string];
  private readonly passive: boolean;
  private readonly spectate: boolean;

  constructor(room: RoomMode, hud: Hud, onFinished: () => void, opts: SharedMatchOpts) {
    this.room = room;
    this.hud = hud;
    this.onFinished = onFinished;
    this.boardNo = opts.boardNo;
    this.seats = opts.seats;
    this.passive = opts.passive ?? false;
    this.spectate = opts.spectate ?? false;
  }

  start(): void {
    if (!this.passive) {
      this.hud.setStatus(this.spectate ? "Mirando otra partida..." : "Preparando el tablero...");
      this.hud.setInteractive(false);
      this.hud.showPlayers(null);
    }
    this.room.onSync(() => void this.refresh());
    this.timers.push(window.setInterval(() => void this.refresh(), MATCH_POLL_MS));
    this.timers.push(window.setInterval(() => void this.maybeMoveAfk(), 1000));
    void this.boot();
  }

  /**
   * Descarta la instancia: frena sus intervalos y la vuelve inerte (el `onSync`
   * suscrito en RoomMode no se puede desuscribir, asi que `refresh` corta solo).
   * Se usa al cambiar de tablero espectado para no dejar dos instancias
   * peleando por el HUD.
   */
  dispose(): void {
    this.disposed = true;
    for (const t of this.timers) window.clearInterval(t);
    this.timers = [];
  }

  /** Puntaje de la ronda (y parcial por timeout): 1 si gane, si no 0 (empate incluido). */
  myScore(): number {
    const state = this.state;
    if (!state || state.winner === null) return 0;
    return state.players[state.winner] === this.room.me ? 1 : 0;
  }

  /**
   * Espera (o crea, si somos el host) el estado inicial de este tablero. Los dos
   * asientos son la pareja fija (`seats`); el host crea la fila y los dos
   * jugadores la esperan. Ante la carrera de hosts gana el primer insert (PK) y
   * todos releen lo que quedo.
   */
  private async boot(): Promise<void> {
    const since = Date.now();
    for (;;) {
      if (this.disposed || this.state) return;
      const row = await fetchMatchState<C4MatchState>(
        this.room.code,
        this.room.round(),
        this.boardNo,
      );
      if (this.disposed) return;
      if (row) {
        this.apply(row.state, row.version);
        return;
      }
      // El espectador nunca crea el tablero (ya existe: lo hizo el host o los
      // jugadores de esa pareja); solo espera a leerlo. Si el host no aparece
      // (se desconecto antes de cargar la ronda), pasado CREATE_FALLBACK_MS lo
      // crea el propio jugador: si no, los dos de la pareja se quedaban en
      // "Esperando un rival..." para siempre.
      if ((this.room.isHost() || Date.now() - since > CREATE_FALLBACK_MS) && !this.spectate) {
        const init: C4MatchState = { ...createState(0), players: this.seats, seq: 0 };
        const ok = await createMatchState(this.room.code, this.room.round(), init, this.boardNo);
        if (ok) this.room.ping();
        continue;
      }
      if (!this.passive) {
        this.hud.setStatus(this.spectate ? "Mirando otra partida..." : "Esperando un rival...");
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  private async refresh(): Promise<void> {
    if (this.disposed) return;
    const row = await fetchMatchState<C4MatchState>(
      this.room.code,
      this.room.round(),
      this.boardNo,
    );
    if (this.disposed) return;
    if (row && row.version > this.version) this.apply(row.state, row.version);
  }

  /** Relee descartando el estado local (tras un conflicto de escritura). */
  private async forceRefresh(): Promise<void> {
    const row = await fetchMatchState<C4MatchState>(
      this.room.code,
      this.room.round(),
      this.boardNo,
    );
    if (row) this.apply(row.state, row.version, true);
  }

  private apply(state: C4MatchState, version: number, force = false): void {
    if (!force && this.state && version <= this.version) return;
    if (version !== this.version) this.lastChangeAt = Date.now();

    this.state = state;
    this.version = version;

    // Jugada nueva hecha por otro cliente: sonarla una sola vez (no en pasivo,
    // que es un tablero que el host solo administra en segundo plano).
    if (state.seq > this.lastAnimSeq) {
      this.lastAnimSeq = state.seq;
      if (!this.passive) {
        const mover = state.winner !== null ? state.winner : otherPlayer(state.turn);
        SoundEffects.playDrop(mover);
      }
    }

    this.render();
    this.checkFinish();
  }

  /** Clic en una columna (lo enruta el Game desde su unico handler). */
  handleColumn(col: number): void {
    if (this.passive || this.spectate) return; // administrado / espectado: sin clics
    const state = this.state;
    if (!state || this.finished || state.winner !== null || state.draw) return;
    if (state.players[state.turn] !== this.room.me) return; // no es mi turno
    if (state.heights[col] >= 6) return; // columna llena

    const player = state.turn;
    const expected = this.version;
    const next = applyRoomMove(state, col);

    // Local-first: la jugada propia se ve al instante, la escritura va detras.
    this.state = next;
    this.version = expected + 1;
    this.lastAnimSeq = next.seq;
    this.lastChangeAt = Date.now();
    SoundEffects.playDrop(player);
    this.queueWrite(next, expected);

    this.render();
    this.checkFinish();
  }

  /**
   * Destraba un turno parado jugando al azar por el jugador de turno.
   *
   * Lo hace el host (que administra todos los tableros) **y tambien el rival del
   * jugador parado en su propio tablero**: si solo lo hiciera el host, un host
   * caido dejaba el duelo congelado para siempre. Nadie destraba su propio turno
   * por esta via salvo el host, que es el anti-AFK de siempre.
   *
   * Si el jugador de turno esta **desconectado** no se le reserva la ventana AFK
   * completa: no va a mover nunca, asi que se juega por el enseguida.
   */
  private async maybeMoveAfk(): Promise<void> {
    const state = this.state;
    if (this.disposed || this.spectate) return; // el espectador no administra el tablero
    if (!state || this.finished || state.winner !== null || state.draw) return;

    const turnPlayer = state.players[state.turn];
    const iAmSeat = !this.passive && state.players.includes(this.room.me);
    if (!this.room.isHost() && !(iAmSeat && turnPlayer !== this.room.me)) return;

    // Con la lista de presentes vacia (canal aun sin sincronizar) no se asume
    // que se fueron todos: se usa la ventana AFK de siempre.
    const present = this.room.presentPlayers();
    const absent = present.length > 0 && !present.includes(turnPlayer);
    if (Date.now() - this.lastChangeAt < (absent ? AFK_ABSENT_MOVE_MS : AFK_MOVE_MS)) return;

    const moves = legalMoves(state);
    if (moves.length === 0) return;
    this.lastChangeAt = Date.now(); // un intento por ventana de inactividad

    const col = moves[Math.floor(Math.random() * moves.length)];
    const expected = this.version;
    const next = applyRoomMove(state, col);
    this.state = next;
    this.version = expected + 1;
    this.lastAnimSeq = next.seq;
    if (!this.passive) SoundEffects.playDrop(state.turn);
    this.render();
    this.checkFinish();
    this.queueWrite(next, expected);
  }

  /** Encadena las escrituras; ante conflicto de version se readopta la DB. */
  private queueWrite(next: C4MatchState, expected: number): void {
    this.writeChain = this.writeChain.then(async () => {
      const ok = await updateMatchState(
        this.room.code,
        this.room.round(),
        next,
        expected,
        this.boardNo,
      );
      if (ok) this.room.ping();
      else await this.forceRefresh();
    });
  }

  private render(): void {
    if (this.passive) return; // tablero administrado: nunca toca el HUD
    const state = this.state;
    if (!state) return;
    const me = this.room.me;
    const seat = state.players.indexOf(me);
    const iAmPlayer = seat === 0 || seat === 1;
    const over = state.winner !== null || state.draw;

    this.hud.renderBoard(state.cells, { winningLine: state.winningLine });

    const myTurn = !over && state.players[state.turn] === me;
    this.hud.setInteractive(myTurn);
    this.hud.setPreviewColor(myTurn ? seat : null);

    if (iAmPlayer) {
      this.hud.setScore(`SOS ${seat === 0 ? "CIAN" : "ROSA"}`);
    } else {
      this.hud.setScore("MIRANDO");
    }
    this.hud.setBest("");

    if (state.winner !== null) {
      const winner = state.players[state.winner];
      this.hud.setStatus(
        winner === me ? "GANASTE" : iAmPlayer ? "PERDISTE" : `GANO ${winner}`,
        winner === me,
      );
    } else if (state.draw) {
      this.hud.setStatus("EMPATE");
    } else {
      const turnName = state.players[state.turn];
      this.hud.setStatus(myTurn ? "TU TURNO" : `TURNO DE ${turnName}`, myTurn);
    }

    this.hud.showPlayers(
      state.players.map((player, idx) => ({
        player,
        markLabel: idx === 0 ? "C" : "R",
        colorIdx: idx,
        isTurn: !over && idx === state.turn,
        isMe: player === me,
      })),
    );
  }

  private checkFinish(): void {
    const state = this.state;
    if (!state || this.finished || (state.winner === null && !state.draw)) return;
    this.finished = true;

    // Tablero administrado por el host: solo latchea el fin (para cortar el AFK),
    // sin HUD, sonido ni reportar (no es una partida del host).
    if (this.passive) return;

    this.hud.setInteractive(false);
    this.hud.setPreviewColor(null);

    // Espectador: no puntua ni suena; muestra el resultado y avisa para saltar a
    // otra partida en curso.
    if (this.spectate) {
      this.render();
      this.onFinished();
      return;
    }

    if (state.winner !== null) {
      const iWon = state.players[state.winner] === this.room.me;
      if (iWon) SoundEffects.playWin();
      else SoundEffects.playLose();
    } else {
      SoundEffects.playDraw();
    }

    this.render();
    this.room.reportScore(this.myScore());
    this.onFinished();
  }
}
