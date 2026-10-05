import { isGameServerConfigured, resolveGameServerUrl } from "../../../shared/server-status";
import { ChoriSocket, type CpMech, type CpPeer, type CpRole, type CpState } from "./ChoriSocket";
import { COUNTDOWN_LABELS, COUNTDOWN_STEP, LEVELS_PER_RUN, STEP } from "./constants";
import type { RoomLink } from "./devRoom";
import type { Hud } from "./Hud";
import type { Input } from "./Input";
import { parseLevel, type Hero } from "./Level";
import { LEVELS } from "./levels";
import type { Renderer } from "./Renderer";
import { SoundEffects } from "./SoundEffects";
import { World } from "./World";

/** Cada cuanto se manda la posicion propia (ms). 20/s por jugador, por el game server. */
const POS_MS = 50;
/** Sin noticias del server tras morir, se reinicia igual (por si se corto). */
const RESET_FALLBACK_MS = 2500;
/** Una caja empujada hace menos que esto es "mia" (la mando yo, no la piso con la red). */
const BOX_OWN_MS = 900;

/** Puntaje de sala: el tiempo si terminaron; si no, cuanto mas lejos llegaron, mejor. */
export function roomScore(time: number, level: number): number {
  return time >= 0 ? time : 10_000_000 - level * 1_000_000;
}

/**
 * La carrera de parejas en sala (ver CLAUDE.md "Salas"). Cada cliente simula a SU heroe
 * y dibuja al compañero donde dice la red; botones, palancas, muertes y llegadas pasan
 * por el game server, que es el que decide para los dos.
 */
export class OnlineRace {
  private readonly room: RoomLink;
  private readonly hud: Hud;
  private readonly renderer: Renderer;
  private readonly input: Input;
  private socket: ChoriSocket | null = null;
  private role: CpRole = "none";
  private pairId = -1;
  private state: CpState | null = null;
  private offset = Number.POSITIVE_INFINITY;
  private levelIndex = -1;
  world: World | null = null;
  private acc = 0;
  private lastPos = 0;
  private lastPress: Record<Hero, string | null> = { chori: null, pan: null };
  private lastDoor: Record<Hero, boolean> = { chori: false, pan: false };
  private deadAt = 0;
  private boxOwned = new Map<number, number>();
  private target: Partial<Record<Hero, CpPeer & { at: number }>> = {};
  private lastCountdown = -1;
  private reported = false;
  private betShown = "";
  private phaseShown = "";

  constructor(room: RoomLink, hud: Hud, renderer: Renderer, input: Input) {
    this.room = room;
    this.hud = hud;
    this.renderer = renderer;
    this.input = input;
  }

  /** Lo que se le reporta a RoomMode si se corta la ronda. */
  score(): number {
    const p = this.myPair();
    return p ? roomScore(p.time, p.level) : 10_000_000;
  }

  async start(): Promise<void> {
    if (matchMedia("(pointer: coarse)").matches) this.hud.mountTouch((k, on) => this.input.setTouch(k, on));
    if (!isGameServerConfigured()) {
      this.hud.showRoomCard(`<p class="cp-eyebrow">Sala</p><h1 class="cp-title cp-title--small">No disponible</h1><p class="cp-sub">La carrera de parejas necesita el game server.</p>`);
      return;
    }
    this.hud.showRoomCard(`<p class="cp-eyebrow">Sala ${this.room.code}</p><h1 class="cp-title cp-title--small">Entrando al templo…</h1><p class="cp-sub">Armando las parejas.</p>`);
    const url = await resolveGameServerUrl();
    if (!url) return;
    const s = new ChoriSocket(url, { code: this.room.code, nickname: this.room.me, roster: this.room.players(), round: this.room.round() });
    this.socket = s;
    s.handle("you", (m) => {
      if (m.round !== this.room.round()) return;
      this.role = m.role;
      this.pairId = m.pair;
      this.input.single = m.role === "chori" || m.role === "pan" ? m.role : null;
    });
    s.handle("state", (m) => this.onState(m));
    s.handle("peer", (m) => this.onPeer(m));
    s.handle("mech", (m) => this.onMech(m));
    s.handle("box", (m) => {
      if (!this.mine(m.pair) || m.lv !== this.levelIndex || !this.world) return;
      if (performance.now() - (this.boxOwned.get(m.i) ?? -1e9) < BOX_OWN_MS) return;
      const b = this.world.boxes[m.i];
      if (!b) return;
      b.x = m.x;
      b.y = m.y;
      b.vy = 0;
    });
    s.handle("gem", (m) => {
      if (!this.mine(m.pair) || m.lv !== this.levelIndex || !this.world) return;
      if (this.world.gemsLeft.delete(m.i)) {
        const g = this.world.level.gems[m.i];
        this.renderer.onEvent({ type: "gem", hero: g.hero, x: g.x, y: g.y, i: m.i });
        SoundEffects.gem(g.hero);
      }
    });
    s.handle("reset", (m) => {
      if (!this.mine(m.pair)) return;
      const who = m.who === "chori" ? "El Chori" : "El Pan";
      const how = m.cause === "goo" ? "tocó el chimichurri vencido" : m.who === "chori" ? "se empapó" : "se quemó";
      if (!this.deadAt) SoundEffects.die(m.cause);
      this.hud.banner(`¡${who} ${how}!`, "de nuevo la sala", "bad");
      this.loadLevel(m.lv, true);
    });
    s.handle("level", (m) => {
      if (!this.mine(m.pair)) return;
      SoundEffects.clear();
      if (m.lv >= LEVELS_PER_RUN) {
        this.hud.banner("¡Salieron del templo!", "esperando a las otras parejas", "good");
        SoundEffects.win();
      } else {
        this.hud.banner("¡Sala superada!", `vamos a la ${m.lv + 1}ª`, "good");
        this.loadLevel(m.lv, true);
      }
    });
    await s.connect();
  }

  // ---------- Mensajes ----------

  private mine(pair: number): boolean {
    return pair === this.watchedPair();
  }

  /** La pareja que se juega o se mira (el que aposto mira la suya). */
  private watchedPair(): number {
    if (this.role === "bettor") return this.state?.bets[this.room.me] ?? -1;
    return this.pairId;
  }

  private myPair() {
    return this.state?.pairs.find((p) => p.id === this.watchedPair()) ?? null;
  }

  private serverNow(): number {
    return Date.now() - (Number.isFinite(this.offset) ? this.offset : 0);
  }

  private onState(m: CpState): void {
    if (m.round !== this.room.round()) return;
    // Offset de reloj: la muestra con menos demora (como PONG).
    this.offset = Math.min(this.offset, Date.now() - m.t);
    this.state = m;
    this.paintPairs();
    if (m.phase === "bet") this.showBet(m);
    if (m.phase === "race" && this.phaseShown !== "race") {
      this.phaseShown = "race";
      this.hud.hideOverlay();
      this.hud.setPlaying(true);
      const p = this.myPair();
      this.loadLevel(p ? Math.min(p.level, LEVELS_PER_RUN - 1) : 0, false);
      this.introRole();
    }
    if (m.phase === "race") {
      // Si la pareja cambio de sala y nos perdimos el aviso (reconexion), alinearse.
      const p = this.myPair();
      if (p && p.level < LEVELS_PER_RUN && p.level !== this.levelIndex) this.loadLevel(p.level, true);
    }
    if (m.phase === "done") this.finish();
  }

  private onPeer(m: CpPeer): void {
    if (!this.mine(m.pair) || m.lv !== this.levelIndex || !this.world) return;
    if (m.n === this.room.me && this.role !== "bettor") return;
    this.target[m.r] = { ...m, at: performance.now() };
  }

  private onMech(m: CpMech): void {
    if (!this.mine(m.pair) || m.lv !== this.levelIndex || !this.world) return;
    const before = this.world.channelOverride;
    const next = new Map<string, boolean>();
    for (const c of m.ch) next.set(c, true);
    this.world.channelOverride = next;
    const changed = this.world.levers.filter((l, i) => m.levers.some(([j, on]) => j === i && (on === 1) !== l.on));
    this.world.setLevers(m.levers);
    if (changed.length) SoundEffects.lever();
    void before;
  }

  // ---------- Pantallas de sala ----------

  private introRole(): void {
    const p = this.myPair();
    if (this.role === "chori" || this.role === "pan") {
      const mate = p ? (this.role === "chori" ? p.pan : p.chori) : "";
      this.hud.banner(this.role === "chori" ? "Sos el CHORI" : "Sos el PAN", `con ${mate} · brasas ${this.role === "chori" ? "sí" : "no"}, agua ${this.role === "pan" ? "sí" : "no"}`, "info");
    } else if (this.role === "both") {
      this.hud.banner("Manejás a los dos", "Chori con flechas, Pan con W A D", "info");
    } else if (this.role === "bettor" && p) {
      this.hud.banner(`Apostaste a ${p.chori} y ${p.pan}`, "si ganan, ganás", "info");
    }
  }

  private showBet(m: CpState): void {
    const left = Math.max(0, Math.ceil((m.betEnd - this.serverNow()) / 1000));
    const bettor = m.bettors[0] ?? "";
    const mine = m.bets[this.room.me];
    const sig = `${left}|${mine}|${this.role}`;
    if (sig === this.betShown) return;
    this.betShown = sig;
    if (this.role === "bettor") {
      const list = m.pairs
        .map((p) => `<button type="button" class="cp-bet ${mine === p.id ? "is-on" : ""}" data-pair="${p.id}"><b>${esc(p.chori)}</b><i>y</i><b>${esc(p.pan)}</b></button>`)
        .join("");
      this.hud.showRoomCard(
        `<p class="cp-eyebrow">Sobraste en las parejas</p><h1 class="cp-title cp-title--small">¿A quién apostás?</h1><p class="cp-sub">Si tu pareja gana, ganás vos también. La vas a poder mirar en vivo.</p><div class="cp-bets">${list}</div><p class="cp-hint">${left} s</p>`,
        (el) => {
          const btn = el.closest<HTMLElement>("[data-pair]");
          if (btn) this.socket?.send("cp:bet", { pair: Number(btn.dataset.pair) });
        },
      );
    } else {
      const p = this.myPair();
      const mate = p ? (this.role === "chori" ? p.pan : p.chori) : "";
      this.hud.showRoomCard(
        `<p class="cp-eyebrow">Sala ${this.room.code}</p><h1 class="cp-title cp-title--small">${this.role === "chori" ? "Sos el Chori" : this.role === "pan" ? "Sos el Pan" : "Preparados"}</h1><p class="cp-sub">${mate ? `Tu pareja: <b>${esc(mate)}</b>.` : ""} ${esc(bettor)} está eligiendo a qué pareja apostar.</p><p class="cp-hint">largamos en ${left} s</p>`,
      );
    }
  }

  private paintPairs(): void {
    const m = this.state;
    if (!m) return;
    this.hud.setPairs(
      m.pairs.map((p) => ({ chori: p.chori, pan: p.pan, level: p.level, total: LEVELS_PER_RUN, time: p.time, mine: p.id === this.watchedPair() })),
    );
  }

  private finish(): void {
    if (this.reported) return;
    this.reported = true;
    const p = this.myPair();
    const score = p ? roomScore(p.time, p.level) : 10_000_000;
    this.room.reportScore(score);
    const sorted = [...(this.state?.pairs ?? [])].sort((a, b) => roomScore(a.time, a.level) - roomScore(b.time, b.level));
    const rows = sorted
      .map((q, i) => `<li class="${q.id === this.watchedPair() ? "is-me" : ""}"><span>${i + 1}°</span><b>${esc(q.chori)} y ${esc(q.pan)}</b><i>${q.time >= 0 ? fmt(q.time) : `${q.level}/${LEVELS_PER_RUN} salas`}</i></li>`)
      .join("");
    this.hud.setPlaying(false);
    this.hud.showRoomCard(`<p class="cp-eyebrow">Carrera terminada</p><h1 class="cp-title cp-title--small">Así salieron del templo</h1><ol class="cp-podium">${rows}</ol>`, undefined, true);
  }

  // ---------- Juego ----------

  private loadLevel(index: number, quick: boolean): void {
    const id = this.state?.levels[index];
    const def = LEVELS.find((l) => l.id === id) ?? LEVELS[0];
    this.levelIndex = index;
    const w = new World(parseLevel(def));
    w.channelOverride = new Map();
    const local = this.localHeroes();
    for (const h of ["chori", "pan"] as Hero[]) w.heroes[h].remote = !local.includes(h);
    this.world = w;
    this.renderer.setWorld(w);
    this.acc = 0;
    this.deadAt = 0;
    this.lastPress = { chori: null, pan: null };
    this.lastDoor = { chori: false, pan: false };
    this.boxOwned.clear();
    this.target = {};
    this.hud.setLevel(index + 1, LEVELS_PER_RUN, def.name);
    void quick;
  }

  private localHeroes(): Hero[] {
    if (this.role === "chori") return ["chori"];
    if (this.role === "pan") return ["pan"];
    if (this.role === "both") return ["chori", "pan"];
    return [];
  }

  update(dt: number): void {
    const st = this.state;
    if (st?.phase === "bet") this.showBet(st);
    if (!st || st.phase !== "race" || !this.world) return;
    const now = this.serverNow();
    const w = this.world;
    // Cuenta regresiva alineada a la largada del server.
    const toStart = (st.raceStart - now) / 1000;
    if (toStart > 0) {
      const idx = COUNTDOWN_LABELS.length - 1 - Math.floor(toStart / COUNTDOWN_STEP);
      if (idx >= 0 && idx !== this.lastCountdown) {
        this.lastCountdown = idx;
        SoundEffects.playCountdownTick();
        this.hud.showCountdown(COUNTDOWN_LABELS[Math.min(idx, COUNTDOWN_LABELS.length - 1)]);
      }
      return;
    }
    if (this.lastCountdown !== -2) {
      this.lastCountdown = -2;
      this.hud.showCountdown(null);
    }
    const p = this.myPair();
    this.hud.setTime(p && p.time >= 0 ? p.time / 1000 : Math.max(0, now - st.raceStart) / 1000);
    if (p && p.level >= LEVELS_PER_RUN) return;

    // Compañero (o los dos, si se mira): suavizado hacia lo ultimo que llego.
    for (const hero of ["chori", "pan"] as Hero[]) {
      const b = w.heroes[hero];
      const t = this.target[hero];
      if (!b.remote || !t) continue;
      const tx = t.x;
      const ty = t.y;
      if (Math.abs(tx - b.x) > 3 || Math.abs(ty - b.y) > 3) {
        b.x = tx;
        b.y = ty;
      } else {
        const k = Math.min(1, dt * 16);
        b.x += (tx - b.x) * k;
        b.y += (ty - b.y) * k;
      }
      b.vx = t.vx;
      b.vy = t.vy;
      b.face = t.f < 0 ? -1 : 1;
      b.onGround = t.g === 1;
      b.alive = t.a === 1;
    }

    const local = this.localHeroes();
    this.acc += dt;
    while (this.acc >= STEP) {
      this.acc -= STEP;
      const inputs: Partial<Record<Hero, ReturnType<Input["read"]>>> = {};
      for (const h of local) inputs[h] = this.input.read(h);
      w.step(STEP, inputs);
    }
    this.flush(local);
    if (this.deadAt && performance.now() - this.deadAt > RESET_FALLBACK_MS) this.loadLevel(this.levelIndex, true);
    this.send(local, now);
  }

  private flush(local: Hero[]): void {
    const w = this.world!;
    for (const e of w.events) {
      this.renderer.onEvent(e);
      if (e.type === "jump") SoundEffects.jump(e.hero);
      else if (e.type === "land") SoundEffects.land();
      else if (e.type === "gem" && local.includes(e.hero)) {
        SoundEffects.gem(e.hero);
        this.socket?.send("cp:gem", { lv: this.levelIndex, i: e.i });
      } else if (e.type === "lever") {
        const i = w.levers.findIndex((l) => l.def.x === e.x && l.def.y === e.y);
        if (i >= 0) this.socket?.send("cp:lever", { lv: this.levelIndex, i, ch: w.levers[i].def.ch, on: e.on ? 1 : 0 });
        SoundEffects.lever();
      } else if (e.type === "plate") SoundEffects.plate(e.pressed);
      else if (e.type === "push") this.boxOwned.set(e.box, performance.now());
      else if (e.type === "die" && local.includes(e.hero) && !this.deadAt) {
        this.deadAt = performance.now();
        SoundEffects.die(e.cause);
        this.socket?.send("cp:die", { lv: this.levelIndex, r: e.hero, cause: e.cause });
      }
    }
    w.events.length = 0;
  }

  private send(local: Hero[], now: number): void {
    const w = this.world!;
    const t = performance.now();
    if (t - this.lastPos >= POS_MS) {
      this.lastPos = t;
      for (const h of local) {
        const b = w.heroes[h];
        this.socket?.send("cp:pos", { lv: this.levelIndex, r: h, x: b.x, y: b.y, vx: b.vx, vy: b.vy, f: b.face, g: b.onGround ? 1 : 0, a: b.alive ? 1 : 0 });
      }
      for (const [i, at] of this.boxOwned) {
        if (t - at > BOX_OWN_MS * 2) continue;
        const b = w.boxes[i];
        this.socket?.send("cp:box", { lv: this.levelIndex, i, x: b.x, y: b.y });
      }
    }
    // Canales que pisan mis heroes y las cajas: solo cuando cambian.
    for (const h of local) {
      const ch = w.pressedChannels([h]);
      if (ch !== this.lastPress[h]) {
        this.lastPress[h] = ch;
        this.socket?.send("cp:press", { lv: this.levelIndex, r: h, ch });
      }
    }
    for (const h of local) {
      const inDoor = w.heroes[h].inDoor;
      if (inDoor !== this.lastDoor[h]) {
        this.lastDoor[h] = inDoor;
        this.socket?.send("cp:door", { lv: this.levelIndex, r: h, in: inDoor ? 1 : 0 });
      }
    }
    void now;
  }
}

function fmt(ms: number): string {
  const t = ms / 1000;
  const m = Math.floor(t / 60);
  return `${m}:${(t - m * 60).toFixed(1).padStart(4, "0")}`;
}

function esc(s: string): string {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}
