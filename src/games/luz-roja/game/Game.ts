import * as THREE from "three";
import { initRoomMode, isRoomMode } from "../../../shared/room/roomMode";
import { isGameServerConfigured, resolveGameServerUrl } from "../../../shared/server-status";
import { Avatar } from "./Avatar";
import {
  ACCEL,
  CAM_BACK,
  CAM_FOV,
  CAM_HEIGHT,
  CAM_LOOK_AHEAD,
  CONFIRM_MS,
  COUNTDOWN_LABELS,
  COUNTDOWN_STEP,
  FINISH_Z,
  HALF_WIDTH,
  MATCH_MS,
  MAX_DT,
  MOVE_EPS,
  POS_SEND_MS,
  PREROLL_MS,
  REMOTE_EASE,
  SERVER_GRACE_MS,
  SPEED,
  START_Z,
  TURN_MS,
  progressOf,
} from "./constants";
import { devRoom, type RoomLink } from "./devRoom";
import { Doll } from "./Doll";
import { Hud, escapeHtml, type RunnerRow } from "./Hud";
import { InputController } from "./InputController";
import type { LrInit, LrSnap, LrSong, LrState, LrStatus } from "./LuzRojaProtocol";
import { LuzRojaSocket } from "./LuzRojaSocket";
import { CHANT, SoundEffects } from "./SoundEffects";
import { Stage } from "./Stage";

type State = "waiting" | "countdown" | "playing" | "out" | "fin" | "over";

/** Un rival: posicion dibujada (suavizada) y la ultima que llego. */
interface Remote {
  avatar: Avatar;
  x: number;
  z: number;
  yaw: number;
  tx: number;
  tz: number;
  tyaw: number;
  moving: boolean;
  speed: number;
}

/** La ultima silaba cae este tiempo antes del giro, para que se escuche entera. */
const CHANT_TAIL_MS = 150;

/**
 * Luz Roja, Luz Verde: juego SOLO de sala. Supabase maneja lobby / marcador /
 * rejoin (via RoomMode) y el game server es duenio del semaforo y del resultado de
 * cada uno (namespace `/luzroja`).
 *
 * El reparto (ver `server/src/games/luzroja.ts`):
 *  - El CLIENTE simula su muñeco y juzga su propia eliminacion: con los ojos de la
 *    muñeca prendidos (TURN_MS despues de VER el rojo), moverse por encima de
 *    MOVE_EPS elimina. Contarlo desde que cada uno lo ve es lo que hace que la
 *    latencia no castigue a nadie.
 *  - El SERVER decide las luces, el reloj y valida la llegada.
 *
 * Puntaje (`higher`): el que pasa suma 100 + los segundos que le sobraron; el que no,
 * su avance hacia la meta (0-100).
 */
export class Game {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly doll: Doll;
  private readonly hud: Hud;
  private readonly input: InputController;
  private readonly room: RoomLink | null;

  private socket: LuzRojaSocket | null = null;
  private connecting = false;
  private connectStartedAt = 0;

  private state: State = "waiting";
  private lastCountdownIndex = -1;
  private lastTime = performance.now();
  private prerollEnd = 0;

  private seats: string[] = [];
  private mySeat = -1;
  private latest: LrState | null = null;
  private prevStatus: LrStatus[] | null = null;
  /** Momento local en que llego el ultimo estado (el reloj corre desde ahi). */
  private stateArrivedAt = 0;

  // Jugador propio.
  private x = 0;
  private z = START_Z + 1.5;
  private vx = 0;
  private vz = 0;
  private yaw = Math.PI;
  private myAvatar: Avatar | null = null;
  private readonly remotes = new Map<number, Remote>();
  private posTimer = 0;

  // Semaforo local.
  private lightSeq = -1;
  private light: "green" | "red" | null = null;
  private lightStart = 0;
  private lightDur = 0;
  /** Ritmo de la cancion del verde actual (lo sortea el server). */
  private song: LrSong = "steady";
  /** Momento local en que se prenden los ojos (desde ahi moverse elimina). */
  private eyesAt = 0;
  private eyesOn = false;

  private reported = false;
  private confirmTimer: number | null = null;
  /** Resultado local, por si el server no confirma. */
  private localScore = 0;

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.domElement.className = "game-canvas";
    container.append(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(CAM_FOV, 1, 0.1, 300);
    new Stage(this.scene);
    this.doll = new Doll(this.scene);
    this.hud = new Hud(container);
    this.input = new InputController(container);

    this.resize();
    window.addEventListener("resize", this.resize);

    this.room =
      initRoomMode("luz-roja", {
        getScore: () => this.currentScore(),
        onStart: () => this.beginCountdown(),
        // Resuelto (eliminado o pasado), se sigue mirando la cancha.
        onReportedWaiting: () => true,
      }) ?? devRoom(() => this.beginCountdown());

    requestAnimationFrame(this.tick);

    if (!this.room) {
      if (isRoomMode()) {
        this.hud.showMessage("No disponible", "Este juego necesita las credenciales de la sala y no est&aacute;n configuradas.");
      } else {
        this.hud.showMessage(
          "Solo en salas",
          "Luz Roja, Luz Verde se juega con amigos en una sala. Cre&aacute; o un&iacute;te a una para jugar.",
          { label: "Ir a las salas", onClick: () => (window.location.href = "/rooms/") },
        );
      }
      return;
    }
    if (!isGameServerConfigured()) {
      this.hud.showMessage("No disponible", "Este juego necesita el game server y no est&aacute; configurado (VITE_GAME_SERVER_URL).");
      return;
    }
    this.hud.showMessage("Luz Roja, Luz Verde", "Esper&aacute; a que empiece la ronda...");
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
    const socket = new LuzRojaSocket(
      url,
      this.room.code,
      this.room.me,
      this.room.players(),
      this.room.round(),
      this.room.deadline()?.getTime() ?? 0,
    );
    socket.onInit((init) => this.onInit(init));
    socket.onState((s) => this.onState(s));
    socket.onSnap((snap) => this.onSnap(snap));
    socket.onTease(() => {
      this.doll.tease();
      SoundEffects.playTease();
    });
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
    this.report(0);
  }

  // ---------- Mensajes ----------

  private onInit(init: LrInit): void {
    this.seats = init.seats;
    this.mySeat = init.seat;
    this.buildAvatars();
    if (this.mySeat >= 0 && init.spawn && (this.state === "countdown" || this.state === "waiting")) {
      this.x = init.spawn.x;
      this.z = init.spawn.z;
      this.yaw = init.spawn.r;
    }
    this.onState(init);
  }

  private buildAvatars(): void {
    this.seats.forEach((name, seat) => {
      if (seat === this.mySeat) {
        if (!this.myAvatar) {
          this.myAvatar = new Avatar(seat, name, false);
          this.scene.add(this.myAvatar.root, this.myAvatar.shadow);
        }
        return;
      }
      if (this.remotes.has(seat)) return;
      const avatar = new Avatar(seat, name, true);
      this.scene.add(avatar.root, avatar.shadow);
      this.remotes.set(seat, { avatar, x: 0, z: START_Z, yaw: Math.PI, tx: 0, tz: START_Z, tyaw: Math.PI, moving: false, speed: 0 });
    });
  }

  private onState(s: LrState): void {
    const now = performance.now();
    this.latest = s;
    this.stateArrivedAt = now;
    if (s.phase === "preroll") this.prerollEnd = now + s.msLeft;

    if (s.phase === "playing" && s.lightSeq !== this.lightSeq) this.applyLight(s, now);
    this.announce(s);

    if (s.phase === "over") {
      this.finish(s);
      return;
    }
    if (s.phase === "playing" && this.state === "countdown") this.startPlaying();

    if (this.mySeat < 0) {
      if (s.phase !== "waiting" && this.state !== "out") this.resolve("out", 0, false);
      return;
    }

    const mine = s.status[this.mySeat];
    if (mine === "out") {
      if (this.state === "playing" || this.state === "countdown") {
        // El server lo elimino sin que este cliente lo decidiera: se acabo el
        // tiempo, o volvio de un F5 ya eliminado.
        this.resolve("out", s.prog[this.mySeat], true, s.msLeft <= 0 || s.elapsed >= MATCH_MS);
      }
      if (this.state === "out") this.report(s.prog[this.mySeat]);
    } else if (mine === "fin") {
      if (this.state !== "fin") this.resolve("fin", 100 + (MATCH_MS - s.finT[this.mySeat]) / 1000, false);
      this.report(100 + (MATCH_MS - s.finT[this.mySeat]) / 1000);
    }
  }

  /** Nueva luz. La cancion se reparte en la duracion del verde: su ritmo es el aviso. */
  private applyLight(s: LrState, now: number): void {
    this.lightSeq = s.lightSeq;
    this.light = s.light;
    this.lightDur = s.lightDur;
    this.song = s.song ?? "steady";
    this.lightStart = now - Math.max(0, s.lightDur - s.lightLeft);
    this.eyesOn = false;
    this.doll.setEyes(false);
    if (s.light === "green") {
      this.doll.face(false);
      const elapsed = (now - this.lightStart) / 1000;
      SoundEffects.playChant(this.chantTimes().map((t) => t - elapsed));
    } else {
      // El margen se cuenta desde que este cliente VE el rojo, no desde el server.
      this.eyesAt = now + TURN_MS;
      this.doll.face(true);
      SoundEffects.playTurn();
    }
    this.hud.setLight(s.light, false);
  }

  /** Segundos (desde el inicio del verde) de cada silaba. */
  private chantTimes(): number[] {
    const span = Math.max(0, this.lightDur - CHANT_TAIL_MS) / 1000;
    const n = CHANT.length;
    return CHANT.map((_, i) => {
      const x = i / (n - 1);
      switch (this.song) {
        // Acelerada: arranca lenta y las ultimas silabas se atropellan.
        case "rush":
          return span * Math.pow(x, 0.55);
        // Cortada: canta las primeras seis parejo, se calla y remata el "1, 2, 3" de golpe.
        case "stutter":
          return i < 6 ? span * 0.5 * (i / 5) : span * (0.84 + ((i - 6) / 2) * 0.16);
        default:
          return span * x;
      }
    });
  }

  /** Avisos de quien cayo o paso, comparando contra el estado anterior. */
  private announce(s: LrState): void {
    const prev = this.prevStatus;
    this.prevStatus = [...s.status];
    if (!prev || s.phase === "waiting" || s.phase === "preroll") return;
    s.status.forEach((st, seat) => {
      if (st === prev[seat] || seat === this.mySeat) return;
      const r = this.remotes.get(seat);
      const who = `<b>${r?.avatar.number ?? ""}</b> ${escapeHtml(this.seats[seat] ?? "")}`;
      if (st === "out") {
        r?.avatar.kill();
        SoundEffects.playShot(false);
        this.hud.feed(`${who} <span class="lr__feed-out">eliminado</span>`);
      } else if (st === "fin") {
        this.hud.feed(`${who} <span class="lr__feed-fin">pas&oacute;</span>`);
      }
    });
  }

  private onSnap(snap: LrSnap): void {
    for (let i = 0; i + 4 < snap.p.length; i += 5) {
      const seat = snap.p[i];
      if (seat === this.mySeat) continue;
      const r = this.remotes.get(seat);
      if (!r || r.avatar.down) continue;
      const first = r.tz === START_Z && r.tx === 0;
      r.tx = snap.p[i + 1];
      r.tz = snap.p[i + 2];
      r.tyaw = snap.p[i + 3];
      r.moving = snap.p[i + 4] === 1;
      if (first) {
        r.x = r.tx;
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

  /** El jugador propio quedo resuelto: eliminado o del otro lado de la linea. */
  private resolve(result: "out" | "fin", score: number, shot: boolean, timeUp = false): void {
    if (this.state === "out" || this.state === "fin" || this.state === "over") return;
    this.state = result;
    this.localScore = score;
    this.vx = this.vz = 0;
    if (result === "out") {
      if (shot) {
        this.myAvatar?.kill();
        SoundEffects.playShot(true);
      }
      if (timeUp) SoundEffects.playTimeUp();
      this.hud.banner(timeUp ? "&iexcl;Tiempo!" : "Eliminado", timeUp ? "No llegaste a cruzar." : "Te moviste con luz roja.");
    } else {
      SoundEffects.playFinish();
      this.hud.banner("&iexcl;Pasaste!", "Mir&aacute; c&oacute;mo les va a los dem&aacute;s.", "good");
    }
    window.setTimeout(() => {
      if (this.state === "out" || this.state === "fin") this.hud.banner(null);
    }, 3200);
    // Si el server no confirma, se reporta lo local para no trabar la ronda.
    this.confirmTimer = window.setTimeout(() => this.report(this.localScore), CONFIRM_MS);
  }

  private finish(s: LrState): void {
    if (this.state === "over") return;
    const wasPlaying = this.state === "playing";
    this.state = "over";
    if (this.mySeat >= 0) {
      const st = s.status[this.mySeat];
      const score = st === "fin" ? 100 + (MATCH_MS - s.finT[this.mySeat]) / 1000 : s.prog[this.mySeat];
      if (wasPlaying && st === "out") {
        // Cortado por el reloj en el mismo mensaje que cierra la partida.
        this.myAvatar?.kill();
        SoundEffects.playShot(true);
      }
      this.report(score);
    } else {
      this.report(0);
    }
    this.hud.showCountdown(null);
    this.hud.banner(null);
    this.hud.setJoystick(null);
    SoundEffects.playEnd();
    window.setTimeout(() => this.hud.showResults(this.rows()), 900);
  }

  private report(score: number): void {
    if (this.reported) return;
    this.reported = true;
    if (this.confirmTimer !== null) window.clearTimeout(this.confirmTimer);
    this.room?.reportScore(Math.round(Math.max(0, score) * 10) / 10);
  }

  private currentScore(): number {
    if (this.state === "out" || this.state === "fin" || this.state === "over") return this.localScore;
    return Math.round(progressOf(this.z) * 10) / 10;
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
    if (this.state === "playing") this.updatePlayer(dt);
    this.updateLight(now);
    this.doll.update(dt, this.light === "green");
    this.updateAvatars(dt);
    this.updateCamera();
    this.updateHud();
    if (this.state === "countdown" || this.state === "playing") this.sendPos(dt);
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
    // No se larga solo al vencer el congelado: el primer verde lo manda el server,
    // y sin luz no hay como saber cuando es seguro correr.
  }

  private updatePlayer(dt: number): void {
    const dir = this.input.direction;
    const k = 1 - Math.exp(-ACCEL * dt);
    this.vx += (dir.x * SPEED - this.vx) * k;
    this.vz += (dir.y * SPEED - this.vz) * k;
    this.x = Math.max(-HALF_WIDTH, Math.min(HALF_WIDTH, this.x + this.vx * dt));
    this.z = Math.min(START_Z + 3, this.z + this.vz * dt);
    const speed = Math.hypot(this.vx, this.vz);
    if (speed > 0.3) {
      let diff = Math.atan2(this.vx, this.vz) - this.yaw;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      this.yaw += diff * Math.min(1, dt * 12);
    }

    if (this.z <= FINISH_Z) {
      // Cruzo: se manda la posicion antes del aviso, que el server valida contra ella.
      this.socket?.sendPos(this.x, this.z, this.yaw, false);
      this.socket?.sendFinish();
      const elapsed = this.latest ? this.latest.elapsed : 0;
      this.resolve("fin", 100 + (MATCH_MS - elapsed) / 1000, false);
      return;
    }

    if (this.eyesOn && speed > MOVE_EPS) {
      this.socket?.sendPos(this.x, this.z, this.yaw, true);
      this.socket?.sendOut();
      this.resolve("out", progressOf(this.z), true);
    }
  }

  /** Cancion marcada en el HUD y los ojos, que se prenden TURN_MS despues del rojo. */
  private updateLight(now: number): void {
    if (this.light === "green") {
      const t = (now - this.lightStart) / 1000;
      this.hud.setChant(this.chantTimes().filter((x) => x <= t).length);
    } else if (this.light === "red") {
      this.hud.setChant(CHANT.length);
      if (!this.eyesOn && now >= this.eyesAt) {
        this.eyesOn = true;
        this.doll.setEyes(true);
        this.hud.setLight("red", true);
        SoundEffects.playScan();
      }
    }
  }

  private sendPos(dt: number): void {
    this.posTimer += dt * 1000;
    if (this.posTimer < POS_SEND_MS) return;
    this.posTimer = 0;
    this.socket?.sendPos(this.x, this.z, this.yaw, Math.hypot(this.vx, this.vz) > 0.3);
  }

  private updateAvatars(dt: number): void {
    if (this.myAvatar) {
      // Ya del otro lado, camina un poco mas y se queda.
      if (this.state === "fin" && this.z > FINISH_Z - 3) this.z -= dt * 2.5;
      this.myAvatar.place(this.x, this.z, this.yaw);
      const walking = this.state === "fin" && this.z > FINISH_Z - 3 ? 2.5 : Math.hypot(this.vx, this.vz);
      this.myAvatar.animate(dt, walking);
    }
    const k = 1 - Math.exp(-REMOTE_EASE * dt);
    const on = this.latest?.on;
    for (const [seat, r] of this.remotes) {
      if (!r.avatar.down) {
        const px = r.x;
        const pz = r.z;
        r.x += (r.tx - r.x) * k;
        r.z += (r.tz - r.z) * k;
        let diff = r.tyaw - r.yaw;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        r.yaw += diff * k;
        if (dt > 0) r.speed += (Math.hypot(r.x - px, r.z - pz) / dt - r.speed) * Math.min(1, dt * 10);
      }
      r.avatar.place(r.x, r.z, r.yaw);
      r.avatar.animate(dt, r.moving ? Math.max(r.speed, 2.5) : 0);
      r.avatar.setOffline(on ? on[seat] === false : false);
    }
  }

  private updateCamera(): void {
    const following = (this.state === "countdown" || this.state === "playing") && this.mySeat >= 0;
    if (following) {
      // Fija, detras y arriba, mirando adelante: la muñeca tiene que entrar siempre.
      this.camera.position.set(this.x * 0.85, CAM_HEIGHT, this.z + CAM_BACK);
      this.camera.lookAt(this.x * 0.85, 1.4, this.z - CAM_LOOK_AHEAD);
      return;
    }
    // Resuelto o esperando: la cancha entera desde atras de la largada.
    this.camera.position.set(0, 15, START_Z + 8);
    this.camera.lookAt(0, 1.5, -6);
  }

  private updateHud(): void {
    const s = this.latest;
    if (!s) return;
    // El reloj corre local entre mensajes, a partir del ultimo `elapsed` del server.
    const left =
      s.phase === "playing"
        ? Math.max(0, MATCH_MS - s.elapsed - (performance.now() - this.stateArrivedAt))
        : s.phase === "preroll"
          ? MATCH_MS
          : 0;
    this.hud.setClock(left);
    this.hud.setRunners(this.rows());
    this.hud.setJoystick(this.state === "playing" ? this.input.joystick : null);
  }

  private rows(): RunnerRow[] {
    const s = this.latest;
    return this.seats.map((name, seat) => {
      const mine = seat === this.mySeat;
      const remote = this.remotes.get(seat);
      const status = s ? s.status[seat] : "run";
      // El avance propio se muestra en vivo; el ajeno, con la posicion suavizada.
      const prog =
        status === "run" ? progressOf(mine ? this.z : (remote?.z ?? START_Z)) : status === "fin" ? 100 : (s?.prog[seat] ?? 0);
      return {
        seat,
        name,
        number: mine ? (this.myAvatar?.number ?? "") : (remote?.avatar.number ?? ""),
        status: mine && (this.state === "out" || this.state === "fin") ? this.state : status,
        prog: mine && this.state === "fin" ? 100 : prog,
        finT: s ? s.finT[seat] : -1,
        mine,
      };
    });
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
