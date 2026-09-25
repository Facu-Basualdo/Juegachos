import * as THREE from "three";
import { initRoomMode, isRoomMode } from "../../../shared/room/roomMode";
import { isGameServerConfigured, resolveGameServerUrl } from "../../../shared/server-status";
import { Avatar } from "./Avatar";
import {
  CAM_DISTANCE,
  CAM_FOV,
  CAM_PITCH,
  CONFIRM_MS,
  COUNTDOWN_LABELS,
  COUNTDOWN_STEP,
  DEATH_Y,
  GRID,
  MAX_DT,
  POS_SEND_MS,
  PREROLL_MS,
  REMOTE_EASE,
  SERVER_GRACE_MS,
  SPECTATOR_BACK,
  SPECTATOR_HEIGHT,
  seatColor,
  worldToCell,
} from "./constants";
import { devRoom, type RoomLink } from "./devRoom";
import { Floor } from "./Floor";
import { FloorView } from "./FloorView";
import { Hud, escapeHtml, type PlayerRow } from "./Hud";
import { InputController } from "./InputController";
import { Player } from "./Player";
import { FLAG_GROUNDED, FLAG_MOVING, type PlInit, type PlSnap, type PlState } from "./PistaLocaProtocol";
import { PistaLocaSocket } from "./PistaLocaSocket";
import { SoundEffects } from "./SoundEffects";
import { Stage } from "./Stage";

type State = "waiting" | "countdown" | "playing" | "dead" | "over";

interface Remote {
  avatar: Avatar;
  seen: boolean;
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
}

/**
 * Pista Loca: Block Party para salas. Juego SOLO de sala: Supabase maneja lobby /
 * marcador / rejoin (via RoomMode) y el game server es duenio de la pista y del
 * ritmo (namespace `/pistaloca`).
 *
 * El reparto (ver `server/src/games/pistaloca.ts`):
 *  - El CLIENTE simula su muñeco, hace caer su pista cuando le llega el paso "drop"
 *    y declara su propia caida al vacio (asi la latencia no castiga a nadie).
 *  - El SERVER arma el dibujo de cada ronda, decide la musica, el color y el tiempo,
 *    y lleva el orden de eliminacion.
 *
 * Puntaje: rondas completas aguantadas (`higher`).
 */
export class Game {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly floor = new Floor();
  private readonly floorView: FloorView;
  private readonly stage: Stage;
  private readonly hud: Hud;
  private readonly input: InputController;
  private readonly room: RoomLink | null;

  private socket: PistaLocaSocket | null = null;
  private connecting = false;
  private connectStartedAt = 0;

  private state: State = "waiting";
  private lastCountdownIndex = -1;
  private lastTime = performance.now();
  private prerollEnd = 0;

  private seats: string[] = [];
  private mySeat = -1;
  private latest: PlState | null = null;
  private prevAlive: boolean[] | null = null;
  /** Ronda y paso aplicados, para reaccionar al CAMBIO de paso y no al mensaje. */
  private stepKey = "";
  /** Momento local en que vence el paso actual. */
  private stepEnd = 0;
  private stepDur = 1;

  private readonly player = new Player();
  private myAvatar: Avatar | null = null;
  private readonly remotes = new Map<number, Remote>();
  private camY = 0;
  private posTimer = 0;
  private fallSoundPlayed = false;

  private myRounds = -1;
  private reported = false;
  private confirmTimer: number | null = null;

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.domElement.className = "game-canvas";
    container.append(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(CAM_FOV, 1, 0.1, 400);
    this.stage = new Stage(this.scene);
    this.floorView = new FloorView(this.floor);
    this.scene.add(this.floorView.group);

    this.hud = new Hud(container);
    this.input = new InputController(container);
    this.hud.onJump(() => this.input.requestJump());

    this.resize();
    window.addEventListener("resize", this.resize);

    this.room =
      initRoomMode("pista-loca", {
        getScore: () => this.currentScore(),
        onStart: () => this.beginCountdown(),
        // Caido, se sigue mirando la pista en vez de la espera generica de la sala.
        onReportedWaiting: () => true,
      }) ?? devRoom(() => this.beginCountdown());

    requestAnimationFrame(this.tick);

    if (!this.room) {
      if (isRoomMode()) {
        this.hud.showMessage("No disponible", "Pista Loca necesita las credenciales de la sala y no est&aacute;n configuradas.");
      } else {
        this.hud.showMessage(
          "Solo en salas",
          "Pista Loca se juega con amigos en una sala. Cre&aacute; o un&iacute;te a una para jugar.",
          { label: "Ir a las salas", onClick: () => (window.location.href = "/rooms/") },
        );
      }
      return;
    }
    if (!isGameServerConfigured()) {
      this.hud.showMessage("No disponible", "Pista Loca necesita el game server y no est&aacute; configurado (VITE_GAME_SERVER_URL).");
      return;
    }
    this.hud.showMessage("Pista Loca", "Esper&aacute; a que empiece la ronda...");
  }

  // ---------- Arranque ----------

  private beginCountdown(): void {
    if (this.state !== "waiting") return;
    this.state = "countdown";
    this.lastCountdownIndex = -1;
    this.hud.hideMessage();
    this.hud.showHud(true);
    this.hud.banner("Esperando a los dem&aacute;s", "", "good");
    void this.connect();
  }

  private async connect(): Promise<void> {
    if (this.socket || this.connecting || !this.room) return;
    this.connecting = true;
    this.connectStartedAt = performance.now();
    const url = await resolveGameServerUrl();
    this.connecting = false;
    if (this.socket || !this.room) return;
    if (!url) {
      this.giveUp();
      return;
    }
    const socket = new PistaLocaSocket(url, this.room.code, this.room.me, this.room.players(), this.room.round());
    socket.onInit((init) => this.onInit(init));
    socket.onState((s) => this.onState(s));
    socket.onSnap((snap) => this.onSnap(snap));
    this.socket = socket;
    void socket.connect();
  }

  private giveUp(): void {
    if (this.state === "over") return;
    this.state = "over";
    SoundEffects.stopMusic(false);
    this.hud.showHud(false);
    this.hud.banner(null);
    this.hud.showCountdown(null);
    this.hud.showMessage("Sin conexi&oacute;n", "No se pudo conectar al game server. La ronda sigue con los dem&aacute;s.");
    this.report(0);
  }

  // ---------- Mensajes ----------

  private onInit(init: PlInit): void {
    if (init.grid !== GRID) {
      this.giveUp();
      return;
    }
    this.seats = init.seats;
    this.mySeat = init.seat;
    this.buildAvatars();
    if (this.mySeat >= 0 && init.spawn && this.state === "countdown") {
      const { x, y, z, r } = init.spawn;
      this.player.place(x, y, z, r);
      this.camY = y;
    }
    this.onState(init);
  }

  private buildAvatars(): void {
    this.seats.forEach((name, seat) => {
      if (seat === this.mySeat) {
        if (!this.myAvatar) {
          this.myAvatar = new Avatar(seat, null);
          this.scene.add(this.myAvatar.root, this.myAvatar.shadow);
        }
        return;
      }
      if (this.remotes.has(seat)) return;
      const avatar = new Avatar(seat, name);
      avatar.visible = false;
      this.scene.add(avatar.root, avatar.shadow);
      this.remotes.set(seat, {
        avatar,
        seen: false,
        x: 0,
        y: 0,
        z: 0,
        yaw: 0,
        tx: 0,
        ty: 0,
        tz: 0,
        tyaw: 0,
        flags: 0,
        speed: 0,
        vy: 0,
      });
    });
  }

  private onState(s: PlState): void {
    const now = performance.now();
    this.latest = s;
    if (s.phase === "preroll") this.prerollEnd = now + s.msLeft;

    // El dibujo cambia en "reset" (o al entrar): la pista se rearma desde abajo.
    if (s.pattern && s.pattern !== this.floor.pattern) {
      const first = this.floor.pattern === "";
      this.floor.setPattern(s.pattern);
      this.floorView.rebuild(!first);
    }

    if (s.phase === "playing") this.applyStep(s, now);
    this.announceFalls(s);

    if (s.phase === "over") {
      this.finish(s);
      return;
    }
    if (s.phase === "playing" && this.state === "countdown") this.startPlaying();

    if (this.mySeat < 0) {
      if (s.phase !== "waiting" && this.state !== "dead") this.enterSpectator(0, false);
      return;
    }
    if (!s.alive[this.mySeat] && s.rounds[this.mySeat] >= 0 && s.phase !== "waiting") {
      if (this.state === "dead") {
        this.myRounds = s.rounds[this.mySeat];
        this.report(this.myRounds);
      } else if (this.state !== "over") {
        this.enterSpectator(s.rounds[this.mySeat], false);
      }
    }
  }

  /** Reacciona al cambio de paso de la ronda. */
  private applyStep(s: PlState, now: number): void {
    this.stepEnd = now + s.stepLeft;
    this.stepDur = Math.max(1, s.stepDur);
    const key = `${s.round}:${s.step}`;
    if (key === this.stepKey) return;
    this.stepKey = key;

    if (s.step === "dance") {
      this.stage.setMode("party");
      SoundEffects.startMusic(s.round);
    } else if (s.step === "choose") {
      SoundEffects.stopMusic(true);
      SoundEffects.playCall();
      this.stage.setMode("plain");
    } else if (s.step === "drop") {
      this.stage.setMode("plain");
      SoundEffects.stopMusic(false);
      // La pista cae cuando ESTE cliente recibe el paso (misma latencia que el color).
      const fallen = this.floor.drop(s.color);
      this.floorView.drop(fallen);
      SoundEffects.playDrop();
    } else if (s.step === "reset") {
      if (this.state === "playing") SoundEffects.playSurvive();
    }
  }

  private announceFalls(s: PlState): void {
    const prev = this.prevAlive;
    this.prevAlive = [...s.alive];
    if (!prev || s.phase !== "playing") return;
    s.alive.forEach((alive, seat) => {
      if (alive || !prev[seat] || seat === this.mySeat) return;
      this.hud.feed(`<b style="color:${seatColor(seat)}">${escapeHtml(this.seats[seat] ?? "")}</b> se cay&oacute;`);
      SoundEffects.playOtherOut();
    });
  }

  private onSnap(snap: PlSnap): void {
    for (let i = 0; i + 5 < snap.p.length; i += 6) {
      const seat = snap.p[i];
      if (seat === this.mySeat) continue;
      const r = this.remotes.get(seat);
      if (!r) continue;
      r.tx = snap.p[i + 1];
      r.ty = snap.p[i + 2];
      r.tz = snap.p[i + 3];
      r.tyaw = snap.p[i + 4];
      r.flags = snap.p[i + 5];
      if (!r.seen) {
        r.seen = true;
        r.x = r.tx;
        r.y = r.ty;
        r.z = r.tz;
        r.yaw = r.tyaw;
      }
    }
  }

  // ---------- Transiciones ----------

  private startPlaying(): void {
    if (this.state !== "countdown") return;
    this.state = "playing";
    this.hud.showCountdown(null);
    this.hud.banner(null);
  }

  private die(): void {
    if (this.state !== "playing") return;
    const round = this.latest?.round ?? 1;
    this.socket?.sendPos(this.player.x, this.player.y, this.player.z, this.player.yaw, 0);
    this.socket?.sendDead();
    this.enterSpectator(Math.max(0, round - 1), true);
    this.confirmTimer = window.setTimeout(() => this.report(this.myRounds), CONFIRM_MS);
  }

  private enterSpectator(rounds: number, fell: boolean): void {
    this.state = "dead";
    this.myRounds = rounds;
    this.hud.showCountdown(null);
    this.hud.setSpectating(true);
    if (this.myAvatar) this.myAvatar.visible = false;
    this.hud.banner(
      fell ? "&iexcl;Te ca&iacute;ste!" : "Fuera de la partida",
      `Aguantaste ${rounds} ${rounds === 1 ? "ronda" : "rondas"}. Mir&aacute; c&oacute;mo siguen los dem&aacute;s.`,
    );
    window.setTimeout(() => {
      if (this.state === "dead") this.hud.banner(null);
    }, 3200);
    if (!fell) this.report(rounds);
  }

  private finish(s: PlState): void {
    if (this.state === "over") return;
    const won = this.state === "playing";
    this.state = "over";
    SoundEffects.stopMusic(false);
    if (this.mySeat >= 0 && s.rounds[this.mySeat] >= 0) this.myRounds = s.rounds[this.mySeat];
    this.report(Math.max(0, this.myRounds));
    this.hud.showCountdown(null);
    this.hud.banner(null);
    this.hud.setSpectating(true);
    this.stage.setMode("party");
    if (won) SoundEffects.playWin();
    else SoundEffects.playEnd();
    window.setTimeout(() => this.hud.showResults(this.rows()), 700);
  }

  private report(rounds: number): void {
    if (this.reported) return;
    this.reported = true;
    if (this.confirmTimer !== null) window.clearTimeout(this.confirmTimer);
    this.room?.reportScore(Math.max(0, rounds));
  }

  private currentScore(): number {
    if (this.state === "playing") return Math.max(0, (this.latest?.round ?? 1) - 1);
    return Math.max(0, this.myRounds);
  }

  // ---------- Bucle ----------

  private tick = (now: number): void => {
    const dt = Math.min((now - this.lastTime) / 1000, MAX_DT);
    this.lastTime = now;
    this.update(dt, now);
    this.renderer.render(this.scene, this.camera);
    requestAnimationFrame(this.tick);
  };

  private update(dt: number, now: number): void {
    if (this.state === "countdown") this.updateCountdown(now);
    if (this.state === "countdown" || this.state === "playing") this.updatePlayer(dt);
    this.floorView.update(dt);
    this.stage.update(dt, (x, z) => this.floor.isSolid(worldToCell(x), worldToCell(z)));
    this.updateRemotes(dt);
    this.updateCamera(dt);
    this.updateHud(now);
  }

  private updateCountdown(now: number): void {
    if (this.latest?.phase !== "preroll") {
      if (!this.latest && this.connectStartedAt > 0 && now - this.connectStartedAt > SERVER_GRACE_MS) this.giveUp();
      return;
    }
    this.hud.banner(null);
    const remaining = this.prerollEnd - now;
    const index = Math.max(
      0,
      Math.min(COUNTDOWN_LABELS.length - 1, Math.floor((PREROLL_MS - remaining) / 1000 / COUNTDOWN_STEP)),
    );
    if (index !== this.lastCountdownIndex) {
      this.lastCountdownIndex = index;
      SoundEffects.playCountdownTick();
      this.hud.showCountdown(COUNTDOWN_LABELS[index]);
    }
    if (remaining <= 0) this.startPlaying();
  }

  private updatePlayer(dt: number): void {
    if (this.mySeat < 0) return;
    const playing = this.state === "playing";
    const jump = this.input.consumeJump();
    let wx = 0;
    let wz = 0;
    if (playing) {
      if (jump) this.player.requestJump();
      // Camara fija mirando hacia -Z: la pantalla y el mundo coinciden.
      const dir = this.input.direction;
      wx = dir.x;
      wz = dir.y;
    }
    const events = this.player.update(dt, wx, wz, this.floor);

    if (playing) {
      if (events.jumped) SoundEffects.playJump();
      if (events.landed > 9) SoundEffects.playLand();
      // El silbido de la caida suena apenas se pierde la pista, no al tocar fondo.
      if (this.player.y < -1.5 && !this.fallSoundPlayed) {
        this.fallSoundPlayed = true;
        SoundEffects.playFall();
      }
    }

    this.posTimer += dt * 1000;
    if (this.posTimer >= POS_SEND_MS) {
      this.posTimer = 0;
      const flags = (this.player.grounded ? FLAG_GROUNDED : 0) | (this.player.moving ? FLAG_MOVING : 0);
      this.socket?.sendPos(this.player.x, this.player.y, this.player.z, this.player.yaw, flags);
    }

    if (playing && this.player.y < DEATH_Y) this.die();
  }

  private updateRemotes(dt: number): void {
    const k = 1 - Math.exp(-REMOTE_EASE * dt);
    const alive = this.latest?.alive;
    const on = this.latest?.on;
    for (const [seat, r] of this.remotes) {
      const show = r.seen && (alive ? alive[seat] !== false : true);
      r.avatar.visible = show;
      if (!show) continue;
      const px = r.x;
      const py = r.y;
      const pz = r.z;
      r.x += (r.tx - r.x) * k;
      r.y += (r.ty - r.y) * k;
      r.z += (r.tz - r.z) * k;
      let diff = r.tyaw - r.yaw;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      r.yaw += diff * k;
      if (dt > 0) {
        r.speed += (Math.hypot(r.x - px, r.z - pz) / dt - r.speed) * Math.min(1, dt * 10);
        r.vy = (r.y - py) / dt;
      }
      r.avatar.root.position.set(r.x, r.y, r.z);
      r.avatar.root.rotation.y = r.yaw;
      r.avatar.animate(dt, (r.flags & FLAG_MOVING) !== 0 ? Math.max(r.speed, 3) : 0, (r.flags & FLAG_GROUNDED) !== 0, r.vy);
      r.avatar.setOffline(on ? on[seat] === false : false);
      this.placeShadow(r.avatar, r.x, r.y, r.z);
    }
    if (this.myAvatar) {
      const visible = this.state === "countdown" || this.state === "playing";
      this.myAvatar.visible = visible;
      if (visible) {
        const p = this.player;
        this.myAvatar.root.position.set(p.x, p.y, p.z);
        this.myAvatar.root.rotation.y = p.yaw;
        this.myAvatar.animate(dt, Math.hypot(p.vx, p.vz), p.grounded, p.vy);
        this.placeShadow(this.myAvatar, p.x, p.y, p.z);
      }
    }
  }

  /** Sombra sobre la pista si hay bloque debajo (sirve para medir el salto). */
  private placeShadow(avatar: Avatar, x: number, y: number, z: number): void {
    if (y < -0.05 || !this.player.supported(x, z, this.floor)) {
      avatar.shadow.visible = false;
      return;
    }
    avatar.shadow.visible = true;
    avatar.shadow.position.set(x, 0.02, z);
    avatar.shadow.scale.setScalar(Math.max(0.45, 1 - y / 8));
  }

  private updateCamera(dt: number): void {
    const following = (this.state === "countdown" || this.state === "playing") && this.mySeat >= 0;
    if (following) {
      const p = this.player;
      this.camY += (Math.max(p.y, -6) - this.camY) * (1 - Math.exp(-6 * dt));
      const h = CAM_DISTANCE * Math.cos(CAM_PITCH);
      const v = CAM_DISTANCE * Math.sin(CAM_PITCH);
      this.camera.position.set(p.x, this.camY + 1.1 + v, p.z + h);
      this.camera.lookAt(p.x, this.camY + 1.1, p.z);
      return;
    }
    // Espectador: la pista entera desde el mismo lado, fija.
    this.camera.position.set(0, SPECTATOR_HEIGHT, SPECTATOR_BACK);
    this.camera.lookAt(0, -1, 0);
  }

  private updateHud(now: number): void {
    const s = this.latest;
    if (!s) return;
    this.hud.setRound(s.round, s.alive.filter(Boolean).length, s.alive.length);
    this.hud.setPlayers(this.rows());
    if (s.phase === "playing") {
      const mode = s.step === "reset" ? "dance" : s.step;
      this.hud.setCall(mode, s.color, (this.stepEnd - now) / this.stepDur);
    } else {
      this.hud.setCall("idle", -1, 0);
    }
    this.hud.setJoystick(this.state === "playing" ? this.input.joystick : null);
  }

  private rows(): PlayerRow[] {
    const s = this.latest;
    return this.seats.map((name, seat) => ({
      seat,
      name,
      alive: s ? s.alive[seat] : true,
      rounds: s ? s.rounds[seat] : -1,
      mine: seat === this.mySeat,
      offline: s ? !s.on[seat] : false,
    }));
  }

  private resize = (): void => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.fov = w < h ? CAM_FOV + 16 : CAM_FOV;
    this.camera.updateProjectionMatrix();
  };
}
