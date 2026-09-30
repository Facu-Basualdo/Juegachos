import * as THREE from "three";
import type { Circle } from "./Physics";
import { psxLambert } from "./retro";
import { labelSprite, plaqueTexture, rustTexture, setSpriteLabel } from "./textures";

/** Un jugador en el marcador. */
export interface BoardEntry {
  player: string;
  color: string;
  /** Puntos acumulados de la partida. */
  points: number;
  /** Puesto (1 = primero; los empatados comparten). */
  rank: number;
  /** Puntos que sumo en la ronda recien jugada (solo en resultados). */
  gained?: number;
}

/** Separacion entre columnas (8 entran en la plaza de 6.8 m). */
const SPACING = 0.92;
const MIN_H = 0.35;
const MAX_H = 3.2;
const RADIUS = 0.36;
/** Cuanto se hunde el marcador guardado (queda debajo del pasto). */
const HIDDEN_Y = -4.5;
const GAIN_MS = 2600;

interface Column {
  group: THREE.Group;
  body: THREE.Mesh;
  mat: THREE.MeshLambertMaterial;
  label: THREE.Sprite;
  labelText: string;
  crown: THREE.Group;
  gain: THREE.Sprite | null;
  gainAt: number;
  h: number;
  targetH: number;
  x: number;
  targetX: number;
  collider: Circle;
  used: boolean;
}

/**
 * Marcador de la plaza (DESIGN.md: el marcador son columnas del color de cada jugador
 * que se ven en la oscuridad). En los resultados y en la final el televisor se hunde y
 * en su lugar suben columnas de chapa pintada del color de cada jugador, tan altas como sus puntos. Van en
 * orden de podio: el primero al medio, el segundo a su izquierda, el tercero a su
 * derecha, y asi. En los resultados crecen desde los puntos de antes de la ronda y
 * sale un "+N" arriba; en la final el que gano lleva corona.
 *
 * Las columnas chocan (sus `colliders` estan en la lista de la isla); guardadas,
 * tienen radio 0.
 */
export class Scoreboard {
  readonly group = new THREE.Group();
  readonly colliders: Circle[] = [];
  private readonly columns = new Map<string, Column>();
  private raised = 0;
  private raisedTarget = 0;
  private gainKey = "";
  private time = 0;

  constructor() {
    this.group.position.y = HIDDEN_Y;
    this.group.visible = false;
  }

  /** null = guardar el marcador. `key` identifica la ronda (el "+N" sale una vez por ronda). */
  set(entries: BoardEntry[] | null, final: boolean, key: string): void {
    if (!entries || entries.length === 0) {
      this.raisedTarget = 0;
      return;
    }
    this.raisedTarget = 1;
    const max = Math.max(1, ...entries.map((e) => e.points));
    const sorted = [...entries].sort((a, b) => a.rank - b.rank || (a.player < b.player ? -1 : 1));
    const showGain = key !== this.gainKey;
    this.gainKey = key;
    const now = performance.now();

    for (const c of this.columns.values()) c.used = false;
    sorted.forEach((e, i) => {
      // Orden de podio: 0 al medio, 1 a la izquierda, 2 a la derecha, 3 mas a la izquierda...
      const slot = i === 0 ? 0 : i % 2 === 1 ? -Math.ceil(i / 2) : Math.ceil(i / 2);
      const col = this.column(e.player, e.color);
      col.used = true;
      col.targetX = slot * SPACING;
      col.targetH = MIN_H + ((MAX_H - MIN_H) * e.points) / max;
      col.crown.visible = final && e.rank === 1 && e.points > 0;

      const text = `${e.player}  ${e.points}`;
      if (text !== col.labelText) {
        col.labelText = text;
        setSpriteLabel(col.label, plaqueTexture(text, { size: 30 }), 0.34);
      }

      if (showGain && e.gained !== undefined) {
        // Crece desde lo que tenia antes de la ronda.
        col.h = MIN_H + ((MAX_H - MIN_H) * Math.max(0, e.points - e.gained)) / max;
        if (e.gained > 0) {
          if (!col.gain) {
            col.gain = labelSprite(plaqueTexture(`+${e.gained}`, { bg: "#ffcf4a", size: 34 }), 0.4);
            col.group.add(col.gain);
          } else {
            setSpriteLabel(col.gain, plaqueTexture(`+${e.gained}`, { bg: "#ffcf4a", size: 34 }), 0.4);
          }
          // Si el marcador todavia esta saliendo del piso, el "+N" espera a que suba.
          col.gainAt = now + (this.raised > 0.9 ? 0 : 1300);
        }
      }
    });
    for (const [name, c] of this.columns) {
      if (!c.used) {
        this.group.remove(c.group);
        c.collider.r = 0;
        this.columns.delete(name);
      }
    }
  }

  private column(player: string, color: string): Column {
    let col = this.columns.get(player);
    if (col) {
      col.mat.color.set(color);
      col.mat.emissive.set(color).multiplyScalar(0.45);
      return col;
    }
    const group = new THREE.Group();
    // Un poco de luz propia: la final es de noche y sin esto las columnas se ven negras.
    const mat = psxLambert({ color, map: rustTexture() });
    mat.emissive.set(color).multiplyScalar(0.45);
    const body = new THREE.Mesh(new THREE.CylinderGeometry(RADIUS * 0.9, RADIUS, 1, 6), mat);
    group.add(body);

    const label = labelSprite(plaqueTexture(player, { size: 30 }), 0.34);
    group.add(label);

    // Corona: aro dorado con cinco puntas.
    const gold = psxLambert({ color: "#ffcf4a", emissive: "#8a6200" });
    const crown = new THREE.Group();
    crown.add(new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.22, 0.16, 10, 1, true), gold));
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.18, 4), gold);
      spike.position.set(Math.sin(a) * 0.24, 0.16, Math.cos(a) * 0.24);
      crown.add(spike);
    }
    crown.visible = false;
    group.add(crown);

    this.group.add(group);
    const collider: Circle = { x: 0, z: 0, r: 0, top: 4 };
    this.colliders.push(collider);
    col = {
      group,
      body,
      mat,
      label,
      labelText: player,
      crown,
      gain: null,
      gainAt: 0,
      h: MIN_H,
      targetH: MIN_H,
      x: 0,
      targetX: 0,
      collider,
      used: true,
    };
    this.columns.set(player, col);
    return col;
  }

  /** 0 = guardado, 1 = arriba. La isla hunde el pedestal a la par. */
  get raise(): number {
    return this.raised;
  }

  update(dt: number): void {
    this.time += dt;
    this.raised += (this.raisedTarget - this.raised) * Math.min(1, dt * 2.2);
    if (Math.abs(this.raisedTarget - this.raised) < 0.002) this.raised = this.raisedTarget;
    this.group.position.y = HIDDEN_Y * (1 - this.raised);
    this.group.visible = this.raised > 0.01;

    const up = this.raised > 0.6;
    const now = performance.now();
    // Las columnas crecen recien cuando el marcador ya salio del piso.
    const grow = this.raised > 0.9 ? Math.min(1, dt * 1.6) : 0;
    for (const c of this.columns.values()) {
      c.h += (c.targetH - c.h) * grow;
      c.x += (c.targetX - c.x) * Math.min(1, dt * 3);
      c.group.position.x = c.x;
      c.body.scale.y = c.h;
      c.body.position.y = c.h / 2;
      c.label.position.y = c.h + 0.32;
      c.crown.position.y = c.h + 0.62 + Math.sin(this.time * 2) * 0.05;
      c.crown.rotation.y += dt * 1.2;
      c.collider.x = c.x;
      c.collider.z = 0;
      c.collider.r = up ? RADIUS + 0.05 : 0;
      if (c.gain) {
        const k = (now - c.gainAt) / GAIN_MS;
        c.gain.visible = k >= 0 && k < 1 && this.raised > 0.9;
        c.gain.position.y = c.h + 0.75 + k * 0.9;
        c.gain.material.opacity = k < 0.75 ? 1 : 1 - (k - 0.75) / 0.25;
      }
    }
  }
}
