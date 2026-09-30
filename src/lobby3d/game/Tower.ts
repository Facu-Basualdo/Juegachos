import * as THREE from "three";
import { TOWER_R, TOWER_X, TOWER_Z } from "./constants";
import {
  makeBox,
  MovingBox,
  Pendulum,
  Sweeper,
  TimedBox,
  type Box,
  type CollisionWorld,
} from "./Physics";
import { decal, psxBasic, psxLambert } from "./retro";
import {
  barTexture,
  checkerTexture,
  hazardTexture,
  labelSprite,
  plaqueTexture,
  rustTexture,
  setSpriteLabel,
  signTexture,
  woodTexture,
} from "./textures";

/**
 * La Torre: el parkour de la feria. Un espiral de plataformas alrededor de un
 * mastil oxidado, desde la largada en el piso hasta una plataforma con un trono y
 * la baliza roja, a ~24 m. Cuatro vueltas, cada una mas mala que la anterior:
 * cajas y tablones; una plataforma que va y viene y postes; tablones que se caen y
 * un barredor; vigas angostas, un montacargas y un pasillo con ganchos; plataformas
 * que se cruzan, mas tablones, un barredor doble, y los ultimos postes.
 *
 * Todo sale de `COURSE` con un cursor en polares: cada tramo dice cuanto hueco deja
 * con el anterior (`gap`, de borde a borde sobre el espiral) y cuanto sube (`rise`).
 * Con el salto del muñeco (1.64 m de alto, ~3.4 m de largo corriendo) los postes de
 * 1.1 m de subida y 2.4 de hueco son el limite de lo que se puede: dificil, no
 * imposible. **Si se toca el salto (`JUMP_VELOCITY` / `GRAVITY` / `SPEED`), revisar
 * los huecos.** Entre una vuelta y la de arriba siempre quedan > 4 m libres.
 */

type Kind = "crate" | "plank" | "post" | "move" | "timed" | "sweep" | "beam" | "lift" | "ledge" | "hooks" | "top";

interface Section {
  kind: Kind;
  /** Medio largo sobre el espiral y medio ancho hacia el mastil. */
  hl: number;
  hw: number;
  gap: number;
  rise: number;
  /** move / lift: eje, amplitud y periodo; timed: periodo, tiempo firme y fase (0..1). */
  axis?: "tan" | "rad";
  amp?: number;
  period?: number;
  on?: number;
  phase?: number;
  /** sweep: velocidad angular (rad/s, signo = sentido) y si lleva dos barras en cruz. */
  speed?: number;
  cross?: boolean;
  /** beam: un gancho a mitad de camino. */
  hook?: boolean;
}

const COURSE: Section[] = [
  { kind: "crate", hl: 0.6, hw: 0.6, gap: 1.2, rise: 0.9 },
  { kind: "crate", hl: 0.6, hw: 0.6, gap: 1.4, rise: 0.9 },
  { kind: "crate", hl: 0.6, hw: 0.6, gap: 1.6, rise: 0.9 },
  { kind: "plank", hl: 1.5, hw: 0.45, gap: 1.7, rise: 0.8 },
  { kind: "move", hl: 0.8, hw: 0.8, gap: 2.2, rise: 0.6, axis: "tan", amp: 1.2, period: 4.5 },
  { kind: "post", hl: 0.45, hw: 0.45, gap: 2.1, rise: 1.0 },
  { kind: "post", hl: 0.45, hw: 0.45, gap: 2.2, rise: 1.0 },
  { kind: "timed", hl: 0.7, hw: 0.6, gap: 1.3, rise: 0.4, period: 3.2, on: 2.2, phase: 0 },
  { kind: "timed", hl: 0.7, hw: 0.6, gap: 1.3, rise: 0.4, period: 3.2, on: 2.2, phase: 0.33 },
  { kind: "timed", hl: 0.7, hw: 0.6, gap: 1.3, rise: 0.4, period: 3.2, on: 2.2, phase: 0.66 },
  { kind: "sweep", hl: 1.8, hw: 1.8, gap: 1.7, rise: 0.6, speed: 1.5 },
  { kind: "beam", hl: 1.8, hw: 0.2, gap: 1.5, rise: 0.5 },
  { kind: "beam", hl: 1.6, hw: 0.2, gap: 1.2, rise: 0.3 },
  { kind: "lift", hl: 0.8, hw: 0.8, gap: 1.7, rise: 0, amp: 1.7, period: 6 },
  { kind: "ledge", hl: 1.0, hw: 0.7, gap: 1.6, rise: 3.1 },
  { kind: "hooks", hl: 3.2, hw: 0.55, gap: 1.6, rise: 0.4 },
  { kind: "post", hl: 0.45, hw: 0.45, gap: 2.1, rise: 1.1 },
  { kind: "post", hl: 0.45, hw: 0.45, gap: 2.3, rise: 1.1 },
  { kind: "move", hl: 0.7, hw: 0.7, gap: 2.0, rise: 0.7, axis: "tan", amp: 1.4, period: 5 },
  { kind: "move", hl: 0.7, hw: 0.7, gap: 2.0, rise: 0.5, axis: "rad", amp: 1.4, period: 5, phase: Math.PI },
  { kind: "timed", hl: 0.7, hw: 0.6, gap: 1.5, rise: 0.45, period: 2.8, on: 1.95, phase: 0 },
  { kind: "timed", hl: 0.7, hw: 0.6, gap: 1.5, rise: 0.45, period: 2.8, on: 1.95, phase: 0.25 },
  { kind: "timed", hl: 0.7, hw: 0.6, gap: 1.5, rise: 0.45, period: 2.8, on: 1.95, phase: 0.5 },
  { kind: "timed", hl: 0.7, hw: 0.6, gap: 1.5, rise: 0.45, period: 2.8, on: 1.95, phase: 0.75 },
  { kind: "post", hl: 0.5, hw: 0.5, gap: 1.9, rise: 1.0 },
  { kind: "sweep", hl: 2.0, hw: 2.0, gap: 1.8, rise: 0.6, speed: -1.6, cross: true },
  { kind: "beam", hl: 2.0, hw: 0.2, gap: 1.6, rise: 0.6, hook: true },
  { kind: "post", hl: 0.45, hw: 0.45, gap: 2.2, rise: 1.1 },
  { kind: "post", hl: 0.45, hw: 0.45, gap: 2.4, rise: 1.1 },
  { kind: "move", hl: 0.7, hw: 0.7, gap: 2.0, rise: 0.8, axis: "rad", amp: 1.0, period: 3.6 },
  { kind: "top", hl: 1.8, hw: 1.8, gap: 1.8, rise: 1.0 },
];

/** Espesor de las plataformas colgadas. */
const THICK = 0.35;
/** Largada: medio lado del cuadrado a cuadros, en el piso. */
const START_HALF = 1.0;
/** Angulo de la largada: del lado que mira a la plaza. */
const START_ANGLE = Math.atan2(-TOWER_Z, -TOWER_X);

/** Caja con UV en metros (un texel de textura mide lo mismo en todas). */
function boxGeometry(w: number, h: number, d: number, tile = 1): THREE.BoxGeometry {
  const geo = new THREE.BoxGeometry(w, h, d);
  const uv = geo.getAttribute("uv");
  // Orden de caras de BoxGeometry: +x, -x, +y, -y, +z, -z (4 vertices cada una).
  const dims: Array<[number, number]> = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    for (let v = 0; v < 4; v++) {
      const i = f * 4 + v;
      uv.setXY(i, uv.getX(i) * dims[f][0] / tile, uv.getY(i) * dims[f][1] / tile);
    }
  }
  return geo;
}

interface Visual {
  mesh: THREE.Object3D;
  update(t: number): void;
}

export class Tower {
  readonly group = new THREE.Group();
  /** Plataforma de la cima (llegar = pararse arriba). */
  readonly topBox: Box;
  readonly topY: number;
  /** Las plataformas del recorrido, en orden (la primera es la primera caja). */
  readonly course: Box[] = [];
  /** Centro de la largada. */
  readonly startX: number;
  readonly startZ: number;
  private readonly visuals: Visual[] = [];
  private readonly beaconMat: THREE.MeshBasicMaterial;
  private readonly beaconLight: THREE.PointLight;
  private readonly crown: THREE.Group;
  private readonly recordTop: THREE.Sprite;
  private readonly lamps: THREE.PointLight[] = [];
  private readonly recordBase: THREE.Sprite;
  private recordText = "";
  private time = 0;

  constructor(world: CollisionWorld) {
    const wood = psxLambert({ map: woodTexture() });
    const woodDark = psxLambert({ map: woodTexture("#46382a") });
    const rust = psxLambert({ map: rustTexture() });
    const hazard = psxLambert({ map: hazardTexture() });
    const bar = psxLambert({ map: barTexture(), emissive: "#2a0804" });

    const polar = (a: number, r: number): { x: number; z: number } => ({
      x: TOWER_X + Math.cos(a) * r,
      z: TOWER_Z + Math.sin(a) * r,
    });
    /** Giro para que el eje x local de una caja vaya sobre el espiral. */
    const yawAt = (a: number): number => -(a + Math.PI / 2);

    // Largada: chapa a cuadros en el piso, con su cartel.
    const s = polar(START_ANGLE, TOWER_R);
    this.startX = s.x;
    this.startZ = s.z;
    const start = new THREE.Mesh(
      new THREE.PlaneGeometry(START_HALF * 2, START_HALF * 2),
      decal(psxLambert({ map: checkerTexture() })),
    );
    start.rotation.x = -Math.PI / 2;
    start.rotation.z = yawAt(START_ANGLE);
    start.position.set(s.x, 0.03, s.z);
    this.group.add(start);

    // Mastil con travesaños.
    const mastH = 27;
    const mast = new THREE.Mesh(boxGeometry(0.6, mastH, 0.6, 1), rust);
    mast.position.set(TOWER_X, mastH / 2, TOWER_Z);
    this.group.add(mast);
    world.boxes.push(makeBox(TOWER_X, mastH / 2, TOWER_Z, 0.3, mastH / 2, 0.3));

    let a = START_ANGLE;
    let top = 0;
    let prevHl = START_HALF;
    let topBox: Box | null = null;

    for (const sec of COURSE) {
      a += (prevHl + sec.gap + sec.hl) / TOWER_R;
      top += sec.rise;
      prevHl = sec.hl;
      const p = polar(a, TOWER_R);
      const yaw = yawAt(a);
      const cy = top - THICK / 2;

      const addStrut = (y: number): void => {
        // Travesaño de la plataforma al mastil (solo de decorado: no choca).
        const inner = TOWER_R - sec.hw;
        const len = inner - 0.3;
        if (len <= 0.2) return;
        const mid = polar(a, 0.3 + len / 2);
        const strut = new THREE.Mesh(boxGeometry(len, 0.12, 0.12), rust);
        strut.position.set(mid.x, y - 0.25, mid.z);
        strut.rotation.y = -a;
        this.group.add(strut);
      };

      switch (sec.kind) {
        case "crate": {
          // Pila de cajas desde el piso.
          const box = makeBox(p.x, top / 2, p.z, sec.hl, top / 2, sec.hw, yaw);
          world.boxes.push(box);
          this.course.push(box);
          const m = new THREE.Mesh(boxGeometry(sec.hl * 2, top, sec.hw * 2, 1.2), wood);
          m.position.set(p.x, top / 2, p.z);
          m.rotation.y = yaw;
          this.group.add(m);
          break;
        }
        case "plank":
        case "ledge":
        case "beam":
        case "post":
        case "hooks":
        case "top": {
          const box = makeBox(p.x, cy, p.z, sec.hl, THICK / 2, sec.hw, yaw);
          world.boxes.push(box);
          this.course.push(box);
          const mat = sec.kind === "post" || sec.kind === "top" ? rust : sec.kind === "beam" ? woodDark : wood;
          const m = new THREE.Mesh(boxGeometry(sec.hl * 2, THICK, sec.hw * 2), mat);
          m.position.set(p.x, cy, p.z);
          m.rotation.y = yaw;
          this.group.add(m);
          addStrut(top - THICK);
          if (sec.kind === "top") topBox = box;
          if (sec.kind === "hooks") {
            for (const off of [-1.4, 1.4]) this.addHook(world, a + off / TOWER_R, top, off < 0 ? 0 : Math.PI, rust);
          }
          if (sec.kind === "beam" && sec.hook) this.addHook(world, a, top, 0.8, rust);
          break;
        }
        case "move":
        case "lift": {
          const box = makeBox(p.x, cy, p.z, sec.hl, THICK / 2, sec.hw, yaw);
          world.boxes.push(box);
          this.course.push(box);
          const amp = sec.amp ?? 1;
          let ax = 0;
          let ay = 0;
          let az = 0;
          if (sec.kind === "lift") {
            ay = amp;
          } else if (sec.axis === "rad") {
            ax = Math.cos(a) * amp;
            az = Math.sin(a) * amp;
          } else {
            ax = -Math.sin(a) * amp;
            az = Math.cos(a) * amp;
          }
          // El montacargas arranca abajo en su recorrido (centro + amp), los demas en el medio.
          const baseY = sec.kind === "lift" ? cy + amp : cy;
          const mover = new MovingBox(box, [p.x, baseY, p.z], [ax, ay, az], sec.period ?? 4, sec.phase ?? 0);
          world.animated.push(mover);
          const m = new THREE.Mesh(boxGeometry(sec.hl * 2, THICK, sec.hw * 2), hazard);
          m.rotation.y = yaw;
          this.group.add(m);
          this.visuals.push({ mesh: m, update: () => m.position.set(box.x, box.y, box.z) });
          break;
        }
        case "timed": {
          const box = makeBox(p.x, cy, p.z, sec.hl, THICK / 2, sec.hw, yaw);
          world.boxes.push(box);
          this.course.push(box);
          const timed = new TimedBox(box, sec.period ?? 3, sec.on ?? 2, sec.phase ?? 0);
          world.animated.push(timed);
          const m = new THREE.Mesh(boxGeometry(sec.hl * 2, THICK, sec.hw * 2), woodDark);
          m.rotation.y = yaw;
          this.group.add(m);
          addStrut(top - THICK);
          this.visuals.push({
            mesh: m,
            update: () => {
              // Tiembla antes de caerse (el aviso) y desaparece mientras no esta.
              m.visible = timed.shake >= 0;
              const j = timed.shake > 0 ? (Math.random() - 0.5) * 0.08 * (0.4 + timed.shake) : 0;
              m.position.set(box.x + j, box.y - Math.max(0, timed.shake) * 0.05, box.z - j);
            },
          });
          break;
        }
        case "sweep": {
          const box = makeBox(p.x, cy, p.z, sec.hl, THICK / 2, sec.hw, yaw);
          world.boxes.push(box);
          this.course.push(box);
          const m = new THREE.Mesh(boxGeometry(sec.hl * 2, THICK, sec.hw * 2), rust);
          m.position.set(p.x, cy, p.z);
          m.rotation.y = yaw;
          this.group.add(m);
          addStrut(top - THICK);
          const arms = sec.cross ? [0, Math.PI / 2] : [0];
          const armLen = Math.min(sec.hl, sec.hw) + 0.15;
          const hub = new THREE.Mesh(boxGeometry(0.3, 0.6, 0.3), rust);
          hub.position.set(p.x, top + 0.3, p.z);
          this.group.add(hub);
          for (const off of arms) {
            const sw = new Sweeper(p.x, top + 0.5, p.z, armLen, sec.speed ?? 1.5, off);
            world.animated.push(sw);
            world.hazards.push(sw);
            const arm = new THREE.Mesh(boxGeometry(armLen * 2, sw.thick * 2, sw.thick * 2, 0.5), bar);
            arm.position.set(p.x, top + 0.5, p.z);
            this.group.add(arm);
            this.visuals.push({ mesh: arm, update: () => (arm.rotation.y = sw.angle) });
          }
          break;
        }
      }
    }

    this.topBox = topBox!;
    this.topY = top;

    // Cima: trono, baliza y la corona (cuando nadie la tiene).
    const tp = { x: this.topBox.x, z: this.topBox.z };
    const throne = new THREE.Group();
    const seat = new THREE.Mesh(boxGeometry(0.9, 0.5, 0.8), woodDark);
    seat.position.y = 0.25;
    const back = new THREE.Mesh(boxGeometry(0.9, 1.3, 0.15), woodDark);
    back.position.set(0, 0.9, -0.35);
    throne.add(seat, back);
    throne.position.set(tp.x, this.topY, tp.z);
    throne.lookAt(TOWER_X, this.topY, TOWER_Z);
    throne.rotateY(Math.PI);
    this.group.add(throne);

    this.beaconMat = psxBasic({ color: "#ff2a1a" });
    const beacon = new THREE.Mesh(new THREE.IcosahedronGeometry(0.35, 0), this.beaconMat);
    beacon.position.set(TOWER_X, 27.4, TOWER_Z);
    this.group.add(beacon);
    this.beaconLight = new THREE.PointLight("#ff2a1a", 30, 22, 1.6);
    this.beaconLight.position.copy(beacon.position);
    this.group.add(this.beaconLight);

    // Lamparas de obra colgadas del mastil: sin ellas las plataformas no se leen de noche.
    const lampMat = psxBasic({ color: "#ffd9a0" });
    for (const [y, a2] of [
      [3.5, 0.6],
      [9, 2.4],
      [14.5, 4.3],
      [20, 0.9],
    ] as const) {
      const lx = TOWER_X + Math.cos(a2) * 1.1;
      const lz = TOWER_Z + Math.sin(a2) * 1.1;
      const bulb = new THREE.Mesh(new THREE.IcosahedronGeometry(0.14, 0), lampMat);
      bulb.position.set(lx, y, lz);
      this.group.add(bulb);
      const l = new THREE.PointLight("#ffcf8a", 22, 11, 1.2);
      l.position.set(lx, y, lz);
      this.lamps.push(l);
      this.group.add(l);
    }

    this.crown = makeCrown();
    this.crown.position.set(tp.x, this.topY + 2.1, tp.z);
    this.group.add(this.crown);

    // Carteles: "LA TORRE" en la largada, y el record abajo y arriba.
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(2.4, 0.6),
      psxBasic({ map: signTexture("LA TORRE", { bg: "#3b2d20", fg: "#e0d6bf", w: 64, h: 16 }) }),
    );
    const sp = polar(START_ANGLE, TOWER_R + 2.2);
    sign.position.set(sp.x, 2.6, sp.z);
    sign.lookAt(0, 2.6, 0);
    this.group.add(sign);
    const post = new THREE.Mesh(boxGeometry(0.15, 2.4, 0.15), woodDark);
    post.position.set(sp.x, 1.2, sp.z);
    this.group.add(post);

    this.recordBase = labelSprite(plaqueTexture("Sin record"), 0.34);
    this.recordBase.position.set(sp.x, 3.35, sp.z);
    this.group.add(this.recordBase);
    this.recordTop = labelSprite(plaqueTexture("Sin record"), 0.34);
    this.recordTop.position.set(tp.x, this.topY + 3.0, tp.z);
    this.group.add(this.recordTop);
  }

  /** Gancho colgando de una horca, balanceandose de costado sobre el camino. */
  private addHook(world: CollisionWorld, a: number, top: number, phase: number, rust: THREE.Material): void {
    const p = { x: TOWER_X + Math.cos(a) * TOWER_R, z: TOWER_Z + Math.sin(a) * TOWER_R };
    const length = 2.8;
    const pivotY = top + 3.4;
    // Se balancea hacia adentro y hacia afuera del espiral (cruza el camino).
    const ux = Math.cos(a);
    const uz = Math.sin(a);
    const pen = new Pendulum([p.x, pivotY, p.z], [ux, uz], length, 0.9, 2.2, phase);
    world.animated.push(pen);
    world.hazards.push(pen);

    // Horca: un travesaño sobre el camino, apoyado en el mastil.
    const beamLen = TOWER_R + 1.4;
    const mid = { x: TOWER_X + Math.cos(a) * (beamLen / 2), z: TOWER_Z + Math.sin(a) * (beamLen / 2) };
    const cross = new THREE.Mesh(boxGeometry(beamLen, 0.18, 0.18), rust);
    cross.position.set(mid.x, pivotY + 0.1, mid.z);
    cross.rotation.y = -a;
    this.group.add(cross);

    const chainMat = psxLambert({ color: "#3a3a3a" });
    const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1, 4), chainMat);
    const sack = new THREE.Mesh(new THREE.IcosahedronGeometry(pen.radius, 0), psxLambert({ map: woodTexture("#4a3a2c") }));
    sack.scale.set(0.9, 1.25, 0.9);
    this.group.add(chain, sack);
    this.visuals.push({
      mesh: sack,
      update: () => {
        sack.position.set(pen.bx, pen.by, pen.bz);
        sack.rotation.set(0, 0, 0);
        // La cadena va del pivote a la bolsa.
        chain.position.set((pen.px + pen.bx) / 2, (pen.py + pen.by) / 2, (pen.pz + pen.bz) / 2);
        chain.scale.y = length;
        chain.quaternion.setFromUnitVectors(
          new THREE.Vector3(0, 1, 0),
          new THREE.Vector3(pen.px - pen.bx, pen.py - pen.by, pen.pz - pen.bz).normalize(),
        );
      },
    });
  }

  /** Esta parado en la largada (en el piso). */
  onStart(x: number, z: number): boolean {
    return Math.hypot(x - this.startX, z - this.startZ) < START_HALF + 0.2;
  }

  /** Cartel del record de la sala (abajo, en la largada, y arriba, sobre el trono). */
  setRecord(text: string, crownTaken: boolean): void {
    this.crown.visible = !crownTaken;
    if (text === this.recordText) return;
    this.recordText = text;
    setSpriteLabel(this.recordBase, plaqueTexture(text), 0.34);
    setSpriteLabel(this.recordTop, plaqueTexture(text), 0.34);
  }

  update(dt: number, t: number): void {
    this.time += dt;
    for (const v of this.visuals) v.update(t);
    // La baliza late como la de una antena.
    const on = Math.sin(this.time * 3) > 0.2;
    this.beaconLight.intensity = on ? 30 : 4;
    this.beaconMat.color.set(on ? "#ff2a1a" : "#5a0f08");
    // Las lamparas de obra titilan de a una (DESIGN.md: nunca todas juntas).
    for (let i = 0; i < this.lamps.length; i++) {
      this.lamps[i].intensity = Math.sin(this.time * (3 + i * 1.7) + i) > 0.985 ? 3 : 22;
    }
    this.crown.rotation.y += dt * 0.9;
    this.crown.position.y = this.topY + 2.1 + Math.sin(this.time * 1.7) * 0.1;
  }
}

/** Corona dorada con luz propia (la de la cima, y la que lleva puesta el que tiene el record). */
export function makeCrown(scale = 1): THREE.Group {
  const gold = psxBasic({ color: "#ffcf4a" });
  const crown = new THREE.Group();
  crown.add(new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.26, 0.2, 8, 1, true), gold));
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const spike = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.22, 4), gold);
    spike.position.set(Math.sin(a) * 0.28, 0.2, Math.cos(a) * 0.28);
    crown.add(spike);
  }
  crown.scale.setScalar(scale);
  return crown;
}
