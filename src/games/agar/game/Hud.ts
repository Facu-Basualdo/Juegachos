/** HUD de Agar (DOM sobre el canvas). */
export class Hud {
  readonly overlay: HTMLDivElement;
  private readonly titleEl: HTMLDivElement;
  private readonly textEl: HTMLDivElement;
  private readonly hintEl: HTMLDivElement;
  private readonly countdownEl: HTMLDivElement;
  private readonly bannerEl: HTMLDivElement;

  constructor(container: HTMLElement) {
    this.overlay = document.createElement("div");
    this.overlay.className = "ag-overlay";
    this.titleEl = document.createElement("div");
    this.titleEl.className = "ag-overlay__title";
    this.textEl = document.createElement("div");
    this.textEl.className = "ag-overlay__text";
    this.hintEl = document.createElement("div");
    this.hintEl.className = "ag-overlay__hint";
    this.overlay.append(this.titleEl, this.textEl, this.hintEl);

    this.countdownEl = document.createElement("div");
    this.countdownEl.className = "countdown";

    this.bannerEl = document.createElement("div");
    this.bannerEl.className = "ag-banner";

    container.append(this.overlay, this.countdownEl, this.bannerEl);
  }

  showMessage(title: string, text: string, hint = ""): void {
    this.titleEl.textContent = title;
    this.textEl.textContent = text;
    this.hintEl.textContent = hint;
    this.overlay.classList.remove("is-hidden");
  }

  hideMessage(): void {
    this.overlay.classList.add("is-hidden");
  }

  showCountdown(text: string | null): void {
    if (text === null) {
      this.countdownEl.classList.remove("is-shown");
      this.countdownEl.textContent = "";
      return;
    }
    if (this.countdownEl.textContent === text) return;
    this.countdownEl.textContent = text;
    this.countdownEl.classList.remove("is-shown");
    void this.countdownEl.offsetWidth;
    this.countdownEl.classList.add("is-shown");
  }

  /** Aviso arriba (reconectando...). null lo oculta. */
  setBanner(text: string | null): void {
    this.bannerEl.textContent = text ?? "";
    this.bannerEl.classList.toggle("is-shown", text !== null);
  }
}
