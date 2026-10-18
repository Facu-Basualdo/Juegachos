import type { VbSnap } from "../protocol.js";

/**
 * Snapshot de Viborita en BINARIO, cuantizado (como la replicacion de Unreal: cada
 * campo con los bits que necesita, no un texto JSON). Una cabeza ocupa 17 bytes en vez
 * de ~45, y el navegador no tiene que parsear texto 40 veces por segundo.
 *
 * Duplicado en `src/games/viborita/game/ViboritaCodec.ts` (el decodificador): si cambia
 * el formato, tocar los dos lados. `viborita-check.ts` codifica aca y decodifica alla.
 *
 * Little endian. Precisiones: posiciones de cabeza a 0.1 u en uint16 (por eso el mapa
 * no puede pasar de 6553 u de lado: ver el chequeo de `mapRadius` en la config),
 * angulo a 1e-4 rad, masa en float32. Cuerpos y comida en unidades enteras.
 *
 *   u8  version
 *   u32 t            reloj de la simulacion (ms)
 *   u32 n            ultimo input aplicado
 *   f32 a            ms que ya rige
 *   u8  flags        bit0: trae camara de espectador
 *   [u16 cx, u16 cy]
 *   u16 cabezas  x { u32 id, u16 dueno, u16 x*10, u16 y*10, i16 angulo*1e4, f32 masa, u8 turbo }
 *   u16 cuerpos  x { u32 id, u16 puntos, puntos x { u16 x, u16 y } }
 *   u16 altas    x { u32 id, u16 x, u16 y, u8 color, u16 masa*10 }
 *   u16 bajas    x { u32 id }
 */

export const CODEC_VERSION = 1;

const HEAD_BYTES = 17;
const PELLET_BYTES = 11;

/**
 * Codifica el snapshot. Los campos de `snap` vienen como los arma la arena:
 * `s` = `[id, dueno, x, y, angulo*1000, masa*10, turbo]` por cabeza, `k` y `pa`/`pd`
 * planos (ver `VbSnap`).
 */
export function encodeSnap(snap: VbSnap): Buffer {
  const heads = snap.s.length / 7;
  let keyBytes = 0;
  let keyCount = 0;
  const k = snap.k ?? [];
  for (let i = 0; i < k.length; ) {
    const count = k[i + 1];
    keyBytes += 6 + count * 4;
    keyCount++;
    i += 2 + count * 2;
  }
  const adds = (snap.pa?.length ?? 0) / 5;
  const dels = snap.pd?.length ?? 0;
  const hasCam = snap.cx !== undefined && snap.cy !== undefined;

  const size = 1 + 4 + 4 + 4 + 1 + (hasCam ? 4 : 0) + 2 + heads * HEAD_BYTES + 2 + keyBytes + 2 + adds * PELLET_BYTES + 2 + dels * 4;
  const buf = Buffer.allocUnsafe(size);
  let o = 0;
  o = buf.writeUInt8(CODEC_VERSION, o);
  o = buf.writeUInt32LE(Math.max(0, Math.round(snap.t)) >>> 0, o);
  o = buf.writeUInt32LE(snap.n >>> 0, o);
  o = buf.writeFloatLE(snap.a, o);
  o = buf.writeUInt8(hasCam ? 1 : 0, o);
  if (hasCam) {
    o = buf.writeUInt16LE(u16(snap.cx!), o);
    o = buf.writeUInt16LE(u16(snap.cy!), o);
  }

  o = buf.writeUInt16LE(heads, o);
  const s = snap.s;
  for (let i = 0; i < s.length; i += 7) {
    o = buf.writeUInt32LE(s[i] >>> 0, o);
    o = buf.writeUInt16LE(u16(s[i + 1]), o);
    o = buf.writeUInt16LE(u16(s[i + 2] * 10), o);
    o = buf.writeUInt16LE(u16(s[i + 3] * 10), o);
    o = buf.writeInt16LE(clampI16((s[i + 4] / 1000) * 10_000), o);
    o = buf.writeFloatLE(s[i + 5] / 10, o);
    o = buf.writeUInt8(s[i + 6] ? 1 : 0, o);
  }

  o = buf.writeUInt16LE(keyCount, o);
  for (let i = 0; i < k.length; ) {
    const count = k[i + 1];
    o = buf.writeUInt32LE(k[i] >>> 0, o);
    o = buf.writeUInt16LE(count, o);
    for (let j = 0; j < count; j++) {
      o = buf.writeUInt16LE(u16(k[i + 2 + j * 2]), o);
      o = buf.writeUInt16LE(u16(k[i + 3 + j * 2]), o);
    }
    i += 2 + count * 2;
  }

  o = buf.writeUInt16LE(adds, o);
  const pa = snap.pa ?? [];
  for (let i = 0; i < pa.length; i += 5) {
    o = buf.writeUInt32LE(pa[i] >>> 0, o);
    o = buf.writeUInt16LE(u16(pa[i + 1]), o);
    o = buf.writeUInt16LE(u16(pa[i + 2]), o);
    o = buf.writeUInt8(pa[i + 3] & 0xff, o);
    o = buf.writeUInt16LE(u16(pa[i + 4]), o);
  }

  o = buf.writeUInt16LE(dels, o);
  for (const id of snap.pd ?? []) o = buf.writeUInt32LE(id >>> 0, o);
  return buf;
}

function u16(v: number): number {
  const r = Math.round(v);
  return r < 0 ? 0 : r > 0xffff ? 0xffff : r;
}

function clampI16(v: number): number {
  const r = Math.round(v);
  return r < -32768 ? -32768 : r > 32767 ? 32767 : r;
}
