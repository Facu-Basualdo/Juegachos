import * as THREE from "three";
import { getPuffTexture } from "./dotTexture";
import { Particles } from "./Particles";
import type { ModelSet } from "./Models";
import { toonify, type EmissiveMaterial } from "./toon";
import {
  ACTIVE_TIME,
  CELL_WIDTH,
  DISSIPATE_TIME,
  ERUPT_LEAD,
  FLOOR_Y,
  STEAM_COLOR,
  STEAM_KILL_HEIGHT,
  STEAM_VISUAL_HEIGHT,
  VENT_KILL_HALF,
  WARNING_COLOR,
} from "./constants";

export type VentState = "idle" | "warning" | "active" | "dissipate";

// Cartoon smoke puffs. Size is a world-space diameter, kept ~= the kill-zone
// width (2*VENT_KILL_HALF ~= 1.6) so a puff isn't wider than the actual danger.
const STEAM_PARTICLES = 46;
const STEAM_OPACITY = 0.95;
const STEAM_SIZE = 0.95;
const grilleGeo = new THREE.BoxGeometry(CELL_WIDTH * 0.88, 0.14, 1.3);
const warnCol = new THREE.Color(WARNING_COLOR);

// --- Danger telegraph geometry (exact lethal column, shown before/while a jet
// is live so the kill zone is never invisible). Width = the true kill band. ---
const KILL_WIDTH = VENT_KILL_HALF * 2;
const footprintGeo = new THREE.BoxGeometry(KILL_WIDTH, 0.06, 1.5);
const pillarGeo = new THREE.BoxGeometry(KILL_WIDTH, STEAM_KILL_HEIGHT, 0.5);

/**
 * One floor vent. Three timed states drive the danger:
 * - `warning`: the grille glows red and the point light pulses, chispas hiss out.
 * - `active`: a dense vertical steam jet (THREE.Points) is live and LETHAL up to
 *   STEAM_KILL_HEIGHT (a narrow, fair kill box, slightly inside the visual jet).
 * - `dissipate`: the jet lifts off and fades, blocking vision but dealing no damage.
 * The vent owns its own meshes/light/particles and reports whether it currently
 * kills a player box via `hits()`.
 */
export class SteamVent {
  readonly x: number;
  private state: VentState = "idle";
  private timer = 0;
  private warnTime = 1;
  private activeTime = ACTIVE_TIME;
  private ventClock = 0; // for jet turbulence
  private eruptLead = 0; // non-lethal blast-up window at the start of active

  /** Grille materials tinted emissive-red during the warning / eruption. */
  private readonly grilleMats: EmissiveMaterial[] = [];
  /** Floor decal marking the exact lethal column (glows through every danger state). */
  private readonly footprint: THREE.Mesh;
  private readonly footprintMat: THREE.MeshBasicMaterial;
  /** Translucent red pillar = the full kill volume, faded in during the warning. */
  private readonly pillar: THREE.Mesh;
  private readonly pillarMat: THREE.MeshBasicMaterial;
  private readonly light: THREE.PointLight;
  private readonly steam: THREE.Points;
  private readonly steamMat: THREE.PointsMaterial;
  private readonly sy: Float32Array; // per-particle height
  private readonly sBaseX: Float32Array; // per-particle x offset from vent centre
  private readonly svy: Float32Array; // per-particle rise speed
  private readonly sPhase: Float32Array;
  private readonly steamPos: Float32Array;
  private readonly particles: Particles;
  private readonly onErupt: () => void;

  constructor(
    scene: THREE.Scene,
    particles: Particles,
    x: number,
    models: ModelSet,
    gradientMap: THREE.Texture | undefined,
    onErupt: () => void,
  ) {
    this.x = x;
    this.particles = particles;
    this.onErupt = onErupt;

    // Cast-iron grille (model or fallback box). Cel-shade it, then take fresh
    // per-vent materials and prime them for the red warning glow. `toonify`
    // builds new materials, so vents don't share (safe per-vent tinting).
    let grille: THREE.Object3D;
    if (models.vent) {
      grille = models.vent.clone(true);
      grille.position.set(x, FLOOR_Y + 0.01, 0.2);
    } else {
      const mat = new THREE.MeshStandardMaterial({ color: 0x3a2c22, metalness: 0.85, roughness: 0.55 });
      grille = new THREE.Mesh(grilleGeo, mat);
      grille.position.set(x, FLOOR_Y + 0.07, 0.2);
    }
    if (gradientMap) toonify(grille, gradientMap);
    grille.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mat = mesh.material as EmissiveMaterial;
      const own = gradientMap ? mat : mat.clone(); // ensure per-vent materials
      own.emissive = warnCol.clone();
      own.emissiveIntensity = 0;
      mesh.material = own;
      this.grilleMats.push(own);
    });
    scene.add(grille);

    // Danger telegraph. Both meshes render as pure additive glows (no ink outline
    // — `outlineParameters.visible = false` keeps OutlineEffect from drawing a
    // hard contour) so they read as light on the floor / a hazy pillar, not props.
    this.footprintMat = new THREE.MeshBasicMaterial({
      color: warnCol.clone(),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.footprintMat.userData.outlineParameters = { visible: false };
    this.footprint = new THREE.Mesh(footprintGeo, this.footprintMat);
    this.footprint.position.set(x, FLOOR_Y + 0.05, 0.2);
    this.footprint.visible = false;
    scene.add(this.footprint);

    this.pillarMat = new THREE.MeshBasicMaterial({
      color: warnCol.clone(),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.pillarMat.userData.outlineParameters = { visible: false };
    this.pillar = new THREE.Mesh(pillarGeo, this.pillarMat);
    this.pillar.position.set(x, STEAM_KILL_HEIGHT / 2, 0.05);
    this.pillar.visible = false;
    scene.add(this.pillar);

    this.light = new THREE.PointLight(WARNING_COLOR, 0, 6, 2);
    this.light.position.set(x, FLOOR_Y + 0.5, 0.8);
    scene.add(this.light);

    // Steam jet: a persistent column of points that continuously rises and wraps
    // while active, then lifts off and fades during dissipate.
    this.sy = new Float32Array(STEAM_PARTICLES);
    this.sBaseX = new Float32Array(STEAM_PARTICLES);
    this.svy = new Float32Array(STEAM_PARTICLES);
    this.sPhase = new Float32Array(STEAM_PARTICLES);
    this.steamPos = new Float32Array(STEAM_PARTICLES * 3);
    for (let i = 0; i < STEAM_PARTICLES; i++) {
      this.sy[i] = Math.random() * STEAM_VISUAL_HEIGHT;
      // Puff centres stay inside the kill band; the sprite radius adds the small
      // generous overhang so the visible edge ~= VENT_KILL_HALF (fair to read).
      this.sBaseX[i] = (Math.random() - 0.5) * VENT_KILL_HALF * 0.85;
      this.svy[i] = 4.5 + Math.random() * 3.5;
      this.sPhase[i] = Math.random() * Math.PI * 2;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(this.steamPos, 3));
    this.steamMat = new THREE.PointsMaterial({
      size: STEAM_SIZE,
      map: getPuffTexture(),
      color: new THREE.Color(STEAM_COLOR),
      transparent: true,
      opacity: 0,
      // Occlude, don't blend: front puffs hide the ones behind (via alphaTest +
      // depth), so overlapping billows read as solid cartoon smoke instead of a
      // pile of see-through rings.
      alphaTest: 0.5,
      depthWrite: true,
      blending: THREE.NormalBlending,
    });
    this.steam = new THREE.Points(geo, this.steamMat);
    this.steam.position.set(x, 0, 0.2);
    this.steam.frustumCulled = false;
    this.steam.visible = false;
    scene.add(this.steam);
    this.writeSteam();
  }

  get busy(): boolean {
    return this.state !== "idle";
  }

  /** True while this vent is (or is about to become) lethal — warning or active,
   *  but NOT dissipate (which is visual-only, no danger). Used by VentField to
   *  keep a sweeping wave exclusive of other patterns while it's a real threat. */
  get dangerous(): boolean {
    return this.state === "warning" || this.state === "active";
  }

  /** Schedules a warning now, then an eruption. Durations come from difficulty. */
  trigger(warnTime: number, activeTime: number): void {
    this.state = "warning";
    this.timer = warnTime;
    this.warnTime = warnTime;
    this.activeTime = activeTime;
    this.ventClock = 0;
  }

  /** True while the jet is live: the player is dead if its box overlaps the kill
   *  zone (unless invulnerable). Narrower than the visual jet, on purpose. */
  hits(px: number, halfW: number, feetY: number): boolean {
    if (this.state !== "active") return false;
    if (this.eruptLead > 0) return false; // still blasting up — visible but not lethal yet
    if (feetY >= STEAM_KILL_HEIGHT) return false; // hanging high on a wall is safe
    return Math.abs(px - this.x) < VENT_KILL_HALF + halfW;
  }

  /** `dt` is already time-scaled by the caller (overload runs vents 2x). */
  update(dt: number): void {
    if (this.state === "idle") return;
    this.ventClock += dt;
    this.timer -= dt;

    if (this.state === "warning") {
      // Pulsing red glow that intensifies toward the eruption, plus hissing chispas.
      const progress = 1 - this.timer / this.warnTime;
      const pulse = 0.5 + 0.5 * Math.sin(this.ventClock * 26);
      this.glow((0.4 + progress * 1.6) * (0.5 + 0.5 * pulse));
      this.light.intensity = 1.5 + progress * 4 + pulse * 1.2;
      // Telegraph the exact lethal column: a floor decal that brightens toward the
      // eruption plus a pillar that eases in (obvious only in the last moments).
      this.setTelegraph((0.14 + progress * 0.4) * (0.6 + 0.4 * pulse), progress * progress * 0.22);
      if (Math.random() < 0.5) {
        this.particles.burst(this.x + (Math.random() - 0.5) * CELL_WIDTH * 0.5, FLOOR_Y + 0.1, 1, {
          speed: 3.5,
          up: 4 + progress * 3,
          gravity: 22,
          color: warnCol,
        });
      }
      if (this.timer <= 0) this.erupt();
      return;
    }

    if (this.state === "active") {
      if (this.eruptLead > 0) this.eruptLead -= dt;
      this.glow(2.2);
      this.light.intensity = 7;
      this.riseSteam(dt, true);
      // Quick whoosh-in: opacity climbs across the eruption lead so the jet reads
      // as blasting up (and is unmistakably present before it can kill).
      const leadT = Math.min(1, 1 - this.eruptLead / ERUPT_LEAD);
      this.steamMat.opacity = STEAM_OPACITY * (0.4 + 0.6 * leadT);
      this.setTelegraph(0.6, 0);
      if (this.timer <= 0) {
        this.state = "dissipate";
        this.timer = DISSIPATE_TIME;
      }
      return;
    }

    // dissipate: jet lifts off (no wrap), grille cools, cloud thins and blocks vision.
    const t = Math.max(0, this.timer / DISSIPATE_TIME);
    this.glow(2.2 * t);
    this.light.intensity = 7 * t;
    this.setTelegraph(0.6 * t, 0);
    this.riseSteam(dt, false);
    this.steamMat.opacity = STEAM_OPACITY * t;
    this.steamMat.size = STEAM_SIZE + (1 - t) * 0.5; // puff a little as it disperses
    if (this.timer <= 0) this.goIdle();
  }

  private erupt(): void {
    this.state = "active";
    this.timer = this.activeTime;
    this.eruptLead = ERUPT_LEAD;
    this.steam.visible = true;
    this.steamMat.size = STEAM_SIZE;
    // Seed a full-height column at once so the jet is a visible wall from frame 1
    // (it stays non-lethal through ERUPT_LEAD), instead of a slow climb from the
    // floor that could kill before it appeared.
    for (let i = 0; i < STEAM_PARTICLES; i++) this.sy[i] = Math.random() * STEAM_VISUAL_HEIGHT;
    // A violent kick of chispas + a shove of steam.
    this.particles.burst(this.x, FLOOR_Y + 0.2, 14, { speed: 7, up: 9, gravity: 26, color: warnCol });
    this.onErupt();
  }

  private riseSteam(dt: number, wrap: boolean): void {
    for (let i = 0; i < STEAM_PARTICLES; i++) {
      this.sy[i] += this.svy[i] * dt;
      if (this.sy[i] > STEAM_VISUAL_HEIGHT) {
        if (wrap) this.sy[i] = Math.random() * 0.4;
      }
    }
    this.writeSteam();
  }

  private writeSteam(): void {
    for (let i = 0; i < STEAM_PARTICLES; i++) {
      const y = this.sy[i];
      // A nearly-straight column (only a slight organic sway), so the visual
      // tracks the constant-width kill band instead of fanning into a cone.
      const wobble = Math.sin(y * 1.8 + this.sPhase[i] + this.ventClock * 5) * (0.04 + y * 0.015);
      this.steamPos[i * 3] = this.sBaseX[i] * (1 + y * 0.03) + wobble;
      this.steamPos[i * 3 + 1] = y;
      this.steamPos[i * 3 + 2] = (Math.random() - 0.5) * 0.1;
    }
    this.steam.geometry.attributes.position.needsUpdate = true;
  }

  private glow(intensity: number): void {
    for (const m of this.grilleMats) m.emissiveIntensity = intensity;
  }

  /** Drives the two danger-telegraph meshes; either fades to invisible at 0. */
  private setTelegraph(footOpacity: number, pillarOpacity: number): void {
    this.footprintMat.opacity = footOpacity;
    this.footprint.visible = footOpacity > 0.001;
    this.pillarMat.opacity = pillarOpacity;
    this.pillar.visible = pillarOpacity > 0.001;
  }

  private goIdle(): void {
    this.state = "idle";
    this.glow(0);
    this.light.intensity = 0;
    this.steamMat.opacity = 0;
    this.steam.visible = false;
    this.setTelegraph(0, 0);
  }

  reset(): void {
    this.goIdle();
    this.timer = 0;
    this.ventClock = 0;
    this.eruptLead = 0;
  }
}
