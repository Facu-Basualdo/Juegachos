/**
 * Turns keyboard / mouse / touch into a single "drop" callback.
 *
 * Pointer input is bound on `window` (not the canvas) so a tap to start / drop
 * works even while the full-screen start / game-over overlay is on top — but
 * taps that land on interactive UI (the leaderboard name form, the back link)
 * are ignored so those stay usable.
 */
export class InputController {
  private readonly onDrop: () => void;

  constructor(_target: HTMLElement, onDrop: () => void) {
    this.onDrop = onDrop;
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("pointerdown", this.onPointerDown);
  }

  dispose(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("pointerdown", this.onPointerDown);
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.code === "Space" || e.code === "ArrowDown" || e.code === "Enter") {
      e.preventDefault();
      this.onDrop();
    }
  };

  private onPointerDown = (e: PointerEvent): void => {
    const el = e.target as HTMLElement | null;
    // Let clicks on interactive chrome through (leaderboard form, links, buttons).
    if (el && el.closest("input, button, a, .leaderboard")) return;
    this.onDrop();
  };
}
