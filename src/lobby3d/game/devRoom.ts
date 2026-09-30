import { coverUrl } from "../../games";
import { lobbyGames } from "../../shared/room/hub";
import type { Hub } from "./Hub";
import type { Weather } from "./Night";

/**
 * Isla sin Supabase, solo en dev: `/rooms/lobby/?dev=Ana&roster=Ana,Beto&code=TEST`.
 * Arma la escena y se conecta al relay del game server (si esta configurado), sin
 * tocar la base real: una pestaña por nickname, mismo `code` y `roster`.
 *
 * `&phase=lobby|voting|briefing|results|final` muestra una fase con datos de
 * mentira (para ver los afiches, el escenario y los paneles), `&dread=0..1` fija
 * cuanto empeoro la noche (1 = la final) y `&weather=clear|fog|rain` el clima. En el build
 * `import.meta.env.DEV` es false y todo esto queda afuera.
 */
export function startDevHub(hub: Hub): boolean {
  if (!import.meta.env.DEV) return false;
  const params = new URLSearchParams(window.location.search);
  const me = params.get("dev");
  if (!me) return false;
  const code = (params.get("code") ?? "TEST").toUpperCase();
  const roster = (params.get("roster") ?? me).split(",").filter(Boolean);
  const dread = params.get("dread");
  const weather = params.get("weather") as Weather | null;
  // Para las pruebas con Playwright (el bot de la torre, ver CLAUDE.md).
  (window as unknown as { __isla: Hub }).__isla = hub;
  hub.startDev({ me, code, roster, dread: dread !== null ? Number(dread) : undefined, weather: weather ?? undefined });

  if (params.has("dolls")) hub.devDolls();

  const log = (what: string) => (...args: unknown[]) => console.log(`[isla dev] ${what}`, ...args);
  const totals = roster.map((player, i) => ({ rank: i + 1, player, points: (roster.length - i) * 3 }));
  // Como en una sala 3D real: se votan todos los juegos. Algunos votos de mentira para ver los focos.
  const options = lobbyGames.map((g) => ({ id: g.id, title: g.title, accent: g.accent, cover: coverUrl(g.id) }));
  const counts: Record<string, number> = { [options[3].id]: 2, [options[8].id]: 1 };
  const voters: Record<string, string[]> = { [options[3].id]: ["Caro", "Dani"], [options[8].id]: ["Eze"] };
  let myVote: string | null = null;
  let ready = false;

  const phase = params.get("phase") ?? "lobby";
  const render = (): void => {
    switch (phase) {
      case "voting":
        hub.showVoting({
          round: 2,
          options,
          counts,
          voters,
          myVote,
          onVote: (id) => {
            if (myVote) {
              counts[myVote]--;
              voters[myVote] = (voters[myVote] ?? []).filter((p) => p !== me);
            }
            myVote = id;
            counts[id] = (counts[id] ?? 0) + 1;
            (voters[id] ??= []).push(me);
            log("vote")(id);
            render();
          },
        });
        hub.setTimeText("0:17");
        break;
      case "briefing": {
        const g = lobbyGames[0];
        hub.showBriefing({
          round: 2,
          roundNo: 2,
          totalRounds: 5,
          gameTitle: g.title,
          gameId: g.id,
          description: g.description,
          controls: g.controls ?? "",
          howTo: g.howTo,
          timeLimit: "",
          readyCount: ready ? 1 : 0,
          totalPlayers: roster.length,
          iAmReady: ready,
          onReady: () => {
            ready = true;
            log("ready")();
            render();
          },
          host: { allReady: ready, onStart: log("start") },
        });
        hub.setTimeText("Empieza en 0:24");
        break;
      }
      case "results":
        hub.showResults({
          roundNo: 2,
          totalRounds: 5,
          gameTitle: lobbyGames[1].title,
          rows: roster.map((player, i) => ({ rank: i + 1, player, scoreText: `${20 - i * 3}.0 s`, points: roster.length - i })),
          totals,
          me,
          hostAction: null,
          waitingText: "La votacion arranca en unos segundos...",
        });
        break;
      case "final":
        hub.showFinal(totals, me, { hostAction: { label: "Volver a la sala", onClick: log("return") }, waitingText: null });
        break;
      default:
        hub.showLobby({
          code,
          me,
          host: roster[0],
          players: roster,
          present: roster,
          totalRounds: 5,
          canStart: roster.length >= 2,
          onStart: roster[0] === me ? log("start") : null,
          onSetRounds: roster[0] === me ? log("rounds") : null,
          onKick: roster[0] === me ? log("kick") : null,
          onLeave: log("leave"),
        });
    }
  };
  render();
  return true;
}
