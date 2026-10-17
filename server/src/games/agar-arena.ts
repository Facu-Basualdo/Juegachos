import { randomBytes } from "node:crypto";
import type { AgDead, AgInit, AgPhase, AgPlayerInfo, AgSnap, AgTop } from "../protocol.js";
import { SpatialHash } from "./agar-grid.js";
import {
  AGAR_CONFIG,
  clientConfig,
  modeConfig,
  radiusOf,
  speedOf,
  type ArenaKind,
  type ModeConfig,
} from "./agar-config.js";

/**
 * Una arena de Agar: la simulacion AUTORITATIVA de un mapa.
 *
 * El server es duenio de todo (posiciones, masa, quien se come a quien). El cliente
 * manda unicamente su input — un vector con modulo <= 1 — y el server decide cuanto
 * se mueve con la masa que el sabe que tiene. Declarar posicion o masa, como hace la
 * paleta de PONG, dejaria teletransportarse o inflarse desde las devtools.
 *
 * Paso fijo con acumulador (`tickHz`) y snapshots cada `snapshotEvery` pasos, con el
 * chequeo ADENTRO del bucle de pasos: es lo que hace que el espaciado sea exacto y no
 * herede el jitter del `setInterval` (ver el CLAUDE.md raiz, "Interpolar sobre el
 * reloj del server").
 *
 * Cada conexion es un `Player`, tenga celula viva o no: el que no la tiene mira la
 * arena como espectador. Los bots son `Player` sin socket.
 */

const TICK_MS = 1000 / AGAR_CONFIG.sim.tickHz;
/** Lado de un balde de la spatial hash. Del orden de una celula mediana. */
const HASH_CELL = 200;
/** Pasos entre dos `ag:top` (1 por segundo). */
const TOP_EVERY = AGAR_CONFIG.sim.tickHz;

interface QueuedInput {
  /** simTime en que rige. */
  at: number;
  dx: number;
  dy: number;
  act: number;
  seq: number;
}

export class Pellet {
  constructor(
    readonly id: number,
    readonly x: number,
    readonly y: number,
    readonly color: number,
  ) {}
}

export class Cell {
  /**
   * Impulso aparte del input (u/s). Hoy siempre es cero: es la entrada para dividir
   * (Espacio) y expulsar masa (W), que lanzan una celula y la dejan frenar sola. El
   * paso ya lo integra y lo amortigua, asi que agregarlos es crear la celula con
   * impulso y nada mas.
   */
  vx = 0;
  vy = 0;

  constructor(
    readonly id: number,
    readonly owner: Player,
    public x: number,
    public y: number,
    public mass: number,
  ) {}

  get r(): number {
    return radiusOf(this.mass);
  }
}

export class Player {
  socketId: string | null = null;
  /** simTime en que se corto su conexion (para la gracia de reconexion). */
  offSince = 0;
  /** Proporcion ancho/alto de su pantalla (para el culling). */
  aspect = 16 / 9;

  /**
   * Celulas propias. Hoy hay una sola, pero todo (movimiento, colisiones, culling,
   * camara del cliente) ya itera la lista: dividir es agregar elementos.
   */
  cells: Cell[] = [];

  // ---- Input ----
  dx = 0;
  dy = 0;
  act = 0;
  lastSeq = 0;
  /** simTime desde el que rige `lastSeq`. Viaja como `a` (= t - lastSeqAt). */
  lastSeqAt = 0;
  queue: QueuedInput[] = [];
  /** simTime estimado menos reloj del cliente. */
  clockOffset: number | null = null;
  /** Ultima vez que el input cambio (para la inactividad). */
  lastActiveAt = 0;

  // ---- Vida ----
  /** Ya aparecio alguna vez (en sala hay una sola vida). */
  everSpawned = false;
  bornAt = 0;
  peak = 0;
  deadAt = -Infinity;
  /** Donde mira el espectador: donde murio, o el centro del mapa. */
  camX = 0;
  camY = 0;

  /** Comida que este cliente ya tiene dibujada: el snapshot le manda solo las diferencias. */
  readonly knownPellets = new Set<number>();

  constructor(
    readonly id: number,
    public name: string,
    readonly color: number,
    readonly bot: boolean,
    readonly token: string,
  ) {}

  get alive(): boolean {
    return this.cells.length > 0;
  }

  get mass(): number {
    let m = 0;
    for (const c of this.cells) m += c.mass;
    return m;
  }

  /** Se suelta el control: nadie lo maneja (se fue) o lo toma una pagina nueva (F5). */
  release(simTime: number): void {
    this.dx = 0;
    this.dy = 0;
    this.act = 0;
    this.queue = [];
    this.lastSeq = 0;
    this.lastSeqAt = simTime;
    this.clockOffset = null;
  }

  info(): AgPlayerInfo {
    return [this.id, this.name, this.color, this.bot ? 1 : 0];
  }
}

export interface ArenaHost {
  emit(socketId: string, event: string, payload: unknown): void;
  /** La arena se quedo sin conexiones: el administrador la descarta. */
  onEmpty(arena: Arena): void;
}

export class Arena {
  readonly mode: ModeConfig;
  readonly size: number;
  readonly players = new Map<number, Player>();
  readonly pellets = new Map<number, Pellet>();
  private readonly pelletHash: SpatialHash<Pellet>;
  /** Se reconstruye en cada paso: las celulas se mueven. */
  private readonly cellHash: SpatialHash<Cell>;
  private phase: AgPhase = "playing";
  private nextPelletId = 1;

  private nextPlayerId = 1;
  private nextCellId = 1;
  private nextColor = 0;

  private loop: ReturnType<typeof setInterval> | null = null;
  private lastTick = Date.now();
  private acc = 0;
  /** Reloj de la simulacion (ms): avanza de a TICK_MS exactos y viaja en `ag:snap.t`. */
  private simTime = 0;
  private stepNo = 0;

  constructor(
    readonly key: string,
    readonly kind: ArenaKind,
    private readonly host: ArenaHost,
  ) {
    this.mode = modeConfig(kind);
    this.size = this.mode.mapSize;
    this.pelletHash = new SpatialHash(this.size, HASH_CELL);
    this.cellHash = new SpatialHash(this.size, HASH_CELL);
    while (this.pellets.size < this.mode.pelletCount) this.addPellet();
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
    player.camX = this.size / 2;
    player.camY = this.size / 2;
    this.players.set(player.id, player);
    this.broadcastPlayers({ add: [player.info()] });
    this.attach(player, socketId, aspect);
    return player;
  }

  /** Engancha un socket a un jugador (nuevo, o uno que vuelve de un corte / F5). */
  attach(player: Player, socketId: string, aspect: number): void {
    player.socketId = socketId;
    player.aspect = aspect;
    // Una pagina nueva numera sus inputs desde 1: con el `lastSeq` viejo el server no
    // le acusaria ninguno y el cliente no podria reconciliar.
    player.release(this.simTime);
    player.lastActiveAt = this.simTime;
    // Pagina nueva = no tiene nada dibujado: el proximo snapshot le manda toda la comida.
    player.knownPellets.clear();
    const init: AgInit = {
      cfg: clientConfig(this.kind),
      me: player.id,
      tk: player.token,
      players: [...this.players.values()].map((p) => p.info()),
      alive: player.alive,
      phase: this.phase,
    };
    this.host.emit(socketId, "ag:init", init);
  }

  detach(player: Player): void {
    player.socketId = null;
    player.offSince = this.simTime;
    // Sin nadie manejandola, la celula se frena en vez de seguir derecho.
    player.release(this.simTime);
  }

  setAspect(player: Player, aspect: number): void {
    player.aspect = aspect;
  }

  spawn(player: Player, name: string): boolean {
    if (player.alive || this.phase !== "playing") return false;
    // En sala hay una sola vida: el que ya aparecio y murio queda mirando.
    if (player.everSpawned && !this.mode.respawn) return false;
    player.name = name;
    this.broadcastPlayers({ add: [player.info()] });
    const pos = this.spawnPoint();
    const mass = AGAR_CONFIG.cell.startMass;
    player.cells = [new Cell(this.nextCellId++, player, pos.x, pos.y, mass)];
    player.everSpawned = true;
    player.bornAt = this.simTime;
    player.peak = mass;
    player.lastActiveAt = this.simTime;
    player.release(this.simTime);
    if (player.socketId) this.host.emit(player.socketId, "ag:spawned", { mass });
    return true;
  }

  // ---------------------------------------------------------------- input

  input(player: Player, seq: number, sentAt: number, rawX: number, rawY: number, act: number): void {
    // Solo hacia adelante: un mensaje fuera de orden no puede hacer reconciliar al
    // cliente contra un input viejo.
    if (seq <= player.lastSeq) return;
    const last = player.queue[player.queue.length - 1];
    if (last && seq <= last.seq) return;

    // Se recorta aca: el cliente decide hacia donde y con que intensidad (el mouse
    // cerca de la celula frena), nunca mas rapido que su masa.
    const len = Math.hypot(rawX, rawY);
    const k = len > 1 ? 1 / len : 1;
    const dx = rawX * k;
    const dy = rawY * k;

    const now = this.nowSim();
    const sample = now - sentAt;
    if (player.clockOffset === null || sample < player.clockOffset) player.clockOffset = sample;
    else player.clockOffset += (sample - player.clockOffset) * AGAR_CONFIG.sim.inputOffsetDrift;
    const buffer = AGAR_CONFIG.sim.inputBufferMs;
    // Nunca en el pasado ni mas lejos que el buffer: el reloj lo manda el cliente y no
    // puede usarlo para cargar inputs a futuro.
    let at = clamp(sentAt + player.clockOffset + buffer, now, now + buffer);
    if (last) at = Math.max(at, last.at);

    // Inactividad: cuenta el input que CAMBIA. Un mouse quieto manda el mismo vector.
    const prev = last ?? player;
    if (Math.abs(dx - prev.dx) > 0.01 || Math.abs(dy - prev.dy) > 0.01 || act !== 0) {
      player.lastActiveAt = this.simTime;
    }
    player.queue.push({ at, dx, dy, act, seq });
  }

  /** Instante actual en la linea de tiempo de la simulacion, con el resto sin simular. */
  private nowSim(): number {
    return this.simTime + this.acc + (Date.now() - this.lastTick);
  }

  // ---------------------------------------------------------------- simulacion

  private tick(): void {
    const now = Date.now();
    this.acc = Math.min(this.acc + (now - this.lastTick), AGAR_CONFIG.sim.maxCatchupMs);
    this.lastTick = now;

    while (this.acc >= TICK_MS) {
      this.acc -= TICK_MS;
      this.simTime += TICK_MS;
      this.stepNo++;
      this.step();
      // Adentro del bucle: el espaciado es exactamente snapshotEvery pasos.
      if (this.stepNo % AGAR_CONFIG.sim.snapshotEvery === 0) this.broadcastSnapshots();
    }
  }

  private step(): void {
    // Terminada (sala con ganador), la arena queda congelada mostrando el final.
    if (this.phase !== "playing") return;
    for (const player of this.players.values()) this.stepPlayer(player);
    this.rebuildCellHash();
    this.eatPellets();
    this.eatCells();
    this.decay();
    this.refillPellets();
    this.expirePlayers();
    this.checkWinner();
    if (this.stepNo % TOP_EVERY === 0) this.broadcastTop();
  }

  // ---------------------------------------------------------------- comer

  private rebuildCellHash(): void {
    this.cellHash.clear();
    for (const player of this.players.values()) for (const cell of player.cells) this.cellHash.insert(cell);
  }

  /** La comida se come cuando su centro cae adentro de la celula. */
  private eatPellets(): void {
    const eaten: Pellet[] = [];
    for (const player of this.players.values()) {
      for (const cell of player.cells) {
        const r = cell.r;
        const r2 = r * r;
        this.pelletHash.query(cell.x - r, cell.y - r, cell.x + r, cell.y + r, (pellet) => {
          const dx = pellet.x - cell.x;
          const dy = pellet.y - cell.y;
          if (dx * dx + dy * dy < r2) eaten.push(pellet);
        });
        for (const pellet of eaten) {
          if (!this.pellets.has(pellet.id)) continue; // otra celula llego antes este paso
          this.removePellet(pellet);
          this.grow(cell, AGAR_CONFIG.pellet.mass);
        }
        eaten.length = 0;
      }
    }
  }

  /**
   * Celula contra celula. Se procesan de la mas grande a la mas chica, asi una cadena
   * (A come a B que comia a C en el mismo paso) se resuelve a favor del mas grande.
   * Regla: al menos `eat.ratio` veces la masa, y que la cubra mayormente
   * (distancia entre centros < R - overlap * r).
   */
  private eatCells(): void {
    const all: Cell[] = [];
    for (const player of this.players.values()) for (const cell of player.cells) all.push(cell);
    if (all.length < 2) return;
    all.sort((a, b) => b.mass - a.mass);

    const gone = new Set<Cell>();
    const killers = new Map<Player, Player>();
    const { ratio, overlap } = AGAR_CONFIG.eat;
    for (const big of all) {
      if (gone.has(big)) continue;
      const R = big.r;
      this.cellHash.query(big.x - R, big.y - R, big.x + R, big.y + R, (small) => {
        if (small === big || gone.has(small)) return;
        // Las celulas propias no se comen entre si (al dividir, se fusionarian aca).
        if (small.owner === big.owner) return;
        if (big.mass < small.mass * ratio) return;
        const reach = R - overlap * small.r;
        if (reach <= 0) return;
        const dx = small.x - big.x;
        const dy = small.y - big.y;
        if (dx * dx + dy * dy >= reach * reach) return;
        gone.add(small);
        killers.set(small.owner, big.owner);
        this.grow(big, small.mass);
      });
    }
    if (gone.size === 0) return;

    for (const [victim, killer] of killers) {
      victim.cells = victim.cells.filter((c) => !gone.has(c));
      if (victim.cells.length === 0) this.kill(victim, killer.name, "eaten");
    }
  }

  private grow(cell: Cell, mass: number): void {
    cell.mass = Math.min(AGAR_CONFIG.cell.maxMass, cell.mass + mass);
    const owner = cell.owner;
    const total = owner.mass;
    if (total > owner.peak) owner.peak = total;
  }

  /** Las grandes pierden masa de a poco: sin esto el primero que crece no para nunca. */
  private decay(): void {
    const { decayMinMass, decayPerSec } = AGAR_CONFIG.cell;
    const k = decayPerSec * (TICK_MS / 1000);
    for (const player of this.players.values()) {
      for (const cell of player.cells) {
        if (cell.mass > decayMinMass) cell.mass = Math.max(decayMinMass, cell.mass - cell.mass * k);
      }
    }
  }

  private kill(player: Player, by: string | null, reason: AgDead["reason"]): void {
    const last = player.cells[0];
    if (last) {
      player.camX = last.x;
      player.camY = last.y;
    }
    player.cells = [];
    player.deadAt = this.simTime;
    if (player.socketId) {
      const dead: AgDead = {
        peak: Math.round(player.peak),
        by,
        ms: Math.round(this.simTime - player.bornAt),
        reason,
      };
      this.host.emit(player.socketId, "ag:dead", dead);
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
      for (const p of this.players.values()) if (p.socketId) this.host.emit(p.socketId, "ag:over", msg);
      return;
    }
  }

  // ---------------------------------------------------------------- comida

  private addPellet(): void {
    const pellet = new Pellet(
      this.nextPelletId++,
      Math.round(20 + Math.random() * (this.size - 40)),
      Math.round(20 + Math.random() * (this.size - 40)),
      Math.floor(Math.random() * AGAR_CONFIG.pellet.colors),
    );
    this.pellets.set(pellet.id, pellet);
    this.pelletHash.insert(pellet);
  }

  private removePellet(pellet: Pellet): void {
    this.pellets.delete(pellet.id);
    this.pelletHash.remove(pellet);
  }

  /** De a poco: que la comida no reaparezca toda junta donde se la acaban de comer. */
  private refillPellets(): void {
    for (let i = 0; i < AGAR_CONFIG.pellet.respawnPerTick && this.pellets.size < this.mode.pelletCount; i++) {
      this.addPellet();
    }
  }

  private stepPlayer(player: Player): void {
    // El paso cubre (simTime - TICK_MS, simTime]. Un input que rige a mitad del paso
    // lo parte ahi, para que dure lo mismo que en el cliente.
    let from = this.simTime - TICK_MS;
    while (player.queue.length > 0 && player.queue[0].at <= this.simTime) {
      const input = player.queue.shift()!;
      const at = Math.max(input.at, from);
      this.moveCells(player, at - from);
      from = at;
      player.dx = input.dx;
      player.dy = input.dy;
      player.act = input.act;
      player.lastSeq = input.seq;
      player.lastSeqAt = at;
    }
    this.moveCells(player, this.simTime - from);
  }

  private moveCells(player: Player, ms: number): void {
    if (ms <= 0) return;
    const dt = ms / 1000;
    for (const cell of player.cells) {
      const speed = speedOf(cell.mass);
      cell.x += (player.dx * speed + cell.vx) * dt;
      cell.y += (player.dy * speed + cell.vy) * dt;
      if (cell.vx !== 0 || cell.vy !== 0) {
        const damp = Math.exp(-6 * dt);
        cell.vx *= damp;
        cell.vy *= damp;
        if (Math.abs(cell.vx) + Math.abs(cell.vy) < 1) cell.vx = cell.vy = 0;
      }
      this.clampCell(cell);
    }
  }

  /** La celula entera queda adentro del mapa (si es mas grande que medio mapa, centrada). */
  private clampCell(cell: Cell): void {
    const r = Math.min(cell.r, this.size / 2);
    cell.x = clamp(cell.x, r, this.size - r);
    cell.y = clamp(cell.y, r, this.size - r);
  }

  /** Saca a los desconectados que no volvieron a tiempo y a los inactivos. */
  private expirePlayers(): void {
    for (const player of this.players.values()) {
      if (player.bot) continue;
      if (!player.socketId && this.simTime - player.offSince > this.mode.reconnectGraceMs) {
        this.removePlayer(player);
        continue;
      }
      // Pestana abierta sin tocar nada: en sala es lo que deja cerrar la ronda sin un
      // reloj (ver `room.afkMs`); en la publica libera el lugar.
      if (player.alive && this.simTime - player.lastActiveAt > this.mode.afkMs) {
        this.kill(player, null, "afk");
      }
    }
    // Sin conexiones y sin nadie esperando reconectarse, la arena no tiene para quien
    // simular: se descarta (los bots se van con ella).
    if (this.socketCount === 0 && this.humanCount === 0) this.dispose();
  }

  private removePlayer(player: Player): void {
    player.cells = [];
    this.players.delete(player.id);
    this.broadcastPlayers({ del: [player.id] });
  }

  /**
   * Lugar para aparecer: de varios candidatos al azar, el mas lejos de cualquier
   * celula que se lo pueda comer. Aparecer adentro de la boca de alguien no es justo.
   */
  private spawnPoint(): { x: number; y: number } {
    const margin = 100;
    const danger = AGAR_CONFIG.cell.startMass * AGAR_CONFIG.eat.ratio;
    let best = { x: this.size / 2, y: this.size / 2 };
    let bestScore = -Infinity;
    for (let i = 0; i < 12; i++) {
      const x = margin + Math.random() * (this.size - margin * 2);
      const y = margin + Math.random() * (this.size - margin * 2);
      let score = Infinity;
      for (const player of this.players.values()) {
        for (const cell of player.cells) {
          if (cell.mass < danger) continue;
          score = Math.min(score, Math.hypot(cell.x - x, cell.y - y) - cell.r);
        }
      }
      if (score > bestScore) {
        bestScore = score;
        best = { x, y };
      }
    }
    return best;
  }

  private takeColor(): number {
    return this.nextColor++ % PLAYER_COLORS;
  }

  // ---------------------------------------------------------------- salida

  private broadcastSnapshots(): void {
    const cells: number[] = [];
    for (const player of this.players.values()) {
      for (const cell of player.cells) {
        cells.push(cell.id, player.id, Math.round(cell.x), Math.round(cell.y), Math.round(cell.mass));
      }
    }
    for (const player of this.players.values()) {
      if (!player.socketId) continue;
      const snap: AgSnap = {
        t: this.simTime,
        c: cells,
        n: player.lastSeq,
        a: Math.round((this.simTime - player.lastSeqAt) * 10) / 10,
      };
      this.pelletDiff(player, snap);
      this.host.emit(player.socketId, "ag:snap", snap);
    }
  }

  /** Comida nueva y comida que ya no esta, respecto de lo que el cliente tiene dibujado. */
  private pelletDiff(player: Player, snap: AgSnap): void {
    const known = player.knownPellets;
    const add: number[] = [];
    const del: number[] = [];
    for (const id of known) {
      if (!this.pellets.has(id)) {
        known.delete(id);
        del.push(id);
      }
    }
    for (const pellet of this.pellets.values()) {
      if (known.has(pellet.id)) continue;
      known.add(pellet.id);
      add.push(pellet.id, pellet.x, pellet.y, pellet.color);
    }
    if (add.length > 0) snap.pa = add;
    if (del.length > 0) snap.pd = del;
  }

  /** Top 10 por masa y el puesto de cada uno. */
  private broadcastTop(): void {
    const ranked = [...this.players.values()].filter((p) => p.alive).sort((a, b) => b.mass - a.mass);
    const top: [number, number][] = ranked.slice(0, 10).map((p) => [p.id, Math.round(p.mass)]);
    for (const player of this.players.values()) {
      if (!player.socketId) continue;
      const msg: AgTop = { top, rank: player.alive ? ranked.indexOf(player) + 1 : 0, alive: ranked.length };
      this.host.emit(player.socketId, "ag:top", msg);
    }
  }

  private broadcastPlayers(msg: { add?: AgPlayerInfo[]; del?: number[] }): void {
    for (const player of this.players.values()) {
      if (player.socketId) this.host.emit(player.socketId, "ag:players", msg);
    }
  }

  dispose(): void {
    if (this.loop === null) return;
    clearInterval(this.loop);
    this.loop = null;
    this.host.onEmpty(this);
  }
}

/** Colores de jugador (el cliente los mapea a su paleta). */
export const PLAYER_COLORS = 12;

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}
