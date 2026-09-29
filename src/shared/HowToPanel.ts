import { games } from "../games";
import { renderHowTo } from "./howtoView";
import type { LeaderboardPanel } from "./LeaderboardPanel";

/**
 * "Como se juega" con iconos en la pantalla de inicio de cada juego (el mismo `howTo`
 * del `meta.ts` que muestra el briefing de la sala, ver `howto.ts`).
 *
 * Una sola linea por juego, en su Hud, despues de montar el ranking:
 *
 *   new HowToPanel("<id>").follow(this.leaderboard);
 *
 * Se ubica justo antes del `LeaderboardPanel` y lo sigue: se ve mientras el ranking
 * esta vacio (la pantalla de inicio) y se oculta cuando aparece uno (el game over),
 * sin tocar el `showStart` / `showGameOver` de cada juego. Toma la tipografia y el
 * color del texto de la pantalla donde queda y el acento del `accent` del juego (ver
 * `howtoView.ts`), asi respeta el estilo de cada uno. No corta la propagacion del
 * toque: tocar las tarjetas arranca el juego como tocar cualquier otro lado.
 */
export class HowToPanel {
  readonly root: HTMLElement | null;
  /** Selectores de lo que el panel reemplaza mientras se ve (ver `hides`). */
  private readonly replaced: string[] = [];

  constructor(gameId: string) {
    const game = games.find((g) => g.id === gameId);
    if (!game?.howTo) {
      this.root = null;
      return;
    }
    this.root = renderHowTo(game.howTo, { intro: false, compact: true });
    if (game.accent) this.root.style.setProperty("--ht-accent", game.accent);
  }

  /**
   * Para los juegos donde "seguir al ranking" no sirve (su pantalla de inicio ya
   * muestra un ranking, o el ranking vive en una caja que solo se ve en el game over):
   * se ubica a mano y el juego lo muestra y oculta con `show`.
   */
  mount(parent: HTMLElement, before: Element | null = null): this {
    if (this.root) parent.insertBefore(this.root, before);
    return this;
  }

  follow(leaderboard: LeaderboardPanel): this {
    const root = this.root;
    if (!root) return this;
    leaderboard.root.before(root);
    leaderboard.onShowChange((showing) => this.show(!showing));
    return this;
  }

  /**
   * Oculta, mientras las tarjetas se ven, lo que las repetiria: la linea de controles
   * que el juego ya tenia en su pantalla de inicio ("← → / A D / toca..."). Se busca
   * por selector dentro del mismo contenedor y se esconde con una clase, sin tocar su
   * `style`: varios juegos reusan ese elemento en el game over (con el panel oculto
   * vuelve a verse) y le cambian el `display` ellos mismos.
   */
  hides(...selectors: string[]): this {
    this.replaced.push(...selectors);
    this.show(this.root?.style.display !== "none");
    return this;
  }

  show(visible: boolean): void {
    const root = this.root;
    if (!root) return;
    root.style.display = visible ? "" : "none";
    const scope = root.parentElement;
    if (!scope) return;
    for (const sel of this.replaced) {
      for (const el of scope.querySelectorAll(sel)) el.classList.toggle("mg-ht-replaced", visible);
    }
  }
}
