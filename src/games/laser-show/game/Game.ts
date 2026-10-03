import * as THREE from "three";
import { initRoomMode, isRoomMode } from "../../../shared/room/roomMode";
import { isGameServerConfigured, resolveGameServerUrl } from "../../../shared/server-status";
import { Avatar } from "./Avatar";
import {
  CAM_BOTTOM_PX,
  CAM_BOTTOM_PX_PORTRAIT,
  CAM_FOV,
  CAM_MARGIN,
  CAM_PITCH,
  CAM_PITCH_PORTRAIT,
  CAM_TOP_PX,
  CONFIRM_MS,
  COUNTDOWN_LABELS,
  COUNTDOWN_STEP,
  DEATH_Y,
  FLAG_GROUNDED,
  FLAG_MOVING,
  MAX_DT,
  POS_SEND_MS,
  PREROLL_MS,
  PUSH_COOLDOWN_MS,
  REMOTE_EASE,
  SERVER_GRACE_MS,
  STAGE_R,
  ZONE_COLOR,
  seatColor,
} from "./constants";
import { devRoom, type RoomLink } from "./devRoom";
import { Hud, escapeHtml, formatSeconds, type PlayerRow } from "./Hud";
import { InputController } from "./InputController";
import type { LsInit, LsShove, LsSnap, LsState } from "./LaserShowProtocol";
import { LaserShowSocket } from "./LaserShowSocket";
import { buildShow, difficulty, hitsPlayer, laserEnd, laserStart, type Laser, type Show } from "./Lasers";
import { LaserView, laserColor } from "./LaserView";
import { Particles } from "./Particles";
import { Player } from "./Player";
import { SoundEffects } from "./SoundEffects";
import { PYLON_H, Stage } from "./Stage";

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
}

/**
 * Laser Show: un escenario redondo de programa de TV y lasers que lo barren. Juego
 * SOLO de sala: Supabase maneja lobby / marcador / rejoin (via RoomMode) y el game
 * server es duenio de la semilla del show y del reloj (namespace `/lasershow`).
 *
 * El reparto (ver `server/src/games/lasershow.ts`):
 *  - El SERVER manda la semilla y el reloj de la partida, lleva el orden de
 *    eliminacion, reenvia las posiciones y resuelve los empujones.
 *  - El CLIENTE genera el show entero con la semilla (`buildShow`), dibuja cada laser
 *    como funcion del reloj, simula su muñeco y juzga su propio toque de laser
 *    (`ls:dead`), asi la latencia no castiga a nadie.
 *
 * Puntaje: segundos aguantados (`higher`).
 */
export class Game {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly stage: Stage;
  private readonly particles = new Particles();
  private readonly hud: Hud;
  private readonly input: InputController;
  private readonly room: RoomLink | null;

  private socket: LaserShowSocket | null = null;
  private connecting = false;
  private connectStartedAt = 0;

  private state: State = "waiting";
  private lastCountdownIndex = -1;
  private lastTime = performance.now();

  private seats: string[] = [];
  private mySeat = -1;
  private latest: LsState | null = null;
  private prevAlive: boolean[] | null = null;
  private prevLap = false;

  private show: Show | null = null;
  private laserView: LaserView | null = null;
  /**
   * Hora local (performance.now) que corresponde al ms 0 de la partida. Se estima con
   * el MINIMO de (llegada - elapsed) visto: la muestra que menos latencia comio. Asi el
   * reloj solo avanza (nunca salta para atras con un paquete demorado) y todos los
   * lasers se mueven parejo entre estados (ver "Interpolar sobre el reloj del server"
   * en el CLAUDE.md raiz).
   */
  private clockBase: number | null = null;
  /** Reloj de partida del cuadro anterior: el choque barre de aca al actual. */
  private lastT = -PREROLL_MS;
  private waveIndex = 0;
  private lastTempo = -1;

  private readonly player = new Player();
  private myAvatar: Avatar | null = null;
  private myMarker: { ring: THREE.Mesh; arrow: THREE.Mesh } | null = null;
  private readonly remotes = new Map<number, Remote>();
  private pushReadyAt = 0;
  private posTimer = 0;

  private myTime = -1;
  private reported = false;
  private confirmTimer: number | null = null;

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.domElement.className = "game-canvas";
    container.append(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(CAM_FOV, 1, 0.1, 200);
    this.stage = new Stage(this.scene);
    this.scene.add(this.particles.points);

    this.hud = new Hud(container);
    this.input = new InputController(container);
    this.hud.onJump(() => this.input.requestJump());
    this.hud.onPush(() => this.input.requestPush());

    this.resize();
    window.addEventListener("resize", this.resize);

    this.room =
      initRoomMode("laser-show", {
        getScore: () => this.currentScore(),
        onStart: () => this.beginCountdown(),
        // Afuera, se sigue mirando el show en vez de la espera generica de la sala.
        onReportedWaiting: () => true,
      }) ?? devRoom(() => this.beginCountdown());

    requestAnimationFrame(this.tick);

    if (!this.room) {
      if (isRoomMode()) {
        this.hud.showMessage("No disponible", "L&aacute;ser Show necesita las credenciales de la sala y no est&aacute;n configuradas.");
      } else {
        this.hud.showMessage(
          "Solo en salas",
          "L&aacute;ser Show se juega con amigos en una sala. Cre&aacute; o un&iacute;te a una para jugar.",
          { label: "Ir a las salas", onClick: () => (window.location.href = "/rooms/") },
        );
      }
      return;
    }
    if (!isGameServerConfigured()) {
      this.hud.showMessage("No disponible", "L&aacute;ser Show necesita el game server y no est&aacute; configurado (VITE_GAME_SERVER_URL).");
      return;
    }
    this.hud.showMessage("L&aacute;ser Show", "Esper&aacute; a que empiece la ronda...");
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
    const socket = new LaserShowSocket(url, this.room.code, this.room.me, this.room.players(), this.room.round());
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
    SoundEffects.stopMusic();
    this.hud.showHud(false);
    this.hud.banner(null);
    this.hud.showCountdown(null);
    this.hud.showMessage("Sin conexi&oacute;n", "No se pudo conectar al game server. La ronda sigue con los dem&aacute;s.");
    this.report(0);
  }

  // ---------- Mensajes ----------

  private onInit(init: LsInit): void {
    this.seats = init.seats;
    this.mySeat = init.seat;
    this.buildAvatars();
    if (this.mySeat >= 0 && init.spawn && (this.state === "countdown" || this.state === "playing")) {
      const { x, y, z, r } = init.spawn;
      this.player.place(x, y, z, r);
    }
    this.onState(init);
  }

  private buildAvatars(): void {
    this.seats.forEach((name, seat) => {
      if (seat === this.mySeat) {
        if (!this.myAvatar) {
          this.myAvatar = new Avatar(seat, null);
          this.scene.add(this.myAvatar.root, this.myAvatar.shadow);
          this.myMarker = this.buildMarker(seat);
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
      });
    });
  }

  private onState(s: LsState): void {
    const now = performance.now();
    this.latest = s;
    if (s.phase === "preroll" || s.phase === "playing") {
      const base = now - s.elapsed;
      this.clockBase = this.clockBase === null ? base : Math.min(this.clockBase, base);
    }
    if (!this.show && s.seed > 0) {
      this.show = buildShow(s.seed);
      this.laserView = new LaserView(this.scene, this.show);
    }

    this.announceOuts(s);
    this.announceLap(s);

    if (s.phase === "over") {
      this.finish(s);
      return;
    }
    if (s.phase === "playing" && this.state === "countdown") this.startPlaying();

    if (this.mySeat < 0) {
      if (s.phase !== "waiting" && this.state !== "dead") this.enterSpectator(0, null);
      return;
    }
    const mine = s.times[this.mySeat];
    if (!s.alive[this.mySeat] && mine >= 0 && s.phase !== "waiting") {
      if (this.state === "dead") {
        this.myTime = mine;
        this.report(mine);
      } else if (this.state !== "over") {
        // El server me dio por afuera (desconexion larga, o largue desconectado).
        this.enterSpectator(mine, null);
      }
    }
  }

  private announceOuts(s: LsState): void {
    const prev = this.prevAlive;
    this.prevAlive = [...s.alive];
    if (!prev || s.phase !== "playing") return;
    s.alive.forEach((alive, seat) => {
      if (alive || !prev[seat] || seat === this.mySeat) return;
      this.hud.feed(
        `<b style="color:${seatColor(seat)}">${escapeHtml(this.seats[seat] ?? "")}</b> qued&oacute; afuera <span>${formatSeconds(s.times[seat])}</span>`,
      );
      SoundEffects.playOtherOut();
      // Si estaba sobre el escenario, chisporrotea; si se cayo, ya se perdio abajo.
      const r = this.remotes.get(seat);
      if (r?.seen && r.y > -1) this.particles.burst(r.x, r.y, r.z, "#ffffff", 50);
    });
  }

  private announceLap(s: LsState): void {
    if (!s.lap || this.prevLap) {
      this.prevLap = s.lap;
      return;
    }
    this.prevLap = true;
    if (this.state === "playing") {
      this.hud.banner("&iexcl;&Uacute;ltimo en pie!", "Vuelta de honor: aguant&aacute; hasta el final.", "good");
      SoundEffects.playLastStanding();
      window.setTimeout(() => {
        if (this.state === "playing") this.hud.banner(null);
      }, 2600);
    }
  }

  private onSnap(snap: LsSnap): void {
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
  private onShove(shove: LsShove): void {
    if (this.state !== "playing") return;
    this.player.shove(shove.vx, shove.vy, shove.vz);
    SoundEffects.playShoved();
    const name = this.seats[shove.from];
    if (name) this.hud.feed(`<b style="color:${seatColor(shove.from)}">${escapeHtml(name)}</b> te empuj&oacute;`);
  }

  private onPushFx(seat: number): void {
    if (seat === this.mySeat) return;
    const r = this.remotes.get(seat);
    if (!r || !r.avatar.visible) return;
    r.avatar.push();
    SoundEffects.playPushOther();
  }

  private buildMarker(seat: number): { ring: THREE.Mesh; arrow: THREE.Mesh } {
    const color = new THREE.Color(seatColor(seat));
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.5, 0.64, 32),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.renderOrder = 3;
    const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.45, 4), new THREE.MeshBasicMaterial({ color, depthTest: false }));
    arrow.rotation.x = Math.PI;
    arrow.renderOrder = 11;
    ring.visible = arrow.visible = false;
    this.scene.add(ring, arrow);
    return { ring, arrow };
  }

  // ---------- Transiciones ----------

  private startPlaying(): void {
    if (this.state !== "countdown") return;
    this.state = "playing";
    this.hud.showCountdown(null);
    this.hud.banner(null);
    SoundEffects.playJingle();
    SoundEffects.startMusic();
  }

  /** Me toco un laser (`laser`) o me cai del escenario (null). */
  private die(laser: Laser | null, t: number): void {
    if (this.state !== "playing") return;
    const p = this.player;
    this.socket?.sendPos(p.x, p.y, p.z, p.yaw, 0);
    this.socket?.sendDead();
    if (laser) {
      const color = laser.kind === "spin" ? laserColor(laser.arms[0]) : laser.kind === "wall" ? laserColor(laser.h) : ZONE_COLOR;
      this.particles.burst(p.x, p.y, p.z, color, 90);
      this.particles.burst(p.x, p.y, p.z, "#ffffff", 30);
      SoundEffects.playZapped();
    } else {
      SoundEffects.playFall();
    }
    this.enterSpectator(Math.max(0, Math.round(t)), laser ? "zap" : "fall");
    this.confirmTimer = window.setTimeout(() => this.report(this.myTime), CONFIRM_MS);
  }

  private enterSpectator(time: number, how: "zap" | "fall" | null): void {
    this.state = "dead";
    this.myTime = time;
    this.hud.showCountdown(null);
    this.hud.setSpectating(true);
    if (this.myAvatar) this.myAvatar.visible = false;
    const title = how === "zap" ? "&iexcl;Te toc&oacute; un l&aacute;ser!" : how === "fall" ? "&iexcl;Te ca&iacute;ste!" : "Fuera del show";
    this.hud.banner(title, `Aguantaste ${formatSeconds(time)}. Mir&aacute; c&oacute;mo siguen los dem&aacute;s.`);
    window.setTimeout(() => {
      if (this.state === "dead") this.hud.banner(null);
    }, 3200);
    if (how === null) this.report(time);
  }

  private finish(s: LsState): void {
    if (this.state === "over") return;
    const won = this.state === "playing";
    this.state = "over";
    SoundEffects.stopMusic();
    if (this.mySeat >= 0 && s.times[this.mySeat] >= 0) this.myTime = s.times[this.mySeat];
    this.report(Math.max(0, this.myTime));
    this.hud.showCountdown(null);
    this.hud.banner(null);
    this.hud.setSpectating(true);
    // El show se apaga: los lasers del reloj congelado no quedan colgados detras de los resultados.
    this.laserView?.clear();
    this.stage.setPylon(null);
    if (won) SoundEffects.playWin();
    else SoundEffects.playEnd();
    window.setTimeout(() => this.hud.showResults(this.rows()), 900);
  }

  /** Reporta a la sala los segundos aguantados (una sola vez). */
  private report(ms: number): void {
    if (this.reported) return;
    this.reported = true;
    if (this.confirmTimer !== null) window.clearTimeout(this.confirmTimer);
    this.room?.reportScore(Math.round(Math.max(0, ms) / 100) / 10);
  }

  private currentScore(): number {
    if (this.state === "playing") return Math.round(Math.max(0, this.elapsedNow(performance.now())) / 100) / 10;
    return Math.round(Math.max(0, this.myTime) / 100) / 10;
  }

  // ---------- Bucle ----------

  private tick = (now: number): void => {
    const dt = Math.min((now - this.lastTime) / 1000, MAX_DT);
    this.lastTime = now;
    this.update(dt, now);
    this.renderer.render(this.scene, this.camera);
    requestAnimationFrame(this.tick);
  };

  /** Ms de partida ahora: negativo en la cuenta regresiva, congelado al terminar. */
  private elapsedNow(now: number): number {
    const s = this.latest;
    if (s?.phase === "over") return s.elapsed;
    if (this.clockBase === null) return -PREROLL_MS;
    return now - this.clockBase;
  }

  private update(dt: number, now: number): void {
    const t = this.elapsedNow(now);
    // El reloj solo avanza; si por algo volviera para atras, no se barre al reves.
    const tPrev = Math.min(this.lastT, t);
    if (this.laserView) {
      const ev = this.laserView.update(tPrev, t);
      if (this.state !== "over") this.stage.setPylon(ev.spinColor);
      if (this.state !== "waiting" && this.state !== "over") {
        if (ev.spinWarn) SoundEffects.playSpinWarn();
        if (ev.spinGo) SoundEffects.playSpinGo();
        if (ev.wallGo) SoundEffects.playWallGo();
        if (ev.zoneWarn) SoundEffects.playZoneWarn();
        if (ev.zoneBlast) SoundEffects.playZoneBlast();
      }
    }
    this.announceWaves(t);
    if (this.state === "countdown") this.updateCountdown(t);
    if (this.state === "countdown" || this.state === "playing") this.updatePlayer(dt, tPrev, t);
    this.lastT = t;
    if (this.state === "playing") {
      const tempo = Math.round(difficulty(t) * 10);
      if (tempo !== this.lastTempo) {
        this.lastTempo = tempo;
        SoundEffects.musicTempo(tempo / 10);
      }
    }
    this.particles.update(dt);
    this.stage.update(dt);
    this.updateRemotes(dt);
    this.updateHud(t, now);
  }

  /** El locutor anuncia cada prueba (las que ya pasaron hace rato no: F5 a mitad de show). */
  private announceWaves(t: number): void {
    const waves = this.show?.waves;
    if (!waves) return;
    while (this.waveIndex < waves.length && waves[this.waveIndex].t <= t) {
      const w = waves[this.waveIndex++];
      if (t - w.t < 800 && this.state !== "over") this.hud.announce(w.title);
    }
  }

  private updateCountdown(t: number): void {
    if (this.latest?.phase !== "preroll") {
      const now = performance.now();
      if (!this.latest && this.connectStartedAt > 0 && now - this.connectStartedAt > SERVER_GRACE_MS) this.giveUp();
      return;
    }
    this.hud.banner(null);
    const remaining = -t;
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

  private updatePlayer(dt: number, tPrev: number, t: number): void {
    if (this.mySeat < 0) return;
    const playing = this.state === "playing";
    const jump = this.input.consumeJump();
    // Se consume siempre: un clic del countdown no puede salir como empujon al largar.
    const push = this.input.consumePush();
    let wx = 0;
    let wz = 0;
    if (playing) {
      if (jump) this.player.requestJump();
      if (push) this.tryPush();
      const dir = this.input.direction;
      wx = dir.x;
      wz = dir.y;
    }
    const events = this.player.update(dt, wx, wz);
    const p = this.player;

    if (playing) {
      if (events.jumped) SoundEffects.playJump();
      if (events.landed > 8) SoundEffects.playLand();
    }

    this.posTimer += dt * 1000;
    if (this.posTimer >= POS_SEND_MS) {
      this.posTimer = 0;
      this.socket?.sendPos(p.x, p.y, p.z, p.yaw, this.flags());
    }
    if (!playing) return;

    if (p.y < DEATH_Y) {
      this.die(null, t);
      return;
    }
    const lasers = this.show?.lasers;
    if (!lasers || t <= 0) return;
    const bodyH = p.bodyHeight;
    // A lo sumo un cuadro largo para atras: al volver de un F5 (o de la pestaña dormida)
    // el primer cuadro barreria la partida entera y te mataria por lasers que ya pasaron.
    const from = Math.max(0, tPrev, t - MAX_DT * 1000);
    for (const l of lasers) {
      if (laserStart(l) > t || laserEnd(l) < from) continue;
      if (hitsPlayer(l, from, t, p.x, p.y, p.z, bodyH)) {
        this.die(l, t);
        return;
      }
    }
  }

  private flags(): number {
    const p = this.player;
    return (p.grounded ? FLAG_GROUNDED : 0) | (p.moving ? FLAG_MOVING : 0);
  }

  /** Empujon hacia donde mira el muñeco (la posicion va antes: el server mide con la ultima). */
  private tryPush(): void {
    const now = performance.now();
    if (now < this.pushReadyAt) return;
    this.pushReadyAt = now + PUSH_COOLDOWN_MS;
    const p = this.player;
    this.socket?.sendPos(p.x, p.y, p.z, p.yaw, this.flags());
    this.socket?.sendPush(p.yaw);
    this.myAvatar?.push();
    SoundEffects.playPush();
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
      const pz = r.z;
      r.x += (r.tx - r.x) * k;
      r.y += (r.ty - r.y) * k;
      r.z += (r.tz - r.z) * k;
      let diff = r.tyaw - r.yaw;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      r.yaw += diff * k;
      if (dt > 0) r.speed += (Math.hypot(r.x - px, r.z - pz) / dt - r.speed) * Math.min(1, dt * 10);
      r.avatar.root.position.set(r.x, r.y, r.z);
      r.avatar.root.rotation.y = r.yaw;
      const moving = (r.flags & FLAG_MOVING) !== 0;
      r.avatar.animate(dt, moving ? Math.max(r.speed, 2.5) : 0, (r.flags & FLAG_GROUNDED) !== 0);
      r.avatar.setOffline(on ? on[seat] === false : false);
      this.placeShadow(r.avatar, r.x, r.y, r.z);
    }
    if (!this.myAvatar) return;
    const visible = this.state === "countdown" || this.state === "playing";
    this.myAvatar.visible = visible;
    const p = this.player;
    if (visible) {
      this.myAvatar.root.position.set(p.x, p.y, p.z);
      this.myAvatar.root.rotation.y = p.yaw;
      this.myAvatar.animate(dt, Math.hypot(p.vx, p.vz), p.grounded);
      this.placeShadow(this.myAvatar, p.x, p.y, p.z);
    }
    if (this.myMarker) {
      const { ring, arrow } = this.myMarker;
      ring.visible = visible && this.myAvatar.shadow.visible;
      ring.position.set(p.x, 0.03, p.z);
      arrow.visible = visible;
      arrow.position.set(p.x, p.y + 2.2 + Math.sin(performance.now() / 180) * 0.1, p.z);
      arrow.rotation.y += dt * 2.5;
    }
  }

  /** Sombra sobre el escenario si hay piso debajo (sirve para medir el salto). */
  private placeShadow(avatar: Avatar, x: number, y: number, z: number): void {
    if (y < -0.05 || !this.player.supported(x, z)) {
      avatar.shadow.visible = false;
      return;
    }
    avatar.shadow.visible = true;
    avatar.shadow.position.set(x, 0.02, z);
    avatar.shadow.scale.setScalar(Math.max(0.45, 1 - y / 6));
  }

  private updateHud(t: number, now: number): void {
    const s = this.latest;
    if (!s) return;
    const aliveCount = s.alive.filter(Boolean).length;
    let clock = Math.max(0, t);
    if (this.state === "dead" || (this.state === "over" && this.myTime >= 0)) clock = this.myTime;
    this.hud.setClock(clock, aliveCount, s.alive.length, s.phase === "over" ? "over" : s.lap ? "lap" : "run");
    this.hud.setPlayers(this.rows());
    this.hud.setJoystick(this.state === "playing" ? this.input.joystick : null);
    this.hud.setPushCooldown(Math.max(0, (this.pushReadyAt - now) / PUSH_COOLDOWN_MS));
  }

  private rows(): PlayerRow[] {
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

  private resize = (): void => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.fov = CAM_FOV;
    this.fitCamera(w, h);
  };

  /**
   * Encuadra el escenario ENTERO, fijo (el de Pista Loca): busca la distancia minima a
   * la que el borde del escenario (y la cabeza de un muñeco parado en el fondo, y la
   * torre) entran en la franja libre entre el HUD de arriba y los botones de abajo, y
   * despues corre el cuadro con `setViewOffset` para centrarlo en esa franja.
   */
  private fitCamera(w: number, h: number): void {
    const cam = this.camera;
    const portrait = w < h;
    const pitch = portrait ? CAM_PITCH_PORTRAIT : CAM_PITCH;
    const top = Math.min(CAM_TOP_PX, h * 0.25);
    const bottom = portrait ? CAM_BOTTOM_PX_PORTRAIT : CAM_BOTTOM_PX;
    const bandH = 2 * Math.max(0.2, (h - top - bottom) / h);
    const bandW = 2 - 2 * CAM_MARGIN;
    const points: THREE.Vector3[] = [new THREE.Vector3(0, PYLON_H + 0.6, 0)];
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      const x = Math.cos(a) * (STAGE_R + 0.2);
      const z = Math.sin(a) * (STAGE_R + 0.2);
      points.push(new THREE.Vector3(x, -0.4, z));
      if (z < 0) points.push(new THREE.Vector3(x, 2.2, z));
    }
    const v = new THREE.Vector3();
    cam.clearViewOffset();
    cam.updateProjectionMatrix();
    const place = (d: number): { minX: number; maxX: number; minY: number; maxY: number } => {
      cam.position.set(0, d * Math.sin(pitch), d * Math.cos(pitch));
      cam.lookAt(0, 0, 0);
      cam.updateMatrixWorld();
      const box = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
      for (const p of points) {
        v.copy(p).project(cam);
        box.minX = Math.min(box.minX, v.x);
        box.maxX = Math.max(box.maxX, v.x);
        box.minY = Math.min(box.minY, v.y);
        box.maxY = Math.max(box.maxY, v.y);
      }
      return box;
    };
    let lo = 6;
    let hi = 200;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      const b = place(mid);
      if (b.maxX - b.minX <= bandW && b.maxY - b.minY <= bandH) hi = mid;
      else lo = mid;
    }
    const box = place(hi);
    const cx = ((box.minX + box.maxX) / 2 + 1) * 0.5 * w;
    const cy = (1 - (box.minY + box.maxY) / 2) * 0.5 * h;
    const bandCenter = top + (h - top - bottom) / 2;
    cam.setViewOffset(w, h, cx - w / 2, cy - bandCenter, w, h);
    cam.updateProjectionMatrix();
  }
}
