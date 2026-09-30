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
  DAY_FINAL,
  DAY_LAST_ROUND,
  DAY_LOBBY,
  EMOTES,
  EYE_HEIGHT,
  FLAG_GROUNDED,
  FLAG_MOVING,
  HEAD_BOB,
  LOOKS,
  MAX_DT,
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
import { Hud } from "./Hud";
import { InputController } from "./InputController";
import { Island } from "./Island";
import { LobbySocket } from "./LobbySocket";
import type { LbPlayer, LbPos } from "./LobbyProtocol";
import { Player } from "./Player";
import { Sky, type Weather } from "./Sky";

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

/** Opciones de arranque sin sala (ver devRoom.ts). */
export interface HubDevOptions {
  me: string;
  code: string;
  roster: string[];
  day?: number;
  weather?: Weather;
}

function readLook(): number {
  try {
    const v = Number(localStorage.getItem(LOOK_KEY));
    if (Number.isInteger(v) && v >= 0 && v < LOOKS.length) return v;
  } catch {
    // sin storage: sin gorro
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

/**
 * La Isla: escena, muñecos, red y presentacion de las fases de la sala.
 *
 * Implementa `HubPresenter`: el mismo `RoomMode` que corre en cada juego llama
 * aca `showVoting` / `showBriefing` / `showResults` / `showFinal` / `showLobby`,
 * y la isla los traduce a portales encendidos, la plataforma LISTO, el pedestal
 * y el panel del HUD. Pararse en un portal o en la plataforma es exactamente lo
 * mismo que tocar el boton del overlay: llama al mismo `onVote` / `onReady`.
 */
export class Hub implements HubPresenter {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly sky: Sky;
  private readonly island: Island;
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

  private phase: Phase = "none";
  private voting: VotingView | null = null;
  private voteLocal: { round: number; id: string } | null = null;
  private briefing: BriefingView | null = null;
  private readyLocalRound = 0;
  private weatherKey = "";

  private last = performance.now();
  private lastSent = "";
  private lastSentAt = 0;
  private placed = false;

  constructor(container: HTMLElement) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.domElement.className = "isl-canvas";
    container.append(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(CAM_FOV, 1, 0.05, 900);
    // Primera persona: yaw alrededor de Y, despues pitch (si no, mirar arriba inclina el horizonte).
    this.camera.rotation.order = "YXZ";
    this.sky = new Sky(this.scene);
    this.island = new Island(lobbyGames);
    this.scene.add(this.island.group);

    this.hud = new Hud(container);
    this.input = new InputController(container);
    this.hud.onJump(() => this.input.requestJump());
    this.hud.onEmote((i) => this.emote(i));
    this.input.onEmote((i) => this.emote(i));
    this.input.onAimClick(() => this.aimClick());

    this.resize();
    window.addEventListener("resize", this.resize);
    requestAnimationFrame(this.tick);
    window.setInterval(this.sendPos, POS_SEND_MS);
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
    if (opts.day !== undefined) this.sky.setDay(opts.day, true);
    if (opts.weather) this.sky.setWeather(opts.weather);
    this.syncAvatars();
    this.connect();
  }

  showNoRoom(): void {
    this.hud.setTop("", "");
    this.hud.showMessage(
      "La Isla",
      "Entra desde una sala",
      "La Isla es la sala 3D: se abre al crear una sala 3D en Salas, o con el link que te pasaron.",
      { label: "Ir a las salas", onClick: () => (window.location.href = "/rooms/"), primary: true },
    );
  }

  private connect(): void {
    if (!isGameServerConfigured()) {
      this.hud.setNotice("Sin game server: la sala funciona, pero no ves a los demas en la isla.");
      return;
    }
    void resolveGameServerUrl().then((url) => {
      if (!url) return;
      const socket = new LobbySocket(url, this.code, this.me, this.look, () => this.roster);
      this.socket = socket;
      socket.onInit((players) => players.forEach((p) => this.applyRemote(p, p.look)));
      socket.onHi((p, look) => this.ensureRemote(p, look));
      socket.onBye((p) => this.dropRemote(p));
      socket.onPos((pos) => this.applyRemote(pos));
      socket.onEmote((p, e) => {
        if (p !== this.me) this.remotes.get(p)?.avatar.showEmote(EMOTES[e] ?? "");
      });
      void socket.connect();
    });
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
    const text = EMOTES[i];
    if (!text) return;
    // Los demas ven el globo sobre tu muñeco; vos, un cartel en pantalla.
    this.hud.flash(text);
    this.socket?.sendEmote(i);
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

  // ---------- HubPresenter ----------

  private lastLobby: HubLobbyView | null = null;

  private enter(phase: Phase): void {
    if (phase !== this.phase) {
      this.phase = phase;
      if (phase !== "voting") {
        this.voting = null;
        this.island.setVoting(null, {}, null);
      }
      if (phase !== "briefing") {
        this.briefing = null;
        this.island.setReady(false, false);
      }
      if (phase !== "lobby") this.lastLobby = null;
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
    this.island.setFeatured(null, "LA ISLA", `SALA ${view.code}`);
    this.hud.showLobby(view, { name: LOOKS[this.look], next: () => this.nextLook() });
  }

  showVoting(view: VotingView): void {
    this.enter("voting");
    this.voting = view;
    if (this.voteLocal && this.voteLocal.round !== (view.round ?? 0)) this.voteLocal = null;
    this.island.setFeatured(null, "VOTEN", "Parate en un portal");
    this.renderVoting();
  }

  /** Voto propio: el local (optimista) manda sobre el de la DB hasta que coinciden. */
  private renderVoting(): void {
    const view = this.voting;
    if (!view) return;
    const server = view.myVote;
    const mine = this.voteLocal?.id ?? server;
    const counts = { ...view.counts };
    if (mine && mine !== server) {
      counts[mine] = (counts[mine] ?? 0) + 1;
      if (server) counts[server] = Math.max(0, (counts[server] ?? 0) - 1);
    }
    if (this.voteLocal && server === this.voteLocal.id) this.voteLocal = null;
    this.island.setVoting(
      view.options.map((o) => ({ id: o.id, accent: o.accent ?? "#4dabf7" })),
      counts,
      mine,
    );
    this.hud.showVoting({ ...view, counts, onVote: (id) => this.vote(id) }, mine);
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
    this.island.setReady(true, ready);
    this.island.setFeatured(view.gameId ?? null, view.gameTitle, "");
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
    this.island.setFeatured(gameId, view.gameTitle, "");
    this.hud.showResults(view);
  }

  showFinal(totals: TotalEntry[], me: string, opts?: FinalView): void {
    this.enter("final");
    const winners = totals.filter((t) => t.rank === 1).map((t) => t.player);
    this.island.setFeatured(null, "FINAL", winners.length === 1 ? `Gano ${winners[0]}` : winners.length > 1 ? "Empate" : "");
    this.hud.showFinal(totals, me, opts ?? { hostAction: null, waitingText: null });
  }

  showWaiting(_entries: WaitingEntry[], _me: string): void {
    // La isla no juega, asi que nunca espera un puntaje propio.
  }

  showSpectator(): void {
    this.enter("none");
    this.hud.showMessage("Sala", "Modo espectador", "La partida ya empezo: vas a poder jugar cuando termine.");
  }

  showConnecting(): void {
    this.enter("none");
    this.hud.showMessage("La Isla", "Conectando...", "Buscando la sala.");
  }

  showError(message: string): void {
    this.enter("none");
    this.hud.showMessage("La Isla", "Ups", message, {
      label: "Volver a las salas",
      onClick: () => (window.location.href = "/rooms/"),
      primary: true,
    });
  }

  setStrip(_text: string | null, _lights?: StripLight[]): void {
    // La isla tiene su propia barra (Hud.setTop).
  }

  setTimeText(text: string | null): void {
    this.hud.setClock(text);
  }

  hide(): void {
    this.hud.hidePanel();
  }

  // ---------- Cielo ----------

  /** Hora del dia segun la sala: lobby a la mañana, cada ronda jugada avanza, la final es de noche. */
  private updateDay(): void {
    const room = this.room;
    if (!room) return;
    const status = room.status();
    const total = room.totalRoundsOrZero();
    const round = room.currentRound();
    let done = 0;
    if (status === "briefing") done = Math.max(0, round - 1);
    else if (status === "results" || status === "voting" || status === "playing") done = round;

    let day = DAY_LOBBY;
    if (status === "finished") day = DAY_FINAL;
    else if (status !== "lobby" && total > 0) day = DAY_LOBBY + ((DAY_LAST_ROUND - DAY_LOBBY) * done) / total;
    this.sky.setDay(day);

    // Clima: igual para todos (semilla = sala + rondas jugadas). Lobby y final, despejado.
    const key = `${this.code}:${status === "finished" ? "fin" : status === "lobby" ? "lobby" : done}`;
    if (key !== this.weatherKey) {
      this.weatherKey = key;
      let w: Weather = "clear";
      if (status !== "finished" && status !== "lobby" && done > 0) {
        const r = (hashString(key) % 1000) / 1000;
        w = r < 0.6 ? "clear" : r < 0.85 ? "cloudy" : "rain";
      }
      this.sky.setWeather(w);
    }
  }

  // ---------- Loop ----------

  private tick = (now: number): void => {
    requestAnimationFrame(this.tick);
    const dt = Math.min(MAX_DT, (now - this.last) / 1000);
    this.last = now;

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
    p.update(dt, dir, this.input.consumeJump(), this.island);
    this.hud.setJoystick(this.input.joystick);
    if (p.respawned) {
      p.respawned = false;
      this.hud.flash("Ups");
    }

    // Pisar un portal es votar; subirse a la plataforma, marcar listo.
    if (p.grounded && this.voting) {
      const id = this.island.portalAt(p.x, p.z);
      if (id) this.vote(id);
    }
    if (p.grounded && this.briefing && this.island.onReadyPad(p.x, p.y, p.z)) this.ready();

    this.updateRemotes(dt);
    this.updateCamera(dt);
    this.updateAim();
    this.updateDay();
    this.sky.update(dt, this.camera.position);
    this.island.update(dt);
    this.renderer.render(this.scene, this.camera);
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
    const g = this.island.groundAt(x, z);
    if (g === -Infinity || y < g - 0.5) {
      avatar.shadow.visible = false;
      return;
    }
    avatar.shadow.visible = avatar.root.visible;
    avatar.shadow.position.set(x, g + 0.02, z);
    const s = Math.max(0.4, 1 - (y - g) * 0.15);
    avatar.shadow.scale.setScalar(s);
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
    return this.island.pick(this.aim, AIM_RANGE);
  }

  private updateAim(): void {
    this.hud.setAim(this.input.locked, this.aimed() !== null);
  }

  /** Clic con el mouse capturado: apuntar a un portal vota; a la plataforma, listo. */
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
    this.camera.aspect = w / h;
    this.camera.fov = w < h ? CAM_FOV_PORTRAIT : CAM_FOV;
    this.camera.updateProjectionMatrix();
  };
}
