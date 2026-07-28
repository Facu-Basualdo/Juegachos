import { createServer } from "node:http";
import { Server } from "socket.io";
import { fragmentCount, initialCount, wordCount } from "./dictionary.js";
import { registerWordBomb } from "./games/wordbomb.js";
import { registerWordChain } from "./games/wordchain.js";
import { registerPong } from "./games/pong.js";
import { registerBasta } from "./games/basta.js";
import { registerCarRace } from "./games/carrace.js";
import { registerImpostor } from "./games/impostor.js";
import { registerTelefonoCortado } from "./games/telefonocortado.js";
import { impostorWordCount } from "./words-impostor.js";

/**
 * Game server autoritativo de tiempo real. v1: Bomba Palabra. Complementa la
 * infra de salas de Supabase (lobby / marcador / rejoin siguen en la DB); el
 * server solo maneja el estado en-ronda en memoria y no toca Supabase.
 *
 * Deploy en Railway: root del servicio = `server/`, build `npm ci && npm run
 * build`, start `node dist/index.js`. Railway inyecta PORT por env.
 */

const PORT = Number(process.env.PORT ?? 8787);
// Origenes permitidos (el deploy de Vercel). "*" en dev; en prod se setea
// ALLOWED_ORIGINS con la lista separada por comas.
const ORIGINS = process.env.ALLOWED_ORIGINS?.split(",").map((s) => s.trim()).filter(Boolean);

// El health check lo consulta el navegador (la landing muestra si el server esta
// vivo), asi que necesita CORS propio: el `cors` del Server de socket.io solo
// cubre el handshake, no este handler HTTP.
function corsOrigin(req: { headers: { origin?: string } }): string | null {
  if (!ORIGINS || ORIGINS.length === 0) return "*";
  const origin = req.headers.origin;
  return origin && ORIGINS.includes(origin) ? origin : null;
}

const httpServer = createServer((req, res) => {
  if (req.url === "/health" || req.url === "/") {
    const allow = corsOrigin(req);
    res.writeHead(200, {
      "content-type": "application/json",
      ...(allow ? { "access-control-allow-origin": allow, vary: "Origin" } : {}),
      "cache-control": "no-store",
    });
    res.end(
      JSON.stringify({
        ok: true,
        words: wordCount(),
        fragments: fragmentCount(),
        initials: initialCount(),
        impostorWords: impostorWordCount(),
      }),
    );
    return;
  }
  res.writeHead(404);
  res.end();
});

const io = new Server(httpServer, {
  cors: { origin: ORIGINS && ORIGINS.length > 0 ? ORIGINS : "*", methods: ["GET", "POST"] },
});

registerWordBomb(io);
registerWordChain(io);
registerPong(io);
registerBasta(io);
registerImpostor(io);
registerTelefonoCortado(io);
registerCarRace(io);

httpServer.listen(PORT, () => {
  console.log(
    `[game-server] escuchando en :${PORT} | diccionario ${wordCount()} palabras, ` +
      `${fragmentCount()} fragmentos, ${initialCount()} letras iniciales`,
  );
});
