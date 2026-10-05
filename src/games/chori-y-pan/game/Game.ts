import {
  BEST_KEY,
  CLEAR_TIME,
  COUNTDOWN_LABELS,
  COUNTDOWN_STEP,
  DEATH_TIME,
  GEM_BONUS,
  LEVELS_PER_RUN,
  MAX_DT,
  STEP,
} from "./constants";
import { initRoomMode } from "../../../shared/room/roomMode";
import { devRoom } from "./devRoom";
import { Hud } from "./Hud";
import { OnlineRace } from "./OnlineRace";
import { Input } from "./Input";
import { parseLevel, type Hero, type LevelDef } from "./Level";
import { LEVELS } from "./levels";
import { Renderer } from "./Renderer";
import { SoundEffects } from "./SoundEffects";
import { World } from "./World";

type State = "ready" | "countdown" | "play" | "dead" | "clear" | "over";

const SEEN_KEY = "chori-y-pan:seen";

/** Tres niveles sin repetir los que ya salieron, hasta agotar la lista (rotacion). */
export function pickLevels(seen: string[], n: number, rand: () => number = Math.random): LevelDef[] {
  let pool = LEVELS.filter((l) => !seen.includes(l.id));
  if (pool.length < n) pool = [...LEVELS];
  const out: LevelDef[] = [];
  const bag = [...pool];
  while (out.length < n && bag.length) out.push(bag.splice(Math.floor(rand() * bag.length), 1)[0]);
  while (out.length < n) out.push(LEVELS[Math.floor(rand() * LEVELS.length)]);
  return out;
}

/**
 * Chori y Pan en modo local: dos personas en la misma compu (Chori con las flechas, Pan
 * con WASD) recorren tres salas del templo lo mas rapido posible. El reloj corre en la
 * carrera entera; morir reinicia la sala (el castigo es tiempo).
 */
export class Game {
  private readonly renderer: Renderer;
  private readonly hud: Hud;
  private readonly input = new Input();
  private state: State = "ready";
  private best: number | null = null;
  private run: LevelDef[] = [];
  private levelIndex = 0;
  private world!: World;
  private acc = 0;
  private runTime = 0;
  private gems = 0;
  private stateT = 0;
  private lastCountdownIndex = -1;
  private time = 0;
  private lastFrame = performance.now();
  /** En sala: la carrera de parejas por el game server (null jugando en local). */
  private readonly online: OnlineRace | null = null;

  constructor(container: HTMLElement) {
    const saved = localStorage.getItem(BEST_KEY);
    if (saved) this.best = Number(saved) / 1000;
    const canvas = document.createElement("canvas");
    canvas.className = "game-canvas";
    container.append(canvas);
    this.renderer = new Renderer(canvas);
    this.hud = new Hud(container);
    // Detras de la tabla de inicio se ve una sala del templo.
    this.loadLevel(LEVELS[Math.floor(Math.random() * LEVELS.length)]);
    const room =
      initRoomMode("chori-y-pan", {
        getScore: () => this.online?.score() ?? 10_000_000,
        onStart: () => void this.online?.start(),
      }) ?? devRoom(() => void this.online?.start());
    if (room) {
      this.online = new OnlineRace(room, this.hud, this.renderer, this.input);
      this.hud.showRoomCard(`<p class="cp-eyebrow">Sala</p><h1 class="cp-title cp-title--small">Chori y Pan</h1><p class="cp-sub">Esperando que arranque la ronda…</p>`);
    } else this.hud.showStart(this.best);
    window.addEventListener("resize", () => this.renderer.resize());
    window.addEventListener("keydown", (e) => {
      SoundEffects.unlock();
      if (this.online) return;
      if ((this.state === "ready" || this.state === "over") && (e.code === "Enter" || e.code === "Space")) {
        e.preventDefault();
        this.beginCountdown();
      }
    });
    // Sobre el container, no sobre el canvas: la tabla de inicio lo tapa.
    container.addEventListener("pointerdown", () => {
      SoundEffects.unlock();
      if (this.online) return;
      if (this.state === "ready" || this.state === "over") this.beginCountdown();
    });
    requestAnimationFrame(this.tick);
  }

  private loadLevel(def: LevelDef): void {
    this.world = new World(parseLevel(def));
    this.renderer.setWorld(this.world);
    this.acc = 0;
    this.paintGems();
  }

  private beginCountdown(): void {
    if (this.state !== "ready" && this.state !== "over") return;
    let seen: string[] = [];
    try {
      seen = JSON.parse(localStorage.getItem(SEEN_KEY) ?? "[]");
    } catch {
      seen = [];
    }
    this.run = pickLevels(seen, LEVELS_PER_RUN);
    const nextSeen = [...new Set([...seen.filter((id) => LEVELS.some((l) => l.id === id)), ...this.run.map((l) => l.id)])];
    localStorage.setItem(SEEN_KEY, JSON.stringify(nextSeen.length >= LEVELS.length ? [] : nextSeen));
    this.levelIndex = 0;
    this.runTime = 0;
    this.gems = 0;
    this.loadLevel(this.run[0]);
    this.hud.setLevel(1, LEVELS_PER_RUN, this.run[0].name);
    this.hud.setTime(0);
    this.hud.hideOverlay();
    this.hud.setPlaying(true);
    this.state = "countdown";
    this.stateT = 0;
    this.lastCountdownIndex = -1;
  }

  private paintGems(): void {
    const w = this.world;
    const all = w.level.gems;
    const left = (hero: Hero) => all.filter((g, i) => g.hero === hero && w.gemsLeft.has(i)).length;
    const total = (hero: Hero) => all.filter((g) => g.hero === hero).length;
    this.hud.setGems([total("chori") - left("chori"), total("chori")], [total("pan") - left("pan"), total("pan")]);
  }

  private tick = (now: number): void => {
    const dt = Math.min(MAX_DT, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    this.time += dt;
    if (this.online) {
      this.online.update(dt);
      const ghosts = this.online.world ? (["chori", "pan"] as Hero[]).filter((h) => this.online!.world!.heroes[h].remote && !this.online!.world!.heroes[h].alive) : [];
      this.renderer.draw(this.time, dt, { ghost: ghosts });
    } else {
      this.update(dt);
      this.renderer.draw(this.time, dt);
    }
    requestAnimationFrame(this.tick);
  };

  private update(dt: number): void {
    this.stateT += dt;
    if (this.state === "countdown") {
      const idx = Math.floor(this.stateT / COUNTDOWN_STEP);
      if (idx !== this.lastCountdownIndex && idx < COUNTDOWN_LABELS.length) {
        this.lastCountdownIndex = idx;
        SoundEffects.playCountdownTick();
      }
      if (idx >= COUNTDOWN_LABELS.length) {
        this.hud.showCountdown(null);
        this.state = "play";
        this.stateT = 0;
      } else this.hud.showCountdown(COUNTDOWN_LABELS[idx]);
      return;
    }
    if (this.state === "play" || this.state === "dead") {
      this.runTime += dt;
      this.hud.setTime(this.runTime);
    }
    if (this.state === "play") {
      this.acc += dt;
      while (this.acc >= STEP) {
        this.acc -= STEP;
        this.world.step(STEP, { chori: this.input.read("chori"), pan: this.input.read("pan") });
      }
      this.flushEvents();
      if (this.state === "play" && this.world.cleared) {
        this.state = "clear";
        this.stateT = 0;
        SoundEffects.clear();
        const last = this.levelIndex === this.run.length - 1;
        this.hud.banner(last ? "¡Salieron del templo!" : "¡Sala superada!", last ? "" : `vamos a la ${this.levelIndex + 2}ª`, "good");
      }
    } else if (this.state === "dead") {
      // Se sigue simulando al que quedo vivo un ratito (cae, se queda quieto).
      this.acc += dt;
      while (this.acc >= STEP) {
        this.acc -= STEP;
        this.world.step(STEP, {});
      }
      this.flushEvents();
      if (this.stateT >= DEATH_TIME) {
        this.loadLevel(this.run[this.levelIndex]);
        this.state = "play";
        this.stateT = 0;
      }
    } else if (this.state === "clear" && this.stateT >= CLEAR_TIME) {
      this.levelIndex++;
      if (this.levelIndex >= this.run.length) this.finish();
      else {
        this.loadLevel(this.run[this.levelIndex]);
        this.hud.setLevel(this.levelIndex + 1, LEVELS_PER_RUN, this.run[this.levelIndex].name);
        this.state = "play";
        this.stateT = 0;
      }
    }
  }

  private flushEvents(): void {
    for (const e of this.world.events) {
      this.renderer.onEvent(e);
      if (e.type === "jump") SoundEffects.jump(e.hero);
      else if (e.type === "land") SoundEffects.land();
      else if (e.type === "gem") {
        SoundEffects.gem(e.hero);
        this.gems++;
        this.paintGems();
      } else if (e.type === "lever") SoundEffects.lever();
      else if (e.type === "plate") SoundEffects.plate(e.pressed);
      else if (e.type === "die" && this.state === "play") {
        SoundEffects.die(e.cause);
        this.state = "dead";
        this.stateT = 0;
        const who = e.hero === "chori" ? "El Chori" : "El Pan";
        const how = e.cause === "goo" ? "tocó el chimichurri vencido" : e.hero === "chori" ? "se empapó" : "se quemó";
        this.hud.banner(`¡${who} ${how}!`, "de nuevo la sala", "bad");
      }
    }
    this.world.events.length = 0;
  }

  private finish(): void {
    this.state = "over";
    const total = Math.max(0, this.runTime - this.gems * GEM_BONUS);
    const isBest = this.best === null || total < this.best;
    if (isBest) {
      this.best = total;
      localStorage.setItem(BEST_KEY, String(Math.round(total * 1000)));
    }
    SoundEffects.win();
    this.hud.setPlaying(false);
    this.hud.showGameOver({ time: total, raw: this.runTime, gems: this.gems, best: this.best, isBest });
    this.hud.showRanking(Math.round(total * 1000));
  }
}
