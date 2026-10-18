import { randomBytes } from "node:crypto";
import type { VbDead, VbInit, VbPhase, VbPlayerInfo, VbSnap, VbTop } from "../protocol.js";
import { SpatialHash } from "./viborita-grid.js";
import { botSteer, newBrain, type BotBrain, type BotWorld } from "./viborita-bot.js";
import {
  VIBORITA_CONFIG as C,
  advanceHead,
  bodyLengthOf,
  clientConfig,
  modeConfig,
  pelletRadiusOf,
  radiusOf,
  turnRateOf,
  viewHeightOf,
  type ArenaKind,
  type ModeConfig,
} from "./viborita-config.js";

/**
 * Una arena de Viborita: la simulacion AUTORITATIVA de un mapa circular.
 *
 * El server es duenio de todo (posiciones, largo, choques). El cliente manda
 * unicamente su input — hacia donde apunta y si acelera — y el server decide cuanto
 * gira (limitado por el largo) y cuanto avanza.
 *
 * El cuerpo es el CAMINO de la cabeza: cada viborita guarda la estela de posiciones
 * de su cabeza y sus segmentos se muestrean sobre esa estela a distancia fija (por
 * largo de arco, no por cantidad de pasos). Asi el cuerpo no depende del tamano del
 * paso y el cliente, que arma la estela con las cabezas de los snapshots, llega al
 * mismo cuerpo (ver "Cuerpo" en el CLAUDE.md del juego).
 *
 * Paso fijo con acumulador y snapshot cada `snapshotEvery` pasos, con el chequeo
 * ADENTRO del bucle de pasos (ver "Interpolar sobre el reloj del server" en el
 * CLAUDE.md raiz). El mapa es un circulo de centro (R, R): las coordenadas quedan
 * en [0, 2R], que es lo que espera la spatial hash.
 */

const TICK_MS = 1000 / C.sim.tickHz;
/** Lado de un balde de la spatial hash. */
const HASH_CELL = 120;
/** Pasos entre dos `vb:top` (1 por segundo). */
const TOP_EVERY = C.sim.tickHz;
/** Separacion de los puntos del cuerpo entero (`k`) que se manda al entrar a la vista. */
const KEY_SPACING = 12;
/**
 * Cuanto puede correrse un cuerpo hacia atras al rebobinarlo (compensacion de lag):
 * lo que recorre con turbo en el tope de rebobinado. Los segmentos de choque y la
 * estela se guardan esa distancia mas alla de la cola.
 */
const REWIND_DIST = (C.snake.boostSpeed * C.lagComp.maxRewindMs) / 1000;
/** Estela guardada de mas: el rebobinado y por si el largo crece entre dos pasos. */
const TRAIL_MARGIN = REWIND_DIST + 40;

interface QueuedInput {
  /** simTime en que rige. */
  at: number;
  angle: number;
  boost: boolean;
  seq: number;
  /** simTime que el cliente estaba dibujando de las demas (-1: no sabe). */
  view: number;
}

export class Pellet {
  readonly r: number;

  constructor(
    readonly id: number,
    readonly x: number,
    readonly y: number,
    readonly color: number,
    readonly mass: number,
    /** Comida de un muerto o del turbo (no cuenta para la reposicion natural). */
    readonly drop: boolean,
  ) {
    this.r = pelletRadiusOf(mass);
  }
}

/** Un segmento del cuerpo para los choques. Se reutilizan entre pasos. */
export interface Segment {
  x: number;
  y: number;
  snake: Snake;
  /** Distancia desde la cabeza, sobre la estela. */
  s: number;
}

export class Snake {
  /** Estela de la cabeza, de la mas vieja a la mas nueva; desde `start`. */
  px: number[] = [];
  py: number[] = [];
  start = 0;
  /** Largo de la estela desde `start` hasta la cabeza. */
  pathLen = 0;

  /**
   * Segmentos muestreados en el ultimo paso (los primeros `nSeg` valen). Siguen
   * `REWIND_DIST` mas alla de la cola: esos solo cuentan cuando se rebobina el cuerpo.
   * `nBody` son los del cuerpo de ahora.
   */
  readonly segments: Segment[] = [];
  nSeg = 0;
  nBody = 0;
  /**
   * Odometro de la cabeza (cuanto recorrio desde que aparecio) y su historial reciente.
   * Rebobinar el cuerpo `dt` ms es correrlo hacia atras por su propio camino lo que
   * recorrio en ese tiempo: `offsetAt`.
   */
  odo = 0;
  private readonly histT: number[] = [];
  private readonly histOdo: number[] = [];
  minX = 0;
  minY = 0;
  maxX = 0;
  maxY = 0;

  /** El turbo esta corriendo (ademas de pedido, alcanza la masa). */
  boosting = false;
  private boostAcc = 0;

  constructor(
    readonly id: number,
    readonly owner: Player,
    public x: number,
    public y: number,
    public a: number,
    public mass: number,
  ) {
    // Arranca estirada hacia atras, en linea recta.
    const len = bodyLengthOf(mass);
    const steps = Math.ceil(len / 10);
    for (let i = steps; i >= 0; i--) {
      this.px.push(x - Math.cos(a) * (len * i) / steps);
      this.py.push(y - Math.sin(a) * (len * i) / steps);
    }
    this.pathLen = len;
  }

  get r(): number {
    return radiusOf(this.mass);
  }

  get bodyLength(): number {
    return bodyLengthOf(this.mass);
  }

  /** Agrega la cabeza actual a la estela y recorta lo que ya no es cuerpo. */
  pushHead(simTime: number): void {
    const n = this.px.length;
    const lx = this.px[n - 1];
    const ly = this.py[n - 1];
    const d = Math.hypot(this.x - lx, this.y - ly);
    this.histT.push(simTime);
    this.histOdo.push(this.odo + d);
    while (this.histT.length > 2 && this.histT[0] < simTime - C.lagComp.maxRewindMs - 100) {
      this.histT.shift();
      this.histOdo.shift();
    }
    if (d < 0.01) return;
    this.odo += d;
    this.px.push(this.x);
    this.py.push(this.y);
    this.pathLen += d;
    const keep = this.bodyLength + TRAIL_MARGIN;
    while (this.px.length - this.start > 2) {
      const s = this.start;
      const first = Math.hypot(this.px[s + 1] - this.px[s], this.py[s + 1] - this.py[s]);
      if (this.pathLen - first < keep) break;
      this.pathLen -= first;
      this.start++;
    }
    // Compacta de vez en cuando (shift de a uno seria O(n) por paso).
    if (this.start > 256) {
      this.px.splice(0, this.start);
      this.py.splice(0, this.start);
      this.start = 0;
    }
  }

  /**
   * Recorre el cuerpo de la cabeza a la cola, dando un punto cada `spacing` de largo
   * de arco sobre la estela, hasta `maxLen`. Es LA definicion del cuerpo: la usan los
   * choques, el cuerpo que se manda al cliente y la comida que deja al morir.
   */
  walkBody(spacing: number, maxLen: number, cb: (x: number, y: number) => void): void {
    let i = this.px.length - 1;
    let x = this.px[i];
    let y = this.py[i];
    cb(x, y);
    let travelled = 0;
    let next = spacing;
    while (i > this.start && next <= maxLen) {
      const nx = this.px[i - 1];
      const ny = this.py[i - 1];
      const seg = Math.hypot(nx - x, ny - y);
      if (travelled + seg >= next) {
        const f = (next - travelled) / seg;
        cb(x + (nx - x) * f, y + (ny - y) * f);
        next += spacing;
        continue; // mismo tramo: puede tener mas de un punto
      }
      travelled += seg;
      x = nx;
      y = ny;
      i--;
    }
  }

  /**
   * Cuanto hay que correr el cuerpo hacia atras (por su camino) para verlo como estaba
   * en `t`: lo que recorrio la cabeza desde entonces. 0 para el presente.
   */
  offsetAt(t: number): number {
    const n = this.histT.length;
    if (n === 0 || t >= this.histT[n - 1]) return 0;
    if (t <= this.histT[0]) return this.odo - this.histOdo[0];
    for (let i = n - 1; i > 0; i--) {
      if (this.histT[i - 1] <= t) {
        const f = (t - this.histT[i - 1]) / (this.histT[i] - this.histT[i - 1] || 1);
        return this.odo - (this.histOdo[i - 1] + (this.histOdo[i] - this.histOdo[i - 1]) * f);
      }
    }
    return 0;
  }

  /** Muestrea los segmentos de choque (con el tramo de rebobinado) y la caja del cuerpo. */
  sampleSegments(): void {
    const spacing = Math.max(4, this.r * C.snake.segmentSpacingK);
    const body = this.bodyLength;
    this.nSeg = 0;
    this.nBody = 0;
    this.minX = this.maxX = this.x;
    this.minY = this.maxY = this.y;
    this.walkBody(spacing, body + REWIND_DIST, (x, y) => {
      const s = this.nSeg * spacing;
      let seg = this.segments[this.nSeg];
      if (!seg) {
        seg = { x, y, snake: this, s };
        this.segments.push(seg);
      }
      seg.x = x;
      seg.y = y;
      seg.s = s;
      this.nSeg++;
      if (s > body) return;
      this.nBody++;
      if (x < this.minX) this.minX = x;
      if (x > this.maxX) this.maxX = x;
      if (y < this.minY) this.minY = y;
      if (y > this.maxY) this.maxY = y;
    });
  }

  /** Cobra el turbo de este paso. Devuelve la masa a dejar como comida (0 si nada). */
  chargeBoost(): number {
    if (!this.boosting) {
      this.boostAcc = 0;
      return 0;
    }
    this.boostAcc += TICK_MS;
    let dropped = 0;
    while (this.boostAcc >= C.boost.tickMs) {
      this.boostAcc -= C.boost.tickMs;
      const cost = Math.max(C.boost.costMin, this.mass * C.boost.costFrac);
      if (this.mass - cost < C.boost.minMass) break;
      this.mass -= cost;
      dropped += cost * C.boost.dropFrac;
    }
    return dropped;
  }

  /** Punta de la cola (donde cae la comida del turbo). */
  tail(): { x: number; y: number } {
    const s = this.segments[Math.max(0, this.nBody - 1)];
    return s ? { x: s.x, y: s.y } : { x: this.x, y: this.y };
  }
}

export class Player {
  socketId: string | null = null;
  /** simTime en que se corto su conexion (para la gracia de reconexion). */
  offSince = 0;
  /** Proporcion ancho/alto de su pantalla (para el culling). */
  aspect = 16 / 9;
  snake: Snake | null = null;

  // ---- Input ----
  angle = 0;
  boost = false;
  lastSeq = 0;
  /** simTime desde el que rige `lastSeq`. Viaja como `a` (= t - lastSeqAt). */
  lastSeqAt = 0;
  queue: QueuedInput[] = [];
  /** simTime estimado menos reloj del cliente. */
  clockOffset: number | null = null;
  /** Ultima vez que el input cambio (para la inactividad). */
  lastActiveAt = 0;
  /**
   * Cuanto atras (ms) estaba viendo a las demas este jugador, segun su ultimo input
   * aplicado. Sus choques se juzgan contra los cuerpos rebobinados eso. 0 = presente
   * (los bots, o un cliente que todavia no sabe su reloj).
   */
  viewLag = 0;

  // ---- Vida ----
  /** Ya aparecio alguna vez (en sala hay una sola vida). */
  everSpawned = false;
  bornAt = 0;
  peak = 0;
  deadAt = -Infinity;
  /** Donde mira el espectador: donde murio, o el centro del mapa. */
  camX = 0;
  camY = 0;

  /** Lo que este cliente ya tiene: el snapshot le manda solo las diferencias. */
  readonly knownPellets = new Set<number>();
  readonly knownSnakes = new Set<number>();
  /** Solo los bots: su estado de paseo. */
  brain: BotBrain | null = null;

  constructor(
    readonly id: number,
    public name: string,
    readonly color: number,
    readonly bot: boolean,
    readonly token: string,
  ) {}

  get alive(): boolean {
    return this.snake !== null;
  }

  get mass(): number {
    return this.snake?.mass ?? 0;
  }

  /** Se suelta el control: nadie lo maneja (se fue) o lo toma una pagina nueva (F5). */
  release(simTime: number): void {
    // Sin nadie manejandola sigue derecho (como en slither): no se puede frenar.
    if (this.snake) this.angle = this.snake.a;
    this.boost = false;
    this.queue = [];
    this.lastSeq = 0;
    this.lastSeqAt = simTime;
    this.clockOffset = null;
    this.viewLag = 0;
  }

  info(): VbPlayerInfo {
    return [this.id, this.name, this.color, this.bot ? 1 : 0];
  }
}

export interface ArenaHost {
  emit(socketId: string, event: string, payload: unknown): void;
  /** La arena se quedo sin conexiones: el administrador la descarta. */
  onEmpty(arena: Arena): void;
}

/** Colores de jugador (el cliente los mapea a su paleta). */
export const PLAYER_COLORS = 12;

export class Arena {
  readonly mode: ModeConfig;
  readonly R: number;
  readonly players = new Map<number, Player>();
  readonly pellets = new Map<number, Pellet>();
  private readonly pelletHash: SpatialHash<Pellet>;
  /** Segmentos de todos los cuerpos; se reconstruye en cada paso. */
  private readonly segHash: SpatialHash<Segment>;
  private phase: VbPhase = "playing";
  private naturalPellets = 0;
  private dropPellets = 0;
  private maxR = 0;

  private nextPlayerId = 1;
  private nextSnakeId = 1;
  private nextPelletId = 1;
  private nextColor = 0;

  private loop: ReturnType<typeof setInterval> | null = null;
  private lastTick = Date.now();
  private acc = 0;
  /** Reloj de la simulacion (ms): avanza de a TICK_MS exactos y viaja en `vb:snap.t`. */
  private simTime = 0;
  private stepNo = 0;

  constructor(
    readonly key: string,
    readonly kind: ArenaKind,
    private readonly host: ArenaHost,
  ) {
    // Copia: nada de lo que haga una arena puede tocar la config compartida.
    this.mode = { ...modeConfig(kind) };
    this.R = this.mode.mapRadius;
    this.pelletHash = new SpatialHash(this.R * 2, HASH_CELL);
    this.segHash = new SpatialHash(this.R * 2, HASH_CELL);
    while (this.naturalPellets < this.mode.pelletCount) this.addNaturalPellet();
    while (this.botCount < this.botTarget()) this.addBot();
    this.loop = setInterval(() => this.tick(), TICK_MS);
  }

  // ---------------------------------------------------------------- conexiones

  /** Cuantas conexiones tiene (jugando o mirando). Es lo que llena una arena publica. */
  get socketCount(): number {
    let n = 0;
    for (const p of this.players.values()) if (p.socketId) n++;
    return n;
  }

  get humanCount(): number {
    let n = 0;
    for (const p of this.players.values()) if (!p.bot) n++;
    return n;
  }

  get botCount(): number {
    let n = 0;
    for (const p of this.players.values()) if (p.bot) n++;
    return n;
  }

  findByToken(token: string): Player | undefined {
    for (const p of this.players.values()) if (p.token === token && !p.bot) return p;
    return undefined;
  }

  findByName(name: string): Player | undefined {
    for (const p of this.players.values()) if (p.name === name && !p.bot) return p;
    return undefined;
  }

  /** Jugador nuevo (todavia espectador: aparece con `spawn`). */
  addHuman(socketId: string, name: string, aspect: number): Player {
    const player = new Player(this.nextPlayerId++, name, this.takeColor(), false, randomBytes(12).toString("hex"));
    player.camX = this.R;
    player.camY = this.R;
    this.players.set(player.id, player);
    this.broadcastPlayers({ add: [player.info()] });
    this.attach(player, socketId, aspect);
    return player;
  }

  /** Engancha un socket a un jugador (nuevo, o uno que vuelve de un corte / F5). */
  attach(player: Player, socketId: string, aspect: number): void {
    player.socketId = socketId;
    player.aspect = aspect;
    // Una pagina nueva numera sus inputs desde 1 y no tiene nada dibujado.
    player.release(this.simTime);
    player.lastActiveAt = this.simTime;
    player.knownPellets.clear();
    player.knownSnakes.clear();
    const init: VbInit = {
      cfg: clientConfig(this.kind),
      me: player.id,
      tk: player.token,
      players: [...this.players.values()].map((p) => p.info()),
      alive: player.alive,
      canSpawn: this.phase === "playing" && !player.alive && (this.mode.respawn || !player.everSpawned),
      phase: this.phase,
    };
    this.host.emit(socketId, "vb:init", init);
  }

  detach(player: Player): void {
    player.socketId = null;
    player.offSince = this.simTime;
    player.release(this.simTime);
  }

  setAspect(player: Player, aspect: number): void {
    player.aspect = aspect;
  }

  spawn(player: Player, name: string): boolean {
    if (player.alive || this.phase !== "playing") return false;
    // En sala hay una sola vida: el que ya aparecio y murio queda mirando.
    if (player.everSpawned && !this.mode.respawn) return false;
    if (this.simTime - player.deadAt < C.net.spawnCooldownMs) return false;
    player.name = name;
    this.broadcastPlayers({ add: [player.info()] });
    const at = this.spawnPoint();
    const mass = C.snake.startMass;
    player.snake = new Snake(this.nextSnakeId++, player, at.x, at.y, at.a, mass);
    player.snake.sampleSegments();
    player.everSpawned = true;
    player.bornAt = this.simTime;
    player.peak = mass;
    player.lastActiveAt = this.simTime;
    player.release(this.simTime);
    if (player.socketId) this.host.emit(player.socketId, "vb:spawned", { mass });
    return true;
  }

  // ---------------------------------------------------------------- input

  input(player: Player, seq: number, sentAt: number, angle: number, boost: boolean, view: number): void {
    // Solo hacia adelante: un mensaje fuera de orden no puede hacer reconciliar al
    // cliente contra un input viejo.
    if (seq <= player.lastSeq) return;
    const last = player.queue[player.queue.length - 1];
    if (last && seq <= last.seq) return;

    const now = this.nowSim();
    const sample = now - sentAt;
    if (player.clockOffset === null || sample < player.clockOffset) player.clockOffset = sample;
    else player.clockOffset += (sample - player.clockOffset) * C.sim.inputOffsetDrift;
    const buffer = C.sim.inputBufferMs;
    // Nunca en el pasado ni mas lejos que el buffer: el reloj lo manda el cliente y no
    // puede usarlo para cargar inputs a futuro.
    let at = clamp(sentAt + player.clockOffset + buffer, now, now + buffer);
    if (last) at = Math.max(at, last.at);

    const prev = last ?? player;
    if (Math.abs(angle - prev.angle) > 0.02 || boost !== prev.boost) player.lastActiveAt = this.simTime;
    player.queue.push({ at, angle, boost, seq, view });
  }

  /** Instante actual en la linea de tiempo de la simulacion, con el resto sin simular. */
  private nowSim(): number {
    return this.simTime + this.acc + (Date.now() - this.lastTick);
  }

  // ---------------------------------------------------------------- simulacion

  private tick(): void {
    const now = Date.now();
    this.acc = Math.min(this.acc + (now - this.lastTick), C.sim.maxCatchupMs);
    this.lastTick = now;

    while (this.acc >= TICK_MS) {
      this.acc -= TICK_MS;
      this.simTime += TICK_MS;
      this.stepNo++;
      this.step();
      // Adentro del bucle: el espaciado es exactamente snapshotEvery pasos.
      if (this.stepNo % C.sim.snapshotEvery === 0) this.broadcastSnapshots();
    }
  }

  private step(): void {
    // Terminada (sala con ganador), la arena queda congelada mostrando el final.
    if (this.phase !== "playing") return;
    if (this.stepNo % C.bots.thinkEvery === 0) this.thinkBots();
    if (this.stepNo % TOP_EVERY === 0) this.manageBots();

    for (const player of this.players.values()) this.stepPlayer(player);
    this.rebuildSegments();
    this.eatPellets();
    this.crashes();
    this.refillPellets();
    this.expirePlayers();
    this.checkWinner();
    if (this.stepNo % TOP_EVERY === 0) this.broadcastTop();
  }

  private stepPlayer(player: Player): void {
    const snake = player.snake;
    // El paso cubre (simTime - TICK_MS, simTime]. Un input que rige a mitad del paso
    // lo parte ahi, para que dure lo mismo que en el cliente.
    let from = this.simTime - TICK_MS;
    while (player.queue.length > 0 && player.queue[0].at <= this.simTime) {
      const input = player.queue.shift()!;
      const at = Math.max(input.at, from);
      if (snake) this.moveSnake(player, snake, at - from);
      from = at;
      player.angle = input.angle;
      player.boost = input.boost;
      player.lastSeq = input.seq;
      player.lastSeqAt = at;
      // Lo que veia el cliente cuando mando este input, medido contra el instante en
      // que el input rige (es cuando su cabeza esta donde el la veia).
      player.viewLag = input.view < 0 ? 0 : clamp(at - input.view, 0, C.lagComp.maxRewindMs);
    }
    if (!snake) return;
    this.moveSnake(player, snake, this.simTime - from);
    snake.pushHead(this.simTime);

    const dropped = snake.chargeBoost();
    if (dropped > 0) {
      const t = snake.tail();
      this.addDrop(t.x, t.y, dropped, player.color);
    }
  }

  private moveSnake(player: Player, snake: Snake, ms: number): void {
    if (ms <= 0) return;
    snake.boosting = player.boost && snake.mass >= C.boost.minMass;
    const v = snake.boosting ? C.snake.boostSpeed : C.snake.speed;
    advanceHead(snake, player.angle, turnRateOf(snake.mass), v, ms / 1000);
  }

  private rebuildSegments(): void {
    this.segHash.clear();
    this.maxR = 0;
    for (const player of this.players.values()) {
      const snake = player.snake;
      if (!snake) continue;
      snake.sampleSegments();
      this.maxR = Math.max(this.maxR, snake.r);
      for (let i = 0; i < snake.nSeg; i++) this.segHash.insert(snake.segments[i]);
    }
  }

  /** La boca es un poco mas grande que la cabeza: la comida se "aspira". */
  private eatPellets(): void {
    const eaten: Pellet[] = [];
    const maxPelletR = pelletRadiusOf(C.pellet.deathDropMax);
    for (const player of this.players.values()) {
      const snake = player.snake;
      if (!snake) continue;
      const mouth = snake.r * C.snake.mouthK;
      const range = mouth + maxPelletR;
      this.pelletHash.query(snake.x - range, snake.y - range, snake.x + range, snake.y + range, (p) => {
        const reach = mouth + p.r;
        if ((p.x - snake.x) ** 2 + (p.y - snake.y) ** 2 < reach * reach) eaten.push(p);
      });
      for (const p of eaten) {
        if (!this.pellets.has(p.id)) continue; // otra cabeza llego antes este paso
        this.removePellet(p);
        snake.mass = Math.min(C.snake.maxMass, snake.mass + p.mass);
        if (snake.mass > player.peak) player.peak = snake.mass;
      }
      eaten.length = 0;
    }
  }

  /**
   * Choques: la cabeza contra el borde del circulo, o contra un segmento de OTRA
   * viborita (el propio cuerpo no mata). Primero se juntan todos y despues se aplican:
   * dos cabezas que se tocan mueren las dos, como en slither.
   *
   * Compensacion de lag: la cabeza de cada jugador se compara contra los cuerpos ajenos
   * REBOBINADOS a lo que el veia (`viewLag`). Un cuerpo rebobinado es el mismo camino
   * corrido hacia atras lo que recorrio la cabeza desde entonces (`offsetAt`), asi que
   * alcanza con filtrar los segmentos por su distancia a la cabeza: no hace falta
   * guardar copias del cuerpo. Cada uno muere solo si en SU pantalla toco a otro.
   */
  private crashes(): void {
    const deaths: { player: Player; by: Player | null; reason: VbDead["reason"] }[] = [];
    for (const player of this.players.values()) {
      const snake = player.snake;
      if (!snake) continue;
      const r = snake.r;
      if (Math.hypot(snake.x - this.R, snake.y - this.R) + r > this.R) {
        deaths.push({ player, by: null, reason: "wall" });
        continue;
      }
      const range = r + this.maxR;
      const lag = player.viewLag;
      const offsets = new Map<Snake, number>();
      let killer: Player | null = null;
      this.segHash.query(snake.x - range, snake.y - range, snake.x + range, snake.y + range, (seg) => {
        if (killer || seg.snake === snake) return;
        let shift = offsets.get(seg.snake);
        if (shift === undefined) {
          shift = lag > 0 ? seg.snake.offsetAt(this.simTime - lag) : 0;
          offsets.set(seg.snake, shift);
        }
        // Fuera del cuerpo que veia: adelante de la cabeza de entonces o detras de la cola.
        if (seg.s < shift - seg.snake.r * 0.5 || seg.s > shift + seg.snake.bodyLength) return;
        const reach = seg.snake.r + r * C.snake.crashK;
        if ((seg.x - snake.x) ** 2 + (seg.y - snake.y) ** 2 < reach * reach) killer = seg.snake.owner;
      });
      if (killer) deaths.push({ player, by: killer, reason: "crash" });
    }
    for (const d of deaths) this.kill(d.player, d.by?.name ?? null, d.reason);
  }

  /** Muere: el cuerpo se convierte en comida a lo largo de donde estaba. */
  private kill(player: Player, by: string | null, reason: VbDead["reason"]): void {
    const snake = player.snake;
    if (!snake) return;
    const total = snake.mass * C.pellet.deathDropFrac;
    const spacing = Math.max(10, snake.r * 1.4);
    let points = 0;
    snake.walkBody(spacing, snake.bodyLength, () => points++);
    const each = clamp(total / Math.max(1, points), C.pellet.deathDropMin, C.pellet.deathDropMax);
    let left = total;
    snake.walkBody(spacing, snake.bodyLength, (x, y) => {
      if (left <= 0) return;
      const m = Math.min(each, left);
      left -= m;
      const j = snake.r * 0.6;
      this.addDrop(x + (Math.random() - 0.5) * j, y + (Math.random() - 0.5) * j, m, player.color);
    });

    player.camX = snake.x;
    player.camY = snake.y;
    player.snake = null;
    player.deadAt = this.simTime;
    if (player.socketId) {
      const dead: VbDead = {
        peak: Math.round(player.peak),
        by,
        ms: Math.round(this.simTime - player.bornAt),
        reason,
      };
      this.host.emit(player.socketId, "vb:dead", dead);
    }
  }

  /** Sala: el primer humano que llega a la meta gana y la arena se congela. */
  private checkWinner(): void {
    const target = this.mode.winMass;
    if (target <= 0) return;
    for (const player of this.players.values()) {
      if (player.bot || player.mass < target) continue;
      this.phase = "over";
      const msg = { winner: player.name, mass: Math.round(player.mass) };
      for (const p of this.players.values()) if (p.socketId) this.host.emit(p.socketId, "vb:over", msg);
      return;
    }
  }

  /** Saca a los desconectados que no volvieron a tiempo y a los inactivos. */
  private expirePlayers(): void {
    for (const player of this.players.values()) {
      if (player.bot) continue;
      if (!player.socketId && this.simTime - player.offSince > this.mode.reconnectGraceMs) {
        this.kill(player, null, "afk");
        this.removePlayer(player);
        continue;
      }
      // Red de seguridad: el que no toca nada ya se estrella solo contra el borde,
      // pero alguien puede dejar el joystick apretado dando vueltas.
      if (player.alive && this.simTime - player.lastActiveAt > this.mode.afkMs) {
        this.kill(player, null, "afk");
      }
    }
    // Sin conexiones y sin nadie esperando reconectarse, la arena no tiene para quien
    // simular: se descarta (los bots se van con ella).
    if (this.socketCount === 0 && this.humanCount === 0) this.dispose();
  }

  private removePlayer(player: Player): void {
    player.snake = null;
    this.players.delete(player.id);
    this.broadcastPlayers({ del: [player.id] });
  }

  /**
   * Lugar para aparecer: de varios candidatos al azar dentro del circulo, el mas
   * lejos de cualquier cuerpo, mirando mas o menos hacia el centro.
   */
  private spawnPoint(): { x: number; y: number; a: number } {
    let best = { x: this.R, y: this.R };
    let bestScore = -Infinity;
    for (let i = 0; i < 14; i++) {
      const ang = Math.random() * Math.PI * 2;
      const dist = Math.sqrt(Math.random()) * this.R * 0.7;
      const x = this.R + Math.cos(ang) * dist;
      const y = this.R + Math.sin(ang) * dist;
      let score = 400;
      this.segHash.query(x - 400, y - 400, x + 400, y + 400, (seg) => {
        score = Math.min(score, Math.hypot(seg.x - x, seg.y - y) - seg.snake.r);
      });
      if (score > bestScore) {
        bestScore = score;
        best = { x, y };
      }
    }
    const toCenter = Math.atan2(this.R - best.y, this.R - best.x);
    return { ...best, a: toCenter + (Math.random() - 0.5) * 1.5 };
  }

  private takeColor(): number {
    return this.nextColor++ % PLAYER_COLORS;
  }

  // ---------------------------------------------------------------- bots

  private botTarget(): number {
    if (!C.bots.enabled) return 0;
    return this.mode.botsYield ? Math.max(0, this.mode.bots - this.humanCount) : this.mode.bots;
  }

  private addBot(): void {
    const names = C.bots.names;
    const used = new Set([...this.players.values()].filter((p) => p.bot).map((p) => p.name));
    const name = names.find((n) => !used.has(n)) ?? names[this.nextPlayerId % names.length];
    const bot = new Player(this.nextPlayerId++, name, this.takeColor(), true, "");
    bot.brain = newBrain();
    this.players.set(bot.id, bot);
    this.spawn(bot, name);
  }

  /** Una vez por segundo: reaparecen los muertos y, si sobran (entraron humanos), se van. */
  private manageBots(): void {
    const target = this.botTarget();
    let count = this.botCount;
    for (const bot of this.players.values()) {
      if (!bot.bot || bot.alive || this.simTime - bot.deadAt < C.bots.respawnMs) continue;
      if (count > target) {
        // Se va al morir, no a mitad de vida: desaparecer de golpe se veria como un bug.
        this.removePlayer(bot);
        count--;
      } else {
        this.spawn(bot, bot.name);
      }
    }
    if (count < target) this.addBot();
  }

  private thinkBots(): void {
    for (const bot of this.players.values()) {
      if (!bot.bot || !bot.brain || !bot.snake) continue;
      const snake = bot.snake;
      const world: BotWorld = {
        R: this.R,
        querySegments: (x0, y0, x1, y1, cb) =>
          this.segHash.query(x0, y0, x1, y1, (seg) => {
            if (seg.snake !== snake && seg.s <= seg.snake.bodyLength) cb(seg.x, seg.y, seg.snake.r);
          }),
        queryPellets: (x0, y0, x1, y1, cb) => this.pelletHash.query(x0, y0, x1, y1, (p) => cb(p.x, p.y, p.mass)),
        queryHeads: (x0, y0, x1, y1, cb) => {
          for (const other of this.players.values()) {
            const s = other.snake;
            if (!s || s === snake || s.x < x0 || s.x > x1 || s.y < y0 || s.y > y1) continue;
            cb(s.x, s.y, s.a, s.mass);
          }
        },
      };
      const out = botSteer(snake, bot.brain, world, this.simTime);
      bot.angle = out.angle;
      bot.boost = out.boost;
    }
  }

  // ---------------------------------------------------------------- comida

  private randomInside(margin: number): { x: number; y: number } {
    const ang = Math.random() * Math.PI * 2;
    const dist = Math.sqrt(Math.random()) * (this.R - margin);
    return { x: this.R + Math.cos(ang) * dist, y: this.R + Math.sin(ang) * dist };
  }

  private addNaturalPellet(): void {
    const at = this.randomInside(30);
    const p = new Pellet(
      this.nextPelletId++,
      Math.round(at.x),
      Math.round(at.y),
      Math.floor(Math.random() * C.pellet.colors),
      C.pellet.mass,
      false,
    );
    this.pellets.set(p.id, p);
    this.pelletHash.insert(p);
    this.naturalPellets++;
  }

  /** Comida de un muerto o del turbo, del color de quien la dejo. */
  private addDrop(x: number, y: number, mass: number, color: number): void {
    if (this.dropPellets >= C.pellet.maxDrops || mass <= 0) return;
    // Adentro del mapa: un muerto contra el borde no puede dejar comida afuera.
    const dx = x - this.R;
    const dy = y - this.R;
    const d = Math.hypot(dx, dy);
    const max = this.R - 20;
    if (d > max) {
      x = this.R + (dx / d) * max;
      y = this.R + (dy / d) * max;
    }
    const p = new Pellet(this.nextPelletId++, Math.round(x), Math.round(y), color % C.pellet.colors, mass, true);
    this.pellets.set(p.id, p);
    this.pelletHash.insert(p);
    this.dropPellets++;
  }

  private removePellet(p: Pellet): void {
    this.pellets.delete(p.id);
    this.pelletHash.remove(p);
    if (p.drop) this.dropPellets--;
    else this.naturalPellets--;
  }

  /** De a poco: que la comida no reaparezca toda junta donde se la acaban de comer. */
  private refillPellets(): void {
    for (let i = 0; i < C.pellet.respawnPerTick && this.naturalPellets < this.mode.pelletCount; i++) {
      this.addNaturalPellet();
    }
  }

  // ---------------------------------------------------------------- salida

  /**
   * Un snapshot POR CLIENTE, con solo lo que entra en su vista (culling por viewport).
   * Una viborita entra si su CAJA (todo el cuerpo, no solo la cabeza) toca la vista:
   * una larga cruzando la pantalla con la cabeza afuera igual se tiene que ver.
   */
  private broadcastSnapshots(): void {
    for (const player of this.players.values()) {
      if (!player.socketId) continue;
      const view = this.viewOf(player);
      const snap: VbSnap = {
        t: this.simTime,
        s: [],
        n: player.lastSeq,
        a: Math.round((this.simTime - player.lastSeqAt) * 10) / 10,
      };
      if (!player.alive) {
        snap.cx = Math.round(view.x);
        snap.cy = Math.round(view.y);
      }
      this.snakeDiff(player, snap, view);
      this.pelletDiff(player, snap, view);
      this.host.emit(player.socketId, "vb:snap", snap);
    }
  }

  /** Centro y medio tamano de lo que ve el jugador (ya con el margen del culling). */
  private viewOf(player: Player): { x: number; y: number; hw: number; hh: number } {
    const snake = player.snake;
    const x = snake ? snake.x : player.camX;
    const y = snake ? snake.y : player.camY;
    const viewH = snake ? viewHeightOf(snake.mass) : C.view.spectatorHeight;
    const hh = (viewH / 2) * C.view.cullMargin;
    return { x, y, hh, hw: hh * player.aspect };
  }

  private snakeDiff(player: Player, snap: VbSnap, view: { x: number; y: number; hw: number; hh: number }): void {
    const known = player.knownSnakes;
    const visible = new Set<number>();
    const keys: number[] = [];
    for (const other of this.players.values()) {
      const s = other.snake;
      if (!s) continue;
      const r = s.r;
      const inView =
        other === player ||
        (s.maxX + r >= view.x - view.hw &&
          s.minX - r <= view.x + view.hw &&
          s.maxY + r >= view.y - view.hh &&
          s.minY - r <= view.y + view.hh);
      if (!inView) continue;
      visible.add(s.id);
      snap.s.push(
        s.id,
        other.id,
        Math.round(s.x * 10) / 10,
        Math.round(s.y * 10) / 10,
        Math.round(s.a * 1000),
        Math.round(s.mass * 10),
        s.boosting ? 1 : 0,
      );
      if (known.has(s.id)) continue;
      known.add(s.id);
      // Primera vez que la ve: el cuerpo entero, para sembrar la estela.
      const at = keys.length;
      keys.push(s.id, 0);
      let count = 0;
      s.walkBody(KEY_SPACING, s.bodyLength, (x, y) => {
        keys.push(Math.round(x), Math.round(y));
        count++;
      });
      keys[at + 1] = count;
    }
    for (const id of known) if (!visible.has(id)) known.delete(id);
    if (keys.length > 0) snap.k = keys;
  }

  /**
   * Comida que entra a la vista y la que sale (comida o fuera de rango), respecto de
   * lo que el cliente ya tiene dibujado. La comida no se mueve, asi que mandarla en
   * cada snapshot seria repetir lo mismo veinte veces por segundo.
   */
  private pelletDiff(player: Player, snap: VbSnap, view: { x: number; y: number; hw: number; hh: number }): void {
    const known = player.knownPellets;
    const add: number[] = [];
    const del: number[] = [];
    const visible = new Set<number>();
    this.pelletHash.query(view.x - view.hw, view.y - view.hh, view.x + view.hw, view.y + view.hh, (p) => {
      visible.add(p.id);
      if (known.has(p.id)) return;
      known.add(p.id);
      add.push(p.id, p.x, p.y, p.color, Math.round(p.mass * 10));
    });
    for (const id of known) {
      if (visible.has(id)) continue;
      known.delete(id);
      del.push(id);
    }
    if (add.length > 0) snap.pa = add;
    if (del.length > 0) snap.pd = del;
  }

  /** Top 10 por largo y el puesto de cada uno. */
  private broadcastTop(): void {
    const ranked = [...this.players.values()].filter((p) => p.alive).sort((a, b) => b.mass - a.mass);
    const top: [number, number][] = ranked.slice(0, 10).map((p) => [p.id, Math.round(p.mass)]);
    for (const player of this.players.values()) {
      if (!player.socketId) continue;
      const msg: VbTop = { top, rank: player.alive ? ranked.indexOf(player) + 1 : 0, alive: ranked.length };
      this.host.emit(player.socketId, "vb:top", msg);
    }
  }

  private broadcastPlayers(msg: { add?: VbPlayerInfo[]; del?: number[] }): void {
    for (const player of this.players.values()) {
      if (player.socketId) this.host.emit(player.socketId, "vb:players", msg);
    }
  }

  dispose(): void {
    if (this.loop === null) return;
    clearInterval(this.loop);
    this.loop = null;
    this.host.onEmpty(this);
  }
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}
