import * as THREE from "three";

// 4-step gradient so toon shading reads as crisp cel bands.
const gradient = new THREE.DataTexture(new Uint8Array([96, 165, 220, 255]), 4, 1, THREE.RedFormat);
gradient.minFilter = THREE.NearestFilter;
gradient.magFilter = THREE.NearestFilter;
gradient.needsUpdate = true;

/** Dark ink used for the inverted-hull cartoon outline. */
const OUTLINE_COLOR = 0x241a2e;
const outlineMat = new THREE.MeshBasicMaterial({ color: OUTLINE_COLOR, side: THREE.BackSide });

const toonCache = new Map<string, THREE.MeshToonMaterial>();

/** Cel-shaded material, cached per color so draw calls batch. */
export function toon(color: THREE.ColorRepresentation): THREE.MeshToonMaterial {
  const key = new THREE.Color(color).getHexString();
  let mat = toonCache.get(key);
  if (!mat) {
    mat = new THREE.MeshToonMaterial({ color: new THREE.Color(color), gradientMap: gradient });
    toonCache.set(key, mat);
  }
  return mat;
}

const emissiveCache = new Map<string, THREE.MeshToonMaterial>();

/** Lit-window / neon material: cel base plus an emissive glow that bloom picks up. */
export function emissiveToon(color: THREE.ColorRepresentation, intensity = 0.9): THREE.MeshToonMaterial {
  const key = `${new THREE.Color(color).getHexString()}:${intensity}`;
  let mat = emissiveCache.get(key);
  if (!mat) {
    const c = new THREE.Color(color);
    mat = new THREE.MeshToonMaterial({
      color: c,
      gradientMap: gradient,
      emissive: c,
      emissiveIntensity: intensity,
    });
    emissiveCache.set(key, mat);
  }
  return mat;
}

/**
 * Splits shared vertices and recomputes normals so the geometry renders with
 * crisp low-poly facets (MeshToonMaterial has no flatShading of its own).
 */
export function flatGeo(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  const g = geometry.toNonIndexed();
  g.computeVertexNormals();
  return g;
}

/**
 * Wraps a mesh with an inverted-hull outline (same geometry, scaled up,
 * back-side dark) for the cartoon silhouette. Returns a group; the lit mesh is
 * `.children[0]`.
 */
export function outlined(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  scale = 1.05,
  castShadow = true,
): THREE.Group {
  const g = new THREE.Group();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = castShadow;
  mesh.receiveShadow = true;
  const outline = new THREE.Mesh(geometry, outlineMat);
  outline.scale.setScalar(scale);
  g.add(mesh, outline);
  return g;
}
