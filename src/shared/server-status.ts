/**
 * Estado y resolucion del game server (server/, socket.io en Railway).
 *
 * Hay dos URLs posibles: la principal (`VITE_GAME_SERVER_URL`) y una de respaldo
 * (`VITE_GAME_SERVER_FALLBACK_URL`, opcional). Se prueban **en orden** contra el
 * health check HTTP (`/health`, ver `server/src/index.ts`, que responde
 * `{ ok: true }` y manda las cabeceras CORS) y gana la primera que contesta.
 *
 * Lo usan dos lados:
 *  - la landing (`src/main.ts`), para el indicador de la barra con el ping;
 *  - los juegos que necesitan el server (word-bomb, word-chain, basta, impostor,
 *    pong), via `resolveGameServerUrl()` antes de abrir el socket. Si el resolver
 *    viviera solo en la landing el respaldo seria decorativo: el chip diria "en
 *    linea" y los juegos seguirian pegandole al server muerto.
 *
 * Sin ninguna URL configurada el estado es "unknown" y no se pinta nada (misma
 * degradacion que el resto: la landing anda igual, y los juegos server-side ya
 * muestran su cartel de "no disponible").
 */

export type ServerStatus = "unknown" | "online" | "offline";

export interface ServerCheck {
  status: ServerStatus;
  /** URL que respondio, o undefined si ninguna. */
  url?: string;
  /** Round-trip del /health en ms (entero) con la conexion ya abierta, solo si
   *  status === "online". Ver `PING_SAMPLES`: NO es el primer fetch. */
  pingMs?: number;
  /** true si respondio la de respaldo porque la principal esta caida. */
  fallback: boolean;
}

const PRIMARY = import.meta.env.VITE_GAME_SERVER_URL as string | undefined;
const FALLBACK = import.meta.env.VITE_GAME_SERVER_FALLBACK_URL as string | undefined;

/** Timeout del ping: Railway duerme los servicios free y tarda en despertar. */
const PING_TIMEOUT_MS = 8000;

/**
 * Cuantas mediciones **con la conexion ya abierta** se toman para el ping que se
 * muestra, quedandose con la mejor.
 *
 * El primer fetch de la pagina no sirve como ping: paga DNS + TCP + handshake TLS
 * y da mas o menos el doble de lo real (medido contra game.juegachos.com: 114 ms
 * el primero, ~73 ms una vez establecida la conexion; el chip llegaba a decir 183
 * ms). Ese numero no es la latencia del server sino la de abrir la conexion, y es
 * justo lo que el jugador NO paga: el socket del juego se abre una vez y queda
 * abierto. Asi que la primera medicion se descarta (es el calentamiento) y se
 * reportan estas.
 *
 * Se toma el **minimo** y no el promedio porque lo que se busca es la latencia de
 * la red, no la del navegador: la muestra mas rapida es la que menos jitter y
 * menos slow-start de TCP se comio.
 */
const PING_SAMPLES = 2;

/**
 * Cache de la URL viva. Es de sesion (no localStorage) a proposito: una URL que
 * se cayo hace una semana no deberia decidir a que server se conecta el juego de
 * hoy, y cada pestana resuelve la suya.
 */
const CACHE_KEY = "mg:game-server-url";

/**
 * Normaliza lo que venga en la env: saca espacios y la barra final, y **completa
 * el esquema** si falta (`game.juegachos.com` -> `https://game.juegachos.com`).
 * Sin esto un host pelado se toma como URL **relativa** y el fetch termina en
 * `<origen>/game.juegachos.com/health`: el server se ve caido estando vivo.
 */
function normalize(url: string): string {
  const clean = url.trim().replace(/\/+$/, "");
  return /^https?:\/\//i.test(clean) ? clean : `https://${clean}`;
}

/** Las URLs configuradas, principal primero, sin duplicados ni vacias. */
function serverUrls(): string[] {
  const urls = [PRIMARY, FALLBACK]
    .filter((u): u is string => Boolean(u && u.trim()))
    .map(normalize);
  return [...new Set(urls)];
}

export function isGameServerConfigured(): boolean {
  return serverUrls().length > 0;
}

/** Pega al /health de una URL. Devuelve el ping en ms, o null si no responde. */
async function probe(url: string): Promise<number | null> {
  const startedAt = performance.now();
  try {
    const res = await fetch(`${url}/health`, {
      cache: "no-store",
      signal: AbortSignal.timeout(PING_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { ok?: boolean };
    if (!body?.ok) return null;
    return Math.round(performance.now() - startedAt);
  } catch {
    // Red caida, CORS, timeout: para el jugador es lo mismo, no hay server.
    return null;
  }
}

/**
 * Prueba las URLs en orden y devuelve la primera viva, con el ping de esa primera
 * respuesta (frio: incluye el setup de la conexion). Es la seleccion de server,
 * sin mediciones de mas: la usan tanto la UI como `resolveGameServerUrl`.
 */
async function firstLive(): Promise<{ url: string; pingMs: number; fallback: boolean } | null> {
  for (const [i, url] of serverUrls().entries()) {
    const pingMs = await probe(url);
    if (pingMs !== null) {
      cacheUrl(url);
      return { url, pingMs, fallback: i > 0 };
    }
  }
  clearCachedUrl();
  return null;
}

/**
 * Estado del game server para la UI: que URL contesta, si es la de respaldo, y el
 * ping **real** (con la conexion caliente, ver `PING_SAMPLES`).
 *
 * Las mediciones extra son solo para mostrar: `resolveGameServerUrl` (el camino de
 * los juegos) no las paga, porque para conectar solo hace falta saber cual esta
 * viva.
 */
export async function checkGameServer(): Promise<ServerCheck> {
  if (serverUrls().length === 0) return { status: "unknown", fallback: false };

  const live = await firstLive();
  if (!live) return { status: "offline", fallback: false };

  // La respuesta de `firstLive` fue el calentamiento; ahora si se mide.
  let pingMs = live.pingMs;
  for (let i = 0; i < PING_SAMPLES; i++) {
    const ms = await probe(live.url);
    // Un fallo suelto aca no es "server caido" (ya contesto recien): se corta y se
    // reporta la mejor muestra que haya.
    if (ms === null) break;
    pingMs = i === 0 ? ms : Math.min(pingMs, ms);
  }
  return { status: "online", url: live.url, pingMs, fallback: live.fallback };
}

function cacheUrl(url: string): void {
  try {
    sessionStorage.setItem(CACHE_KEY, url);
  } catch {
    // ignore
  }
}

function cachedUrl(): string | null {
  try {
    const url = sessionStorage.getItem(CACHE_KEY);
    // Solo vale si sigue siendo una de las configuradas (la env pudo cambiar).
    return url && serverUrls().includes(url) ? url : null;
  } catch {
    return null;
  }
}

function clearCachedUrl(): void {
  try {
    sessionStorage.removeItem(CACHE_KEY);
  } catch {
    // ignore
  }
}

/**
 * La URL del game server a la que conectarse: la principal si esta viva, si no la
 * de respaldo. `undefined` si no hay ninguna configurada o ninguna responde.
 *
 * Con una sola URL configurada (el caso normal) **no chequea nada**: devuelve esa
 * y que el socket falle como fallaba antes. El health check extra solo se paga
 * cuando hay respaldo, que es cuando la respuesta cambia algo.
 *
 * OJO: la sala entera tiene que terminar en el **mismo** server o los jugadores
 * quedan en partidas distintas sin verse. Con la principal caida para todos, todos
 * caen al respaldo y coinciden; el riesgo es el desacuerdo transitorio (a uno le
 * falla el chequeo y a otro no). Por eso el resultado se cachea por sesion: una vez
 * elegido, el jugador no salta de server a mitad de partido.
 */
export async function resolveGameServerUrl(): Promise<string | undefined> {
  const urls = serverUrls();
  if (urls.length === 0) return undefined;
  if (urls.length === 1) return urls[0];

  const cached = cachedUrl();
  if (cached) return cached;

  // `firstLive` y no `checkGameServer`: para conectar alcanza con saber cual esta
  // viva, sin pagar las mediciones de ping que son solo para la pastilla.
  const live = await firstLive();
  // Ninguna respondio: se devuelve la principal igual, asi el error que ve el
  // jugador es el del socket (con su reintento) y no un silencio.
  return live?.url ?? urls[0];
}
