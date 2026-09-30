import * as THREE from "three";
import { games } from "../../games";
import { lobbyGames } from "../../shared/room/hub";
import {
  initRoomHub,
  type HubLobbyView,
  type HubPresenter,
  type RoomHub,
} from "../../shared/room/roomMode";
import type {
  BriefingView,
  FinalView,
  ResultsView,
  StripLight,
  TotalEntry,
  VotingView,
  WaitingEntry,
} from "../../shared/room/RoomOverlay";
import { isGameServerConfigured, resolveGameServerUrl } from "../../shared/server-status";
import {
  AIM_RANGE,
  CAM_FOV,
  CAM_FOV_PORTRAIT,
  CLOCK_PING_MS,
  DREAD_FINAL,
  DREAD_LAST_ROUND,
  DREAD_LOBBY,
  EMOTE_COOLDOWN_MS,
  EMOTES,
  EYE_HEIGHT,
  FLAG_GROUNDED,
  FLAG_MOVING,
  HEAD_BOB,
  LOOKS,
  MAX_DT,
  MIN_CLIMB_MS,
  PITCH_LIMIT,
  POS_IDLE_MS,
  POS_SEND_MS,
  REMOTE_EASE,
  REMOTE_SNAP_DIST,
  SPAWN_Z,
  START_PITCH,
  seatColor,
} from "./constants";
import { Avatar } from "./Avatar";
import { Fireworks } from "./Fireworks";
import { Hud } from "./Hud";
import { InputController } from "./InputController";
import { LobbySocket } from "./LobbySocket";
import type { LbCrown, LbPlayer, LbPos } from "./LobbyProtocol";
import { Night, type Weather } from "./Night";
import { Player } from "./Player";
import { RetroPass } from "./retro";
import { Scoreboard, type BoardEntry } from "./Scoreboard";
import { playBurst, playEmote, playHorn, playHornFanfare, playLaunch, preloadEmotes, unlockAudio } from "./Sounds";
import { World } from "./World";

const LOOK_KEY = "mg:island-look";

interface Remote {
  avatar: Avatar;
  color: string;
  look: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  tx: number;
  ty: number;
  tz: number;
  tyaw: number;
  flags: number;
  speed: number;
  vy: number;
  seen: boolean;
}

type Phase = "none" | "lobby" | "voting" | "briefing" | "results" | "final";

/** Carrera de la torre: `armed` = parado en la largada; `running` = subiendo. */
type Run = "idle" | "armed" | "running";

/** Opciones de arranque sin sala (ver devRoom.ts). */
export interface HubDevOptions {
  me: string;
  code: string;
  roster: string[];
  dread?: number;
  weather?: Weather;
}

function readLook(): number {
  try {
    const v = Number(localStorage.getItem(LOOK_KEY));
    if (Number.isInteger(v) && v >= 0 && v < LOOKS.length) return v;
  } catch {
    // sin storage: sin accesorio
  }
  return 0;
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** "1:12.34" */
export function formatClimb(ms: number): string {
  const total = Math.max(0, ms) / 1000;
  const m = Math.floor(total / 60);
  const s = total - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, "0")}`;
}

/**
 * La Feria: escena, muñecos, red, la torre y la presentacion de las fases de la sala.
 *
 * Implementa `HubPresenter`: el mismo `RoomMode` que corre en cada juego llama aca
 * `showVoting` / `showBriefing` / `showResults` / `showFinal` / `showLobby`, y la
 * feria los traduce a afiches encendidos, el escenario LISTO, el televisor y el panel
 * del HUD. Pararse en una chapa o en el escenario es exactamente lo mismo que tocar
 * el boton del overlay: llama al mismo `onVote` / `onReady`.
 */
export class Hub implements HubPresenter {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly retro = new RetroPass();
  private readonly night: Night;
  private readonly world: World;
  private readonly scoreboard = new Scoreboard();
  private readonly fireworks = new Fireworks();
  private readonly hud: Hud;
  private readonly input: InputController;
  private readonly player = new Player();
  private readonly remotes = new Map<string, Remote>();
  private readonly container: HTMLElement;
  /** Mirada en primera persona (la maneja el jugador con el mouse o el dedo). */
  private camYaw = 0;
  private camPitch = START_PITCH;
  private bobPhase = 0;
  private readonly aim = new THREE.Raycaster();
  private readonly screenCenter = new THREE.Vector2(0, 0);

  private room: RoomHub | null = null;
  private socket: LobbySocket | null = null;
  private me = "";
  private code = "";
  private roster: string[] = [];
  private look = readLook();

  /** Reloj compartido: Date.now() del server = Date.now() local + offset (ver `onPong`). */
  private clockOffset = 0;
  private bestRtt = Infinity;

  private run: Run = "idle";
  private runStart = 0;
  private crown: LbCrown | null = null;

  private phase: Phase = "none";
  private voting: VotingView | null = null;
  private voteLocal: { round: number; id: string } | null = null;
  private briefing: BriefingView | null = null;
  private readyLocalRound = 0;
  private weatherKey = "";

  private last = performance.now();
  private lastEmoteAt = 0;
  /** Proxima corneta suelta durante la final (ms de performance.now). */
  private nextHornAt = 0;
  private lastSent = "";
  private lastSentAt = 0;
  private placed = false;

  constructor(container: HTMLElement) {
    this.container = container;
    // Sin antialias: la imagen se dibuja chica y se estira con pixeles duros (retro.ts).
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.domElement.className = "isl-canvas";
    container.append(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(CAM_FOV, 1, 0.05, 400);
    // Primera persona: yaw alrededor de Y, despues pitch (si no, mirar arriba inclina el horizonte).
    this.camera.rotation.order = "YXZ";
    this.night = new Night(this.scene);
    this.world = new World(lobbyGames);
    this.scene.add(this.world.group);
    // El marcador vive en la plaza y choca como el resto.
    this.world.group.add(this.scoreboard.group);
    this.world.world.circles.push(...this.scoreboard.colliders);
    this.scene.add(this.fireworks.group);
    this.world.tower.setRecord("Sin record", false);

    this.hud = new Hud(container);
    this.input = new InputController(container);
    this.hud.onJump(() => this.input.requestJump());
    this.hud.onEmote((i) => this.emote(i));
    this.input.onEmote((i) => this.emote(i));
    this.input.onAimClick(() => this.aimClick());

    // Sonido: el navegador lo tiene suspendido hasta el primer gesto.
    preloadEmotes();
    for (const type of ["pointerdown", "keydown"]) window.addEventListener(type, unlockAudio, { passive: true });
    this.fireworks.onLaunch = () => playLaunch(0.8);
    this.fireworks.onBurst = () => playBurst(0.8);

    this.resize();
    window.addEventListener("resize", this.resize);
    requestAnimationFrame(this.tick);
    window.setInterval(this.sendPos, POS_SEND_MS);
    window.setInterval(() => this.socket?.ping(), CLOCK_PING_MS);
  }

  // ---------- Arranque ----------

  /** Arranca contra la sala real (`?code=`). false si no hay sala que abrir. */
  startRoom(): boolean {
    const room = initRoomHub(this);
    if (!room) return false;
    this.room = room;
    this.me = room.me;
    this.code = room.code;
    this.hud.setTop(this.code, "");
    room.onChange(() => this.onRoomChange());
    this.connect();
    return true;
  }

  /** Sin sala: para probar la escena y la red en dev (devRoom.ts). */
  startDev(opts: HubDevOptions): void {
    this.me = opts.me;
    this.code = opts.code;
    this.roster = opts.roster;
    this.hud.setTop(this.code, "dev");
    if (opts.dread !== undefined) this.night.setDread(opts.dread, true);
    if (opts.weather) this.night.setWeather(opts.weather);
    this.syncAvatars();
    this.connect();
  }

  /**
   * Dev: una fila de muñecos quietos delante del spawn, uno por accesorio y el ultimo
   * con la corona, para revisarlos de cerca sin abrir varios navegadores.
   */
  devDolls(): void {
    const n = LOOKS.length + 1;
    for (let i = 0; i < n; i++) {
      const a = new Avatar(seatColor(i), i < LOOKS.length ? LOOKS[i] : "Corona", i % LOOKS.length, i);
      a.root.position.set((i - (n - 1) / 2) * 1.1, 0, SPAWN_Z - 1.2);
      if (i === LOOKS.length) a.setCrown(true);
      a.animate(0.016, 0, true, 0);
      this.scene.add(a.root, a.shadow);
      a.shadow.position.set(a.root.position.x, 0.03, a.root.position.z);
    }
  }

  showNoRoom(): void {
    this.hud.setTop("", "");
    this.hud.showMessage(
      "La Feria",
      "Entra desde una sala",
      "La Feria es la sala 3D: se abre al crear una sala 3D en Salas, o con el link que te pasaron.",
      { label: "Ir a las salas", onClick: () => (window.location.href = "/rooms/"), primary: true },
    );
  }

  private connect(): void {
    if (!isGameServerConfigured()) {
      this.hud.setNotice("Sin game server: la sala funciona, pero no ves a los demas en la feria.");
      return;
    }
    void resolveGameServerUrl().then((url) => {
      if (!url) return;
      const socket = new LobbySocket(url, this.code, this.me, this.look, () => this.roster);
      this.socket = socket;
      socket.onInit((players, crown) => {
        players.forEach((p) => this.applyRemote(p, p.look));
        this.setCrown(crown, false);
        socket.ping();
      });
      socket.onHi((p, look) => this.ensureRemote(p, look));
      socket.onBye((p) => this.dropRemote(p));
      socket.onPos((pos) => this.applyRemote(pos));
      socket.onEmote((p, e) => this.remoteEmote(p, e));
      socket.onPong((c, t) => this.onPong(c, t));
      socket.onSummit((s) => {
        if (s.p !== this.me) this.hud.announce(`${s.p} llego a la cima: ${formatClimb(s.ms)}`);
      });
      socket.onCrown((c) => this.setCrown(c, true));
      void socket.connect();
    });
  }

  /**
   * Reloj del server: se queda con la muestra de menor ida y vuelta (la que menos
   * jitter comio). Lo que se mueve en la torre sale de este reloj, asi todos lo ven en
   * el mismo lugar.
   */
  private onPong(sent: number, serverNow: number): void {
    const now = Date.now();
    const rtt = now - sent;
    if (rtt < 0 || rtt > 5000) return;
    // Una muestra vieja con buen RTT se va gastando: los relojes derivan.
    this.bestRtt += 2;
    if (rtt > this.bestRtt) return;
    this.bestRtt = rtt;
    this.clockOffset = serverNow + rtt / 2 - now;
  }

  /** Segundos del reloj compartido (el de la torre). */
  private worldTime(): number {
    return ((Date.now() + this.clockOffset) % 86_400_000) / 1000;
  }

  // ---------- Sala ----------

  private onRoomChange(): void {
    if (!this.room) return;
    this.roster = this.room.players();
    this.syncAvatars();
    const present = new Set(this.room.presentPlayers());
    for (const [name, r] of this.remotes) r.avatar.setOffline(!present.has(name));
  }

  private seatOf(name: string): number {
    const i = this.roster.indexOf(name);
    return i >= 0 ? i : hashString(name) % 8;
  }

  /**
   * Ubica al jugador la primera vez y recolorea a quien le cambio el asiento. El
   * muñeco propio no se dibuja: en primera persona uno esta adentro de el.
   */
  private syncAvatars(): void {
    if (!this.placed) {
      this.placed = true;
      const seat = this.seatOf(this.me);
      const a = (seat / 8) * Math.PI * 2;
      const x = Math.sin(a) * 1.8;
      const z = SPAWN_Z + Math.cos(a) * 1.2;
      this.player.setSpawn(x, z);
      this.player.placeAt(x, 0, z);
    }
    for (const [name, r] of this.remotes) {
      const c = seatColor(this.seatOf(name));
      if (c !== r.color) this.rebuildRemote(name, r, c);
    }
  }

  private ensureRemote(name: string, look: number): Remote | null {
    if (!name || name === this.me) return null;
    let r = this.remotes.get(name);
    if (!r) {
      const color = seatColor(this.seatOf(name));
      const avatar = new Avatar(color, name, look, hashString(name));
      avatar.visible = false;
      avatar.setCrown(this.crown?.p === name);
      this.scene.add(avatar.root, avatar.shadow);
      r = { avatar, color, look, x: 0, y: 0, z: 0, yaw: 0, tx: 0, ty: 0, tz: 0, tyaw: 0, flags: 0, speed: 0, vy: 0, seen: false };
      this.remotes.set(name, r);
    } else if (look !== r.look) {
      r.look = look;
      r.avatar.setLook(look, r.color);
    }
    return r;
  }

  private rebuildRemote(name: string, r: Remote, color: string): void {
    this.scene.remove(r.avatar.root, r.avatar.shadow);
    r.avatar.dispose();
    r.avatar = new Avatar(color, name, r.look, hashString(name));
    r.avatar.visible = r.seen;
    r.avatar.setCrown(this.crown?.p === name);
    r.color = color;
    this.scene.add(r.avatar.root, r.avatar.shadow);
  }

  private dropRemote(name: string): void {
    const r = this.remotes.get(name);
    if (!r) return;
    this.scene.remove(r.avatar.root, r.avatar.shadow);
    r.avatar.dispose();
    this.remotes.delete(name);
  }

  private applyRemote(pos: LbPos | LbPlayer, look?: number): void {
    const r = this.ensureRemote(pos.p, look ?? this.remotes.get(pos.p)?.look ?? 0);
    if (!r) return;
    r.tx = pos.x;
    r.ty = pos.y;
    r.tz = pos.z;
    r.tyaw = pos.r;
    r.flags = pos.f;
    if (!r.seen || Math.hypot(r.tx - r.x, r.tz - r.z) > REMOTE_SNAP_DIST) {
      r.x = r.tx;
      r.y = r.ty;
      r.z = r.tz;
      r.yaw = r.tyaw;
    }
    r.seen = true;
    r.avatar.visible = true;
  }

  private emote(i: number): void {
    const emote = EMOTES[i];
    if (!emote) return;
    const now = performance.now();
    // Mismo cooldown que el server (lo descartaria en silencio).
    if (now - this.lastEmoteAt < EMOTE_COOLDOWN_MS) return;
    this.lastEmoteAt = now;
    // Los demas ven la carita sobre tu muñeco; vos, en pantalla. El sonido, todos.
    this.hud.flashEmote(emote.id, emote.label);
    playEmote(emote.id);
    this.socket?.sendEmote(i);
  }

  /**
   * Reaccion de otro: la carita y el gesto sobre su muñeco, y el sonido mas bajo cuanto
   * mas lejos este, del lado donde esta (izquierda / derecha de adonde uno mira).
   */
  private remoteEmote(player: string, e: number): void {
    const emote = EMOTES[e];
    const r = this.remotes.get(player);
    if (!emote || player === this.me || !r) return;
    r.avatar.showEmote(emote.id);
    const dx = r.x - this.player.x;
    const dz = r.z - this.player.z;
    const dist = Math.hypot(dx, dz);
    const gain = Math.max(0.2, Math.min(1, 1.3 - dist / 25));
    // Derecha de la camara = (cos yaw, -sin yaw).
    const pan = dist > 0.5 ? (dx * Math.cos(this.camYaw) - dz * Math.sin(this.camYaw)) / dist : 0;
    playEmote(emote.id, gain, pan * 0.8);
  }

  private nextLook(): void {
    this.look = (this.look + 1) % LOOKS.length;
    try {
      localStorage.setItem(LOOK_KEY, String(this.look));
    } catch {
      // sin storage: dura hasta recargar
    }
    // El accesorio viaja en el join: reconectar es la forma mas simple de avisarlo.
    this.socket?.dispose();
    this.socket = null;
    this.connect();
    if (this.lastLobby) this.showLobby(this.lastLobby);
  }

  // ---------- La Torre ----------

  /**
   * Carrera de la torre: se arma parado en la largada, arranca al salir de ella y
   * termina al pararse en la cima. Tocar el piso del claro fuera de la largada la
   * anula (hay que volver a empezar).
   */
  private updateRun(): void {
    const p = this.player;
    const tower = this.world.tower;
    const onStart = p.onGround && tower.onStart(p.x, p.z);
    if (onStart) {
      if (this.run !== "armed") {
        this.run = "armed";
        this.hud.setRun("En la largada");
      }
      return;
    }
    if (this.run === "armed") {
      this.run = "running";
      this.runStart = performance.now();
    }
    if (this.run !== "running") return;
    const ms = performance.now() - this.runStart;
    if (p.onGround) {
      this.run = "idle";
      this.hud.setRun(null);
      this.hud.flash("Al piso");
      return;
    }
    if (p.standingOn === tower.topBox) {
      this.run = "idle";
      this.hud.setRun(null);
      this.finishClimb(ms);
      return;
    }
    this.hud.setRun(formatClimb(ms));
  }

  private finishClimb(ms: number): void {
    this.hud.flash(`Cima: ${formatClimb(ms)}`);
    if (ms < MIN_CLIMB_MS) return;
    if (this.socket?.connected) {
      this.socket.sendTop(ms);
    } else if (!this.crown || ms < this.crown.ms) {
      // Sin server (dev sin red): la corona es local.
      this.setCrown({ p: this.me, ms }, true);
    }
  }

  /** El record de la sala cambio de dueño (o llego con el join). */
  private setCrown(crown: LbCrown | null, announce: boolean): void {
    const prev = this.crown?.p;
    this.crown = crown;
    for (const [name, r] of this.remotes) r.avatar.setCrown(crown?.p === name);
    this.world.tower.setRecord(crown ? `Record: ${crown.p} ${formatClimb(crown.ms)}` : "Sin record", !!crown);
    this.hud.setRecord(crown ? `${crown.p} ${formatClimb(crown.ms)}` : null, crown?.p === this.me);
    if (announce && crown) {
      if (crown.p === this.me) this.hud.announce(prev && prev !== this.me ? `Le sacaste la corona a ${prev}` : "La corona es tuya");
      else this.hud.announce(`${crown.p} tiene la corona: ${formatClimb(crown.ms)}`);
    }
  }

  // ---------- HubPresenter ----------

  private lastLobby: HubLobbyView | null = null;

  private enter(phase: Phase): void {
    if (phase !== this.phase) {
      this.phase = phase;
      if (phase !== "voting") {
        this.voting = null;
        this.world.setVoting(null, {}, null);
      }
      if (phase !== "briefing") {
        this.briefing = null;
        this.world.setReady(false, false);
      }
      if (phase !== "lobby") this.lastLobby = null;
      if (phase !== "results" && phase !== "final") this.scoreboard.set(null, false, "");
      this.fireworks.setActive(phase === "final");
      if (phase === "final") {
        playHornFanfare();
        this.nextHornAt = performance.now() + 4000;
      }
    }
    const labels: Record<Phase, string> = {
      none: "",
      lobby: "Lobby",
      voting: "Votacion",
      briefing: "Proximo juego",
      results: "Resultados",
      final: "Final",
    };
    this.hud.setTop(this.code, labels[phase]);
    if (phase === "lobby" || phase === "final" || phase === "none") this.hud.setClock(null);
  }

  showLobby(view: HubLobbyView): void {
    this.enter("lobby");
    this.lastLobby = view;
    this.world.setFeatured(null, `SALA ${view.code}`);
    this.hud.showLobby(view, { name: LOOKS[this.look], next: () => this.nextLook() });
  }

  showVoting(view: VotingView): void {
    this.enter("voting");
    this.voting = view;
    if (this.voteLocal && this.voteLocal.round !== (view.round ?? 0)) this.voteLocal = null;
    this.world.setFeatured(null, "VOTEN");
    this.renderVoting();
  }

  /** Voto propio: el local (optimista) manda sobre el de la DB hasta que coinciden. */
  private renderVoting(): void {
    const view = this.voting;
    if (!view) return;
    const server = view.myVote;
    const mine = this.voteLocal?.id ?? server;
    const counts = { ...view.counts };
    const voters: Record<string, string[]> = {};
    for (const [id, list] of Object.entries(view.voters ?? {})) voters[id] = [...list];
    if (mine && mine !== server) {
      counts[mine] = (counts[mine] ?? 0) + 1;
      if (server) counts[server] = Math.max(0, (counts[server] ?? 0) - 1);
      // Optimista tambien en los nombres: me muevo de un afiche al otro al toque.
      if (server) voters[server] = (voters[server] ?? []).filter((p) => p !== this.me);
      (voters[mine] ??= []).push(this.me);
    }
    // El propio va primero: si no, con varios votos quedaba escondido en el "+N".
    for (const list of Object.values(voters)) {
      const k = list.indexOf(this.me);
      if (k > 0) list.unshift(...list.splice(k, 1));
    }
    if (this.voteLocal && server === this.voteLocal.id) this.voteLocal = null;
    this.world.setVoting(
      view.options.map((o) => ({ id: o.id, accent: o.accent ?? "#ff3b30" })),
      counts,
      mine,
      voters,
    );
    this.hud.showVoting({ ...view, counts, voters, onVote: (id) => this.vote(id) }, mine);
  }

  private vote(id: string): void {
    const view = this.voting;
    if (!view) return;
    const mine = this.voteLocal?.id ?? view.myVote;
    if (mine === id) return;
    this.voteLocal = { round: view.round ?? 0, id };
    view.onVote(id);
    this.renderVoting();
  }

  showBriefing(view: BriefingView): void {
    this.enter("briefing");
    this.briefing = view;
    const ready = view.iAmReady || this.readyLocalRound === view.round;
    this.world.setReady(true, ready);
    this.world.setFeatured(view.gameId ?? null, view.gameTitle);
    this.hud.showBriefing({ ...view, onReady: () => this.ready() }, ready);
  }

  private ready(): void {
    const view = this.briefing;
    if (!view || view.iAmReady || this.readyLocalRound === view.round) return;
    this.readyLocalRound = view.round;
    view.onReady();
    this.showBriefing(view);
  }

  showResults(view: ResultsView): void {
    this.enter("results");
    const gameId = games.find((g) => g.title === view.gameTitle)?.id ?? null;
    this.world.setFeatured(gameId, view.gameTitle);
    const gained = new Map(view.rows.map((r) => [r.player, r.points]));
    this.setBoard(view.totals, false, `r${view.roundNo}`, gained);
    this.hud.showResults(view);
  }

  showFinal(totals: TotalEntry[], me: string, opts?: FinalView): void {
    this.enter("final");
    this.world.setFeatured(null, "FIN");
    this.setBoard(totals, true, "final");
    this.hud.showFinal(totals, me, opts ?? { hostAction: null, waitingText: null });
  }

  /** Columnas de la plaza con los puntos acumulados (y lo que sumo cada uno en la ronda). */
  private setBoard(totals: TotalEntry[], final: boolean, key: string, gained?: Map<string, number>): void {
    const entries: BoardEntry[] = totals.map((t) => ({
      player: t.player,
      color: seatColor(this.seatOf(t.player)),
      points: t.points,
      rank: t.rank,
      gained: gained?.get(t.player),
    }));
    this.scoreboard.set(entries, final, key);
  }

  showWaiting(_entries: WaitingEntry[], _me: string): void {
    // La feria no juega, asi que nunca espera un puntaje propio.
  }

  showSpectator(): void {
    this.enter("none");
    this.hud.showMessage("Sala", "Modo espectador", "La partida ya empezo: vas a poder jugar cuando termine.");
  }

  showConnecting(): void {
    this.enter("none");
    this.hud.showMessage("La Feria", "Conectando...", "Buscando la sala.");
  }

  showError(message: string): void {
    this.enter("none");
    this.hud.showMessage("La Feria", "Ups", message, {
      label: "Volver a las salas",
      onClick: () => (window.location.href = "/rooms/"),
      primary: true,
    });
  }

  setStrip(_text: string | null, _lights?: StripLight[]): void {
    // La feria tiene su propia barra (Hud.setTop).
  }

  setTimeText(text: string | null): void {
    this.hud.setClock(text);
  }

  hide(): void {
    this.hud.hidePanel();
  }

  // ---------- La noche ----------

  /**
   * Cuanto empeoro la noche segun la sala: el lobby esta "abierto", cada ronda jugada
   * la oscurece y la final es roja. El clima sale de una semilla (sala + rondas).
   */
  private updateDread(): void {
    const room = this.room;
    if (!room) return;
    const status = room.status();
    const total = room.totalRoundsOrZero();
    const round = room.currentRound();
    let done = 0;
    if (status === "briefing") done = Math.max(0, round - 1);
    else if (status === "results" || status === "voting" || status === "playing") done = round;

    let dread = DREAD_LOBBY;
    if (status === "finished") dread = DREAD_FINAL;
    else if (status !== "lobby" && total > 0) dread = DREAD_LOBBY + ((DREAD_LAST_ROUND - DREAD_LOBBY) * done) / total;
    this.night.setDread(dread);

    const key = `${this.code}:${status === "finished" ? "fin" : status === "lobby" ? "lobby" : done}`;
    if (key !== this.weatherKey) {
      this.weatherKey = key;
      let w: Weather = "clear";
      if (status !== "finished" && status !== "lobby" && done > 0) {
        const r = (hashString(key) % 1000) / 1000;
        w = r < 0.55 ? "clear" : r < 0.8 ? "fog" : "rain";
      }
      this.night.setWeather(w);
    }
  }

  // ---------- Loop ----------

  private tick = (now: number): void => {
    requestAnimationFrame(this.tick);
    const dt = Math.min(MAX_DT, (now - this.last) / 1000);
    this.last = now;
    const t = this.worldTime();

    const look = this.input.consumeLook();
    this.camYaw += look.yaw;
    this.camPitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, this.camPitch + look.pitch));

    // WASD / joystick relativos a la mirada: adelante = hacia donde apunta la camara.
    const m = this.input.move;
    const sin = Math.sin(this.camYaw);
    const cos = Math.cos(this.camYaw);
    const dir = { x: m.side * cos - m.forward * sin, z: -m.side * sin - m.forward * cos };
    const p = this.player;
    p.yaw = this.camYaw + Math.PI;
    p.update(dt, dir, this.input.consumeJump(), this.world.world, t);
    this.hud.setJoystick(this.input.joystick);
    if (p.respawned) {
      p.respawned = false;
      this.hud.flash("Ups");
    }
    if (p.knocked) this.hud.flash("Pum");
    this.updateRun();

    // Pisar una chapa es votar; subirse al escenario, marcar listo.
    if (p.onGround && this.voting) {
      const id = this.world.portalAt(p.x, p.z);
      if (id) this.vote(id);
    }
    if (this.briefing && this.world.onReadyPad(p.standingOn)) this.ready();

    this.updateRemotes(dt);
    this.updateCamera(dt);
    this.updateAim();
    this.updateDread();
    this.night.update(dt, this.camera.position);
    this.world.setDread(this.night.current);
    this.world.update(dt, t);
    this.scoreboard.update(dt);
    this.world.setTvSink(this.scoreboard.raise);
    this.fireworks.update(dt);
    // Durante la final, alguna corneta suelta de vez en cuando.
    if (this.phase === "final" && now > this.nextHornAt) {
      this.nextHornAt = now + 3500 + Math.random() * 5000;
      playHorn(0, [294, 349, 392, 440][Math.floor(Math.random() * 4)], 0.7);
    }
    this.retro.setTint(this.night.tint);
    this.retro.render(this.renderer, this.scene, this.camera, dt);
  };

  private updateRemotes(dt: number): void {
    const k = 1 - Math.exp(-REMOTE_EASE * dt);
    for (const r of this.remotes.values()) {
      if (!r.seen) continue;
      const px = r.x;
      const pz = r.z;
      const py = r.y;
      r.x += (r.tx - r.x) * k;
      r.y += (r.ty - r.y) * k;
      r.z += (r.tz - r.z) * k;
      let d = r.tyaw - r.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      r.yaw += d * k;
      if (dt > 0) {
        r.speed += (Math.hypot(r.x - px, r.z - pz) / dt - r.speed) * Math.min(1, dt * 10);
        r.vy = (r.y - py) / dt;
      }
      const moving = (r.flags & FLAG_MOVING) !== 0;
      const grounded = (r.flags & FLAG_GROUNDED) !== 0;
      r.avatar.root.position.set(r.x, r.y, r.z);
      r.avatar.root.rotation.y = r.yaw;
      r.avatar.animate(dt, moving ? Math.max(r.speed, 2.5) : 0, grounded, r.vy);
      this.placeShadow(r.avatar, r.x, r.y, r.z);
    }
  }

  private placeShadow(avatar: Avatar, x: number, y: number, z: number): void {
    const g = this.world.supportAt(x, y, z);
    avatar.shadow.visible = avatar.root.visible;
    avatar.shadow.position.set(x, g + 0.03, z);
    avatar.shadow.scale.setScalar(Math.max(0.35, 1 - (y - g) * 0.12));
  }

  /** Ojos del muñeco, con un balanceo apenas perceptible al caminar. */
  private updateCamera(dt: number): void {
    const p = this.player;
    const speed = Math.hypot(p.vx, p.vz);
    if (p.grounded && speed > 0.5) this.bobPhase += dt * (4 + speed * 1.4);
    const bob = p.grounded ? Math.abs(Math.sin(this.bobPhase)) * HEAD_BOB * Math.min(1, speed / 4) : 0;
    this.camera.position.set(p.x, p.y + EYE_HEIGHT + bob, p.z);
    this.camera.rotation.set(this.camPitch, this.camYaw, 0);
  }

  /** Lo que hay en la mira, para resaltar el punto del centro. */
  private aimed(): { portal: string } | { ready: true } | null {
    if (!this.voting && !this.briefing) return null;
    this.aim.setFromCamera(this.screenCenter, this.camera);
    return this.world.pick(this.aim, AIM_RANGE);
  }

  private updateAim(): void {
    this.hud.setAim(this.input.locked, this.aimed() !== null);
  }

  /** Clic con el mouse capturado: apuntar a un afiche vota; al escenario, listo. */
  private aimClick(): void {
    const hit = this.aimed();
    if (!hit) return;
    if ("portal" in hit) this.vote(hit.portal);
    else this.ready();
  }

  private sendPos = (): void => {
    if (!this.socket?.connected) return;
    const p = this.player;
    const r2 = (v: number): number => Math.round(v * 100) / 100;
    const f = (p.grounded ? FLAG_GROUNDED : 0) | (p.moving ? FLAG_MOVING : 0);
    const snap = [r2(p.x), r2(p.y), r2(p.z), r2(p.yaw), f];
    const key = snap.join(",");
    const now = performance.now();
    // Solo si cambio algo; quieto, un keepalive por segundo (el que llega lo necesita).
    if (key === this.lastSent && now - this.lastSentAt < POS_IDLE_MS) return;
    this.lastSent = key;
    this.lastSentAt = now;
    this.socket.sendPos(snap[0], snap[1], snap[2], snap[3], f);
  };

  private resize = (): void => {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h);
    this.retro.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.fov = w < h ? CAM_FOV_PORTRAIT : CAM_FOV;
    this.camera.updateProjectionMatrix();
  };
}
