import * as THREE from "three";
import { initRoomMode, isRoomMode } from "../../../shared/room/roomMode";
import { isGameServerConfigured, resolveGameServerUrl } from "../../../shared/server-status";
import { Arena } from "./Arena";
import { Avatar } from "./Avatar";
import {
  CAM_DISTANCE,
  CAM_FOV,
  CAM_PITCH,
  CELLS_PER_LAYER,
  COUNTDOWN_LABELS,
  COUNTDOWN_STEP,
  DEATH_CONFIRM_MS,
  DEATH_Y,
  GRID,
  LAYERS,
  MAX_DT,
  POS_SEND_MS,
  PREROLL_MS,
  REMOTE_EASE,
  SPECTATOR_BACK,
  SPECTATOR_HEIGHT,
  SERVER_GRACE_MS,
  cellCenterX,
  seatColor,
  surfaceY,
} from "./constants";
import { FLAG_GROUNDED, FLAG_MOVING, type DrInit, type DrSnap, type DrState } from "./DerrumbeProtocol";
import { DerrumbeSocket } from "./DerrumbeSocket";
import { devRoom, type RoomLink } from "./devRoom";
import { Environment } from "./Environment";
import { FloorView } from "./FloorView";
import { Hud, escapeHtml, formatSeconds, type PlayerRow } from "./Hud";
import { InputController } from "./InputController";
import { Player } from "./Player";
import { SoundEffects } from "./SoundEffects";

type State = "waiting" | "countdown" | "playing" | "dead" | "over";

/** Un rival: posicion dibujada (suavizada) y la ultima que llego del server. */
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
 * Derrumbe: TNT Run para salas. Juego SOLO de sala: Supabase maneja lobby /
 * marcador / rejoin (via RoomMode) y el game server es duenio del piso (namespace
 * `/derrumbe`).
 *
 * El reparto (ver `server/src/games/derrumbe.ts` para el porque):
 *  - El CLIENTE simula su propio muñeco (`Player`), predice los bloques que pisa
 *    (titilan y caen sin esperar la red), declara sus pasos y su caida.
 *  - El SERVER programa la caida de cada bloque para toda la sala, reenvia las
 *    posiciones y decide el orden de eliminacion.
 *
 * Puntaje: segundos aguantados. El ultimo en pie suma la vuelta de honor del
 * server (LAP_MS), asi que siempre supera al ultimo que cayo.
 */
export class Game {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly arena = new Arena();
  private readonly floor: FloorView;
  private readonly env: Environment;
  private readonly hud: Hud;
  private readonly input: InputController;
  private readonly room: RoomLink | null;

  private socket: DerrumbeSocket | null = null;
  private connecting = false;
  private connectStartedAt = 0;

  private state: State = "waiting";
  private lastCountdownIndex = -1;
  private lastTime = performance.now();

  private seats: string[] = [];
  private mySeat = -1;
  private latest: DrState | null = null;
  /** Momento local en que termina el congelado del server. */
  private prerollEnd = 0;
  /** Estimacion local del instante de largada (el minimo visto de ahora - elapsed). */
  private playStart: number | null = null;

  private readonly player = new Player();
  private myAvatar: Avatar | null = null;
  private readonly remotes = new Map<number, Remote>();

  private camY = surfaceY(0);
  private specY = surfaceY(1);
  private posTimer = 0;

  /** Ms aguantados propios, una vez caido (o al final). -1 mientras sigue. */
  private myTime = -1;
  private reported = false;
  private deathTimer: number | null = null;
  private prevAlive: boolean[] | null = null;
  private decayAnnounced = false;
  private wonAnnounced = false;
  private fallSoundPlayed = false;
  private lastFuseSound = 0;
  private lastCrumbleSound = 0;

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.domElement.className = "game-canvas";
    container.append(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(CAM_FOV, 1, 0.1, 260);
    this.env = new Environment(this.scene);
    this.floor = new FloorView(this.arena);
    this.scene.add(this.floor.group);

    this.hud = new Hud(container);
    this.input = new InputController(container);
    this.hud.onJump(() => this.input.requestJump());

    this.resize();
    window.addEventListener("resize", this.resize);

    this.room =
      initRoomMode("derrumbe", {
        getScore: () => this.currentScore(),
        onStart: () => this.beginCountdown(),
        // Caido, se sigue mirando la partida en vez de la espera generica de la sala.
        onReportedWaiting: () => true,
      }) ?? devRoom(() => this.beginCountdown());

    requestAnimationFrame(this.tick);

    if (!this.room) {
      if (isRoomMode()) {
        this.hud.showMessage(
          "No disponible",
          "Derrumbe necesita las credenciales de la sala y no est&aacute;n configuradas.",
        );
      } else {
        this.hud.showMessage(
          "Solo en salas",
          "Derrumbe se juega con amigos en una sala. Cre&aacute; o un&iacute;te a una para jugar.",
          { label: "Ir a las salas", onClick: () => (window.location.href = "/rooms/") },
        );
      }
      return;
    }

    if (!isGameServerConfigured()) {
      this.hud.showMessage(
        "No disponible",
        "Derrumbe necesita el game server y no est&aacute; configurado (VITE_GAME_SERVER_URL).",
      );
      return;
    }

    this.hud.showMessage("Derrumbe", "Esper&aacute; a que empiece la ronda...");
  }

  // ---------- Arranque ----------

  /**
   * En sala no hay Enter: lo dispara RoomMode (onStart) al pasar la ronda a
   * "playing". Las etiquetas 3 / 2 / 1 / YA salen del congelado del server (ver
   * `updateCountdown`), asi el YA cae para todos en el mismo instante.
   */
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
    const socket = new DerrumbeSocket(url, this.room.code, this.room.me, this.room.players(), this.room.round());
    socket.onInit((init) => this.onInit(init));
    socket.onState((state) => this.onState(state));
    socket.onSnap((snap) => this.onSnap(snap));
    this.socket = socket;
    void socket.connect();
  }

  /**
   * El server no contesto. Se reporta igual para no dejar la ronda colgada: el
   * cierre anticipado de la sala solo cubre a los DESCONECTADOS, no al que mira un
   * cartel de error.
   */
  private giveUp(): void {
    if (this.state === "over") return;
    this.state = "over";
    this.hud.showHud(false);
    this.hud.banner(null);
    this.hud.showCountdown(null);
    this.hud.showMessage(
      "Sin conexi&oacute;n",
      "No se pudo conectar al game server. La ronda sigue con los dem&aacute;s.",
    );
    this.report(0);
  }

  // ---------- Mensajes del server ----------

  private onInit(init: DrInit): void {
    // Geometria distinta a la compilada: el server esta en otra version.
    if (init.grid !== GRID || init.layers !== LAYERS) {
      this.giveUp();
      return;
    }
    const now = performance.now();
    this.seats = init.seats;
    this.mySeat = init.seat;
    this.arena.reconcile(init.doom, now, true);
    this.floor.syncAll();
    this.buildAvatars();

    if (this.mySeat >= 0 && init.spawn && this.state !== "dead" && this.state !== "over") {
      const { x, y, z, r } = init.spawn;
      this.player.place(x, y, z, r);
      this.camY = y;
    }
    // Un F5 en plena ronda: el server lo devuelve donde estaba, sin countdown.
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

  private onState(s: DrState): void {
    const now = performance.now();
    this.latest = s;

    if (s.phase === "preroll") this.prerollEnd = now + s.msLeft;
    if (s.phase === "playing" || s.phase === "lap") {
      const est = now - s.elapsed;
      if (this.playStart === null || est < this.playStart) this.playStart = est;
    }

    this.announceFalls(s);

    if (s.decay && !this.decayAnnounced && (s.phase === "playing" || s.phase === "lap")) {
      this.decayAnnounced = true;
      SoundEffects.playDecay();
    }
    this.hud.setDecay(s.decay && s.phase !== "over");

    if (s.phase === "over") {
      this.finish(s);
      return;
    }

    if (this.mySeat < 0) {
      // Fuera del roster del server: se mira sin jugar, pero se reporta para no
      // trabar la ronda si RoomMode lo cuenta como jugador.
      if (s.phase !== "waiting" && this.state !== "dead") this.enterSpectator(0, false);
      return;
    }

    const aliveOnServer = s.alive[this.mySeat];
    const serverTime = s.times[this.mySeat];
    if (!aliveOnServer && serverTime >= 0 && s.phase !== "waiting") {
      if (this.state === "dead") {
        // Confirmacion del server de la caida propia: su tiempo es el que vale.
        this.myTime = serverTime;
        this.report(serverTime);
      } else if (this.state !== "over") {
        // El server lo da por caido y aca no (volvio de un F5 ya muerto, o se
        // desconecto demasiado rato): se pasa a mirar con el tiempo del server.
        this.enterSpectator(serverTime, false);
      }
      return;
    }

    if ((s.phase === "playing" || s.phase === "lap") && this.state === "countdown") this.startPlaying();

    if (s.phase === "lap" && this.state === "playing" && !this.wonAnnounced) {
      this.wonAnnounced = true;
      SoundEffects.playWin();
      this.hud.banner("&iexcl;Quedaste en pie!", "Aguant&aacute; la vuelta de honor", "good");
    }
  }

  /** Aviso de quien cayo, comparando contra el estado anterior. */
  private announceFalls(s: DrState): void {
    const prev = this.prevAlive;
    this.prevAlive = [...s.alive];
    if (!prev || (s.phase !== "playing" && s.phase !== "lap")) return;
    s.alive.forEach((alive, seat) => {
      if (alive || !prev[seat] || seat === this.mySeat) return;
      const name = escapeHtml(this.seats[seat] ?? "");
      this.hud.feed(
        `<b style="color:${seatColor(seat)}">${name}</b> cay&oacute; a la lava <span>${formatSeconds(
          s.times[seat],
        )} s</span>`,
      );
      SoundEffects.playOtherOut();
    });
  }

  private onSnap(snap: DrSnap): void {
    const now = performance.now();
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
    for (const idx of snap.f) {
      if (idx >= 0 && idx < this.arena.state.length) this.arena.trigger(idx, now);
    }
    if (snap.doom) {
      for (const idx of this.arena.reconcile(snap.doom, now)) this.floor.restore(idx);
    }
  }

  // ---------- Transiciones ----------

  private startPlaying(): void {
    if (this.state !== "countdown") return;
    this.state = "playing";
    this.hud.showCountdown(null);
    this.hud.banner(null);
    if (this.playStart === null) this.playStart = performance.now();
  }

  /** Tocaste la lava. */
  private die(): void {
    if (this.state !== "playing") return;
    const now = performance.now();
    this.myTime = this.playStart === null ? 0 : now - this.playStart;
    SoundEffects.playLava();
    this.socket?.sendPos(this.player.x, this.player.y, this.player.z, this.player.yaw, 0);
    this.socket?.sendDead();
    this.enterSpectator(this.myTime, true);
    // Si el server no confirma (se corto), se reporta el tiempo local para no
    // dejar la ronda esperando.
    this.deathTimer = window.setTimeout(() => this.report(this.myTime), DEATH_CONFIRM_MS);
  }

  private enterSpectator(timeMs: number, fell: boolean): void {
    this.state = "dead";
    this.myTime = timeMs;
    this.hud.showCountdown(null);
    this.hud.setSpectating(true);
    if (this.myAvatar) this.myAvatar.visible = false;
    this.specY = this.camY;
    this.hud.banner(
      fell ? "&iexcl;Ca&iacute;ste a la lava!" : "Fuera de la partida",
      `Aguantaste ${formatSeconds(timeMs)} s. Mir&aacute; c&oacute;mo caen los dem&aacute;s.`,
    );
    window.setTimeout(() => {
      if (this.state === "dead") this.hud.banner(null);
    }, 3500);
    if (!fell) this.report(timeMs);
  }

  private finish(s: DrState): void {
    if (this.state === "over") return;
    this.state = "over";
    const serverTime = this.mySeat >= 0 ? s.times[this.mySeat] : -1;
    if (serverTime >= 0) this.myTime = serverTime;
    if (this.myTime < 0) this.myTime = 0;
    this.report(this.myTime);
    this.hud.showCountdown(null);
    this.hud.banner(null);
    this.hud.setSpectating(true);
    SoundEffects.playEnd();
    this.hud.showResults(this.playerRows());
  }

  private report(ms: number): void {
    if (this.reported) return;
    this.reported = true;
    if (this.deathTimer !== null) window.clearTimeout(this.deathTimer);
    this.room?.reportScore(Math.round(Math.max(0, ms) / 100) / 10);
  }

  private currentScore(): number {
    if (this.state === "playing" && this.playStart !== null) {
      return Math.round((performance.now() - this.playStart) / 100) / 10;
    }
    return this.myTime > 0 ? Math.round(this.myTime / 100) / 10 : 0;
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
    if (this.state === "countdown" || this.state === "playing") this.updatePlayer(dt, now);

    for (const idx of this.arena.update(now)) {
      this.floor.drop(idx, true);
      if (this.state === "playing" && now - this.lastCrumbleSound > 90 && this.nearPlayer(idx, 4.5)) {
        this.lastCrumbleSound = now;
        SoundEffects.playCrumble();
      }
    }
    this.floor.update(dt, now);
    this.env.update(dt);
    this.updateRemotes(dt);
    this.updateCamera(dt);
    this.updateHud(now);
  }

  private updateCountdown(now: number): void {
    const phase = this.latest?.phase;
    if (phase !== "preroll") {
      if (!this.latest && this.connectStartedAt > 0 && now - this.connectStartedAt > SERVER_GRACE_MS) {
        this.giveUp();
      }
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
    // El paso a "playing" lo confirma el server, pero se larga igual al vencer el
    // congelado: esperar al mensaje le sumaria media latencia a la largada.
    if (remaining <= 0) this.startPlaying();
  }

  private updatePlayer(dt: number, now: number): void {
    if (this.mySeat < 0) return;
    const playing = this.state === "playing";

    const jump = this.input.consumeJump();

    let wx = 0;
    let wz = 0;
    if (playing) {
      if (jump) this.player.requestJump();
      // Camara fija mirando hacia -Z: la pantalla y el mundo coinciden, "arriba" es
      // siempre la misma direccion (derecha = +X, abajo = +Z).
      const dir = this.input.direction;
      wx = dir.x;
      wz = dir.y;
    }

    const events = this.player.update(dt, wx, wz, this.arena);
    if (!playing) return;

    if (events.jumped) SoundEffects.playJump();
    if (events.landed > 9) SoundEffects.playLand();
    if (this.player.grounded) this.fallSoundPlayed = false;
    else if (this.player.vy < -13 && !this.fallSoundPlayed) {
      this.fallSoundPlayed = true;
      SoundEffects.playFall();
    }

    // Pasos: todo bloque entero bajo la huella se prende, aca y en el server.
    const fresh = this.player.footprint(this.arena).filter((idx) => this.arena.trigger(idx, now));
    if (fresh.length > 0) {
      this.socket?.sendSteps(fresh);
      if (now - this.lastFuseSound > 70) {
        this.lastFuseSound = now;
        SoundEffects.playFuse();
      }
    }

    this.posTimer += dt * 1000;
    if (this.posTimer >= POS_SEND_MS) {
      this.posTimer = 0;
      const flags = (this.player.grounded ? FLAG_GROUNDED : 0) | (this.player.moving ? FLAG_MOVING : 0);
      this.socket?.sendPos(this.player.x, this.player.y, this.player.z, this.player.yaw, flags);
    }

    if (this.player.y < DEATH_Y) this.die();
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
        const speed = Math.hypot(r.x - px, r.z - pz) / dt;
        r.speed += (speed - r.speed) * Math.min(1, dt * 10);
        r.vy = (r.y - py) / dt;
      }
      const grounded = (r.flags & FLAG_GROUNDED) !== 0;
      const moving = (r.flags & FLAG_MOVING) !== 0;
      r.avatar.root.position.set(r.x, r.y, r.z);
      r.avatar.root.rotation.y = r.yaw;
      r.avatar.animate(dt, moving ? Math.max(r.speed, 3) : 0, grounded, r.vy);
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

  /** Sombra sobre el primer piso con bloque debajo: dice donde vas a caer. */
  private placeShadow(avatar: Avatar, x: number, y: number, z: number): void {
    for (let layer = 0; layer < LAYERS; layer++) {
      const s = surfaceY(layer);
      if (s > y + 0.05) continue;
      if (!this.player.supported(layer, x, z, this.arena)) continue;
      const height = y - s;
      avatar.shadow.visible = true;
      avatar.shadow.position.set(x, s + 0.02, z);
      avatar.shadow.scale.setScalar(Math.max(0.45, 1 - height / 14));
      return;
    }
    avatar.shadow.visible = false;
  }

  private updateCamera(dt: number): void {
    const following = (this.state === "countdown" || this.state === "playing") && this.mySeat >= 0;
    if (following) {
      const p = this.player;
      // La camara sigue la altura con retraso: al caer se ve el piso de abajo
      // acercandose, que es lo que hace legible la caida.
      this.camY += (p.y - this.camY) * (1 - Math.exp(-7 * dt));
      const h = CAM_DISTANCE * Math.cos(CAM_PITCH);
      const v = CAM_DISTANCE * Math.sin(CAM_PITCH);
      const ty = this.camY + 1.1;
      this.camera.position.set(p.x, ty + v, p.z + h);
      this.camera.lookAt(p.x, ty, p.z);
      return;
    }

    // Espectador (y de fondo en los carteles): vista fija del piso entero desde el
    // mismo lado que la camara de juego, a la altura de los que siguen en pie.
    this.input.consumeJump();
    let sum = 0;
    let n = 0;
    for (const [seat, r] of this.remotes) {
      if (!r.seen || (this.latest && !this.latest.alive[seat])) continue;
      sum += r.y;
      n++;
    }
    const target = n > 0 ? sum / n : surfaceY(1);
    this.specY += (target - this.specY) * (1 - Math.exp(-1.5 * dt));
    this.camera.position.set(0, this.specY + SPECTATOR_HEIGHT, SPECTATOR_BACK);
    this.camera.lookAt(0, this.specY - 1, 0);
  }

  private updateHud(now: number): void {
    const s = this.latest;
    if (s) {
      const alive = s.alive.filter(Boolean).length;
      this.hud.setAlive(alive, s.alive.length);
      this.hud.setPlayers(this.playerRows());
    }
    if (this.state === "playing" && this.playStart !== null) this.hud.setClock(now - this.playStart);
    else if (this.myTime >= 0) this.hud.setClock(this.myTime);
    else this.hud.setClock(0);
    this.hud.setJoystick(this.state === "playing" ? this.input.joystick : null);
  }

  private playerRows(): PlayerRow[] {
    const s = this.latest;
    return this.seats.map((name, seat) => ({
      seat,
      name,
      alive: s ? s.alive[seat] : true,
      time: s ? s.times[seat] : -1,
      mine: seat === this.mySeat,
      offline: s ? !s.on[seat] : false,
    }));
  }

  private nearPlayer(idx: number, dist: number): boolean {
    const rest = idx % CELLS_PER_LAYER;
    const x = cellCenterX(rest % GRID);
    const z = cellCenterX(Math.floor(rest / GRID));
    const y = surfaceY(Math.floor(idx / CELLS_PER_LAYER));
    return Math.hypot(x - this.player.x, z - this.player.z) < dist && Math.abs(y - this.player.y) < 3;
  }

  private resize = (): void => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    // En vertical se abre el campo de vision: si no, el piso entra como una franja.
    this.camera.fov = w < h ? CAM_FOV + 14 : CAM_FOV;
    this.camera.updateProjectionMatrix();
  };

  dispose(): void {
    window.removeEventListener("resize", this.resize);
    this.input.dispose();
    this.socket?.dispose();
    this.renderer.dispose();
  }
}
