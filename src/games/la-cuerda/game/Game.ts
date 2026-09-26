import * as THREE from "three";
import { initRoomMode, isRoomMode } from "../../../shared/room/roomMode";
import { isGameServerConfigured, resolveGameServerUrl } from "../../../shared/server-status";
import { Avatar } from "./Avatar";
import {
  CAM_DIST,
  CAM_DIST_PORTRAIT,
  CAM_FOV,
  CAM_PITCH,
  CAM_PITCH_MAX,
  CAM_PITCH_MIN,
  CAM_SIDE,
  CAM_SIDE_PORTRAIT,
  CAM_TARGET_H,
  CAM_YAW_SPEED,
  CONFIRM_MS,
  COUNTDOWN_LABELS,
  COUNTDOWN_STEP,
  FALL_Y,
  GOAL_Z,
  MATCH_MS,
  MAX_DT,
  POS_SEND_MS,
  PREROLL_MS,
  PUSH_COOLDOWN_MS,
  REMOTE_EASE,
  ROPES,
  SERVER_GRACE_MS,
  progressOf,
  ropeAngle,
  ropeSpeed,
  seatColor,
} from "./constants";
import { Course, ropeHits } from "./Course";
import { devRoom, type RoomLink } from "./devRoom";
import { Hud, escapeHtml, type PlayerRow } from "./Hud";
import { InputController } from "./InputController";
import {
  FLAG_GROUNDED,
  FLAG_MOVING,
  type LcInit,
  type LcShove,
  type LcSnap,
  type LcState,
  type LcStatus,
} from "./LaCuerdaProtocol";
import { LaCuerdaSocket } from "./LaCuerdaSocket";
import { Player } from "./Player";
import { SoundEffects } from "./SoundEffects";
import { Stage } from "./Stage";

type State = "waiting" | "countdown" | "playing" | "dead" | "goal" | "over";

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

const TWO_PI = Math.PI * 2;
/** Mitad del largo de la zona donde la cuerda pasa a la altura del cuerpo (m). */
const ZONE_HALF = 4;
/** El silbido de la cuerda suena este angulo antes del golpe (rad). */
const WHOOSH_LEAD = 0.7;

/**
 * La Cuerda: un puente angosto sobre el vacio y dos cuerdas enormes, cada una girada
 * por dos muñecos gigantes y cada vez mas rapido; en el puente, ademas, se empuja. Juego SOLO de sala
 * (Supabase via RoomMode + game server `/lacuerda`). Es Marea de Lava con la cuerda
 * en el lugar de la lava.
 *
 * El reparto (ver `server/src/games/lacuerda.ts`):
 *  - El SERVER lleva el reloj de la partida y el resultado de cada uno, y resuelve
 *    los empujones (a quien alcanzan y con que impulso).
 *  - El CLIENTE simula su muñeco (tambien el vuelo cuando lo empujan), calcula las
 *    cuerdas con `ropeAngle` y el `elapsed` del server (misma funcion en todas las
 *    pantallas) y declara si lo agarro una cuerda o se cayo (`lc:dead`) o si llego a
 *    la meta (`lc:goal`).
 *
 * Puntaje (`higher`): los metros avanzados; el que cruza suma `100 + segundos que le
 * sobraron`, asi cualquiera que cruzo le gana a cualquiera que no.
 */
export class Game {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly course = new Course();
  private readonly stage: Stage;
  private readonly hud: Hud;
  private readonly input: InputController;
  private readonly room: RoomLink | null;

  private socket: LaCuerdaSocket | null = null;
  private connecting = false;
  private connectStartedAt = 0;

  private state: State = "waiting";
  private lastCountdownIndex = -1;
  private lastTime = performance.now();
  private prerollEnd = 0;

  private seats: string[] = [];
  private mySeat = -1;
  private latest: LcState | null = null;
  private prevStatus: LcStatus[] | null = null;
  /** Momento local en que llego el ultimo estado: el reloj corre local desde ahi. */
  private stateArrivedAt = 0;

  private readonly player = new Player();
  private myAvatar: Avatar | null = null;
  /** Despues del golpe el muñeco propio sigue volando hasta perderse en el vacio. */
  private flying = false;
  private readonly remotes = new Map<number, Remote>();
  private camY = 0;
  private camZ = ROPES[0].z;
  private posTimer = 0;
  private best = 0;
  /** Angulo de cada cuerda en el cuadro anterior (el golpe se barre desde aca). */
  private prevAngles: number[] | null = null;
  /** Hasta cuando no se puede volver a empujar (reloj local, espejo del server). */
  private pushReadyAt = 0;

  private reported = false;
  private confirmTimer: number | null = null;
  private localScore = 0;
  private portrait = false;
  /** Hacia donde mira la camara (rad). 0 = detras del muñeco mirando a la meta. */
  private yaw = 0;
  private pitch = CAM_PITCH;

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.domElement.className = "game-canvas";
    container.append(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(CAM_FOV, 1, 0.1, 260);
    this.stage = new Stage(this.scene, this.course);
    this.hud = new Hud(container);
    this.input = new InputController(container);
    this.hud.onJump(() => this.input.requestJump());
    this.hud.onPush(() => this.input.requestPush());

    this.resize();
    window.addEventListener("resize", this.resize);

    this.room =
      initRoomMode("la-cuerda", {
        getScore: () => this.currentScore(),
        onStart: () => this.beginCountdown(),
        onReportedWaiting: () => true,
      }) ?? devRoom(() => this.beginCountdown());

    requestAnimationFrame(this.tick);

    if (!this.room) {
      if (isRoomMode()) {
        this.hud.showMessage("No disponible", "La Cuerda necesita las credenciales de la sala y no est&aacute;n configuradas.");
      } else {
        this.hud.showMessage(
          "Solo en salas",
          "La Cuerda se juega con amigos en una sala. Cre&aacute; o un&iacute;te a una para jugar.",
          { label: "Ir a las salas", onClick: () => (window.location.href = "/rooms/") },
        );
      }
      return;
    }
    if (!isGameServerConfigured()) {
      this.hud.showMessage("No disponible", "La Cuerda necesita el game server y no est&aacute; configurado (VITE_GAME_SERVER_URL).");
      return;
    }
    this.hud.showMessage("La Cuerda", "Esper&aacute; a que empiece la ronda...");
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
    const socket = new LaCuerdaSocket(url, this.room.code, this.room.me, this.room.players(), this.room.round());
    socket.onInit((init) => this.onInit(init));
    socket.onState((s) => this.onState(s));
    socket.onSnap((snap) => this.onSnap(snap));
    socket.onShove((shove) => this.onShove(shove));
    socket.onPushFx((seat) => this.onPushFx(seat));
    this.socket = socket;
    void socket.connect();
  }

  private giveUp(): void {
    if (this.state === "over") return;
    this.state = "over";
    this.hud.showHud(false);
    this.hud.banner(null);
    this.hud.showCountdown(null);
    this.hud.showMessage("Sin conexi&oacute;n", "No se pudo conectar al game server. La ronda sigue con los dem&aacute;s.");
    this.report(0, false);
  }

  // ---------- Mensajes ----------

  private onInit(init: LcInit): void {
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

  private onState(s: LcState): void {
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
    } else if (mine === "goal") {
      const score = 100 + (MATCH_MS - s.goalT[this.mySeat]) / 1000;
      if (this.state !== "goal") this.resolve("goal", score);
      this.report(score);
    }
  }

  private announce(s: LcState): void {
    const prev = this.prevStatus;
    this.prevStatus = [...s.status];
    if (!prev || s.phase !== "playing") return;
    s.status.forEach((st, seat) => {
      if (st === prev[seat] || seat === this.mySeat) return;
      const who = `<b style="color:${seatColor(seat)}">${escapeHtml(this.seats[seat] ?? "")}</b>`;
      if (st === "dead") {
        this.hud.feed(`${who} qued&oacute; afuera a los ${Math.round(s.best[seat])} m`);
        SoundEffects.playOtherOut();
      } else if (st === "goal") {
        this.hud.feed(`${who} cruz&oacute; el puente`);
      }
    });
  }

  private onSnap(snap: LcSnap): void {
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

  /** Te empujaron: el impulso lo calculo el server, el vuelo lo simula este cliente. */
  private onShove(shove: LcShove): void {
    if (this.state !== "playing") return;
    this.player.shove(shove.vx, shove.vy, shove.vz);
    SoundEffects.playShoved();
    const name = this.seats[shove.from];
    if (name) this.hud.feed(`<b style="color:${seatColor(shove.from)}">${escapeHtml(name)}</b> te empuj&oacute;`);
  }

  /** Alguien empujo: se anima su muñeco (el propio ya se animo al apretar). */
  private onPushFx(seat: number): void {
    if (seat === this.mySeat) return;
    const r = this.remotes.get(seat);
    if (!r || !r.avatar.visible) return;
    r.avatar.push();
    SoundEffects.playPushOther();
  }

  // ---------- Transiciones ----------

  private startPlaying(): void {
    if (this.state !== "countdown") return;
    this.state = "playing";
    this.hud.showCountdown(null);
    this.hud.banner(null);
  }

  /** Resuelto: afuera (cuerda o caida) o en la meta. */
  private resolve(result: "dead" | "goal", score: number, how: "rope" | "fall" | null = null): void {
    if (this.state === "dead" || this.state === "goal" || this.state === "over") return;
    this.input.releaseMouse();
    this.state = result;
    this.localScore = score;
    this.hud.setSpectating(true);
    this.hud.setRope(null);
    if (result === "dead") {
      const where = `Llegaste a ${Math.max(0, score).toFixed(1)} m. Mir&aacute; c&oacute;mo siguen los dem&aacute;s.`;
      if (how === "rope") {
        SoundEffects.playHit();
        this.hud.banner("&iexcl;Te agarr&oacute; la cuerda!", where);
      } else if (how === "fall") {
        SoundEffects.playFall();
        this.hud.banner("&iexcl;Te ca&iacute;ste!", where);
      } else {
        if (this.myAvatar) this.myAvatar.visible = false;
        this.hud.banner("Quedaste afuera", where);
      }
    } else {
      SoundEffects.playGoal();
      this.hud.banner("&iexcl;Cruzaste!", "Mir&aacute; c&oacute;mo cruzan los dem&aacute;s.", "good");
    }
    window.setTimeout(() => {
      if (this.state === "dead" || this.state === "goal") this.hud.banner(null);
    }, 3200);
    this.confirmTimer = window.setTimeout(() => this.report(this.localScore), CONFIRM_MS);
  }

  private finish(s: LcState): void {
    if (this.state === "over") return;
    this.input.releaseMouse();
    this.state = "over";
    if (this.mySeat >= 0) {
      const st = s.status[this.mySeat];
      this.report(st === "goal" ? 100 + (MATCH_MS - s.goalT[this.mySeat]) / 1000 : s.best[this.mySeat]);
    } else {
      this.report(0, false);
    }
    this.hud.showCountdown(null);
    this.hud.banner(null);
    this.hud.setRope(null);
    this.hud.setSpectating(true);
    SoundEffects.playEnd();
    window.setTimeout(() => this.hud.showResults(this.rows(), s.goalT), 800);
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

  /**
   * Ms de partida ahora, corriendo local desde el ultimo `elapsed` del server. En la
   * cuenta regresiva es negativo: la cuerda ya gira y se le puede leer el ritmo.
   */
  private elapsedNow(now: number): number {
    const s = this.latest;
    if (!s) return -PREROLL_MS;
    if (s.phase === "preroll") return -Math.max(0, this.prerollEnd - now);
    if (s.phase === "playing") return s.elapsed + (now - this.stateArrivedAt);
    return s.phase === "over" ? s.elapsed : -PREROLL_MS;
  }

  private update(dt: number, now: number): void {
    const t = this.elapsedNow(now);
    const angles = ROPES.map((rope) => ropeAngle(rope, t));
    angles.forEach((a, i) => this.stage.setRope(i, a));
    this.ropeSounds(angles);
    if (this.state === "countdown") this.updateCountdown(now);
    if (this.state === "countdown" || this.state === "playing") this.updatePlayer(dt, angles);
    else if (this.flying) this.updateFlight(dt);
    // El empujon se consume en todos los estados: si no, una F del countdown salia al largar.
    if (this.input.consumePush() && this.state === "playing") this.tryPush();
    this.prevAngles = angles;
    this.updateRemotes(dt);
    this.updateCamera(dt);
    this.updateHud(t, now);
  }

  /**
   * Empujon: la posicion se manda antes, porque el server mide el alcance con la
   * ultima declarada y a 20 Hz puede tener 50 ms de atraso.
   */
  private tryPush(): void {
    const now = performance.now();
    if (now < this.pushReadyAt) return;
    this.pushReadyAt = now + PUSH_COOLDOWN_MS;
    const p = this.player;
    const flags = (p.grounded ? FLAG_GROUNDED : 0) | (p.moving ? FLAG_MOVING : 0);
    this.socket?.sendPos(p.x, p.y, p.z, p.yaw, flags);
    this.socket?.sendPush(p.yaw);
    this.myAvatar?.push();
    SoundEffects.playPush();
  }

  /** La cuerda mas cercana al jugador (indice en ROPES). */
  private nearestRope(z: number): number {
    let best = 0;
    ROPES.forEach((rope, i) => {
      if (Math.abs(z - rope.z) < Math.abs(z - ROPES[best].z)) best = i;
    });
    return best;
  }

  /**
   * Silbido y golpe de cada pasada por abajo: el ritmo se escucha. Cada cuerda suena
   * mas fuerte cuanto mas cerca de su zona estas, asi las dos no se pisan.
   */
  private ropeSounds(angles: number[]): void {
    const prev = this.prevAngles;
    if (prev === null || this.state === "over" || this.state === "waiting") return;
    const alive = this.state === "countdown" || this.state === "playing";
    ROPES.forEach((rope, i) => {
      const near = alive ? 1 - Math.min(1, Math.max(0, Math.abs(this.player.z - rope.z) - ZONE_HALF) / 16) : 0.3;
      const lead = rope.dir * WHOOSH_LEAD;
      if (Math.floor((angles[i] + lead) / TWO_PI) !== Math.floor((prev[i] + lead) / TWO_PI)) {
        SoundEffects.playRopeWhoosh(near);
      }
      if (Math.floor(angles[i] / TWO_PI) !== Math.floor(prev[i] / TWO_PI)) SoundEffects.playRopeSlap(near);
    });
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

  private updatePlayer(dt: number, angles: number[]): void {
    if (this.mySeat < 0) return;
    const playing = this.state === "playing";
    const jump = this.input.consumeJump();
    let wx = 0;
    let wz = 0;
    const look = this.input.consumeLook();
    this.yaw += look.yaw - this.input.keyYaw * CAM_YAW_SPEED * dt;
    this.pitch = Math.max(CAM_PITCH_MIN, Math.min(CAM_PITCH_MAX, this.pitch + look.pitch));
    if (playing) {
      if (jump) this.player.requestJump();
      // Adelante es hacia donde mira la camara, proyectado al piso.
      const dir = this.input.direction;
      const fx = -Math.sin(this.yaw);
      const fz = -Math.cos(this.yaw);
      const rx = Math.cos(this.yaw);
      const rz = -Math.sin(this.yaw);
      wx = rx * dir.x - fx * dir.y;
      wz = rz * dir.x - fz * dir.y;
    }
    const events = this.player.update(dt, wx, wz, this.course);
    const p = this.player;
    if (playing) {
      if (events.jumped) SoundEffects.playJump();
      if (events.landed > 9) SoundEffects.playLand();
      this.best = Math.max(this.best, progressOf(p.z));
    }

    this.posTimer += dt * 1000;
    if (this.posTimer >= POS_SEND_MS) {
      this.posTimer = 0;
      const flags = (p.grounded ? FLAG_GROUNDED : 0) | (p.moving ? FLAG_MOVING : 0);
      this.socket?.sendPos(p.x, p.y, p.z, p.yaw, flags);
    }
    if (!playing) return;

    if (p.grounded && p.z <= GOAL_Z - 0.3) {
      // Meta: se manda la posicion antes del aviso, que el server valida contra ella.
      this.socket?.sendPos(p.x, p.y, p.z, p.yaw, FLAG_GROUNDED);
      this.socket?.sendGoal();
      this.resolve("goal", 100 + (MATCH_MS - this.elapsedNow(performance.now())) / 1000);
      return;
    }
    const prev = this.prevAngles;
    const hit = prev ? ROPES.findIndex((rope, i) => ropeHits(rope, prev[i], angles[i], p.x, p.y, p.z)) : -1;
    if (hit >= 0) {
      // Sale volando para un costado y hacia donde iba la cuerda (por abajo, `dir` en z).
      this.socket?.sendPos(p.x, p.y, p.z, p.yaw, 0);
      this.socket?.sendDead();
      const along = ROPES[hit].dir * (Math.cos(angles[hit]) > 0 ? 1 : -1);
      p.fling(p.x >= 0 ? 1 : -1, along);
      this.flying = true;
      this.resolve("dead", this.best, "rope");
      return;
    }
    if (p.y < FALL_Y) {
      this.socket?.sendPos(p.x, p.y, p.z, p.yaw, 0);
      this.socket?.sendDead();
      this.flying = true;
      this.resolve("dead", this.best, "fall");
    }
  }

  /** El vuelo del muñeco propio despues del golpe o la caida, hasta perderse abajo. */
  private updateFlight(dt: number): void {
    this.player.drift(dt, this.course);
    if (this.player.y < -40) this.flying = false;
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
      const visible = this.state === "countdown" || this.state === "playing" || this.state === "goal" || this.flying;
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

  /** Sombra sobre el tablero: en un juego de saltos dice donde vas a caer. */
  private placeShadow(avatar: Avatar, x: number, y: number, z: number): void {
    const ground = this.course.groundBelow(x, y, z);
    if (ground === null || y - ground > 12) {
      avatar.shadow.visible = false;
      return;
    }
    avatar.shadow.visible = true;
    avatar.shadow.position.set(x, ground + 0.02, z);
    avatar.shadow.scale.setScalar(Math.max(0.4, 1 - (y - ground) / 8));
  }

  private updateCamera(dt: number): void {
    const following = (this.state === "countdown" || this.state === "playing") && this.mySeat >= 0;
    if (following) {
      this.followCamera(dt);
      return;
    }
    // Resuelto: de costado al puente, siguiendo al que va mas adelante de los que
    // siguen cruzando (o mirando la cuerda).
    const side = this.portrait ? CAM_SIDE_PORTRAIT : CAM_SIDE;
    let lead = Infinity;
    for (const [seat, r] of this.remotes) {
      if (!r.seen || this.latest?.status[seat] !== "run") continue;
      if (r.z < lead) lead = r.z;
    }
    const target = lead < Infinity ? Math.max(GOAL_Z, Math.min(0, lead)) : ROPES[0].z;
    const k = 1 - Math.exp(-3 * dt);
    this.camZ += (target - this.camZ) * k;
    this.camY += (1.5 - this.camY) * k;
    this.camera.position.set(side, this.camY + 5.5, this.camZ + 4);
    this.camera.lookAt(0, this.camY + 1, this.camZ);
  }

  /**
   * Tercera persona: detras del muñeco segun el giro y la inclinacion que maneja el
   * jugador (la de Marea de Lava, sin el choque contra la torre: aca no hay nada que
   * se meta entre la camara y el muñeco salvo la cuerda, y esa conviene verla).
   */
  private followCamera(dt: number): void {
    const p = this.player;
    this.camY += (p.y - this.camY) * (1 - Math.exp(-8 * dt));
    this.camZ = p.z;
    const dist = this.portrait ? CAM_DIST_PORTRAIT : CAM_DIST;
    const ox = Math.sin(this.yaw) * Math.cos(this.pitch);
    const oy = Math.sin(this.pitch);
    const oz = Math.cos(this.yaw) * Math.cos(this.pitch);
    const ty = this.camY + CAM_TARGET_H;
    this.camera.position.set(p.x + ox * dist, ty + oy * dist, p.z + oz * dist);
    this.camera.lookAt(p.x, ty, p.z);
  }

  private updateHud(t: number, now: number): void {
    const s = this.latest;
    if (!s) return;
    this.hud.setAlive(s.status.filter((st) => st === "run").length, s.status.length);
    this.hud.setPlayers(this.rows());
    if (this.state === "playing") {
      this.hud.setProgress(progressOf(this.player.z), -GOAL_Z);
      const i = this.nearestRope(this.player.z);
      const rope = ROPES[i];
      this.hud.setRope((ropeSpeed(rope, t) * 60) / TWO_PI, i + 1, Math.abs(this.player.z - rope.z) < ZONE_HALF + 1);
    } else if (this.state === "countdown") {
      this.hud.setProgress(0, -GOAL_Z);
    }
    this.hud.setJoystick(this.state === "playing" ? this.input.joystick : null);
    this.hud.setPushCooldown(Math.max(0, (this.pushReadyAt - now) / PUSH_COOLDOWN_MS));
  }

  private rows(): PlayerRow[] {
    const s = this.latest;
    return this.seats.map((name, seat) => {
      const mine = seat === this.mySeat;
      const remote = this.remotes.get(seat);
      const status = s ? s.status[seat] : "run";
      // En vivo: el avance propio al toque; el ajeno, el del ultimo snapshot.
      const live = mine ? this.best : Math.max(s?.best[seat] ?? 0, remote?.seen ? progressOf(remote.z) : 0);
      return {
        seat,
        name,
        status,
        best: status === "run" ? live : (s?.best[seat] ?? 0),
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
