import type { HowToAction } from "../../shared/howto";
import { renderHowTo } from "../../shared/howtoView";
import type { BriefingView, FinalView, ResultsView, TotalEntry, VotingView } from "../../shared/room/RoomOverlay";
import type { HubLobbyView } from "../../shared/room/roomMode";
import { TOTAL_ROUNDS_OPTIONS } from "../../shared/room/types";
import { EMOTES } from "./constants";
import { drawEmoteFace } from "./textures";

/** Carita de una reaccion en un canvas (botones del HUD y el cartel propio). */
function faceCanvas(id: string, size: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = c.height = size * 2;
  c.style.width = c.style.height = `${size}px`;
  drawEmoteFace(c.getContext("2d")!, id, size * 2);
  return c;
}
import type { JoystickView } from "./InputController";

type Action = { label: string; onClick: () => void; primary?: boolean; disabled?: boolean };

/** Controles de la feria en la compu (la tira de abajo). */
const CONTROLS: HowToAction[] = [
  { title: "Caminar", icons: ["wasd"] },
  { title: "Mirar", icons: ["mouse"] },
  { title: "Saltar", icons: ["space"] },
  { title: "Reacciones", icons: ["keys:1 2 3 4 5"] },
  { title: "Soltar mouse", icons: ["esc"] },
];

/**
 * HUD de La Feria: la pantalla de una videocasetera (DESIGN.md, "Cinta Gastada"):
 * letra de monitor, texto claro sobre negro translucido y un REC rojo. Una barra
 * arriba (REC + sala, fase, reloj, corona de la torre), un panel con la fase de la
 * sala (lobby, votacion, briefing, resultados, final) que nunca tapa el medio de la
 * pantalla, el cronometro de la torre, anuncios, y en el celu SALTAR y reacciones.
 *
 * Cada vista se reconstruye solo si cambio lo que muestra (se la llama en cada
 * sync de la sala): la clave es el JSON de sus datos.
 */
export class Hud {
  private readonly root: HTMLDivElement;
  private readonly topCode: HTMLSpanElement;
  private readonly topPhase: HTMLSpanElement;
  private readonly topClock: HTMLSpanElement;
  private readonly topCrown: HTMLSpanElement;
  private readonly runEl: HTMLDivElement;
  private readonly announceEl: HTMLDivElement;
  private announceTimer = 0;
  private readonly panel: HTMLDivElement;
  private readonly panelBody: HTMLDivElement;
  private readonly panelHead: HTMLButtonElement;
  private readonly notice: HTMLDivElement;
  private readonly stick: HTMLDivElement;
  private readonly knob: HTMLDivElement;
  private readonly jumpBtn: HTMLButtonElement;
  private readonly emotes: HTMLDivElement;
  private readonly crosshair: HTMLDivElement;
  private readonly lockHint: HTMLDivElement;
  private readonly flashEl: HTMLDivElement;
  private flashTimer = 0;
  private viewKey = "";
  private collapsed = false;
  private jumpCb: () => void = () => {};
  private emoteCb: (i: number) => void = () => {};

  constructor(container: HTMLElement) {
    this.root = document.createElement("div");
    this.root.className = "isl-hud";

    const top = document.createElement("div");
    top.className = "isl-top";
    const rec = document.createElement("span");
    rec.className = "isl-top__rec";
    rec.textContent = "REC";
    this.topCode = document.createElement("span");
    this.topCode.className = "isl-top__code";
    this.topPhase = document.createElement("span");
    this.topPhase.className = "isl-top__phase";
    this.topClock = document.createElement("span");
    this.topClock.className = "isl-top__clock";
    this.topCrown = document.createElement("span");
    this.topCrown.className = "isl-top__crown";
    const home = document.createElement("a");
    home.className = "isl-top__home";
    home.href = "/";
    home.textContent = "Menu";
    top.append(rec, this.topCode, this.topPhase, this.topCrown, this.topClock, home);

    this.runEl = document.createElement("div");
    this.runEl.className = "isl-run";
    this.runEl.style.display = "none";
    this.announceEl = document.createElement("div");
    this.announceEl.className = "isl-announce";

    this.panel = document.createElement("div");
    this.panel.className = "isl-panel";
    this.panel.style.display = "none";
    this.panelHead = document.createElement("button");
    this.panelHead.type = "button";
    this.panelHead.className = "isl-panel__toggle";
    this.panelHead.textContent = "Ocultar";
    this.panelHead.addEventListener("click", () => this.setCollapsed(!this.collapsed));
    this.panelBody = document.createElement("div");
    this.panelBody.className = "isl-panel__body";
    this.panel.append(this.panelHead, this.panelBody);

    this.notice = document.createElement("div");
    this.notice.className = "isl-notice";
    this.notice.style.display = "none";

    this.stick = document.createElement("div");
    this.stick.className = "isl-stick";
    this.knob = document.createElement("div");
    this.knob.className = "isl-stick__knob";
    this.stick.append(this.knob);

    const controls = document.createElement("div");
    controls.className = "isl-controls";
    this.jumpBtn = document.createElement("button");
    this.jumpBtn.type = "button";
    this.jumpBtn.className = "isl-jump";
    this.jumpBtn.textContent = "SALTAR";
    this.jumpBtn.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      this.jumpCb();
    });
    controls.append(this.jumpBtn);

    this.emotes = document.createElement("div");
    this.emotes.className = "isl-emotes";
    EMOTES.forEach((emote, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "isl-emote";
      b.title = `${emote.label} (${i + 1})`;
      b.append(faceCanvas(emote.id, 40));
      const k = document.createElement("kbd");
      k.textContent = String(i + 1);
      b.append(k);
      b.addEventListener("click", () => this.emoteCb(i));
      this.emotes.append(b);
    });

    // Controles con los mismos iconos del briefing de las salas (src/shared/howto.ts),
    // en una tira abajo. Solo en la compu: en el celu estan los botones en pantalla.
    const hint = document.createElement("div");
    hint.className = "isl-hint";
    hint.append(renderHowTo({ intro: "", actions: CONTROLS }, { intro: false, compact: true }));

    // Mira del centro: se agranda cuando apunta a algo que se puede tocar.
    this.crosshair = document.createElement("div");
    this.crosshair.className = "isl-crosshair";

    this.lockHint = document.createElement("div");
    this.lockHint.className = "isl-lockhint";
    this.lockHint.textContent = "Hace clic en la feria para mirar con el mouse";

    // Tus reacciones: en primera persona no ves tu propio globo.
    this.flashEl = document.createElement("div");
    this.flashEl.className = "isl-flash";

    this.root.append(
      top,
      this.panel,
      this.notice,
      this.stick,
      controls,
      this.emotes,
      hint,
      this.crosshair,
      this.lockHint,
      this.flashEl,
      this.runEl,
      this.announceEl,
    );
    container.append(this.root);
  }

  onJump(cb: () => void): void {
    this.jumpCb = cb;
  }

  onEmote(cb: (i: number) => void): void {
    this.emoteCb = cb;
  }

  /** Cronometro de la torre (null lo oculta). */
  setRun(text: string | null): void {
    this.runEl.style.display = text ? "" : "none";
    this.runEl.textContent = text ?? "";
  }

  /** Record de la torre en la barra: quien tiene la corona (resaltado si sos vos). */
  setRecord(text: string | null, mine: boolean): void {
    this.topCrown.textContent = text ? `Corona: ${text}` : "";
    this.topCrown.classList.toggle("is-mine", mine);
  }

  /** Anuncio arriba al medio (llegadas a la cima, cambios de corona). */
  announce(text: string): void {
    this.announceEl.textContent = text;
    this.announceEl.classList.add("is-on");
    window.clearTimeout(this.announceTimer);
    this.announceTimer = window.setTimeout(() => this.announceEl.classList.remove("is-on"), 3500);
  }

  setTop(code: string, phase: string): void {
    this.topCode.textContent = code ? `SALA ${code}` : "LA FERIA";
    this.topPhase.textContent = phase;
  }

  setClock(text: string | null): void {
    this.topClock.textContent = text ?? "";
  }

  setNotice(text: string | null): void {
    this.notice.style.display = text ? "" : "none";
    this.notice.textContent = text ?? "";
  }

  setJoystick(view: JoystickView | null): void {
    if (!view) {
      this.stick.style.display = "none";
      return;
    }
    this.stick.style.display = "block";
    this.stick.style.left = `${view.originX}px`;
    this.stick.style.top = `${view.originY}px`;
    const dx = view.x - view.originX;
    const dy = view.y - view.originY;
    const len = Math.hypot(dx, dy);
    const k = len > 52 ? 52 / len : 1;
    this.knob.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
  }

  /** Mira del centro: `locked` = mouse capturado; `target` = apunta a algo tocable. */
  setAim(locked: boolean, target: boolean): void {
    this.crosshair.classList.toggle("is-locked", locked);
    this.crosshair.classList.toggle("is-target", target);
    this.lockHint.classList.toggle("is-hidden", locked);
  }

  /** Reaccion propia: la carita y su nombre en pantalla (en primera persona no te ves). */
  flashEmote(id: string, label: string): void {
    this.flash(label);
    this.flashEl.prepend(faceCanvas(id, 34));
  }

  flash(text: string): void {
    this.flashEl.textContent = text;
    this.flashEl.classList.remove("is-on");
    void this.flashEl.offsetWidth;
    this.flashEl.classList.add("is-on");
    window.clearTimeout(this.flashTimer);
    this.flashTimer = window.setTimeout(() => this.flashEl.classList.remove("is-on"), 1800);
  }

  hidePanel(): void {
    this.panel.style.display = "none";
    this.viewKey = "";
  }

  private setCollapsed(c: boolean): void {
    this.collapsed = c;
    this.panel.classList.toggle("is-collapsed", c);
    this.panelHead.textContent = c ? "Mostrar" : "Ocultar";
  }

  /** Arranca una vista nueva si la clave cambio; false = ya esta montada igual. */
  private begin(key: string): boolean {
    this.panel.style.display = "";
    if (key === this.viewKey) return false;
    this.viewKey = key;
    this.panelBody.textContent = "";
    return true;
  }

  // ---------- Bloques ----------

  private el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
    const e = document.createElement(tag);
    e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  private heading(kicker: string, title: string): void {
    this.panelBody.append(this.el("div", "isl-kicker", kicker), this.el("div", "isl-title", title));
  }

  private text(t: string, cls = "isl-text"): void {
    this.panelBody.append(this.el("p", cls, t));
  }

  private actions(list: Action[]): void {
    const row = this.el("div", "isl-actions");
    for (const a of list) {
      const b = this.el("button", a.primary ? "isl-btn isl-btn--primary" : "isl-btn", a.label);
      b.type = "button";
      b.disabled = a.disabled ?? false;
      b.addEventListener("click", () => {
        // Contra el doble clic. Se rehabilita solo: si la accion fallo, la vista
        // no cambia y el boton no puede quedar muerto.
        b.disabled = true;
        window.setTimeout(() => (b.disabled = a.disabled ?? false), 2500);
        a.onClick();
      });
      row.append(b);
    }
    this.panelBody.append(row);
  }

  private list(rows: { left: string; name: string; right: string; small?: string; me?: boolean; dim?: boolean }[]): HTMLUListElement {
    const ul = this.el("ul", "isl-list");
    for (const r of rows) {
      const li = this.el("li", "isl-row" + (r.me ? " is-me" : "") + (r.dim ? " is-dim" : ""));
      li.append(this.el("span", "isl-row__rank", r.left), this.el("span", "isl-row__name", r.name));
      const right = this.el("span", "isl-row__value", r.right);
      if (r.small) right.append(this.el("small", "", r.small));
      li.append(right);
      ul.append(li);
    }
    this.panelBody.append(ul);
    return ul;
  }

  private totals(totals: TotalEntry[], me: string, title = "Tabla general"): void {
    if (totals.length === 0) return;
    this.panelBody.append(this.el("div", "isl-sub", title));
    this.list(totals.map((t) => ({ left: String(t.rank), name: t.player, right: `${t.points} pts`, me: t.player === me })));
  }

  // ---------- Vistas ----------

  showMessage(kicker: string, title: string, text: string, action?: Action): void {
    if (!this.begin(JSON.stringify(["msg", kicker, title, text, action?.label]))) return;
    this.heading(kicker, title);
    this.text(text);
    if (action) this.actions([action]);
  }

  showLobby(view: HubLobbyView, look: { name: string; next: () => void }): void {
    const key = JSON.stringify([
      "lobby",
      view.players,
      view.present,
      view.host,
      view.totalRounds,
      view.canStart,
      !!view.onStart,
      look.name,
    ]);
    if (!this.begin(key)) return;
    this.heading("La Feria", "Sala " + view.code);

    const copy = this.el("button", "isl-btn isl-btn--small", "Copiar link");
    copy.type = "button";
    copy.addEventListener("click", () => {
      void navigator.clipboard?.writeText(`${location.origin}/rooms/?code=${view.code}`).then(() => {
        copy.textContent = "Copiado";
        window.setTimeout(() => (copy.textContent = "Copiar link"), 1500);
      });
    });
    const lookBtn = this.el("button", "isl-btn isl-btn--small", look.name);
    lookBtn.type = "button";
    lookBtn.title = "Cambiar accesorio";
    lookBtn.addEventListener("click", look.next);
    const row = this.el("div", "isl-actions isl-actions--inline");
    row.append(copy, lookBtn);
    this.panelBody.append(row);

    this.panelBody.append(this.el("div", "isl-sub", `Jugadores (${view.players.length})`));
    const ul = this.el("ul", "isl-list");
    for (const p of view.players) {
      const li = this.el("li", "isl-row" + (p === view.me ? " is-me" : ""));
      const dot = this.el("span", "isl-dot" + (view.present.includes(p) ? " is-on" : ""));
      li.append(dot, this.el("span", "isl-row__name", p + (p === view.me ? " (vos)" : "")));
      if (p === view.host) {
        li.append(this.el("span", "isl-tag", "anfitrion"));
      } else if (view.onKick) {
        const kick = this.el("button", "isl-kick", "Expulsar");
        kick.type = "button";
        const onKick = view.onKick;
        kick.addEventListener("click", () => {
          kick.disabled = true;
          onKick(p);
        });
        li.append(kick);
      }
      ul.append(li);
    }
    this.panelBody.append(ul);
    this.text(
      "Mientras esperan: La Torre, la de la luz roja. El que la sube mas rapido lleva la corona de la sala.",
      "isl-hint-text",
    );

    if (view.onStart && view.onSetRounds) {
      this.panelBody.append(this.el("div", "isl-sub", "Juegos de la partida"));
      const choices = this.el("div", "isl-choices");
      const onSet = view.onSetRounds;
      for (const n of TOTAL_ROUNDS_OPTIONS.filter((x) => x <= 10)) {
        const c = this.el("button", "isl-choice" + (n === view.totalRounds ? " is-on" : ""), String(n));
        c.type = "button";
        c.addEventListener("click", () => onSet(n));
        choices.append(c);
      }
      this.panelBody.append(choices);
      if (!view.canStart) this.text("Hacen falta al menos 2 jugadores conectados.", "isl-hint-text");
      this.actions([
        { label: "Empezar", onClick: view.onStart, primary: true, disabled: !view.canStart },
        { label: "Salir de la sala", onClick: view.onLeave },
      ]);
    } else {
      this.text(`${view.totalRounds} juegos. Esperando a que el anfitrion empiece...`, "isl-hint-text");
      this.actions([{ label: "Salir de la sala", onClick: view.onLeave }]);
    }
  }

  showVoting(view: VotingView, mine: string | null): void {
    const counts = view.options.map((o) => view.counts[o.id] ?? 0);
    const names = view.options.map((o) => view.voters?.[o.id] ?? []);
    const key = JSON.stringify(["vote", view.round, view.options.map((o) => o.id), counts, names, mine, view.title]);
    if (!this.begin(key)) return;
    this.heading(view.kicker ?? "Votacion", view.title ?? "Elegi el proximo juego");
    this.text("Pisa la chapa encendida de un afiche, o apuntale y hace clic (tambien podes tocar el juego aca).", "isl-hint-text");
    const ul = this.el("ul", "isl-list");
    for (const o of view.options) {
      const n = view.counts[o.id] ?? 0;
      const li = this.el("li", "isl-row isl-row--vote" + (mine === o.id ? " is-me" : ""));
      li.style.setProperty("--accent", o.accent ?? "#4dabf7");
      if (o.cover) {
        const img = document.createElement("img");
        img.className = "isl-thumb";
        img.src = o.cover;
        img.alt = "";
        li.append(img);
      }
      // Titulo y, debajo, quienes lo votaron.
      const who = view.voters?.[o.id] ?? [];
      const nameCol = this.el("span", "isl-row__name", o.title);
      if (who.length > 0) nameCol.append(this.el("small", "isl-row__voters", who.join(", ")));
      li.append(nameCol, this.el("span", "isl-row__value", n === 1 ? "1 voto" : `${n} votos`));
      li.addEventListener("click", () => view.onVote(o.id));
      ul.append(li);
    }
    this.panelBody.append(ul);
  }

  showBriefing(view: BriefingView, iAmReady: boolean): void {
    const key = JSON.stringify([
      "brief",
      view.round,
      view.gameTitle,
      view.readyCount,
      view.totalPlayers,
      iAmReady,
      view.host ? view.host.allReady : null,
    ]);
    if (!this.begin(key)) return;
    this.heading(`Ronda ${view.roundNo}/${view.totalRounds} - proximo juego`, view.gameTitle);
    if (view.howTo) {
      const how = renderHowTo(view.howTo, { compact: true });
      how.classList.add("isl-howto");
      this.panelBody.append(how);
    } else if (view.description) {
      this.text(view.description);
    }
    if (view.timeLimit) this.text(`Tiempo de la ronda: ${view.timeLimit}`, "isl-hint-text");
    this.text(
      iAmReady ? "Listo. Esperando a los demas..." : "Subite al escenario LISTO (entre la entrada y el televisor) cuando hayas leido.",
      "isl-hint-text",
    );
    const list: Action[] = [];
    if (!iAmReady) list.push({ label: "Listo", onClick: view.onReady, primary: true });
    if (view.host) {
      list.push({
        label: view.host.allReady ? "Empezar" : "Empezar (esperando listos)",
        onClick: view.host.onStart,
        primary: iAmReady,
        disabled: !view.host.allReady,
      });
    }
    if (list.length) this.actions(list);
    this.panelBody.append(this.el("div", "isl-count", `${view.readyCount}/${view.totalPlayers} listos`));
  }

  showResults(view: ResultsView): void {
    const key = JSON.stringify(["res", view.roundNo, view.rows, view.totals, view.waitingText, view.hostAction?.label]);
    if (!this.begin(key)) return;
    this.heading(`Ronda ${view.roundNo}/${view.totalRounds} - ${view.gameTitle}`, "Resultados");
    this.list(
      view.rows.map((r) => ({
        left: String(r.rank),
        name: r.player,
        right: `+${r.points}`,
        small: r.scoreText,
        me: r.player === view.me,
      })),
    );
    this.totals(view.totals, view.me);
    if (view.hostAction) this.actions([{ ...view.hostAction, primary: true }]);
    else if (view.waitingText) this.text(view.waitingText, "isl-hint-text");
  }

  showFinal(totals: TotalEntry[], me: string, opts: FinalView): void {
    const key = JSON.stringify(["final", totals, opts.hostAction?.label, opts.waitingText]);
    if (!this.begin(key)) return;
    const winners = totals.filter((t) => t.rank === 1).map((t) => t.player);
    this.heading("Fin de la partida", winners.length === 1 ? `Gano ${winners[0]}` : `Empate: ${winners.join(", ")}`);
    this.totals(totals, me, "Tabla final");
    if (!opts.hostAction && opts.waitingText) this.text(opts.waitingText, "isl-hint-text");
    const list: Action[] = [];
    if (opts.hostAction) list.push({ ...opts.hostAction, primary: true });
    list.push({ label: "Salir", onClick: () => (window.location.href = "/") });
    this.actions(list);
  }
}
