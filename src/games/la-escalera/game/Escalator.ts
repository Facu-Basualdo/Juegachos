import * as THREE from "three";
import { toonMat, glowMat } from "./toon";
import { rampPoint, RAMP_LENGTH, RAMP_NORMAL, SLOPE_ANGLE, BOTTOM, TOP } from "./ramp";
import {
  RAMP_HALF_WIDTH,
  STEP_SPACING,
  STEP_HEIGHT,
  STEP_NOSE,
  SPIKE_ROWS,
  SPIKE_PER_ROW,
  SPIKE_LEN,
  SPIKE_RADIUS,
  COLOR_IRON,
  COLOR_IRON_DARK,
  COLOR_IRON_EDGE,
  COLOR_RUBBER,
  COLOR_GOLD_DEEP,
  COLOR_RUBY,
} from "./constants";

/**
 * La maquina: la cinta de escalones que baja sin parar, los faldones y
 * pasamanos que la encajonan, y el pozo de puas al pie. Todo cel-shaded
 * (ver DESIGN.md): formas gordas y legibles, hierro casi negro, un solo filo
 * frio por escalon para que la cadencia se lea a la velocidad del juego.
 */
export class Escalator {
  readonly object = new THREE.Group();
  /** Luz rubi que sale del pozo: el peligro se ve antes de llegar. */
  readonly pitLight: THREE.PointLight;

  private readonly steps: THREE.Group[] = [];
  private readonly stepT: number[] = [];
  /** Margen (en `t`) que se extiende la cinta por fuera de la rampa util. */
  private readonly margin = 0.04;

  constructor() {
    this.buildSteps();
    this.buildSides();
    this.buildLandings();
    this.buildPit();

    this.pitLight = new THREE.PointLight(COLOR_RUBY, 18, 8, 2);
    this.pitLight.position.set(0, BOTTOM.y - 0.4, BOTTOM.z + 1.2);
    this.object.add(this.pitLight);
  }

  // --- construccion ---------------------------------------------------------

  /** Un escalon: huella horizontal + contrahuella + el filo claro del borde. */
  private makeStep(): THREE.Group {
    const g = new THREE.Group();
    const width = RAMP_HALF_WIDTH * 2;
    const runZ = STEP_SPACING * Math.cos(SLOPE_ANGLE);
    const riseY = STEP_SPACING * Math.sin(SLOPE_ANGLE);

    const tread = new THREE.Mesh(
      new THREE.BoxGeometry(width, STEP_HEIGHT, runZ),
      toonMat(COLOR_IRON),
    );
    tread.castShadow = true;
    tread.receiveShadow = true;
    g.add(tread);

    // Contrahuella: la pared vertical entre huella y huella, mas oscura.
    const riser = new THREE.Mesh(
      new THREE.BoxGeometry(width, riseY, 0.12),
      toonMat(COLOR_IRON_DARK),
    );
    riser.position.set(0, -riseY / 2 - STEP_HEIGHT / 2 + 0.01, -runZ / 2 + 0.06);
    riser.receiveShadow = true;
    g.add(riser);

    // Filo frio: la unica luz que se le concede al hierro, y la que da cadencia.
    const nose = new THREE.Mesh(
      new THREE.BoxGeometry(width, STEP_NOSE, STEP_NOSE),
      toonMat(COLOR_IRON_EDGE, { emissive: COLOR_IRON_EDGE, emissiveIntensity: 0.2 }),
    );
    nose.position.set(0, STEP_HEIGHT / 2 - STEP_NOSE / 2 + 0.01, runZ / 2 - STEP_NOSE / 2);
    g.add(nose);

    return g;
  }

  private buildSteps(): void {
    const count = Math.ceil((RAMP_LENGTH / STEP_SPACING) * (1 + this.margin * 2)) + 2;
    const stepT = STEP_SPACING / RAMP_LENGTH;
    for (let i = 0; i < count; i++) {
      const step = this.makeStep();
      const t = -this.margin + i * stepT;
      this.stepT.push(t);
      this.placeStep(step, t);
      this.steps.push(step);
      this.object.add(step);
    }
  }

  /** Faldones, balaustrada y pasamanos a los costados de la cinta. */
  private buildSides(): void {
    const mid = rampPoint(0.5);
    for (const side of [-1, 1]) {
      const x = side * (RAMP_HALF_WIDTH + 0.16);

      const skirt = new THREE.Mesh(
        new THREE.BoxGeometry(0.3, 0.9, RAMP_LENGTH),
        toonMat(COLOR_IRON_DARK),
      );
      skirt.position.copy(mid);
      skirt.position.x = x;
      skirt.position.addScaledVector(RAMP_NORMAL, 0.1);
      skirt.rotation.x = SLOPE_ANGLE;
      skirt.receiveShadow = true;
      this.object.add(skirt);

      const balustrade = new THREE.Mesh(
        new THREE.BoxGeometry(0.12, 1.15, RAMP_LENGTH),
        toonMat(COLOR_IRON_DARK, { transparent: true, opacity: 0.92 }),
      );
      balustrade.position.copy(mid);
      balustrade.position.x = x;
      balustrade.position.addScaledVector(RAMP_NORMAL, 1.05);
      balustrade.rotation.x = SLOPE_ANGLE;
      this.object.add(balustrade);

      const rail = new THREE.Mesh(
        new THREE.BoxGeometry(0.34, 0.17, RAMP_LENGTH),
        toonMat(COLOR_RUBBER),
      );
      rail.position.copy(mid);
      rail.position.x = x;
      rail.position.addScaledVector(RAMP_NORMAL, 1.7);
      rail.rotation.x = SLOPE_ANGLE;
      rail.castShadow = true;
      this.object.add(rail);
    }
  }

  /** Las chapas doradas (peine) donde la cinta nace y muere. */
  private buildLandings(): void {
    const combGeo = new THREE.BoxGeometry(RAMP_HALF_WIDTH * 2 + 0.5, 0.12, 0.6);
    const combMat = toonMat(COLOR_GOLD_DEEP);

    const bottomComb = new THREE.Mesh(combGeo, combMat);
    bottomComb.position.copy(BOTTOM).addScaledVector(RAMP_NORMAL, 0.02);
    bottomComb.position.z += 0.45;
    bottomComb.receiveShadow = true;
    this.object.add(bottomComb);

    const topComb = new THREE.Mesh(combGeo, combMat);
    topComb.position.copy(TOP).addScaledVector(RAMP_NORMAL, 0.02);
    topComb.position.z -= 0.45;
    this.object.add(topComb);

    // Boca oscura arriba: la cinta sale de un hueco, no del aire.
    const mouth = new THREE.Mesh(
      new THREE.BoxGeometry(RAMP_HALF_WIDTH * 2 + 0.9, 1.4, 1.6),
      toonMat(COLOR_IRON_DARK),
    );
    mouth.position.copy(TOP);
    mouth.position.y += 0.5;
    mouth.position.z -= 1.5;
    this.object.add(mouth);
  }

  /** El pozo: piso hundido y tres hileras de dientes forjados, justo al pie de
   * la rampa y dentro del cuadro (es la amenaza: tiene que verse siempre). */
  private buildPit(): void {
    const pitFloorZ = BOTTOM.z + 1.4;
    const pitY = BOTTOM.y - 1.45;
    const floor = new THREE.Mesh(
      new THREE.BoxGeometry(RAMP_HALF_WIDTH * 2 + 2.4, 0.3, 3.4),
      toonMat(COLOR_IRON_DARK),
    );
    floor.position.set(0, pitY - 0.15, pitFloorZ);
    floor.receiveShadow = true;
    this.object.add(floor);

    const spikeGeo = new THREE.ConeGeometry(SPIKE_RADIUS, SPIKE_LEN, 4);
    const spikeMat = toonMat(COLOR_IRON, { emissive: COLOR_IRON_EDGE, emissiveIntensity: 0.06 });
    const span = RAMP_HALF_WIDTH * 2 + 1.6;
    for (let r = 0; r < SPIKE_ROWS; r++) {
      const z = BOTTOM.z + 0.55 + r * 0.85;
      for (let i = 0; i < SPIKE_PER_ROW; i++) {
        const spike = new THREE.Mesh(spikeGeo, spikeMat);
        const x = -span / 2 + (span * i) / (SPIKE_PER_ROW - 1) + (r % 2 ? 0.22 : 0);
        spike.position.set(x, pitY + SPIKE_LEN / 2, z);
        spike.rotation.y = Math.PI / 4; // seccion en rombo: diente, no gorro de fiesta
        spike.castShadow = true;
        this.object.add(spike);
      }
    }

    // Brasa del pozo: un disco tenue que justifica el resplandor rubi.
    const glow = new THREE.Mesh(
      new THREE.PlaneGeometry(span + 1.2, 3.2),
      glowMat(COLOR_RUBY, 0.07, true),
    );
    glow.rotation.x = -Math.PI / 2;
    glow.position.set(0, pitY + 0.04, pitFloorZ - 0.1);
    this.object.add(glow);
  }

  // --- runtime --------------------------------------------------------------

  private placeStep(step: THREE.Group, t: number): void {
    rampPoint(t, step.position);
  }

  /** Corre la cinta hacia abajo. `speed` va en unidades de `t` por segundo. */
  update(dt: number, speed: number): void {
    const range = 1 + this.margin * 2;
    for (let i = 0; i < this.steps.length; i++) {
      let t = this.stepT[i] - speed * dt;
      if (t < -this.margin) t += range;
      this.stepT[i] = t;
      this.placeStep(this.steps[i], t);
    }
  }

  /** Latido del pozo: la amenaza respira mas fuerte cuanto mas cerca estas. */
  pulsePit(elapsed: number, closeness: number): void {
    const beat = 0.82 + Math.sin(elapsed * 3.4) * 0.18;
    this.pitLight.intensity = (9 + closeness * 26) * beat;
  }
}
