import {
  ACC_AIR,
  ACC_GROUND,
  BOX_SIZE,
  CHAR_H,
  CHAR_W,
  COLS,
  COYOTE,
  FAN_ACC,
  FAN_MAX_UP,
  FRICTION,
  GATE_SPEED,
  GRAVITY,
  JUMP_BUFFER,
  JUMP_CUT,
  JUMP_V,
  LIFT_SPEED,
  MAX_FALL,
  POOL_FLOOR,
  POOL_SURFACE,
  PUSH_SPEED,
  ROWS,
  RUN_SPEED,
  STEP_UP,
} from "./constants";
import type { FanDef, GateDef, Hero, LeverDef, LiftDef, ParsedLevel, PlateDef, Tile } from "./Level";

const EPS = 1e-4;
/** Al caminar cuesta abajo por una rampa, el personaje se pega al piso hasta esta distancia. */
const STICK = 0.35;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Solid extends Rect {
  owner: Lift | Box | null;
}

export interface Body extends Rect {
  vx: number;
  vy: number;
  onGround: boolean;
  /** Sobre que esta parado (para que el ascensor lo lleve). */
  ground: Lift | Box | null;
}

export interface HeroBody extends Body {
  hero: Hero;
  face: 1 | -1;
  alive: boolean;
  inDoor: boolean;
  coyote: number;
  buffer: number;
  /** Ya se recorto este salto (salto variable). */
  cut: boolean;
  pushing: boolean;
  /** Lo mueve la red (el compañero online): no se simula, solo se lee. */
  remote: boolean;
}

export interface Box extends Body {
  id: number;
}

export interface Gate {
  def: GateDef;
  open: number;
  rect: Rect;
}

export interface Lift {
  def: LiftDef;
  t: number;
  rect: Rect;
}

export interface Plate {
  def: PlateDef;
  pressed: boolean;
}

export interface Lever {
  def: LeverDef;
  on: boolean;
}

export interface HeroInput {
  left: boolean;
  right: boolean;
  /** Salto apretado ahora (mantenido). */
  jump: boolean;
}

export type WorldEvent =
  | { type: "jump"; hero: Hero }
  | { type: "land"; hero: Hero; speed: number }
  | { type: "die"; hero: Hero; cause: Tile }
  | { type: "gem"; hero: Hero; x: number; y: number; i: number }
  | { type: "push"; box: number }
  | { type: "lever"; on: boolean; x: number; y: number }
  | { type: "plate"; pressed: boolean; x: number; y: number };

function overlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w - EPS && a.x + a.w > b.x + EPS && a.y < b.y + b.h - EPS && a.y + a.h > b.y + EPS;
}

/**
 * La simulacion de un nivel (DESIGN del metodo aprobado: controlador de plataformas
 * propio a paso fijo, colision por eje contra la grilla y contra rectangulos que se
 * mueven; nada de motor de cuerpos rigidos). No dibuja ni sabe de red: el juego le da
 * las teclas de cada heroe y lee el estado y los eventos.
 */
export class World {
  readonly level: ParsedLevel;
  readonly tiles: Tile[];
  readonly heroes: Record<Hero, HeroBody>;
  readonly boxes: Box[];
  readonly gates: Gate[];
  readonly lifts: Lift[];
  readonly plates: Plate[];
  readonly levers: Lever[];
  readonly fans: FanDef[];
  /** Gemas que quedan (indices en `level.gems`). */
  readonly gemsLeft: Set<number>;
  readonly events: WorldEvent[] = [];
  /** Si la red manda los canales (online), estos mandan sobre botones y palancas locales. */
  channelOverride: Map<string, boolean> | null = null;
  time = 0;
  private readonly prevInput: Record<Hero, boolean> = { chori: false, pan: false };

  constructor(level: ParsedLevel) {
    this.level = level;
    this.tiles = level.tiles;
    const mk = (hero: Hero): HeroBody => {
      const s = level.spawn[hero];
      return {
        hero,
        x: s.x + (1 - CHAR_W) / 2,
        y: s.y + 1 - CHAR_H,
        w: CHAR_W,
        h: CHAR_H,
        vx: 0,
        vy: 0,
        onGround: false,
        ground: null,
        face: 1,
        alive: true,
        inDoor: false,
        coyote: 0,
        buffer: 0,
        cut: false,
        pushing: false,
        remote: false,
      };
    };
    this.heroes = { chori: mk("chori"), pan: mk("pan") };
    this.boxes = level.boxes.map((b, i) => ({
      id: i,
      x: b.x + (1 - BOX_SIZE) / 2,
      y: b.y + 1 - BOX_SIZE,
      w: BOX_SIZE,
      h: BOX_SIZE,
      vx: 0,
      vy: 0,
      onGround: false,
      ground: null,
    }));
    this.gates = (level.def.gates ?? []).map((def) => ({ def, open: 0, rect: { x: def.x, y: def.y, w: def.w, h: def.h } }));
    this.lifts = (level.def.lifts ?? []).map((def) => ({ def, t: 0, rect: { x: def.x, y: def.y, w: def.w, h: 0.5 } }));
    this.plates = (level.def.plates ?? []).map((def) => ({ def, pressed: false }));
    this.levers = (level.def.levers ?? []).map((def) => ({ def, on: false }));
    this.fans = level.def.fans ?? [];
    this.gemsLeft = new Set(level.gems.map((_, i) => i));
    // Arrancan quietos y apoyados (los mecanismos ya en su posicion).
    for (const g of this.gates) this.placeGate(g, this.gateTarget(g));
    for (const l of this.lifts) this.placeLift(l, this.liftTarget(l));
  }

  // ---------- Grilla ----------

  tileAt(x: number, y: number): Tile {
    if (x < 0 || y < 0 || x >= COLS || y >= ROWS) return "solid";
    return this.tiles[y * COLS + x];
  }

  /** Todo lo solido que toca el rectangulo dado (para el barrido). */
  private solidsIn(r: Rect, self: Body | null, _forHero: boolean): Solid[] {
    const out: Solid[] = [];
    const x0 = Math.floor(r.x);
    const x1 = Math.floor(r.x + r.w - EPS);
    const y0 = Math.floor(r.y);
    const y1 = Math.floor(r.y + r.h - EPS);
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        const t = this.tileAt(tx, ty);
        if (t === "solid") out.push({ x: tx, y: ty, w: 1, h: 1, owner: null });
        else if (t === "embers" || t === "water" || t === "goo") out.push({ x: tx, y: ty + POOL_FLOOR, w: 1, h: 1 - POOL_FLOOR, owner: null });
      }
    }
    for (const g of this.gates) if (g.rect.w > EPS && g.rect.h > EPS && overlap(g.rect, r)) out.push({ ...g.rect, owner: null });
    for (const l of this.lifts) if (overlap(l.rect, r)) out.push({ ...l.rect, owner: l });
    for (const b of this.boxes) if (b !== self && overlap(b, r)) out.push({ x: b.x, y: b.y, w: b.w, h: b.h, owner: b });
    return out;
  }

  private blocked(r: Rect, self: Body | null, forHero: boolean): boolean {
    return this.solidsIn(r, self, forHero).some((s) => overlap(s, r));
  }

  // ---------- Movimiento ----------

  /** Barrido horizontal. Devuelve el bloque contra el que choco (si choco). */
  private moveX(b: Body, dx: number, stepUp: boolean, forHero: boolean): Solid | null {
    if (Math.abs(dx) < EPS) return null;
    const sweep: Rect = { x: Math.min(b.x, b.x + dx), y: b.y, w: b.w + Math.abs(dx), h: b.h };
    let limit = dx;
    let hit: Solid | null = null;
    for (const s of this.solidsIn(sweep, b, forHero)) {
      if (!(b.y < s.y + s.h - EPS && b.y + b.h > s.y + EPS)) continue;
      if (dx > 0 && s.x >= b.x + b.w - EPS) {
        const d = s.x - (b.x + b.w);
        if (d < limit) {
          limit = d;
          hit = s;
        }
      } else if (dx < 0 && s.x + s.w <= b.x + EPS) {
        const d = s.x + s.w - b.x;
        if (d > limit) {
          limit = d;
          hit = s;
        }
      }
    }
    // Las cajas no se suben solas (se empujan); la piedra y los ascensores, si.
    if (hit && stepUp && b.onGround && !(hit.owner && "id" in hit.owner)) {
      // Escalon bajo (borde de rampa, pileta): subirlo sin frenar.
      const rise = b.y + b.h - hit.y;
      if (rise > 0 && rise <= STEP_UP) {
        const up: Rect = { x: b.x + dx, y: b.y - rise - EPS, w: b.w, h: b.h };
        if (!this.blocked(up, b, forHero) && !this.blocked({ x: b.x, y: b.y - rise - EPS, w: b.w, h: b.h }, b, forHero)) {
          b.x += dx;
          b.y -= rise + EPS;
          return null;
        }
      }
    }
    b.x += limit;
    return hit;
  }

  /** Barrido vertical: aterriza (pisa algo) o pega contra el techo. */
  private moveY(b: Body, dy: number, forHero: boolean): Solid | null {
    if (Math.abs(dy) < EPS) return null;
    const sweep: Rect = { x: b.x, y: Math.min(b.y, b.y + dy), w: b.w, h: b.h + Math.abs(dy) };
    let limit = dy;
    let hit: Solid | null = null;
    for (const s of this.solidsIn(sweep, b, forHero)) {
      if (!(b.x < s.x + s.w - EPS && b.x + b.w > s.x + EPS)) continue;
      if (dy > 0 && s.y >= b.y + b.h - EPS) {
        const d = s.y - (b.y + b.h);
        if (d < limit) {
          limit = d;
          hit = s;
        }
      } else if (dy < 0 && s.y + s.h <= b.y + EPS) {
        const d = s.y + s.h - b.y;
        if (d > limit) {
          limit = d;
          hit = s;
        }
      }
    }
    b.y += limit;
    if (hit) {
      if (dy > 0) {
        b.onGround = true;
        b.ground = hit.owner;
      }
      b.vy = 0;
    }
    return hit;
  }

  /** Rampas: si el pie quedo dentro (o, caminando, apenas arriba) de una rampa, se apoya. */
  private snapSlope(b: Body, wasGround: boolean): void {
    if (b.vy < 0) return;
    const fx = b.x + b.w / 2;
    const fy = b.y + b.h;
    const cx = Math.floor(fx);
    const cy0 = Math.floor(fy - EPS);
    for (const cy of [cy0, cy0 + 1]) {
      const t = this.tileAt(cx, cy);
      if (t !== "slopeR" && t !== "slopeL") continue;
      const lx = fx - cx;
      const floor = cy + (t === "slopeR" ? 1 - lx : lx);
      if (fy >= floor - (wasGround ? STICK : 0) - EPS && fy <= floor + 0.7) {
        const ny = floor - b.h;
        // Nunca dentro de algo solido: arriba de una rampa el personaje ya esta parado en
        // la piedra de al lado, y "pegarlo" a la rampa lo hundia en ella.
        if (this.blocked({ x: b.x, y: ny, w: b.w, h: b.h }, b, true)) return;
        b.y = ny;
        b.vy = 0;
        b.onGround = true;
        b.ground = null;
        return;
      }
    }
  }

  // ---------- Mecanismos ----------

  channel(ch: string): boolean {
    if (this.channelOverride) return this.channelOverride.get(ch) ?? false;
    return this.plates.some((p) => p.def.ch === ch && p.pressed) || this.levers.some((l) => l.def.ch === ch && l.on);
  }

  private gateTarget(g: Gate): number {
    return this.channel(g.def.ch) !== !!g.def.invert ? 1 : 0;
  }

  private liftTarget(l: Lift): number {
    return this.channel(l.def.ch) !== !!l.def.invert ? 1 : 0;
  }

  private placeGate(g: Gate, open: number): void {
    g.open = open;
    const d = g.def;
    const r = g.rect;
    // Se corre hacia su lado y se achica (se mete en la ranura).
    if (d.dir === "up") Object.assign(r, { x: d.x, y: d.y, w: d.w, h: d.h * (1 - open) });
    else if (d.dir === "down") Object.assign(r, { x: d.x, y: d.y + d.h * open, w: d.w, h: d.h * (1 - open) });
    else if (d.dir === "left") Object.assign(r, { x: d.x, y: d.y, w: d.w * (1 - open), h: d.h });
    else Object.assign(r, { x: d.x + d.w * open, y: d.y, w: d.w * (1 - open), h: d.h });
  }

  private placeLift(l: Lift, t: number): void {
    l.t = t;
    l.rect.x = l.def.x + l.def.dx * t;
    l.rect.y = l.def.y + l.def.dy * t;
  }

  private bodies(): Body[] {
    const out: Body[] = [];
    for (const h of Object.values(this.heroes)) if (h.alive && !h.remote) out.push(h);
    for (const b of this.boxes) out.push(b);
    return out;
  }

  private updateLift(l: Lift, dt: number): void {
    const target = this.liftTarget(l);
    if (l.t === target) return;
    const len = Math.hypot(l.def.dx, l.def.dy) || 1;
    const nt = l.t + Math.sign(target - l.t) * Math.min(Math.abs(target - l.t), (LIFT_SPEED * dt) / len);
    const ox = l.rect.x;
    const oy = l.rect.y;
    const nx = l.def.x + l.def.dx * nt;
    const ny = l.def.y + l.def.dy * nt;
    const dx = nx - ox;
    const dy = ny - oy;
    const moved: Rect = { x: nx, y: ny, w: l.rect.w, h: l.rect.h };
    const riders = this.bodies().filter((b) => b.ground === l && b.onGround);
    // No aplasta: si el recorrido pisa a alguien que no va arriba, frena.
    for (const b of this.bodies()) if (!riders.includes(b) && overlap(b, moved)) return;
    for (const h of Object.values(this.heroes)) if (h.remote && h.alive && overlap(h, moved) && !(h.y + h.h <= oy + 0.05)) return;
    const oldT = l.t;
    this.placeLift(l, nt);
    for (const r of riders) {
      if (dy < 0) {
        const ry = r.y;
        this.moveY(r, dy, true);
        if (r.y - (ry + dy) > 1e-3) {
          // El que va arriba pego contra el techo: el ascensor no sigue.
          r.y = ry;
          this.placeLift(l, oldT);
          return;
        }
      } else if (dy > 0) {
        r.y += dy;
      }
      if (dx !== 0) this.moveX(r, dx, false, true);
      r.onGround = true;
      r.ground = l;
    }
  }

  private updateGate(g: Gate, dt: number): void {
    const target = this.gateTarget(g);
    if (g.open === target) return;
    const len = g.def.dir === "up" || g.def.dir === "down" ? g.def.h : g.def.w;
    const nopen = g.open + Math.sign(target - g.open) * Math.min(Math.abs(target - g.open), (GATE_SPEED * dt) / len);
    const prev = g.open;
    this.placeGate(g, nopen);
    // Cerrandose, no se mete adentro de nadie: frena.
    if (nopen < prev) for (const b of this.bodies()) if (overlap(b, g.rect)) return this.placeGate(g, prev);
  }

  private updateTriggers(): void {
    const feet = (b: Rect): Rect => ({ x: b.x + 0.05, y: b.y + b.h - 0.25, w: b.w - 0.1, h: 0.3 });
    const pressers: Rect[] = [];
    for (const h of Object.values(this.heroes)) if (h.alive) pressers.push(feet(h));
    for (const b of this.boxes) pressers.push(feet(b));
    for (const p of this.plates) {
      const r: Rect = { x: p.def.x + 0.08, y: p.def.y + 0.78, w: 0.84, h: 0.22 };
      const now = pressers.some((f) => overlap(f, r));
      if (now !== p.pressed) {
        p.pressed = now;
        this.events.push({ type: "plate", pressed: now, x: p.def.x, y: p.def.y });
      }
    }
    for (const l of this.levers) {
      const r: Rect = { x: l.def.x + 0.15, y: l.def.y + 0.2, w: 0.7, h: 0.8 };
      for (const h of Object.values(this.heroes)) {
        // Solo la mueve quien la empuja caminando: saltandola por arriba no se toca (como en el
        // original, es la forma de volver sin desarmar lo que uno acaba de prender).
        if (!h.alive || h.remote || !h.onGround || !overlap(h, r)) continue;
        // La palanca se vuelca hacia donde la empujan.
        const want = h.vx > 1.5 ? true : h.vx < -1.5 ? false : l.on;
        if (want !== l.on) {
          l.on = want;
          this.events.push({ type: "lever", on: want, x: l.def.x, y: l.def.y });
        }
      }
    }
  }

  // ---------- Heroes ----------

  private updateHero(h: HeroBody, input: HeroInput, dt: number): void {
    const pressed = input.jump && !this.prevInput[h.hero];
    this.prevInput[h.hero] = input.jump;
    const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    if (dir !== 0) h.face = dir as 1 | -1;
    const top = RUN_SPEED * (h.pushing ? PUSH_SPEED : 1);
    const target = dir * top;
    const acc = h.onGround ? (dir === 0 ? FRICTION : ACC_GROUND) : ACC_AIR;
    if (h.vx < target) h.vx = Math.min(target, h.vx + acc * dt);
    else if (h.vx > target) h.vx = Math.max(target, h.vx - acc * dt);

    h.coyote = h.onGround ? COYOTE : h.coyote - dt;
    h.buffer = pressed ? JUMP_BUFFER : h.buffer - dt;
    if (h.buffer > 0 && h.coyote > 0) {
      h.vy = -JUMP_V;
      h.coyote = 0;
      h.buffer = 0;
      h.cut = false;
      h.onGround = false;
      h.ground = null;
      this.events.push({ type: "jump", hero: h.hero });
    }
    if (!input.jump && h.vy < -JUMP_V * JUMP_CUT && !h.cut) {
      h.vy = -JUMP_V * JUMP_CUT;
      h.cut = true;
    }
    h.vy = Math.min(MAX_FALL, h.vy + GRAVITY * dt);
    for (const f of this.fans) {
      if (f.ch && !this.channel(f.ch)) continue;
      if (overlap(h, f)) h.vy = Math.max(-FAN_MAX_UP, h.vy - FAN_ACC * dt);
    }

    const wasGround = h.onGround;
    const fallSpeed = h.vy;
    // Horizontal (con empuje de cajas).
    h.pushing = false;
    const dx = h.vx * dt;
    const x0 = h.x;
    const hit = this.moveX(h, dx, true, true);
    if (hit && hit.owner && "id" in hit.owner) {
      // Choco con una caja: la empuja con lo que le faltaba recorrer.
      const rem = dx - (h.x - x0);
      const moved = this.pushBox(hit.owner, rem);
      if (Math.abs(moved) > EPS) {
        this.moveX(h, moved, false, true);
        h.pushing = true;
        this.events.push({ type: "push", box: hit.owner.id });
      } else h.vx = 0;
    } else if (hit) {
      h.vx = 0;
    }
    // Vertical.
    h.onGround = false;
    h.ground = null;
    this.moveY(h, h.vy * dt, true);
    this.snapSlope(h, wasGround);
    if (h.onGround && !wasGround && fallSpeed > 6) this.events.push({ type: "land", hero: h.hero, speed: fallSpeed });

    this.checkHero(h);
  }

  /** Mueve una caja de costado (empujada). Devuelve cuanto se movio. */
  private pushBox(b: Box, dx: number): number {
    if (!b.onGround) return 0;
    const x0 = b.x;
    this.moveX(b, dx, false, false);
    return b.x - x0;
  }

  private updateBox(b: Box, dt: number): void {
    b.vy = Math.min(MAX_FALL, b.vy + GRAVITY * dt);
    b.onGround = false;
    b.ground = null;
    this.moveY(b, b.vy * dt, false);
  }

  /** Piletas, gemas y puertas. */
  private checkHero(h: HeroBody): void {
    const foot: Rect = { x: h.x + 0.15, y: h.y + h.h - 0.3, w: h.w - 0.3, h: 0.3 };
    const x0 = Math.floor(foot.x);
    const x1 = Math.floor(foot.x + foot.w);
    const y0 = Math.floor(foot.y);
    const y1 = Math.floor(foot.y + foot.h - EPS);
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        const t = this.tileAt(tx, ty);
        if (t !== "embers" && t !== "water" && t !== "goo") continue;
        const liquid: Rect = { x: tx, y: ty + POOL_SURFACE, w: 1, h: POOL_FLOOR - POOL_SURFACE };
        if (!overlap(foot, liquid)) continue;
        const deadly = t === "goo" || (h.hero === "chori" && t === "water") || (h.hero === "pan" && t === "embers");
        if (deadly) {
          h.alive = false;
          h.vx = 0;
          this.events.push({ type: "die", hero: h.hero, cause: t });
          return;
        }
      }
    }
    this.level.gems.forEach((g, i) => {
      if (!this.gemsLeft.has(i) || g.hero !== h.hero) return;
      if (overlap(h, { x: g.x + 0.2, y: g.y + 0.2, w: 0.6, h: 0.6 })) {
        this.gemsLeft.delete(i);
        this.events.push({ type: "gem", hero: h.hero, x: g.x, y: g.y, i });
      }
    });
    const d = this.level.doors[h.hero];
    const cx = h.x + h.w / 2;
    h.inDoor = h.onGround && cx > d.x + 0.1 && cx < d.x + 0.9 && h.y + h.h > d.y && h.y + h.h < d.y + 1.05;
  }

  // ---------- Paso ----------

  /** Un paso fijo. `inputs` solo para los heroes simulados aca (no los remotos). */
  step(dt: number, inputs: Partial<Record<Hero, HeroInput>>): void {
    this.time += dt;
    this.updateTriggers();
    for (const g of this.gates) this.updateGate(g, dt);
    for (const l of this.lifts) this.updateLift(l, dt);
    for (const b of this.boxes) this.updateBox(b, dt);
    for (const h of Object.values(this.heroes)) {
      if (!h.alive || h.remote) continue;
      this.updateHero(h, inputs[h.hero] ?? { left: false, right: false, jump: false }, dt);
    }
  }

  /** Online: el server manda el estado de las palancas (indice, prendida). */
  setLevers(list: [number, number][]): void {
    for (const [i, on] of list) if (this.levers[i]) this.levers[i].on = on === 1;
  }

  /** Canales que pisan un heroe dado (o ninguno) y todas las cajas: lo que se reporta online. */
  pressedChannels(by: Hero[]): string {
    const set = new Set<string>();
    const feet = (b: Rect): Rect => ({ x: b.x + 0.05, y: b.y + b.h - 0.25, w: b.w - 0.1, h: 0.3 });
    const who: Rect[] = by.filter((h) => this.heroes[h].alive).map((h) => feet(this.heroes[h]));
    for (const b of this.boxes) who.push(feet(b));
    for (const p of this.plates) {
      const r: Rect = { x: p.def.x + 0.08, y: p.def.y + 0.78, w: 0.84, h: 0.22 };
      if (who.some((f) => overlap(f, r))) set.add(p.def.ch);
    }
    return [...set].sort().join("");
  }

  /** Los dos estan en su puerta. */
  get cleared(): boolean {
    return this.heroes.chori.inDoor && this.heroes.pan.inDoor && this.heroes.chori.alive && this.heroes.pan.alive;
  }
}
