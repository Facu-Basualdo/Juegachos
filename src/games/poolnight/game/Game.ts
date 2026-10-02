import * as THREE from "three";
import { initRoomMode, isRoomMode } from "../../../shared/room/roomMode";
import { isGameServerConfigured, resolveGameServerUrl } from "../../../shared/server-status";
import { devRoom, type RoomLink } from "./devRoom";
import {
  BALL_R,
  COUNTDOWN_LABELS,
  barToShotPower,
  HALF_L,
  HALF_W,
  FOOT_X,
  KNUCKLES,
  KNUCKLE_R,
  SERVER_GRACE_MS,
  TEAM_COLORS,
  TEAM_NAMES,
  groupOf,
} from "./constants";
import { MotionPlayer, newPose } from "./MotionPlayer";
import { BallMeshes } from "./BallMeshes";
import { Table } from "./Table";
import { Cue } from "./Cue";
import { AimGuide, type PredictBall } from "./AimGuide";
import { CameraRig, type CamMode } from "./CameraRig";
import { InputController } from "./InputController";
import { Hud } from "./Hud";
import { SoundEffects } from "./SoundEffects";
import { PoolSocket } from "./PoolSocket";
import { EV_BALL, EV_CUE, EV_CUSHION, EV_POCKET } from "./PoolProtocol";
import type { BiEvent, BiInit, BiPlay, BiRejectReason, BiState } from "./PoolProtocol";

type Phase = "waiting" | "connecting" | "live";

/** Cuanto se separa la punta de la blanca por cada unidad de potencia cargada (m). */
const PULL_MAX = 0.3;
const PULL_REST = 0.02;
/** El golpe del taco: ventana antes de `startAt` en que la punta avanza hasta la bola. */
const THRUST_S = 0.2;
const AIM_SEND_MS = 100;
const PLACE_SEND_MS = 120;
const REJECTS: Partial<Record<BiRejectReason, string>> = {
  not_your_turn: "No es tu turno",
  too_early: "Todavía no arrancó",
  bad_spot: "Ahí no entra la blanca",
  cue_not_placed: "Primero apoyá la blanca",
  bad_shot: "Ese tiro no vale",
};

function wrapAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/**
 * Poolnight: pool de bar en equipos (1v1 / 2v2 / 4v4), SOLO en salas. El server arbitra todo
 * (reglas, fisica, turnos, bots); este cliente dibuja la mesa, manda la intencion (apuntar,
 * apoyar la blanca, tirar) y reproduce el desenlace de cada tiro evaluando los tramos de
 * movimiento que llegan en `bi:play` (ver MotionPlayer). Ver el CLAUDE.md del juego.
 */
export class Game {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly container: HTMLElement;
  private readonly table: Table;
  private readonly balls: BallMeshes;
  private readonly cue: Cue;
  private readonly guide: AimGuide;
  private readonly rig: CameraRig;
  private readonly hud: Hud;
  private readonly input: InputController;
  private readonly motion = new MotionPlayer();
  private readonly room: RoomLink | null;

  private readonly raycaster = new THREE.Raycaster();
  private readonly plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -BALL_R);
  private readonly hit = new THREE.Vector3();
  private readonly ndc = new THREE.Vector2();
  private readonly pose = newPose();

  private socket: PoolSocket | null = null;
  private connecting = false;
  private connectStartedAt = 0;
  private serverUrl = "";
  private connectError = "";
  private phase: Phase = "waiting";

  private state: BiState | null = null;
  private seat = -1;
  /** serverNow = Date.now() + offset. Se afina con ping/pong (el de menor RTT gana). */
  private offset = 0;
  private bestRtt = Infinity;
  private pingTimer = 0;

  /** Lo que se esta mostrando de cada bola (la posicion antes del tiro, o la final). */
  private readonly shown: PredictBall[] = Array.from({ length: 16 }, () => ({ x: 0, z: 0, alive: false }));

  // Reproduccion de un tiro.
  private play: BiPlay | null = null;
  private playEv = 0;
  private focus = { x: 0, z: 0 };
  /** El rodado esta sonando (para apagarlo una sola vez al terminar el tiro). */
  private rolling = false;

  // Mi turno.
  private armedFor = -1;
  private lastArmShots = -1;
  private awaiting = false;
  private awaitingAt = 0;
  private myCue = { x: -0.6, z: 0 };
  private userAimCam = false;
  private lastAimSent = 0;
  private lastPlaceSent = 0;
  private thrust: { pull: number; angle: number; x: number; z: number } | null = null;

  // Lo que se ve del taco de los demas.
  private remoteAngle = 0;
  private remoteTarget = 0;
  private remotePower = 0;
  private remoteAimAt = 0;

  private lastCountdown = -1;
  /** Solo desarrollo: camara fija para inspeccionar la mesa (ver `__poolnight.peek`). */
  private peekCam: [THREE.Vector3, THREE.Vector3] | null = null;
  private ended = false;
  private reported = false;
  private lastTime = performance.now();
  private readonly frameTimes: number[] = [];
  private qualityChecked = false;
  private time = 0;

  constructor(container: HTMLElement) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.domElement.className = "game-canvas";
    container.append(this.renderer.domElement);

    this.scene.background = new THREE.Color(0x07080b);
    this.scene.fog = new THREE.FogExp2(0x07080b, 0.085);
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.05, 80);

    this.table = new Table(this.scene);
    this.balls = new BallMeshes(this.scene);
    this.buildReflections();
    this.cue = new Cue(this.scene);
    this.guide = new AimGuide(this.scene);
    this.rig = new CameraRig(this.camera);
    this.hud = new Hud(container);
    this.input = new InputController(container, (cx, cy) => this.pointToTable(cx, cy));

    for (let i = 0; i < 16; i++) this.balls.setVisible(i, false);

    this.input.onShoot = (a, p, ox, oy) => this.shoot(a, p, ox, oy);
    this.input.onPlace = (x, z) => this.place(x, z);
    this.input.onToggleCamera = () => this.toggleCamera();
    this.hud.onPower((p) => this.input.setPower(p));
    this.hud.onSpin((ox, oy) => this.input.setSpin(ox, oy));
    this.hud.onCamera(() => this.toggleCamera());
    this.hud.onShoot(() => this.input.requestShoot());

    this.resize();
    window.addEventListener("resize", this.resize);

    this.room =
      initRoomMode("poolnight", {
        getScore: () => this.currentScore(),
        onStart: () => this.beginCountdown(),
        onReportedWaiting: () => true,
      }) ?? devRoom(() => this.beginCountdown());

    requestAnimationFrame(this.tick);

    // Solo en desarrollo: un gancho para las pruebas con Playwright (proyecta mesa -> pantalla).
    if (import.meta.env.DEV) {
      (window as unknown as { __poolnight: unknown }).__poolnight = {
        project: (x: number, z: number, y?: number) => this.projectToScreen(x, z, y),
        state: () => this.state,
        seat: () => this.seat,
        angle: () => this.input.angle,
        // Fija la camara para mirar de cerca una parte de la mesa (null la devuelve al juego).
        peek: (cam: [number, number, number] | null, look?: [number, number, number]) => {
          this.peekCam = cam && look ? [new THREE.Vector3(...cam), new THREE.Vector3(...look)] : null;
        },
      };
    }

    if (!this.room) {
      if (isRoomMode()) {
        this.hud.showMessage("No disponible", "Poolnight necesita las credenciales de la sala y no est&aacute;n configuradas.");
      } else {
        this.hud.showMessage(
          "Solo en salas",
          "Poolnight se juega en equipos con amigos, en una sala. Cre&aacute; o un&iacute;te a una para jugar.",
          { label: "Ir a las salas", onClick: () => (window.location.href = "/rooms/") },
        );
      }
      return;
    }
    if (!isGameServerConfigured()) {
      this.hud.showMessage("No disponible", "Poolnight necesita el game server y no est&aacute; configurado (VITE_GAME_SERVER_URL).");
      return;
    }
    this.hud.showMessage("Poolnight", "Esper&aacute; a que empiece la ronda...");
  }

  /**
   * Lo que se refleja en las bolas y en la laca de la madera. Una bola de pool es brillante: en un
   * bar refleja el paño verde abajo y la lampara arriba, y sin entorno quedaba con la mitad de abajo
   * negra. Se arma una escena chica por codigo (paño abajo, la lampara encendida arriba, el salon
   * oscuro alrededor) y se pre-filtra una sola vez al arrancar.
   */
  private buildReflections(): void {
    const env = new THREE.Scene();
    env.background = new THREE.Color(0x050608);
    const geos: THREE.BufferGeometry[] = [];
    const mats: THREE.Material[] = [];
    const add = (w: number, h: number, color: THREE.Color, y: number, faceUp: boolean): void => {
      const g = new THREE.PlaneGeometry(w, h);
      const m = new THREE.MeshBasicMaterial({ color });
      geos.push(g);
      mats.push(m);
      const mesh = new THREE.Mesh(g, m);
      mesh.rotation.x = faceUp ? -Math.PI / 2 : Math.PI / 2;
      mesh.position.y = y;
      env.add(mesh);
    };
    add(6, 3, new THREE.Color(0x0e5a4c), -0.25, true); // el paño, abajo
    add(1.7, 0.5, new THREE.Color(0xffc98a).multiplyScalar(5), 1.5, false); // la lampara, arriba (mas brillante que 1: es una luz)
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    // Solo en lo que brilla (bolas, laca, laton). Como `scene.environment` lo pagaba tambien el paño,
    // que ocupa casi toda la pantalla y es mate: no se notaba y triplicaba el costo de cada cuadro.
    const tex = pmrem.fromScene(env, 0.035).texture;
    this.balls.setReflections(tex, 0.5);
    this.table.setReflections(tex, 0.55);
    pmrem.dispose();
    geos.forEach((g) => g.dispose());
    mats.forEach((m) => m.dispose());
  }

  // ------------------------------------------------------------ arranque y red

  /** En sala arranca sola cuando la ronda pasa a `playing` (no hay Enter): conecta y el server larga. */
  private beginCountdown(): void {
    if (this.phase !== "waiting") return;
    this.phase = "connecting";
    this.hud.hideMessage();
    this.hud.showHud(true);
    this.hud.setHint("Esperando a los demás jugadores...");
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
    this.serverUrl = url;
    const socket = new PoolSocket(url, this.room.code, this.room.me, this.room.players(), this.room.round());
    socket.onInit((m) => this.onInit(m));
    socket.onState((s) => this.onState(s));
    socket.onPlay((p) => this.onPlay(p));
    socket.onAim((seat, a, p) => this.onRemoteAim(seat, a, p));
    socket.onCue((x, z) => this.onRemoteCue(x, z));
    socket.onReject((why) => this.onReject(why));
    socket.onPong((c, t) => this.onPong(c, t));
    socket.onError((message) => {
      this.connectError = message;
      // El server contesta pero no conoce Poolnight: no hay nada que esperar.
      if (/invalid namespace/i.test(message)) this.giveUp();
    });
    this.socket = socket;
    void socket.connect();
    window.clearInterval(this.pingTimer);
    this.pingTimer = window.setInterval(() => this.socket?.sendPing(Date.now()), 2500);
  }

  private giveUp(): void {
    if (this.ended) return;
    this.ended = true;
    this.hud.showHud(false);
    this.hud.setHint(null);
    this.hud.showMessage("Sin conexi&oacute;n", this.connectFailure());
    if (!this.reported) {
      this.reported = true;
      this.room?.reportScore(0, { ranked: false });
    }
  }

  /** Por que no se pudo conectar, dicho de forma que se pueda actuar (no solo "no anduvo"). */
  private connectFailure(): string {
    const url = this.serverUrl.replace(/[<>&"]/g, "");
    if (/invalid namespace/i.test(this.connectError)) {
      return `El game server (${url}) est&aacute; vivo pero es una versi&oacute;n vieja, sin Poolnight. Hay que desplegar la &uacute;ltima versi&oacute;n de <code>server/</code>. La ronda sigue con los dem&aacute;s.`;
    }
    const why = this.connectError ? ` (${this.connectError.replace(/[<>&"]/g, "")})` : "";
    return `No se pudo conectar al game server${url ? ` (${url})` : ""}${why}. La ronda sigue con los dem&aacute;s.`;
  }

  private onPong(c: number, t: number): void {
    const rtt = Date.now() - c;
    if (rtt < 0 || rtt > 5000) return;
    // Se queda con la muestra de menor RTT (la que menos jitter comio), con una cuota de deriva.
    if (rtt <= this.bestRtt + 8) {
      this.offset = t + rtt / 2 - Date.now();
      this.bestRtt = Math.min(this.bestRtt, rtt);
    } else {
      this.bestRtt += 1;
    }
  }

  private serverNow(): number {
    return Date.now() + this.offset;
  }

  // ------------------------------------------------------------ mensajes

  private onInit(m: BiInit): void {
    this.seat = m.seat;
    this.offset = m.state.now - Date.now();
    this.bestRtt = Infinity;
    this.phase = "live";
    this.connectStartedAt = 0;
    this.hud.hideMessage();
    this.hud.showHud(true);
    this.applyState(m.state);
    this.socket?.sendPing(Date.now());
  }

  private onState(s: BiState): void {
    this.applyState(s);
  }

  private applyState(s: BiState): void {
    this.state = s;
    if (!this.play) this.adoptBalls(s);
    this.hud.setTeams(s, this.seat);
    if (s.phase === "over") this.onEnded(s);
  }

  private onPlay(p: BiPlay): void {
    if (this.play) this.finishPlay();
    this.play = p;
    this.playEv = 0;
    this.state = p.state;
    this.motion.load(p.segs);
    this.awaiting = false;
    this.focus = { x: 0, z: 0 };
    this.hud.setTeams(p.state, this.seat);
    // El taco de los demas arma el golpe con la potencia que se le vio cargar.
    if (!this.thrust) this.thrust = { pull: PULL_REST + this.remotePower * PULL_MAX, angle: this.remoteAngle, x: this.shown[0].x, z: this.shown[0].z };
  }

  private onRemoteAim(seat: number, a: number, p: number): void {
    if (seat === this.seat || !this.state || seat !== this.state.shooter) return;
    this.remoteAngle = this.remoteAimAt === 0 ? a : this.remoteAngle;
    this.remoteAimAt = performance.now();
    this.remoteTarget = a;
    this.remotePower = p;
  }

  private onRemoteCue(x: number, z: number): void {
    // Mientras otro acomoda la blanca: se ve moverse. Lo mio ya lo dibujo yo.
    if (this.state && this.state.shooter === this.seat && this.armedFor >= 0) return;
    this.shown[0].x = x;
    this.shown[0].z = z;
    this.shown[0].alive = true;
    if (!this.play) {
      this.balls.setPos(0, x, z);
      this.balls.setVisible(0, true);
    }
  }

  private onReject(why: BiRejectReason): void {
    this.awaiting = false;
    this.armedFor = -1;
    const text = REJECTS[why];
    if (text) this.hud.toast(text, "bad");
  }

  // ------------------------------------------------------------ bolas

  private adoptBalls(s: BiState): void {
    if (s.balls.length !== 48) return;
    for (let i = 0; i < 16; i++) {
      this.shown[i].x = s.balls[i * 3];
      this.shown[i].z = s.balls[i * 3 + 1];
      this.shown[i].alive = s.balls[i * 3 + 2] === 1;
      if (this.shown[i].alive) {
        this.balls.setPos(i, this.shown[i].x, this.shown[i].z);
        this.balls.setVisible(i, true);
      } else {
        this.balls.setVisible(i, false);
      }
    }
  }

  private finishPlay(): void {
    const p = this.play;
    if (!p) return;
    this.play = null;
    this.motion.clear();
    this.thrust = null;
    this.remoteAimAt = 0;
    if (this.state) this.adoptBalls(this.state);

    const who = p.state.seats[p.seat]?.nickname ?? "Bot";
    if (p.foul === "scratch") {
      this.hud.toast(`FALTA de ${who}: embocó la blanca`, "bad");
      SoundEffects.playFoul();
    } else if (p.foul === "no_contact") {
      this.hud.toast(`FALTA de ${who}: no tocó ninguna bola`, "bad");
      SoundEffects.playFoul();
    } else if (p.respot) {
      this.hud.toast("La 8 cayó en la rotura: vuelve a la mesa", "info");
    } else if (p.own.length > 0 && !p.ended) {
      this.hud.toast(`${who} embocó y sigue`, "good");
    }
    if (p.ended) this.onEnded(p.state);
  }

  private fireEvent(e: BiEvent): void {
    const speed = e[4];
    if (e[1] === EV_CUE) SoundEffects.playCue(speed);
    else if (e[1] === EV_BALL) SoundEffects.playBall(speed);
    else if (e[1] === EV_CUSHION) SoundEffects.playCushion(speed);
    else if (e[1] === EV_POCKET) SoundEffects.playPocket();
  }

  // ------------------------------------------------------------ acciones propias

  private shoot(a: number, p: number, ox: number, oy: number): void {
    const st = this.state;
    if (!st || !this.socket || this.armedFor < 0) return;
    this.awaiting = true;
    this.awaitingAt = performance.now();
    this.thrust = { pull: PULL_REST + p * PULL_MAX, angle: a, x: this.myCue.x, z: this.myCue.z };
    // `p` es la barra (curva humana); el server recibe la fraccion de V_MAX que le corresponde.
    this.socket.sendShot({ a, p: barToShotPower(p), ox, oy, ...(st.cueInHand ? { x: this.myCue.x, z: this.myCue.z } : {}) });
    this.disarm();
  }

  private place(x: number, z: number): void {
    const st = this.state;
    if (!st || !this.socket) return;
    if (!this.canPlace(x, z)) {
      this.hud.toast("Ahí no entra la blanca", "bad");
      return;
    }
    this.myCue = { x, z };
    this.shown[0] = { x, z, alive: true };
    this.balls.setPos(0, x, z);
    this.balls.setVisible(0, true);
    this.socket.sendPlace(x, z);
    this.input.setMode("aim");
    this.hud.setHint(this.aimHint());
  }

  private toggleCamera(): void {
    if (this.armedFor < 0) return;
    this.userAimCam = !this.userAimCam;
    this.hud.setHint(this.aimHint());
  }

  /** Mismo criterio que el server (`spotIsFree`): dentro de las bandas, sin pisar bolas ni nudos. */
  private canPlace(x: number, z: number): boolean {
    if (!(Math.abs(x) <= HALF_L - BALL_R && Math.abs(z) <= HALF_W - BALL_R)) return false;
    for (let i = 1; i < 16; i++) {
      const b = this.shown[i];
      if (b.alive && Math.hypot(b.x - x, b.z - z) < 2 * BALL_R + 0.0008) return false;
    }
    for (let k = 0; k < KNUCKLES.length; k += 2) {
      if (Math.hypot(KNUCKLES[k] - x, KNUCKLES[k + 1] - z) < BALL_R + KNUCKLE_R + 0.0008) return false;
    }
    return true;
  }

  private projectToScreen(x: number, z: number, y = BALL_R): { x: number; y: number } {
    const v = new THREE.Vector3(x, y, z).project(this.camera);
    const r = this.renderer.domElement.getBoundingClientRect();
    return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
  }

  private pointToTable(cx: number, cy: number): { x: number; z: number } | null {
    const r = this.renderer.domElement.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return null;
    this.ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    if (!this.raycaster.ray.intersectPlane(this.plane, this.hit)) return null;
    return { x: this.hit.x, z: this.hit.z };
  }

  // ------------------------------------------------------------ fin

  private onEnded(s: BiState): void {
    if (this.ended) return;
    this.ended = true;
    this.input.setEnabled(false);
    this.hud.setControls(false);
    this.hud.setHint(null);
    this.hud.setTurn(null, 0, 0, 0, false);
    this.cue.setVisible(false);
    this.guide.hide();
    this.report(s);

    const myTeam = this.seat >= 0 ? s.seats[this.seat].team : null;
    let headline: string;
    if (s.winner === null) headline = "EMPATE";
    else if (myTeam === null) headline = `GANAN LAS ${TEAM_NAMES[s.winner]}`;
    else headline = s.winner === myTeam ? "¡GANASTE!" : "PERDISTE";
    if (myTeam !== null && s.winner !== null) {
      if (s.winner === myTeam) SoundEffects.playWin();
      else SoundEffects.playLose();
    }
    const sub = this.endSubtitle(s);
    const rows = ([0, 1] as const).map((team) => ({
      team,
      names: s.seats.filter((x) => x.team === team).map((x) => x.nickname ?? "Bot"),
    }));
    window.setTimeout(() => this.hud.showResults(headline, sub, rows, myTeam), 900);
  }

  private endSubtitle(s: BiState): string {
    if (s.winner === null) return "Quedaron igualados al cortarse el tiempo.";
    const w = TEAM_NAMES[s.winner].toLowerCase();
    switch (s.endReason) {
      case "eight":
        return `Ganan las ${w}: embocaron la 8 con el grupo limpio.`;
      case "cap":
        return `Ganan las ${w}: tenían menos bolas en la mesa al cortarse el tiempo.`;
      case "early_eight":
        return `Ganan las ${w}: el rival embocó la 8 antes de tiempo.`;
      case "scratch_eight":
        return `Ganan las ${w}: el rival embocó la 8 con la blanca.`;
      default:
        return `Ganan las ${w}.`;
    }
  }

  /** Resultado de sala: 1 si gano su equipo, 0 si no; el ranking global cuenta victorias (con humanos de los dos lados). */
  private report(s: BiState): void {
    if (this.reported || this.seat < 0 || !s.places) return;
    this.reported = true;
    const team = s.seats[this.seat].team;
    const place = s.places[team];
    const humans = s.seats.filter((x) => x.nickname !== null).length;
    this.room?.reportScore(place === 1 ? 1 : 0, { place, players: humans, ranked: humans >= 2 });
  }

  private currentScore(): number {
    const s = this.state;
    if (!s || this.seat < 0) return 0;
    const team = s.seats[this.seat].team;
    return s.groupsLeft[team] < s.groupsLeft[1 - team] ? 1 : 0;
  }

  // ------------------------------------------------------------ bucle

  private readonly tick = (now: number): void => {
    requestAnimationFrame(this.tick);
    const rawDt = (now - this.lastTime) / 1000;
    this.adaptQuality(rawDt);
    const dt = Math.min(0.05, rawDt);
    this.lastTime = now;
    this.time += dt;

    this.checkConnection(now);
    this.updatePlayback(dt);
    this.updateTurn(dt);
    this.updateCamera(dt);
    this.renderer.render(this.scene, this.camera);
  };

  /**
   * Si la maquina no llega (menos de ~45 cuadros por segundo de promedio en los primeros 2 s con la
   * mesa a la vista) y la pantalla es de alta densidad, baja la resolucion interna a 1x. Pasa una
   * sola vez: en una pantalla retina se dibujan 4 veces los pixeles, y el paño y la madera son PBR.
   */
  private adaptQuality(dt: number): void {
    if (this.qualityChecked || !this.state || dt <= 0 || dt > 0.5) return;
    this.frameTimes.push(dt);
    if (this.frameTimes.length < 120) return;
    this.qualityChecked = true;
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    if (avg > 1 / 45 && this.renderer.getPixelRatio() > 1) {
      this.renderer.setPixelRatio(1);
      this.resize();
    }
  }

  private checkConnection(now: number): void {
    if (this.phase === "connecting" && this.connectStartedAt > 0 && now - this.connectStartedAt > SERVER_GRACE_MS && !this.state) this.giveUp();
  }

  private updatePlayback(dt: number): void {
    const p = this.play;
    if (!p) {
      if (this.rolling) {
        this.rolling = false;
        SoundEffects.setRolling(0);
      }
      return;
    }
    const s = (this.serverNow() - p.startAt) / 1000;
    if (s >= p.dur + 0.2) {
      this.finishPlay();
      return;
    }
    if (s < 0) return;
    let fx = 0;
    let fz = 0;
    let n = 0;
    let rollSum = 0;
    for (let i = 0; i < 16; i++) {
      if (!this.motion.evaluate(i, s, this.pose)) continue;
      const q = this.pose;
      if (q.ph === 3) {
        this.balls.drop(i, q.x, q.z, q.since);
      } else {
        this.balls.setPos(i, q.x, q.z);
        this.balls.setVisible(i, true);
        this.balls.spin(i, q.wx, q.wy, q.wz, dt);
        if (q.ph !== 0) {
          fx += q.x;
          fz += q.z;
          n++;
          // Rodando, |v| = R * |w horizontal| (deslizando es una aproximacion, alcanza para el volumen).
          rollSum += BALL_R * Math.hypot(q.wx, q.wz);
        }
      }
    }
    this.rolling = true;
    SoundEffects.setRolling(rollSum);
    if (n > 0) {
      this.focus.x += (fx / n - this.focus.x) * Math.min(1, dt * 3);
      this.focus.z += (fz / n - this.focus.z) * Math.min(1, dt * 3);
    }
    while (this.playEv < p.ev.length && p.ev[this.playEv][0] <= s) {
      this.fireEvent(p.ev[this.playEv]);
      this.playEv++;
    }
  }

  // ------------------------------------------------------------ turnos

  private updateTurn(dt: number): void {
    const st = this.state;
    if (!st) return;
    if (st.phase === "waiting") {
      this.hud.setHint("Esperando a los demás jugadores...");
      return;
    }
    const now = this.serverNow();
    this.updateCountdown(st, now);
    if (st.phase === "over") {
      this.cue.setVisible(false);
      this.guide.hide();
      return;
    }

    // Una orden que nunca recibio respuesta no puede dejar la mesa bloqueada.
    if (this.awaiting && performance.now() - this.awaitingAt > 4000) this.awaiting = false;

    const animating = this.play !== null;
    const turnLive = now >= st.turnStartAt - 150;
    const mine = this.seat >= 0 && st.shooter === this.seat && turnLive && !animating && !this.awaiting;
    if (mine && this.armedFor !== st.shots) this.arm(st);
    if (!mine && this.armedFor >= 0) this.disarm();

    if (st.shooter >= 0 && turnLive) {
      const seat = st.seats[st.shooter];
      const total = Math.max(1, st.deadline - st.turnStartAt);
      this.hud.setTurn(seat.nickname ?? "Bot", seat.team, (st.deadline - now) / total, Math.max(0, (st.deadline - now) / 1000), st.shooter === this.seat);
    } else {
      this.hud.setTurn(null, 0, 0, 0, false);
    }

    // La ayuda es de quien tira: a los demas no les queda colgada la del turno anterior.
    if (!mine) this.hud.setHint(null);
    if (mine) this.updateMine(dt, st);
    else this.updateTheirs(dt, st, animating, now);
  }

  private arm(st: BiState): void {
    this.armedFor = st.shots;
    const first = this.lastArmShots !== st.shots;
    this.lastArmShots = st.shots;
    this.input.setEnabled(true, st.cueInHand ? "place" : "aim");
    this.hud.setControls(true);
    if (first) {
      this.userAimCam = false;
      this.input.power = 0;
      this.input.setSpin(0, 0);
      const cue = this.shown[0];
      this.myCue = cue.alive ? { x: cue.x, z: cue.z } : { x: -0.6, z: 0 };
      this.input.placeX = this.myCue.x;
      this.input.placeZ = this.myCue.z;
      this.input.angle = this.defaultAngle(st);
    }
    // La rotura sale SIEMPRE de la posicion inicial: no hay blanca en mano, solo apuntar y tirar.
    this.hud.setHint(st.cueInHand ? "Blanca en mano: movela y hacé clic para apoyarla" : st.breakShot ? "Rotura: la blanca sale de su lugar. " + this.aimHint() : this.aimHint());
    this.hud.toast(st.shots === 0 ? "¡Rotura! Es tu turno" : "Es tu turno", "good");
  }

  private disarm(): void {
    this.armedFor = -1;
    this.input.setEnabled(false);
    this.hud.setControls(false);
    this.hud.setHint(null);
    this.guide.hide();
  }

  private aimHint(): string {
    if (this.userAimCam) return "Cámara baja: mové el mouse a los costados para girar, mantené el clic y arrastrá hacia abajo para cargar";
    return window.matchMedia("(pointer: coarse)").matches
      ? "Arrastrá para apuntar, cargá la potencia a la derecha y tocá TIRAR"
      : "Mové el mouse para apuntar, mantené el clic y arrastrá hacia atrás: soltá para tirar";
  }

  /** Hacia la bola propia mas cercana (o la 8 si ya limpio), y si no hay, hacia el centro. */
  private defaultAngle(st: BiState): number {
    const cue = this.shown[0];
    // La rotura apunta de entrada a la punta del triangulo.
    if (st.breakShot) return Math.atan2(0 - cue.z, FOOT_X - cue.x);
    const team = this.seat >= 0 ? st.seats[this.seat].team : 0;
    let best = Infinity;
    let angle = Math.atan2(-cue.z, HALF_L / 2 - cue.x);
    const cleared = st.groupsLeft[team] === 0;
    for (let i = 1; i < 16; i++) {
      const b = this.shown[i];
      if (!b.alive) continue;
      if (cleared ? i !== 8 : groupOf(i) !== team) continue;
      const d = Math.hypot(b.x - cue.x, b.z - cue.z);
      if (d < best) {
        best = d;
        angle = Math.atan2(b.z - cue.z, b.x - cue.x);
      }
    }
    return angle;
  }

  private updateMine(dt: number, st: BiState): void {
    this.input.update(dt);
    const t = performance.now();
    const color = new THREE.Color(TEAM_COLORS[st.seats[this.seat].team]).getHex();

    if (this.input.mode === "place") {
      const x = this.input.placeX;
      const z = this.input.placeZ;
      this.balls.setPos(0, x, z);
      this.balls.setVisible(0, true);
      this.cue.setVisible(false);
      this.guide.hide();
      if (t - this.lastPlaceSent > PLACE_SEND_MS && this.canPlace(x, z)) {
        this.lastPlaceSent = t;
        this.socket?.sendPlace(x, z);
      }
      return;
    }

    this.input.cueX = this.myCue.x;
    this.input.cueZ = this.myCue.z;
    // Con la camara baja el mouse no puede apuntar "a un punto de la mesa" (la camara gira con la mira
    // y el punto se mueve debajo del cursor): ahi la mira gira con el movimiento del mouse.
    this.input.relative = this.userAimCam;
    this.guide.setColor(color);
    this.guide.update(this.shown, this.myCue.x, this.myCue.z, this.input.angle);
    this.cue.setPose(this.myCue.x, this.myCue.z, this.input.angle, PULL_REST + this.input.power * PULL_MAX);
    this.cue.setVisible(true);
    this.hud.setPower(this.input.power);
    this.hud.setSpin(this.input.ox, this.input.oy);
    if (t - this.lastAimSent > AIM_SEND_MS) {
      this.lastAimSent = t;
      this.socket?.sendAim(this.input.angle, this.input.power);
    }
  }

  private updateTheirs(dt: number, st: BiState, animating: boolean, now: number): void {
    this.guide.hide();
    const cue = this.shown[0];

    // El golpe: la punta avanza hasta la bola justo antes de `startAt`.
    if (animating && this.play && this.thrust) {
      const s = (now - this.play.startAt) / 1000;
      const k = Math.max(0, Math.min(1, -s / THRUST_S));
      if (s < 0.12 && cue.alive) {
        this.cue.setPose(this.thrust.x, this.thrust.z, this.thrust.angle, this.thrust.pull * k);
        this.cue.setVisible(true);
      } else {
        this.cue.setVisible(false);
      }
      return;
    }
    this.cue.setVisible(false);

    if (st.shooter < 0 || animating || now < st.turnStartAt || !cue.alive) return;
    // El taco de quien esta apuntando, suavizado: llega a ~10 mensajes por segundo.
    if (this.remoteAimAt > 0 && performance.now() - this.remoteAimAt < 2500) {
      const k = 1 - Math.exp(-dt * 12);
      this.remoteAngle += wrapAngle(this.remoteTarget - this.remoteAngle) * k;
      this.cue.setPose(cue.x, cue.z, this.remoteAngle, PULL_REST + this.remotePower * PULL_MAX);
      this.cue.setVisible(true);
    }
  }

  private updateCountdown(st: BiState, now: number): void {
    const remaining = st.turnStartAt - now;
    if (st.shots === 0 && remaining > 0 && remaining <= 4100) {
      const idx = remaining > 3000 ? 0 : remaining > 2000 ? 1 : remaining > 1000 ? 2 : 3;
      if (idx !== this.lastCountdown) {
        this.lastCountdown = idx;
        SoundEffects.playCountdownTick(idx === 3);
        this.hud.showCountdown(COUNTDOWN_LABELS[idx]);
      }
    } else if (this.lastCountdown >= 0 && (st.shots > 0 || remaining <= -500)) {
      this.lastCountdown = -1;
      this.hud.showCountdown(null);
    }
  }

  // ------------------------------------------------------------ camara y render

  private updateCamera(dt: number): void {
    if (this.peekCam) {
      this.camera.position.copy(this.peekCam[0]);
      this.camera.lookAt(this.peekCam[1]);
      this.camera.fov = 40;
      this.camera.updateProjectionMatrix();
      this.table.setLampVisible(this.camera.position.y < 1.2);
      return;
    }
    const st = this.state;
    let mode: CamMode = "plan";
    let cueX = this.shown[0].x;
    let cueZ = this.shown[0].z;
    let angle = this.remoteAngle;

    if (st && st.phase === "playing") {
      if (this.play) {
        mode = "action";
      } else if (this.armedFor >= 0) {
        mode = this.userAimCam && this.input.mode === "aim" ? "aim" : "plan";
        cueX = this.myCue.x;
        cueZ = this.myCue.z;
        angle = this.input.angle;
      } else if (st.shooter >= 0 && st.shooter !== this.seat && this.serverNow() >= st.turnStartAt) {
        // Mira desde el costado, salvo que le toque a uno mismo enseguida.
        const next = (st.shooter + 1) % Math.max(1, st.seats.length);
        mode = this.seat >= 0 && next === this.seat ? "plan" : "spectator";
      }
    }
    this.rig.setMode(mode, angle, this.cue.elevation);
    this.rig.update(dt, {
      aspect: this.camera.aspect,
      cueX,
      cueZ,
      aimAngle: angle,
      focusX: this.focus.x,
      focusZ: this.focus.z,
      time: this.time,
      cueElevation: this.cue.elevation,
    });
    this.table.setLampVisible(this.camera.position.y < 1.2);
  }

  private readonly resize = (): void => {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  };
}
