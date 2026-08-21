import * as THREE from "three";

/**
 * Herramientas de cel-shading para "Descenso Pintado" (ver DESIGN.md). El look
 * de historieta es una decision de *sombreado*: todo solido usa
 * `MeshToonMaterial` (bandas planas via un gradiente escalonado) en vez de PBR.
 *
 * Diferencia con Pizza Express: alla la rampa esta sesgada hacia el claro para
 * que los medios tonos calidos lean como iluminados; aca esta sesgada hacia el
 * oscuro (`pow(t, 1.7)`), asi la mayoria de las superficies caen en las bandas
 * de sombra y la luz se siente racionada.
 */

let cachedGradient: THREE.DataTexture | null = null;

/** Rampa dura de N pasos, sesgada al oscuro: la luz cuesta. */
export function toonGradient(steps = 4): THREE.DataTexture {
  if (cachedGradient) return cachedGradient;
  const data = new Uint8Array(steps);
  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1);
    data[i] = Math.round(Math.pow(t, 1.7) * 255);
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

/** Material cel-shaded en el color dado, con la rampa compartida. */
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

/** Material sin luz (lamparas, glifos, chispas), opcionalmente aditivo. */
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
