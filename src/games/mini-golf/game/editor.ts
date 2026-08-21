import * as THREE from "three";
import type { HoleDef, WallDef, FloorDef, RampDef, BarDef, BumperDef, DecorDef } from "./holes";
import { HOLE_DEFS } from "./holes";

/**
 * Dev-only visual hole editor (never in production; loaded behind
 * `import.meta.env.DEV` + `?edit=N`). Edits a deep copy of the hole def in
 * place over the live game: every change rebuilds the real Course (real
 * physics), the working copy persists in localStorage, and "Copiar JSON"
 * exports a `HoleDef` ready to paste into holes.ts.
 */

export interface EditorApi {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  dom: HTMLElement;
  container: HTMLElement;
  currentDef: () => HoleDef;
  holeIndex: () => number;
  applyDef: (def: HoleDef) => void;
  setEditMode: (on: boolean) => void;
  resetBall: () => void;
}

type ListName = "floors" | "walls" | "ramps" | "bars" | "bumpers" | "decor";
type Sel = { list: ListName | "tee" | "hole"; index: number };

const SNAP = 0.05;
const STORE_PREFIX = "mg:editor:";

function snap(v: number): number {
  return Math.round(v / SNAP) * SNAP;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

export function initEditor(api: EditorApi): void {
  const storeKey = STORE_PREFIX + api.holeIndex();
  let def: HoleDef = loadStored() ?? structuredClone(api.currentDef());
  ensureLists();
  let editMode = true;
  let sel: Sel | null = null;
  let dragging = false;
  const dragOffset = new THREE.Vector2();
  let dragPlaneY = 0;

  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const pickGroup = new THREE.Group();
  api.scene.add(pickGroup);
  const pickMat = new THREE.MeshBasicMaterial({ color: 0xffd23c, transparent: true, opacity: 0, depthWrite: false });
  pickMat.userData.outlineParameters = { visible: false };
  const selMat = new THREE.MeshBasicMaterial({ color: 0xffd23c, transparent: true, opacity: 0.3, depthWrite: false });
  selMat.userData.outlineParameters = { visible: false };

  function loadStored(): HoleDef | null {
    try {
      const raw = localStorage.getItem(storeKey);
      return raw ? (JSON.parse(raw) as HoleDef) : null;
    } catch {
      return null;
    }
  }

  function ensureLists(): void {
    def.floors ??= [];
    def.walls ??= [];
    def.ramps ??= [];
    def.bars ??= [];
    def.bumpers ??= [];
    def.decor ??= [];
  }

  function persist(): void {
    localStorage.setItem(storeKey, JSON.stringify(def));
  }

  let rebuildTimer: number | null = null;
  function requestRebuild(now = false): void {
    persist();
    if (now) {
      if (rebuildTimer !== null) {
        clearTimeout(rebuildTimer);
        rebuildTimer = null;
      }
      api.applyDef(def);
      refreshPicks();
      return;
    }
    if (rebuildTimer !== null) return;
    rebuildTimer = window.setTimeout(() => {
      rebuildTimer = null;
      api.applyDef(def);
      refreshPicks();
    }, 130);
  }

  // ---- pick boxes -------------------------------------------------------

  interface PickInfo {
    sel: Sel;
    mesh: THREE.Mesh;
  }
  let picks: PickInfo[] = [];

  function pieceTransform(s: Sel): { size: [number, number, number]; pos: THREE.Vector3; yaw: number } {
    if (s.list === "tee") return { size: [0.6, 0.12, 0.6], pos: new THREE.Vector3(def.tee.x, 0.06, def.tee.z), yaw: 0 };
    if (s.list === "hole") {
      const y = def.hole.y ?? 0;
      return { size: [0.66, 0.12, 0.66], pos: new THREE.Vector3(def.hole.x, y + 0.06, def.hole.z), yaw: 0 };
    }
    const i = s.index;
    switch (s.list as ListName) {
      case "floors": {
        const f = def.floors[i];
        return { size: [f.w, 0.7, f.d], pos: new THREE.Vector3(f.x, (f.y ?? 0) - 0.35, f.z), yaw: 0 };
      }
      case "walls": {
        const w = def.walls[i];
        const h = w.h ?? 0.4;
        return { size: [w.w, h, w.d], pos: new THREE.Vector3(w.x, h / 2, w.z), yaw: w.yaw ?? 0 };
      }
      case "ramps": {
        const r = def.ramps![i];
        const hyp = Math.hypot(r.len, r.rise);
        return { size: [r.w, 0.4, hyp], pos: new THREE.Vector3(r.x, r.rise / 2 + 0.1, r.z), yaw: r.yaw };
      }
      case "bars": {
        const b = def.bars![i];
        return { size: [b.len, 0.5, 0.3], pos: new THREE.Vector3(b.x, 0.3, b.z), yaw: 0 };
      }
      case "bumpers": {
        const b = def.bumpers![i];
        const r = b.r ?? 0.34;
        return { size: [r * 2.2, 0.6, r * 2.2], pos: new THREE.Vector3(b.x, 0.3, b.z), yaw: 0 };
      }
      case "decor": {
        const d = def.decor![i];
        const s2 = d.scale ?? 1;
        if (d.kind === "lantern") return { size: [0.45, 1.7, 0.6], pos: new THREE.Vector3(d.x, 0.85, d.z), yaw: d.yaw ?? 0 };
        if (d.kind === "barrel") return { size: [0.75, 0.85, 0.75], pos: new THREE.Vector3(d.x, 0.42, d.z), yaw: 0 };
        return { size: [1.9 * s2, 3.0 * s2, 1.9 * s2], pos: new THREE.Vector3(d.x, 1.5 * s2, d.z), yaw: d.yaw ?? 0 };
      }
    }
  }

  function refreshPicks(): void {
    for (const p of picks) {
      p.mesh.geometry.dispose();
      pickGroup.remove(p.mesh);
    }
    picks = [];
    const sels: Sel[] = [
      { list: "tee", index: 0 },
      { list: "hole", index: 0 },
    ];
    for (const list of ["floors", "walls", "ramps", "bars", "bumpers", "decor"] as ListName[]) {
      const arr = def[list] ?? [];
      for (let i = 0; i < arr.length; i++) sels.push({ list, index: i });
    }
    for (const s of sels) {
      const t = pieceTransform(s);
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(...t.size), isSame(s, sel) ? selMat : pickMat);
      mesh.position.copy(t.pos);
      mesh.rotation.y = t.yaw;
      pickGroup.add(mesh);
      picks.push({ sel: s, mesh });
    }
    updatePanel();
  }

  function isSame(a: Sel | null, b: Sel | null): boolean {
    return !!a && !!b && a.list === b.list && a.index === b.index;
  }

  function select(s: Sel | null): void {
    sel = s;
    for (const p of picks) p.mesh.material = isSame(p.sel, sel) ? selMat : pickMat;
    updatePanel();
  }

  // ---- selected item accessors ------------------------------------------

  function selectedItem(): FloorDef | WallDef | RampDef | BarDef | BumperDef | DecorDef | { x: number; z: number; y?: number } | null {
    if (!sel) return null;
    if (sel.list === "tee") return def.tee;
    if (sel.list === "hole") return def.hole;
    return (def[sel.list as ListName] as unknown[])[sel.index] as never;
  }

  function mutate(fn: (item: never) => void): void {
    const item = selectedItem();
    if (!item) return;
    fn(item as never);
    requestRebuild();
  }

  // ---- palette ----------------------------------------------------------

  function dropPoint(): { x: number; z: number } {
    raycaster.setFromCamera(new THREE.Vector2(0, 0), api.camera);
    const t = -api.camera.position.y / raycaster.ray.direction.y;
    if (t > 0) {
      const p = raycaster.ray.origin.clone().addScaledVector(raycaster.ray.direction, t);
      return { x: snap(p.x), z: snap(p.z) };
    }
    return { x: 0, z: 4 };
  }

  const PALETTE: [string, () => Sel][] = [
    ["Pared", () => addTo("walls", { ...dropPoint(), w: 2, d: 0.26, h: 0.4 })],
    ["Pared alta", () => addTo("walls", { ...dropPoint(), w: 2, d: 0.26, h: 1.25 })],
    ["Pared roja", () => addTo("walls", { ...dropPoint(), w: 2, d: 0.26, h: 0.4, color: "red" })],
    ["Bloque", () => addTo("walls", { ...dropPoint(), w: 1.2, d: 1.2, h: 0.5 })],
    ["Diamante 45", () => addTo("walls", { ...dropPoint(), w: 0.55, d: 0.55, h: 0.5, yaw: Math.PI / 4 })],
    ["Piso", () => addTo("floors", { ...dropPoint(), w: 4, d: 4 })],
    ["Green", () => addTo("floors", { ...dropPoint(), w: 4, d: 4, kind: "green" })],
    ["Rampa azul", () => addTo("ramps", { ...dropPoint(), w: 1.2, len: 1.5, rise: 0.6, yaw: 0, kind: "shortcut" })],
    ["Rampa pasto", () => addTo("ramps", { ...dropPoint(), w: 3, len: 1, rise: 0.35, yaw: 0, kind: "slope" })],
    ["Molinete", () => addTo("bars", { ...dropPoint(), len: 3.6, speed: 1.5 })],
    ["Bumper", () => addTo("bumpers", { ...dropPoint() })],
    ["Farol", () => addTo("decor", { ...dropPoint(), kind: "lantern", yaw: 0 })],
    ["Barril", () => addTo("decor", { ...dropPoint(), kind: "barrel" })],
    ["Molino", () => addTo("decor", { ...dropPoint(), kind: "windmill", yaw: Math.PI, scale: 1.5 })],
  ];

  function addTo(list: ListName, item: object): Sel {
    (def[list] as object[]).push(item);
    requestRebuild(true);
    const s: Sel = { list, index: (def[list] as object[]).length - 1 };
    select(s);
    return s;
  }

  // ---- pointer handling (capture phase, so the aim/orbit never sees it) --

  function setNdc(e: PointerEvent): void {
    const rect = api.dom.getBoundingClientRect();
    ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -(((e.clientY - rect.top) / rect.height) * 2 - 1));
  }

  function planeHit(y: number): THREE.Vector3 | null {
    raycaster.setFromCamera(ndc, api.camera);
    const t = (y - raycaster.ray.origin.y) / raycaster.ray.direction.y;
    if (t <= 0) return null;
    return raycaster.ray.origin.clone().addScaledVector(raycaster.ray.direction, t);
  }

  const onDown = (e: PointerEvent): void => {
    if (!editMode) return;
    setNdc(e);
    raycaster.setFromCamera(ndc, api.camera);
    const hits = raycaster.intersectObjects(picks.map((p) => p.mesh), false);
    if (hits.length === 0) return; // empty space: let the camera orbit
    e.stopImmediatePropagation();
    e.preventDefault();
    const pick = picks.find((p) => p.mesh === hits[0].object)!;
    select(pick.sel);
    const item = selectedItem() as { x: number; z: number };
    dragging = true;
    dragPlaneY = pieceTransform(pick.sel).pos.y;
    const hit = planeHit(dragPlaneY);
    if (hit) dragOffset.set(item.x - hit.x, item.z - hit.z);
  };

  const onMove = (e: PointerEvent): void => {
    if (!editMode || !dragging) return;
    e.stopImmediatePropagation();
    setNdc(e);
    const hit = planeHit(dragPlaneY);
    if (!hit || !sel) return;
    mutate((item: { x: number; z: number }) => {
      item.x = snap(hit.x + dragOffset.x);
      item.z = snap(hit.z + dragOffset.y);
    });
    const t = pieceTransform(sel);
    const pick = picks.find((p) => isSame(p.sel, sel));
    if (pick) pick.mesh.position.copy(t.pos);
  };

  const onUp = (e: PointerEvent): void => {
    if (!editMode || !dragging) return;
    e.stopImmediatePropagation();
    dragging = false;
    requestRebuild(true);
  };

  api.dom.addEventListener("pointerdown", onDown, true);
  api.dom.addEventListener("pointermove", onMove, true);
  api.dom.addEventListener("pointerup", onUp, true);

  // ---- keyboard ----------------------------------------------------------

  const onKey = (e: KeyboardEvent): void => {
    if (!editMode || !sel) return;
    const target = e.target as HTMLElement;
    if (target && (target.tagName === "TEXTAREA" || target.tagName === "INPUT")) return;
    const step = e.shiftKey ? 0.25 : 0.05;
    const item = selectedItem() as never as Record<string, number | string | undefined>;
    const has = (k: string) => typeof item[k] === "number" || item[k] === undefined;
    const bump = (k: string, delta: number, min = 0.1) => {
      mutate((it: Record<string, number>) => {
        it[k] = round2(Math.max(min, (it[k] ?? defaults(k)) + delta));
      });
    };
    const defaults = (k: string): number => (k === "h" ? 0.4 : k === "scale" ? 1 : k === "y" ? 0 : k === "r" ? 0.34 : 0);

    switch (e.code) {
      case "KeyQ":
      case "KeyE": {
        if (sel.list === "tee" || sel.list === "hole" || sel.list === "floors" || sel.list === "bumpers") return;
        const d = ((e.code === "KeyQ" ? 15 : -15) * Math.PI) / 180;
        mutate((it: { yaw?: number }) => {
          it.yaw = round2((it.yaw ?? 0) + d);
        });
        break;
      }
      case "KeyJ":
      case "KeyL": {
        const d = (e.code === "KeyL" ? 1 : -1) * step;
        if (sel.list === "bumpers") bump("r", d, 0.15);
        else if (sel.list === "bars") bump("len", d, 0.5);
        else if (sel.list === "decor") bump("scale", d, 0.3);
        else if (has("w")) bump("w", d);
        break;
      }
      case "KeyI":
      case "KeyK": {
        const d = (e.code === "KeyI" ? 1 : -1) * step;
        if (sel.list === "ramps") bump("len", d, 0.4);
        else if (has("d")) bump("d", d);
        break;
      }
      case "KeyU":
      case "KeyO": {
        const d = (e.code === "KeyO" ? 1 : -1) * step;
        if (sel.list === "walls") bump("h", d, 0.1);
        else if (sel.list === "ramps") bump("rise", d, 0.1);
        else if (sel.list === "bars") bump("speed", d, 0.25);
        else if (sel.list === "floors" || sel.list === "hole") {
          mutate((it: { y?: number }) => {
            it.y = round2((it.y ?? 0) + d);
            if (Math.abs(it.y) < 0.01) delete it.y;
          });
        }
        break;
      }
      case "KeyP": {
        if (sel.list === "walls") mutate((it: WallDef) => (it.color = it.color === "red" ? undefined : "red"));
        else if (sel.list === "floors") mutate((it: FloorDef) => (it.kind = it.kind === "green" ? undefined : "green"));
        else if (sel.list === "ramps") mutate((it: RampDef) => (it.kind = it.kind === "shortcut" ? "slope" : "shortcut"));
        break;
      }
      case "KeyC": {
        if (sel.list === "tee" || sel.list === "hole") return;
        const list = sel.list as ListName;
        const copy = structuredClone((def[list] as object[])[sel.index]) as { x: number };
        copy.x = round2(copy.x + 0.6);
        (def[list] as object[]).push(copy);
        requestRebuild(true);
        select({ list, index: (def[list] as object[]).length - 1 });
        break;
      }
      case "Delete":
      case "Backspace": {
        if (sel.list === "tee" || sel.list === "hole") return;
        (def[sel.list as ListName] as object[]).splice(sel.index, 1);
        select(null);
        requestRebuild(true);
        break;
      }
      case "Escape":
        select(null);
        break;
      default:
        return;
    }
    e.preventDefault();
  };
  window.addEventListener("keydown", onKey);

  // ---- panel -------------------------------------------------------------

  const style = document.createElement("style");
  style.textContent = `
    .mg-editor { position: fixed; top: 12px; right: 12px; width: 250px; z-index: 35;
      background: rgba(255,252,240,0.95); border: 2px solid #2a2419; border-radius: 12px;
      padding: 10px; font: 11px/1.45 Consolas, monospace; color: #2a2419; user-select: none; }
    .mg-editor h3 { font-size: 12px; letter-spacing: 1px; margin-bottom: 6px; }
    .mg-editor .mode { width: 100%; margin-bottom: 6px; }
    .mg-editor .pal { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; margin-bottom: 6px; }
    .mg-editor button { font: inherit; background: #fffdf6; border: 1px solid #2a2419; border-radius: 6px;
      padding: 3px 6px; cursor: pointer; }
    .mg-editor button:hover { background: #ffe9b3; }
    .mg-editor .info { min-height: 40px; background: #f4eedd; border-radius: 6px; padding: 5px 7px; margin-bottom: 6px; white-space: pre; }
    .mg-editor textarea { width: 100%; height: 56px; font: 10px Consolas, monospace; margin: 4px 0; }
    .mg-editor .row { display: flex; gap: 4px; margin-bottom: 4px; }
    .mg-editor .row button { flex: 1; }
    .mg-editor .keys { font-size: 10px; opacity: 0.8; }
  `;
  document.head.appendChild(style);

  const panel = document.createElement("div");
  panel.className = "mg-editor";
  panel.innerHTML = `<h3>EDITOR · HOYO ${api.holeIndex() + 1}</h3>`;

  const modeBtn = document.createElement("button");
  modeBtn.className = "mode";
  panel.appendChild(modeBtn);

  const pal = document.createElement("div");
  pal.className = "pal";
  for (const [label, add] of PALETTE) {
    const b = document.createElement("button");
    b.textContent = label;
    b.addEventListener("click", () => {
      if (editMode) add();
    });
    pal.appendChild(b);
  }
  panel.appendChild(pal);

  const info = document.createElement("div");
  info.className = "info";
  panel.appendChild(info);

  const row1 = document.createElement("div");
  row1.className = "row";
  const copyBtn = document.createElement("button");
  copyBtn.textContent = "Copiar JSON";
  copyBtn.addEventListener("click", () => {
    const json = JSON.stringify(def, null, 2);
    io.value = json;
    navigator.clipboard?.writeText(json).catch(() => {});
    copyBtn.textContent = "Copiado";
    setTimeout(() => (copyBtn.textContent = "Copiar JSON"), 900);
  });
  const loadBtn = document.createElement("button");
  loadBtn.textContent = "Cargar JSON";
  loadBtn.addEventListener("click", () => {
    try {
      def = JSON.parse(io.value) as HoleDef;
      ensureLists();
      select(null);
      requestRebuild(true);
    } catch {
      loadBtn.textContent = "JSON invalido";
      setTimeout(() => (loadBtn.textContent = "Cargar JSON"), 1200);
    }
  });
  row1.append(copyBtn, loadBtn);
  panel.appendChild(row1);

  const io = document.createElement("textarea");
  io.spellcheck = false;
  panel.appendChild(io);

  const row2 = document.createElement("div");
  row2.className = "row";
  const ballBtn = document.createElement("button");
  ballBtn.textContent = "Pelota al tee";
  ballBtn.addEventListener("click", () => api.resetBall());
  const resetBtn = document.createElement("button");
  resetBtn.textContent = "Reiniciar hoyo";
  resetBtn.addEventListener("click", () => {
    localStorage.removeItem(storeKey);
    def = structuredClone(HOLE_DEFS[api.holeIndex()]);
    ensureLists();
    select(null);
    requestRebuild(true);
  });
  row2.append(ballBtn, resetBtn);
  panel.appendChild(row2);

  const keys = document.createElement("div");
  keys.className = "keys";
  keys.innerHTML =
    "Click pieza: elegir - arrastrar: mover<br>" +
    "Q/E rotar - J/L ancho - I/K largo<br>" +
    "U/O alto (piso: elevar) - P variante<br>" +
    "C duplicar - Supr borrar - Esc soltar<br>" +
    "Shift = pasos grandes - drag afuera: camara";
  panel.appendChild(keys);
  api.container.appendChild(panel);

  function setMode(on: boolean): void {
    editMode = on;
    api.setEditMode(on);
    pickGroup.visible = on;
    modeBtn.textContent = on ? "MODO: EDITAR (click para probar)" : "MODO: PROBAR (click para editar)";
  }
  modeBtn.addEventListener("click", () => setMode(!editMode));

  function updatePanel(): void {
    if (!sel) {
      info.textContent = "Nada seleccionado.\nClick en una pieza del mapa.";
      return;
    }
    const item = selectedItem() as Record<string, unknown>;
    const parts = Object.entries(item)
      .map(([k, v]) => `${k}: ${typeof v === "number" ? round2(v) : v}`)
      .join("  ");
    const name = sel.list === "tee" || sel.list === "hole" ? sel.list : `${sel.list}[${sel.index}]`;
    info.textContent = `${name}\n${parts}`;
  }

  setMode(true);
  requestRebuild(true);
}
