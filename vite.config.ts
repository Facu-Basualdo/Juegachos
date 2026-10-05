import { defineConfig } from "vite";
import { resolve } from "node:path";
import { existsSync, readdirSync } from "node:fs";

const root = __dirname;
const gamesDir = resolve(root, "games");

function collectHtmlEntries(): Record<string, string> {
  const entries: Record<string, string> = {
    main: resolve(root, "index.html"),
  };

  // Pagina de salas multijugador (no es un juego, no vive bajo games/).
  const roomsHtml = resolve(root, "rooms/index.html");
  if (existsSync(roomsHtml)) entries.rooms = roomsHtml;

  // La Isla: la sala 3D (src/lobby3d/). Tampoco es un juego.
  const lobbyHtml = resolve(root, "rooms/lobby/index.html");
  if (existsSync(lobbyHtml)) entries.lobby3d = lobbyHtml;

  // Pagina del salon de la fama (ranking de lideres de salas). Tampoco es juego.
  const fameHtml = resolve(root, "fame/index.html");
  if (existsSync(fameHtml)) entries.fame = fameHtml;

  // Pagina de feedback de los jugadores (src/feedback/). Tampoco es juego.
  const feedbackHtml = resolve(root, "feedback/index.html");
  if (existsSync(feedbackHtml)) entries.feedback = feedbackHtml;

  for (const dirent of readdirSync(gamesDir, { withFileTypes: true })) {
    if (!dirent.isDirectory()) continue;
    const htmlPath = resolve(gamesDir, dirent.name, "index.html");
    if (existsSync(htmlPath)) entries[dirent.name] = htmlPath;
  }

  return entries;
}

export default defineConfig({
  build: {
    rollupOptions: {
      input: collectHtmlEntries(),
    },
  },
});
