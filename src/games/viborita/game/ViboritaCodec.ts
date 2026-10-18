import type { VbSnap } from "./ViboritaProtocol";

/**
 * Decodificador del snapshot BINARIO de Viborita. El formato y el codificador viven en
 * `server/src/games/viborita-codec.ts` (por la regla de decoupling se duplica: si
 * cambia alla, cambia aca). Devuelve el mismo `VbSnap` que antes viajaba en JSON, asi
 * el resto del cliente no se entera del cambio: `s` sigue siendo
 * `[id, dueno, x, y, angulo*1000, masa*10, turbo]` por cabeza.
 */

export const CODEC_VERSION = 1;

export function decodeSnap(data: ArrayBuffer | ArrayBufferView): VbSnap | null {
  const view =
    data instanceof ArrayBuffer
      ? new DataView(data)
      : new DataView(data.buffer, data.byteOffset, data.byteLength);
  let o = 0;
  if (view.byteLength < 14 || view.getUint8(o) !== CODEC_VERSION) return null;
  o += 1;
  const t = view.getUint32(o, true);
  o += 4;
  const n = view.getUint32(o, true);
  o += 4;
  const a = view.getFloat32(o, true);
  o += 4;
  const flags = view.getUint8(o);
  o += 1;
  const snap: VbSnap = { t, s: [], n, a };
  if (flags & 1) {
    snap.cx = view.getUint16(o, true);
    snap.cy = view.getUint16(o + 2, true);
    o += 4;
  }

  const heads = view.getUint16(o, true);
  o += 2;
  const s = snap.s;
  for (let i = 0; i < heads; i++) {
    s.push(
      view.getUint32(o, true),
      view.getUint16(o + 4, true),
      view.getUint16(o + 6, true) / 10,
      view.getUint16(o + 8, true) / 10,
      (view.getInt16(o + 10, true) / 10_000) * 1000,
      view.getFloat32(o + 12, true) * 10,
      view.getUint8(o + 16),
    );
    o += 17;
  }

  const keyCount = view.getUint16(o, true);
  o += 2;
  if (keyCount > 0) {
    const k: number[] = [];
    for (let i = 0; i < keyCount; i++) {
      const id = view.getUint32(o, true);
      const count = view.getUint16(o + 4, true);
      o += 6;
      k.push(id, count);
      for (let j = 0; j < count; j++) {
        k.push(view.getUint16(o, true), view.getUint16(o + 2, true));
        o += 4;
      }
    }
    snap.k = k;
  }

  const adds = view.getUint16(o, true);
  o += 2;
  if (adds > 0) {
    const pa: number[] = [];
    for (let i = 0; i < adds; i++) {
      pa.push(
        view.getUint32(o, true),
        view.getUint16(o + 4, true),
        view.getUint16(o + 6, true),
        view.getUint8(o + 8),
        view.getUint16(o + 9, true),
      );
      o += 11;
    }
    snap.pa = pa;
  }

  const dels = view.getUint16(o, true);
  o += 2;
  if (dels > 0) {
    const pd: number[] = [];
    for (let i = 0; i < dels; i++) {
      pd.push(view.getUint32(o, true));
      o += 4;
    }
    snap.pd = pd;
  }
  return snap;
}
