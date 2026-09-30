import * as THREE from "three";
import { DAY_EASE, DAY_LOBBY } from "./constants";

/**
 * Cielo de la Isla: domo con degradado, sol (o luna), luces, niebla, nubes que
 * derivan, estrellas de noche y lluvia algunas rondas.
 *
 * La hora del dia es un numero en [0, 1] (0 amanecer, ~0.3 mediodia, ~0.8
 * atardecer, 1 noche) y la decide la sala: avanza ronda a ronda y la final es de
 * noche (ver `Hub.dayTarget`). El clima sale de una semilla (codigo + ronda),
 * asi todos ven el mismo cielo sin mandar nada por la red.
 */

export type Weather = "clear" | "cloudy" | "rain";

interface DayKey {
  t: number;
  top: string;
  horizon: string;
  sun: string;
  sunI: number;
  hemiSky: string;
  hemiGround: string;
  hemiI: number;
  /** Elevacion del sol (radianes). */
  elev: number;
}

const KEYS: DayKey[] = [
  { t: 0, top: "#8fa7d8", horizon: "#ffd2b0", sun: "#ffc38a", sunI: 1.9, hemiSky: "#d9dff5", hemiGround: "#8f9a6a", hemiI: 1.25, elev: 0.25 },
  { t: 0.3, top: "#6fb7e8", horizon: "#cfeaf5", sun: "#fff3dc", sunI: 2.6, hemiSky: "#e3f3ff", hemiGround: "#86a86c", hemiI: 1.45, elev: 1.05 },
  { t: 0.62, top: "#78a6dc", horizon: "#ffe0b0", sun: "#ffd79a", sunI: 2.3, hemiSky: "#f2e6d6", hemiGround: "#8c9c66", hemiI: 1.3, elev: 0.6 },
  { t: 0.82, top: "#5a6fb8", horizon: "#ff9f7a", sun: "#ff9a5c", sunI: 1.7, hemiSky: "#e8c9c0", hemiGround: "#6f6f5a", hemiI: 1.05, elev: 0.16 },
  { t: 1, top: "#0e1636", horizon: "#2c3a6b", sun: "#a9bcff", sunI: 0.75, hemiSky: "#4a5a9a", hemiGround: "#1f2a3a", hemiI: 0.75, elev: 0.75 },
];

const GREY = new THREE.Color("#9aa3ad");

function sample(t: number): DayKey {
  const x = Math.min(1, Math.max(0, t));
  for (let i = 0; i < KEYS.length - 1; i++) {
    const a = KEYS[i];
    const b = KEYS[i + 1];
    if (x <= b.t) {
      const k = (x - a.t) / (b.t - a.t);
      const mix = (c1: string, c2: string): string =>
        new THREE.Color(c1).lerp(new THREE.Color(c2), k).getStyle();
      return {
        t: x,
        top: mix(a.top, b.top),
        horizon: mix(a.horizon, b.horizon),
        sun: mix(a.sun, b.sun),
        sunI: a.sunI + (b.sunI - a.sunI) * k,
        hemiSky: mix(a.hemiSky, b.hemiSky),
        hemiGround: mix(a.hemiGround, b.hemiGround),
        hemiI: a.hemiI + (b.hemiI - a.hemiI) * k,
        elev: a.elev + (b.elev - a.elev) * k,
      };
    }
  }
  return KEYS[KEYS.length - 1];
}

const DOME_VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const DOME_FRAG = /* glsl */ `
  uniform vec3 uTop;
  uniform vec3 uHorizon;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform float uSunSize;
  varying vec3 vDir;
  void main() {
    float h = vDir.y;
    vec3 col = mix(uHorizon, uTop, smoothstep(-0.02, 0.55, h));
    // Debajo del horizonte el cielo se oscurece apenas (la isla flota en el).
    col = mix(col, uHorizon * 0.82, smoothstep(0.0, -0.4, h));
    float d = max(dot(vDir, uSunDir), 0.0);
    col += uSunColor * pow(d, 60.0) * 0.35;
    col = mix(col, uSunColor, smoothstep(uSunSize, uSunSize + 0.002, d));
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

export class Sky {
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  private readonly domeMat: THREE.ShaderMaterial;
  private readonly dome: THREE.Mesh;
  private readonly fog: THREE.Fog;
  private readonly stars: THREE.Points;
  private readonly starMat: THREE.PointsMaterial;
  private readonly clouds = new THREE.Group();
  private readonly cloudMat: THREE.MeshLambertMaterial;
  private readonly rain: THREE.LineSegments;
  private readonly rainPos: Float32Array;
  private readonly rainMat: THREE.LineBasicMaterial;

  private day = DAY_LOBBY;
  private dayTarget = DAY_LOBBY;
  private weather: Weather = "clear";
  /** 0 despejado .. 1 tormenta, suavizado hacia el clima vigente. */
  private gloom = 0;
  private rainAmount = 0;

  constructor(scene: THREE.Scene) {
    this.domeMat = new THREE.ShaderMaterial({
      vertexShader: DOME_VERT,
      fragmentShader: DOME_FRAG,
      uniforms: {
        uTop: { value: new THREE.Color() },
        uHorizon: { value: new THREE.Color() },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uSunColor: { value: new THREE.Color() },
        uSunSize: { value: 0.9992 },
      },
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(400, 32, 16), this.domeMat);
    this.dome.renderOrder = -1;
    scene.add(this.dome);

    this.fog = new THREE.Fog("#cfeaf5", 60, 190);
    scene.fog = this.fog;

    this.hemi = new THREE.HemisphereLight("#e3f3ff", "#86a86c", 1.4);
    scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight("#fff3dc", 2.5);
    scene.add(this.sun, this.sun.target);

    // Estrellas: puntos fijos en la mitad de arriba del domo, visibles de noche.
    const starCount = 500;
    const sp = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      const u = Math.random() * Math.PI * 2;
      const v = Math.acos(Math.random() * 0.95);
      sp[i * 3] = Math.sin(v) * Math.cos(u) * 360;
      sp[i * 3 + 1] = Math.cos(v) * 360;
      sp[i * 3 + 2] = Math.sin(v) * Math.sin(u) * 360;
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute("position", new THREE.BufferAttribute(sp, 3));
    this.starMat = new THREE.PointsMaterial({
      color: "#ffffff",
      size: 2.2,
      sizeAttenuation: false,
      transparent: true,
      opacity: 0,
      fog: false,
      depthWrite: false,
    });
    this.stars = new THREE.Points(starGeo, this.starMat);
    scene.add(this.stars);

    // Nubes: racimos de icosaedros aplastados.
    this.cloudMat = new THREE.MeshLambertMaterial({
      color: "#ffffff",
      flatShading: true,
      transparent: true,
      opacity: 0.95,
    });
    const puff = new THREE.IcosahedronGeometry(1, 0);
    for (let i = 0; i < 18; i++) {
      const cloud = new THREE.Group();
      const n = 3 + Math.floor(Math.random() * 3);
      for (let j = 0; j < n; j++) {
        const m = new THREE.Mesh(puff, this.cloudMat);
        const s = 1.6 + Math.random() * 1.6;
        m.scale.set(s * 1.4, s * 0.8, s);
        m.position.set(j * 2.2 - n, Math.random() * 0.8, (Math.random() - 0.5) * 1.6);
        m.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
        cloud.add(m);
      }
      const a = Math.random() * Math.PI * 2;
      const r = 28 + Math.random() * 60;
      cloud.position.set(Math.cos(a) * r, 10 + Math.random() * 18, Math.sin(a) * r);
      cloud.userData.extra = i >= 10; // solo aparecen nublado
      this.clouds.add(cloud);
    }
    scene.add(this.clouds);

    // Lluvia: segmentos cortos en una caja que sigue a la camara.
    const drops = 700;
    this.rainPos = new Float32Array(drops * 6);
    for (let i = 0; i < drops; i++) this.resetDrop(i, Math.random() * 24);
    const rainGeo = new THREE.BufferGeometry();
    rainGeo.setAttribute("position", new THREE.BufferAttribute(this.rainPos, 3));
    this.rainMat = new THREE.LineBasicMaterial({ color: "#dfe9f3", transparent: true, opacity: 0 });
    this.rain = new THREE.LineSegments(rainGeo, this.rainMat);
    this.rain.frustumCulled = false;
    scene.add(this.rain);

    this.apply();
  }

  private resetDrop(i: number, y: number): void {
    const x = (Math.random() - 0.5) * 36;
    const z = (Math.random() - 0.5) * 36;
    const o = i * 6;
    this.rainPos[o] = x;
    this.rainPos[o + 1] = y;
    this.rainPos[o + 2] = z;
    this.rainPos[o + 3] = x + 0.05;
    this.rainPos[o + 4] = y - 0.6;
    this.rainPos[o + 5] = z;
  }

  /** Hora a la que va el cielo (llega suavizado). `instant` salta sin transicion. */
  setDay(t: number, instant = false): void {
    this.dayTarget = t;
    if (instant) this.day = t;
  }

  setWeather(w: Weather): void {
    this.weather = w;
  }

  update(dt: number, center: THREE.Vector3): void {
    this.day += (this.dayTarget - this.day) * Math.min(1, dt * DAY_EASE);
    const gloomTarget = this.weather === "rain" ? 1 : this.weather === "cloudy" ? 0.45 : 0;
    this.gloom += (gloomTarget - this.gloom) * Math.min(1, dt * 0.5);
    const rainTarget = this.weather === "rain" ? 1 : 0;
    this.rainAmount += (rainTarget - this.rainAmount) * Math.min(1, dt * 0.8);

    this.dome.position.copy(center);
    this.stars.position.copy(center);
    this.clouds.rotation.y += dt * 0.004;

    // Lluvia alrededor del centro, cayendo en diagonal apenas.
    if (this.rainAmount > 0.01) {
      const fall = dt * 22;
      for (let i = 0; i < this.rainPos.length / 6; i++) {
        const o = i * 6;
        this.rainPos[o + 1] -= fall;
        this.rainPos[o + 4] -= fall;
        if (this.rainPos[o + 4] < -4) this.resetDrop(i, 18 + Math.random() * 6);
      }
      this.rain.geometry.getAttribute("position").needsUpdate = true;
      this.rain.position.set(center.x, 0, center.z);
    }
    this.rain.visible = this.rainAmount > 0.01;
    this.rainMat.opacity = this.rainAmount * 0.55;

    this.apply();
  }

  private apply(): void {
    const k = sample(this.day);
    const g = this.gloom;
    const night = Math.max(0, (this.day - 0.84) / 0.16);

    const top = new THREE.Color(k.top).lerp(GREY, g * 0.45);
    const horizon = new THREE.Color(k.horizon).lerp(GREY, g * 0.5);
    this.domeMat.uniforms.uTop.value.copy(top);
    this.domeMat.uniforms.uHorizon.value.copy(horizon);
    this.fog.color.copy(horizon);
    this.fog.near = 60 - g * 30;
    this.fog.far = 190 - g * 80;

    // El sol cruza de este a oeste con la partida; de noche es la luna.
    const az = night > 0.5 ? 0.6 : 1.2 - this.day * 2.6;
    const dir = new THREE.Vector3(Math.sin(az) * Math.cos(k.elev), Math.sin(k.elev), -Math.cos(az) * Math.cos(k.elev) * 0.6).normalize();
    this.domeMat.uniforms.uSunDir.value.copy(dir);
    const sunColor = new THREE.Color(k.sun);
    this.domeMat.uniforms.uSunColor.value.copy(sunColor).multiplyScalar(1 - g * 0.85);
    this.domeMat.uniforms.uSunSize.value = night > 0.5 ? 0.9996 : 0.9991;

    this.sun.color.copy(sunColor);
    this.sun.intensity = k.sunI * (1 - g * 0.55);
    this.sun.position.copy(dir).multiplyScalar(60);
    this.hemi.color.set(k.hemiSky).lerp(GREY, g * 0.3);
    this.hemi.groundColor.set(k.hemiGround);
    this.hemi.intensity = k.hemiI * (1 - g * 0.2);

    this.starMat.opacity = night * (1 - g);
    this.cloudMat.color.set("#ffffff").lerp(new THREE.Color("#7d8894"), g * 0.8).lerp(new THREE.Color(k.horizon), 0.25);
    this.cloudMat.opacity = 0.95;
    for (const c of this.clouds.children) {
      c.visible = !(c.userData.extra as boolean) || g > 0.2;
    }
  }
}
