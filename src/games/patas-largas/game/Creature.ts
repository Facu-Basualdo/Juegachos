import * as THREE from "three";
import type RAPIER from "@dimforge/rapier3d-compat";
import { RAPIER as R } from "./physics";
import { InvertedPendulum, PID } from "./balance";
import {
  ANKLE_DAMPING,
  ANKLE_LIMIT_MAX,
  ANKLE_LIMIT_MIN,
  ANKLE_STIFFNESS,
  ANKLE_TARGET,
  CREATURE_COLOR,
  FOOT_D,
  FOOT_DENSITY,
  FOOT_FORWARD,
  AIRBORNE_LOST,
  FOOT_AIR_FATAL_Y,
  FOOT_GROUNDED_Y,
  FOOT_FRICTION,
  FOOT_H,
  FOOT_LEN,
  CAPTURE_SHORTFALL,
  SHORTFALL_BASE,
  CONTROL_LEAD_STEPS,
  ANKLE_PID_KP,
  ANKLE_PID_KI,
  ANKLE_PID_KD,
  ANKLE_TORQUE_MARGIN,
  ANKLE_WALK_SHARE,
  PUSHOFF_TIME,
  WALK_SPEED,
  MIN_LEAD,
  GRAVITY_Y,
  GROUP_CREATURE,
  HIP_LIMIT_MAX,
  HIP_LIMIT_MIN,
  HIP_BRACE_DAMPING,
  HIP_BRACE_STIFFNESS,
  HIP_STANCE_DAMPING,
  HIP_STANCE_STIFFNESS,
  HIP_SWING_DAMPING,
  HIP_SWING_STIFFNESS,
  HIP_Z,
  KNEE_LIMIT_MAX,
  KNEE_LIMIT_MIN,
  LEG_REACH_MAX,
  OVEREXTEND_FALLOFF,
  PLANT_SLIP_MAX,
  MAX_BODY_DV,
  MAX_BODY_SPEED,
  RAGDOLL_ANG_DAMP,
  RAGDOLL_FADE,
  RAGDOLL_LIN_DAMP,
  RAGDOLL_MAX_SPEED,
  MAX_BODY_SPIN,
  KNEE_LOCK_DAMPING,
  KNEE_LOCK_STIFFNESS,
  KNEE_SWING_DAMPING,
  KNEE_SWING_STIFFNESS,
  LEG_COLOR,
  LEG_DENSITY,
  LEG_RADIUS,
  SHIN_LEN,
  LIFT_LOST,
  LIFT_SOFT,
  STANCE_HIP_HEIGHT,
  STAND_HIP_HEIGHT,
  HIP_SETTLE_RATE,
  STANCE_DRIVE,
  STANCE_MAX_DIG,
  SWING_ARC,
  SWING_PLANT_FROM,
  SWING_PLANT_REACH,
  START_FOOT_X,
  START_X,
  SWING_TIME,
  THIGH_LEN,
  TORSO_D,
  TORSO_DENSITY,
  TORSO_DRAG,
  TORSO_EXTRA_INERTIA,
  TORSO_H,
  TORSO_UPRIGHT_D,
  TORSO_UPRIGHT_K,
  TILT_LOST,
  TILT_SOFT,
  TORSO_UPRIGHT_MAX_TORQUE,
  TORSO_W,
} from "./constants";

export type LegSide = 0 | 1;
export type LegRole = "braced" | "stance" | "swing";

interface Leg {
  readonly side: LegSide;
  readonly thigh: RAPIER.RigidBody;
  readonly shin: RAPIER.RigidBody;
  readonly foot: RAPIER.RigidBody;
  readonly hip: RAPIER.RevoluteImpulseJoint;
  readonly knee: RAPIER.RevoluteImpulseJoint;
  readonly ankle: RAPIER.RevoluteImpulseJoint;
  role: LegRole;
  /** Segundos en el rol actual. */
  t: number;
  /** Angulo de cadera al entrar al rol: el target interpola desde aca. */
  startHip: number;
  /** Donde estaba el zapato al arrancar el balanceo (origen del arco). */
  swingFromX: number;
  swingFromY: number;
  /** X del mundo donde va a pisar este paso (destino del arco). */
  swingToX: number;
  /** X del mundo donde piso el zapato: el eje sobre el que gira el cuerpo. */
  plantX: number;
}

const _v = new THREE.Vector3();
const _hip = new THREE.Vector3();
const _q = new THREE.Quaternion();
const ZERO = { x: 0, y: 0, z: 0 };

/**
 * Angulo del cuerpo en el plano de juego, siempre en (-pi, pi].
 *
 * NO usar `2 * atan2(q.z, q.w)`: es correcto solo mientras `w > 0`, y en
 * cuanto un cuerpo pasa media vuelta (cosa que pasa sola en el ragdoll, y a
 * veces en una tibia durante un paso feo) el signo del cuaternion se da vuelta
 * y el angulo salta 2*pi. Restar dos angulos asi da diferencias de 4*pi, el
 * trinquete de la rodilla lee un angulo imposible, abre el limite de par en
 * par y el bicho se dobla al medio o sale disparado a 30 m de altura.
 * Se mide con el eje Y local rotado, que no tiene esa ambiguedad.
 */
function zAngle(body: RAPIER.RigidBody): number {
  const q = body.rotation();
  const upX = 2 * (q.x * q.y - q.w * q.z);
  const upY = 1 - 2 * (q.x * q.x + q.z * q.z);
  return Math.atan2(-upX, upY);
}

/** Diferencia de angulos normalizada a (-pi, pi]. */
function angleDelta(a: number, b: number): number {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d <= -Math.PI) d += Math.PI * 2;
  return d;
}

function smoothstep(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

/**
 * Cinematica inversa de una pata plana de dos eslabones iguales, con la
 * rodilla doblando SOLO hacia atras. `dx`/`dy` son el objetivo del tobillo
 * relativo a la cadera (dy negativo = abajo). Devuelve [angulo de muslo desde
 * la vertical, angulo de rodilla], ambos en el sentido del juego: positivo es
 * hacia adelante.
 */
function solveLegIK(dx: number, dy: number): [number, number] {
  const max = (THIGH_LEN + SHIN_LEN) * LEG_REACH_MAX;
  let d = Math.hypot(dx, dy);
  if (d > max) {
    const k = max / d;
    dx *= k;
    dy *= k;
    d = max;
  }
  d = Math.max(d, 0.35);

  // Angulo interior de la rodilla por el teorema del coseno (pi = estirada).
  const cosInner = THREE.MathUtils.clamp(
    (THIGH_LEN * THIGH_LEN + SHIN_LEN * SHIN_LEN - d * d) / (2 * THIGH_LEN * SHIN_LEN),
    -1,
    1,
  );
  const knee = -(Math.PI - Math.acos(cosInner));

  // Direccion cadera -> objetivo medida desde la vertical hacia abajo.
  const toTarget = Math.atan2(dx, -dy);
  // Desfasaje que mete la rodilla doblada entre esa direccion y el muslo.
  const offset = Math.atan2(SHIN_LEN * Math.sin(knee), THIGH_LEN + SHIN_LEN * Math.cos(knee));
  return [toTarget - offset, knee];
}

function quatZ(angle: number): { x: number; y: number; z: number; w: number } {
  return { x: 0, y: 0, z: Math.sin(angle * 0.5), w: Math.cos(angle * 0.5) };
}

/**
 * La criatura: torso cubico + dos patas de tres piezas (muslo, tibia, zapato)
 * unidas por revolute joints con motor de posicion.
 *
 * El andar NO es una animacion: la pata de apoyo es un puntal blando sobre el
 * que el cuerpo bascula por gravedad, y la pata que se balancea es la unica que
 * recibe un motor fuerte. Por eso el equilibrio depende de CUANDO se toca.
 */
export class Creature {
  readonly group = new THREE.Group();
  readonly torso: RAPIER.RigidBody;
  private readonly legs: [Leg, Leg];
  private readonly world: RAPIER.World;

  /** Colliders que NO son zapato: si tocan el suelo, es derrota inmediata. */
  readonly lethalColliders = new Set<number>();
  /** Collider de cada zapato mapeado a su lado, para el polvo al pisar. */
  readonly footColliders = new Map<number, LegSide>();

  private readonly meshes: Array<{ body: RAPIER.RigidBody; mesh: THREE.Object3D }> = [];
  /** Cada cuerpo con el Z al que esta clavado. Ver `constrainToRail`. */
  private readonly rails: Array<{ body: RAPIER.RigidBody; z: number; vx: number; vy: number }> = [];
  private ragdoll = false;
  /** 1 -> 0 al morir: apaga los motores de a poco (ver `collapse`). */
  private ragdollFade = 0;
  /** Segundos seguidos con los dos zapatos en el aire. */
  private airborneFor = 0;
  /** False hasta el primer toque: la criatura esta parada y nada la mueve. */
  private started = false;
  /** Altura de cadera que la pata sostiene ahora (parada vs caminando). */
  private hipTarget = STAND_HIP_HEIGHT;
  /** 0..1, ver `controlAuthority`. Escala TODOS los motores de las patas. */
  private authority = 1;

  /** Modelo de equilibrio (ver `balance.ts`). Es quien decide la marcha. */
  private readonly lip = new InvertedPendulum(-GRAVITY_Y);
  private readonly anklePid = new PID(ANKLE_PID_KP, ANKLE_PID_KI, ANKLE_PID_KD);
  /** Masa total, cacheada: se usa en cada subpaso para saturar el torque. */
  private totalMass = 1;
  private readonly com = { x: 0, y: 0, vx: 0 };

  constructor(world: RAPIER.World) {
    this.world = world;

    const torsoMat = new THREE.MeshStandardMaterial({
      color: CREATURE_COLOR,
      roughness: 0.85,
      metalness: 0,
    });
    const legMat = new THREE.MeshStandardMaterial({
      color: LEG_COLOR,
      roughness: 0.6,
      metalness: 0.05,
    });

    // ---------------------------------------------------------------- torso
    this.torso = this.makeBody(START_X, 0, 0);
    this.world.createCollider(
      R.ColliderDesc.cuboid(TORSO_W / 2, TORSO_H / 2, TORSO_D / 2)
        .setDensity(TORSO_DENSITY)
        .setFriction(0.6)
        .setCollisionGroups(GROUP_CREATURE)
        .setActiveEvents(R.ActiveEvents.COLLISION_EVENTS),
      this.torso,
    );
    this.torso.setLinearDamping(TORSO_DRAG);
    this.torso.setAdditionalMassProperties(
      0.0001,
      { x: 0, y: 0, z: 0 },
      { x: TORSO_EXTRA_INERTIA, y: TORSO_EXTRA_INERTIA, z: TORSO_EXTRA_INERTIA },
      { x: 0, y: 0, z: 0, w: 1 },
      true,
    );
    this.registerLethal(this.torso);

    const torsoMesh = new THREE.Group();
    const box = new THREE.Mesh(new THREE.BoxGeometry(TORSO_W, TORSO_H, TORSO_D), torsoMat);
    box.castShadow = true;
    torsoMesh.add(box, this.makeFace(legMat));
    this.attach(this.torso, torsoMesh);

    // ----------------------------------------------------------------- patas
    this.legs = [this.buildLeg(0, legMat), this.buildLeg(1, legMat)];

    this.reset();
  }

  // ------------------------------------------------------------- construccion

  /**
   * OJO: nada de `setEnabledTranslations` / `setEnabledRotations` aca.
   *
   * Lo natural para un juego plano es bloquear Z y el pitch/roll de cada
   * cuerpo, pero eso **revienta la simulacion en el primer paso**: el revolute
   * joint tiene una fila de restriccion sobre Z, y si los DOS cuerpos que une
   * tienen ese grado congelado, la masa efectiva de esa fila es cero y el
   * impulso que calcula el solver se va a infinito (posiciones del orden de
   * 1e9 en menos de 10 subpasos). El plano se mantiene por construccion: todos
   * los joints comparten el eje Z y todas las fuerzas estan en XY; lo poco que
   * se escapa lo corrige `keepPlanar()`.
   */
  private makeBody(x: number, y: number, z: number): RAPIER.RigidBody {
    const body = this.world.createRigidBody(
      R.RigidBodyDesc.dynamic()
        .setTranslation(x, y, z)
        .setLinearDamping(0.03)
        .setAngularDamping(0.2)
        .setCanSleep(false),
    );
    this.rails.push({ body, z, vx: 0, vy: 0 });
    return body;
  }

  private registerLethal(body: RAPIER.RigidBody): void {
    for (let i = 0; i < body.numColliders(); i++) {
      this.lethalColliders.add(body.collider(i).handle);
    }
  }

  private attach(body: RAPIER.RigidBody, mesh: THREE.Object3D): void {
    this.group.add(mesh);
    this.meshes.push({ body, mesh });
  }

  /** Ojos: dos puntos sobre la esquina delantera, para que se lea la mirada. */
  private makeFace(mat: THREE.Material): THREE.Group {
    const face = new THREE.Group();
    const geo = new THREE.SphereGeometry(0.055, 12, 10);
    for (const dz of [-0.1, 0.1]) {
      const eye = new THREE.Mesh(geo, mat);
      eye.position.set(TORSO_W / 2 - 0.02, 0.12, dz + TORSO_D / 2 - 0.18);
      face.add(eye);
    }
    return face;
  }

  private buildLeg(side: LegSide, legMat: THREE.MeshStandardMaterial): Leg {
    const z = side === 0 ? HIP_Z : -HIP_Z;
    const capsule = (len: number): RAPIER.ColliderDesc =>
      R.ColliderDesc.capsule(len / 2 - LEG_RADIUS, LEG_RADIUS)
        .setDensity(LEG_DENSITY)
        .setFriction(0.5)
        .setCollisionGroups(GROUP_CREATURE)
        .setActiveEvents(R.ActiveEvents.COLLISION_EVENTS);

    const thigh = this.makeBody(START_X, 0, z);
    this.world.createCollider(capsule(THIGH_LEN), thigh);
    this.registerLethal(thigh);
    this.attach(thigh, this.makeLimbMesh(THIGH_LEN, legMat));

    const shin = this.makeBody(START_X, 0, z);
    this.world.createCollider(capsule(SHIN_LEN), shin);
    this.registerLethal(shin);
    this.attach(shin, this.makeLimbMesh(SHIN_LEN, legMat));

    const foot = this.makeBody(START_X, 0, z);
    const footCol = this.world.createCollider(
      R.ColliderDesc.cuboid(FOOT_LEN / 2, FOOT_H / 2, FOOT_D / 2)
        .setDensity(FOOT_DENSITY)
        .setFriction(FOOT_FRICTION)
        .setFrictionCombineRule(R.CoefficientCombineRule.Max)
        .setCollisionGroups(GROUP_CREATURE)
        .setActiveEvents(R.ActiveEvents.COLLISION_EVENTS),
      foot,
    );
    this.footColliders.set(footCol.handle, side);

    const shoe = new THREE.Mesh(new THREE.BoxGeometry(FOOT_LEN, FOOT_H, FOOT_D), legMat);
    shoe.castShadow = true;
    this.attach(foot, shoe);

    // --------------------------------------------------------------- joints
    const hip = this.joint(
      this.torso,
      thigh,
      { x: 0, y: -TORSO_H / 2, z },
      { x: 0, y: THIGH_LEN / 2, z: 0 },
      HIP_LIMIT_MIN,
      HIP_LIMIT_MAX,
    );
    const knee = this.joint(
      thigh,
      shin,
      { x: 0, y: -THIGH_LEN / 2, z: 0 },
      { x: 0, y: SHIN_LEN / 2, z: 0 },
      KNEE_LIMIT_MIN,
      KNEE_LIMIT_MAX,
    );
    const ankle = this.joint(
      shin,
      foot,
      { x: 0, y: -SHIN_LEN / 2, z: 0 },
      { x: -FOOT_FORWARD, y: FOOT_H / 2, z: 0 },
      ANKLE_LIMIT_MIN,
      ANKLE_LIMIT_MAX,
    );

    return { side, thigh, shin, foot, hip, knee, ankle, role: "stance", t: 0, startHip: 0, swingFromX: 0, swingFromY: 0, swingToX: 0, plantX: 0 };
  }

  private makeLimbMesh(len: number, mat: THREE.Material): THREE.Mesh {
    const geo = new THREE.CapsuleGeometry(LEG_RADIUS, len - LEG_RADIUS * 2, 4, 10);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    return mesh;
  }

  private joint(
    a: RAPIER.RigidBody,
    b: RAPIER.RigidBody,
    anchorA: RAPIER.Vector,
    anchorB: RAPIER.Vector,
    min: number,
    max: number,
  ): RAPIER.RevoluteImpulseJoint {
    const data = R.JointData.revolute(anchorA, anchorB, { x: 0, y: 0, z: 1 });
    const j = this.world.createImpulseJoint(data, a, b, true) as RAPIER.RevoluteImpulseJoint;
    j.setContactsEnabled(false);
    j.setLimits(min, max);
    j.configureMotorModel(R.MotorModel.AccelerationBased);
    return j;
  }

  // ------------------------------------------------------------------ estado

  /**
   * Coloca al bicho en la zancada de arranque.
   *
   * La pose se arma con la MISMA IK que usa el andar (`solveLegIK`) y a la
   * altura de cadera que sostiene `driveStance`. Armarla "a ojo" con las patas
   * estiradas parece mas simple, pero deja al bicho en una pose que su propio
   * controlador considera imposible: en el primer cuadro las patas se doblan
   * de golpe para llegar a la altura que quieren y la criatura arranca
   * derrumbada.
   */
  reset(): void {
    this.ragdoll = false;
    this.ragdollFade = 0;
    this.airborneFor = 0;
    this.started = false;
    this.hipTarget = STAND_HIP_HEIGHT;
    this.anklePid.reset();
    for (const { body } of this.rails) {
      body.setLinearDamping(body === this.torso ? TORSO_DRAG : 0.03);
      body.setAngularDamping(0.2);
    }
    const hipY = STAND_HIP_HEIGHT + FOOT_H / 2;
    const place = (
      body: RAPIER.RigidBody,
      x: number,
      y: number,
      z: number,
      angle: number,
    ): void => {
      body.setTranslation({ x, y, z }, true);
      body.setRotation(quatZ(angle), true);
      body.setLinvel(ZERO, true);
      body.setAngvel(ZERO, true);
    };

    place(this.torso, START_X, hipY + TORSO_H / 2, 0, 0);

    for (const leg of this.legs) {
      // Pata 0 adelante, pata 1 atras: la zancada arranca a medio paso.
      const footX = leg.side === 0 ? START_FOOT_X : -START_FOOT_X;
      const z = leg.side === 0 ? HIP_Z : -HIP_Z;
      const [thighA, kneeA] = solveLegIK(footX, -STAND_HIP_HEIGHT);
      const shinA = thighA + kneeA;

      const kneeX = START_X + Math.sin(thighA) * THIGH_LEN;
      const kneeY = hipY - Math.cos(thighA) * THIGH_LEN;
      place(leg.thigh, (START_X + kneeX) / 2, (hipY + kneeY) / 2, z, thighA);

      const ankleX = kneeX + Math.sin(shinA) * SHIN_LEN;
      const ankleY = kneeY - Math.cos(shinA) * SHIN_LEN;
      place(leg.shin, (kneeX + ankleX) / 2, (kneeY + ankleY) / 2, z, shinA);
      place(leg.foot, ankleX + FOOT_FORWARD, ankleY - FOOT_H / 2, z, 0);

      // Arranca "braced": las dos caderas sostienen su pose, asi la de arranque
      // es una A firme que se queda parada hasta el primer toque.
      leg.role = "braced";
      leg.t = 0;
      leg.startHip = thighA;
      leg.swingFromX = ankleX + FOOT_FORWARD;
      leg.swingFromY = ankleY - FOOT_H / 2;
      // Provisorio: el destino real lo calcula `startSwing` con el punto de
      // captura, que necesita el cuerpo en movimiento.
      leg.swingToX = leg.swingFromX;
      leg.plantX = ankleX + FOOT_FORWARD;
    }

    this.applyMotors(0);
    this.sync();
  }

  /**
   * Arranque de la ronda: la criatura se queda PARADA, con los dos pies
   * juntos, hasta que el jugador da el primer paso.
   *
   * No hay envion inicial ni traspaso de peso. Antes se le daba velocidad al
   * tren superior para que el primer paso "saliera solo", y eso hacia que la
   * partida empezara sin que el jugador tocara nada. El equilibrio activo
   * (el PID de tobillo, que empuja el centro de masa hasta adelantarlo del
   * pie) tambien queda apagado hasta el primer toque: si corriera, la
   * criatura se inclinaria y empezaria a caminar sola.
   */
  launch(): void {
    this.started = false;
  }

  /**
   * Cambia de pata: la de `side` sale a balancearse y la otra queda de apoyo.
   * La alternancia estricta la garantiza StepController, no esta funcion.
   */
  startSwing(side: LegSide): void {
    this.started = true;
    const swing = this.legs[side];
    const stance = this.legs[side === 0 ? 1 : 0];

    swing.role = "swing";
    swing.t = 0;
    swing.startHip = this.hipAngle(swing);
    // El paso apunta a un punto FIJO DEL MUNDO: una zancada por delante del
    // zapato sobre el que el cuerpo esta apoyado. Apuntando a un angulo
    // relativo a la cadera, si el cuerpo no avanza el pie tampoco: la criatura
    // pisa siempre en los mismos dos puntos y marcha en el lugar (medido: 29
    // pasos para 5 metros). Con destino en el mundo, cada toque gana terreno
    // por definicion y es el cuerpo el que tiene que venir atras de sus pies.
    const from = swing.foot.translation();
    swing.swingFromX = from.x;
    swing.swingFromY = from.y;

    this.aimSwing(swing, stance);

    // ---------------------------------------------------------------------
    // DESPEGUE: el impulso que compensa exactamente el choque del talon.
    //
    // En la marcha de compas, al plantar se pierde la componente de velocidad
    // que no sobrevive al cambio de pivote: la velocidad queda multiplicada
    // por cos(2a), con 2a el angulo entre las dos patas. Para sostener el paso
    // hay que devolver eso y nada mas, o sea un impulso `m*v*tan(2a)` a lo
    // largo de la pata que se va. Es una formula cerrada, no una perilla: si
    // se pone de mas la criatura se acelera hasta que ninguna pata la sigue, y
    // de menos se apaga en tres pasos.
    // ---------------------------------------------------------------------
    // El despegue aporta la ENERGIA ORBITAL que falta para llegar a la
    // velocidad de marcha, y nada mas.
    //
    // La primera version usaba la formula de la marcha de compas — devolver el
    // choque del talon, `m*v*tan(2a)` — que es correcta para SOSTENER un paso
    // pero tiene un problema de huevo y gallina: es proporcional a la
    // velocidad actual, asi que una criatura quieta recibe cero impulso y no
    // arranca nunca. Medido: el juego daba 3 m pasara lo que pasara, sin
    // responder a ninguna perilla, que es la firma de algo saturado en cero.
    //
    // Con energia orbital el termino se auto-limita: si el cuerpo ya viene a
    // la velocidad de marcha el deficit es cero y el despegue no hace nada; si
    // viene frenado, aporta justo lo que falta. Y sigue siendo el LIP: el
    // trabajo de un impulso es `impulso * velocidad`, de ahi el cociente.
    const target = 0.5 * WALK_SPEED * WALK_SPEED;
    const deficit = Math.max(0, target - this.lip.orbitalEnergy());
    const speed = Math.max(WALK_SPEED * 0.35, Math.abs(this.com.vx));
    const cap = this.totalMass * -GRAVITY_Y * PUSHOFF_TIME;
    const impulse = Math.min(cap, (this.totalMass * deficit) / speed);

    // Va en la direccion de la pata que despega (del zapato a la cadera), que
    // es por donde un tobillo real puede empujar.
    const hip = this.hipWorld(swing, _hip);
    const dx = hip.x - from.x;
    const dy = Math.max(0.3, hip.y - from.y);
    const len = Math.max(1e-3, Math.hypot(dx, dy));
    // El impulso va SOLO al cuerpo. La reaccion la absorbe el piso, como
    // cualquier empujon contra el suelo — no el zapato. Aplicarselo al zapato
    // (que pesa 86 g) es un canonazo: 6 N*s sobre esa masa son 74 m/s, y era
    // de ahi que salia el 89% de corridas con algun cuerpo en el tope de
    // velocidad. La masa del pie no es la que empuja, es la que transmite.
    // Y solo la componente HORIZONTAL. En la marcha de compas el despegue y el
    // choque del talon se cancelan en vertical a lo largo del paso completo:
    // aca el choque lo resuelve el contacto de Rapier y el despegue lo pone
    // esta linea, asi que sumar tambien la parte vertical es meter energia que
    // nada devuelve. Con la pata trasera a ~30 grados de la vertical, el 92%
    // del impulso se iba para arriba: tres pasos y la criatura despegaba a
    // 4 m/s verticales — los "records" de 150 m eran vuelos, no caminatas.
    this.torso.applyImpulse({ x: (dx / len) * impulse, y: 0, z: 0 }, true);
  }

  /**
   * Cuanta autoridad tienen las patas sobre el cuerpo, de 1 a casi 0.
   *
   * Cae cuando el torso se vuelca o cuando la criatura lleva rato por el aire.
   * Es EL freno de las explosiones que quedaban: medido con el trazado del
   * origen, los despegues nacian siempre igual — el torso ya habia volcado
   * (se lo vio a 2.33 rad, dado vuelta), las dos patas colgaban a metro y
   * medio de altura, y el controlador seguia tirando de ellas hacia puntos del
   * piso que ahora estaban POR ENCIMA de la cadera. La IK pedia poses
   * imposibles, los motores respondian con todo y los zapatos salian a 45 m/s.
   *
   * Se baja la fuerza, NO se corta la partida. Probado como condicion de
   * muerte y es un desastre: la inclinacion no distingue — sobre 27 mil
   * cuadros que todavia tenian 2 s de vida por delante, el percentil 90 ya
   * estaba en 1.12 rad y el 99 en 2.23. Cortar ahi mataba el 76% de las
   * corridas. Aflojando en cambio, el bicho se cae solo y muere por la regla
   * de siempre: apoyar en la arena algo que no sea un zapato.
   */
  private controlAuthority(dt: number): number {
    const tilt = Math.abs(zAngle(this.torso));
    const byTilt = 1 - THREE.MathUtils.clamp((tilt - TILT_SOFT) / (TILT_LOST - TILT_SOFT), 0, 1);

    const flying =
      this.legs[0].foot.translation().y > FOOT_AIR_FATAL_Y &&
      this.legs[1].foot.translation().y > FOOT_AIR_FATAL_Y;
    this.airborneFor = flying ? this.airborneFor + dt : 0;
    const byFlight = 1 - THREE.MathUtils.clamp(this.airborneFor / AIRBORNE_LOST, 0, 1);

    return Math.max(OVEREXTEND_FALLOFF, Math.min(byTilt, byFlight));
  }

  /** Traspaso de peso: `leg` pasa a ser el eje y la otra queda de puntal. */  /** Traspaso de peso: `leg` pasa a ser el eje y la otra queda de puntal. */
  private becomePivot(leg: Leg): void {
    const other = this.legs[leg.side === 0 ? 1 : 0];
    leg.role = "stance";
    leg.t = 0;
    leg.startHip = this.hipAngle(leg);
    leg.plantX = leg.foot.translation().x;
    other.role = "braced";
    other.t = 0;
    other.startHip = this.hipAngle(other);
    other.plantX = other.foot.translation().x;
  }

  /**
   * Aviso desde `Game` de que un zapato toco el piso. Si esa pata venia
   * balanceandose y ya paso el grueso del arco, se planta ahi mismo: el paso
   * termina por CONTACTO, no por reloj, que es lo que hace que pisar un
   * instante antes o despues se sienta distinto.
   */
  footLanded(side: LegSide): void {
    const leg = this.legs[side];
    if (leg.role !== "swing") return;
    if (leg.t / SWING_TIME < SWING_PLANT_FROM) return;
    this.becomePivot(leg);
  }

  /**
   * Balanceo por cinematica inversa: en vez de mandarle angulos a la cadera y
   * a la rodilla por separado, se dibuja el ARCO QUE HACE EL PIE (se pliega,
   * pasa, se estira adelante) y se resuelve que angulos hacen falta. Es la
   * unica forma de que la zancada sea la que uno quiere: con angulos sueltos,
   * la rodilla doblada corre el pie para atras y el paso puede terminar
   * plantando el zapato DETRAS del otro pie, que es lo contrario de caminar.
   *
   * El objetivo va en POLARES respecto de la cadera (angulo, largo). En
   * coordenadas del mundo no sirve: parado, la cadera queda mas alta que el
   * largo de la pata, asi que "el piso, un metro y medio adelante" esta fuera
   * de alcance, la IK lo recorta, la pata queda como un palo y el cuerpo
   * rebota sobre ella como un pogo.
   */
  private driveSwing(leg: Leg, p: number): void {
    const hip = this.hipWorld(leg, _hip);
    const ease = smoothstep(p);

    // Arco del zapato en coordenadas del MUNDO: de donde salio hasta el punto
    // donde va a pisar, levantando en el medio para no barrer la arena.
    const targetX = THREE.MathUtils.lerp(leg.swingFromX, leg.swingToX, ease);
    const targetY =
      THREE.MathUtils.lerp(leg.swingFromY, FOOT_H / 2, ease) + SWING_ARC * Math.sin(Math.PI * p);

    let tx = targetX - hip.x;
    let ty = targetY - hip.y;
    // Si el punto queda fuera de alcance, la pata se estira todo lo que da en
    // esa direccion: el pie aterriza mas corto y el paso gana menos terreno,
    // que es exactamente el castigo que corresponde.
    const max = (THIGH_LEN + SHIN_LEN) * SWING_PLANT_REACH;
    const d = Math.hypot(tx, ty);
    if (d > max) {
      const k = max / d;
      tx *= k;
      ty *= k;
    }

    const [hipAngle, kneeAngle] = solveLegIK(tx, ty);
    const a = this.authority;
    leg.hip.configureMotorPosition(
      hipAngle - zAngle(this.torso),
      HIP_SWING_STIFFNESS * a,
      HIP_SWING_DAMPING * a,
    );
    leg.knee.configureMotorPosition(kneeAngle, KNEE_SWING_STIFFNESS * a, KNEE_SWING_DAMPING * a);
  }

  /**
   * Pata apoyada: tambien por IK, apuntando al punto del piso donde piso.
   *
   * Esta es la pieza que hace que el bicho camine en vez de derretirse:
   *
   * - El objetivo es un punto FIJO DEL MUNDO, no un angulo. Al avanzar el
   *   cuerpo, la IK recalcula sola la cadera y la rodilla que mantienen el
   *   zapato ahi, asi que el motor no pelea contra el vuelco: lo sigue.
   * - En vertical apunta AL PISO, y solo se mete bajo tierra si la cadera se
   *   hundio por debajo de `STANCE_HIP_HEIGHT` (ahi la pata empuja para
   *   recuperar la altura, con tope, o hace de catapulta).
   * - Y como el motor de la cadera puede ser FUERTE sin pelearse con nada, la
   *   pata apoyada transmite al piso el retroceso del motor de la que se
   *   balancea. Con la cadera de apoyo floja ese retroceso no tiene adonde ir
   *   mas que al torso, y cada paso empuja al bicho para atras.
   */
  private driveStance(
    leg: Leg,
    stiffness: number,
    damping: number,
    dragging: boolean,
    dt: number,
  ): void {
    const hip = this.hipWorld(leg, _hip);
    // Se adelanta la cadera un subpaso: el objetivo de la IK se calcula con la
    // posicion del cuadro anterior, y en un lazo tan rigido ese atraso de
    // milimetros se cobra como un freno proporcional a la velocidad (la
    // criatura caminaba como en melaza, 0.3 m por paso).
    const v = this.torso.linvel();
    hip.x += v.x * dt * CONTROL_LEAD_STEPS;
    hip.y += v.y * dt * CONTROL_LEAD_STEPS;
    const max = (THIGH_LEN + SHIN_LEN) * LEG_REACH_MAX;

    // Re-anclaje: si el zapato ya no esta donde dice `plantX`, `plantX` miente.
    // Pasa cuando el pie patina, cuando un toque interrumpe un balanceo (la
    // pata pasa a apoyo con el pie en el aire) y sobre todo cuando la criatura
    // esta volando: ahi las dos patas apuntan a puntos del piso que quedaron
    // metros atras, la IK pide una pose imposible y los motores revolean el
    // zapato. Medido: TODOS los picos de velocidad en juego eran un pie, con
    // 1 a 3 m de diferencia entre `plantX` y el pie. El pie manda.
    const footX = leg.foot.translation().x;
    if (Math.abs(leg.plantX - footX) > PLANT_SLIP_MAX) leg.plantX = footX;

    let tx = leg.plantX - hip.x;
    // El `min` con el piso es la parte que no puede faltar: apuntando siempre
    // a "la cadera menos H", cuando la cadera queda mas ALTA que H el objetivo
    // del pie sube por encima del suelo y la pata se levanta sola. La criatura
    // pasa la partida en puntas de pie, rebotando, y deja de responder a
    // cualquier perilla — empuje, rozamiento, altura: todo daba lo mismo.
    let ty = Math.max(
      Math.min(FOOT_H / 2 - hip.y, -this.hipTarget),
      -STANCE_MAX_DIG - hip.y,
    );

    // Cuanta FUERZA puede poner la pata en recuperar altura. Se desvanece con
    // el deficit: una hundida chica se corrige con firmeza, una grande casi no.
    //
    // Es el reemplazo de un corte binario que se probo antes ("por debajo del
    // 72% de la altura de marcha la pata deja de empujar"). Ese corte mataba la
    // catapulta pero volvia TERMINAL cualquier hundida: la criatura se sentaba
    // despacio y se iba para atras, que es como se ve el bug de "se cae para
    // atras en el primer paso". Y limitar la distancia del objetivo
    // (`STANCE_MAX_DIG`) tampoco alcanza, porque lo que catapulta es la fuerza
    // con la que el motor va a buscarlo, no lo lejos que este: con la cadera
    // derrumbada a 1.5 m y las dos plantas apoyadas, el torso pasaba de 5.5 a
    // 15.6 m/s verticales en un solo cuadro.
    const deficit = Math.max(0, this.hipTarget - (hip.y - FOOT_H / 2));
    const lift =
      1 - THREE.MathUtils.clamp((deficit - LIFT_SOFT) / (LIFT_LOST - LIFT_SOFT), 0, 1);

    const d = Math.hypot(tx, ty);
    if (d > max) {
      if (dragging) {
        // Pata de atras: si el punto donde piso quedo fuera de alcance, se
        // limita cuanto se estira PARA ATRAS pero se le respeta la altura, asi
        // el zapato arrastra por la arena y listo. Tirando de ella como de la
        // pata de apoyo, una pata trasera lejos te voltea sola.
        tx = Math.sign(tx) * Math.sqrt(Math.max(0, max * max - ty * ty));
      } else {
        // Pata de APOYO fuera de alcance: se estira todo lo que da y deja de
        // sostener. Este es el modo de perder del juego — te quedaste largo,
        // se te abren las gambas y la cadera se viene abajo.
        const k = max / d;
        tx *= k;
        ty *= k;
      }
    }

    // Una pata sin piso debajo no tiene autoridad sobre nada: se le baja la
    // fuerza a los motores. Son dos casos y hacen falta los dos.
    //
    // (a) El punto de apoyo quedo fuera de alcance: peleando contra una pose
    //     imposible el solver se desborda y la caida sale como una explosion
    //     (velocidades de -23 m/s, rodillas dobladas al reves).
    // (b) El ZAPATO ESTA EN EL AIRE. Con el re-anclaje de `plantX` el objetivo
    //     siempre es alcanzable, asi que (a) dejo de dispararse — y la pata se
    //     quedo tirando con toda la fuerza mientras volaba, revoleando el pie.
    //     Medido: los episodios con algun cuerpo a 45 m/s pasaron de 71 a 105
    //     sobre 400 al agregar el re-anclaje solo.
    const airborne = leg.foot.translation().y > FOOT_GROUNDED_Y;
    const weak = d > max || airborne;
    const a = this.authority * Math.max(OVEREXTEND_FALLOFF, lift);
    const [hipAngle, kneeAngle] = solveLegIK(tx, ty);
    // EXTENSION DE CADERA: al angulo que pide la IK se le resta un poco, o sea
    // que la pata quiere quedar mas volcada hacia atras de lo que la geometria
    // pide. Con el zapato clavado por friccion eso empuja al CUERPO hacia
    // adelante.
    //
    // Estuvo sacada un tiempo, con la idea de que la propulsion saliera solo
    // del tobillo y del despegue. Es un error: en la marcha humana la mayor
    // parte de la potencia la ponen los extensores de cadera, no el tobillo —
    // y menos todavia con un pie de 36 cm, que apenas da 3.7 N*m. Mientras el
    // PID de tobillo tuvo el signo invertido esa propulsion aparecia igual,
    // pero por realimentacion positiva; al corregir el signo la marcha se cayo
    // a cero y quedo claro de donde venia.
    const drive = dragging || !this.started ? 0 : STANCE_DRIVE;
    leg.hip.configureMotorPosition(
      hipAngle - zAngle(this.torso) - drive,
      (weak ? stiffness * OVEREXTEND_FALLOFF : stiffness) * a,
      (weak ? damping * 0.4 : damping) * a,
    );
    leg.knee.configureMotorPosition(
      kneeAngle,
      (weak ? KNEE_LOCK_STIFFNESS * OVEREXTEND_FALLOFF : KNEE_LOCK_STIFFNESS) * a,
      (weak ? KNEE_LOCK_DAMPING * 0.4 : KNEE_LOCK_DAMPING) * a,
    );
  }

  /** Posicion mundial de la cadera de una pata. */
  private hipWorld(leg: Leg, out: THREE.Vector3): THREE.Vector3 {
    const t = this.torso.translation();
    const a = zAngle(this.torso);
    // Ancla local (0, -TORSO_H/2) rotada por el angulo del torso.
    return out.set(
      t.x + Math.sin(a) * (TORSO_H / 2),
      t.y - Math.cos(a) * (TORSO_H / 2),
      leg.side === 0 ? HIP_Z : -HIP_Z,
    );
  }

  /**
   * Adonde va a pisar este paso. Punto de captura, no una zancada fija.
   *
   * `capturePoint()` es el lugar donde habria que poner el pie para quedar
   * parado. Plantar mas CERCA del cuerpo deja que el centro de masa siga
   * volcando hacia adelante, o sea que seguir caminando es plantar corto a
   * proposito. Con una zancada constante el cuerpo rapido plantaba corto y se
   * iba de largo, y el lento plantaba lejos y se frenaba; asi el paso se
   * estira solo cuando el bicho viene embalado.
   *
   */
  private aimSwing(swing: Leg, stance: Leg): void {
    this.measureCoM();
    const pivotFoot = stance.foot.translation();
    this.lip.measure(this.com.x, this.com.y, this.com.vx, pivotFoot.x, pivotFoot.y - FOOT_H / 2);
    const capture = pivotFoot.x + this.lip.capturePoint();

    const reachX = this.reachX();
    const hipNow = this.hipWorld(swing, _hip).x;

    // Cuanto se planta ANTES del punto de captura. Dos terminos:
    //
    // - la REGULACION de velocidad: lento -> se planta corto y el cuerpo
    //   acelera; rapido -> se planta en el punto de captura o pasado, y frena.
    //   Hace falta porque hay un techo que la geometria impone y no se
    //   negocia: la pata alcanza `reachX` y el balanceo dura `SWING_TIME`, asi
    //   que por encima de `reachX / SWING_TIME` el pie SIEMPRE aterriza detras
    //   de donde hacia falta (medido: el cuerpo se iba a 5 m/s y terminaba
    //   2.2 m por delante de sus dos pies).
    const vMax = reachX / SWING_TIME;
    const speedRatio = THREE.MathUtils.clamp(Math.abs(this.com.vx) / vMax, 0, 1.3);
    // Dos terminos, y el segundo NO puede faltar: uno decae con la velocidad
    // (es la regulacion, frena cuando venis rapido) y otro es CONSTANTE. Sin el
    // constante, a velocidad de crucero el pie aterriza justo en el punto de
    // captura, que es frenada total: la criatura se apaga y se cae. El termino
    // fijo es "siempre plantar un poquito corto", que es literalmente el
    // consejo del juego original — *small steps go a long way*.
    const shortfall = SHORTFALL_BASE + CAPTURE_SHORTFALL * (1 - speedRatio);

    // Piso: el pie siempre aterriza un poco por DELANTE DEL CUERPO, nunca
    // detras. Hace falta para el primer paso, donde con `v = 0` el punto de
    // captura coincide con el centro de masa y `capture - shortfall` caeria
    // atras, o sea que la criatura arrancaria yendo para atras.
    //
    // El piso se mide contra el CENTRO DE MASA, no contra el pie anterior.
    // Medido contra el pie anterior obliga a una zancada minima aunque el
    // cuerpo no avance, y entonces las patas van pisando cada vez mas adelante
    // mientras el cuerpo se queda: la base de apoyo se le escapa hacia
    // adelante, el punto de captura se hace negativo y termina sentandose para
    // atras. En el trazo se veia como el tobillo empujando saturado hacia
    // adelante todo el tiempo y el cuerpo yendose igual para atras.
    const forward = Math.max(capture - shortfall, this.com.x + MIN_LEAD);

    swing.swingToX = THREE.MathUtils.clamp(forward, hipNow - reachX, hipNow + reachX);
  }

  /** Cuanto puede alejarse el zapato de la cadera, en horizontal. */
  private reachX(): number {
    return Math.sqrt(
      Math.max(
        0.04,
        Math.pow((THIGH_LEN + SHIN_LEN) * SWING_PLANT_REACH, 2) -
          STANCE_HIP_HEIGHT * STANCE_HIP_HEIGHT,
      ),
    );
  }

  /** Angulo del muslo respecto del torso (positivo = pata adelante). */
  private hipAngle(leg: Leg): number {
    return angleDelta(zAngle(leg.thigh), zAngle(this.torso));
  }

  /**
   * Que tan pasado esta el cuerpo respecto del pie sobre el que se apoya, como
   * fraccion de lo que la pata da de si: 0 = la cadera esta justo encima del
   * zapato, 1 = la pata ya no llega y te caes. Es EL numero del juego, el que
   * decide si el toque llego a tiempo, y el que mira `StepController` para
   * calificar el paso.
   */
  stanceTrailRatio(): number {
    const leg = this.pivotLeg();
    const foot = leg.foot.translation();
    this.measureCoM();
    this.lip.measure(this.com.x, this.com.y, this.com.vx, foot.x, foot.y - FOOT_H / 2);

    // Cuanto del alcance de la pata se comio ya el punto de captura.
    //
    // Es la pregunta exacta que el jugador tiene que contestar en cada paso:
    // "¿todavia llego a frenar esto?". El punto de captura dice donde habria
    // que plantar para quedar parado, y `reachX` dice hasta donde llega la
    // pata; cuando el primero pasa al segundo, ya no hay paso que alcance y la
    // caida esta decidida aunque el bicho todavia se vea derecho.
    //
    // Antes esto se estimaba con el atraso del pie respecto de su punto de
    // apoyo, normalizado contra una zancada constante. Media lo que pasaba,
    // no lo que iba a pasar: con el cuerpo embalado la barra recien se
    // encendia cuando ya era tarde.
    const reachX = Math.sqrt(
      Math.max(
        0.04,
        Math.pow((THIGH_LEN + SHIN_LEN) * SWING_PLANT_REACH, 2) -
          STANCE_HIP_HEIGHT * STANCE_HIP_HEIGHT,
      ),
    );
    return THREE.MathUtils.clamp(this.lip.capturePoint() / reachX, -0.4, 1.6);
  }

  legRole(side: LegSide): LegRole {
    return this.legs[side].role;
  }

  /** Progreso 0..1 del balanceo de una pata (1 = ya plantada). */
  swingProgress(side: LegSide): number {
    const leg = this.legs[side];
    return leg.role === "swing" ? Math.min(1, leg.t / SWING_TIME) : 1;
  }

  footX(side: LegSide): number {
    return this.legs[side].foot.translation().x;
  }

  torsoX(): number {
    return this.torso.translation().x;
  }

  torsoY(): number {
    return this.torso.translation().y;
  }

  torsoTilt(): number {
    return zAngle(this.torso);
  }

  footPosition(side: LegSide, out: THREE.Vector3): THREE.Vector3 {
    const t = this.legs[side].foot.translation();
    return out.set(t.x, t.y - FOOT_H / 2, t.z);
  }

  speed(): number {
    return this.torso.linvel().x;
  }

  // ------------------------------------------------------------------ update

  /**
   * Centro de masa real del cuerpo entero, ponderado por masa. No alcanza con
   * mirar el torso: las dos patas juntas pesan casi tanto como el, y el LIP
   * pide el centro de masa de verdad o el punto de captura sale corrido.
   */
  private measureCoM(): void {
    let mx = 0;
    let my = 0;
    let mvx = 0;
    let total = 0;
    for (const { body } of this.rails) {
      const m = body.mass();
      const t = body.translation();
      const v = body.linvel();
      mx += t.x * m;
      my += t.y * m;
      mvx += v.x * m;
      total += m;
    }
    this.totalMass = total;
    this.com.x = mx / total;
    this.com.y = my / total;
    this.com.vx = mvx / total;
  }

  /** La pata sobre la que el cuerpo esta pivotando ahora. */
  private pivotLeg(): Leg {
    return this.legs[0].role === "stance" ? this.legs[0] : this.legs[1];
  }

  /**
   * Torque de tobillo de la pata de apoyo, salido del PID sobre el
   * desplazamiento del centro de masa.
   *
   * El tope NO es una constante de tuning: es el largo del zapato. Un pie
   * apoyado solo puede correr su centro de presion dentro de su propia huella,
   * asi que el torque maximo que puede dar es `peso * medio zapato`. Saturar
   * ahi es lo que hace que el tobillo NO pueda salvar cualquier desequilibrio
   * — cuando no alcanza, hay que dar un paso, que es justamente de lo que vive
   * el juego.
   */
  private applyAnkleTorque(dt: number): void {
    // POLIGONO DE SOPORTE: la union de los zapatos que estan tocando el piso.
    //
    // El centro de presion puede moverse por todo ese poligono, asi que el
    // torque disponible sale de su MEDIO ANCHO, no del largo de un zapato.
    // Mirando un solo pie el modelo se queda corto justo cuando mas margen
    // hay — parado con los dos pies en el piso — y la criatura se desplomaba
    // sola sin que el jugador tocara nada.
    let lo = Infinity;
    let hi = -Infinity;
    let footY = 0;
    for (const leg of this.legs) {
      const f = leg.foot.translation();
      if (f.y > FOOT_GROUNDED_Y) continue;
      lo = Math.min(lo, f.x - FOOT_LEN / 2);
      hi = Math.max(hi, f.x + FOOT_LEN / 2);
      footY = Math.max(footY, f.y);
    }
    if (lo === Infinity) {
      // Sin nada apoyado no hay contra que empujar.
      this.anklePid.reset();
      return;
    }

    const center = (lo + hi) * 0.5;
    const halfWidth = (hi - lo) * 0.5;

    this.lip.measure(this.com.x, this.com.y, this.com.vx, center, footY - FOOT_H / 2);

    // Se controla sobre el estado PREDICHO un subpaso adelante (Euler
    // simplectico, ver `balance.ts`). Es el reemplazo principista del truco de
    // adelantarle la cadera al objetivo de la IK: el atraso de un subpaso en
    // un lazo tan rigido se cobra como un freno proporcional a la velocidad.
    const ahead = this.lip.predict(dt * CONTROL_LEAD_STEPS);

    // Lo que se regula es el PUNTO DE CAPTURA, no la posicion del centro de
    // masa. Sigue siendo "en funcion del desplazamiento del centro de masa"
    // — `xi = x + v/w` lo incluye — pero le agrega la velocidad, y esa
    // diferencia es todo:
    //
    //  - parado (antes del primer toque): consigna `xi = 0`, o sea "quedate
    //    donde estas". La criatura se sostiene quieta.
    //  - caminando: consigna `xi = v_marcha / w`, que es el punto de captura
    //    que le corresponde a alguien yendo a esa velocidad. El PID acelera si
    //    viene lento y frena si viene rapido, pero NO pelea contra el avance.
    //
    // Regulando la posicion del centro de masa contra un adelanto fijo el lazo
    // es un freno de mano: sostiene al bicho parado y tambien le impide
    // caminar (medido: 0 m pasara lo que pasara).
    const omega = Math.max(0.2, this.lip.omega);
    const setpoint = this.started ? WALK_SPEED / omega : 0;
    const measure = ahead.x + ahead.v / omega;
    // Caminando el tobillo solo AFINA: la autoridad de verdad esta en donde se
    // planta el pie (con un zapato de 36 cm el tobillo no alcanza para salvar
    // nada). Con toda la autoridad disponible el lazo pelea contra el propio
    // paso y la criatura se queda en el lugar.
    const limit =
      this.totalMass *
      -GRAVITY_Y *
      halfWidth *
      ANKLE_TORQUE_MARGIN *
      (this.started ? ANKLE_WALK_SHARE : 1);
    const torque = this.anklePid.update(setpoint, measure, dt, limit);

    // El torque se aplica como FUERZA HORIZONTAL sobre el cuerpo, no como par
    // entre tibia y zapato.
    //
    // Fisicamente es lo mismo y el propio LIP lo dice: un torque de tobillo no
    // es mas que correr el centro de presion dentro de la base de apoyo, y eso
    // se ve en el centro de masa como `x'' = (g/h)(x - x_cop)`, o sea una
    // fuerza `F = -torque/h`. La diferencia esta en donde cae la reaccion.
    //
    // Puesto como par tibia-zapato, la reaccion se la come el zapato: 86 g con
    // una inercia de 0.001 kg*m^2 contra 3.7 N*m son 3600 rad/s^2, o sea que
    // el pie se convierte en una turbina y sus puntas salen a 40 m/s. En un pie
    // de verdad esa reaccion la absorbe el piso repartiendo la presion bajo la
    // planta, que es justo lo que un collider tan chico no sabe representar.
    // OJO CON EL SIGNO. El LIP dice `x'' = (g/h)(x - x_cop)`: para frenar un
    // centro de masa que se va hacia adelante hay que correr el centro de
    // presion POR DELANTE de el, y eso da una fuerza hacia atras. Como el PID
    // devuelve `kp*(consigna - medida)` (negativo cuando el cuerpo se paso), la
    // fuerza equivalente es `+torque/h`. Con el signo al reves el lazo es
    // realimentacion POSITIVA: empuja en la direccion de la caida y la
    // criatura se desploma sola, parada y sin que el jugador toque nada. El
    // sintoma que despista es que "parece funcionar" — daba mas distancia,
    // porque acelerar hacia adelante hace avanzar mas antes de caerse.
    this.torso.addForce({ x: torque / this.lip.h, y: 0, z: 0 }, true);
  }

  /** Un subpaso de fisica: motores + enderezado del torso. Va antes de step(). */
  applyMotors(dt: number): void {
    if (this.ragdoll) {
      this.fadeMotors(dt);
      return;
    }

    // Rapier ACUMULA las fuerzas y los pares agregados con `addForce` /
    // `addTorque`: siguen aplicandose en cada paso hasta que se los resetea.
    // Como aca se agregan en cada subpaso (360 por segundo), sin este reseteo
    // lo que llega al cuerpo es la suma de todo lo pedido desde el arranque de
    // la ronda. Medido: la criatura salia de parada a 5.8 m/s en 80 ms, o sea
    // unos 50 m/s^2 de aceleracion horizontal, con un control que pedia menos
    // de 1 m/s^2. Todos los "records" largos eran eso.
    for (const { body } of this.rails) {
      body.resetForces(false);
      body.resetTorques(false);
    }

    // Parada la criatura se sostiene ERGUIDA; al empezar a caminar se agacha
    // hasta la altura de marcha. No es un adorno: con los pies juntos la pata
    // tiene que acortarse hasta la altura de cadera, y a la altura de marcha
    // eso son 78 grados de rodilla — su posicion mas debil, con la que se
    // desplomaba sola antes de que el jugador tocara nada. La transicion es
    // suave para que no se vea un salto de 45 cm en el primer paso.
    const wantHip = this.started ? STANCE_HIP_HEIGHT : STAND_HIP_HEIGHT;
    this.hipTarget += (wantHip - this.hipTarget) * (1 - Math.exp(-HIP_SETTLE_RATE * dt));

    this.measureCoM();
    this.authority = this.controlAuthority(dt);
    this.applyAnkleTorque(dt);

    for (const leg of this.legs) {
      leg.t += dt;

      if (leg.role === "swing") {
        const p = Math.min(1, leg.t / SWING_TIME);
        this.driveSwing(leg, p);
        if (p >= 1) {
          // Se planto: el peso pasa a ESTA pata, que se vuelve el nuevo eje, y
          // la que venia de apoyo queda atras haciendo de puntal. Dejar el eje
          // en la de atras (que es lo intuitivo, "cambia recien cuando el
          // jugador toca") arrastra el cuerpo por delante de sus pies: la de
          // atras se abre cada vez mas, la cadera baja y el bicho termina
          // abierto de gambas sin que el jugador haya hecho nada mal.
          this.becomePivot(leg);
        }
      } else if (leg.role === "braced") {
        this.driveStance(leg, HIP_BRACE_STIFFNESS, HIP_BRACE_DAMPING, true, dt);
      } else {
        this.driveStance(leg, HIP_STANCE_STIFFNESS, HIP_STANCE_DAMPING, false, dt);
      }

      leg.ankle.configureMotorPosition(ANKLE_TARGET, ANKLE_STIFFNESS, ANKLE_DAMPING);
    }

    // Enderezado del torso. Es lo unico que hace que la caida hacia adelante
    // sea un paso y no una trompada: sin esto el bicho pivotea de cabeza.
    const angle = zAngle(this.torso);
    const angvel = this.torso.angvel().z;
    const torque = THREE.MathUtils.clamp(
      -TORSO_UPRIGHT_K * angle - TORSO_UPRIGHT_D * angvel,
      -TORSO_UPRIGHT_MAX_TORQUE,
      TORSO_UPRIGHT_MAX_TORQUE,
    );
    this.torso.addTorque({ x: 0, y: 0, z: torque }, true);
  }

  /**
   * Clava a la criatura en su riel: un unico plano XY.
   *
   * La trayectoria del juego es una linea, asi que salirse de lado no es un
   * estado valido — es un bug. Y no alcanza con un par correctivo: basta un
   * contacto de canto del zapato para sacar al bicho del plano, y a partir de
   * ahi los revolute joints (todos con eje Z) trabajan torcidos, el solver se
   * desborda y la criatura sale volando de costado.
   *
   * Se resuelve por PROYECCION despues de cada `world.step()`, no con
   * `setEnabledTranslations` / `setEnabledRotations`: congelar esos grados en
   * los cuerpos deja la fila Z del revolute joint con masa efectiva cero y el
   * impulso del solver se va a infinito en el primer paso (ver `makeBody`).
   * Proyectar es equivalente para el jugador y no toca las restricciones.
   */
  constrainToRail(): void {
    for (const { body, z } of this.rails) {
      const t = body.translation();
      if (t.z !== z) body.setTranslation({ x: t.x, y: t.y, z }, false);

      const v = body.linvel();
      if (v.z !== 0) body.setLinvel({ x: v.x, y: v.y, z: 0 }, false);

      // Del cuaternion se conserva solo la parte que gira alrededor de Z.
      const q = body.rotation();
      if (q.x !== 0 || q.y !== 0) {
        const n = Math.hypot(q.z, q.w);
        if (n > 1e-6) body.setRotation({ x: 0, y: 0, z: q.z / n, w: q.w / n }, false);
        else body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, false);
      }

      const w = body.angvel();
      if (w.x !== 0 || w.y !== 0) body.setAngvel({ x: 0, y: 0, z: w.z }, false);
    }
  }

  /**
   * Ragdoll total: se sueltan los motores y el bicho se desarma solo.
   *
   * Los motores se apagan con una RAMPA de `RAGDOLL_FADE`, no de golpe. En el
   * cuadro de la muerte los joints vienen cargados con impulsos enormes (la
   * rodilla apoyada trabaja con 26000 de rigidez); si la rigidez pasa a cero
   * de un cuadro al otro, el impulso que el solver traia calentado del paso
   * anterior queda sin restriccion que lo justifique y se descarga entero
   * sobre los cuerpos. Medido: el torso saltaba de 8 a 26 m/s en un cuadro y
   * la criatura salia disparada en X e Y.
   */
  collapse(): void {
    if (this.ragdoll) return;
    this.ragdoll = true;
    this.ragdollFade = 1;

    // Cuerpo flojo = cuerpo amortiguado. Sin esto las patas sueltas se
    // revolean, se estrellan contra los topes de los joints (la rodilla no
    // puede pasar de 0, el tobillo de +-0.55) y cada golpe de tope en la punta
    // de una pata de 2.7 m mete un impulso enorme que termina en el torso: se
    // lo vio salir a 28 m/s DESPUES de morir. Un muerto no despega.
    for (const { body } of this.rails) {
      body.setLinearDamping(RAGDOLL_LIN_DAMP);
      body.setAngularDamping(RAGDOLL_ANG_DAMP);
    }

    // Un envion de gracia para que la caida tenga forma en vez de derretirse.
    this.torso.applyTorqueImpulse({ x: 0, y: 0, z: -0.35 }, true);
  }

  /** Rampa de apagado de los motores durante la caida. */
  private fadeMotors(dt: number): void {
    this.ragdollFade = Math.max(0, this.ragdollFade - dt / RAGDOLL_FADE);
    const f = this.ragdollFade;
    for (const leg of this.legs) {
      if (f <= 0) {
        leg.hip.configureMotorPosition(0, 0, 0);
        leg.knee.configureMotorPosition(0, 0, 0);
        leg.ankle.configureMotorPosition(0, 0, 0);
        continue;
      }
      // Sostiene la pose que tenia, cada vez mas flojo.
      leg.hip.configureMotorPosition(this.hipAngle(leg), HIP_BRACE_STIFFNESS * f, HIP_BRACE_DAMPING * f);
      leg.knee.configureMotorPosition(
        angleDelta(zAngle(leg.shin), zAngle(leg.thigh)),
        KNEE_LOCK_STIFFNESS * f,
        KNEE_LOCK_DAMPING * f,
      );
      leg.ankle.configureMotorPosition(ANKLE_TARGET, ANKLE_STIFFNESS * f, ANKLE_DAMPING * f);
    }
  }

  isRagdoll(): boolean {
    return this.ragdoll;
  }

  /**
   * Red de seguridad: le pone tope a las velocidades de cada cuerpo.
   *
   * Una cadena de joints cargada puede darle al solver un cuadro imposible
   * (dos limites peleandose, un contacto profundo) y la correccion sale como
   * un impulso enorme. Sin este freno eso se ve como el bicho saliendo
   * disparado a 30 m de altura, que ademas rompe la camara. Con el, el peor
   * caso es un ragdoll feo.
   */
  clampVelocities(): void {
    for (const rail of this.rails) {
      const v = rail.body.linvel();
      let vx = v.x;
      let vy = v.y;

      // Freno de SALTO: lo que delata una explosion del solver no es que un
      // cuerpo vaya rapido — el zapato que se balancea pasa de 16 m/s y esta
      // perfecto — sino que cambie de velocidad de golpe. Un subpaso dura
      // 1/360 s; nada legitimo en esta escena cambia MAX_BODY_DV m/s en ese
      // tiempo. Recortando el salto en vez del valor absoluto, la marcha
      // queda intacta y la explosion se corta en el cuadro en que nace.
      const dx = vx - rail.vx;
      const dy = vy - rail.vy;
      const dv = Math.hypot(dx, dy);
      if (dv > MAX_BODY_DV) {
        const k = MAX_BODY_DV / dv;
        vx = rail.vx + dx * k;
        vy = rail.vy + dy * k;
      }

      // Techo alto jugando (el zapato del balanceo pasa de 16 m/s y esta
      // bien) y bajo una vez muerto, donde nada tiene por que ir rapido.
      const cap = this.ragdoll ? RAGDOLL_MAX_SPEED : MAX_BODY_SPEED;
      const speed = Math.hypot(vx, vy);
      if (speed > cap) {
        const k = cap / speed;
        vx *= k;
        vy *= k;
      }

      if (vx !== v.x || vy !== v.y) rail.body.setLinvel({ x: vx, y: vy, z: 0 }, false);
      rail.vx = vx;
      rail.vy = vy;

      const w = rail.body.angvel();
      if (Math.abs(w.z) > MAX_BODY_SPIN) {
        rail.body.setAngvel({ x: 0, y: 0, z: Math.sign(w.z) * MAX_BODY_SPIN }, false);
      }
    }
  }

  /** Copia las transformadas de la fisica a los meshes. */
  sync(): void {
    for (const { body, mesh } of this.meshes) {
      const t = body.translation();
      const r = body.rotation();
      mesh.position.copy(_v.set(t.x, t.y, t.z));
      mesh.quaternion.copy(_q.set(r.x, r.y, r.z, r.w));
    }
  }
}
