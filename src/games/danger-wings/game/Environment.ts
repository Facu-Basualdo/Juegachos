import * as THREE from "three";
import {
  SIDE_X,
  CEIL_Y,
  FLOOR_Y,
  WALL_THICKNESS,
  BACKDROP_URL,
  COLOR_TORCH,
  COLOR_EMBER,
  COLOR_MOON,
} from "./constants";

interface Torch {
  light: THREE.PointLight;
  flame: THREE.Mesh;
  phase: number;
  freq: number;
  base: number;
}

/**
 * The gothic scenery around and behind the iron cell: a painted backdrop (an
 * AI image dropped in `BACKDROP_URL`, else a procedural gothic canvas), wall
 * torches with flickering light, drifting embers and hanging chains. This is
 * what turns the box into a place (see DESIGN.md).
 */
export class Environment {
  readonly object = new THREE.Group();
  readonly lights = new THREE.Group();

  private readonly torches: Torch[] = [];
  private readonly backdropMat: THREE.MeshBasicMaterial;
  private embers!: THREE.Points;
  private emberVel!: Float32Array;
  private readonly emberBounds = { x: SIDE_X + 3, yTop: CEIL_Y + 3, yBot: FLOOR_Y - 2, z: 1.2 };

  constructor() {
    // Painted backdrop plane, well behind the cell, big enough for any aspect.
    // MeshBasic + toneMapped/fog false so a painterly image stays crisp.
    this.backdropMat = new THREE.MeshBasicMaterial({
      map: Environment.buildBackdropCanvas(),
      toneMapped: false,
      fog: false,
      depthWrite: false,
    });
    // Plane aspect matches the painted backdrop (2048x1136 ~ 1.803) so a
    // dropped-in image is not distorted; sized to cover the viewport at any aspect.
    const backdrop = new THREE.Mesh(new THREE.PlaneGeometry(50, 27.73), this.backdropMat);
    backdrop.position.set(0, 0, -8);
    this.object.add(backdrop);

    this.buildVignette();
    this.buildChains();
    this.buildTorches();
    this.buildEmbers();
  }

  // --- Play-area vignette scrim ---------------------------------------------
  /**
   * A soft dark scrim sitting between the backdrop and the cell. It only dims
   * what is *behind* it (the painted backdrop shows lighter through the open
   * cell) because the bird, spikes and stone frame are opaque and nearer the
   * camera — so the crow keeps full contrast against a darkened middle-ground
   * while the rich painted margins are untouched. Works for any backdrop image.
   */
  private buildVignette(): void {
    const s = 256;
    const canvas = document.createElement("canvas");
    canvas.width = s;
    canvas.height = s;
    const ctx = canvas.getContext("2d")!;
    const g = ctx.createRadialGradient(s / 2, s / 2, s * 0.1, s / 2, s / 2, s * 0.5);
    g.addColorStop(0, "rgba(6, 5, 11, 0.68)");
    g.addColorStop(0.55, "rgba(6, 5, 11, 0.38)");
    g.addColorStop(1, "rgba(6, 5, 11, 0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
    const mat = new THREE.MeshBasicMaterial({
      map: new THREE.CanvasTexture(canvas),
      transparent: true,
      depthWrite: false,
      fog: false,
      toneMapped: false,
    });
    const scrim = new THREE.Mesh(new THREE.PlaneGeometry(11, 14), mat);
    scrim.position.set(0, -0.3, -1.6); // slightly low so the moon keeps its glow up top
    this.object.add(scrim);
  }

  // --- Torches ---------------------------------------------------------------
  private buildTorches(): void {
    const bracketMat = new THREE.MeshStandardMaterial({ color: 0x1a1622, roughness: 0.7, metalness: 0.6 });
    const flameMat = new THREE.MeshBasicMaterial({ color: COLOR_TORCH, toneMapped: false, transparent: true, opacity: 0.95 });

    // Sconces mounted on the OUTER stone frame, in the margins beside the cell,
    // so they flank the oubliette without ever intruding on the play area. The
    // outer wall face is at SIDE_X + WALL_THICKNESS; the torches sit just past it.
    const outX = SIDE_X + WALL_THICKNESS + 0.12;
    const spots: Array<[number, number]> = [
      [-outX, CEIL_Y - 1.2],
      [outX, CEIL_Y - 1.2],
      [-outX, FLOOR_Y + 1.6],
      [outX, FLOOR_Y + 1.6],
    ];
    for (let i = 0; i < spots.length; i++) {
      const [x, y] = spots[i];
      const outward = x < 0 ? -1 : 1; // brackets point away from the cell

      const group = new THREE.Group();
      group.position.set(x, y, 0.1);

      // Iron bracket.
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.5, 6), bracketMat);
      arm.rotation.z = Math.PI / 2;
      arm.position.set(outward * 0.22, 0, 0);
      group.add(arm);
      const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.07, 0.18, 8), bracketMat);
      cup.position.set(outward * 0.42, 0.06, 0);
      group.add(cup);

      // Teardrop flame.
      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.5, 8), flameMat);
      flame.position.set(outward * 0.42, 0.34, 0);
      group.add(flame);
      const innerFlame = new THREE.Mesh(
        new THREE.ConeGeometry(0.07, 0.3, 8),
        new THREE.MeshBasicMaterial({ color: 0xffe08a, toneMapped: false })
      );
      innerFlame.position.set(outward * 0.42, 0.3, 0.01);
      group.add(innerFlame);

      this.object.add(group);

      const light = new THREE.PointLight(COLOR_TORCH, 6, 6, 2);
      light.position.set(x + outward * 0.42, y + 0.4, 0.6);
      this.lights.add(light);

      this.torches.push({ light, flame, phase: Math.random() * Math.PI * 2, freq: 8 + Math.random() * 6, base: 6 });
    }
  }

  // --- Hanging chains --------------------------------------------------------
  private buildChains(): void {
    const linkMat = new THREE.MeshStandardMaterial({ color: 0x2b2836, roughness: 0.55, metalness: 0.85 });
    const linkGeo = new THREE.TorusGeometry(0.13, 0.045, 6, 10);
    // A few chains descending in the margins, in front of the backdrop.
    const chains: Array<[number, number, number]> = [
      [-(SIDE_X + 1.9), CEIL_Y + 2.5, -3],
      [SIDE_X + 2.3, CEIL_Y + 2.2, -3.5],
      [-(SIDE_X + 3.1), CEIL_Y + 1.5, -4.5],
    ];
    for (const [x, topY, z] of chains) {
      const chain = new THREE.Group();
      const links = 10;
      for (let i = 0; i < links; i++) {
        const link = new THREE.Mesh(linkGeo, linkMat);
        link.position.set(x + (Math.random() - 0.5) * 0.04, topY - i * 0.22, z);
        link.rotation.y = (i % 2) * (Math.PI / 2); // alternate links 90 deg
        chain.add(link);
      }
      this.object.add(chain);
    }
  }

  // --- Drifting embers -------------------------------------------------------
  private buildEmbers(): void {
    const count = 90;
    const positions = new Float32Array(count * 3);
    this.emberVel = new Float32Array(count);
    const b = this.emberBounds;
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() * 2 - 1) * b.x;
      positions[i * 3 + 1] = b.yBot + Math.random() * (b.yTop - b.yBot);
      positions[i * 3 + 2] = (Math.random() * 2 - 1) * b.z;
      this.emberVel[i] = 0.25 + Math.random() * 0.55;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color: COLOR_EMBER,
      size: 0.11,
      map: Environment.buildEmberSprite(),
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    this.embers = new THREE.Points(geo, mat);
    this.object.add(this.embers);
  }

  // --- Krea backdrop swap-in -------------------------------------------------
  /**
   * Try to load the painted backdrop; on failure keep the procedural canvas.
   * `maxAnisotropy` (from `renderer.capabilities.getMaxAnisotropy()`) sharpens
   * the texture, which matters because the plane fills the screen and a low-res
   * source gets magnified.
   */
  loadBackdrop(maxAnisotropy = 1): void {
    new THREE.TextureLoader().load(
      BACKDROP_URL,
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = maxAnisotropy;
        tex.generateMipmaps = true;
        tex.minFilter = THREE.LinearMipmapLinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.needsUpdate = true;
        const prev = this.backdropMat.map;
        this.backdropMat.map = tex;
        this.backdropMat.needsUpdate = true;
        prev?.dispose();
      },
      undefined,
      () => {
        /* no painted backdrop present — procedural canvas stays. */
      }
    );
  }

  update(dt: number, elapsed: number): void {
    // Torch flicker: layered so no two read in sync.
    for (const t of this.torches) {
      const f = 0.72 + 0.22 * Math.sin(elapsed * t.freq + t.phase) + 0.12 * Math.sin(elapsed * t.freq * 2.7 + t.phase) + (Math.random() - 0.5) * 0.08;
      t.light.intensity = t.base * Math.max(0.35, f);
      t.flame.scale.set(0.9 + f * 0.2, 0.85 + f * 0.35, 1);
    }

    // Embers rise and wrap.
    const pos = this.embers.geometry.getAttribute("position") as THREE.BufferAttribute;
    const b = this.emberBounds;
    for (let i = 0; i < this.emberVel.length; i++) {
      let y = pos.getY(i) + this.emberVel[i] * dt;
      let x = pos.getX(i) + Math.sin(elapsed * 0.8 + i) * 0.12 * dt;
      if (y > b.yTop) {
        y = b.yBot;
        x = (Math.random() * 2 - 1) * b.x;
      }
      pos.setY(i, y);
      pos.setX(i, x);
    }
    pos.needsUpdate = true;
  }

  // --- Procedural gothic backdrop canvas -------------------------------------
  private static buildBackdropCanvas(): THREE.CanvasTexture {
    const w = 1400;
    const h = 900;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d")!;

    // Bruised night sky.
    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, "#0c0a17");
    sky.addColorStop(0.5, "#100b1a");
    sky.addColorStop(1, "#070610");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);

    // Pale bone moon, high and slightly left, with a broad cold corona.
    const mX = w * 0.44;
    const mY = h * 0.26;
    const corona = ctx.createRadialGradient(mX, mY, 20, mX, mY, 420);
    corona.addColorStop(0, "rgba(220, 214, 196, 0.5)");
    corona.addColorStop(0.22, "rgba(150, 152, 168, 0.16)");
    corona.addColorStop(1, "rgba(110, 116, 140, 0)");
    ctx.fillStyle = corona;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#" + new THREE.Color(COLOR_MOON).getHexString();
    ctx.beginPath();
    ctx.arc(mX, mY, 96, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(120, 116, 104, 0.32)";
    for (const [cx, cy, cr] of [[-28, -20, 18], [24, 12, 24], [-10, 36, 13], [36, -30, 11], [8, -6, 9]] as const) {
      ctx.beginPath();
      ctx.arc(mX + cx, mY + cy, cr, 0, Math.PI * 2);
      ctx.fill();
    }

    // Layered cathedral silhouettes with atmospheric perspective: far ranks are
    // paler / bluer, near ranks darker. Ember-red windows on the near towers.
    Environment.drawSpireRank(ctx, w, h, 0.62, 0.32, "#141320", 7, false);
    Environment.drawSpireRank(ctx, w, h, 0.78, 0.5, "#0b0912", 6, true);
    Environment.drawSpireRank(ctx, w, h, 0.98, 0.72, "#050409", 8, true);

    // A rose window glowing in a central near tower.
    const rgX = w * 0.5;
    const rgY = h * 0.66;
    const rose = ctx.createRadialGradient(rgX, rgY, 4, rgX, rgY, 46);
    rose.addColorStop(0, "rgba(210, 60, 60, 0.8)");
    rose.addColorStop(1, "rgba(120, 20, 24, 0)");
    ctx.fillStyle = rose;
    ctx.beginPath();
    ctx.arc(rgX, rgY, 46, 0, Math.PI * 2);
    ctx.fill();

    // Low ground haze.
    const haze = ctx.createLinearGradient(0, h * 0.8, 0, h);
    haze.addColorStop(0, "rgba(30, 24, 40, 0)");
    haze.addColorStop(1, "rgba(40, 30, 52, 0.5)");
    ctx.fillStyle = haze;
    ctx.fillRect(0, h * 0.8, w, h * 0.2);

    // A couple of distant bats.
    ctx.strokeStyle = "rgba(10, 8, 14, 0.7)";
    ctx.lineWidth = 3;
    for (const [bx, by, s] of [[w * 0.62, h * 0.2, 16], [w * 0.68, h * 0.16, 11], [w * 0.3, h * 0.14, 9]] as const) {
      ctx.beginPath();
      ctx.moveTo(bx - s, by);
      ctx.quadraticCurveTo(bx - s * 0.4, by - s * 0.5, bx, by);
      ctx.quadraticCurveTo(bx + s * 0.4, by - s * 0.5, bx + s, by);
      ctx.stroke();
    }

    // Central vignette so the play area (in front) stays readable.
    const vig = ctx.createRadialGradient(w / 2, h * 0.52, h * 0.15, w / 2, h * 0.52, h * 0.62);
    vig.addColorStop(0, "rgba(4, 3, 8, 0.55)");
    vig.addColorStop(1, "rgba(4, 3, 8, 0)");
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, w, h);

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  private static drawSpireRank(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    baseYRatio: number,
    scale: number,
    color: string,
    n: number,
    windows: boolean
  ): void {
    const baseY = h * baseYRatio;
    for (let i = 0; i < n; i++) {
      const cx = (w * (i + 0.5)) / n + (Math.random() - 0.5) * 40;
      const bw = (60 + Math.random() * 70) * scale;
      const bh = (200 + Math.random() * 260) * scale;
      const top = baseY - bh;
      ctx.fillStyle = color;
      ctx.fillRect(cx - bw / 2, top + bw * 0.6, bw, baseY - (top + bw * 0.6));
      ctx.beginPath();
      ctx.moveTo(cx - bw / 2, top + bw * 0.6);
      ctx.lineTo(cx, top - bw * 0.5);
      ctx.lineTo(cx + bw / 2, top + bw * 0.6);
      ctx.closePath();
      ctx.fill();
      if (windows) {
        ctx.fillStyle = "rgba(196, 46, 42, 0.85)";
        const rows = Math.floor(bh / 70);
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < 2; c++) {
            if (Math.random() > 0.45) continue;
            const wx = cx - bw * 0.2 + c * bw * 0.4 - 4;
            const wy = top + bw * 0.95 + r * 62;
            ctx.fillRect(wx, wy, 8 * scale + 2, 16 * scale + 3);
          }
        }
      }
    }
  }

  private static buildEmberSprite(): THREE.CanvasTexture {
    const s = 64;
    const canvas = document.createElement("canvas");
    canvas.width = s;
    canvas.height = s;
    const ctx = canvas.getContext("2d")!;
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, "rgba(255, 220, 160, 1)");
    g.addColorStop(0.4, "rgba(255, 150, 70, 0.7)");
    g.addColorStop(1, "rgba(255, 120, 50, 0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
    return new THREE.CanvasTexture(canvas);
  }
}
