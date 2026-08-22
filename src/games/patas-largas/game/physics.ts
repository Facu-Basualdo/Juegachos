import RAPIER from "@dimforge/rapier3d-compat";

/**
 * Rapier (compat) compila a WASM y hay que inicializarlo una sola vez antes de
 * crear cualquier World. `main.ts` hace `await initPhysics()` antes de arrancar.
 */
let ready: Promise<typeof RAPIER> | null = null;

export function initPhysics(): Promise<typeof RAPIER> {
  if (!ready) ready = RAPIER.init().then(() => RAPIER);
  return ready;
}

export { RAPIER };
