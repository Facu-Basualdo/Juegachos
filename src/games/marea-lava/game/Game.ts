import * as THREE from "three";
import { initRoomMode, isRoomMode } from "../../../shared/room/roomMode";
import { isGameServerConfigured, resolveGameServerUrl } from "../../../shared/server-status";
import { Avatar } from "./Avatar";
import {
  CAM_BACK,
  CAM_BACK_PORTRAIT,
  CAM_FOV,
  CONFIRM_MS,
  COUNTDOWN_LABELS,
  COUNTDOWN_STEP,
  MATCH_MS,
  MAX_DT,
  POS_SEND_MS,
  PREROLL_MS,
  REMOTE_EASE,
  SERVER_GRACE_MS,
  TOP_Y,
  lavaY,
  seatColor,
} from "./constants";
import { devRoom, type RoomLink } from "./devRoom";
import { Hud, escapeHtml, type PlayerRow } from "./Hud";
import { InputController } from "./InputController";
import { FLAG_GROUNDED, FLAG_MOVING, type MlInit, type MlSnap, type MlState, type MlStatus } from "./MareaLavaProtocol";
import { MareaLavaSocket } from "./MareaLavaSocket";
import { Player } from "./Player";
import { SoundEffects } from "./SoundEffects";
import { Stage } from "./Stage";
import { Tower } from "./Tower";
import { TowerView } from "./TowerView";

type State = "waiting" | "countdown" | "playing" | "dead" | "top" | "over";

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

/** Con la lava a menos de esto (m), suena el aviso. */
const WARN_GAP = 3;

/**
 * Marea de Lava: una pared de plataformas que se trepa mientras la lava sube cada
 * vez mas rapido. Juego SOLO de sala (Supabase via RoomMode + game server
 * `/marealava`).
 *
 * El reparto (ver `server/src/games/marealava.ts`):
 *  - El SERVER manda la semilla de la torre y lleva el reloj de la lava y el
 *    resultado de cada uno.
 *  - El CLIENTE genera la torre con la semilla (identica en todas las pantallas),
 *    simula su muñeco, calcula la lava con el `elapsed` del server y declara si lo
 *    alcanzo o si llego a la cima.
 *
 * Puntaje (`higher`): la altura maxima en metros; el que llega a la cima suma
 * `100 + segundos que le sobraron`, asi cualquiera que llego le gana a cualquiera que
 * no.
 */
export class Game {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly stage: Stage;
  private readonly hud: Hud;
  private readonly input: InputController;
  private readonly room: RoomLink | null;

  private tower: Tower | null = null;
  private towerView: TowerView | null = null;

  private socket: MareaLavaSocket | null = null;
  private connecting = false;
  private connectStartedAt = 0;

  private state: State = "waiting";
  private lastCountdownIndex = -1;
  private lastTime = performance.now();
  private prerollEnd = 0;

  private seats: string[] = [];
  private mySeat = -1;
  private latest: MlState | null = null;
  private prevStatus: MlStatus[] | null = null;
  /** Momento local en que llego el ultimo estado: la lava corre local desde ahi. */
  private stateArrivedAt = 0;

  private readonly player = new Player();
  private myAvatar: Avatar | null = null;
  private readonly remotes = new Map<number, Remote>();
  private camY = 0;
  private posTimer = 0;
  private best = 0;
  private warned = false;

  private reported = false;
  private confirmTimer: number | null = null;
  private localScore = 0;
  private portrait = false;

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.domElement.className = "game-canvas";
    container.append(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(CAM_FOV, 1, 0.1, 200);
    this.stage = new Stage(this.scene);
    this.hud = new Hud(container);
    this.input = new InputController(container);
    this.hud.onJump(() => this.input.requestJump());

    // Hasta que llega la semilla, una torre de muestra de fondo (los carteles).
    this.buildTower(1);

    this.resize();
    window.addEventListener("resize", this.resize);

    this.room =
      initRoomMode("marea-lava", {
        getScore: () => this.currentScore(),
        onStart: () => this.beginCountdown(),
        onReportedWaiting: () => true,
      }) ?? devRoom(() => this.beginCountdown());

    requestAnimationFrame(this.tick);

    if (!this.room) {
      if (isRoomMode()) {
        this.hud.showMessage("No disponible", "Marea de Lava necesita las credenciales de la sala y no est&aacute;n configuradas.");
      } else {
        this.hud.showMessage(
          "Solo en salas",
          "Marea de Lava se juega con amigos en una sala. Cre&aacute; o un&iacute;te a una para jugar.",
          { label: "Ir a las salas", onClick: () => (window.location.href = "/rooms/") },
        );
      }
      return;
    }
    if (!isGameServerConfigured()) {
      this.hud.showMessage("No disponible", "Marea de Lava necesita el game server y no est&aacute; configurado (VITE_GAME_SERVER_URL).");
      return;
    }
    this.hud.showMessage("Marea de Lava", "Esper&aacute; a que empiece la ronda...");
  }

  private buildTower(seed: number): void {
    if (this.towerView) this.scene.remove(this.towerView.group);
    this.tower = Tower.create(seed);
    this.towerView = new TowerView(this.tower);
    this.scene.add(this.towerView.group);
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
    const socket = new MareaLavaSocket(url, this.room.code, this.room.me, this.room.players(), this.room.round());
    socket.onInit((init) => this.onInit(init));
    socket.onState((s) => this.onState(s));
    socket.onSnap((snap) => this.onSnap(snap));
    this.socket = socket;
    void socket.connect();
  }

  private giveUp(): void {
    if (this.state === "over") return;
    this.state = "over";
    SoundEffects.stopRumble();
    this.hud.showHud(false);
    this.hud.banner(null);
    this.hud.showCountdown(null);
    this.hud.showMessage("Sin conexi&oacute;n", "No se pudo conectar al game server. La ronda sigue con los dem&aacute;s.");
    this.report(0, false);
  }

  // ---------- Mensajes ----------

  private onInit(init: MlInit): void {
    this.seats = init.seats;
    this.mySeat = init.seat;
    this.buildTower(init.seed);
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

  private onState(s: MlState): void {
    const now = performance.now();
    this.latest = s;
    this.stateArrivedAt = now;
    if (s.phase === "preroll") this.prerollEnd = now + s.msLeft;
    this.announce(s);

    if (s.phase === "over") {
      this.finish(s);
      return;
    }
    if (s.phase === "playing" && this.state === "countdown") this.startPlaying();

    if (this.mySeat < 0) {
      if (s.phase !== "waiting" && this.state !== "dead") this.resolve("dead", 0);
      return;
    }
    const mine = s.status[this.mySeat];
    if (mine === "dead" && s.phase !== "waiting") {
      if (this.state === "playing" || this.state === "countdown") this.resolve("dead", s.best[this.mySeat]);
      this.report(s.best[this.mySeat]);
    } else if (mine === "top") {
      const score = 100 + (MATCH_MS - s.topT[this.mySeat]) / 1000;
      if (this.state !== "top") this.resolve("top", score);
      this.report(score);
    }
  }

  private announce(s: MlState): void {
    const prev = this.prevStatus;
    this.prevStatus = [...s.status];
    if (!prev || s.phase !== "playing") return;
    s.status.forEach((st, seat) => {
      if (st === prev[seat] || seat === this.mySeat) return;
      const who = `<b style="color:${seatColor(seat)}">${escapeHtml(this.seats[seat] ?? "")}</b>`;
      if (st === "dead") {
        this.hud.feed(`${who} se quem&oacute; a ${Math.round(s.best[seat])} m`);
        SoundEffects.playOtherOut();
      } else if (st === "top") {
        this.hud.feed(`${who} lleg&oacute; a la cima`);
      }
    });
  }

  private onSnap(snap: MlSnap): void {
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
    SoundEffects.startRumble();
  }

  /** Resuelto: quemado o en la cima. */
  private resolve(result: "dead" | "top", score: number): void {
    if (this.state === "dead" || this.state === "top" || this.state === "over") return;
    this.state = result;
    this.localScore = score;
    this.hud.setSpectating(true);
    this.hud.setLava(null);
    if (result === "dead") {
      SoundEffects.playBurn();
      if (this.myAvatar) this.myAvatar.visible = false;
      this.hud.banner("&iexcl;Te alcanz&oacute; la lava!", `Llegaste a ${Math.max(0, score).toFixed(1)} m. Mir&aacute; c&oacute;mo siguen los dem&aacute;s.`);
    } else {
      SoundEffects.playTop();
      this.hud.banner("&iexcl;Llegaste a la cima!", "Mir&aacute; c&oacute;mo trepan los dem&aacute;s.", "good");
    }
    window.setTimeout(() => {
      if (this.state === "dead" || this.state === "top") this.hud.banner(null);
    }, 3200);
    this.confirmTimer = window.setTimeout(() => this.report(this.localScore), CONFIRM_MS);
  }

  private finish(s: MlState): void {
    if (this.state === "over") return;
    this.state = "over";
    SoundEffects.stopRumble();
    if (this.mySeat >= 0) {
      const st = s.status[this.mySeat];
      this.report(st === "top" ? 100 + (MATCH_MS - s.topT[this.mySeat]) / 1000 : s.best[this.mySeat]);
    } else {
      this.report(0, false);
    }
    this.hud.showCountdown(null);
    this.hud.banner(null);
    this.hud.setLava(null);
    this.hud.setSpectating(true);
    SoundEffects.playEnd();
    window.setTimeout(() => this.hud.showResults(this.rows(), s.topT), 800);
  }

  /**
   * `ranked` = false para los ceros que no son una partida jugada (sin conexion,
   * o sin asiento por entrar tarde): la ronda los necesita, el ranking global no.
   */
  private report(score: number, ranked = true): void {
    if (this.reported) return;
    this.reported = true;
    if (this.confirmTimer !== null) window.clearTimeout(this.confirmTimer);
    this.room?.reportScore(Math.round(Math.max(0, score) * 10) / 10, { ranked });
  }

  private currentScore(): number {
    if (this.state === "playing") return Math.round(this.best * 10) / 10;
    return Math.round(this.localScore * 10) / 10;
  }

  // ---------- Bucle ----------

  private tick = (now: number): void => {
    const dt = Math.min((now - this.lastTime) / 1000, MAX_DT);
    this.lastTime = now;
    this.update(dt, now);
    this.renderer.render(this.scene, this.camera);
    requestAnimationFrame(this.tick);
  };

  /** Ms de partida ahora, corriendo local desde el ultimo `elapsed` del server. */
  private elapsedNow(now: number): number {
    const s = this.latest;
    if (!s || s.phase !== "playing") return s?.phase === "over" ? s.elapsed : 0;
    return s.elapsed + (now - this.stateArrivedAt);
  }

  private update(dt: number, now: number): void {
    const lava = lavaY(this.elapsedNow(now));
    this.stage.setLava(lava);
    if (this.state === "countdown") this.updateCountdown(now);
    if (this.state === "countdown" || this.state === "playing") this.updatePlayer(dt, lava);
    this.stage.update(dt);
    this.updateRemotes(dt);
    this.updateCamera(dt, lava);
    this.updateHud(lava);
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

  private updatePlayer(dt: number, lava: number): void {
    if (this.mySeat < 0 || !this.tower) return;
    const playing = this.state === "playing";
    const jump = this.input.consumeJump();
    let wx = 0;
    let wz = 0;
    if (playing) {
      if (jump) this.player.requestJump();
      // Camara fija de frente a la pared: la pantalla y el mundo coinciden.
      const dir = this.input.direction;
      wx = dir.x;
      wz = dir.y;
    }
    const events = this.player.update(dt, wx, wz, this.tower);
    if (playing) {
      if (events.jumped) SoundEffects.playJump();
      if (events.landed > 9) SoundEffects.playLand();
      this.best = Math.max(this.best, Math.min(TOP_Y, this.player.y));
    }

    this.posTimer += dt * 1000;
    if (this.posTimer >= POS_SEND_MS) {
      this.posTimer = 0;
      const flags = (this.player.grounded ? FLAG_GROUNDED : 0) | (this.player.moving ? FLAG_MOVING : 0);
      this.socket?.sendPos(this.player.x, this.player.y, this.player.z, this.player.yaw, flags);
    }
    if (!playing) return;

    const gap = this.player.y - lava;
    SoundEffects.setRumble(1 - Math.min(1, gap / 10));
    if (gap < WARN_GAP && !this.warned) {
      this.warned = true;
      SoundEffects.playWarn();
    } else if (gap > 5) {
      this.warned = false;
    }

    if (this.player.grounded && this.player.y >= TOP_Y - 0.01) {
      // Cima: se manda la posicion antes del aviso, que el server valida contra ella.
      this.socket?.sendPos(this.player.x, this.player.y, this.player.z, this.player.yaw, FLAG_GROUNDED);
      this.socket?.sendTop();
      this.resolve("top", 100 + (MATCH_MS - this.elapsedNow(performance.now())) / 1000);
      return;
    }
    if (this.player.y < lava) {
      this.socket?.sendPos(this.player.x, this.player.y, this.player.z, this.player.yaw, 0);
      this.socket?.sendDead();
      this.resolve("dead", this.best);
    }
  }

  private updateRemotes(dt: number): void {
    const k = 1 - Math.exp(-REMOTE_EASE * dt);
    const status = this.latest?.status;
    const on = this.latest?.on;
    for (const [seat, r] of this.remotes) {
      const show = r.seen && (!status || status[seat] !== "dead");
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
      const visible = this.state === "countdown" || this.state === "playing" || this.state === "top";
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

  /** Sombra sobre la plataforma de abajo: en un juego de saltos dice donde vas a caer. */
  private placeShadow(avatar: Avatar, x: number, y: number, z: number): void {
    const ground = this.tower ? this.player.groundBelow(x, y, z, this.tower) : null;
    if (ground === null || y - ground > 12) {
      avatar.shadow.visible = false;
      return;
    }
    avatar.shadow.visible = true;
    avatar.shadow.position.set(x, ground + 0.02, z);
    avatar.shadow.scale.setScalar(Math.max(0.4, 1 - (y - ground) / 8));
  }

  private updateCamera(dt: number, lava: number): void {
    const back = this.portrait ? CAM_BACK_PORTRAIT : CAM_BACK;
    const following = (this.state === "countdown" || this.state === "playing") && this.mySeat >= 0;
    let targetY: number;
    let targetX: number;
    if (following) {
      targetY = this.player.y;
      targetX = this.player.x * 0.55;
    } else {
      // Resuelto: sigue al que va mas alto de los que siguen trepando (o a la lava).
      let best = -Infinity;
      let bx = 0;
      for (const [seat, r] of this.remotes) {
        if (!r.seen || this.latest?.status[seat] !== "run") continue;
        if (r.y > best) {
          best = r.y;
          bx = r.x;
        }
      }
      targetY = best > -Infinity ? best : Math.max(lava + 4, this.camY);
      targetX = bx * 0.4;
    }
    this.camY += (targetY - this.camY) * (1 - Math.exp(-4 * dt));
    const cx = this.camera.position.x + (targetX - this.camera.position.x) * (1 - Math.exp(-4 * dt));
    // Un poco mas alta que el jugador y mirando apenas arriba: hay que ver el proximo
    // salto. En vertical sube mas el encuadre: si no, media pantalla es lava.
    const lift = this.portrait ? 6.5 : 3.4;
    const look = this.portrait ? 6 : 2.6;
    this.camera.position.set(cx, this.camY + lift, back);
    this.stage.setFocus(following ? this.player.x : cx, this.camY);
    this.camera.lookAt(cx, this.camY + look, -1);
  }

  private updateHud(lava: number): void {
    const s = this.latest;
    if (!s) return;
    this.hud.setAlive(s.status.filter((st) => st === "run").length, s.status.length);
    this.hud.setPlayers(this.rows());
    if (this.state === "playing") {
      this.hud.setHeight(this.player.y);
      this.hud.setLava(this.player.y - lava);
    } else if (this.state === "countdown") {
      this.hud.setHeight(0);
    }
    this.hud.setJoystick(this.state === "playing" ? this.input.joystick : null);
  }

  private rows(): PlayerRow[] {
    const s = this.latest;
    return this.seats.map((name, seat) => {
      const mine = seat === this.mySeat;
      const remote = this.remotes.get(seat);
      const status = s ? s.status[seat] : "run";
      // En vivo: la altura propia al toque; la ajena, la del ultimo snapshot.
      const live = mine ? this.best : Math.max(s?.best[seat] ?? 0, remote?.y ?? 0);
      return {
        seat,
        name,
        status,
        best: status === "run" ? Math.max(0, live) : (s?.best[seat] ?? 0),
        mine,
        offline: s ? !s.on[seat] : false,
      };
    });
  }

  private resize = (): void => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.portrait = w < h;
    this.camera.aspect = w / h;
    this.camera.fov = this.portrait ? CAM_FOV + 10 : CAM_FOV;
    this.camera.updateProjectionMatrix();
  };
}
