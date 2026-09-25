import { initRoomMode, isRoomMode, type RoomMode } from "../../../shared/room/roomMode";
import { isGameServerConfigured, resolveGameServerUrl } from "../../../shared/server-status";
import {
  analyzeTake,
  featuresFromFrames,
  featuresFromSound,
  scoreTake,
  type Features,
} from "./analysis";
import { audioRunning, installUnlock, outputLevel } from "./audio";
import { COUNTDOWN_LABELS, COUNTDOWN_STEP, EFFECTS, MAX_TAKE_BYTES, RECORD_MS } from "./constants";
import { Hud } from "./Hud";
import type { MtGameover, MtPhase, MtState, MtTake } from "./ImitameTransport";
import { MicRecorder, muLawDecode, muLawEncode, normalizeGain, trimSilence } from "./recorder";
import { SocketTransport } from "./SocketTransport";
import { SoundEffects } from "./SoundEffects";
import { soundById, type Sound } from "./sounds";
import { playSound, playTake, playbackDuration, takeToBuffer } from "./synth";

type State = "message" | "countdown" | "playing" | "over";

/** Los "3 / 2 / 1" antes de grabar (la fase `ready` del server dura esto x3). */
const READY_STEP_MS = 700;

interface LoadedTake {
  buffer: AudioBuffer;
  pcm: Float32Array;
  rate: number;
  features: Features | null;
}

/**
 * Imitame: juego SOLO de sala, clon simplificado de Mimic Party. Suena un sonido una
 * vez, todos lo imitan a la vez con la voz, cada navegador puntua su toma (melodia,
 * ritmo, golpes), despues las tomas suenan una por una para toda la sala y una
 * ruleta reparte bonus y sabotajes para la ronda siguiente.
 *
 * Supabase maneja lobby / marcador / rejoin (via RoomMode); las fases, el relay de
 * las tomas y la ruleta los maneja el game server por socket.io (`/imitame`).
 */
export class Game {
  private readonly hud: Hud;
  private state: State = "message";

  private readonly room: RoomMode | null;
  private transport: SocketTransport | null = null;
  private connecting = false;

  private readonly recorder = new MicRecorder();
  private micReady: Promise<boolean> | null = null;
  private micOk = false;

  private lastCountdownIndex = -1;
  private latest: MtState | null = null;
  private prevPhase: MtPhase | null = null;
  private prevRound = -1;
  private prevPlayKey = "";

  private sound: Sound | null = null;
  private ref: Features | null = null;
  private listenedRound = -1;
  private recordedRound = -1;
  private readonly takes = new Map<string, LoadedTake>();
  private readonly timers = new Set<number>();

  constructor(root: HTMLElement) {
    this.hud = new Hud(root);
    this.hud.onAudioUnlock(() => this.refreshAudioBlocked());
    installUnlock(() => this.refreshAudioBlocked());

    this.room = initRoomMode("imitame", {
      getScore: () => this.liveScore(),
      onStart: () => this.beginCountdown(),
    });

    if (!this.room) {
      if (isRoomMode()) {
        this.hud.showMessage("No disponible", "Imitame necesita las credenciales de la sala y no estan configuradas.");
      } else {
        this.hud.showMessage(
          "Solo en salas",
          "Imitame se juega con amigos en una sala. Cre&aacute; o un&iacute;te a una para jugar.",
          { label: "Ir a las salas", onClick: () => (window.location.href = "/rooms/") },
        );
      }
      return;
    }

    if (!isGameServerConfigured()) {
      this.hud.showMessage(
        "No disponible",
        "Imitame necesita el game server y no est&aacute; configurado (VITE_GAME_SERVER_URL).",
      );
      return;
    }

    // El permiso del micro se pide ya: el cartel del navegador sale mientras se lee
    // el briefing, y no en el medio de la primera ronda.
    this.micReady = this.recorder.init().then((ok) => (this.micOk = ok));
    this.hud.showMessage("Imitame", "Permit&iacute; el micr&oacute;fono y esper&aacute; a que empiece la ronda...");
  }

  // ---------- Countdown ----------

  private beginCountdown(): void {
    if (this.state === "countdown" || this.state === "playing") return;
    this.state = "countdown";
    this.lastCountdownIndex = -1;
    void this.connect();

    let i = 0;
    const step = () => {
      if (i >= COUNTDOWN_LABELS.length) {
        this.hud.showCountdown(null);
        this.startPlaying();
        return;
      }
      if (i !== this.lastCountdownIndex) {
        this.lastCountdownIndex = i;
        SoundEffects.playCountdownTick();
      }
      this.hud.showCountdown(COUNTDOWN_LABELS[i]);
      i += 1;
      window.setTimeout(step, COUNTDOWN_STEP);
    };
    step();
  }

  private startPlaying(): void {
    this.state = "playing";
    this.hud.showStage();
    this.refreshAudioBlocked();
    if (this.latest) this.applyState(this.latest);
  }

  private refreshAudioBlocked(): void {
    this.hud.setAudioBlocked(this.state === "playing" && !audioRunning());
  }

  // ---------- Transporte ----------

  private async connect(): Promise<void> {
    if (this.transport || this.connecting || !this.room) return;
    this.connecting = true;
    const url = await resolveGameServerUrl();
    this.connecting = false;
    if (this.transport || !url) return;
    const transport = new SocketTransport(url, this.room.code, this.room.me, this.room.players());
    transport.onState((s) => this.onState(s));
    transport.onTake((t) => this.onTake(t));
    transport.onGameover((r) => this.onGameover(r));
    this.transport = transport;
    void transport.connect();
  }

  private onState(s: MtState): void {
    this.latest = s;
    if (this.state === "playing") this.applyState(s);
  }

  private get me(): string {
    return this.room?.me ?? "";
  }

  private isSeat(s: MtState): boolean {
    return s.players.some((p) => p.nickname === this.me);
  }

  private applyState(s: MtState): void {
    if (s.soundId !== this.sound?.id) {
      this.sound = soundById(s.soundId);
      this.ref = this.sound ? featuresFromSound(this.sound) : null;
    }
    this.hud.renderChrome(s, this.me);

    if (this.prevPhase !== s.phase || this.prevRound !== s.round) {
      this.prevPhase = s.phase;
      this.prevRound = s.round;
      this.onPhaseChange(s);
    }
    if (s.phase === "playback") {
      const key = `${s.round}|${s.playIndex}`;
      if (key !== this.prevPlayKey) {
        this.prevPlayKey = key;
        this.playSlot(s);
      }
    }
    if (s.phase === "upload") this.hud.setUploadProgress(s);
  }

  private onPhaseChange(s: MtState): void {
    const sound = this.sound;
    switch (s.phase) {
      case "waiting":
        this.hud.setText("Imitame", "Esperando a la sala...", "");
        this.hud.setMode("idle");
        break;
      case "intro": {
        this.clearTimers();
        this.hud.clearCard();
        this.hud.setMode("idle");
        const mine = s.players.find((p) => p.nickname === this.me)?.effect ?? null;
        const effectLine = mine
          ? `La ruleta te dejo: ${EFFECTS[mine].label} (x${EFFECTS[mine].mult}) en esta toma.`
          : "Escuchas una vez. Grabas una vez.";
        this.hud.setText(`Ronda ${s.round + 1} de ${s.totalRounds} / ${sound?.pack ?? ""}`, sound?.name ?? "", effectLine);
        break;
      }
      case "listen":
        if (!sound || this.listenedRound === s.round) break;
        this.listenedRound = s.round;
        this.hud.setText("Escucha", sound.name, "Una sola vez. Presta atencion.");
        this.hud.setMode("listen", outputLevel);
        this.hud.traceListen(this.ref, playSound(sound));
        break;
      case "ready":
        this.hud.setText("Preparate", sound?.name ?? "", "Cuando diga YA, imitalo.");
        this.hud.setMode("idle");
        this.readyCountdown(s);
        break;
      case "record":
        this.hud.showCountdown("YA");
        this.later(() => this.hud.showCountdown(null), 600);
        this.startRecording(s);
        break;
      case "upload":
        this.hud.setMode("idle");
        break;
      case "playback":
        this.hud.setText("A escuchar", "Las tomas de todos", "");
        break;
      case "wheel":
        this.spinWheel(s);
        break;
      case "over":
        this.hud.setText("Fin", "Se termino el show", "");
        this.hud.setMode("idle");
        break;
    }
  }

  /** "3 / 2 / 1" antes de grabar. Se deriva del reloj de la fase, asi un F5 no lo desfasa. */
  private readyCountdown(s: MtState): void {
    const remaining = s.clockMs ?? READY_STEP_MS * 3;
    const labels = ["3", "2", "1"];
    const first = Math.max(0, labels.length - Math.ceil(remaining / READY_STEP_MS));
    labels.slice(first).forEach((label, k) => {
      const delay = k === 0 ? 0 : remaining - (labels.length - first - k) * READY_STEP_MS;
      this.later(() => {
        if (this.latest?.phase !== "ready") return;
        SoundEffects.playCountdownTick();
        this.hud.showCountdown(label);
      }, Math.max(0, delay));
    });
  }

  // ---------- Grabacion ----------

  private startRecording(s: MtState): void {
    if (this.recordedRound === s.round || !this.isSeat(s)) return;
    this.recordedRound = s.round;
    const round = s.round;
    void (this.micReady ?? Promise.resolve(false)).then(() => {
      if (!this.micOk) {
        this.hud.setText("Sin microfono", this.sound?.name ?? "", "No hay permiso de microfono: esta ronda no sumas.");
        this.transport?.sendTake({ round, rate: 0, audio: null, raw: 0, attacks: 0, rhythm: 0, melody: 0 });
        return;
      }
      SoundEffects.playRecStart();
      this.hud.setText("Grabando", this.sound?.name ?? "", "Imitalo ahora. Tenes una sola toma.");
      this.hud.setMode("sing", () => this.recorder.level);
      this.hud.traceRecord(RECORD_MS);
      this.recorder.start((frame) => this.hud.pushLive(frame));
      this.later(() => this.finishRecording(round), RECORD_MS);
    });
  }

  private finishRecording(round: number): void {
    const pcm = this.recorder.stop();
    SoundEffects.playRecStop();
    this.hud.setMode("idle");
    const rate = this.recorder.rate;
    const feats = featuresFromFrames(analyzeTake(pcm, rate));
    const b = this.ref ? scoreTake(this.ref, feats) : { attacks: 0, rhythm: 0, melody: 0, raw: 0 };
    this.hud.setText("Tu toma", this.sound?.name ?? "", "Esperando a los demas...");
    this.hud.showCard({
      who: "Tu toma",
      raw: b.raw,
      mult: null,
      points: null,
      attacks: b.attacks,
      rhythm: b.rhythm,
      melody: b.melody,
      pitched: this.hasPitch(),
      hasTake: !feats.silent,
    });
    if (this.ref) this.hud.traceCompare(this.ref, feats);

    let clip = normalizeGain(trimSilence(pcm, rate));
    if (clip.length > MAX_TAKE_BYTES) clip = clip.slice(0, MAX_TAKE_BYTES);
    const bytes = muLawEncode(clip);
    this.transport?.sendTake({
      round,
      rate,
      audio: bytes.buffer as ArrayBuffer,
      raw: b.raw,
      attacks: b.attacks,
      rhythm: b.rhythm,
      melody: b.melody,
    });
  }

  private hasPitch(): boolean {
    return (this.ref?.contour.filter((v) => v != null).length ?? 0) >= 3;
  }

  // ---------- Reproduccion ----------

  private onTake(t: MtTake): void {
    const pcm = muLawDecode(new Uint8Array(t.audio));
    const buffer = takeToBuffer(pcm, t.rate);
    if (!buffer) return;
    this.takes.set(`${t.round}|${t.nickname}`, { buffer, pcm, rate: t.rate, features: null });
    // Si justo es el turno de esta toma y llego tarde, que suene ahora.
    const s = this.latest;
    if (s?.phase === "playback" && s.round === t.round && s.playOrder?.[s.playIndex] === t.nickname) {
      this.playSlot(s);
    }
  }

  private playedSlot = "";

  private playSlot(s: MtState): void {
    const nick = s.playOrder?.[s.playIndex];
    if (!nick) return;
    const slotKey = `${s.round}|${s.playIndex}`;
    const result = s.results?.find((r) => r.nickname === nick) ?? null;
    const effect = s.players.find((p) => p.nickname === nick)?.effect ?? null;
    const kicker = `Toma ${s.playIndex + 1} de ${s.playOrder?.length ?? 0}`;
    const effectLine = effect ? `Con ${EFFECTS[effect].label} (x${EFFECTS[effect].mult})` : "";
    const who = nick === this.me ? "Vos" : nick;
    this.hud.clearCard();

    if (!result?.hasTake) {
      this.hud.setText(kicker, who, "No grabo nada.");
      this.hud.traceClear();
      return;
    }
    const take = this.takes.get(`${s.round}|${nick}`);
    this.hud.setText(kicker, who, effectLine);
    if (!take || this.playedSlot === slotKey) return; // la toma todavia no llego: onTake la dispara
    this.playedSlot = slotKey;

    if (!take.features) take.features = featuresFromFrames(analyzeTake(take.pcm, take.rate));
    if (this.ref) this.hud.traceCompare(this.ref, take.features);
    this.hud.setMode("play", outputLevel);
    playTake(take.buffer, effect);
    const dur = playbackDuration(take.buffer, effect);
    this.later(() => {
      this.hud.setMode("idle");
      SoundEffects.playScore(result.raw);
      this.hud.showCard({
        who,
        raw: result.raw,
        mult: result.mult,
        points: result.points,
        attacks: result.attacks,
        rhythm: result.rhythm,
        melody: result.melody,
        pitched: this.hasPitch(),
        hasTake: true,
      });
    }, dur * 1000 + 150);
  }

  // ---------- Ruleta ----------

  private spinWheel(s: MtState): void {
    const w = s.wheel;
    this.hud.clearCard();
    this.hud.traceClear();
    if (!w) return;
    const fx = EFFECTS[w.outcome];
    const who = w.target === this.me ? "Vos" : w.target;
    this.hud.setText("La ruleta", "Gira...", "");
    this.hud.spinWheel(w.outcome, w.jitter, () => {
      SoundEffects.playWheelStop(fx.kind !== "sabotage");
      const text =
        fx.kind === "none"
          ? `${who}: se salvo, no le toca nada.`
          : `${who}: ${fx.label} en la proxima toma (x${fx.mult}).`;
      this.hud.setText("La ruleta", fx.label, text);
    });
  }

  // ---------- Fin ----------

  private onGameover(result: MtGameover): void {
    if (this.state === "over") return;
    this.state = "over";
    this.clearTimers();
    const mine = result.ranking.find((r) => r.nickname === this.me);
    const place = mine?.place ?? result.ranking.length;
    if (place === 1) SoundEffects.playWin();
    else SoundEffects.playLose();
    // Puntaje placement-based (mayor = mejor), como Basta. No va al ranking global.
    if (this.room) this.room.reportScore(Math.max(0, result.ranking.length - place));
  }

  private liveScore(): number {
    return this.latest?.players.find((p) => p.nickname === this.me)?.total ?? 0;
  }

  private later(fn: () => void, ms: number): void {
    const id = window.setTimeout(() => {
      this.timers.delete(id);
      fn();
    }, ms);
    this.timers.add(id);
  }

  private clearTimers(): void {
    for (const id of this.timers) window.clearTimeout(id);
    this.timers.clear();
  }
}
