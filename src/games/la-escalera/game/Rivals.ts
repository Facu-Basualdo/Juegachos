import * as THREE from "three";
import { toonMat, glowMat } from "./toon";
import { Climber } from "./Climber";
import { rampPoint, RAMP_LENGTH, RAMP_NORMAL, SLOPE_ANGLE, BOTTOM } from "./ramp";
import {
  RAMP_HALF_WIDTH,
  STEP_SPACING,
  STEP_HEIGHT,
  SPIKE_LEN,
  SPIKE_RADIUS,
  PIT_FLOOR_Y,
  START_T,
  COLOR_STEEL,
  COLOR_IRON_DARK,
  COLOR_SAFETY,
  COLOR_GLASS,
  COLOR_RUBBER,
  COLOR_BLOOD_DARK,
  COLOR_RUBY,
} from "./constants";

/** Separacion entre el eje de un carril y el del siguiente. */
const LANE_GAP = 5.6;
/** Sin noticias de un rival por este tiempo, se lo da por desconectado. */
const STALE_MS = 6000;

/** Colores de mameluco de los rivales, en orden. El propio va siempre azul. */
const RIVAL_SUITS: readonly { suit: number; suitDark: number; helmet: number }[] = [
  { suit: 0x6d1220, suitDark: 0x430a14, helmet: 0xb8642a },
  { suit: 0x2f4a2a, suitDark: 0x1b2c18, helmet: 0xa9a03a },
  { suit: 0x4a2f5c, suitDark: 0x2b1a36, helmet: 0x9a6bbf },
  { suit: 0x5c4a1e, suitDark: 0x352a10, helmet: 0xc9a24a },
  { suit: 0x1e4a5c, suitDark: 0x102c36, helmet: 0x4aa9c9 },
  { suit: 0x5c2f1e, suitDark: 0x361a10, helmet: 0xc96b3a },
  { suit: 0x3a3a44, suitDark: 0x1f1f26, helmet: 0x8d94a2 },
];

interface Lane {
  player: string;
  group: THREE.Group;
  climber: Climber;
  tag: THREE.Sprite;
  stepT: number[];
  treads: THREE.InstancedMesh;
  risers: THREE.InstancedMesh;
  edges: THREE.InstancedMesh;
  /** Altura mostrada (interpolada hacia `target`). */
  height: number;
  target: number;
  dead: boolean;
  lastSeen: number;
}

/**
 * Los rivales de la sala, cada uno en su propia escalera al lado de la tuya
 * (como la referencia del juego de TV): mismo pozo, mismo arrastre, su nombre
 * flotando encima. Solo existen en modo sala y son **puramente cosmeticos**: su
 * posicion llega por el broadcast efimero del canal (`RoomMode.broadcastLive`,
 * unas ~8 veces por segundo) y nada de lo que hacen toca tu partida ni el
 * puntaje. Si un paquete se pierde, ese muñeco se queda quieto un instante.
 *
 * Los escalones de cada carril van en `InstancedMesh` (una llamada de dibujo
 * por pieza en vez de 22): con 7 rivales, escalones sueltos serian ~700 draw
 * calls solo en escaleras.
 */
export class Rivals {
  readonly object = new THREE.Group();

  private readonly lanes = new Map<string, Lane>();
  private readonly stepCount: number;
  private readonly matrix = new THREE.Matrix4();
  private readonly pos = new THREE.Vector3();
  private laneHalfWidth = 0;

  // Geometrias y materiales compartidos por todos los carriles.
  private readonly runZ = STEP_SPACING * Math.cos(SLOPE_ANGLE);
  private readonly riseY = STEP_SPACING * Math.sin(SLOPE_ANGLE);
  private readonly treadMat = toonMat(COLOR_STEEL);
  private readonly riserMat = toonMat(COLOR_IRON_DARK);
  private readonly edgeMat = toonMat(COLOR_SAFETY);
  private readonly spikeMat = new THREE.MeshStandardMaterial({
    color: 0x7d848f,
    metalness: 0.3,
    roughness: 0.45,
  });

  constructor() {
    this.stepCount = Math.ceil(RAMP_LENGTH / STEP_SPACING) + 2;
  }

  /** Cuanto ocupa el conjunto a cada lado del centro (para encuadrar). */
  get halfWidth(): number {
    return this.laneHalfWidth;
  }

  get count(): number {
    return this.lanes.size;
  }

  /**
   * Arma un carril por cada rival. `others` va en el orden estable de la sala,
   * asi todos los clientes ven la misma disposicion.
   */
  build(others: readonly string[]): void {
    this.clear();
    others.forEach((player, i) => {
      // Se reparten alternando a los costados: 1 derecha, 1 izquierda, 2...
      const step = Math.floor(i / 2) + 1;
      const dir = i % 2 === 0 ? 1 : -1;
      const laneX = dir * step * LANE_GAP;
      this.laneHalfWidth = Math.max(this.laneHalfWidth, Math.abs(laneX) + RAMP_HALF_WIDTH + 1.2);
      this.lanes.set(player, this.makeLane(player, laneX, i));
    });
  }

  clear(): void {
    for (const lane of this.lanes.values()) this.object.remove(lane.group);
    this.lanes.clear();
    this.laneHalfWidth = 0;
  }

  /** Vuelve a poner a todos arriba, vivos, al empezar una ronda. */
  reset(): void {
    for (const lane of this.lanes.values()) {
      lane.height = START_T;
      lane.target = START_T;
      lane.dead = false;
      lane.climber.reset();
      lane.group.visible = true;
    }
  }

  private makeLane(player: string, laneX: number, index: number): Lane {
    const group = new THREE.Group();
    group.position.x = laneX;
    this.object.add(group);

    const width = RAMP_HALF_WIDTH * 2;
    const treads = new THREE.InstancedMesh(
      new THREE.BoxGeometry(width, STEP_HEIGHT, this.runZ),
      this.treadMat,
      this.stepCount,
    );
    const risers = new THREE.InstancedMesh(
      new THREE.BoxGeometry(width, this.riseY, 0.1),
      this.riserMat,
      this.stepCount,
    );
    const edges = new THREE.InstancedMesh(
      new THREE.BoxGeometry(width, 0.05, 0.05),
      this.edgeMat,
      this.stepCount,
    );
    for (const m of [treads, risers, edges]) {
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false;
      group.add(m);
    }

    const stepT: number[] = [];
    for (let i = 0; i < this.stepCount; i++) stepT.push((i * STEP_SPACING) / RAMP_LENGTH);

    // Faldones y pasamanos: lo minimo para que lea como la misma maquina.
    const mid = rampPoint(0.5);
    for (const side of [-1, 1]) {
      const x = side * (RAMP_HALF_WIDTH + 0.16);
      const skirt = new THREE.Mesh(
        new THREE.BoxGeometry(0.28, 0.95, RAMP_LENGTH),
        toonMat(0x4e545e),
      );
      skirt.position.copy(mid);
      skirt.position.x = x;
      skirt.position.addScaledVector(RAMP_NORMAL, 0.14);
      skirt.rotation.x = SLOPE_ANGLE;
      group.add(skirt);

      // Sin el vidrio, el pasamanos flotaba solo y leia como una barra
      // cruzada sobre la escalera del rival.
      const glass = new THREE.Mesh(
        new THREE.BoxGeometry(0.06, 1.5, RAMP_LENGTH),
        new THREE.MeshBasicMaterial({
          color: COLOR_GLASS,
          transparent: true,
          opacity: 0.13,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
      );
      glass.position.copy(mid);
      glass.position.x = x;
      glass.position.addScaledVector(RAMP_NORMAL, 1.35);
      glass.rotation.x = SLOPE_ANGLE;
      group.add(glass);

      const rail = new THREE.Mesh(
        new THREE.CylinderGeometry(0.12, 0.12, RAMP_LENGTH, 8),
        toonMat(COLOR_RUBBER),
      );
      rail.position.copy(mid);
      rail.position.x = x;
      rail.position.addScaledVector(RAMP_NORMAL, 2.15);
      rail.rotation.x = Math.PI / 2 - SLOPE_ANGLE;
      group.add(rail);
    }

    // Pozo del carril: piso, una tanda de puas y la mancha vieja del fondo.
    const pitZ = BOTTOM.z + 1.4;
    const floor = new THREE.Mesh(
      new THREE.BoxGeometry(RAMP_HALF_WIDTH * 2 + 1.6, 0.3, 3.2),
      toonMat(COLOR_IRON_DARK),
    );
    floor.position.set(0, PIT_FLOOR_Y - 0.15, pitZ);
    group.add(floor);

    const spikeCount = 16;
    const spikes = new THREE.InstancedMesh(this.spikeGeometry(), this.spikeMat, spikeCount);
    const span = RAMP_HALF_WIDTH * 2 + 0.8;
    for (let i = 0; i < spikeCount; i++) {
      const row = i < 8 ? 0 : 1;
      const col = i % 8;
      this.matrix.makeTranslation(
        -span / 2 + (span * col) / 7 + (row ? 0.25 : 0),
        PIT_FLOOR_Y,
        BOTTOM.z + 0.7 + row * 0.85,
      );
      spikes.setMatrixAt(i, this.matrix);
    }
    spikes.instanceMatrix.needsUpdate = true;
    group.add(spikes);

    // Un resplandor tenue: sin la luz rubi propia, el pozo del rival quedaba
    // como un agujero plano.
    const pitGlow = new THREE.Mesh(
      new THREE.PlaneGeometry(RAMP_HALF_WIDTH * 2 + 1.6, 3),
      glowMat(COLOR_RUBY, 0.06, true),
    );
    pitGlow.rotation.x = -Math.PI / 2;
    pitGlow.position.set(0, PIT_FLOOR_Y + 0.06, pitZ);
    group.add(pitGlow);

    const stain = new THREE.Mesh(new THREE.CircleGeometry(1.1, 10), glowMat(COLOR_BLOOD_DARK, 0.5));
    stain.rotation.x = -Math.PI / 2;
    stain.position.set(0, PIT_FLOOR_Y + 0.012, pitZ);
    stain.scale.set(1, 0.7, 1);
    group.add(stain);

    const climber = new Climber(RIVAL_SUITS[index % RIVAL_SUITS.length]);
    group.add(climber.object);

    const tag = this.makeTag(player);
    group.add(tag);

    return {
      player,
      group,
      climber,
      tag,
      stepT,
      treads,
      risers,
      edges,
      height: START_T,
      target: START_T,
      dead: false,
      lastSeen: performance.now(),
    };
  }

  /** Perfil de pua, igual que el del pozo propio pero compartido por instancias. */
  private spikeGeometry(): THREE.LatheGeometry {
    const profile: THREE.Vector2[] = [
      new THREE.Vector2(0, 0),
      new THREE.Vector2(SPIKE_RADIUS * 1.5, 0.05),
      new THREE.Vector2(SPIKE_RADIUS, 0.18),
    ];
    for (let i = 1; i <= 6; i++) {
      const k = i / 6;
      profile.push(
        new THREE.Vector2(
          Math.max(SPIKE_RADIUS * Math.pow(1 - k, 1.45), 0.004),
          0.18 + k * (SPIKE_LEN - 0.18),
        ),
      );
    }
    return new THREE.LatheGeometry(profile, 10);
  }

  /** Cartelito con el nombre, siempre de frente a la camara. */
  private makeTag(player: string): THREE.Sprite {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext("2d")!;
    ctx.font = "bold 34px 'Trebuchet MS', system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineWidth = 6;
    ctx.strokeStyle = "rgba(0, 0, 0, 0.85)";
    ctx.strokeText(player, 128, 34, 240);
    ctx.fillStyle = "#e8e2d0";
    ctx.fillText(player, 128, 34, 240);

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, fog: false }),
    );
    sprite.scale.set(2.6, 0.65, 1);
    sprite.renderOrder = 5;
    return sprite;
  }

  /** Estado recibido de un rival (ver `RoomMode.broadcastLive`). */
  apply(player: string, height: number, dead: boolean): void {
    const lane = this.lanes.get(player);
    if (!lane) return;
    lane.target = height;
    lane.lastSeen = performance.now();
    if (dead && !lane.dead) {
      lane.dead = true;
      lane.climber.kill();
    }
  }

  update(dt: number, scrollSpeed: number): void {
    const now = performance.now();
    for (const lane of this.lanes.values()) {
      // Escalones del carril.
      for (let i = 0; i < lane.stepT.length; i++) {
        let t = lane.stepT[i] - scrollSpeed * dt;
        if (t < 0) t += 1;
        lane.stepT[i] = t;
        rampPoint(t, this.pos);
        this.matrix.makeTranslation(this.pos.x, this.pos.y, this.pos.z);
        lane.treads.setMatrixAt(i, this.matrix);
        this.matrix.makeTranslation(
          this.pos.x,
          this.pos.y - this.riseY / 2 - STEP_HEIGHT / 2,
          this.pos.z - this.runZ / 2 + 0.05,
        );
        lane.risers.setMatrixAt(i, this.matrix);
        this.matrix.makeTranslation(
          this.pos.x,
          this.pos.y + STEP_HEIGHT / 2,
          this.pos.z + this.runZ / 2 - 0.025,
        );
        lane.edges.setMatrixAt(i, this.matrix);
      }
      lane.treads.instanceMatrix.needsUpdate = true;
      lane.risers.instanceMatrix.needsUpdate = true;
      lane.edges.instanceMatrix.needsUpdate = true;

      // El muñeco: se interpola hacia lo ultimo que llego, asi 8 paquetes por
      // segundo se ven como movimiento continuo y no como saltos.
      lane.height += (lane.target - lane.height) * Math.min(1, dt * 7);
      if (lane.dead) {
        lane.climber.update(dt, lane.height, 1);
      } else {
        lane.climber.update(dt, lane.height, 0.5);
      }

      // El cartel sigue la cabeza; se apaga si el rival dejo de emitir.
      lane.tag.position.copy(lane.climber.object.position);
      lane.tag.position.y += 2.5;
      lane.tag.position.z += 0.3;
      const stale = now - lane.lastSeen > STALE_MS;
      lane.tag.material.opacity = lane.dead ? 0.45 : stale ? 0.25 : 0.95;
    }
  }
}
