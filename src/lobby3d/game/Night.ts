import * as THREE from "three";
import { DREAD_EASE } from "./constants";
import { psxBasic } from "./retro";

/**
 * La noche de La Feria (DESIGN.md: siempre es de noche y la partida la empeora).
 *
 * `dread` va de 0 (lobby: la feria "abierta") a 1 (la final): la niebla se espesa
 * y se tiñe de rojo, la luna se apaga y en la final sale roja. El clima (lluvia o
 * niebla cerrada) sale de una semilla de la sala, asi todos ven la misma noche sin
 * mandar nada. El tinte rojo de la imagen lo aplica el filtro retro (`tint`).
 */

export type Weather = "clear" | "fog" | "rain";

const FOG_OPEN = new THREE.Color("#0b0d10");
const FOG_LATE = new THREE.Color("#120708");
const FOG_FINAL = new THREE.Color("#1a0506");
const MOON = new THREE.Color("#b9c2c9");
const MOON_RED = new THREE.Color("#c0392b");

export class Night {
  readonly moonLight: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  private readonly fog: THREE.FogExp2;
  private readonly bg = new THREE.Color();
  private readonly moon: THREE.Mesh;
  private readonly moonMat: THREE.MeshBasicMaterial;
  private readonly rain: THREE.LineSegments;
  private readonly rainPos: Float32Array;
  private readonly rainMat: THREE.LineBasicMaterial;

  private dread = 0;
  private dreadTarget = 0;
  private weather: Weather = "clear";
  private murk = 0;
  private rainAmount = 0;

  constructor(scene: THREE.Scene) {
    this.fog = new THREE.FogExp2(FOG_OPEN.getHex(), 0.035);
    scene.fog = this.fog;
    scene.background = this.bg;

    this.hemi = new THREE.HemisphereLight("#28324a", "#15110c", 2.2);
    scene.add(this.hemi);
    this.moonLight = new THREE.DirectionalLight(MOON.getHex(), 1.1);
    this.moonLight.position.set(-30, 40, -50);
    scene.add(this.moonLight, this.moonLight.target);

    // La luna: un disco facetado lejos, sin niebla (se ve a traves de todo).
    this.moonMat = psxBasic({ color: MOON.getHex(), fog: false });
    this.moon = new THREE.Mesh(new THREE.CircleGeometry(9, 10), this.moonMat);
    this.moon.position.set(-60, 80, -150);
    this.moon.lookAt(0, 0, 0);
    scene.add(this.moon);

    // Lluvia: segmentos cortos en una caja que sigue a la camara.
    const drops = 600;
    this.rainPos = new Float32Array(drops * 6);
    for (let i = 0; i < drops; i++) this.resetDrop(i, Math.random() * 24);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(this.rainPos, 3));
    this.rainMat = new THREE.LineBasicMaterial({ color: "#7d8691", transparent: true, opacity: 0 });
    this.rain = new THREE.LineSegments(geo, this.rainMat);
    this.rain.frustumCulled = false;
    scene.add(this.rain);
  }

  private resetDrop(i: number, y: number): void {
    const x = (Math.random() - 0.5) * 30;
    const z = (Math.random() - 0.5) * 30;
    const o = i * 6;
    this.rainPos[o] = x;
    this.rainPos[o + 1] = y;
    this.rainPos[o + 2] = z;
    this.rainPos[o + 3] = x + 0.04;
    this.rainPos[o + 4] = y - 0.7;
    this.rainPos[o + 5] = z;
  }

  /** Cuanto empeoro la noche (llega suavizado). `instant` salta sin transicion. */
  setDread(d: number, instant = false): void {
    this.dreadTarget = d;
    if (instant) this.dread = d;
  }

  get current(): number {
    return this.dread;
  }

  setWeather(w: Weather): void {
    this.weather = w;
  }

  /** Tinte rojo para el filtro retro (sube con la noche; la final es la mas roja). */
  get tint(): number {
    return this.dread >= 0.99 ? 0.32 : this.dread * 0.2;
  }

  update(dt: number, center: THREE.Vector3): void {
    this.dread += (this.dreadTarget - this.dread) * Math.min(1, dt * DREAD_EASE);
    if (Math.abs(this.dreadTarget - this.dread) < 0.001) this.dread = this.dreadTarget;
    const murkTarget = this.weather === "fog" ? 1 : this.weather === "rain" ? 0.5 : 0;
    this.murk += (murkTarget - this.murk) * Math.min(1, dt * 0.5);
    const rainTarget = this.weather === "rain" ? 1 : 0;
    this.rainAmount += (rainTarget - this.rainAmount) * Math.min(1, dt * 0.8);

    const d = this.dread;
    const final = Math.max(0, (d - 0.85) / 0.15);
    this.bg.copy(FOG_OPEN).lerp(FOG_LATE, Math.min(1, d / 0.85)).lerp(FOG_FINAL, final);
    this.fog.color.copy(this.bg);
    this.fog.density = 0.03 + d * 0.022 + this.murk * 0.025;

    const moonColor = MOON.clone().lerp(MOON_RED, final);
    this.moonMat.color.copy(moonColor).multiplyScalar(1 - this.murk * 0.6);
    this.moonLight.color.copy(moonColor);
    this.moonLight.intensity = 1.1 * (1 - d * 0.45) * (1 - this.murk * 0.4) + final * 0.6;
    this.hemi.intensity = 2.2 * (1 - d * 0.35);
    this.moon.position.set(center.x - 60, 80, center.z - 150);

    if (this.rainAmount > 0.01) {
      const fall = dt * 24;
      for (let i = 0; i < this.rainPos.length / 6; i++) {
        const o = i * 6;
        this.rainPos[o + 1] -= fall;
        this.rainPos[o + 4] -= fall;
        if (this.rainPos[o + 4] < -2) this.resetDrop(i, 16 + Math.random() * 6);
      }
      this.rain.geometry.getAttribute("position").needsUpdate = true;
      this.rain.position.set(center.x, center.y - 4, center.z);
    }
    this.rain.visible = this.rainAmount > 0.01;
    this.rainMat.opacity = this.rainAmount * 0.5;
  }
}
