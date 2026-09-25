import { getSupabase } from "../../../shared/supabase";
import { analyzeTake, featuresFromFrames, type Features } from "./analysis";
import { getAudio } from "./audio";
import {
  downsample,
  downsampleFactor,
  muLawDecode,
  muLawEncode,
  normalizeGain,
  trimSilence,
} from "./recorder";
import { takeToBuffer } from "./synth";

/**
 * La biblioteca de la comunidad (el "Workshop" de Imitame): audios que sube la gente y
 * que las salas sortean junto a los sintetizados. Viven en Supabase, tabla
 * `imitame_clips` (`supabase/imitame.sql`).
 *
 * El audio se procesa ENTERO en el navegador antes de subir: se decodifica lo que sea
 * que el navegador sepa leer (mp3, wav, ogg, m4a...), se recortan los silencios de las
 * puntas, se corta a `MAX_CLIP_S`, se baja a ~11 kHz y se guarda como mu-law en base64
 * (~45 KB la fila). Asi la tabla guarda un formato unico que cualquier navegador
 * reproduce, y el archivo original nunca sale de la maquina del que lo sube.
 *
 * Mismo nivel de confianza que el resto de las tablas (anon key + RLS abierta): cualquiera
 * puede subir y borrar. Para una biblioteca de memes entre amigos alcanza.
 */

/** Tope de un audio. La fase de escucha del server dura 3.8s. */
export const MAX_CLIP_S = 3;
const NAME_MAX = 40;
/** Cuantos audios (los mas nuevos) entran al sorteo de una sala. Espeja el server. */
const INDEX_LIMIT = 200;

export interface ClipMeta {
  id: string;
  name: string;
  uploader: string;
  duration: number;
  created_at: string;
}

export interface LoadedClip {
  meta: ClipMeta;
  buffer: AudioBuffer;
  features: Features;
}

export function clipsEnabled(): boolean {
  return getSupabase() !== null;
}

// ---------- Lectura ----------

/** Los audios mas nuevos, sin el audio (para la lista y para el sorteo). */
export async function fetchClipIndex(): Promise<ClipMeta[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data, error } = await sb
    .from("imitame_clips")
    .select("id, name, uploader, duration, created_at")
    .order("created_at", { ascending: false })
    .limit(INDEX_LIMIT);
  if (error) {
    console.warn("[imitame] no se pudo leer la biblioteca (corriste supabase/imitame.sql?)", error.message);
    return [];
  }
  return (data ?? []) as ClipMeta[];
}

const cache = new Map<string, Promise<LoadedClip | null>>();

/** Baja un audio con su referencia ya analizada. Cacheado por pagina. */
export function loadClip(id: string): Promise<LoadedClip | null> {
  let p = cache.get(id);
  if (!p) {
    p = fetchClip(id);
    cache.set(id, p);
  }
  return p;
}

async function fetchClip(id: string): Promise<LoadedClip | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data, error } = await sb
    .from("imitame_clips")
    .select("id, name, uploader, duration, created_at, rate, audio")
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as ClipMeta & { rate: number; audio: string };
  const pcm = muLawDecode(fromBase64(row.audio));
  const buffer = takeToBuffer(pcm, row.rate);
  if (!buffer) return null;
  // Misma tasa y mismos cuadros que las tomas: el jurado compara parejo.
  const features = featuresFromFrames(analyzeTake(pcm, row.rate));
  const { rate: _r, audio: _a, ...meta } = row;
  return { meta, buffer, features };
}

// ---------- Escritura ----------

export interface PreparedClip {
  name: string;
  rate: number;
  bytes: Uint8Array;
  duration: number;
  /** Se corto porque el audio pasaba de `MAX_CLIP_S`. */
  cut: boolean;
}

/** "que-miras_bobo (1).mp3" -> "que miras bobo". */
export function nameFromFile(fileName: string): string {
  const base = fileName
    .replace(/\.[^.]+$/, "")
    .replace(/\(\d+\)/g, "")
    .replace(/[_\-.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return (base || "Sin nombre").slice(0, NAME_MAX);
}

/** Decodifica y deja el archivo listo para la tabla. Tira si el navegador no lo lee. */
export async function prepareClip(file: File): Promise<PreparedClip> {
  const a = getAudio();
  if (!a) throw new Error("Este navegador no tiene Web Audio.");
  const decoded = await a.ctx.decodeAudioData(await file.arrayBuffer());
  const factor = downsampleFactor(decoded.sampleRate);
  const rate = decoded.sampleRate / factor;
  let pcm = trimSilence(downsample(decoded.getChannelData(0), factor), rate);
  const max = Math.round(MAX_CLIP_S * rate);
  const cut = pcm.length > max;
  if (cut) pcm = pcm.slice(0, max);
  // Un fundido corto al final para que el corte no haga "clic".
  const fade = Math.min(pcm.length, Math.round(rate * 0.04));
  for (let i = 0; i < fade; i++) pcm[pcm.length - 1 - i] *= i / fade;
  pcm = normalizeGain(pcm);
  return { name: nameFromFile(file.name), rate, bytes: muLawEncode(pcm), duration: pcm.length / rate, cut };
}

export async function uploadClip(clip: PreparedClip, uploader: string): Promise<ClipMeta> {
  const sb = getSupabase();
  if (!sb) throw new Error("Sin conexion a la base.");
  const { data, error } = await sb
    .from("imitame_clips")
    .insert({
      name: clip.name,
      uploader,
      rate: Math.round(clip.rate),
      duration: Math.round(clip.duration * 100) / 100,
      audio: toBase64(clip.bytes),
    })
    .select("id, name, uploader, duration, created_at")
    .single();
  if (error || !data) throw new Error(error?.message ?? "No se pudo subir.");
  return data as ClipMeta;
}

/** Borra un audio. Devuelve false si no se borro nada (p.ej. falta la politica de delete). */
export async function deleteClip(id: string): Promise<boolean> {
  const sb = getSupabase();
  if (!sb) return false;
  const { data, error } = await sb.from("imitame_clips").delete().eq("id", id).select("id");
  cache.delete(id);
  return !error && (data?.length ?? 0) > 0;
}

// ---------- base64 ----------

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
