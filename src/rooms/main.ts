import "./style.css";
import { roomGames, coverUrl } from "../games";
import { isLeaderboardEnabled } from "../shared/supabase";
import { getNickname, setNickname, NICKNAME_MAX } from "../shared/nickname";
import {
  castVote,
  createRoom,
  fetchPublicRooms,
  fetchRoomState,
  joinRoom,
  kickPlayer,
  leaveRoom,
  openVote,
  purgeStaleRooms,
  sanitizeCode,
  setVisibility,
  startBriefing,
  touchRoom,
  updateSettings,
} from "../shared/room/api";
import { RoomChannel } from "../shared/room/channel";
import { RoomOverlay } from "../shared/room/RoomOverlay";
import {
  BRIEFING_SECONDS,
  pickVoteOptions,
  roomGameUrl,
  VOTE_SECONDS,
} from "../shared/room/roomMode";
import {
  DEFAULT_TOTAL_ROUNDS,
  HEARTBEAT_MS,
  MAX_ROOM_PLAYERS,
  TOTAL_ROUNDS_OPTIONS,
  type PublicRoom,
  type RoomSettings,
  type RoomState,
  type RoomVisibility,
} from "../shared/room/types";

/**
 * Pagina de salas: elegir nombre, crear una sala (ajustes) o unirse por codigo
 * o link (/rooms/?code=XXXXXX), y el lobby previo a la primera ronda. Cuando el
 * host arranca, todos navegan a /games/<id>/?room=CODE y el resto del flujo lo
 * maneja src/shared/room/roomMode.ts dentro de cada juego.
 */

const app = document.querySelector<HTMLDivElement>("#app")!;

const topbar = document.createElement("nav");
topbar.className = "topbar";
topbar.innerHTML = `
  <a class="topbar__logo" href="/"><img src="/juegachos.png" alt="JUEGACHOS" /></a>
  <div class="topbar__links">
    <a href="/">Juegos</a>
    <a href="/rooms/" class="is-active">Salas</a>
  </div>
`;

const header = document.createElement("header");
header.className = "rooms__header";
header.innerHTML = `
  <span class="rooms__kicker">Modo salas</span>
  <h1 class="rooms__title">Jugá con amigos</h1>
  <p class="rooms__subtitle">Mismos juegos, misma sala, un solo ganador.</p>
`;

const stack = document.createElement("div");
stack.className = "rooms__stack";

const main = document.createElement("main");
main.className = "rooms";
main.append(header, stack);

app.append(topbar, main);

// Codigo de la URL (link compartido). Se limpia al ser expulsado, para que un
// F5 no vuelva a meter al jugador en la sala de la que lo acaban de echar.
let prefillCode = sanitizeCode(new URLSearchParams(location.search).get("code") ?? "");

/** Cada cuanto se re-lista "Salas abiertas" mientras la home esta montada. */
const BROWSE_REFRESH_MS = 8000;

if (!isLeaderboardEnabled()) {
  const panel = document.createElement("div");
  panel.className = "panel";
  panel.innerHTML = `
    <div class="panel__title">No disponible</div>
    <p class="hint">Las salas necesitan la configuracion de Supabase (las mismas credenciales del ranking global). Sin eso, los juegos siguen funcionando solos desde el menu.</p>
  `;
  stack.append(panel);
} else if (prefillCode && getNickname()) {
  // Llegada con codigo y nombre ya elegido (link compartido, rejoin, o vuelta
  // al lobby tras "Jugar otra vez"): entrar directo sin apretar Unirse.
  void autoJoin(prefillCode, getNickname()!);
} else {
  renderHome();
}

async function autoJoin(code: string, player: string): Promise<void> {
  stack.innerHTML = "";
  const panel = document.createElement("div");
  panel.className = "panel";
  panel.innerHTML = `
    <div class="panel__title">Sala ${code}</div>
    <p class="hint">Entrando a la sala...</p>
  `;
  stack.append(panel);

  // Sin chequeo de presence: el redirect viene de la propia sala y la
  // presencia vieja de la pagina anterior tarda unos segundos en caerse.
  const problem = await joinFlow(code, player, { presenceCheck: false });
  if (problem) renderHome(problem);
}

// ---------- Home: nombre + unirse + boton para crear ----------

function renderHome(joinProblem?: string): void {
  stack.innerHTML = "";
  main.classList.remove("rooms--wide");

  // Nombre del jugador (mismo nickname del ranking global).
  const namePanel = document.createElement("div");
  namePanel.className = "panel";
  namePanel.innerHTML = `<div class="panel__title">Tu nombre</div>`;
  const nameRow = document.createElement("div");
  nameRow.className = "panel__row";
  const nameInput = document.createElement("input");
  nameInput.className = "input";
  nameInput.type = "text";
  nameInput.maxLength = NICKNAME_MAX;
  nameInput.placeholder = "Tu nombre (1-12)";
  nameInput.autocomplete = "off";
  nameInput.value = getNickname() ?? "";
  nameRow.append(nameInput);
  namePanel.append(nameRow);

  const requireName = (): string | null => {
    const saved = setNickname(nameInput.value);
    if (!saved) nameInput.focus();
    return saved;
  };

  // Unirse a una sala existente.
  const joinPanel = document.createElement("div");
  joinPanel.className = "panel";
  joinPanel.innerHTML = `<div class="panel__title">Unirse a una sala</div>`;
  const joinRow = document.createElement("div");
  joinRow.className = "panel__row";
  const codeInput = document.createElement("input");
  codeInput.className = "input input--code";
  codeInput.type = "text";
  codeInput.maxLength = 6;
  codeInput.placeholder = "CODIGO";
  codeInput.autocomplete = "off";
  if (prefillCode) codeInput.value = prefillCode;
  const joinBtn = document.createElement("button");
  joinBtn.className = "btn";
  joinBtn.type = "button";
  joinBtn.textContent = "Unirse";
  joinRow.append(codeInput, joinBtn);
  const joinError = document.createElement("div");
  joinError.className = "error";
  if (joinProblem) joinError.textContent = joinProblem;
  joinPanel.append(joinRow, joinError);

  const tryJoin = async (): Promise<void> => {
    joinError.textContent = "";
    const player = requireName();
    if (!player) return;
    const code = sanitizeCode(codeInput.value);
    if (!code) {
      joinError.textContent = "Codigo invalido (6 letras/numeros).";
      return;
    }
    joinBtn.disabled = true;
    const problem = await joinFlow(code, player);
    joinBtn.disabled = false;
    if (problem) joinError.textContent = problem;
  };
  joinBtn.addEventListener("click", () => void tryJoin());
  codeInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") void tryJoin();
  });

  // Crear una sala: se crea al toque con los ajustes por defecto y el host cae
  // directo en el lobby, donde ya tiene el panel "Ajustes" para configurarla
  // antes de empezar (no hay pantalla intermedia). Lo unico que se elige aca es
  // la visibilidad, porque decide si la sala aparece en el listado de arriba.
  const createPanel = document.createElement("div");
  createPanel.className = "panel";
  createPanel.innerHTML = `
    <div class="panel__title">Crear una sala</div>
    <p class="hint">Armá una sala nueva, configurá los ajustes ahí mismo y compartí el código con tus amigos.</p>
  `;
  let visibility: RoomVisibility = "public";
  const visLabel = document.createElement("div");
  visLabel.className = "panel__label";
  visLabel.textContent = "Quien puede entrar";
  const visChoices = buildChoices(
    [
      { value: 0, label: "Pública" },
      { value: 1, label: "Privada" },
    ],
    0,
    (v) => {
      visibility = v === 1 ? "private" : "public";
      visHint.textContent = visHintText();
    },
  );
  const visHintText = (): string =>
    visibility === "public"
      ? "Aparece en la lista de salas abiertas: cualquiera puede unirse."
      : "No aparece en la lista: solo entran los que tengan el código o el link.";
  const visHint = document.createElement("p");
  visHint.className = "hint";
  visHint.textContent = visHintText();

  const createBtn = document.createElement("button");
  createBtn.className = "btn btn--primary";
  createBtn.type = "button";
  createBtn.textContent = "Crear sala";
  const createError = document.createElement("div");
  createError.className = "error";
  createBtn.addEventListener("click", () => {
    void (async () => {
      createError.textContent = "";
      const player = requireName();
      if (!player) return;
      const settings: RoomSettings = {
        totalRounds: DEFAULT_TOTAL_ROUNDS,
        playlist: null,
      };
      createBtn.disabled = true;
      const code = await createRoom(player, settings, visibility);
      createBtn.disabled = false;
      if (!code) {
        createError.textContent = "No se pudo crear la sala. Proba de nuevo.";
        return;
      }
      renderLobby(code, player);
    })();
  });
  createPanel.append(visLabel, visChoices, visHint, createBtn, createError);

  const browsePanel = buildBrowsePanel(requireName, (problem) => {
    joinError.textContent = problem;
  });

  stack.append(namePanel, browsePanel, joinPanel, createPanel);
  if (prefillCode) codeInput.focus();
}

/**
 * Listado de salas publicas abiertas (en el lobby y con gente). Se refresca solo
 * cada BROWSE_REFRESH_MS mientras la home este montada; cada fila entra directo
 * con joinFlow, igual que el codigo tipeado a mano.
 */
function buildBrowsePanel(
  requireName: () => string | null,
  onProblem: (problem: string) => void,
): HTMLDivElement {
  const panel = document.createElement("div");
  panel.className = "panel";
  panel.innerHTML = `<div class="panel__title">Salas abiertas</div>`;

  const list = document.createElement("ul");
  list.className = "browse";
  const empty = document.createElement("p");
  empty.className = "hint";
  empty.textContent = "Cargando salas...";
  panel.append(list, empty);

  let joining = false;

  const render = (rooms: PublicRoom[]): void => {
    // La home se re-renderiza entera (renderHome vacia el stack): si este panel
    // ya no esta en el DOM, cortar el refresco.
    if (!panel.isConnected) {
      window.clearInterval(timer);
      return;
    }
    list.innerHTML = "";
    if (rooms.length === 0) {
      empty.textContent = "No hay salas públicas abiertas. Creá una y compartí el código.";
      empty.style.display = "";
      return;
    }
    empty.style.display = "none";
    for (const room of rooms) {
      const full = room.players >= MAX_ROOM_PLAYERS;
      const li = document.createElement("li");
      li.className = "browse__row";

      const info = document.createElement("div");
      info.className = "browse__info";
      const name = document.createElement("span");
      name.className = "browse__host";
      name.textContent = `Sala de ${room.host}`;
      const meta = document.createElement("span");
      meta.className = "browse__meta";
      const games = room.settings.playlist
        ? `${room.settings.playlist.length} juegos elegidos`
        : `${room.settings.totalRounds} juegos a votar`;
      meta.textContent = `${room.players}/${MAX_ROOM_PLAYERS} jugadores · ${games}`;
      info.append(name, meta);

      const btn = document.createElement("button");
      btn.className = "btn browse__join";
      btn.type = "button";
      btn.textContent = full ? "Llena" : "Unirse";
      btn.disabled = full;
      btn.addEventListener("click", () => {
        void (async () => {
          if (joining) return;
          const player = requireName();
          if (!player) return;
          joining = true;
          btn.disabled = true;
          const problem = await joinFlow(room.code, player);
          joining = false;
          if (problem) {
            btn.disabled = full;
            onProblem(problem);
            void refresh();
          }
        })();
      });

      li.append(info, btn);
      list.append(li);
    }
  };

  const refresh = async (): Promise<void> => {
    const rooms = await fetchPublicRooms();
    render(rooms);
  };

  const timer = window.setInterval(() => void refresh(), BROWSE_REFRESH_MS);
  // Purga las salas muertas antes del primer listado, asi no se muestran salas
  // fantasma de pestanas cerradas sin cron ni server.
  void purgeStaleRooms().then(() => refresh());

  return panel;
}

/**
 * Formulario de ajustes de sala (rondas / playlist opcional). Reutilizado al
 * crear y en el lobby (el host puede cambiar los juegos antes de cada partida,
 * incluida la revancha). Emite settings ya normalizados: con playlist,
 * totalRounds = playlist.length. El tope de tiempo no se ajusta aca: lo declara
 * cada juego en su `meta.ts` (ver `roomTimeLimitFor`).
 */
function buildSettingsForm(
  initial: RoomSettings,
  onChange: (settings: RoomSettings) => void,
): HTMLDivElement {
  const wrap = document.createElement("div");

  let totalRounds: number = (TOTAL_ROUNDS_OPTIONS as readonly number[]).includes(
    initial.totalRounds,
  )
    ? initial.totalRounds
    : DEFAULT_TOTAL_ROUNDS;
  const playlist: string[] = initial.playlist ? [...initial.playlist] : [];

  // La cantidad elegida arriba manda: es el tope de juegos que se pueden
  // seleccionar. Con la lista completa (== totalRounds) salen esos en orden;
  // vacia, se votan al azar. Parcial se bloquea al crear.
  const emit = (): void => {
    onChange({
      totalRounds,
      playlist: playlist.length > 0 ? [...playlist] : null,
    });
  };

  const roundsLabel = document.createElement("div");
  roundsLabel.className = "panel__label";
  roundsLabel.textContent = "Cantidad de juegos";
  const roundsChoices = buildChoices(
    TOTAL_ROUNDS_OPTIONS.map((n) => ({ value: n, label: String(n) })),
    totalRounds,
    (v) => {
      totalRounds = v;
      // Si ya se habian elegido mas juegos que el nuevo tope, recortar.
      if (playlist.length > totalRounds) playlist.length = totalRounds;
      refreshPlaylistUI();
      emit();
    },
  );

  const playlistLabel = document.createElement("div");
  playlistLabel.className = "panel__label";
  playlistLabel.textContent = "Elegir los juegos (opcional)";

  // Fila del titulo con un boton para desmarcar todos los juegos elegidos.
  const playlistHead = document.createElement("div");
  playlistHead.className = "playlist-head";
  const playlistClear = document.createElement("button");
  playlistClear.type = "button";
  playlistClear.className = "playlist-clear";
  playlistClear.textContent = "Desmarcar todos";
  playlistClear.addEventListener("click", () => {
    if (playlist.length === 0) return;
    playlist.length = 0;
    refreshPlaylistUI();
    emit();
  });
  playlistHead.append(playlistLabel, playlistClear);

  // Buscador + filtros por categoria de la grilla (solo esconden/muestran; los
  // juegos ya elegidos siguen en el playlist aunque el filtro los oculte).
  let playlistCategory = "Todos";
  let playlistTerm = "";

  const playlistSearch = document.createElement("input");
  playlistSearch.type = "search";
  playlistSearch.className = "input playlist-search";
  playlistSearch.placeholder = "Buscar juego";
  playlistSearch.autocomplete = "off";

  const playlistFilters = document.createElement("div");
  playlistFilters.className = "choices playlist-cats";
  const playlistCats = ["Todos", ...new Set(roomGames.map((g) => g.category))];
  for (const cat of playlistCats) {
    const pill = document.createElement("button");
    pill.className = "choice" + (cat === playlistCategory ? " is-active" : "");
    pill.type = "button";
    pill.textContent = cat;
    pill.addEventListener("click", () => {
      playlistCategory = cat;
      playlistFilters.querySelectorAll(".choice").forEach((b) => b.classList.remove("is-active"));
      pill.classList.add("is-active");
      applyPlaylistFilter();
    });
    playlistFilters.append(pill);
  }

  const playlistGrid = document.createElement("div");
  playlistGrid.className = "playlist";

  const playlistEmpty = document.createElement("p");
  playlistEmpty.className = "hint playlist-empty";
  playlistEmpty.textContent = "Ningun juego coincide con la busqueda.";
  playlistEmpty.style.display = "none";

  const applyPlaylistFilter = (): void => {
    let visible = 0;
    playlistGrid.querySelectorAll<HTMLButtonElement>(".playlist__item").forEach((btn) => {
      const matchesCat = playlistCategory === "Todos" || btn.dataset.category === playlistCategory;
      const matchesTerm = !playlistTerm || (btn.dataset.search ?? "").includes(playlistTerm);
      const show = matchesCat && matchesTerm;
      btn.style.display = show ? "" : "none";
      if (show) visible++;
    });
    playlistEmpty.style.display = visible === 0 ? "" : "none";
  };

  playlistSearch.addEventListener("input", () => {
    playlistTerm = playlistSearch.value.trim().toLowerCase();
    applyPlaylistFilter();
  });

  const refreshPlaylistUI = (): void => {
    const atCap = playlist.length >= totalRounds;
    playlistGrid.querySelectorAll<HTMLButtonElement>(".playlist__item").forEach((btn) => {
      const idx = playlist.indexOf(btn.dataset.id!);
      const picked = idx >= 0;
      btn.classList.toggle("is-picked", picked);
      // Al llegar al tope no se pueden agregar mas; los ya elegidos siguen
      // clickeables para poder sacarlos.
      btn.classList.toggle("is-disabled", !picked && atCap);
      const badge = btn.querySelector<HTMLElement>(".playlist__order")!;
      badge.style.display = picked ? "" : "none";
      badge.textContent = String(idx + 1);
    });
    playlistLabel.textContent =
      playlist.length > 0
        ? `Elegir los juegos (${playlist.length}/${totalRounds})`
        : "Elegir los juegos (opcional)";
    playlistClear.style.display = playlist.length > 0 ? "" : "none";
  };

  for (const game of roomGames) {
    const btn = document.createElement("button");
    btn.className = "playlist__item";
    btn.type = "button";
    btn.dataset.id = game.id;
    btn.dataset.category = game.category;
    btn.dataset.search = `${game.title} ${game.description}`.toLowerCase();
    if (game.accent) btn.style.setProperty("--game-accent", game.accent);
    btn.innerHTML = `
      <span class="playlist__cover">
        <span class="playlist__order" style="display:none"></span>
      </span>
      <span class="playlist__name">${game.title}</span>
    `;
    // Mini portada del juego (la misma de la landing); si falta, queda el
    // fondo con el color del juego.
    const img = document.createElement("img");
    img.src = coverUrl(game.id);
    img.alt = "";
    img.loading = "lazy";
    img.addEventListener("error", () => img.remove());
    btn.querySelector(".playlist__cover")!.prepend(img);
    btn.addEventListener("click", () => {
      const idx = playlist.indexOf(game.id);
      if (idx >= 0) {
        playlist.splice(idx, 1);
      } else {
        // No permitir elegir mas juegos que la cantidad marcada arriba.
        if (playlist.length >= totalRounds) return;
        playlist.push(game.id);
      }
      refreshPlaylistUI();
      emit();
    });
    playlistGrid.append(btn);
  }
  refreshPlaylistUI();
  applyPlaylistFilter();

  const playlistHint = document.createElement("p");
  playlistHint.className = "hint";
  playlistHint.textContent =
    "Elegi en orden la misma cantidad de juegos que marcaste arriba. Si no elegis ninguno, despues de cada juego se vota el siguiente entre 5 al azar (puede repetirse alguno ya jugado).";

  wrap.append(
    roundsLabel,
    roundsChoices,
    playlistHead,
    playlistSearch,
    playlistFilters,
    playlistGrid,
    playlistEmpty,
    playlistHint,
  );
  return wrap;
}

function buildChoices<T extends number>(
  options: { value: T; label: string }[],
  initial: T,
  onPick: (value: T) => void,
): HTMLDivElement {
  const wrap = document.createElement("div");
  wrap.className = "choices";
  for (const opt of options) {
    const btn = document.createElement("button");
    btn.className = "choice" + (opt.value === initial ? " is-active" : "");
    btn.type = "button";
    btn.textContent = opt.label;
    btn.addEventListener("click", () => {
      wrap.querySelectorAll(".choice").forEach((b) => b.classList.remove("is-active"));
      btn.classList.add("is-active");
      onPick(opt.value);
    });
    wrap.append(btn);
  }
  return wrap;
}

// ---------- Unirse (con chequeo de nick ya conectado) ----------

/** Devuelve un mensaje de error, o null si el join siguio de largo. */
async function joinFlow(
  code: string,
  player: string,
  opts: { presenceCheck?: boolean } = {},
): Promise<string | null> {
  const state = await fetchRoomState(code);
  if (!state) return "La sala no existe.";
  const registered = state.players.includes(player);
  // Una sala terminada sigue viva ("Jugar otra vez"): los registrados pueden
  // reentrar al tablero final; los nuevos esperan a que vuelva al lobby.
  if (state.room.status === "finished" && !registered) {
    return "Esa sala ya termino.";
  }
  // Partida en curso y jugador nuevo: entra como espectador (no se registra ni
  // ocupa slot), solo mira hasta que termine. Va directo a la ronda vigente.
  if (state.room.status !== "lobby" && state.room.status !== "finished" && !registered) {
    if (state.room.current_game) {
      location.href = roomGameUrl(state.room.current_game, code);
      return null;
    }
    return "La partida ya empezo.";
  }
  // Tope de jugadores: solo bloquea a los nuevos en el lobby; los ya registrados
  // reingresan y los espectadores no cuentan (ya se resolvieron arriba).
  if (!registered && state.players.length >= MAX_ROOM_PLAYERS) {
    return `La sala esta llena (maximo ${MAX_ROOM_PLAYERS}).`;
  }

  // Nick ya registrado: es rejoin valido solo si nadie mas esta conectado con
  // ese nombre (presence). Dos amigos con igual nick serian la misma identidad.
  if ((opts.presenceCheck ?? true) && registered) {
    const online = await probePresence(code, player);
    if (online.includes(player)) {
      return "Ese nombre ya esta conectado en la sala. Elegi otro.";
    }
  }

  const result = await joinRoom(code, player);
  if (result === "not-found") return "La sala no existe.";
  if (result === "finished") return "Esa sala ya termino.";
  if (result === "spectator") {
    // La sala arranco entre el fetch y el join: entrar como espectador.
    if (state.room.current_game) {
      location.href = roomGameUrl(state.room.current_game, code);
      return null;
    }
    return "La partida ya empezo.";
  }
  if (result === "error") return "No se pudo entrar. Proba de nuevo.";

  // Sala ya en juego: rejoin directo a la ronda vigente.
  if (state.room.status !== "lobby" && state.room.current_game) {
    location.href = roomGameUrl(state.room.current_game, code);
    return null;
  }
  renderLobby(code, player);
  return null;
}

/** Mira la presencia del canal sin publicarse (para detectar nicks en uso). */
function probePresence(code: string, player: string): Promise<string[]> {
  return new Promise((resolve) => {
    const probe = new RoomChannel(code, `probe:${player}`, { track: false });
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      const present = probe.presentPlayers();
      probe.dispose();
      resolve(present);
    };
    probe.onPresence(finish);
    window.setTimeout(finish, 1500);
  });
}

// ---------- Lobby ----------

/** "1:07" de milisegundos restantes (piso 0:00), para el countdown de votacion. */
function formatMMSS(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function renderLobby(code: string, player: string): void {
  history.replaceState(null, "", `/rooms/?code=${code}`);
  stack.innerHTML = "";

  const panel = document.createElement("div");
  panel.className = "panel";
  panel.innerHTML = `<div class="panel__title">Sala</div>`;

  const codeEl = document.createElement("div");
  codeEl.className = "lobby__code";
  codeEl.textContent = code;

  const copyRow = document.createElement("div");
  copyRow.className = "panel__row";
  const copyBtn = document.createElement("button");
  copyBtn.className = "btn";
  copyBtn.type = "button";
  copyBtn.textContent = "Copiar link";
  copyBtn.style.margin = "0 auto";
  copyBtn.addEventListener("click", () => {
    void navigator.clipboard
      .writeText(`${location.origin}/rooms/?code=${code}`)
      .then(() => {
        copyBtn.textContent = "Copiado";
        window.setTimeout(() => (copyBtn.textContent = "Copiar link"), 1500);
      });
  });
  copyRow.append(copyBtn);

  panel.append(codeEl, copyRow);

  // Panel de ajustes editable (solo el host). Se arma una sola vez cuando se
  // detecta que este jugador es el anfitrion, para no pisar sus cambios en cada
  // refresco. Los cambios se guardan al vuelo con updateSettings + ping asi el
  // resto ve el resumen actualizado.
  const settingsPanel = document.createElement("div");
  settingsPanel.className = "panel";
  settingsPanel.style.display = "none";
  settingsPanel.innerHTML = `<div class="panel__title">Ajustes</div>`;
  const settingsFormWrap = document.createElement("div");
  const settingsError = document.createElement("div");
  settingsError.className = "error";
  settingsPanel.append(settingsFormWrap, settingsError);

  const playersPanel = document.createElement("div");
  playersPanel.className = "panel";
  playersPanel.innerHTML = `<div class="panel__title">Jugadores</div>`;
  const playersList = document.createElement("ul");
  playersList.className = "lobby__players";
  playersPanel.append(playersList);

  const startBtn = document.createElement("button");
  startBtn.className = "btn btn--primary";
  startBtn.type = "button";
  startBtn.textContent = "Empezar";
  startBtn.style.display = "none";

  const waitingEl = document.createElement("div");
  waitingEl.className = "lobby__waiting";

  // Salir de la sala: libera el slot. Si era el ultimo, la sala se borra; si era
  // el host, la hereda el jugador mas antiguo (leaveRoom se encarga).
  const leaveBtn = document.createElement("button");
  leaveBtn.className = "btn lobby__leave";
  leaveBtn.type = "button";
  leaveBtn.textContent = "Salir de la sala";
  leaveBtn.addEventListener("click", () => {
    leaveBtn.disabled = true;
    void (async () => {
      await leaveRoom(code, player);
      // Avisar antes de bajar el canal: los que quedan refrescan y me ven salir.
      channel.ping();
      teardown();
      prefillCode = null;
      history.replaceState(null, "", "/rooms/");
      renderHome();
    })();
  });

  playersPanel.append(startBtn, waitingEl, leaveBtn);

  // Dos columnas para el host: ajustes a la izquierda, codigo + jugadores a la
  // derecha. Los invitados ven una sola columna (codigo + jugadores).
  const columns = document.createElement("div");
  columns.className = "lobby__columns";
  const colLeft = document.createElement("div");
  colLeft.className = "lobby__col";
  const colRight = document.createElement("div");
  colRight.className = "lobby__col";
  colLeft.append(settingsPanel);
  colRight.append(panel, playersPanel);
  columns.append(colLeft, colRight);
  stack.append(columns);

  const channel = new RoomChannel(code, player);
  let state: RoomState | null = null;
  let starting = false;
  // Ajustes que edita el host en el lobby (autoritativos mientras edita).
  let hostSettings: RoomSettings | null = null;
  let hostFormBuilt = false;
  // Votacion del primer juego (sin playlist): corre dentro del lobby, con el
  // mismo overlay que usan las rondas siguientes en la pagina del juego.
  let voteOverlay: RoomOverlay | null = null;
  let voteTickId: number | null = null;
  let closingVote = false;

  /** Corta todos los timers y el canal: al salir, al ser expulsado o al morir la sala. */
  const teardown = (): void => {
    window.clearInterval(pollId);
    window.clearInterval(heartbeatId);
    stopVoteTick();
    voteOverlay?.hide();
    channel.dispose();
  };

  const buildHostForm = (initial: RoomSettings): void => {
    hostSettings = { ...initial };
    // Publica / privada: no vive en settings (es una columna propia, porque el
    // listado filtra por ella), asi que se guarda aparte del resto del form.
    const visWrap = document.createElement("div");
    const visLabel = document.createElement("div");
    visLabel.className = "panel__label";
    visLabel.textContent = "Quien puede entrar";
    const visChoices = buildChoices(
      [
        { value: 0, label: "Pública" },
        { value: 1, label: "Privada" },
      ],
      state?.room.visibility === "private" ? 1 : 0,
      (v) => {
        void setVisibility(code, v === 1 ? "private" : "public").then((ok) => {
          if (ok) channel.ping();
        });
      },
    );
    visWrap.append(visLabel, visChoices);

    const form = buildSettingsForm(initial, (s) => {
      hostSettings = s;
      settingsError.textContent = "";
      void updateSettings(code, s).then((ok) => {
        if (ok) channel.ping();
      });
    });
    settingsFormWrap.append(visWrap, form);
    settingsPanel.style.display = "";
    hostFormBuilt = true;
  };

  const render = (): void => {
    if (!state) return;
    const room = state.room;
    const settings = room.settings;
    const present = channel.presentPlayers();
    const isHost = room.host === player;

    if (isHost) {
      // El host edita en su propio formulario; ocultar el resumen de lectura.
      if (!hostFormBuilt) buildHostForm(settings);
      main.classList.add("rooms--wide");
      columns.classList.remove("lobby__columns--solo");
      colLeft.style.display = "";
    } else {
      // Invitado: solo codigo + jugadores en una columna.
      main.classList.remove("rooms--wide");
      columns.classList.add("lobby__columns--solo");
      colLeft.style.display = "none";
    }

    playersList.innerHTML = "";
    for (const p of state.players) {
      const li = document.createElement("li");
      li.className = "lobby__player";
      const dot = document.createElement("span");
      dot.className = "lobby__dot" + (present.includes(p) ? " is-online" : "");
      const name = document.createElement("span");
      name.textContent = p + (p === player ? " (vos)" : "");
      li.append(dot, name);
      if (p === room.host) {
        const tag = document.createElement("span");
        tag.className = "lobby__host-tag";
        tag.textContent = "anfitrion";
        li.append(tag);
      } else if (isHost) {
        // El anfitrion puede expulsar a cualquier otro jugador de la sala.
        const kickBtn = document.createElement("button");
        kickBtn.className = "lobby__kick";
        kickBtn.type = "button";
        kickBtn.textContent = "Expulsar";
        kickBtn.title = `Expulsar a ${p}`;
        kickBtn.addEventListener("click", () => {
          kickBtn.disabled = true;
          void kickPlayer(code, p).then((ok) => {
            if (ok) {
              channel.ping();
            } else {
              // No se borro la fila: la DB no tiene la policy de delete de
              // room_players (correr supabase/rooms.sql). Sin este aviso el
              // host clickea y no pasa nada.
              kickBtn.disabled = false;
              settingsError.textContent = `No se pudo expulsar a ${p}.`;
            }
            void refresh();
          });
        });
        li.append(kickBtn);
      }
      playersList.append(li);
    }

    if (isHost) {
      startBtn.style.display = "";
      const enough = present.length >= 2;
      startBtn.disabled = !enough || starting;
      waitingEl.textContent = enough
        ? ""
        : "Se necesitan al menos 2 jugadores conectados para empezar";
    } else {
      startBtn.style.display = "none";
      waitingEl.textContent = "Esperando a que el anfitrion empiece...";
    }
  };

  const stopVoteTick = (): void => {
    if (voteTickId !== null) {
      window.clearInterval(voteTickId);
      voteTickId = null;
    }
  };

  // Cierre de la votacion del primer juego (solo el host): elige el ganador por
  // mayoria (empate al azar) y arranca su briefing, igual que las rondas siguientes.
  const closeFirstVote = async (): Promise<void> => {
    if (!state || state.room.status !== "voting" || closingVote) return;
    if (state.room.host !== player) return;
    closingVote = true;
    const options = state.room.vote_options ?? [];
    const voteRound = state.room.current_round + 1;
    const counts = new Map<string, number>();
    for (const v of state.votes) {
      if (v.round_no === voteRound && options.includes(v.game_id)) {
        counts.set(v.game_id, (counts.get(v.game_id) ?? 0) + 1);
      }
    }
    const max = Math.max(0, ...counts.values());
    const top = max > 0 ? options.filter((id) => counts.get(id) === max) : options;
    const winner = top[Math.floor(Math.random() * top.length)];
    const ok = await startBriefing(
      code,
      voteRound,
      winner,
      new Date(Date.now() + BRIEFING_SECONDS * 1000),
    );
    if (!ok) {
      closingVote = false;
      return;
    }
    channel.ping();
    location.href = roomGameUrl(winner, code);
  };

  // Tick del countdown de la votacion; ademas el host la cierra al vencer el tope
  // o apenas votaron todos los presentes (a los ausentes no se los espera).
  const startVoteTick = (): void => {
    if (voteTickId !== null) return;
    voteTickId = window.setInterval(() => {
      if (!state || state.room.status !== "voting") {
        stopVoteTick();
        return;
      }
      const room = state.room;
      const deadline = room.deadline ? new Date(room.deadline).getTime() : null;
      const now = Date.now();
      if (deadline !== null && voteOverlay) voteOverlay.setTimeText(formatMMSS(deadline - now));
      if (room.host !== player) return;
      const options = room.vote_options ?? [];
      const voteRound = room.current_round + 1;
      const present = channel.presentPlayers();
      const registeredPresent = state.players.filter((p) => present.includes(p));
      const voters = new Set(
        state.votes
          .filter((v) => v.round_no === voteRound && options.includes(v.game_id))
          .map((v) => v.player),
      );
      const allPresentVoted =
        registeredPresent.length > 0 && registeredPresent.every((p) => voters.has(p));
      if (allPresentVoted || (deadline !== null && now >= deadline)) void closeFirstVote();
    }, 500);
  };

  // Muestra la votacion del primer juego en el lobby (todos), con las portadas.
  const renderFirstVote = (): void => {
    if (!state) return;
    const room = state.room;
    const options = room.vote_options ?? [];
    const voteRound = room.current_round + 1;
    const votes = state.votes.filter(
      (v) => v.round_no === voteRound && options.includes(v.game_id),
    );
    const counts: Record<string, number> = {};
    for (const v of votes) counts[v.game_id] = (counts[v.game_id] ?? 0) + 1;
    const myVote = votes.find((v) => v.player === player)?.game_id ?? null;

    if (!voteOverlay) voteOverlay = new RoomOverlay();
    voteOverlay.showVoting({
      round: voteRound,
      kicker: "Primera ronda",
      title: "Elegi el primer juego",
      options: options.map((id) => {
        const game = roomGames.find((g) => g.id === id);
        return { id, title: game?.title ?? id, accent: game?.accent, cover: coverUrl(id) };
      }),
      counts,
      myVote,
      onVote: (id) => {
        void castVote(code, voteRound, player, id).then((ok) => {
          if (ok) channel.ping();
          void refresh();
        });
      },
    });
    startVoteTick();
  };

  const refresh = async (): Promise<void> => {
    const fresh = await fetchRoomState(code);
    // La sala ya no existe (se vacio y se borro, o la purgo alguien).
    if (!fresh) {
      teardown();
      prefillCode = null;
      history.replaceState(null, "", "/rooms/");
      renderHome("La sala ya no existe.");
      return;
    }
    // El anfitrion me expulso: ya no estoy en la sala, vuelvo al inicio. Se
    // limpia el ?code de la URL para que un F5 no me vuelva a meter (autoJoin).
    if (!fresh.players.includes(player)) {
      teardown();
      prefillCode = null;
      history.replaceState(null, "", "/rooms/");
      renderHome("El anfitrion te saco de la sala.");
      return;
    }
    state = fresh;
    // La sala arranco (quiza desde otra pestana del host): todos adentro.
    if (fresh.room.status !== "lobby" && fresh.room.current_game) {
      location.href = roomGameUrl(fresh.room.current_game, code);
      return;
    }
    // Votacion del primer juego (sin playlist): se resuelve en el lobby, sin
    // juego fijado todavia (current_game nulo), asi que nadie navega aun.
    if (fresh.room.status === "voting") {
      renderFirstVote();
      return;
    }
    if (voteOverlay) voteOverlay.hide();
    stopVoteTick();
    render();
  };

  channel.onSync(() => void refresh());
  channel.onPresence(render);
  const pollId = window.setInterval(() => void refresh(), 5000);
  // Heartbeat: mientras alguien tenga el lobby abierto la sala esta viva. Al
  // cerrarse la ultima pestana deja de latir y la purga la borra.
  void touchRoom(code);
  const heartbeatId = window.setInterval(() => void touchRoom(code), HEARTBEAT_MS);
  void refresh();

  startBtn.addEventListener("click", () => {
    void (async () => {
      if (!state || starting) return;
      const isHost = state.room.host === player;
      // Si el host edito ajustes en el lobby, esos mandan (todavia no
      // refrescados en state); sino, los de la sala.
      const settings = isHost && hostSettings ? hostSettings : state.room.settings;
      // O playlist completa o vacia (igual que al crear).
      if (settings.playlist && settings.playlist.length !== settings.totalRounds) {
        settingsError.textContent = `Elegí ${settings.totalRounds} juegos o ninguno.`;
        return;
      }
      starting = true;
      render();
      // Persistir por las dudas antes de arrancar (el guardado al vuelo pudo
      // no haber terminado el round-trip).
      if (isHost && hostSettings) await updateSettings(code, hostSettings);

      if (settings.playlist) {
        // Playlist fija: el primer juego ya esta decidido, va directo al briefing
        // (de que va el juego + controles). El resto del flujo (votacion de tiempo
        // si esta activa, o el arranque de la partida) corre en la pagina del juego.
        const firstGame = settings.playlist[0];
        const ok = await startBriefing(
          code,
          1,
          firstGame,
          new Date(Date.now() + BRIEFING_SECONDS * 1000),
        );
        if (!ok) {
          starting = false;
          render();
          return;
        }
        channel.ping();
        location.href = roomGameUrl(firstGame, code);
        return;
      }

      // Sin playlist: se vota el primer juego aca en el lobby (mismo mecanismo que
      // las rondas siguientes). Al cerrar la votacion, el ganador va a su briefing.
      const ok = await openVote(code, pickVoteOptions(), new Date(Date.now() + VOTE_SECONDS * 1000));
      if (!ok) {
        starting = false;
        render();
        return;
      }
      channel.ping();
      void refresh();
    })();
  });
}
