import * as THREE from "three";
import type { Course, Plat } from "./Course";
import {
  GOAL_Z,
  PAD_HALF,
  ROPE_AXIS_Y,
  ROPE_END_X,
  ROPE_HAND_R,
  ROPE_THICK,
  ROPES,
  ropeRadius,
} from "./constants";
import {
  edgeTexture,
  giantFaceTexture,
  pastelTexture,
  plankTexture,
  ropeTexture,
  tileTexture,
} from "./textures";

const SKY = new THREE.Color("#efd3e0");
/** Largo del brazo del muñeco gigante: la mano (donde se ata la cuerda) va en ROPE_HAND_R. */
const ARM_LEN = ROPE_HAND_R + 0.5;
/** Traje de los dos muñecos de cada cuerda (lado +x, lado -x). */
const GIANT_SUITS: readonly [string, string][] = [
  ["#f08a80", "#8fcfe0"],
  ["#b9a2e8", "#8fd6a8"],
];

interface RopeView {
  z: number;
  group: THREE.Group;
  shadow: THREE.Mesh;
}

/**
 * Todo lo que se ve del mundo (DESIGN.md "Patio de Pastel"): el cielo pastel, el
 * vacio oscuro de abajo, el puente, las plataformas, las escaleras del decorado, y
 * las dos cuerdas con sus dos muñecos gigantes cada una.
 *
 * Cada cuerda es un tubo fijo en un grupo que gira alrededor del eje x (el que une las
 * manos de sus muñecos): `setRope(i, th)` solo cambia la rotacion. El brazo que la
 * sostiene de cada muñeco cuelga del mismo grupo, asi gira con ella sin calcular nada.
 */
export class Stage {
  private readonly ropes: RopeView[] = [];

  constructor(scene: THREE.Scene, course: Course) {
    scene.background = SKY;
    scene.fog = new THREE.Fog(SKY, 34, 95);
    scene.add(new THREE.HemisphereLight("#fff5f8", "#8a6a9a", 1.5));
    const sun = new THREE.DirectionalLight("#ffffff", 1.5);
    sun.position.set(10, 22, 8);
    scene.add(sun);

    // Cielo en degrade: pastel arriba y, debajo del horizonte, el vacio ciruela.
    scene.add(skyDome());

    const plank = plankTexture();
    const edge = edgeTexture();
    const pinkTile = tileTexture("#f4a6bf", "#f7bfd1", 601);
    const goalTile = tileTexture("#ffe07a", "#fff1b8", 607);
    for (const p of course.plats) scene.add(this.platMesh(p, p.kind === "bridge" ? plank : p.kind === "goal" ? goalTile : pinkTile, edge));

    // Pilares bajo las plataformas anchas, que se pierden en el vacio.
    const pillarTex = pastelTexture("#e7dcef", 613);
    for (const p of course.plats) {
      if (p.kind === "bridge") continue;
      for (const sx of [-1, 1]) {
        scene.add(box(1.4, 50, 1.4, sx * (PAD_HALF - 1.2), -p.h - 25, p.z, pillarTex));
      }
    }

    addGate(scene, GOAL_Z - 0.5);
    addStairs(scene);

    // Las cuerdas y los brazos que las giran.
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 40; i++) {
      const x = -ROPE_END_X + (2 * ROPE_END_X * i) / 40;
      pts.push(new THREE.Vector3(x, -ropeRadius(x), 0));
    }
    const ropeTex = ropeTexture();
    ropeTex.repeat.set(30, 1);
    const tubeGeo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 80, ROPE_THICK, 8, false);
    const tubeMat = new THREE.MeshLambertMaterial({ map: ropeTex });
    ROPES.forEach((rope, i) => {
      const group = new THREE.Group();
      group.add(new THREE.Mesh(tubeGeo, tubeMat));
      group.position.set(0, ROPE_AXIS_Y, rope.z);
      scene.add(group);
      // Sombra de la cuerda sobre el tablero: dice donde va a pasar (informacion, no decorado).
      const shadow = new THREE.Mesh(
        new THREE.PlaneGeometry(1.4, 0.3),
        new THREE.MeshBasicMaterial({ color: "#2a1a30", transparent: true, opacity: 0, depthWrite: false }),
      );
      shadow.rotation.x = -Math.PI / 2;
      shadow.position.y = 0.02;
      shadow.renderOrder = 2;
      scene.add(shadow);
      const view = { z: rope.z, group, shadow };
      this.ropes.push(view);
      const suits = GIANT_SUITS[i % GIANT_SUITS.length];
      addGiant(scene, view, 1, suits[0]);
      addGiant(scene, view, -1, suits[1]);
    });
  }

  /** Pone la cuerda `i` en su angulo del momento (0 = abajo, rozando el tablero). */
  setRope(i: number, th: number): void {
    const view = this.ropes[i];
    // Rotar el grupo en -th lleva el punto (x, -r, 0) a (x, -r cos th, r sin th).
    view.group.rotation.x = -th;
    const r = ropeRadius(0);
    const ry = ROPE_AXIS_Y - r * Math.cos(th);
    const shadow = view.shadow.material as THREE.MeshBasicMaterial;
    shadow.opacity = Math.max(0, Math.min(0.55, 0.6 - ry / 6));
    view.shadow.position.z = view.z + r * Math.sin(th);
  }

  private platMesh(p: Plat, top: THREE.Texture, side: THREE.Texture): THREE.Mesh {
    const mesh = new THREE.Mesh(metreBox(p.w, p.h, p.d), [
      mat(side),
      mat(side),
      mat(top),
      mat(side),
      mat(side),
      mat(side),
    ]);
    mesh.position.set(p.x, p.y - p.h / 2, p.z);
    return mesh;
  }
}

/**
 * Muñeco gigante de bloques de un lado del puente (`side` = +1 o -1), mirando al
 * puente. Su brazo de la cuerda cuelga del grupo que gira; el resto es fijo.
 */
function addGiant(scene: THREE.Scene, rope: RopeView, side: number, suit: string): void {
  const skinTex = pastelTexture("#f1d2b6", 641);
  const suitTex = pastelTexture(suit, 643 + side);
  const hairTex = pastelTexture("#2b2230", 647);
  const cx = side * (ROPE_END_X + 0.95);
  // El hombro de la cuerda cae justo sobre el eje (z = rope.z): el torso se corre.
  const cz = rope.z + side * 1.35;
  const giant = new THREE.Group();
  for (const dz of [-0.5, 0.5]) giant.add(box(1, 2.6, 0.85, cx, 1.3, cz + dz, suitTex));
  giant.add(box(1, 2.95, 1.9, cx, 2.6 + 1.475, cz, suitTex));
  // Brazo libre, colgando del otro lado.
  giant.add(box(0.8, 2.6, 0.8, cx, 5.55 - 1.3, cz + side * 1.35, suitTex));
  // Cabeza: la cara hacia el puente, pelo arriba y atras.
  const face = new THREE.MeshLambertMaterial({ map: giantFaceTexture("#f1d2b6") });
  const skin = new THREE.MeshLambertMaterial({ map: skinTex });
  const hair = new THREE.MeshLambertMaterial({ map: hairTex });
  const head = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.8, 1.8), [
    side > 0 ? hair : face,
    side > 0 ? face : hair,
    hair,
    skin,
    skin,
    skin,
  ]);
  head.position.set(cx, 5.55 + 0.95, cz);
  giant.add(head);
  // Pilar bajo los pies.
  giant.add(box(2.4, 50, 3, cx, -25, cz, pastelTexture("#e7dcef", 613)));
  scene.add(giant);

  // Brazo de la cuerda: del hombro (en el eje) hasta la mano, que gira con la cuerda.
  const arm = box(0.8, ARM_LEN, 0.8, side * ROPE_END_X, -ARM_LEN / 2 + 0.2, 0, suitTex);
  const hand = box(0.85, 0.7, 0.85, side * ROPE_END_X, -ROPE_HAND_R, 0, skinTex);
  rope.group.add(arm, hand);
}

/** Arco de la meta: dos columnas y un dintel amarillo manteca. */
function addGate(scene: THREE.Scene, z: number): void {
  const tex = pastelTexture("#ffd966", 619);
  for (const sx of [-1, 1]) scene.add(box(0.6, 4.2, 0.6, sx * 2.2, 2.1, z, tex));
  scene.add(box(5, 0.7, 0.6, 0, 4.45, z, tex));
}

/** Escaleras pastel que bajan al vacio a los costados (la escenografia de patio). */
function addStairs(scene: THREE.Scene): void {
  const colors = ["#f4a6bf", "#9fdcc9", "#ffe07a", "#c9b6f0"];
  const flights = [
    { x: -22, z: -6, dir: 1 },
    { x: 24, z: -14, dir: -1 },
    { x: -26, z: -32, dir: -1 },
    { x: 21, z: -40, dir: 1 },
    { x: -18, z: 8, dir: -1 },
    { x: -24, z: -50, dir: 1 },
  ];
  flights.forEach((f, i) => {
    const tex = pastelTexture(colors[i % colors.length], 631 + i);
    for (let s = 0; s < 14; s++) {
      const y = 2 - s * 1.1;
      scene.add(box(3, 1.1, 1.4, f.x, y - 0.55, f.z + f.dir * s * 1.4, tex));
    }
    // Descanso al pie de cada tramo.
    scene.add(box(4, 1.1, 4, f.x, 2 - 14 * 1.1 - 0.55, f.z + f.dir * (14 * 1.4 + 1.3), tex));
  });
}

/**
 * Cupula del cielo con color por vertice segun la altura de la direccion: el vacio
 * se lee oscuro hacia abajo mire donde mire la camara (un plano oscuro abajo se veia
 * como un piso).
 */
function skyDome(): THREE.Mesh {
  const geo = new THREE.SphereGeometry(200, 32, 24);
  const pos = geo.getAttribute("position") as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const top = new THREE.Color("#f7e3ec");
  const horizon = SKY;
  const deep = new THREE.Color("#7a4d78");
  const bottom = new THREE.Color("#241430");
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / 200;
    if (y >= 0) c.copy(horizon).lerp(top, y);
    else if (y > -0.2) c.copy(horizon).lerp(deep, -y / 0.2);
    else c.copy(deep).lerp(bottom, Math.min(1, (-y - 0.2) / 0.5));
    colors.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const dome = new THREE.Mesh(
    geo,
    new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }),
  );
  dome.renderOrder = -1;
  return dome;
}

function mat(tex: THREE.Texture): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ map: tex });
}

function box(w: number, h: number, d: number, x: number, y: number, z: number, tex: THREE.Texture): THREE.Mesh {
  const mesh = new THREE.Mesh(metreBox(w, h, d), mat(tex));
  mesh.position.set(x, y, z);
  return mesh;
}

/**
 * Caja con las UV en metros (la textura mide 1 m): un pixel mide lo mismo en todas
 * las cajas, sin estirarse con el tamaño. Caras de BoxGeometry: +x, -x, +y, -y, +z, -z.
 */
function metreBox(w: number, h: number, d: number): THREE.BoxGeometry {
  const geo = new THREE.BoxGeometry(w, h, d);
  const uv = geo.getAttribute("uv") as THREE.BufferAttribute;
  const faces: [number, number][] = [
    [d, h],
    [d, h],
    [w, d],
    [w, d],
    [w, h],
    [w, h],
  ];
  faces.forEach(([su, sv], f) => {
    for (let i = 0; i < 4; i++) {
      const k = f * 4 + i;
      uv.setXY(k, uv.getX(k) * su, uv.getY(k) * sv);
    }
  });
  uv.needsUpdate = true;
  return geo;
}
