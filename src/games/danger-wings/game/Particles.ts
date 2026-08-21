import * as THREE from "three";

interface Spark {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  life: number;
  maxLife: number;
}

/**
 * Tiny fire-and-forget spark pool for the relic-collect burst and the death
 * shatter. Cosmetic only — never touches gameplay state.
 */
export class Particles {
  readonly object = new THREE.Group();
  private readonly pool: Spark[] = [];

  private static readonly GEO = new THREE.TetrahedronGeometry(0.09, 0);

  burst(pos: THREE.Vector3, color: number, count: number, speed = 4): void {
    for (let i = 0; i < count; i++) {
      const mat = new THREE.MeshStandardMaterial({
        color,
        emissive: new THREE.Color(color),
        emissiveIntensity: 1.5,
        roughness: 0.4,
      });
      const mesh = new THREE.Mesh(Particles.GEO, mat);
      mesh.position.copy(pos);
      const dir = new THREE.Vector3(
        (Math.random() - 0.5) * 2,
        (Math.random() - 0.5) * 2,
        (Math.random() - 0.5) * 1.2
      ).normalize();
      const s = speed * (0.4 + Math.random() * 0.9);
      const maxLife = 0.5 + Math.random() * 0.5;
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
      p.vel.y -= 9 * dt; // gravity
      p.mesh.position.addScaledVector(p.vel, dt);
      p.mesh.rotation.x += dt * 8;
      p.mesh.rotation.y += dt * 6;
      const k = p.life / p.maxLife;
      p.mesh.scale.setScalar(k);
      (p.mesh.material as THREE.MeshStandardMaterial).opacity = k;
      (p.mesh.material as THREE.MeshStandardMaterial).transparent = true;
    }
  }
}
