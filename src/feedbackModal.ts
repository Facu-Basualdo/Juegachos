import { games } from "./games";
import { FEEDBACK_MAX, isFeedbackEnabled, sendFeedback, type FeedbackKind } from "./shared/feedback";

/**
 * Formulario de feedback de la landing (link "Feedback" de la barra y del pie, o
 * `/#feedback`). Es el lugar para lo general: pedir un juego, una idea para el sitio, un
 * problema que no es de un juego en particular. El "¿Te gustó?" de cada juego vive en su
 * game over (`FeedbackPanel`).
 */

const KINDS: { kind: FeedbackKind; label: string; placeholder: string }[] = [
  { kind: "bug", label: "Problema", placeholder: "¿Qué pasó? Si fue en un juego, elegilo arriba." },
  { kind: "idea", label: "Idea", placeholder: "¿Qué le agregarías o cambiarías a Juegachos?" },
  { kind: "game", label: "Pedir un juego", placeholder: "¿Qué juego te gustaría jugar acá? Contanos cómo es." },
  { kind: "other", label: "Otro", placeholder: "Lo que quieras contarnos." },
];

let modal: HTMLDivElement | null = null;

function build(): HTMLDivElement {
  const el = document.createElement("div");
  el.className = "rank-modal fb-modal";
  el.innerHTML = `
    <form class="rank-modal__box fb-modal__box" novalidate>
      <div class="rank-modal__head">
        <h3 class="rank-modal__title">Contanos</h3>
        <button type="button" class="rank-modal__close" aria-label="Cerrar">×</button>
      </div>
      <p class="fb-modal__lead">Un problema, una idea o el juego que te gustaría ver acá. Lo leemos todo.</p>
      <div class="fb-modal__kinds" role="group" aria-label="Tipo">
        ${KINDS.map((k, i) => `<button type="button" class="rank-modal__variant${i === 0 ? " is-active" : ""}" data-kind="${k.kind}">${k.label}</button>`).join("")}
      </div>
      <label class="fb-modal__field">
        <span>¿De qué juego? <small>(opcional)</small></span>
        <select class="fb-modal__game">
          <option value="">General / ninguno</option>
          ${[...games].sort((a, b) => a.title.localeCompare(b.title, "es")).map((g) => `<option value="${g.id}">${g.title}</option>`).join("")}
        </select>
      </label>
      <label class="fb-modal__field">
        <span>Mensaje</span>
        <textarea class="fb-modal__text" rows="5" maxlength="${FEEDBACK_MAX}" required></textarea>
      </label>
      <label class="fb-modal__field">
        <span>¿Querés que te respondamos? <small>(opcional: Discord o mail)</small></span>
        <input type="text" class="fb-modal__contact" maxlength="120" autocomplete="off" />
      </label>
      <div class="fb-modal__foot">
        <span class="fb-modal__note" aria-live="polite"></span>
        <button type="submit" class="fb-modal__send">Enviar</button>
      </div>
    </form>
  `;
  const form = el.querySelector<HTMLFormElement>("form")!;
  const text = el.querySelector<HTMLTextAreaElement>(".fb-modal__text")!;
  const game = el.querySelector<HTMLSelectElement>(".fb-modal__game")!;
  const contact = el.querySelector<HTMLInputElement>(".fb-modal__contact")!;
  const note = el.querySelector<HTMLElement>(".fb-modal__note")!;
  const send = el.querySelector<HTMLButtonElement>(".fb-modal__send")!;
  let kind: FeedbackKind = "bug";
  let sending = false;

  const sync = () => {
    send.disabled = sending || text.value.trim().length < 3;
  };
  const setKind = (k: FeedbackKind) => {
    kind = k;
    for (const b of el.querySelectorAll<HTMLButtonElement>("[data-kind]")) b.classList.toggle("is-active", b.dataset.kind === k);
    text.placeholder = KINDS.find((x) => x.kind === k)?.placeholder ?? "";
  };
  setKind("bug");
  sync();

  for (const b of el.querySelectorAll<HTMLButtonElement>("[data-kind]")) b.addEventListener("click", () => setKind(b.dataset.kind as FeedbackKind));
  text.addEventListener("input", sync);
  el.querySelector(".rank-modal__close")!.addEventListener("click", closeFeedbackModal);
  el.addEventListener("click", (e) => {
    if (e.target === el) closeFeedbackModal();
  });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const message = text.value.trim();
    if (sending || message.length < 3) return;
    sending = true;
    sync();
    note.textContent = "Enviando...";
    const res = await sendFeedback({ kind, source: "landing", gameId: game.value || null, message, contact: contact.value });
    sending = false;
    if (res === "ok") {
      text.value = "";
      contact.value = "";
      note.textContent = "¡Gracias! Lo vamos a leer.";
    } else {
      note.textContent = res === "limit" ? "Mandaste mucho seguido. Probá en un rato." : "No se pudo enviar. Probá de nuevo.";
    }
    sync();
  });
  document.body.append(el);
  return el;
}

export function openFeedbackModal(): void {
  if (!isFeedbackEnabled()) return;
  modal ??= build();
  modal.querySelector<HTMLElement>(".fb-modal__note")!.textContent = "";
  modal.classList.add("is-open");
  document.addEventListener("keydown", onKey);
  modal.querySelector<HTMLTextAreaElement>(".fb-modal__text")!.focus();
}

export function closeFeedbackModal(): void {
  if (!modal) return;
  modal.classList.remove("is-open");
  document.removeEventListener("keydown", onKey);
  if (location.hash === "#feedback") history.replaceState(null, "", location.pathname + location.search);
}

function onKey(e: KeyboardEvent): void {
  if (e.key === "Escape") closeFeedbackModal();
}
