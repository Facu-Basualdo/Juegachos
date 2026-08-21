import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { getNickname } from "../../../shared/nickname";
import { fetchRoomState, sanitizeCode } from "../../../shared/room/api";
import { initRoomMode, roomTimeLimitFor, type RoomMode } from "../../../shared/room/roomMode";
import { RAPIER } from "./physics";
import { Arena } from "./Arena";
import { ArenaChannel, type BallPayload, type MatchEvent } from "./ArenaChannel";
import { Ball } from "./Ball";
import { BoostPads } from "./BoostPads";
import { Bot } from "./Bot";
import { Car, type CarInput } from "./Car";
import { Effects } from "./Effects";
import { Hud } from "./Hud";
import { InputController } from "./InputController";
import { RemoteCar } from "./RemoteCar";
import { SoundEffects } from "./SoundEffects";
import { assignAlphabetical, assignTeams } from "./teams";
import {
  ATTACK_X,
  BALL_R,
  BALL_SNAP_ERR,
  BLUE,
  CAR_HALF,
  DEMO_DIST,
  DEMO_SPEED,
  DODGE_KICK_MULT,
  FIELD_LEN,
  FIXED_STEP,
  GOAL_H,
  GOAL_LINE,
  GOAL_W,
  GRAVITY,
  KICK_COOLDOWN,
  KICK_FACTOR,
  KICK_RANGE,
  KICK_SPEED_MIN,
  KICK_UP,
  NET_SEND_MS,
  ORANGE,
  QUICKCHAT,
  REMOTE_STALE_MS,
  type Difficulty,
  type Team,
} from "./constants";

type State = "start" | "teampick" | "countdown" | "playing" | "goal" | "finished";

const MATCH_TIME = 120;
/** Duración de la fase "elegí equipo" en salas (se descuenta del partido). */
const PICK_TIME = 15;
const KICKOFF_COUNT = 3;
const GOAL_PAUSE = 1.6;
/** Fallback del cliente si se pierde el evento de kickoff/end del host. */
const CLIENT_GOAL_FALLBACK = 6;
const CAM_DIST = 21;
const CAM_HEIGHT = 10;
/** Distancia del arco a la línea de spawn del kickoff. */
const SPAWN_X = FIELD_LEN * 0.28;
const IDLE: CarInput = { throttle: 0, steer: 0, boost: false, jump: false, drift: false, flip: false };

/** Nombre reservado para los bots de relleno del host en modo sala. */
const BOT_NAME = "★BOT";

interface BotSeat {
  name: string;
  team: Team;
  car: Car;
  ai: Bot;
}

export class Game {
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly composer: EffectComposer;
  private readonly bloomPass: UnrealBloomPass;
  private readonly world: RAPIER.World;
  private readonly arena: Arena;
  private readonly pads: BoostPads;
  private readonly effects: Effects;
  private readonly ball: Ball;
  private player: Car;
  private readonly input: InputController;
  private readonly hud: Hud;

  // ---- Modo sala ----
  private readonly room: RoomMode | null;
  private readonly roomCode: string | null;
  private readonly me: string;
  private channel: ArenaChannel | null = null;
  private isHost = false;
  private myTeam: Team = "blue";
  private readonly remotes = new Map<string, RemoteCar>();
  private sendAccMs = 0;

  // ---- Fase de elección de equipo (modo sala) ----
  private roomPlayers: string[] = [];
  private readonly picks = new Map<string, Team>();
  private teamsFinal: Record<string, Team> | null = null;
  private pickTimer = 0;
  private pickResend = 0;

  /** Autos con IA: el rival en solitario, o los rellenos del host en sala. */
  private bots: BotSeat[] = [];
  private difficulty: Difficulty = "medium";
  private state: State = "start";
  private blue = 0;
  private orange = 0;
  private matchTime = MATCH_TIME;
  private time = MATCH_TIME;
  /** Tiempo extra con gol de oro: el reloj cuenta para arriba. */
  private overtime = false;
  private countdown = 0;
  /** Ultimo numero de kickoff que sono, para pitar una vez por tick. */
  private lastCountdownBeep = 0;
  private goalTimer = 0;
  private acc = 0;
  private elapsed = 0;
  private last = performance.now();
  /** Ball cam (mira a la pelota) o cámara clásica detrás del auto. Tecla E. */
  private ballCam = true;
  private readonly camTarget = new THREE.Vector3();
  private debugInfo = false;

  constructor(container: HTMLElement) {
    this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 700);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    container.appendChild(this.renderer.domElement);

    // Bloom sobre lo emisivo/brillante (neón, postes, pads, llamas de boost).
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      0.55,
      0.5,
      0.55,
    );
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(new OutputPass());

    this.scene.background = new THREE.Color(0x06080f);
    this.scene.fog = new THREE.Fog(0x06080f, 200, 560);
    this.addLights();
    this.addStars();

    this.world = new RAPIER.World({ x: 0, y: GRAVITY, z: 0 });
    this.world.timestep = FIXED_STEP;

    this.arena = new Arena(this.world);
    this.scene.add(this.arena.group);

    this.pads = new BoostPads();
    this.scene.add(this.pads.group);

    this.effects = new Effects();
    this.scene.add(this.effects.points);

    this.ball = new Ball(this.world);
    this.player = new Car(this.world, BLUE, new THREE.Vector3(-SPAWN_X, 0.6, 0), Math.PI / 2);
    this.scene.add(this.ball.mesh, this.player.mesh);

    this.input = new InputController(container);
    this.hud = new Hud(container);

    const rawCode = new URLSearchParams(window.location.search).get("room");
    this.roomCode = rawCode ? sanitizeCode(rawCode) : null;
    this.me = getNickname() ?? "yo";
    this.room = initRoomMode("rocket-arena", { getScore: () => this.myGoals() });

    if (this.room && this.roomCode) {
      void this.bootRoom(this.roomCode);
    } else {
      this.hud.showStart((d) => this.startMatch(d));
    }

    // Hook de diagnóstico para QA automatizado; solo con ?debug en la URL.
    // autoReset=false + reset por tick: renderer.info suma TODOS los passes
    // del composer del frame (con autoReset solo se vería el último pass).
    if (new URLSearchParams(window.location.search).has("debug")) {
      this.debugInfo = true;
      this.renderer.info.autoReset = false;
      (window as unknown as Record<string, unknown>).__ta = {
        info: () => JSON.parse(JSON.stringify(this.renderer.info.render)),
        memory: () => JSON.parse(JSON.stringify(this.renderer.info.memory)),
        state: () => ({ state: this.state, boost: this.player.boost, time: this.time }),
      };
    }

    window.addEventListener("resize", this.onResize);
    this.renderer.setAnimationLoop(this.tick);
  }

  private addLights(): void {
    this.scene.add(new THREE.HemisphereLight(0x9fc0ff, 0x202436, 0.7));
    const sun = new THREE.DirectionalLight(0xffffff, 1.1);
    sun.position.set(60, 120, 50);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const c = sun.shadow.camera as THREE.OrthographicCamera;
    c.left = -160;
    c.right = 160;
    c.top = 125;
    c.bottom = -125;
    c.near = 1;
    c.far = 350;
    this.scene.add(sun);
  }

  /** Cielo estrellado: puntos fijos en un domo lejano, fuera de la niebla. */
  private addStars(): void {
    const N = 600;
    const positions = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      // Hemisferio superior de radio grande alrededor de la cancha.
      const r = 480 + Math.random() * 160;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI * 0.45; // cerca del horizonte y arriba
      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.cos(phi) * 0.5 + 20;
      positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color: 0xbcd2ff,
      size: 1.6,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.8,
      fog: false,
    });
    this.scene.add(new THREE.Points(geo, mat));
  }

  // ---------- Modo sala ----------

  private myGoals(): number {
    return this.myTeam === "blue" ? this.blue : this.orange;
  }

  /** Solo el host (o el modo solitario) simula la pelota con autoridad. */
  private ballAuthority(): boolean {
    return this.channel === null || this.isHost;
  }

  /** Punto de salida por equipo y slot dentro del equipo. */
  private spawnFor(team: Team, idx: number, count: number): { pos: THREE.Vector3; yaw: number } {
    const x = team === "blue" ? -SPAWN_X : SPAWN_X;
    const yaw = team === "blue" ? Math.PI / 2 : -Math.PI / 2;
    const z = (idx - (count - 1) / 2) * 12;
    return { pos: new THREE.Vector3(x, 0.6, z), yaw };
  }

  /**
   * Arranque en modo sala: primero la fase "elegí equipo" (los picks viajan
   * por el canal y el host cierra con equipos balanceados), después kickoff.
   * Con un solo jugador se salta la fase y juega 1v1 contra el bot del host.
   */
  private async bootRoom(code: string): Promise<void> {
    const state = await fetchRoomState(code);
    const round = state?.room.current_round ?? 0;
    const players = [...(state?.players ?? [this.me])].sort((a, b) => a.localeCompare(b));
    const hostName = state && players.includes(state.room.host) ? state.room.host : players[0];
    this.isHost = this.me === hostName;
    this.roomPlayers = players;

    // El tope de ronda lo declara el juego en su meta.ts; sin tope vale MATCH_TIME.
    const limit = roomTimeLimitFor("rocket-arena") || MATCH_TIME;
    this.matchTime = Math.min(MATCH_TIME, Math.max(30, limit - 8));

    this.channel = new ArenaChannel(code, round);
    this.channel.onCar((p) => {
      if (p.p === this.me || this.state === "teampick") return;
      const existing = this.remotes.get(p.p);
      if (existing) {
        const wasDemolished = existing.demolished;
        existing.setTarget(p);
        if (!wasDemolished && existing.demolished) {
          this.effects.explode(existing.mesh.position, existing.team === "blue" ? BLUE : ORANGE);
        }
        return;
      }
      const remote = new RemoteCar(this.world, p.p, p);
      this.remotes.set(p.p, remote);
      this.scene.add(remote.mesh);
    });
    this.channel.onBall((p) => {
      // Cargué tarde y el partido ya corre: cerrar la fase con lo que haya.
      if (this.state === "teampick" && !this.teamsFinal) {
        this.applyTeams(assignTeams(this.roomPlayers, this.picks));
      }
      this.applyBallSnapshot(p);
    });
    this.channel.onEvent((ev) => this.applyEvent(ev));
    this.channel.onPad((p) => this.pads.take(p.i));
    this.channel.onChat((c) => {
      if (c.p !== this.me && c.m >= 0 && c.m < QUICKCHAT.length) {
        this.hud.addChat(c.p, QUICKCHAT[c.m], c.t);
      }
    });
    this.channel.onPick((p) => {
      if (this.state === "teampick" && this.roomPlayers.includes(p.p)) {
        this.picks.set(p.p, p.t);
      }
    });
    this.channel.onTeams((t) => {
      if (!this.teamsFinal) this.applyTeams(t.m);
    });

    this.blue = 0;
    this.orange = 0;
    this.hud.setScore(0, 0);
    this.hud.hide();

    if (players.length <= 1) {
      // Solo en la sala: sin fase de elección, 1v1 contra el bot de relleno.
      this.applyTeams(assignAlphabetical(players));
      return;
    }

    // Fase de elección: su duración se descuenta del reloj del partido.
    this.matchTime = Math.max(30, this.matchTime - PICK_TIME);
    this.state = "teampick";
    this.pickTimer = PICK_TIME;
    this.hud.showTeamPick((t) => {
      if (this.state !== "teampick") return;
      this.picks.set(this.me, t);
      this.channel?.sendPick({ p: this.me, t });
      this.hud.updateTeamPick(this.roomPlayers, this.picks, this.me, this.pickTimer);
    });
    this.hud.updateTeamPick(players, this.picks, this.me, this.pickTimer);
  }

  /**
   * Aplica la asignación final de equipos: color y spawn del auto propio,
   * bot de relleno del host si quedaron impares, y arranca el kickoff.
   */
  private applyTeams(map: Record<string, Team>): void {
    if (this.teamsFinal) return;
    this.teamsFinal = map;
    this.myTeam = map[this.me] ?? "blue";

    const mine = this.roomPlayers.filter((p) => map[p] === this.myTeam);
    const spawn = this.spawnFor(
      this.myTeam,
      Math.max(0, mine.indexOf(this.me)),
      Math.max(mine.length, 1),
    );
    if (this.myTeam === "orange") {
      // El auto por defecto es azul: se recrea del color correcto.
      this.scene.remove(this.player.mesh);
      this.world.removeRigidBody(this.player.body);
      this.player = new Car(this.world, ORANGE, spawn.pos, spawn.yaw);
      this.scene.add(this.player.mesh);
    } else {
      this.player.setSpawn(spawn.pos, spawn.yaw);
      this.player.reset();
    }

    // Bot de relleno: solo lo simula el host, en el equipo con menos gente.
    const blueCount = this.roomPlayers.filter((p) => map[p] === "blue").length;
    const orangeCount = this.roomPlayers.length - blueCount;
    if (this.isHost && blueCount !== orangeCount) {
      const botTeam: Team = blueCount < orangeCount ? "blue" : "orange";
      const botIdx = Math.min(blueCount, orangeCount);
      const count = Math.max(blueCount, orangeCount);
      const s = this.spawnFor(botTeam, botIdx, count);
      const car = new Car(this.world, botTeam === "blue" ? BLUE : ORANGE, s.pos, s.yaw);
      this.scene.add(car.mesh);
      this.bots.push({
        name: BOT_NAME,
        team: botTeam,
        car,
        ai: new Bot("medium", ATTACK_X[botTeam] * GOAL_LINE),
      });
    }

    this.hud.setMatchNote(this.myTeam === "blue" ? "EQUIPO AZUL" : "EQUIPO NARANJA", this.myTeam);
    this.time = this.matchTime;
    this.hud.hide();
    // Todos cierran la fase casi a la vez: el countdown de 3s los sincroniza.
    this.kickoff();
  }

  /** Cierre de la fase de elección (solo host): balancea, difunde y arranca. */
  private finalizeTeams(): void {
    if (!this.isHost || this.teamsFinal) return;
    const map = assignTeams(this.roomPlayers, this.picks);
    // Reenvíos espaciados por si algún cliente pierde el primer mensaje.
    this.channel?.sendTeams({ m: map });
    window.setTimeout(() => this.channel?.sendTeams({ m: map }), 500);
    window.setTimeout(() => this.channel?.sendTeams({ m: map }), 1200);
    this.applyTeams(map);
  }

  /** Corrección de la pelota con el snapshot del host (solo clientes). */
  private applyBallSnapshot(p: BallPayload): void {
    if (this.ballAuthority()) return;
    const cur = this.ball.position();
    const err = Math.hypot(cur.x - p.x, cur.y - p.y, cur.z - p.z);
    if (err > BALL_SNAP_ERR) {
      this.ball.body.setTranslation({ x: p.x, y: p.y, z: p.z }, true);
    } else {
      // Corrección suave: acerca la pelota local a la del host sin saltos.
      const k = 0.35;
      this.ball.body.setTranslation(
        { x: cur.x + (p.x - cur.x) * k, y: cur.y + (p.y - cur.y) * k, z: cur.z + (p.z - cur.z) * k },
        true,
      );
    }
    this.ball.body.setLinvel({ x: p.vx, y: p.vy, z: p.vz }, true);
    this.time = p.t;
    if (p.ot === 1 && !this.overtime) this.markOvertime();
    // Curación de marcador por si se perdió un evento de gol.
    if (p.sb !== this.blue || p.so !== this.orange) {
      this.blue = p.sb;
      this.orange = p.so;
      this.hud.setScore(this.blue, this.orange);
    }
  }

  /** Eventos de partido del host (los clientes siguen su autoridad). */
  private applyEvent(ev: MatchEvent): void {
    if (this.isHost) return;
    // El partido ya corre y yo sigo en la fase de equipos: cerrarla ya.
    if (this.state === "teampick" && !this.teamsFinal) {
      this.applyTeams(assignTeams(this.roomPlayers, this.picks));
    }
    this.blue = ev.b;
    this.orange = ev.o;
    this.hud.setScore(this.blue, this.orange);
    if (ev.e === "goal") {
      if (this.state !== "playing") return;
      if (ev.w) this.hud.showGoal(ev.w === this.myTeam ? "blue" : "orange");
      SoundEffects.playGoal();
      this.effects.goalBurst(this.ball.position(), ev.w === "blue" ? BLUE : ORANGE);
      this.state = "goal";
      this.goalTimer = CLIENT_GOAL_FALLBACK;
    } else if (ev.e === "kickoff") {
      if (this.state !== "finished") this.kickoff();
    } else if (ev.e === "ot") {
      if (!this.overtime) {
        this.markOvertime();
        this.kickoff();
      }
    } else if (ev.e === "end") {
      if (this.state !== "finished") this.finish();
    }
  }

  /** Envío periódico: mi auto siempre; el host además bots y pelota. */
  private netSend(dt: number): void {
    if (!this.channel || this.state === "teampick") return;
    this.sendAccMs += dt * 1000;
    if (this.sendAccMs < NET_SEND_MS) return;
    this.sendAccMs = 0;

    const p = this.player.body.translation();
    this.channel.sendCar({
      p: this.me,
      t: this.myTeam,
      x: round2(p.x),
      y: round2(p.y),
      z: round2(p.z),
      a: Number(this.player.yaw().toFixed(3)),
      b: this.player.isBoosting(),
      q: Number(this.player.pitch.toFixed(3)),
      s: this.player.isSupersonic(),
      d: this.player.demolished,
    });

    if (!this.isHost) return;
    for (const bot of this.bots) {
      const bp = bot.car.body.translation();
      this.channel.sendCar({
        p: bot.name,
        t: bot.team,
        x: round2(bp.x),
        y: round2(bp.y),
        z: round2(bp.z),
        a: Number(bot.car.yaw().toFixed(3)),
        b: bot.car.isBoosting(),
        q: 0,
        s: bot.car.isSupersonic(),
        d: bot.car.demolished,
      });
    }
    const bp = this.ball.position();
    const bv = this.ball.velocity();
    this.channel.sendBall({
      x: round2(bp.x),
      y: round2(bp.y),
      z: round2(bp.z),
      vx: round2(bv.x),
      vy: round2(bv.y),
      vz: round2(bv.z),
      t: Math.max(0, Math.round(this.time * 10) / 10),
      sb: this.blue,
      so: this.orange,
      ot: this.overtime ? 1 : 0,
    });
  }

  // ---------- Partido ----------

  private startMatch(d: Difficulty): void {
    this.difficulty = d;
    this.ensureSoloBot(d);
    this.blue = 0;
    this.orange = 0;
    this.overtime = false;
    this.hud.setOvertime(false);
    this.time = this.matchTime;
    this.hud.setScore(0, 0);
    this.hud.hide();
    this.kickoff();
  }

  /**
   * Bots del 2v2 solitario: un compañero azul y dos rivales naranjas. Los
   * autos se crean una vez; en la revancha solo se renueva la IA. El spread
   * hace que cada bot cubra un carril distinto de la cancha.
   */
  private ensureSoloBot(d: Difficulty): void {
    const seats: Array<{ team: Team; idx: number; spread: number }> = [
      { team: "blue", idx: 1, spread: 16 }, // compañero
      { team: "orange", idx: 0, spread: -16 },
      { team: "orange", idx: 1, spread: 16 },
    ];
    if (this.bots.length === 0) {
      for (const seat of seats) {
        const s = this.spawnFor(seat.team, seat.idx, 2);
        const car = new Car(this.world, seat.team === "blue" ? BLUE : ORANGE, s.pos, s.yaw);
        this.scene.add(car.mesh);
        this.bots.push({
          name: "BOT",
          team: seat.team,
          car,
          ai: new Bot(d, ATTACK_X[seat.team] * GOAL_LINE, seat.spread),
        });
      }
      // El jugador pasa al carril 0 de su equipo (el compañero usa el 1).
      const ps = this.spawnFor("blue", 0, 2);
      this.player.setSpawn(ps.pos, ps.yaw);
    } else {
      for (let i = 0; i < this.bots.length; i++) {
        const seat = seats[i];
        this.bots[i].ai = new Bot(d, ATTACK_X[this.bots[i].team] * GOAL_LINE, seat?.spread ?? 0);
      }
    }
  }

  /** Reposiciona pelota, autos y pads y arranca la cuenta regresiva del saque. */
  private kickoff(): void {
    this.ball.reset();
    this.player.reset();
    for (const bot of this.bots) bot.car.reset();
    this.pads.resetAll();
    this.state = "countdown";
    this.countdown = KICKOFF_COUNT;
    this.lastCountdownBeep = KICKOFF_COUNT + 1;
    this.hud.showCountdown(String(KICKOFF_COUNT));
  }

  /** Prende el modo tiempo extra (flag + HUD); el reloj cuenta para arriba. */
  private markOvertime(): void {
    this.overtime = true;
    this.time = 0;
    this.hud.setOvertime(true);
  }

  /** Fin del tiempo con empate (solo autoridad): kickoff de gol de oro. */
  private startOvertime(): void {
    this.markOvertime();
    if (this.channel && this.isHost) {
      this.channel.sendEvent({ e: "ot", b: this.blue, o: this.orange });
    }
    this.kickoff();
  }

  private scoreGoal(team: Team): void {
    if (team === "blue") this.blue++;
    else this.orange++;
    this.hud.setScore(this.blue, this.orange);
    // En sala el flash es relativo al jugador: "¡GOL!" si anotó mi equipo.
    const mine = this.channel ? (team === this.myTeam ? "blue" : "orange") : team;
    this.hud.showGoal(mine as Team);
    SoundEffects.playGoal();
    this.effects.goalBurst(this.ball.position(), team === "blue" ? BLUE : ORANGE);
    this.state = "goal";
    this.goalTimer = GOAL_PAUSE;
    if (this.channel && this.isHost) {
      this.channel.sendEvent({ e: "goal", b: this.blue, o: this.orange, w: team });
    }
  }

  private checkGoal(): void {
    const p = this.ball.position();
    if (Math.abs(p.z) > GOAL_W / 2 || p.y > GOAL_H) return;
    if (p.x > GOAL_LINE) this.scoreGoal("blue");
    else if (p.x < -GOAL_LINE) this.scoreGoal("orange");
  }

  private stepPhysics(playing: boolean, dt: number): void {
    const pInput = playing && !this.player.demolished ? this.input.getInput() : IDLE;
    const botInputs = this.bots.map((b) =>
      playing && !b.car.demolished ? b.ai.update(dt, b.car, this.ball) : IDLE,
    );

    if (!playing) {
      this.player.setBoosting(false);
      for (const bot of this.bots) bot.car.setBoosting(false);
    }

    const authority = this.ballAuthority();
    let steps = 0;
    while (this.acc >= FIXED_STEP && steps < 5) {
      if (playing) {
        this.player.applyInput(pInput, FIXED_STEP);
        for (let i = 0; i < this.bots.length; i++) {
          this.bots[i].car.applyInput(botInputs[i], FIXED_STEP);
        }
      }
      this.world.step();
      if (playing) {
        // El golpe propio corre siempre (predicción local en clientes); los
        // de bots y remotos solo donde la pelota es autoritativa.
        if (this.kickFrom(this.player, FIXED_STEP)) SoundEffects.playKick();
        if (authority) {
          for (const bot of this.bots) this.kickFrom(bot.car, FIXED_STEP);
          for (const remote of this.remotes.values()) {
            if (remote.demolished) continue;
            this.kickAt(remote, remote.mesh.position, remote.vel, FIXED_STEP, 1);
          }
        }
      }
      this.acc -= FIXED_STEP;
      steps++;
    }

    if (playing) {
      this.pickupPads();
      this.checkDemolitions();
    }
  }

  /** Pads de boost: cada peer consume para sus propios autos y lo propaga. */
  private pickupPads(): void {
    if (!this.player.demolished) {
      const i = this.pads.tryPickup(this.player);
      if (i >= 0) {
        SoundEffects.playBoostPad();
        if (this.channel) this.channel.sendPad({ i });
      }
    }
    if (this.ballAuthority()) {
      for (const bot of this.bots) {
        const i = this.pads.tryPickup(bot.car);
        if (i >= 0 && this.channel && this.isHost) this.channel.sendPad({ i });
      }
    }
  }

  /**
   * Demoliciones: un rival supersónico en contacto destruye el auto. Cada
   * peer decide por los autos que simula (el propio, y los bots si es host);
   * el estado viaja en el payload normal (flag `d`).
   */
  private checkDemolitions(): void {
    const victims: Array<{ car: Car; mine: boolean; team: Team }> = [
      { car: this.player, mine: true, team: this.myTeam },
    ];
    if (this.ballAuthority()) {
      for (const bot of this.bots) victims.push({ car: bot.car, mine: false, team: bot.team });
    }

    for (const v of victims) {
      if (v.car.demolished) continue;
      const vp = v.car.body.translation();

      const hit = (ax: number, ay: number, az: number, supersonic: boolean, team: Team): boolean =>
        supersonic &&
        team !== v.team &&
        Math.abs(ay - vp.y) < 2.2 &&
        Math.hypot(ax - vp.x, az - vp.z) < DEMO_DIST;

      let demolished = false;
      if (!v.mine && !this.player.demolished) {
        const p = this.player.body.translation();
        demolished = hit(p.x, p.y, p.z, this.player.speed() >= DEMO_SPEED, this.myTeam);
      }
      if (!demolished) {
        for (const bot of this.bots) {
          if (bot.car === v.car || bot.car.demolished) continue;
          const p = bot.car.body.translation();
          if (hit(p.x, p.y, p.z, bot.car.speed() >= DEMO_SPEED, bot.team)) {
            demolished = true;
            break;
          }
        }
      }
      if (!demolished) {
        for (const remote of this.remotes.values()) {
          if (remote.demolished) continue;
          const m = remote.mesh.position;
          if (hit(m.x, m.y, m.z, remote.supersonic, remote.team)) {
            demolished = true;
            break;
          }
        }
      }

      if (demolished) {
        this.effects.explode(new THREE.Vector3(vp.x, vp.y, vp.z), v.team === "blue" ? BLUE : ORANGE);
        v.car.demolish();
        if (v.mine) {
          SoundEffects.playDemolish();
          this.hud.showDemolished();
        }
      }
    }
  }

  private kickFrom(car: Car, dt: number): boolean {
    if (car.demolished) return false;
    const p = car.body.translation();
    const v = car.body.linvel();
    return this.kickAt(
      car,
      new THREE.Vector3(p.x, p.y, p.z),
      new THREE.Vector3(v.x, v.y, v.z),
      dt,
      car.isDodging() ? DODGE_KICK_MULT : 1,
    );
  }

  /**
   * Golpe a la pelota: al contacto, además del empuje físico normal, se
   * aplica un impulso proporcional a la velocidad del auto para que los
   * tiros salgan con fuerza. La voltereta del dodge multiplica el golpe
   * (tiro fuerte estilo RL) y la velocidad vertical cuenta (aéreos).
   */
  private kickAt(
    holder: { kickTimer: number },
    pos: THREE.Vector3,
    vel: THREE.Vector3,
    dt: number,
    mult: number,
  ): boolean {
    holder.kickTimer = Math.max(0, holder.kickTimer - dt);
    if (holder.kickTimer > 0) return false;

    const bp = this.ball.position();
    const delta = bp.clone().sub(pos);
    const contactDist = BALL_R + Math.hypot(CAR_HALF.x, CAR_HALF.z);
    if (delta.length() > contactDist + KICK_RANGE) return false;

    const speed = vel.length();
    if (speed < KICK_SPEED_MIN) return false;

    // Dirección del tiro: hacia donde va el auto, con un piso de elevación.
    const dir = vel.clone().normalize();
    dir.y = Math.max(dir.y, 0) + KICK_UP;
    dir.normalize();

    const impulse = dir.multiplyScalar(speed * KICK_FACTOR * mult * this.ball.body.mass());
    this.ball.body.applyImpulse({ x: impulse.x, y: impulse.y, z: impulse.z }, true);
    holder.kickTimer = KICK_COOLDOWN;
    return true;
  }

  private readonly tick = (): void => {
    const now = performance.now();
    const dt = Math.min((now - this.last) / 1000, 0.05);
    this.last = now;
    this.acc += dt;

    this.updateRemotes(dt);
    this.player.tickRespawn(dt);
    for (const bot of this.bots) bot.car.tickRespawn(dt);

    // Toggle de cámara y quickchat (teclas E y 1-4 / botones táctiles).
    if (this.input.consumeCamToggle()) this.ballCam = !this.ballCam;
    const chat = this.input.consumeChat();
    if (chat >= 0 && this.channel) {
      this.channel.sendChat({ p: this.me, t: this.myTeam, m: chat });
      this.hud.addChat(this.me, QUICKCHAT[chat], this.myTeam);
    }

    if (this.state === "teampick") {
      this.pickTimer -= dt;
      this.pickResend -= dt;
      // Reenvío periódico del pick propio: cura mensajes perdidos y pone al
      // día a los que cargaron después.
      const myPick = this.picks.get(this.me);
      if (myPick && this.pickResend <= 0) {
        this.pickResend = 1.2;
        this.channel?.sendPick({ p: this.me, t: myPick });
      }
      this.hud.updateTeamPick(this.roomPlayers, this.picks, this.me, this.pickTimer);
      const allPicked = this.roomPlayers.every((p) => this.picks.has(p));
      if (this.isHost && (this.pickTimer <= 0 || allPicked)) {
        this.finalizeTeams();
      } else if (!this.isHost && this.pickTimer <= -6) {
        // El host no cerró (¿se cayó?): cada cliente cierra con lo que vio.
        this.applyTeams(assignTeams(this.roomPlayers, this.picks));
      }
      this.acc = Math.min(this.acc, FIXED_STEP);
    } else if (this.state === "countdown") {
      this.countdown -= dt;
      if (this.countdown <= 0) {
        this.state = "playing";
        this.hud.showCountdown(null);
      } else if (this.countdown > 0.4) {
        const shown = Math.ceil(this.countdown);
        if (shown !== this.lastCountdownBeep) {
          this.lastCountdownBeep = shown;
          SoundEffects.playCountdownTick();
        }
        this.hud.showCountdown(String(shown));
      } else {
        // Tick una sola vez al mostrar "¡YA!" (sentinela 0, no colisiona con numeros >=1).
        if (this.lastCountdownBeep !== 0) {
          this.lastCountdownBeep = 0;
          SoundEffects.playCountdownTick();
        }
        this.hud.showCountdown("¡YA!");
      }
      this.stepPhysics(false, dt);
    } else if (this.state === "playing") {
      this.time += this.overtime ? dt : -dt;
      this.hud.setTime(this.time);
      this.stepPhysics(true, dt);
      if (this.ballAuthority()) {
        this.checkGoal();
        if (!this.overtime && this.time <= 0) {
          // Empate al agotarse el reloj → tiempo extra con gol de oro.
          if (this.blue === this.orange) this.startOvertime();
          else this.finish();
        }
      } else if (!this.overtime && this.time <= -5) {
        // Fallback: el host se cayó o se perdió el evento de fin.
        this.finish();
      }
    } else if (this.state === "goal") {
      this.goalTimer -= dt;
      this.stepPhysics(false, dt);
      if (this.goalTimer <= 0 && this.ballAuthority()) {
        if (this.overtime || this.time <= 0) this.finish();
        else {
          if (this.channel && this.isHost) {
            this.channel.sendEvent({ e: "kickoff", b: this.blue, o: this.orange });
          }
          this.kickoff();
        }
      } else if (this.goalTimer <= 0) {
        // Cliente sin evento a tiempo: sigue solo.
        if (this.overtime) this.finish();
        else this.kickoff();
      }
    } else {
      // start / finished: drena el acumulador para no dar un salto al reanudar.
      this.acc = Math.min(this.acc, FIXED_STEP);
    }

    this.netSend(dt);

    this.elapsed += dt;
    this.arena.update(this.elapsed);
    this.pads.update(dt, this.elapsed);
    this.effects.update(dt);
    this.ball.sync();
    this.player.sync(dt);
    for (const bot of this.bots) bot.car.sync(dt);
    this.spawnTrails();
    this.hud.setBoost(this.player.boost);
    this.updateCamera(dt);
    if (this.debugInfo) this.renderer.info.reset();
    this.composer.render();
  };

  /** Estela supersónica de todos los autos (propio, bots y remotos). */
  private spawnTrails(): void {
    if (this.player.isSupersonic()) {
      const back = this.player.forward().multiplyScalar(-1);
      this.effects.trail(this.player.mesh.position, back, this.myTeam === "blue" ? BLUE : ORANGE);
    }
    for (const bot of this.bots) {
      if (!bot.car.isSupersonic()) continue;
      const back = bot.car.forward().multiplyScalar(-1);
      this.effects.trail(bot.car.mesh.position, back, bot.team === "blue" ? BLUE : ORANGE);
    }
    for (const remote of this.remotes.values()) {
      if (!remote.supersonic || remote.demolished) continue;
      const back = remote.vel.lengthSq() > 1 ? remote.vel.clone().normalize().multiplyScalar(-1) : new THREE.Vector3();
      this.effects.trail(remote.mesh.position, back, remote.team === "blue" ? BLUE : ORANGE);
    }
  }

  /** Interpola autos remotos y purga los que dejaron de emitir. */
  private updateRemotes(dt: number): void {
    const now = Date.now();
    for (const [name, remote] of this.remotes) {
      if (now - remote.lastAt > REMOTE_STALE_MS) {
        remote.dispose(this.scene);
        this.remotes.delete(name);
        continue;
      }
      remote.update(dt);
    }
  }

  private finish(): void {
    if (this.state === "finished") return;
    this.state = "finished";
    SoundEffects.playWhistle();
    this.hud.showCountdown(null);
    if (this.channel && this.isHost) {
      this.channel.sendEvent({ e: "end", b: this.blue, o: this.orange });
    }

    const mine = this.myGoals();
    const theirs = this.myTeam === "blue" ? this.orange : this.blue;
    if (this.room) {
      // En sala: una partida por ronda, el puntaje son los goles del equipo.
      this.hud.showResult(mine, theirs, null);
      this.room.reportScore(mine);
    } else {
      this.hud.showResult(mine, theirs, () => this.startMatch(this.difficulty));
    }
  }

  /**
   * Cámara: "ball cam" (detrás del auto mirando a la pelota) o clásica
   * (detrás del auto mirando adelante). Tecla E / botón CAM para alternar.
   */
  private updateCamera(dt: number): void {
    const carPos = this.player.mesh.position;
    const k = 1 - Math.pow(0.001, dt); // suavizado independiente del framerate

    // El FOV se abre en supersónico: sensación de velocidad sin ocultar nada.
    const targetFov = this.player.isSupersonic() ? 67 : 60;
    if (Math.abs(this.camera.fov - targetFov) > 0.05) {
      this.camera.fov += (targetFov - this.camera.fov) * (1 - Math.exp(-dt * 4));
      this.camera.updateProjectionMatrix();
    }

    if (this.ballCam) {
      const ballPos = this.ball.mesh.position;
      const dir = carPos.clone().sub(ballPos).setY(0);
      if (dir.lengthSq() < 0.01) dir.set(-1, 0, 0);
      dir.normalize();

      const desired = carPos.clone().addScaledVector(dir, CAM_DIST);
      desired.y = CAM_HEIGHT;
      this.camera.position.lerp(desired, k);
      this.camTarget.lerp(ballPos.clone().lerp(carPos, 0.35).setY(2), k);
    } else {
      const fwd = this.player.forward();
      const desired = carPos.clone().addScaledVector(fwd, -CAM_DIST);
      desired.y = CAM_HEIGHT;
      this.camera.position.lerp(desired, k);
      this.camTarget.lerp(carPos.clone().addScaledVector(fwd, 14).setY(2.5), k);
    }
    this.camera.lookAt(this.camTarget);
  }

  private readonly onResize = (): void => {
    const { innerWidth, innerHeight } = window;
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(innerWidth, innerHeight);
    this.composer.setSize(innerWidth, innerHeight);
    this.bloomPass.setSize(innerWidth, innerHeight);
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
