import { initRoomMode, isRoomMode, type RoomMode } from "../../../shared/room/roomMode";
import { isGameServerConfigured, resolveGameServerUrl } from "../../../shared/server-status";
import {
  CLOCK_DRIFT_RATE,
  COUNTDOWN_LABELS,
  COUNTDOWN_STEP,
  HEAT_HOT,
  KEY_TO_ARROW,
  PENDING_TIMEOUT_MS,
  PING_EVERY_MS,
  type Arrow,
} from "./constants";
import type { HpGameover, HpRejectReason, HpState } from "./HotPotatoProtocol";
import { Hud } from "./Hud";
import { SocketTransport } from "./SocketTransport";
import { SoundEffects } from "./SoundEffects";

/** Minimo de la mecha si el server es anterior a `fuseMinMs` (espeja `FUSE_MIN_MS`). */
const FUSE_MIN_FALLBACK_MS = 9000;

type State = "message" | "countdown" | "playing" | "over";

const REJECT_MESSAGES: Partial<Record<HpRejectReason, string>> = {
  "bad-target": "no se la podes pasar a ese",
  "not-holder": "ya no la tenias",
  stale: "ya no la tenias",
};

/**
 * Papa Caliente: juego SOLO de sala. Supabase maneja lobby / marcador / rejoin (via
 * RoomMode); la partida (quien tiene la papa, la mecha secreta, las eliminaciones)
 * la arbitra el game server por socket.io.
 *
 * Todo lo que toca el jugador responde sin esperar a la red:
 *  - La secuencia de flechas se resuelve aca, tecla por tecla. Solo viaja el pase
 *    terminado.
 *  - El pase es OPTIMISTA: la papa sale volando en el acto. Se confirma cuando el
 *    estado del server avanza la posesion (`n`), y se revierte si llega `hp:reject`.
 *  - El pase lleva `at`, la hora del server que este cliente veia al completarlo
 *    (reloj local menos `clockOffset`). El server lo usa para compensar la latencia.
 */
export class Game {
  private readonly hud: Hud;
  private state: State = "message";

  private readonly room: RoomMode | null;
  private transport: SocketTransport | null = null;
  private connecting = false;
  private lastCountdownIndex = -1;

  private latest: HpState | null = null;
  /** `performance.now() = horaServer + clockOffset`. Estimado con el minimo de
   *  (llegada - t): la muestra que menos jitter comio. Incluye la media vuelta de
   *  bajada, asi que `serverNow()` es la hora del server *que este cliente ve*, que
   *  es exactamente lo que el server quiere en el `at` del pase. */
  private clockOffset: number | null = null;

  /** Pase enviado y todavia sin confirmar. */
  private pending: { n: number; to: string; since: number } | null = null;
  /** Flechas acertadas de la secuencia de la posesion `progressN`. */
  private progress = 0;
  private progressN = -1;
  /** Destino elegido a mano (se puede elegir antes de tener la papa). */
  private chosenTarget: string | null = null;

  /** Lo ultimo ya anunciado (sonido / animacion), para no repetirlo. */
  private seenPassN = -1;
  private seenBoomK = -1;
  private seenBurnStart: number | null = null;

  private raf: number | null = null;
  private lastTickAt = 0;

  constructor(root: HTMLElement) {
    this.hud = new Hud(root);
    this.hud.onArrow((a) => this.onArrow(a));
    this.hud.onPick((nick) => this.pickTarget(nick));

    window.addEventListener("keydown", (e) => {
      if (this.state !== "playing" || e.ctrlKey || e.altKey || e.metaKey) return;
      const arrow = KEY_TO_ARROW.get(e.key);
      if (arrow) {
        e.preventDefault();
        if (!e.repeat) this.onArrow(arrow);
        return;
      }
      if (e.key === "q" || e.key === "Q") this.cycleTarget(-1);
      else if (e.key === "e" || e.key === "E") this.cycleTarget(1);
    });

    this.room = initRoomMode("hot-potato", {
      getScore: () => this.liveScore(),
      onStart: () => this.beginCountdown(),
    });

    if (!this.room) {
      if (isRoomMode()) {
        this.hud.showMessage(
          "No disponible",
          "Papa Caliente necesita las credenciales de la sala y no estan configuradas.",
        );
      } else {
        this.hud.showMessage(
          "Solo en salas",
          "Papa Caliente se juega con amigos en una sala. Cre&aacute; o un&iacute;te a una para jugar.",
          { label: "Ir a las salas", onClick: () => (window.location.href = "/rooms/") },
        );
      }
      return;
    }

    if (!isGameServerConfigured()) {
      this.hud.showMessage(
        "No disponible",
        "Papa Caliente necesita el game server y no est&aacute; configurado (VITE_GAME_SERVER_URL).",
      );
      return;
    }

    // No se conecta hasta el countdown: el server arranca la partida apenas estan
    // todos conectados, y conectar durante el briefing la largaria con la gente
    // todavia leyendo. El offset de reloj se asienta en el preroll (ver transport).
    this.hud.showMessage("Papa Caliente", "Esper&aacute; a que empiece la ronda...");
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
    if (this.latest) this.apply(this.latest);
    this.loop();
  }

  // ---------- Transporte ----------

  private async connect(): Promise<void> {
    if (this.transport || this.connecting || !this.room) return;
    this.connecting = true;
    const url = await resolveGameServerUrl();
    this.connecting = false;
    if (this.transport || !url) return;
    const transport = new SocketTransport(
      url,
      this.room.code,
      this.room.me,
      this.room.players(),
      this.room.round(),
      PING_EVERY_MS,
    );
    transport.onState((s) => this.onState(s));
    transport.onReject((n, r) => this.onReject(n, r));
    transport.onPong((c, t) => {
      this.clockSample(t);
      this.hud.setPing(Math.round(performance.now() - c));
    });
    transport.onGameover((r) => this.onGameover(r));
    this.transport = transport;
    void transport.connect();
  }

  private clockSample(serverT: number): void {
    const sample = performance.now() - serverT;
    if (this.clockOffset === null || sample < this.clockOffset) this.clockOffset = sample;
    else this.clockOffset += (sample - this.clockOffset) * CLOCK_DRIFT_RATE;
  }

  /** Hora del server que este cliente ve ahora (epoch ms). */
  private serverNow(): number {
    return this.clockOffset === null ? Date.now() : performance.now() - this.clockOffset;
  }

  private onState(s: HpState): void {
    this.clockSample(s.t);
    if (this.state === "playing") this.apply(s);
    else this.latest = s;
  }

  private apply(s: HpState): void {
    const me = this.room?.me ?? "";
    const first = this.seenPassN < 0;
    this.latest = s;

    // El pase propio se resolvio (aceptado o no, la posesion avanzo) o exploto.
    if (this.pending && (s.n > this.pending.n || s.phase !== "burning")) this.pending = null;
    if (s.n !== this.progressN) {
      this.progressN = s.n;
      this.progress = 0;
    }

    if (first) {
      // Primer estado visto (o vuelta de un F5): se toma como punto de partida sin
      // re-anunciar pases ni explosiones viejas.
      this.seenPassN = s.lastPass?.n ?? 0;
      this.seenBoomK = s.lastBoom?.k ?? 0;
      this.seenBurnStart = s.burnStart;
    } else {
      if (s.lastBoom && s.lastBoom.k > this.seenBoomK) {
        this.seenBoomK = s.lastBoom.k;
        SoundEffects.playBoom();
        this.hud.boom(s.lastBoom.player);
      }
      if (s.phase === "burning" && s.burnStart !== this.seenBurnStart) {
        this.seenBurnStart = s.burnStart;
        SoundEffects.playBell();
        if (s.holder === me) SoundEffects.playCatch();
      }
      if (s.lastPass && s.lastPass.n > this.seenPassN) {
        this.seenPassN = s.lastPass.n;
        // El propio ya sono al mandarlo (optimista).
        if (s.lastPass.from !== me) SoundEffects.playPass();
        if (s.lastPass.to === me) SoundEffects.playCatch();
      }
    }
    this.render();
  }

  private onReject(n: number, reason: HpRejectReason): void {
    if (!this.pending || this.pending.n !== n) return;
    this.pending = null;
    this.progress = 0;
    // "late": la mecha vencio antes; la explosion llega enseguida y lo cuenta sola.
    const msg = REJECT_MESSAGES[reason];
    if (msg) this.hud.flashNote(msg);
    this.render();
  }

  // ---------- Input ----------

  /** Tengo la papa, esta en juego, y no hay un pase mio en vuelo. */
  private canAct(): boolean {
    const s = this.latest;
    return (
      this.state === "playing" &&
      !!s &&
      s.phase === "burning" &&
      s.holder === this.room?.me &&
      this.pending === null
    );
  }

  private onArrow(a: Arrow): void {
    this.hud.pressPad(a);
    if (!this.canAct() || !this.latest) return;
    const seq = this.latest.seq;
    if (seq[this.progress] === a) {
      this.progress += 1;
      SoundEffects.playKey(this.progress);
      if (this.progress >= seq.length) this.doPass();
      else this.hud.setSeq(seq, this.progress);
    } else {
      this.progress = 0;
      SoundEffects.playWrong();
      this.hud.wrong();
      this.hud.setSeq(seq, 0);
    }
  }

  private doPass(): void {
    const s = this.latest;
    const to = this.resolveTarget();
    if (!s || !to || !this.transport) return;
    this.pending = { n: s.n, to, since: performance.now() };
    this.transport.pass(s.n, to, s.seq, Math.round(this.serverNow()));
    SoundEffects.playPass();
    this.render();
  }

  /** A quien se le puede pasar ahora: vivos, no yo, y no el que me la paso (salvo
   *  en el mano a mano). Espeja `validTargets` del server. */
  private validTargets(): string[] {
    const s = this.latest;
    const me = this.room?.me ?? "";
    if (!s) return [];
    const alive = s.players.filter((p) => p.alive && p.nickname !== me).map((p) => p.nickname);
    if (alive.length <= 1 || s.holder !== me) return alive;
    return alive.filter((p) => p !== s.from);
  }

  /** El elegido a mano si sigue siendo valido; si no, el primero valido en sentido
   *  horario (espeja `defaultTarget` del server). */
  private resolveTarget(): string | null {
    const valid = this.validTargets();
    if (this.chosenTarget && valid.includes(this.chosenTarget)) return this.chosenTarget;
    const s = this.latest;
    const me = this.room?.me ?? "";
    if (!s) return null;
    const idx = s.players.findIndex((p) => p.nickname === me);
    for (let i = 1; i <= s.players.length; i++) {
      const p = s.players[(idx + i) % s.players.length];
      if (valid.includes(p.nickname)) return p.nickname;
    }
    return null;
  }

  private pickTarget(nick: string): void {
    if (this.state !== "playing" || nick === this.room?.me) return;
    if (!this.latest?.players.some((p) => p.nickname === nick && p.alive)) return;
    this.chosenTarget = nick;
    this.render();
  }

  /** Q / E: mueve el destino al valido anterior / siguiente del circulo. */
  private cycleTarget(dir: 1 | -1): void {
    const s = this.latest;
    if (!s) return;
    const valid = new Set(this.validTargets());
    const order = s.players.map((p) => p.nickname);
    const cur = this.resolveTarget();
    let idx = cur ? order.indexOf(cur) : order.indexOf(this.room?.me ?? "");
    for (let i = 0; i < order.length; i++) {
      idx = (idx + dir + order.length) % order.length;
      if (valid.has(order[idx])) {
        this.chosenTarget = order[idx];
        this.render();
        return;
      }
    }
  }

  // ---------- Render / loop ----------

  private render(): void {
    const s = this.latest;
    if (!s || this.state !== "playing") return;
    const me = this.room?.me ?? "";
    const holder = this.pending ? this.pending.to : s.holder;
    const act = this.canAct();
    const valid = new Set(this.validTargets());
    const target = this.resolveTarget();
    const amIn = s.players.some((p) => p.nickname === me && p.alive);

    this.hud.render({
      players: s.players.map((p) => ({
        nickname: p.nickname,
        alive: p.alive,
        connected: p.connected,
        isMe: p.nickname === me,
        isHolder: s.phase === "burning" && p.nickname === holder,
        isTarget: amIn && s.phase === "burning" && p.nickname === target,
        targetable: amIn && valid.has(p.nickname),
      })),
      holder: s.phase === "burning" ? holder : null,
      status: this.statusText(s, holder),
      mine: act,
    });
    this.hud.setSeq(act ? s.seq : "", this.progress);
    this.hud.setPadEnabled(act);
  }

  private statusText(s: HpState, holder: string | null): { big: string; small: string } {
    const me = this.room?.me ?? "";
    switch (s.phase) {
      case "waiting":
        return { big: "Papa Caliente", small: "esperando a los concursantes" };
      case "pause":
        if (s.lastBoom) {
          const who = s.lastBoom.player === me ? "Quedaste" : `${s.lastBoom.player} queda`;
          return { big: "BOOM", small: `${who} afuera` };
        }
        return { big: "Preparados", small: "ya sale la papa" };
      case "burning":
        if (this.pending) return { big: "Volando", small: `para ${this.pending.to}` };
        if (holder === me) return { big: "Pasala", small: `para ${this.resolveTarget() ?? "..."}` };
        return { big: holder ?? "", small: "tiene la papa" };
      case "over":
        return { big: "Fin", small: "" };
    }
  }

  /** Termometro, tic-tac y el vencimiento del pase optimista. */
  private loop = (): void => {
    this.raf = null;
    if (this.state !== "playing") return;
    const s = this.latest;
    const now = performance.now();

    if (this.pending && now - this.pending.since > PENDING_TIMEOUT_MS) {
      this.pending = null;
      this.progress = 0;
      this.render();
    }

    if (s && s.phase === "burning" && s.burnStart !== null) {
      // El calor es publico (tiempo desde que salio la papa contra el tope de la
      // mecha): no delata la mecha real, que es secreta y puede ser mucho mas corta.
      const elapsed = this.serverNow() - s.burnStart;
      const heat = Math.min(1, Math.max(0, elapsed / s.fuseMaxMs));
      this.hud.setHeat(heat);
      const minMs = s.fuseMinMs ?? FUSE_MIN_FALLBACK_MS;
      this.hud.setFuseWindow(minMs, s.fuseMaxMs);
      this.hud.setRisk(Math.max(0, elapsed), minMs, s.fuseMaxMs);
      const every = 650 - 470 * heat;
      if (now - this.lastTickAt >= every) {
        this.lastTickAt = now;
        SoundEffects.playTick(heat >= HEAT_HOT);
      }
    } else {
      this.hud.setHeat(0);
      this.hud.setRisk(null, 0, 0);
    }
    this.raf = requestAnimationFrame(this.loop);
  };

  // ---------- Fin ----------

  private onGameover(result: HpGameover): void {
    if (this.state === "over") return;
    this.state = "over";
    if (this.raf !== null) cancelAnimationFrame(this.raf);
    this.raf = null;
    this.hud.setPadEnabled(false);
    this.hud.setHeat(0);

    const me = this.room?.me ?? "";
    const mine = result.ranking.find((r) => r.nickname === me);
    const place = mine?.place ?? result.ranking.length;
    if (place === 1) SoundEffects.playWin();
    else SoundEffects.playLose();

    // Puntaje por puesto (mayor = mejor): sobrevivir mas suma mas.
    // El puesto va aparte al ranking global, que en este juego cuenta victorias
    // (el que no figura en el ranking, p.ej. entro tarde, no suma).
    if (this.room) {
      this.room.reportScore(
        Math.max(0, result.ranking.length - place),
        mine ? { place, players: result.ranking.length } : { ranked: false },
      );
    }
  }

  /** Parcial para el corte por tiempo de la sala (no hay: la partida siempre
   *  termina sola). Proxy: cuantos ya quedaron afuera. */
  private liveScore(): number {
    if (!this.latest) return 0;
    return this.latest.players.filter((p) => !p.alive).length;
  }
}
