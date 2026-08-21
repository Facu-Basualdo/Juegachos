import * as THREE from "three";

interface Spark {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  life: number;
  maxLife: number;
}

/**
 * Pool chiquito de chispas fire-and-forget: el estallido del acierto contra el
 * escalon, el raspon del error y el estallido final contra las puas. Solo
 * cosmetico, nunca toca el estado del juego.
 */
export class Particles {
  readonly object = new THREE.Group();
  private readonly pool: Spark[] = [];

  private static readonly GEO = new THREE.TetrahedronGeometry(0.08, 0);

  burst(pos: THREE.Vector3, color: number, count: number, speed = 4): void {
    for (let i = 0; i < count; i++) {
      const mat = new THREE.MeshStandardMaterial({
        color,
        emissive: new THREE.Color(color),
        emissiveIntensity: 1.6,
        roughness: 0.45,
      });
      const mesh = new THREE.Mesh(Particles.GEO, mat);
      mesh.position.copy(pos);
      const dir = new THREE.Vector3(
        (Math.random() - 0.5) * 2,
        Math.random() * 1.4,
        (Math.random() - 0.5) * 1.6,
      ).normalize();
      const s = speed * (0.4 + Math.random() * 0.9);
      const maxLife = 0.4 + Math.random() * 0.45;
      this.object.add(mesh);
      this.pool.push({ mesh, vel: dir.multiplyScalar(s), life: maxLife, maxLife });
    }
  }

  reset(): void {
    for (const p of this.pool) {
      this.object.remove(p.mesh);
      (p.mesh.material as THREE.Material).dispose();
    }
    this.pool.length = 0;
  }

  update(dt: number): void {
    for (let i = this.pool.length - 1; i >= 0; i--) {
      const p = this.pool[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.object.remove(p.mesh);
        (p.mesh.material as THREE.Material).dispose();
        this.pool.splice(i, 1);
        continue;
      }
      p.vel.y -= 11 * dt; // gravedad
      p.mesh.position.addScaledVector(p.vel, dt);
      p.mesh.rotation.x += dt * 9;
      p.mesh.rotation.y += dt * 7;
      const k = p.life / p.maxLife;
      p.mesh.scale.setScalar(k);
      const mat = p.mesh.material as THREE.MeshStandardMaterial;
      mat.transparent = true;
      mat.opacity = k;
    }
  }
}
