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
import { clipsEnabled, fetchClipIndex, loadClip } from "./clips";
import {
  COUNTDOWN_LABELS,
  COUNTDOWN_STEP,
  EFFECTS,
  MAX_TAKE_BYTES,
  PRE_SLOT_MS,
  READY_STEP_MS,
  RECORD_MS,
} from "./constants";
import { Hud } from "./Hud";
import type { MtGameover, MtPhase, MtState, MtTake } from "./ImitameTransport";
import { Library } from "./Library";
import { MicRecorder, muLawDecode, muLawEncode, normalizeGain, trimSilence } from "./recorder";
import { SocketTransport } from "./SocketTransport";
import { SoundEffects } from "./SoundEffects";
import { soundById } from "./sounds";
import { playBuffer, playSound, playTake, playbackDuration, takeToBuffer } from "./synth";
import { VoiceChat, type Signal } from "./VoiceChat";

type State = "message" | "countdown" | "playing" | "over";

/** Los audios de la comunidad vienen mas fuertes que los sintetizados. */
const CLIP_GAIN = 0.8;
/** Prefijo con el que el server manda un audio de la biblioteca como `soundId`. */
const CLIP_PREFIX = "clip:";
/** Tope para leer la biblioteca antes de conectar: sin ella la sala juega igual. */
const CLIP_INDEX_TIMEOUT_MS = 3000;
/** Cuando aparece el "+N" en la tarjeta (espeja la demora de `.mt__card-sum` en el CSS). */
const CARD_SUM_DELAY_MS = 3300;

/** Fases en las que la mesa habla. En el resto suena algo que hay que escuchar o se graba. */
const CHAT_OPEN_PHASES: MtPhase[] = ["waiting", "intro", "upload", "summary", "wheel", "over"];

/** Lo que se imita en la ronda: un sintetizado o un audio de la biblioteca. */
interface RoundSound {
  id: string;
  pack: string;
  name: string;
  /** id en `imitame_clips` (solo los de la biblioteca). */
  clipId: string | null;
}

interface LoadedTake {
  buffer: AudioBuffer;
  pcm: Float32Array;
  rate: number;
  features: Features | null;
}

/** Que mueve la boca de los muñecos ahora. */
type MouthMode = { kind: "none" } | { kind: "me-rec" } | { kind: "playing"; nick: string };

/**
 * Imitame: juego SOLO de sala, clon simplificado de Mimic Party. Suena un sonido una
 * vez, todos lo imitan a la vez con la voz, cada navegador puntua su toma (melodia,
 * ritmo, golpes), despues las tomas suenan una por una para toda la sala, se ve el
 * resumen de la ronda y una ruleta reparte bonus y sabotajes para la siguiente.
 *
 * Supabase maneja lobby / marcador / rejoin (via RoomMode) y la biblioteca de audios de
 * la comunidad; las fases, el relay de las tomas, la ruleta y la senalizacion del chat de
 * voz los maneja el game server por socket.io (`/imitame`).
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
  private voice: VoiceChat | null = null;
  /** En la reproduccion, la mesa se abre mientras el jurado muestra el puntaje. */
  private revealOpen = false;

  private lastCountdownIndex = -1;
  private latest: MtState | null = null;
  private prevPhase: MtPhase | null = null;
  private prevRound = -1;
  private prevPlayKey = "";
  private playedSlot = "";
  private mouth: MouthMode = { kind: "none" };

  private sound: RoundSound | null = null;
  private ref: Features | null = null;
  private listenedRound = -1;
  private recordedRound = -1;
  private readonly takes = new Map<string, LoadedTake>();
  private readonly timers = new Set<number>();

  constructor(root: HTMLElement) {
    this.hud = new Hud(root);
    this.hud.onAudioUnlock(() => this.refreshAudioBlocked());
    this.hud.onMuteToggle(() => {
      this.voice?.toggleMute();
      this.refreshVoice();
    });
    this.hud.setMouthLevel((nick) => this.mouthLevel(nick));
    this.hud.setTalkLevel((nick) => this.voice?.level(nick) ?? 0);
    installUnlock(() => this.refreshAudioBlocked());

    this.room = initRoomMode("imitame", {
      getScore: () => this.liveScore(),
      onStart: () => this.beginCountdown(),
    });

    if (!this.room) {
      if (isRoomMode()) {
        this.hud.showMessage("No disponible", "Imitame necesita las credenciales de la sala y no estan configuradas.");
      } else if (clipsEnabled()) {
        // Fuera de una sala la pagina es la biblioteca: se escuchan y se suben audios.
        new Library(root);
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

    // El permiso del micro se pide ya: el cartel del navegador sale mientras se lee el
    // briefing y no en el medio de la primera ronda. Primero la grabadora y despues el
    // chat, en serie: con el permiso ya dado, el segundo pedido no vuelve a preguntar.
    const voice = new VoiceChat(this.room.me, (to, data) => this.transport?.sendRtc(to, data));
    this.voice = voice;
    this.micReady = this.recorder.init().then(async (ok) => {
      this.micOk = ok;
      await voice.start();
      this.refreshVoice();
      if (this.latest) this.syncVoice(this.latest);
      return ok;
    });
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
    const [url, clips] = await Promise.all([resolveGameServerUrl(), this.clipIds()]);
    this.connecting = false;
    if (this.transport || !url) return;
    const transport = new SocketTransport(url, this.room.code, this.room.me, this.room.players(), clips);
    transport.onState((s) => this.onState(s));
    transport.onTake((t) => this.onTake(t));
    transport.onGameover((r) => this.onGameover(r));
    transport.onRtc((from, data) => void this.voice?.onSignal(from, data as Signal));
    this.transport = transport;
    void transport.connect();
  }

  /** Los ids de la biblioteca, para que el server los sume al sorteo. */
  private async clipIds(): Promise<string[]> {
    const timeout = new Promise<string[]>((r) => window.setTimeout(() => r([]), CLIP_INDEX_TIMEOUT_MS));
    const index = fetchClipIndex().then((list) => list.map((c) => c.id));
    return Promise.race([index, timeout]);
  }

  private onState(s: MtState): void {
    this.latest = s;
    // El chat anda desde que hay conexion, aunque todavia corra el countdown.
    this.syncVoice(s);
    if (this.state === "playing") this.applyState(s);
  }

  private get me(): string {
    return this.room?.me ?? "";
  }

  private isSeat(s: MtState): boolean {
    return s.players.some((p) => p.nickname === this.me);
  }

  private applyState(s: MtState): void {
    if (s.soundId !== this.sound?.id) this.setSound(s.soundId);
    this.hud.setPhase(s.phase);
    this.hud.setRound(s.phase === "waiting" ? "" : `Ronda ${Math.min(s.round + 1, s.totalRounds)}/${s.totalRounds}`);
    this.hud.setClock(s.clockMs, s.clockTotalMs);
    this.hud.setPlayers(s.players, this.me);

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
    if (s.phase === "upload") {
      const done = s.players.filter((p) => p.submitted).length;
      this.hud.setText(`Tomas recibidas ${done}/${s.players.length}`, "Esperando las tomas", "Ya pueden hablar.");
    }
    this.syncVoice(s);
  }

  // ---------- Chat de voz ----------

  private syncVoice(s: MtState): void {
    if (!this.voice) return;
    this.voice.syncPeers(s.players.filter((p) => p.connected).map((p) => p.nickname));
    const open = CHAT_OPEN_PHASES.includes(s.phase) || (s.phase === "playback" && this.revealOpen);
    this.voice.setOpen(open);
    this.refreshVoice();
  }

  private refreshVoice(): void {
    const v = this.voice;
    const open = this.latest
      ? CHAT_OPEN_PHASES.includes(this.latest.phase) || (this.latest.phase === "playback" && this.revealOpen)
      : true;
    this.hud.setVoice(!!v?.hasMic, v?.isMuted ?? false, open);
  }

  private setRevealOpen(open: boolean): void {
    this.revealOpen = open;
    if (this.latest) this.syncVoice(this.latest);
  }

  private mouthLevel(nick: string): number {
    const m = this.mouth;
    if (m.kind === "me-rec") return nick === this.me ? this.recorder.level : 0;
    if (m.kind === "playing") return nick === m.nick ? outputLevel() : 0;
    return 0;
  }

  // ---------- Sonido de la ronda ----------

  /**
   * Los sintetizados traen su referencia en la definicion; la de un audio de la
   * biblioteca sale de analizar el audio, que se baja al entrar la ronda (el `intro` le
   * da 5s de margen). Recien ahi se sabe su nombre.
   */
  private setSound(soundId: string | null): void {
    this.ref = null;
    if (!soundId) {
      this.sound = null;
      return;
    }
    if (!soundId.startsWith(CLIP_PREFIX)) {
      const synth = soundById(soundId);
      this.sound = synth ? { id: synth.id, pack: synth.pack, name: synth.name, clipId: null } : null;
      this.ref = synth ? featuresFromSound(synth) : null;
      return;
    }
    const clipId = soundId.slice(CLIP_PREFIX.length);
    const sound: RoundSound = { id: soundId, pack: "Comunidad", name: "...", clipId };
    this.sound = sound;
    void loadClip(clipId).then((clip) => {
      if (this.sound !== sound) return;
      if (!clip) {
        sound.name = "Audio no disponible";
        return;
      }
      sound.name = clip.meta.name;
      sound.pack = `Comunidad / subido por ${clip.meta.uploader}`;
      this.ref = clip.features;
      if (this.latest?.phase === "intro") this.onPhaseChange(this.latest);
    });
  }

  private playReference(sound: RoundSound, round: number): void {
    if (!sound.clipId) {
      const synth = soundById(sound.id);
      if (synth) this.hud.traceListen(this.ref, playSound(synth));
      return;
    }
    void loadClip(sound.clipId).then((clip) => {
      if (this.latest?.phase !== "listen" || this.latest.round !== round) return;
      if (!clip) {
        this.hud.setText("Audio no disponible", sound.name, "No se pudo bajar el audio. Esta ronda no suma.");
        return;
      }
      this.hud.traceListen(clip.features, playBuffer(clip.buffer, CLIP_GAIN));
    });
  }

  // ---------- Fases ----------

  private onPhaseChange(s: MtState): void {
    const sound = this.sound;
    switch (s.phase) {
      case "waiting":
        this.hud.setText("Imitame", "Esperando a la sala...", "");
        break;
      case "intro": {
        this.clearTimers();
        this.resetStage();
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
        this.playReference(sound, s.round);
        break;
      case "ready":
        this.hud.setText("Preparate", sound?.name ?? "", "Cuando diga YA, imitalo.");
        this.hud.setMic("all");
        this.readyCountdown(s);
        break;
      case "record":
        this.hud.showCountdown("YA");
        this.later(() => this.hud.showCountdown(null), 700);
        this.startRecording(s);
        break;
      case "upload":
        this.mouth = { kind: "none" };
        this.hud.setMic(null);
        break;
      case "playback":
        break;
      case "summary":
        this.resetStage();
        this.hud.setText("Resumen de la ronda", "Cuanto sumo cada uno", "");
        this.hud.showSummary(s.results ?? [], s.players, this.me);
        break;
      case "wheel":
        this.resetStage();
        this.spinWheel(s);
        break;
      case "over":
        this.resetStage();
        this.hud.setText("Fin", "Se termino el show", "");
        break;
    }
  }

  /** Limpia todo lo de la fase anterior: tarjeta, resumen, ruleta, micro, foco. */
  private resetStage(): void {
    this.mouth = { kind: "none" };
    this.hud.clearCard();
    this.hud.clearSummary();
    this.hud.hideWheel();
    this.hud.traceClear();
    this.hud.setMic(null);
    this.hud.setFocus(null);
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
      this.hud.setMic("all", true);
      this.mouth = { kind: "me-rec" };
      this.hud.traceRecord(RECORD_MS);
      this.recorder.start((frame) => this.hud.pushLive(frame));
      this.later(() => this.finishRecording(round), RECORD_MS);
    });
  }

  private finishRecording(round: number): void {
    const pcm = this.recorder.stop();
    SoundEffects.playRecStop();
    this.mouth = { kind: "none" };
    this.hud.setMic(null);
    const rate = this.recorder.rate;
    const feats = featuresFromFrames(analyzeTake(pcm, rate));
    const b = this.ref ? scoreTake(this.ref, feats) : { attacks: 0, rhythm: 0, melody: 0, raw: 0 };
    this.hud.setText("Tu toma", this.sound?.name ?? "", "Esperando a los demas...");
    this.hud.showCard(
      {
        who: "Tu toma",
        raw: b.raw,
        mult: null,
        points: null,
        attacks: b.attacks,
        rhythm: b.rhythm,
        melody: b.melody,
        pitched: this.hasPitch(),
        hasTake: !feats.silent,
      },
      true,
    );
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
      this.startTake(s);
    }
  }

  /**
   * Un turno de la reproduccion, con aire entre cada cosa: el micro vuela a la cara del
   * que le toca (`PRE_SLOT_MS`), suena su toma con la mesa en silencio, y despues el
   * jurado arma la tarjeta de a poco mientras la mesa ya puede hablar; al final salta el
   * "+N" sobre su cabeza.
   */
  private playSlot(s: MtState): void {
    const nick = s.playOrder?.[s.playIndex];
    if (!nick) return;
    const result = s.results?.find((r) => r.nickname === nick) ?? null;
    const effect = s.players.find((p) => p.nickname === nick)?.effect ?? null;
    const kicker = `Toma ${s.playIndex + 1} de ${s.playOrder?.length ?? 0}`;
    const who = nick === this.me ? "Vos" : nick;
    this.clearTimers();
    this.hud.clearCard();
    this.hud.traceClear();
    this.hud.setFocus(nick);
    this.hud.setMic(nick);
    this.mouth = { kind: "none" };
    this.setRevealOpen(false);
    this.hud.setText(kicker, `Le toca a ${who}`, effect ? `Con ${EFFECTS[effect].label} (x${EFFECTS[effect].mult})` : "");

    if (!result?.hasTake) {
      this.later(() => {
        this.hud.setText(kicker, who, "No grabo nada.");
        this.hud.showCard({ who, raw: 0, mult: null, points: 0, attacks: 0, rhythm: 0, melody: 0, pitched: false, hasTake: false });
        this.setRevealOpen(true);
      }, PRE_SLOT_MS);
      return;
    }
    this.later(() => this.startTake(s), PRE_SLOT_MS);
  }

  private startTake(s: MtState): void {
    const nick = s.playOrder?.[s.playIndex];
    if (!nick || this.latest?.playIndex !== s.playIndex || this.latest.phase !== "playback") return;
    const slotKey = `${s.round}|${s.playIndex}`;
    const take = this.takes.get(`${s.round}|${nick}`);
    if (!take || this.playedSlot === slotKey) return; // todavia no llego: onTake la dispara
    this.playedSlot = slotKey;

    const result = s.results?.find((r) => r.nickname === nick) ?? null;
    const effect = s.players.find((p) => p.nickname === nick)?.effect ?? null;
    const who = nick === this.me ? "Vos" : nick;
    if (!take.features) take.features = featuresFromFrames(analyzeTake(take.pcm, take.rate));
    if (this.ref) this.hud.traceCompare(this.ref, take.features);
    this.mouth = { kind: "playing", nick };
    playTake(take.buffer, effect);
    const dur = playbackDuration(take.buffer, effect);

    this.later(() => {
      this.mouth = { kind: "none" };
      if (!result) return;
      this.setRevealOpen(true);
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
      this.later(() => {
        SoundEffects.playScore(result.raw);
        this.hud.popPoints(nick, result.points, result.mult);
      }, CARD_SUM_DELAY_MS);
    }, dur * 1000 + 200);
  }

  // ---------- Ruleta ----------

  private spinWheel(s: MtState): void {
    const w = s.wheel;
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
    // Puntaje placement-based (mayor = mejor), como Basta.
    // El puesto va aparte al ranking global, que en este juego cuenta victorias
    // (el que no figura en el ranking, p.ej. entro tarde, no suma).
    if (this.room) {
      this.room.reportScore(
        Math.max(0, result.ranking.length - place),
        mine ? { place, players: result.ranking.length } : { ranked: false },
      );
    }
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
