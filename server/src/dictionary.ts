import { createRequire } from "node:module";
import { EXTRA_WORDS } from "./extra-words.js";
import { PLACES } from "./places.js";

/**
 * Diccionario de espanol embebido en el server (an-array-of-spanish-words:
 * ~636k palabras) mas las palabras extra de `extra-words.ts` (jerga) y los
 * toponimos de `places.ts` (paises, capitales, provincias y ciudades). Vive SOLO
 * aca: la validacion de palabras es autoritativa y no spoofeable, y el diccionario
 * nunca pesa en el bundle del front.
 *
 * Se carga con createRequire porque el paquete es un index.json plano (un array
 * de strings), mas robusto que un import JSON con attributes en ESM. Para agregar
 * palabras que el diccionario base no trae, editar `extra-words.ts` o `places.ts`
 * (no hace falta tocar este archivo).
 */
const require = createRequire(import.meta.url);
const RAW: string[] = require("an-array-of-spanish-words");

/** Longitudes de fragmento (silaba/combo) que se ofrecen como reto. */
const FRAGMENT_LENGTHS = [2, 3] as const;
/** Un fragmento solo es jugable si existe en al menos esta cantidad de palabras. */
const MIN_WORDS_PER_FRAGMENT = 500;
/**
 * Cadena de Palabras: una letra solo se SORTEA como arranque si hay al menos esta
 * cantidad de palabras que empiezan con ella. No filtra el encadenado: si una palabra
 * termina en una letra pobre (fax -> x), la letra pobre se juega igual (decision de
 * diseno, ver el CLAUDE.md de word-chain). Solo evita abrir la partida con una letra
 * que nadie puede contestar.
 *
 * En 1000 quedan 22 letras: deja afuera x (185 palabras), ñ (317) e y (948), que como
 * arranque son una condena, y adentro q (2181) y u (2344), que son duras pero jugables.
 */
const MIN_WORDS_PER_INITIAL = 1000;

/**
 * Normaliza para comparar: minuscula, saca acentos de vocales y dieresis, pero
 * CONSERVA la ñ. Asi "canción" cuenta para el fragmento "cion" y el jugador puede
 * escribir con o sin tilde. Descarta todo lo que no sea [a-zñ].
 */
export function normalize(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFD")
    // U+0301 acento agudo (á é í ó ú), U+0308 dieresis (ü). No se toca U+0303
    // (la tilde de la ñ), asi la ñ sobrevive al recomponer.
    .replace(/[́̈]/g, "")
    .normalize("NFC")
    .replace(/[^a-zñ]/g, "");
}

const WORDS = new Set<string>();
/** Fragmento -> cantidad de palabras que lo contienen (solo los jugables). */
const FRAGMENTS: string[] = [];
/** Letras iniciales con las que se puede abrir una partida de Cadena de Palabras. */
const INITIALS: string[] = [];
/** Letra -> cuantas palabras del diccionario empiezan con ella (todas, no solo las jugables). */
const INITIAL_COUNTS = new Map<string, number>();

/** Suma una palabra al set y cuenta sus fragmentos (2-3 letras) una sola vez. */
function ingest(raw: string, counts: Map<string, number>): void {
  const w = normalize(raw);
  if (w.length < 3) return; // palabras muy cortas no aportan como respuesta
  WORDS.add(w);
  INITIAL_COUNTS.set(w[0], (INITIAL_COUNTS.get(w[0]) ?? 0) + 1);
  // Substrings distintos de esta palabra, para no contar dos veces "ana" en "banana".
  const seen = new Set<string>();
  for (const len of FRAGMENT_LENGTHS) {
    for (let i = 0; i + len <= w.length; i++) {
      const frag = w.slice(i, i + len);
      if (seen.has(frag)) continue;
      seen.add(frag);
      counts.set(frag, (counts.get(frag) ?? 0) + 1);
    }
  }
}

function build(): void {
  const counts = new Map<string, number>();
  for (const raw of RAW) ingest(raw, counts);
  for (const raw of EXTRA_WORDS) ingest(raw, counts); // jerga y regionalismos
  for (const raw of PLACES) ingest(raw, counts); // paises, capitales y ciudades
  for (const [frag, n] of counts) {
    if (n >= MIN_WORDS_PER_FRAGMENT) FRAGMENTS.push(frag);
  }
  for (const [letter, n] of INITIAL_COUNTS) {
    if (n >= MIN_WORDS_PER_INITIAL) INITIALS.push(letter);
  }
  INITIALS.sort();
}

build();

/** Cuantas palabras conoce el diccionario (para el log de arranque). */
export function wordCount(): number {
  return WORDS.size;
}

/** Cuantos fragmentos jugables se precomputaron. */
export function fragmentCount(): number {
  return FRAGMENTS.length;
}

/** Un fragmento jugable al azar (garantiza que exista una solucion). */
export function randomFragment(): string {
  return FRAGMENTS[Math.floor(Math.random() * FRAGMENTS.length)];
}

/** Cuantas letras iniciales son sorteables como arranque de la cadena. */
export function initialCount(): number {
  return INITIALS.length;
}

/** Letra de arranque de Cadena de Palabras: siempre una con muchas palabras detras. */
export function randomInitial(): string {
  return INITIALS[Math.floor(Math.random() * INITIALS.length)];
}

/**
 * Hay al menos una palabra que empieza con esta letra. Las letras pobres (fax -> x)
 * se juegan igual — es parte del riesgo del juego —, pero una letra con CERO palabras
 * dejaria la cadena muerta, y ahi `WordChainSim` sortea otra.
 */
export function hasInitial(letter: string): boolean {
  return (INITIAL_COUNTS.get(letter) ?? 0) > 0;
}

export type WordCheck = "ok" | "not-a-word" | "missing-fragment";

/** Resultado de validar un eslabon de la cadena. */
export type ChainCheck = "ok" | "not-a-word" | "wrong-initial";

/**
 * Valida una palabra cruda como eslabon: tiene que empezar con `letter` y existir en
 * el diccionario. No chequea repeticion (eso lo lleva el sim con su set de usadas).
 * Devuelve la forma normalizada, cuya ULTIMA letra es el reto del proximo jugador.
 */
export function checkChainWord(
  input: string,
  letter: string,
): { result: ChainCheck; normalized: string } {
  const normalized = normalize(input);
  if (normalized[0] !== letter) return { result: "wrong-initial", normalized };
  if (!WORDS.has(normalized)) return { result: "not-a-word", normalized };
  return { result: "ok", normalized };
}

/**
 * Valida una palabra cruda contra un fragmento. No chequea repeticion (eso lo
 * lleva el sim con su set de usadas). Devuelve la forma normalizada para que el
 * llamador la guarde como "usada".
 */
export function checkWord(input: string, fragment: string): { result: WordCheck; normalized: string } {
  const normalized = normalize(input);
  if (!normalized.includes(fragment)) return { result: "missing-fragment", normalized };
  if (!WORDS.has(normalized)) return { result: "not-a-word", normalized };
  return { result: "ok", normalized };
}
