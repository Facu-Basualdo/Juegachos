import * as THREE from "three";
import {
  HIGH_COLOR,
  LOW_COLOR,
  PYLON_R,
  SPIN_REACH,
  STAGE_R,
  WALL_SPAN,
  ZONE_COLOR,
  ZONE_TOP,
} from "./constants";
import {
  beamY,
  laserEnd,
  laserStart,
  spinAngle,
  wallOffset,
  type Height,
  type Laser,
  type Show,
  type SpinLaser,
  type WallLaser,
  type ZoneLaser,
} from "./Lasers";
import { glowTexture, stripTexture } from "./textures";

/** Antes de esto (ms) no se arma la vista de un laser. */
const PREBUILD_MS = 200;
const FADE_MS = 220;

/** Cilindro unitario acostado sobre x, centrado. Escala: (largo, radio, radio). */
const ROD = new THREE.CylinderGeometry(1, 1, 1, 12, 1, true).rotateZ(Math.PI / 2);
/** Plano unitario acostado sobre el piso, largo en x. */
const STRIP = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
const RING_GEO = new THREE.RingGeometry(0.86, 1, 48).rotateX(-Math.PI / 2);
const DISC_GEO = new THREE.CircleGeometry(1, 48).rotateX(-Math.PI / 2);
const COLUMN = new THREE.CylinderGeometry(1, 1, 1, 24, 1, true).translate(0, 0.5, 0);
const DRONE = new THREE.BoxGeometry(0.32, 0.14, 0.32);

let stripTex: THREE.Texture | null = null;
let glowTex: THREE.Texture | null = null;

export function laserColor(h: Height): string {
  return h === 0 ? LOW_COLOR : HIGH_COLOR;
}

function additive(color: string, opacity: number, map?: THREE.Texture): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color,
    map: map ?? null,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

/**
 * Un haz: nucleo casi blanco y fino, halo del color de su familia y la franja que deja en el
 * piso (DESIGN.md: el rasante la lleva pegada y nitida; el alto, tenue).
 */
class Beam {
  readonly group = new THREE.Group();
  private readonly core: THREE.Mesh;
  private readonly glow: THREE.Mesh;
  private readonly haze: THREE.Mesh;
  private readonly strip: THREE.Mesh;
  private readonly mats: THREE.MeshBasicMaterial[];
  private readonly stripBase: number;

  constructor(h: Height) {
    const color = laserColor(h);
    const coreMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(color).lerp(new THREE.Color("#ffffff"), 0.65),
      transparent: true,
    });
    const glowMat = additive(color, 0.75);
    const hazeMat = additive(color, 0.18);
    stripTex ??= stripTexture();
    this.stripBase = h === 0 ? 0.75 : 0.12;
    const stripMat = additive(color, this.stripBase, stripTex);
    this.core = new THREE.Mesh(ROD, coreMat);
    this.glow = new THREE.Mesh(ROD, glowMat);
    this.haze = new THREE.Mesh(ROD, hazeMat);
    this.strip = new THREE.Mesh(STRIP, stripMat);
    const y = beamY(h);
    for (const m of [this.core, this.glow, this.haze]) m.position.y = y;
    this.core.scale.set(1, 0.016, 0.016);
    this.glow.scale.set(1, 0.042, 0.042);
    this.haze.scale.set(1, 0.085, 0.085);
    this.strip.position.y = 0.012;
    this.strip.scale.z = h === 0 ? 0.20 : 0.28;
    this.strip.renderOrder = 2;
    this.mats = [coreMat, glowMat, hazeMat, stripMat];
    this.group.add(this.core, this.glow, this.haze, this.strip);
  }

  /** Tramo del haz en x local, de `from` a `to`; la franja del piso va de `sFrom` a `sTo`. */
  span(from: number, to: number, sFrom = from, sTo = to): void {
    const len = Math.max(0.001, to - from);
    for (const m of [this.core, this.glow, this.haze]) {
      m.scale.x = len;
      m.position.x = (from + to) / 2;
    }
    const slen = sTo - sFrom;
    this.strip.visible = slen > 0.01;
    this.strip.scale.x = Math.max(0.001, slen);
    this.strip.position.x = (sFrom + sTo) / 2;
  }

  /** `armed` = letal (pleno); si no, fantasma titilante. `fade` 0..1 multiplica todo. */
  look(armed: boolean, fade: number, flicker: number): void {
    const k = armed ? fade : (0.35 + 0.3 * flicker) * fade;
    this.core.visible = armed;
    this.mats[0].opacity = fade;
    this.mats[1].opacity = 0.75 * k;
    this.mats[2].opacity = 0.18 * k;
    this.mats[3].opacity = this.stripBase * k;
  }

  dispose(): void {
    for (const m of this.mats) m.dispose();
  }
}

interface View {
  laser: Laser;
  root: THREE.Group;
  beams: Beam[];
  extra: THREE.Mesh[];
  extraMats: THREE.Material[];
  sprites: THREE.Sprite[];
}

/** Que paso entre el cuadro anterior y este (para los sonidos y el cabezal de la torre). */
export interface LaserEvents {
  spinWarn: number;
  spinGo: number;
  wallGo: number;
  zoneWarn: number;
  zoneBlast: number;
  /** Color de la barrida que esta avisando o girando (para el cabezal), o null. */
  spinColor: string | null;
}

/**
 * Las vistas de los lasers: se arman un poco antes de que aparezca cada uno y se
 * tiran cuando termina, asi nunca hay mas de un puñado en escena aunque el show
 * entero tenga cien.
 */
export class LaserView {
  private readonly scene: THREE.Scene;
  private readonly show: Show;
  private readonly views = new Map<number, View>();
  /** Indice del primer laser que todavia no se armo (`show.lasers` va ordenado por inicio). */
  private next = 0;

  constructor(scene: THREE.Scene, show: Show) {
    this.scene = scene;
    this.show = show;
  }

  update(tPrev: number, t: number): LaserEvents {
    const ev: LaserEvents = { spinWarn: 0, spinGo: 0, wallGo: 0, zoneWarn: 0, zoneBlast: 0, spinColor: null };
    const lasers = this.show.lasers;
    while (this.next < lasers.length && laserStart(lasers[this.next]) - PREBUILD_MS <= t) {
      const l = lasers[this.next++];
      if (laserEnd(l) + FADE_MS < t) continue;
      this.views.set(l.id, this.build(l));
    }
    const flicker = Math.sin(t / 45) > 0 ? 1 : 0;
    for (const [id, v] of this.views) {
      const l = v.laser;
      if (t > laserEnd(l) + FADE_MS) {
        this.drop(id, v);
        continue;
      }
      if (l.kind === "spin") {
        if (crossed(tPrev, t, l.warn)) ev.spinWarn++;
        if (crossed(tPrev, t, l.t0)) ev.spinGo++;
        if (t >= l.warn && t <= l.t1) ev.spinColor = laserColor(l.arms[0]);
        this.drawSpin(v, l, t, flicker);
      } else if (l.kind === "wall") {
        if (crossed(tPrev, t, l.tm)) ev.wallGo++;
        this.drawWall(v, l, t, flicker);
      } else {
        if (crossed(tPrev, t, l.t0)) ev.zoneWarn++;
        if (crossed(tPrev, t, l.t1)) ev.zoneBlast++;
        this.drawZone(v, l, t);
      }
    }
    return ev;
  }

  /** Borra todo (al reiniciar el reloj hacia atras, que no deberia pasar, o al terminar). */
  clear(): void {
    for (const [id, v] of this.views) this.drop(id, v);
  }

  // ---------- Armado ----------

  private build(l: Laser): View {
    const root = new THREE.Group();
    const view: View = { laser: l, root, beams: [], extra: [], extraMats: [], sprites: [] };
    glowTex ??= glowTexture();
    if (l.kind === "spin") {
      const n = l.arms.length;
      l.arms.forEach((h, k) => {
        const arm = new Beam(h);
        arm.group.rotation.y = -(k * Math.PI * 2) / n;
        arm.span(PYLON_R, SPIN_REACH, PYLON_R, STAGE_R);
        root.add(arm.group);
        view.beams.push(arm);
        // Destello en la punta, donde el haz se apoya en el aro.
        const tip = this.sprite(laserColor(h), 0.42);
        tip.position.set(Math.cos((k * Math.PI * 2) / n) * SPIN_REACH, beamY(h), Math.sin((k * Math.PI * 2) / n) * SPIN_REACH);
        tip.userData.arm = k;
        view.sprites.push(tip);
        this.scene.add(tip);
      });
    } else if (l.kind === "wall") {
      const beam = new Beam(l.h);
      beam.span(-WALL_SPAN, WALL_SPAN);
      root.add(beam.group);
      view.beams.push(beam);
      // Dos drones en las puntas sostienen el haz.
      const droneMat = new THREE.MeshPhongMaterial({ color: "#e9e6ff", emissive: laserColor(l.h), emissiveIntensity: 0.6 });
      view.extraMats.push(droneMat);
      for (const side of [-1, 1]) {
        const drone = new THREE.Mesh(DRONE, droneMat);
        drone.position.set(side * WALL_SPAN, beamY(l.h), 0);
        root.add(drone);
        view.extra.push(drone);
        const glow = this.sprite(laserColor(l.h), 0.48);
        glow.position.set(side * WALL_SPAN, beamY(l.h), 0);
        root.add(glow);
      }
    } else {
      const ringMat = additive(ZONE_COLOR, 0.9);
      const fillMat = additive(ZONE_COLOR, 0.25);
      const coreMat = additive("#ffffff", 0.9);
      const haloMat = additive(ZONE_COLOR, 0.45);
      view.extraMats.push(ringMat, fillMat, coreMat, haloMat);
      const ring = new THREE.Mesh(RING_GEO, ringMat);
      const fill = new THREE.Mesh(DISC_GEO, fillMat);
      const core = new THREE.Mesh(COLUMN, coreMat);
      const halo = new THREE.Mesh(COLUMN, haloMat);
      ring.position.y = 0.02;
      fill.position.y = 0.018;
      ring.scale.setScalar(l.r);
      core.scale.set(l.r * 0.5, ZONE_TOP, l.r * 0.5);
      halo.scale.set(l.r, ZONE_TOP, l.r);
      ring.renderOrder = fill.renderOrder = 2;
      root.add(ring, fill, core, halo);
      view.extra.push(ring, fill, core, halo);
      root.position.set(l.x, 0, l.z);
    }
    this.scene.add(root);
    return view;
  }

  private sprite(color: string, size: number): THREE.Sprite {
    const s = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTex,
        color,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    s.scale.setScalar(size);
    return s;
  }

  private drop(id: number, v: View): void {
    this.scene.remove(v.root);
    for (const s of v.sprites) {
      this.scene.remove(s);
      s.material.dispose();
    }
    v.root.traverse((o) => {
      if (o instanceof THREE.Sprite) o.material.dispose();
    });
    for (const b of v.beams) b.dispose();
    for (const m of v.extraMats) m.dispose();
    this.views.delete(id);
  }

  // ---------- Dibujo por cuadro ----------

  private drawSpin(v: View, l: SpinLaser, t: number, flicker: number): void {
    const armed = t >= l.t0 && t <= l.t1;
    const fade = fadeOf(t, l.warn, l.t1);
    const th = spinAngle(l, t);
    v.root.rotation.y = -th;
    for (const b of v.beams) b.look(armed, fade, flicker);
    const n = l.arms.length;
    for (const s of v.sprites) {
      const a = th + ((s.userData.arm as number) * Math.PI * 2) / n;
      s.position.x = Math.cos(a) * SPIN_REACH;
      s.position.z = Math.sin(a) * SPIN_REACH;
      s.material.opacity = (armed ? 1 : 0.35 * flicker) * fade;
    }
  }

  private drawWall(v: View, l: WallLaser, t: number, flicker: number): void {
    const s = wallOffset(l, t);
    v.root.position.set(Math.cos(l.ang) * s, 0, Math.sin(l.ang) * s);
    v.root.rotation.y = -l.ang - Math.PI / 2;
    // La franja solo sobre el escenario: la cuerda del disco a esa distancia del centro.
    const half = Math.abs(s) < STAGE_R ? Math.sqrt(STAGE_R * STAGE_R - s * s) : 0;
    const beam = v.beams[0];
    beam.span(-WALL_SPAN, WALL_SPAN, -half, half);
    const moving = t >= l.tm;
    beam.look(moving || flicker === 1, fadeOf(t, l.t0, l.t1), flicker);
  }

  private drawZone(v: View, l: ZoneLaser, t: number): void {
    const [ring, fill, core, halo] = v.extra;
    const [ringMat, fillMat, coreMat, haloMat] = v.extraMats as THREE.MeshBasicMaterial[];
    if (t < l.t1) {
      // Aviso: el aro titila cada vez mas rapido y el disco se va llenando.
      const k = Math.max(0, Math.min(1, (t - l.t0) / (l.t1 - l.t0)));
      fill.scale.setScalar(Math.max(0.01, l.r * k));
      fillMat.opacity = 0.18 + 0.2 * k;
      ringMat.opacity = 0.5 + 0.5 * (Math.sin(t / (90 - 60 * k)) > 0 ? 1 : 0);
      ring.visible = fill.visible = true;
      core.visible = halo.visible = false;
      return;
    }
    // Estallido: columna blanca con halo magenta que se apaga.
    const k = 1 - Math.max(0, Math.min(1, (t - l.t1) / (l.t2 - l.t1 + FADE_MS)));
    ring.visible = fill.visible = true;
    fill.scale.setScalar(l.r);
    fillMat.opacity = 0.6 * k;
    ringMat.opacity = k;
    core.visible = halo.visible = true;
    coreMat.opacity = 0.7 * k;
    haloMat.opacity = 0.3 * k;
    const pulse = 1 + 0.08 * Math.sin(t / 25);
    halo.scale.x = halo.scale.z = l.r * pulse;
  }
}

function crossed(tPrev: number, t: number, at: number): boolean {
  return tPrev < at && t >= at;
}

/** Entra en `FADE_MS` desde `from` y se apaga en `FADE_MS` despues de `to`. */
function fadeOf(t: number, from: number, to: number): number {
  const fin = Math.min(1, Math.max(0, (t - from) / FADE_MS));
  const fout = t <= to ? 1 : Math.max(0, 1 - (t - to) / FADE_MS);
  return Math.min(fin, fout);
}
