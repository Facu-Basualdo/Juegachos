import * as THREE from "three";

/**
 * Cel-shading toolkit (same technique as Boilerbound, duplicated per the
 * repo's decoupling rule). The cartoon look is a *shading* choice: flat
 * banded light via `MeshToonMaterial` + a hard stepped gradient map, with
 * ink outlines added separately by `OutlineEffect` in Game.
 */

/** A hard N-step ramp texture that gives toon shading its flat bands. */
export function makeToonGradient(steps = 3): THREE.DataTexture {
  const data = new Uint8Array(steps);
  for (let i = 0; i < steps; i++) {
    // Bias the ramp brighter so mid-tones read as sunlit, not muddy.
    const t = i / (steps - 1);
    data[i] = Math.round(Math.pow(t, 0.65) * 255);
  }
  const tex = new THREE.DataTexture(data, steps, 1, THREE.RedFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Replaces every `MeshStandardMaterial` under `root` (the Blender GLBs
 * export PBR) with an equivalent toon material so the models match the
 * cel-shaded course.
 */
export function toonify(root: THREE.Object3D, grad: THREE.Texture): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const src = mesh.material;
    if (Array.isArray(src) || !(src as THREE.Material).type.startsWith("MeshStandard")) return;
    const std = src as THREE.MeshStandardMaterial;
    mesh.material = new THREE.MeshToonMaterial({
      color: std.color.clone(),
      map: std.map ?? null,
      gradientMap: grad,
      emissive: std.emissive.clone(),
      // GLB emission strengths are authored for PBR; clamp so toon glass
      // reads as warm amber instead of blowing out to white.
      emissiveIntensity: Math.min(std.emissiveIntensity, 0.8),
      transparent: std.transparent,
      opacity: std.opacity,
      side: std.side,
    });
  });
}
