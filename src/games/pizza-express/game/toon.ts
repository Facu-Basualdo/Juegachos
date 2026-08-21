import * as THREE from "three";

/**
 * Cel-shading toolkit for the "Golden Hour Delivery" look (see DESIGN.md): the
 * cartoon feel is a *shading* choice, so every solid prop uses `MeshToonMaterial`
 * (flat banded light/shadow via a stepped gradient map) instead of glossy PBR.
 * Emissive markers / glows use `MeshBasicMaterial` and stay unlit.
 */

let cachedGradient: THREE.DataTexture | null = null;

/** A hard N-step ramp texture that gives toon shading its flat bands, biased
 * bright so the warm mid-tones read as lit (no muddy shadows). */
export function toonGradient(steps = 4): THREE.DataTexture {
  if (cachedGradient) return cachedGradient;
  const data = new Uint8Array(steps);
  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1);
    data[i] = Math.round(Math.pow(t, 0.65) * 255);
  }
  const tex = new THREE.DataTexture(data, steps, 1, THREE.RedFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  cachedGradient = tex;
  return tex;
}

interface ToonOptions {
  emissive?: THREE.ColorRepresentation;
  emissiveIntensity?: number;
  transparent?: boolean;
  opacity?: number;
  side?: THREE.Side;
}

/** A cel-shaded material in the given colour, using the shared gradient ramp. */
export function toonMat(color: THREE.ColorRepresentation, opts: ToonOptions = {}): THREE.MeshToonMaterial {
  return new THREE.MeshToonMaterial({
    color,
    gradientMap: toonGradient(),
    emissive: opts.emissive ?? 0x000000,
    emissiveIntensity: opts.emissiveIntensity ?? 1,
    transparent: opts.transparent ?? false,
    opacity: opts.opacity ?? 1,
    side: opts.side ?? THREE.FrontSide,
  });
}

/** An unlit, optionally additive glow material (order markers, sun, sparks). */
export function glowMat(color: THREE.ColorRepresentation, opacity = 1, additive = false): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: opacity < 1 || additive,
    opacity,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    depthWrite: !additive,
    fog: !additive,
  });
}
