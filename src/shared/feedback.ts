import { getSupabase } from "./supabase";
import { getNickname } from "./nickname";

/**
 * Feedback de los jugadores, guardado en la tabla `feedback` de Supabase
 * (`supabase/feedback.sql`). Es privado: el navegador escribe y no lee; se mira desde
 * el panel de Supabase. Lo usan `FeedbackPanel` (game over y resultados de sala) y el
 * formulario de la landing.
 *
 * Degrada como el ranking: sin credenciales no hay panel. Si la tabla todavia no existe
 * (falta correr la migracion), el primer envio falla, se avisa una vez en la consola y
 * los paneles se ocultan por el resto de la pagina.
 */

export type FeedbackKind = "like" | "dislike" | "bug" | "idea" | "game" | "other";
export type FeedbackSource = "gameover" | "room" | "landing";
export type FeedbackResult = "ok" | "error" | "limit";

export const FEEDBACK_MAX = 1000;
const CLIENT_KEY = "mg:client-id";
const VOTES_KEY = "mg:feedback-votes";

let missing = false;

/** Hay donde mandarlo (credenciales y tabla). */
export function isFeedbackEnabled(): boolean {
  return getSupabase() !== null && !missing;
}

/** Id al azar de este navegador: un voto por persona y el limite de envios. */
function clientId(): string {
  try {
    let id = localStorage.getItem(CLIENT_KEY);
    if (!id) {
      id = typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
      localStorage.setItem(CLIENT_KEY, id);
    }
    return id;
  } catch {
    return "anon";
  }
}

function readVotes(): Record<string, "like" | "dislike"> {
  try {
    const raw = JSON.parse(localStorage.getItem(VOTES_KEY) ?? "{}") as unknown;
    return raw && typeof raw === "object" ? (raw as Record<string, "like" | "dislike">) : {};
  } catch {
    return {};
  }
}

/** El pulgar que este navegador ya le puso a un juego (para mostrarlo marcado). */
export function myVote(gameId: string): "like" | "dislike" | null {
  const v = readVotes()[gameId];
  return v === "like" || v === "dislike" ? v : null;
}

function rememberVote(gameId: string, vote: "like" | "dislike"): void {
  try {
    const votes = readVotes();
    votes[gameId] = vote;
    localStorage.setItem(VOTES_KEY, JSON.stringify(votes));
  } catch {
    // Sin storage solo se pierde el marcado; el voto ya se mando.
  }
}

/** Lo que hace util un reporte de bug, sin que el jugador tenga que escribirlo. */
function context(): Record<string, unknown> {
  const ua = navigator.userAgent;
  const touch = typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches;
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "otro";
  const os = /Android/.test(ua) ? "Android" : /iPhone|iPad|iPod/.test(ua) ? "iOS" : /Mac OS X/.test(ua) ? "macOS" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "otro";
  return {
    device: touch ? "celu" : "compu",
    os,
    browser,
    screen: `${window.innerWidth}x${window.innerHeight}`,
    dpr: Math.round(window.devicePixelRatio * 100) / 100,
    path: location.pathname,
    lang: navigator.language,
    ua: ua.slice(0, 300),
  };
}

export interface FeedbackInput {
  kind: FeedbackKind;
  source: FeedbackSource;
  gameId?: string | null;
  message?: string;
  contact?: string;
  room?: string | null;
}

export async function sendFeedback(input: FeedbackInput): Promise<FeedbackResult> {
  const supabase = getSupabase();
  if (!supabase || missing) return "error";
  const message = input.message?.trim().slice(0, FEEDBACK_MAX) || null;
  const { error } = await supabase.from("feedback").insert({
    kind: input.kind,
    source: input.source,
    game_id: input.gameId ?? null,
    message,
    contact: input.contact?.trim().slice(0, 120) || null,
    player: getNickname(),
    room_code: input.room ?? null,
    client_id: clientId(),
    context: context(),
  });
  if (!error) {
    if ((input.kind === "like" || input.kind === "dislike") && input.gameId) rememberVote(input.gameId, input.kind);
    return "ok";
  }
  if (error.message?.includes("feedback_rate_limited")) return "limit";
  // 42P01 (Postgres) / PGRST205 (PostgREST): la tabla no existe.
  if (error.code === "42P01" || error.code === "PGRST205") {
    missing = true;
    console.warn("[feedback] Falta la tabla `feedback`: correr supabase/feedback.sql en el SQL Editor de Supabase.");
  } else {
    // Sin esto el panel solo dice "No se pudo enviar" y no hay como saber por que.
    console.warn("[feedback] No se pudo enviar:", error.code, error.message);
  }
  return "error";
}
