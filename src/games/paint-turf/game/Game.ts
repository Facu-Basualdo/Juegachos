import { initRoomMode, isRoomMode, type RoomMode } from "../../../shared/room/roomMode";
import { isGameServerConfigured, resolveGameServerUrl } from "../../../shared/server-status";
import {
  BRUSH_RADIUS,
  CELL,
  CELL_COUNT,
  CLOCK_DRIFT_RATE,
  COLS,
  COUNTDOWN_LABELS,
  COUNTDOWN_STEP,
  ERROR_FADE_RATE,
  EXTRAPOLATE_MS,
  HISTORY_MS,
  INPUT_INTERVAL,
  INTERP_DELAY,
  MATCH_MS,
  MAX_DT,
  ROWS,
  SNAP_DIST,
  SPEED,
  SPLAT_COOLDOWN_MS,
  STUN_SPEED_FACTOR,
  VIEW_HEIGHT,
  VIEW_WIDTH,
} from "./constants";
import { Hud, type ScoreRow } from "./Hud";
import { InputController } from "./InputController";
import { PaintTurfSocket } from "./PaintTurfSocket";
import type { PtInit, PtPlayerView, PtState } from "./PaintTurfProtocol";
import { Renderer, type BrushView } from "./Renderer";
import { SoundEffects } from "./SoundEffects";

type State = "waiting" | "countdown" | "playing" | "over";

/** Posicion de cada asiento en un instante del reloj del server. */
interface Snap {
  t: number;
  pos: Map<number, { x: number; y: number }>;
}

/** Sin un solo snapshot despues de este tiempo se da el server por perdido. */
const SERVER_GRACE_MS = 12_000;

/**
 * Manchon: juego SOLO de sala. Supabase maneja lobby / marcador / rejoin (via
 * RoomMode) y el game server arbitra la partida (namespace `/paintturf`).
 *
 * El reparto de trabajo:
 *  - El SERVER es duenio de la grilla, de las posiciones y del puntaje. Tiene que
 *    serlo: los ocho jugadores escriben sobre el mismo tablero y, sin un arbitro,
 *    cada pantalla se quedaria con un ganador distinto (ver el sim).
 *  - El CLIENTE manda su direccion, predice su propio pincel para que el control
 *    se sienta inmediato, e interpola a los rivales sobre el reloj del server.
 *
 * Lo que el cliente NO hace es adelantarse a pintar. Podria (pintar la celda
 * apenas la pisa, sin esperar la confirmacion), pero cuando el server no
 * confirma — el caso tipico es un aturdimiento que llego con un snapshot de
 * retraso — la celda queda pintada para siempre de este lado y de nadie del otro,
 * porque el protocolo no manda "despintar". El hueco de un snapshot detras del
 * pincel se tapa con el disco de pigmento fresco que dibuja el Renderer, que es
 * gratis y no puede desincronizar nada.
 */
export class Game {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly hud: Hud;
  private readonly renderer = new Renderer();
  private readonly input: InputController;
  private readonly room: RoomMode | null;

  private socket: PaintTurfSocket | null = null;
  /** Guarda contra doble conexion mientras `connect()` resuelve la URL. */
  private connecting = false;
  private connectStartedAt = 0;

  private state: State = "waiting";
  private countdownTime = 0;
  private lastCountdownIndex = -1;
  private lastTime = 0;
  private inputTimer = 0;

  /** Duenio de cada celda. La misma instancia la lee el Renderer para repintar. */
  private readonly grid = new Int8Array(CELL_COUNT).fill(-1);
  private seats: string[] = [];
  private mySeat = -1;
  private scores: number[] = [];

  private latest: PtState | null = null;
  /** Buffer de snapshots para interpolar rivales (reloj del server + offset). */
  private snaps: Snap[] = [];
  /** `tLocal = t + clockOffset`, estimado con el MINIMO de (llegada - t). */
  private clockOffset: number | null = null;

  /** Pincel propio predicho localmente (el server sigue siendo el autoritativo). */
  private myX = VIEW_WIDTH / 2;
  private myY = VIEW_HEIGHT / 2;
  /** Inputs propios ya enviados, con el momento en que se mandaron. Es lo que se
   *  vuelve a aplicar sobre la posicion del server para reconciliar. */
  private inputs: { n: number; t: number; dx: number; dy: number }[] = [];
  /** Numero del proximo `pt:input`. */
  private inputSeq = 0;
  /** Resto visual de la ultima correccion, que se disuelve en pantalla. */
  private visX = 0;
  private visY = 0;
  private myStun = 0;
  private myCooldown = 0;
  private hadStun = false;

  constructor(container: HTMLElement) {
    this.canvas = document.createElement("canvas");
    this.canvas.className = "game-canvas";
    container.append(this.canvas);
    this.ctx = this.canvas.getContext("2d")!;

    this.hud = new Hud(container);
    this.renderer.setOwners(this.grid);

    this.input = new InputController(container);
    this.hud.onSplat(() => this.input.requestSplat());

    this.resize();
    window.addEventListener("resize", this.resize);

    this.room = initRoomMode("paint-turf", {
      getScore: () => this.myCells(),
      onStart: () => this.beginCountdown(),
      // Al terminar, en vez de la espera generica de la sala se deja el tablero
      // final a la vista con el reparto de territorio.
      onReportedWaiting: () => {
        this.showResults();
        return true;
      },
    });

    if (!this.room) {
      if (isRoomMode()) {
        this.hud.showMessage(
          "No disponible",
          "Manch&oacute;n necesita las credenciales de la sala y no est&aacute;n configuradas.",
        );
      } else {
        this.hud.showMessage(
          "Solo en salas",
          "Manch&oacute;n se juega con amigos en una sala. Cre&aacute; o un&iacute;te a una para jugar.",
          { label: "Ir a las salas", onClick: () => (window.location.href = "/rooms/") },
        );
      }
      return;
    }

    if (!isGameServerConfigured()) {
      this.hud.showMessage(
        "No disponible",
        "Manch&oacute;n necesita el game server y no est&aacute; configurado (VITE_GAME_SERVER_URL).",
      );
      return;
    }

    this.hud.showMessage("Manch&oacute;n", "Esper&aacute; a que empiece la ronda...");

    this.lastTime = performance.now();
    requestAnimationFrame(this.tick);
  }

  // ---------- Arranque ----------

  /**
   * Countdown 3 / 2 / 1 / YA. En sala no hay Enter: lo dispara RoomMode (onStart)
   * al pasar la ronda a "playing", asi todos arrancan juntos.
   */
  private beginCountdown(): void {
    if (this.state === "countdown" || this.state === "playing") return;
    this.state = "countdown";
    this.countdownTime = 0;
    this.lastCountdownIndex = -1;
    this.hud.hideMessage();
    this.hud.showHud(true);
    this.hud.showCountdown(COUNTDOWN_LABELS[0]);
    void this.connect();
  }

  /**
   * Conecta al game server al arrancar la ronda (en el constructor el roster
   * todavia no cargo: el boot de RoomMode es async).
   *
   * Async porque resolver el server puede implicar un health check (ver
   * `shared/server-status.ts`); `connecting` cubre la ventana del await, en la que
   * `this.socket` sigue siendo null y una segunda llamada abriria un socket de mas.
   */
  private async connect(): Promise<void> {
    if (this.socket || this.connecting || !this.room) return;
    this.connecting = true;
    this.connectStartedAt = performance.now();
    const url = await resolveGameServerUrl();
    this.connecting = false;
    if (this.socket || !this.room) return;
    if (!url) {
      this.giveUp();
      return;
    }

    const socket = new PaintTurfSocket(
      url,
      this.room.code,
      this.room.me,
      this.room.players(),
      this.room.round(),
    );
    socket.onInit((init) => this.onInit(init));
    socket.onState((state) => this.onState(state));
    socket.onSplat((splat) => {
      this.renderer.addSplat(splat.i, splat.x, splat.y);
      SoundEffects.playSplat(splat.i === this.mySeat);
    });
    this.socket = socket;
    void socket.connect();
  }

  /**
   * El server no contesto. Se reporta igual (con lo que haya) para no dejar la
   * ronda colgada: sin puntaje de este jugador la sala espera para siempre, porque
   * el cierre anticipado solo cubre a los DESCONECTADOS de la sala, no al que esta
   * mirando un cartel de error.
   */
  private giveUp(): void {
    if (this.state === "over") return;
    this.state = "over";
    this.hud.showHud(false);
    this.hud.showMessage(
      "Sin conexi&oacute;n",
      "No se pudo conectar al game server. La ronda sigue con los dem&aacute;s.",
    );
    this.room?.reportScore(0);
  }

  // ---------- Estado del server ----------

  private onInit(init: PtInit): void {
    // Geometria distinta a la compilada: el server esta en otra version. Mejor
    // frenar que dibujar un tablero corrido.
    if (init.cols !== COLS || init.rows !== ROWS || init.cell !== CELL) {
      this.giveUp();
      return;
    }

    this.seats = init.seats;
    this.mySeat = init.seat;
    if (this.scores.length !== init.seats.length) {
      this.scores = init.seats.map(() => 0);
    }

    for (let i = 0; i < CELL_COUNT; i++) {
      const ch = init.grid.charCodeAt(i);
      // "." (46) = sin pintar; "0".."7" = asiento.
      this.grid[i] = ch === 46 ? -1 : ch - 48;
    }
    this.renderer.setGrid(this.grid);
  }

  private onState(state: PtState): void {
    this.latest = state;
    this.scores = state.scores;

    for (let i = 0; i < state.c.length; i += 2) {
      const idx = state.c[i];
      const seat = state.c[i + 1];
      if (idx < 0 || idx >= CELL_COUNT) continue;
      this.grid[idx] = seat;
      this.renderer.setCell(idx, seat);
    }

    this.pushSnap(state);

    const mine = state.players.find((p) => p.i === this.mySeat);
    if (mine) {
      this.myStun = mine.st;
      this.myCooldown = mine.cd;
      if (mine.st > 0 && !this.hadStun) SoundEffects.playStunned();
      this.hadStun = mine.st > 0;

      if (this.state === "playing") this.reconcile(mine);
    }

    if (state.phase === "playing" && this.state === "countdown") {
      // El server ya largo (esta pagina llego tarde): no tiene sentido seguir
      // contando 3 / 2 / 1 mientras los demas pintan.
      this.startPlaying();
    }
    if (state.phase === "over" && this.state !== "over") this.finish();
  }

  /**
   * Agrega el snapshot al buffer, fechado con el reloj de la SIMULACION del server
   * (`t`, que avanza en pasos fijos) traido al reloj local. Fecharlo con la hora de
   * llegada mete el jitter de red adentro del movimiento dibujado: dos snapshots
   * pegados describen un tick entero de movimiento en 2 ms, asi que los rivales se
   * dibujan pegando saltos (ver el CLAUDE.md raiz).
   */
  private pushSnap(state: PtState): void {
    const now = performance.now();
    const sample = now - state.t;
    if (this.clockOffset === null || sample < this.clockOffset) this.clockOffset = sample;
    else this.clockOffset += (sample - this.clockOffset) * CLOCK_DRIFT_RATE;
    const t = state.t + this.clockOffset;

    const tail = this.snaps[this.snaps.length - 1];
    // Fuera de orden (llego despues que uno mas nuevo): se descarta.
    if (tail && t <= tail.t) return;

    const pos = new Map<number, { x: number; y: number }>();
    for (const player of state.players) pos.set(player.i, { x: player.x, y: player.y });
    this.snaps.push({ t, pos });

    const cutoff = now - 600;
    while (this.snaps.length > 2 && this.snaps[0].t < cutoff) this.snaps.shift();
  }

  private startPlaying(): void {
    this.state = "playing";
    this.hud.showCountdown(null);
    const mine = this.latest?.players.find((p) => p.i === this.mySeat);
    if (mine) {
      this.myX = mine.x;
      this.myY = mine.y;
    }
    this.inputs.length = 0;
    this.visX = 0;
    this.visY = 0;
  }

  private finish(): void {
    this.state = "over";
    this.hud.showCountdown(null);
    this.hud.showHud(false);
    SoundEffects.playEnd();
    if (this.room) this.room.reportScore(this.myCells());
    this.showResults();
  }

  // ---------- Bucle ----------

  private tick = (now: number): void => {
    const dt = Math.min((now - this.lastTime) / 1000, MAX_DT);
    this.lastTime = now;

    this.update(dt, now);
    this.render(now / 1000);

    requestAnimationFrame(this.tick);
  };

  private update(dt: number, now: number): void {
    this.renderer.update(dt);

    if (this.state === "countdown") {
      this.updateCountdown(dt);
      // El socket no engancha: se corta antes de que el jugador mire una pantalla
      // muerta hasta el final de la ronda.
      if (!this.latest && this.connectStartedAt > 0 && now - this.connectStartedAt > SERVER_GRACE_MS) {
        this.giveUp();
      }
      return;
    }
    if (this.state !== "playing") return;

    this.updateMyBrush(dt);
    this.sendInput(dt);
    this.updateHud();
  }

  /**
   * Countdown: mientras el server esta en su congelado inicial (`preroll`) las
   * etiquetas salen de SU reloj, asi el "YA" de todos cae en el mismo instante en
   * que largan los pinceles. Sin snapshot todavia se cuenta con el reloj local.
   */
  private updateCountdown(dt: number): void {
    this.countdownTime += dt;

    let index: number;
    if (this.latest && this.latest.phase === "preroll") {
      const elapsed = COUNTDOWN_LABELS.length * COUNTDOWN_STEP - this.latest.msLeft / 1000;
      index = Math.floor(elapsed / COUNTDOWN_STEP);
    } else {
      index = Math.floor(this.countdownTime / COUNTDOWN_STEP);
    }
    index = Math.max(0, Math.min(index, COUNTDOWN_LABELS.length - 1));

    if (index !== this.lastCountdownIndex) {
      this.lastCountdownIndex = index;
      SoundEffects.playCountdownTick();
      this.hud.showCountdown(COUNTDOWN_LABELS[index]);
    }

    // El paso a "playing" lo manda el server (onState). Sin server el countdown
    // local igual termina, y ahi manda el SERVER_GRACE_MS.
  }

  /** Prediccion local del pincel propio, para que el control no espere a la red. */
  private updateMyBrush(dt: number): void {
    if (this.mySeat < 0) return;

    const stunned = this.myStun > 0;
    this.myStun = Math.max(0, this.myStun - dt * 1000);
    this.myCooldown = Math.max(0, this.myCooldown - dt * 1000);

    const dir = this.worldDir();
    const len = Math.hypot(dir.x, dir.y);
    if (len > 0.001) {
      const speed = SPEED * (stunned ? STUN_SPEED_FACTOR : 1);
      this.myX = clamp(this.myX + (dir.x / len) * speed * dt, 0, VIEW_WIDTH);
      this.myY = clamp(this.myY + (dir.y / len) * speed * dt, 0, VIEW_HEIGHT);
    }

    // La correccion ya se aplico a la posicion logica; lo que queda es disolver el
    // salto en pantalla para que el ojo no lo vea.
    const decay = Math.exp(-ERROR_FADE_RATE * dt);
    this.visX *= decay;
    this.visY *= decay;
  }

  /**
   * Reconciliacion contra el server, por reproduccion de inputs.
   *
   * El problema a resolver: el snapshot describe donde estaba el pincel cuando el
   * server lo capturo, y para entonces el server tenia aplicados los inputs que le
   * habian llegado, no los que el jugador acababa de apretar. Corregir la posicion
   * actual contra ese numero — que es lo que hacia la primera version — tira
   * permanentemente hacia atras: con ~150 ms de ida y vuelta contra Railway el
   * pincel se siente atado con un elastico, y cada cambio de direccion arrastra un
   * rato la trayectoria vieja. En local no se notaba porque el retraso era cero.
   *
   * Comparar contra "donde estaba yo cuando el server capturo" tampoco alcanza: el
   * desfase pasa a ser de ida MAS vuelta (~30 px a esta velocidad) y, como se vuelve
   * a medir igual en cada snapshot, arrastraria el pincel hacia atras sin parar.
   *
   * La unica forma de no adivinar latencias es que el server diga **hasta que input
   * escucho** (`mine.n`). Con eso el cliente parte de la posicion autoritativa y
   * vuelve a aplicar por su cuenta, con la misma fisica, todos los inputs que mando
   * despues. Moviendose derecho el resultado coincide con la prediccion y no hay
   * correccion ninguna: el control responde al toque. Lo que queda es error real —
   * un aturdimiento, un tope contra el borde, un paquete perdido — y ese si se
   * corrige.
   */
  private reconcile(mine: PtPlayerView): void {
    // Server viejo (todavia sin redeployar): sin acuse no hay forma de reconciliar
    // sin inventar una latencia, y equivocarse es peor que no tocar nada.
    if (typeof mine.n !== "number") return;

    const from = this.inputs.findIndex((i) => i.n === mine.n);
    if (from < 0) return;
    // Todo lo anterior al acuse ya no hace falta.
    if (from > 0) this.inputs.splice(0, from);

    const now = performance.now();
    // El aturdimiento se aplica entero al tramo: dura mas que el tramo reproducido,
    // asi que partirlo no cambiaria nada apreciable.
    const speed = SPEED * (mine.st > 0 ? STUN_SPEED_FACTOR : 1);
    let x = mine.x;
    let y = mine.y;
    for (let i = 0; i < this.inputs.length; i++) {
      const input = this.inputs[i];
      const until = i + 1 < this.inputs.length ? this.inputs[i + 1].t : now;
      const dt = (until - input.t) / 1000;
      if (dt <= 0) continue;
      x = clamp(x + input.dx * speed * dt, 0, VIEW_WIDTH);
      y = clamp(y + input.dy * speed * dt, 0, VIEW_HEIGHT);
    }

    const dx = x - this.myX;
    const dy = y - this.myY;
    if (dx === 0 && dy === 0) return;
    this.myX = x;
    this.myY = y;

    // Un salto grande (reconexion, teletransporte) se muestra tal cual: disolverlo
    // dejaria el pincel dibujado lejos de donde el server dice que esta.
    if (Math.hypot(dx, dy) > SNAP_DIST) {
      this.visX = 0;
      this.visY = 0;
      return;
    }
    this.visX -= dx;
    this.visY -= dy;
  }

  private sendInput(dt: number): void {
    const splat = this.input.consumeSplat();
    this.inputTimer += dt;
    if (!splat && this.inputTimer < INPUT_INTERVAL) return;
    this.inputTimer = 0;
    const dir = this.worldDir();
    // Normalizado igual que en el server, para que la reproduccion de `reconcile`
    // use exactamente el mismo vector que el server va a aplicar.
    const len = Math.hypot(dir.x, dir.y);
    const dx = len > 0.001 ? dir.x / len : 0;
    const dy = len > 0.001 ? dir.y / len : 0;

    const n = ++this.inputSeq;
    this.inputs.push({ n, t: performance.now(), dx, dy });
    // Red de seguridad: si el acuse del server no llega (server viejo, o el input
    // se perdio), la lista no puede crecer para siempre.
    while (this.inputs.length > 2 && this.inputs[0].t < performance.now() - HISTORY_MS) {
      this.inputs.shift();
    }

    // El salpicon no espera al proximo tick de envio: es una accion de reflejos y
    // esperar el envio siguiente se siente como que el boton no responde.
    this.socket?.sendInput(dx, dy, splat, n);
    if (splat && this.myCooldown === 0) this.myCooldown = SPLAT_COOLDOWN_MS;
  }

  private updateHud(): void {
    const msLeft = this.latest?.msLeft ?? MATCH_MS;
    this.hud.setClock(msLeft);
    this.hud.setSplatCharge(1 - this.myCooldown / SPLAT_COOLDOWN_MS);
    this.hud.setScores(this.scoreRows());
  }

  // ---------- Render ----------

  private render(time: number): void {
    const { ctx } = this;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.save();
    ctx.scale(this.scale, this.scale);
    if (this.rotated) {
      // Tablero de costado: en un celular en vertical, una hoja apaisada entra como
      // una franja de un cuarto de pantalla. Rotandola ocupa casi todo, y el jugador
      // gira el telefono como haria con cualquier juego apaisado.
      ctx.translate(VIEW_HEIGHT / 2 + this.offsetX, VIEW_WIDTH / 2 + this.offsetY);
      ctx.rotate(Math.PI / 2);
      ctx.translate(-VIEW_WIDTH / 2, -VIEW_HEIGHT / 2);
    } else {
      ctx.translate(this.offsetX, this.offsetY);
    }
    ctx.beginPath();
    ctx.rect(0, 0, VIEW_WIDTH, VIEW_HEIGHT);
    ctx.clip();
    this.renderer.draw(ctx, this.brushViews(), time);
    ctx.restore();
    this.drawJoystick();
  }

  /**
   * La direccion pedida, llevada a las coordenadas del tablero. Con el tablero
   * rotado hay que rotar tambien el input, o "arriba" en la pantalla movería el
   * pincel de costado: pantalla +X -> mundo -Y, pantalla +Y -> mundo +X.
   */
  private worldDir(): { x: number; y: number } {
    const dir = this.input.direction;
    return this.rotated ? { x: dir.y, y: -dir.x } : dir;
  }

  /**
   * Los rivales se dibujan interpolando el buffer en `ahora - INTERP_DELAY` sobre
   * la linea de tiempo del server; el pincel propio, en su posicion predicha.
   */
  private brushViews(): BrushView[] {
    const state = this.latest;
    if (!state) return [];
    const rt = performance.now() - INTERP_DELAY;

    let a = this.snaps[0];
    let b = this.snaps[this.snaps.length - 1];
    if (this.snaps.length === 0) {
      a = b = { t: rt, pos: new Map() };
    } else if (rt <= a.t) {
      b = a; // antes del buffer: se fija al mas viejo
    } else if (rt >= b.t) {
      // Buffer agotado: falto un snapshot. Antes se fijaba al mas nuevo, o sea que
      // el rival se plantaba en seco y arrancaba de un salto cuando la red se
      // recuperaba. Se sigue su ultimo tramo un ratito (EXTRAPOLATE_MS), que es
      // casi siempre lo que el rival efectivamente hizo: los pinceles se mueven en
      // linea recta a velocidad constante.
      a = this.snaps.length > 1 ? this.snaps[this.snaps.length - 2] : b;
    } else {
      for (let i = this.snaps.length - 1; i > 0; i--) {
        if (this.snaps[i - 1].t <= rt && rt <= this.snaps[i].t) {
          a = this.snaps[i - 1];
          b = this.snaps[i];
          break;
        }
      }
    }
    const span = b.t - a.t;
    // f > 1 es extrapolacion, y se topea para no mandar al rival a la loma del
    // orto si la red se corta del todo.
    const raw = span > 0 ? (rt - a.t) / span : 0;
    const maxF = span > 0 ? 1 + EXTRAPOLATE_MS / span : 1;
    const f = Math.min(raw, maxF);

    const views: BrushView[] = [];
    for (const player of state.players) {
      const mine = player.i === this.mySeat;
      let x: number;
      let y: number;
      if (mine) {
        x = this.myX + this.visX;
        y = this.myY + this.visY;
      } else {
        const pa = a.pos.get(player.i) ?? { x: player.x, y: player.y };
        const pb = b.pos.get(player.i) ?? pa;
        x = pa.x + (pb.x - pa.x) * f;
        y = pa.y + (pb.y - pa.y) * f;
      }
      views.push({
        seat: player.i,
        x,
        y,
        name: this.seats[player.i] ?? "",
        stunned: mine ? this.myStun > 0 : player.st > 0,
        offline: !player.on,
        mine,
        // El pigmento fresco solo se dibuja en juego: en el congelado inicial y al
        // terminar, el tablero es exactamente el que confirmo el server.
        wet: this.state === "playing" ? BRUSH_RADIUS : 0,
      });
    }
    return views;
  }

  /** El joystick va en pixeles de pantalla, no en coordenadas de la vista. */
  private drawJoystick(): void {
    const stick = this.input.joystick;
    if (!stick || this.state !== "playing") return;
    const { ctx } = this;
    const dpr = window.devicePixelRatio || 1;
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.globalAlpha = 0.35;
    ctx.strokeStyle = "#1a1714";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(stick.originX, stick.originY, 52, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = "#1a1714";
    const dx = stick.x - stick.originX;
    const dy = stick.y - stick.originY;
    const len = Math.hypot(dx, dy) || 1;
    const clamped = Math.min(len, 52) / len;
    ctx.beginPath();
    ctx.arc(stick.originX + dx * clamped, stick.originY + dy * clamped, 18, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // ---------- Puntaje ----------

  private myCells(): number {
    return this.mySeat >= 0 ? (this.scores[this.mySeat] ?? 0) : 0;
  }

  private scoreRows(): ScoreRow[] {
    return this.seats.map((name, seat) => {
      const cells = this.scores[seat] ?? 0;
      return { seat, name, cells, pct: (cells / CELL_COUNT) * 100, mine: seat === this.mySeat };
    });
  }

  private showResults(): void {
    if (this.seats.length === 0) return;
    this.hud.showHud(false);
    this.hud.showResults(this.scoreRows());
  }

  // ---------- Escala ----------

  private scale = 1;
  private offsetX = 0;
  private offsetY = 0;
  /** La pantalla es mas alta que ancha: el tablero se dibuja de costado. */
  private rotated = false;

  private resize = (): void => {
    const dpr = window.devicePixelRatio || 1;
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.canvas.width = Math.floor(w * dpr);
    this.canvas.height = Math.floor(h * dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;

    // Con la pantalla en vertical el tablero entra de costado casi tres veces mas
    // grande, asi que se rota (ver `render`). El margen del 5% evita que una
    // ventana casi cuadrada quede oscilando entre las dos orientaciones.
    this.rotated = h > w * 1.05;
    const viewW = this.rotated ? VIEW_HEIGHT : VIEW_WIDTH;
    const viewH = this.rotated ? VIEW_WIDTH : VIEW_HEIGHT;

    const fit = Math.min(w / viewW, h / viewH);
    this.scale = fit * dpr;
    this.offsetX = (w / fit - viewW) / 2;
    this.offsetY = (h / fit - viewH) / 2;
  };

  dispose(): void {
    window.removeEventListener("resize", this.resize);
    this.input.dispose();
    this.socket?.dispose();
  }
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}
