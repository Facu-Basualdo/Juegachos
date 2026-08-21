import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

/**
 * Blender-authored GLBs (see tools/blender/golfball.py and flag.py).
 * Everything is optional: missing assets degrade to primitives so gameplay
 * never depends on them.
 */
export interface ModelSet {
  ball?: THREE.Object3D;
  flag?: THREE.Object3D;
  lantern?: THREE.Object3D;
  barrel?: THREE.Object3D;
  windmill?: THREE.Object3D;
}

function load(loader: GLTFLoader, url: string): Promise<THREE.Object3D | undefined> {
  return new Promise((resolve) => {
    loader.load(
      url,
      (gltf) => resolve(gltf.scene),
      undefined,
      () => resolve(undefined),
    );
  });
}

export async function loadModels(): Promise<ModelSet> {
  const loader = new GLTFLoader();
  const [ball, flag, lantern, barrel, windmill] = await Promise.all([
    load(loader, "/models/mini-golf/golfball.glb"),
    load(loader, "/models/mini-golf/flag.glb"),
    load(loader, "/models/mini-golf/lantern.glb"),
    load(loader, "/models/mini-golf/barrel.glb"),
    load(loader, "/models/mini-golf/windmill.glb"),
  ]);
  return { ball, flag, lantern, barrel, windmill };
}
