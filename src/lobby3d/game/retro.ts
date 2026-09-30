import * as THREE from "three";

/**
 * El "material" de La Feria (DESIGN.md, "Cinta Gastada"): la imagen de la primera
 * PlayStation.
 *
 * - `psx(material)`: vertices ajustados a la grilla de la resolucion baja (tiemblan
 *   cuando se mueve la camara). Se aplica a todo lo que no sea texto.
 * - `RetroPass`: dibuja la escena a una resolucion baja (`SHORT_SIDE` pixeles del
 *   lado corto), la estira con pixeles duros y le pone encima cuantizacion de color
 *   con tramado ordenado, grano de VHS, viñeteado y un tinte (el rojo que sube con
 *   las rondas).
 *
 * **Sin mapeo afin a proposito.** La primera version deformaba las texturas como la
 * PS1 (sin correccion de perspectiva) y el programador lo saco: en el piso y en los
 * afiches, mirados de costado, se veia la diagonal que une los dos triangulos de
 * cada cara estirando la imagen. Y los afiches se tienen que reconocer de lejos.
 *
 * Los carteles (nombres, contadores) van en la capa `LABEL_LAYER` y se dibujan
 * despues del filtro, a resolucion completa: la dificultad visual nunca le gana a la
 * informacion.
 */

/**
 * Pixeles del lado corto de la imagen interna. Era 240 (la PS1 real) y los afiches y
 * carteles no se leian de lejos: con 400 sigue pixelado pero se reconoce que juego es.
 */
const SHORT_SIDE = 400;
/** Niveles por canal despues del tramado (la PS1 tenia 5 bits: 32; algo mas, por los afiches). */
const LEVELS = 40;
export const LABEL_LAYER = 1;

/** Resolucion interna, compartida por todos los materiales `psx` (se actualiza en resize). */
const snapRes = { value: new THREE.Vector2(320, 240) };

/** Parchea un material para que se vea PS1 (vertices que tiemblan en la grilla baja). */
export function psx<T extends THREE.Material>(material: T): T {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uSnapRes = snapRes;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nuniform vec2 uSnapRes;")
      .replace(
        "#include <project_vertex>",
        `#include <project_vertex>
if (gl_Position.w > 0.0) {
  vec4 snapped = gl_Position;
  snapped.xy = floor(snapped.xy / snapped.w * uSnapRes * 0.5 + 0.5) / (uSnapRes * 0.5) * snapped.w;
  gl_Position = snapped;
}`,
      );
  };
  material.customProgramCacheKey = () => "psx";
  return material;
}

/**
 * Para lo que va pegado sobre otra superficie (un afiche sobre su tabla, la pantalla
 * del televisor, un cartel pintado en el piso): le da prioridad en el buffer de
 * profundidad. Sin esto hay z-fighting: el temblor de vertices corre cada esquina por
 * separado (mas que el centimetro que separa las dos caras), y de lejos en uno de los
 * dos triangulos gana la cara de atras y el afiche se ve cortado en diagonal.
 */
export function decal<T extends THREE.Material>(material: T): T {
  material.polygonOffset = true;
  material.polygonOffsetFactor = -4;
  material.polygonOffsetUnits = -8;
  return material;
}

/** Lambert PS1 (el material de casi todo). */
export function psxLambert(params: THREE.MeshLambertMaterialParameters): THREE.MeshLambertMaterial {
  return psx(new THREE.MeshLambertMaterial(params));
}

/** Basic PS1 (sin luz: afiches, pantallas, luces). */
export function psxBasic(params: THREE.MeshBasicMaterialParameters): THREE.MeshBasicMaterial {
  return psx(new THREE.MeshBasicMaterial(params));
}

const POST_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const POST_FRAG = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform vec2 uRes;
  uniform float uTime;
  uniform vec3 uTint;
  uniform float uTintAmount;
  uniform float uLevels;
  varying vec2 vUv;

  float bayer4(vec2 p) {
    vec2 q = mod(p, 4.0);
    int i = int(q.x) + int(q.y) * 4;
    int m[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);
    return float(m[i]) / 16.0;
  }

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
  }

  void main() {
    vec2 px = floor(vUv * uRes);
    // Temblor horizontal de cinta: algunas lineas se corren un pixel de vez en cuando.
    float jitter = step(0.985, hash(vec2(px.y, floor(uTime * 12.0)))) * (hash(vec2(uTime, px.y)) - 0.5) * 2.0;
    vec2 uv = (px + 0.5 + vec2(jitter, 0.0)) / uRes;
    vec3 c = texture2D(tDiffuse, uv).rgb;

    // Tinte (la noche se pone roja con las rondas).
    float lum = dot(c, vec3(0.299, 0.587, 0.114));
    c = mix(c, uTint * (lum * 1.6 + 0.02), uTintAmount);

    c = sRGBTransferOETF(vec4(max(c, 0.0), 1.0)).rgb;

    // Grano de VHS.
    c += (hash(px + fract(uTime * 7.13) * 91.0) - 0.5) * 0.06;

    // Cuantizacion con tramado ordenado.
    c = floor(c * uLevels + bayer4(px)) / uLevels;

    // Viñeteado y lineas de barrido.
    vec2 d = vUv - 0.5;
    float vig = 1.0 - smoothstep(0.35, 0.85, length(d * vec2(1.1, 1.0)) * 1.15);
    c *= mix(0.45, 1.0, vig);
    c *= 0.94 + 0.06 * step(0.5, fract(gl_FragCoord.y * 0.5));

    gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
  }
`;

/** Filtro de pantalla: resolucion baja + cinta gastada. */
export class RetroPass {
  private readonly target: THREE.WebGLRenderTarget;
  private readonly postScene = new THREE.Scene();
  private readonly postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly mat: THREE.ShaderMaterial;
  private time = 0;

  constructor() {
    this.target = new THREE.WebGLRenderTarget(320, 240, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: true,
    });
    this.mat = new THREE.ShaderMaterial({
      vertexShader: POST_VERT,
      fragmentShader: POST_FRAG,
      uniforms: {
        tDiffuse: { value: this.target.texture },
        uRes: { value: new THREE.Vector2(320, 240) },
        uTime: { value: 0 },
        uTint: { value: new THREE.Color("#ff2a1a") },
        uTintAmount: { value: 0 },
        uLevels: { value: LEVELS },
      },
      depthTest: false,
      depthWrite: false,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat);
    quad.frustumCulled = false;
    this.postScene.add(quad);
  }

  setSize(w: number, h: number): void {
    const k = SHORT_SIDE / Math.min(w, h);
    const rw = Math.max(1, Math.round(w * k));
    const rh = Math.max(1, Math.round(h * k));
    this.target.setSize(rw, rh);
    this.mat.uniforms.uRes.value.set(rw, rh);
    snapRes.value.set(rw, rh);
  }

  /** Cuanto rojo tiñe la imagen (0 = nada). */
  setTint(amount: number): void {
    this.mat.uniforms.uTintAmount.value = amount;
  }

  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, dt: number): void {
    this.time += dt;
    this.mat.uniforms.uTime.value = this.time;

    camera.layers.set(0);
    renderer.setRenderTarget(this.target);
    renderer.clear();
    renderer.render(scene, camera);

    renderer.setRenderTarget(null);
    renderer.render(this.postScene, this.postCamera);

    // Carteles a resolucion completa, encima del filtro.
    camera.layers.set(LABEL_LAYER);
    const bg = scene.background;
    const fog = scene.fog;
    scene.background = null;
    scene.fog = null;
    renderer.autoClear = false;
    renderer.render(scene, camera);
    renderer.autoClear = true;
    scene.background = bg;
    scene.fog = fog;
    camera.layers.set(0);
  }
}
