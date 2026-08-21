import * as THREE from "three";
import { toonMat, glowMat } from "./toon";
import { rampPoint, RAMP_LENGTH, RAMP_NORMAL, SLOPE_ANGLE, BOTTOM, TOP } from "./ramp";
import {
  RAMP_HALF_WIDTH,
  STEP_SPACING,
  STEP_HEIGHT,
  SPIKE_ROWS,
  SPIKE_PER_ROW,
  SPIKE_LEN,
  SPIKE_RADIUS,
  PIT_FLOOR_Y,
  COLOR_IRON,
  COLOR_IRON_DARK,
  COLOR_STEEL,
  COLOR_SAFETY,
  COLOR_GLASS,
  COLOR_RUBBER,
  COLOR_BONE,
  COLOR_RUBY,
  COLOR_BLOOD_DARK,
} from "./constants";

/** Chapa estriada: las acanaladuras corren en el sentido de la marcha, como en
 * cualquier escalera mecanica de local. Es lo que hace que un escalon lea como
 * escalon y no como una caja. */
function cleatTexture(light: string, dark: string, bands: number): THREE.CanvasTexture {
  const w = 128;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = 8;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = light;
  ctx.fillRect(0, 0, w, 8);
  ctx.fillStyle = dark;
  const step = w / bands;
  for (let i = 0; i < bands; i++) ctx.fillRect(i * step, 0, step * 0.42, 8);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/** Peine amarillo de las plataformas: dientes finos contra el borde. */
function combTexture(): THREE.CanvasTexture {
  const w = 128;
  const h = 32;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#9c7415";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#2a2008";
  for (let i = 0; i < 42; i++) ctx.fillRect((i * w) / 42, 0, w / 42 / 2, h * 0.55);
  ctx.fillStyle = "#7a5c14";
  ctx.fillRect(0, h * 0.8, w, h * 0.2);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/** Bandas del pasamanos: sin ellas la goma negra no se ve moverse. */
function handrailTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 8;
  canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#14161b";
  ctx.fillRect(0, 0, 8, 64);
  ctx.fillStyle = "#2c3038";
  ctx.fillRect(0, 0, 8, 6);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, 26);
  return tex;
}

/**
 * La maquina: una escalera mecanica de local (escalones de chapa estriada con
 * borde amarillo de seguridad, faldones de inoxidable, balaustrada de vidrio y
 * pasamanos de goma que se ve correr) que baja sin parar, y el pozo de puas al
 * pie. El contraste es a proposito: el aparato mas cotidiano posible terminando
 * en un pozo de hierro (ver DESIGN.md).
 */
export class Escalator {
  readonly object = new THREE.Group();
  /** Luz rubi que sale del pozo: el peligro se ve antes de llegar. */
  readonly pitLight: THREE.PointLight;

  private readonly steps: THREE.Group[] = [];
  private readonly stepT: number[] = [];
  private readonly handrailTex = handrailTexture();
  /** Margen (en `t`) que se extiende la cinta por fuera de la rampa util. */
  private readonly margin = 0.04;

  // Materiales compartidos por los 20+ escalones (una sola instancia de cada).
  private readonly treadMat = toonMat(COLOR_STEEL);
  private readonly riserMat = toonMat(COLOR_IRON_DARK);
  private readonly safetyMat = toonMat(COLOR_SAFETY, {
    emissive: COLOR_SAFETY,
    emissiveIntensity: 0.03,
  });

  constructor() {
    const runZ = STEP_SPACING * Math.cos(SLOPE_ANGLE);
    this.treadMat.map = cleatTexture("#d2d8e0", "#8b93a0", 26);
    this.riserMat.map = cleatTexture("#6d747f", "#2b2f36", 26);

    this.buildSteps(runZ);
    this.buildSides();
    this.buildLandings();
    this.buildPit();

    this.pitLight = new THREE.PointLight(COLOR_RUBY, 18, 8, 2);
    this.pitLight.position.set(0, BOTTOM.y - 0.4, BOTTOM.z + 1.2);
    this.object.add(this.pitLight);
  }

  // --- construccion ---------------------------------------------------------

  /** Un escalon: huella estriada + contrahuella + los bordes amarillos. */
  private makeStep(runZ: number): THREE.Group {
    const g = new THREE.Group();
    const width = RAMP_HALF_WIDTH * 2;
    const riseY = STEP_SPACING * Math.sin(SLOPE_ANGLE);

    const tread = new THREE.Mesh(new THREE.BoxGeometry(width, STEP_HEIGHT, runZ), this.treadMat);
    tread.castShadow = true;
    tread.receiveShadow = true;
    g.add(tread);

    const riser = new THREE.Mesh(new THREE.BoxGeometry(width, riseY, 0.1), this.riserMat);
    riser.position.set(0, -riseY / 2 - STEP_HEIGHT / 2 + 0.01, -runZ / 2 + 0.05);
    riser.receiveShadow = true;
    g.add(riser);

    // Demarcacion amarilla: el frente y los dos costados de la huella, como la
    // que llevan pintada (o moldeada) todos los escalones de verdad.
    const frontEdge = new THREE.Mesh(new THREE.BoxGeometry(width, 0.05, 0.05), this.safetyMat);
    frontEdge.position.set(0, STEP_HEIGHT / 2 - 0.008, runZ / 2 - 0.025);
    g.add(frontEdge);

    return g;
  }

  private buildSteps(runZ: number): void {
    const count = Math.ceil((RAMP_LENGTH / STEP_SPACING) * (1 + this.margin * 2)) + 2;
    const stepT = STEP_SPACING / RAMP_LENGTH;
    for (let i = 0; i < count; i++) {
      const step = this.makeStep(runZ);
      const t = -this.margin + i * stepT;
      this.stepT.push(t);
      rampPoint(t, step.position);
      this.steps.push(step);
      this.object.add(step);
    }
  }

  /** Faldon de inoxidable, balaustrada de vidrio y pasamanos por cada lado. */
  private buildSides(): void {
    const mid = rampPoint(0.5);
    const glassMat = new THREE.MeshBasicMaterial({
      color: COLOR_GLASS,
      transparent: true,
      opacity: 0.13,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    for (const side of [-1, 1]) {
      const x = side * (RAMP_HALF_WIDTH + 0.16);

      // Faldon: chapa de inoxidable pegada al escalon.
      const skirt = new THREE.Mesh(
        new THREE.BoxGeometry(0.28, 0.95, RAMP_LENGTH),
        toonMat(0x4e545e),
      );
      skirt.position.copy(mid);
      skirt.position.x = x;
      skirt.position.addScaledVector(RAMP_NORMAL, 0.14);
      skirt.rotation.x = SLOPE_ANGLE;
      skirt.receiveShadow = true;
      this.object.add(skirt);

      // Cepillo de seguridad amarillo/negro al pie del faldon.
      const brush = new THREE.Mesh(
        new THREE.BoxGeometry(0.07, 0.09, RAMP_LENGTH),
        toonMat(COLOR_SAFETY),
      );
      brush.position.copy(skirt.position);
      brush.position.x = x - side * 0.14;
      brush.position.addScaledVector(RAMP_NORMAL, -0.36);
      brush.rotation.x = SLOPE_ANGLE;
      this.object.add(brush);

      // Balaustrada de vidrio: es lo que hace que lea como escalera de local.
      const glass = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.5, RAMP_LENGTH), glassMat);
      glass.position.copy(mid);
      glass.position.x = x;
      glass.position.addScaledVector(RAMP_NORMAL, 1.35);
      glass.rotation.x = SLOPE_ANGLE;
      this.object.add(glass);

      // Zocalo iluminado bajo el vidrio (la luz de vitrina de los locales).
      const strip = new THREE.Mesh(
        new THREE.BoxGeometry(0.1, 0.05, RAMP_LENGTH),
        glowMat(COLOR_BONE, 0.32),
      );
      strip.position.copy(mid);
      strip.position.x = x;
      strip.position.addScaledVector(RAMP_NORMAL, 0.63);
      strip.rotation.x = SLOPE_ANGLE;
      this.object.add(strip);

      // Pasamanos redondo de goma, con bandas para que se lo vea correr.
      const railMat = toonMat(COLOR_RUBBER);
      railMat.map = this.handrailTex;
      const rail = new THREE.Mesh(
        new THREE.CylinderGeometry(0.12, 0.12, RAMP_LENGTH, 10),
        railMat,
      );
      rail.position.copy(mid);
      rail.position.x = x;
      rail.position.addScaledVector(RAMP_NORMAL, 2.15);
      rail.rotation.x = Math.PI / 2 - SLOPE_ANGLE;
      rail.castShadow = true;
      this.object.add(rail);
    }
  }

  /** Plataformas con peine amarillo donde la cinta nace y muere. */
  private buildLandings(): void {
    const combMat = toonMat(COLOR_SAFETY);
    combMat.map = combTexture();
    const combGeo = new THREE.BoxGeometry(RAMP_HALF_WIDTH * 2 + 0.4, 0.1, 0.55);

    const bottomComb = new THREE.Mesh(combGeo, combMat);
    bottomComb.position.copy(BOTTOM).addScaledVector(RAMP_NORMAL, 0.02);
    bottomComb.position.z += 0.34;
    this.object.add(bottomComb);

    const topComb = new THREE.Mesh(combGeo, combMat);
    topComb.position.copy(TOP).addScaledVector(RAMP_NORMAL, 0.02);
    topComb.position.z -= 0.34;
    this.object.add(topComb);

    // Piso de la plataforma de arriba + la boca por donde sale la cinta.
    const deck = new THREE.Mesh(
      new THREE.BoxGeometry(RAMP_HALF_WIDTH * 2 + 1.2, 0.24, 1.8),
      toonMat(COLOR_IRON),
    );
    deck.position.copy(TOP);
    deck.position.z -= 1.2;
    deck.position.y -= 0.06;
    this.object.add(deck);

    const housing = new THREE.Mesh(
      new THREE.BoxGeometry(RAMP_HALF_WIDTH * 2 + 1.2, 1.5, 1.5),
      toonMat(COLOR_IRON_DARK),
    );
    housing.position.copy(TOP);
    housing.position.y += 0.6;
    housing.position.z -= 1.9;
    this.object.add(housing);
  }

  /**
   * El pozo. Las puas se generan con `LatheGeometry`: brida de base, cuello y un
   * afilado concavo hasta la punta — un hierro forjado, no un cono de fiesta.
   * Cada una varia en alto, giro e inclinacion, y usan `MeshStandardMaterial`
   * (la unica excepcion PBR de la escena, documentada en DESIGN.md) porque el
   * especular corrido sobre el filo es justamente lo que las hace leer como
   * metal afilado de verdad.
   */
  private buildPit(): void {
    const pitFloorZ = BOTTOM.z + 1.4;
    const floorMat = toonMat(COLOR_IRON_DARK);
    floorMat.map = cleatTexture("#2a2d34", "#15171c", 18);
    floorMat.map.repeat.set(8, 4);

    const floor = new THREE.Mesh(
      new THREE.BoxGeometry(RAMP_HALF_WIDTH * 2 + 2.4, 0.3, 3.6),
      floorMat,
    );
    floor.position.set(0, PIT_FLOOR_Y - 0.15, pitFloorZ);
    floor.receiveShadow = true;
    this.object.add(floor);

    // Paredes del pozo, para que se lea como hueco y no como puas apoyadas.
    for (const side of [-1, 1]) {
      const wall = new THREE.Mesh(
        new THREE.BoxGeometry(0.3, 1.4, 3.6),
        toonMat(COLOR_IRON_DARK),
      );
      wall.position.set(side * (RAMP_HALF_WIDTH + 1.2), PIT_FLOOR_Y + 0.4, pitFloorZ);
      this.object.add(wall);
    }

    const spikeGeo = this.makeSpikeGeometry();
    // Unica excepcion PBR de la escena (ver DESIGN.md): sin env map, metalness
    // alto deja el hierro casi negro, asi que va metalico medio + rugosidad baja
    // — difuso frio que se lee, con el especular corrido a lo largo del filo.
    const spikeMat = new THREE.MeshStandardMaterial({
      color: 0x7d848f,
      metalness: 0.3,
      roughness: 0.45,
    });
    const railMat = toonMat(COLOR_IRON_DARK);
    const span = RAMP_HALF_WIDTH * 2 + 1.5;

    for (let r = 0; r < SPIKE_ROWS; r++) {
      const z = BOTTOM.z + 0.5 + r * 0.78;

      const rail = new THREE.Mesh(
        new THREE.BoxGeometry(span + 0.5, 0.12, 0.22),
        railMat,
      );
      rail.position.set(0, PIT_FLOOR_Y + 0.05, z);
      this.object.add(rail);

      for (let i = 0; i < SPIKE_PER_ROW; i++) {
        const spike = new THREE.Mesh(spikeGeo, spikeMat);
        const x =
          -span / 2 + (span * i) / (SPIKE_PER_ROW - 1) + (r % 2 ? 0.2 : 0) + (Math.random() - 0.5) * 0.08;
        spike.position.set(x, PIT_FLOOR_Y, z + (Math.random() - 0.5) * 0.12);
        spike.scale.y = 0.82 + Math.random() * 0.36;
        spike.rotation.y = Math.random() * Math.PI;
        // Ninguna esta perfectamente a plomo: se clavaron a mano, hace mucho.
        spike.rotation.x = (Math.random() - 0.5) * 0.12;
        spike.rotation.z = (Math.random() - 0.5) * 0.12;
        spike.castShadow = true;
        this.object.add(spike);
      }
    }

    // Manchas viejas en el fondo: esto ya mato antes.
    const stainMat = glowMat(COLOR_BLOOD_DARK, 0.55);
    for (let i = 0; i < 7; i++) {
      const stain = new THREE.Mesh(new THREE.CircleGeometry(0.2 + Math.random() * 0.4, 8), stainMat);
      stain.rotation.x = -Math.PI / 2;
      stain.rotation.z = Math.random() * Math.PI;
      stain.position.set(
        (Math.random() - 0.5) * (span + 0.6),
        PIT_FLOOR_Y + 0.012,
        pitFloorZ + (Math.random() - 0.5) * 3,
      );
      stain.scale.set(1, 0.6 + Math.random() * 0.7, 1);
      this.object.add(stain);
    }

    // Brasa del pozo: un disco tenue que justifica el resplandor rubi.
    const glow = new THREE.Mesh(
      new THREE.PlaneGeometry(span + 1.2, 3.2),
      glowMat(COLOR_RUBY, 0.05, true),
    );
    glow.rotation.x = -Math.PI / 2;
    glow.position.set(0, PIT_FLOOR_Y + 0.05, pitFloorZ - 0.1);
    this.object.add(glow);
  }

  /** Perfil de la pua: brida, cuello y afilado concavo hasta la punta. */
  private makeSpikeGeometry(): THREE.LatheGeometry {
    const profile: THREE.Vector2[] = [
      new THREE.Vector2(0.0, 0),
      new THREE.Vector2(SPIKE_RADIUS * 1.55, 0),
      new THREE.Vector2(SPIKE_RADIUS * 1.5, 0.06),
      new THREE.Vector2(SPIKE_RADIUS * 1.08, 0.11),
      new THREE.Vector2(SPIKE_RADIUS, 0.18),
    ];
    const steps = 9;
    for (let i = 1; i <= steps; i++) {
      const k = i / steps;
      const y = 0.18 + k * (SPIKE_LEN - 0.18);
      // Concavo: el filo se afina rapido y despues acompaña, como una hoja.
      const r = SPIKE_RADIUS * Math.pow(1 - k, 1.45);
      profile.push(new THREE.Vector2(Math.max(r, 0.004), y));
    }
    return new THREE.LatheGeometry(profile, 14);
  }

  // --- runtime --------------------------------------------------------------

  /** Corre la cinta hacia abajo. `speed` va en unidades de `t` por segundo. */
  update(dt: number, speed: number): void {
    const range = 1 + this.margin * 2;
    for (let i = 0; i < this.steps.length; i++) {
      let t = this.stepT[i] - speed * dt;
      if (t < -this.margin) t += range;
      this.stepT[i] = t;
      rampPoint(t, this.steps[i].position);
    }
    // El pasamanos corre con la cinta (siempre un poco mas lento, como el real).
    this.handrailTex.offset.y -= speed * dt * 5.2;
  }

  /** Latido del pozo: la amenaza respira mas fuerte cuanto mas cerca estas. */
  pulsePit(elapsed: number, closeness: number): void {
    const beat = 0.82 + Math.sin(elapsed * 3.4) * 0.18;
    this.pitLight.intensity = (6 + closeness * 18) * beat;
  }
}
