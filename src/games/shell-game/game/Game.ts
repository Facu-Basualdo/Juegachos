import {
  BEST_KEY,
  getLevelConfig,
  getRoomLevelConfig,
  COUNTDOWN_LABELS,
  COUNTDOWN_STEP,
  MAX_DT,
  ROOM_SELECT_TIME_LIMIT_SEC,
  ROOM_FORCE_RESOLVE_GRACE_MS,
} from "./constants";
import { Hud } from "./Hud";
import { initRoomMode, type RoomMode } from "../../../shared/room/roomMode";
import { SoundEffects } from "./SoundEffects";
import {
  fetchMatchState,
  createMatchState,
  updateMatchState,
  CREATE_FALLBACK_MS,
} from "../../../shared/room/matchState";

type State = "ready" | "countdown" | "showingCoin" | "shuffling" | "waitingChoice" | "revealing" | "roundEnd" | "gameOver";

interface Cup {
  id: number;
  el: HTMLDivElement;
  currentSlot: number;
}

interface SharedGameState {
  level: number;
  surviving: string[];
  cupsCount: number;
  initialCoinSlot: number;
  swaps: [number, number][];
  speed: number;
  choices: Record<string, number>;
  revealed: boolean;
  eliminated: Record<string, number>; // { [playerName]: levelFailed }
  winners: string[];
}

export class Game {
  private readonly hud: Hud;
  private readonly room: RoomMode | null;
  /** Se guarda solo para poder desenganchar el pointerdown en `dispose`. */
  private container: HTMLElement | null = null;

  private state: State = "ready";
  private level = 1;

  private bestLevel: number | null = null;
  private lastTime = 0;
  private roomState: SharedGameState | null = null;
  /** Cuando esta pagina entro al modo sala (para el fallback de creacion). */
  private roomBootAt = 0;

  // Gameplay variables
  private countdownTime = 0;
  private lastCountdownIndex = -1;
  private cups: Cup[] = [];
  private initialCoinSlot = 1;
  private currentCoinSlot = 1;
  private selectedCupIndex: number | null = null;

  // Multiplayer variables
  private localChoiceSubmitted = false;
  // Room mode: per-level selection timer (auto-resolves stalled/disconnected picks).
  private selectTimerId: number | null = null;
  private selectDeadline = 0;

  constructor(container: HTMLElement) {
    // Load best level achieved
    const savedBest = localStorage.getItem(BEST_KEY);
    if (savedBest) {
      this.bestLevel = parseInt(savedBest, 10);
    }

    this.hud = new Hud(container);
    this.hud.showStart(this.bestLevel);

    // Init room mode
    this.room = initRoomMode("shell-game", {
      getScore: () => this.calculateRoomScore(),
      onStart: () => this.beginCountdown(),
    });

    this.bindInputs(container);

    this.lastTime = performance.now();
    requestAnimationFrame(this.tick);

    if (this.room) {
      this.startRoomMode();
    }
  }

  private bindInputs(container: HTMLElement): void {
    window.addEventListener("keydown", this.handleKeyDown);
    // En movil no hay Enter: un toque en cualquier parte tiene que arrancar y
    // continuar. `onAction` solo reacciona en ready / roundEnd / gameOver, asi
    // que los toques sobre los vasos durante el juego siguen siendo inofensivos
    // (y el panel de ranking corta la propagacion de los suyos).
    this.container = container;
    container.addEventListener("pointerdown", this.handlePointerDown);
  }

  private handlePointerDown = (): void => {
    this.onAction();
  };

  private handleKeyDown = (e: KeyboardEvent): void => {
    if (e.key === "Enter" || e.key === " ") {
      if (this.state === "ready" || this.state === "gameOver" || this.state === "roundEnd") {
        if (e.key === "Enter") {
          this.onAction();
        }
      }
    }
  };

  private onAction(): void {
    switch (this.state) {
      case "ready":
        this.beginCountdown();
        break;

      case "roundEnd":
        this.startNextLevel();
        break;

      case "gameOver":
        if (this.room) return;
        this.beginCountdown();
        break;
    }
  }

  private beginCountdown(): void {
    this.level = 1;
    this.lastCountdownIndex = -1;

    this.hud.hideOverlay();
    this.hud.updateStats(this.level);
    this.startRound();
  }

  private startRound(): void {
    this.hud.clearBoard();
    this.hud.hideMultiplayerStatus();
    this.clearSelectionTimer();
    this.selectedCupIndex = null;
    this.localChoiceSubmitted = false;

    // The countdown 3-2-1-YA only runs when the game starts (level 1), in both
    // solo and room mode. Subsequent levels/rounds (including each Battle Royale
    // level in a sala) skip straight to shuffling. In room mode the level is
    // tracked independently of the playlist round (see data.level); it is synced
    // to the new level before startRound runs, and playShufflingSequence
    // re-confirms it from the shared match state.
    this.hud.updateStats(this.level);
    if (this.level === 1) {
      this.state = "countdown";
      this.countdownTime = 0;
      this.lastCountdownIndex = -1;
      this.hud.showCountdown(COUNTDOWN_LABELS[0]);
    } else {
      // Skip countdown for subsequent levels and start shuffling
      this.playShufflingSequence();
    }
  }

  private initBoard(cupsCount: number, coinSlot: number): void {
    this.cups = [];
    const container = this.hud.cupsContainer;
    container.innerHTML = "";

    // Build the new board invisible so playShufflingSequence can fade it in,
    // giving a smooth cross-dissolve instead of the cups popping into place.
    this.hud.hideBoardForFade();

    for (let i = 0; i < cupsCount; i++) {
      const cupEl = document.createElement("div");
      cupEl.className = "cup";

      const body = document.createElement("div");
      body.className = "cup-body";

      const rim = document.createElement("div");
      rim.className = "cup-rim";

      cupEl.append(body, rim);

      // Unique absolute layout positioning formula
      cupEl.style.left = `calc(${i} * (100% - var(--cup-width)) / ${cupsCount - 1})`;

      container.append(cupEl);

      this.cups.push({
        id: i,
        el: cupEl,
        currentSlot: i,
      });
    }

    this.initialCoinSlot = coinSlot;
    this.currentCoinSlot = coinSlot;

    this.positionCoin(this.initialCoinSlot);
  }

  private positionCoin(slot: number): void {
    const cupsCount = this.cups.length;
    const coin = this.hud.coin;
    coin.classList.remove("hidden");
    // Align the coin center with the cup center: point `left` at the cup center
    // and let the `.coin` rule's translateX(-50%) do the centering. (Subtracting
    // half the coin width here as well would double-center and shift it sideways.)
    coin.style.left = `calc(${slot} * (100% - var(--cup-width)) / ${cupsCount - 1} + var(--cup-width) / 2)`;
  }

  private async animateRevealCoin(): Promise<void> {
    this.state = "showingCoin";
    
    // Lift the cup containing the coin
    const cup = this.cups.find((c) => c.currentSlot === this.initialCoinSlot);
    if (cup) {
      cup.el.classList.add("lifted");
    }

    await new Promise((resolve) => setTimeout(resolve, 1500));

    if (cup) {
      cup.el.classList.remove("lifted");
    }

    // Wait for the cup to lower
    await new Promise((resolve) => setTimeout(resolve, 500));
    
    // Hide coin during shuffle
    this.hud.coin.classList.add("hidden");
  }

  private generateSwapsList(cupsCount: number, swapsCount: number): [number, number][] {
    const swaps: [number, number][] = [];
    let lastA = -1;
    let lastB = -1;

    for (let i = 0; i < swapsCount; i++) {
      let a = Math.floor(Math.random() * cupsCount);
      let b = Math.floor(Math.random() * cupsCount);
      while (a === b || (a === lastA && b === lastB) || (a === lastB && b === lastA)) {
        a = Math.floor(Math.random() * cupsCount);
        b = Math.floor(Math.random() * cupsCount);
      }
      swaps.push([a, b]);
      lastA = a;
      lastB = b;
    }
    return swaps;
  }

  private async runShuffling(swaps: [number, number][], speed: number): Promise<void> {
    this.state = "shuffling";

    for (const [slotA, slotB] of swaps) {
      if (this.state !== "shuffling") break;
      await this.swapSlots(slotA, slotB, speed);
    }
  }

  private swapSlots(slotA: number, slotB: number, speed: number): Promise<void> {
    return new Promise((resolve) => {
      const cupA = this.cups.find((c) => c.currentSlot === slotA);
      const cupB = this.cups.find((c) => c.currentSlot === slotB);

      if (!cupA || !cupB) {
        resolve();
        return;
      }

      // Front arc moves left to right, back arc moves right to left
      const isAMovingRight = slotA < slotB;

      cupA.el.style.transition = `left ${speed}ms cubic-bezier(0.4, 0, 0.2, 1)`;
      cupB.el.style.transition = `left ${speed}ms cubic-bezier(0.4, 0, 0.2, 1)`;

      if (isAMovingRight) {
        cupA.el.classList.add("swap-front");
        cupB.el.classList.add("swap-back");
      } else {
        cupA.el.classList.add("swap-back");
        cupB.el.classList.add("swap-front");
      }

      // Update slots
      cupA.currentSlot = slotB;
      cupB.currentSlot = slotA;

      // Swap coordinates in DOM
      const cupsCount = this.cups.length;
      cupA.el.style.left = `calc(${cupA.currentSlot} * (100% - var(--cup-width)) / ${cupsCount - 1})`;
      cupB.el.style.left = `calc(${cupB.currentSlot} * (100% - var(--cup-width)) / ${cupsCount - 1})`;

      // Track coin index
      if (this.currentCoinSlot === slotA) {
        this.currentCoinSlot = slotB;
      } else if (this.currentCoinSlot === slotB) {
        this.currentCoinSlot = slotA;
      }

      SoundEffects.playSwap();

      setTimeout(() => {
        cupA.el.classList.remove("swap-front", "swap-back");
        cupB.el.classList.remove("swap-front", "swap-back");
        resolve();
      }, speed + 30);
    });
  }

  private enableChoicesSelection(): void {
    this.state = "waitingChoice";

    // If in multiplayer and we are already eliminated, do not bind selection events
    let isMeSurviving = true;
    if (this.room && this.roomState) {
      isMeSurviving = this.roomState.surviving.includes(this.room.me);
    }

    if (isMeSurviving) {
      this.cups.forEach((cup) => {
        cup.el.classList.add("selectable");
        cup.el.addEventListener("pointerdown", (e) => {
          e.preventDefault();
          this.selectCup(cup);
        });
      });
    } else if (this.room && this.roomState) {
      this.hud.updateMultiplayerStatus(
        this.room.players(),
        this.roomState.choices,
        this.roomState.surviving,
        this.room.me
      );
    }

    // Room mode only: bound the choosing window so an idle or disconnected player
    // can't stall the Battle Royale (revealed never turns true). Runs for
    // everyone - the host also needs the timer to force-resolve missing picks.
    if (this.room) this.startSelectionTimer(isMeSurviving);
  }

  private startSelectionTimer(isMeSurviving: boolean): void {
    this.clearSelectionTimer();
    this.selectDeadline = performance.now() + ROOM_SELECT_TIME_LIMIT_SEC * 1000;

    const update = (): void => {
      const remainMs = this.selectDeadline - performance.now();
      const remain = Math.max(0, Math.ceil(remainMs / 1000));
      // Show the countdown only to a live player who still has to choose.
      this.hud.showSelectTimer(isMeSurviving && !this.localChoiceSubmitted ? remain : null);
      if (remainMs <= 0) {
        this.clearSelectionTimer();
        this.onSelectionTimeout(isMeSurviving);
      }
    };
    update();
    this.selectTimerId = window.setInterval(update, 250);
  }

  private clearSelectionTimer(): void {
    if (this.selectTimerId !== null) {
      window.clearInterval(this.selectTimerId);
      this.selectTimerId = null;
    }
    this.hud.showSelectTimer(null);
  }

  private onSelectionTimeout(isMeSurviving: boolean): void {
    if (this.state !== "waitingChoice") return;

    // Still a live player who never picked: auto-choose an invalid slot so I get
    // eliminated instead of holding everyone up.
    if (isMeSurviving && !this.localChoiceSubmitted) {
      this.cups.forEach((c) => c.el.classList.remove("selectable"));
      void this.submitRoomChoice(-1);
    }

    // The host also resolves the round for anyone who never chose (e.g. a
    // disconnected player), after a short grace so an in-flight remote pick lands.
    if (this.room?.isHost()) {
      window.setTimeout(() => void this.forceResolveRound(), ROOM_FORCE_RESOLVE_GRACE_MS);
    }
  }

  /**
   * Host-only: unblock a stalled level by marking any surviving player who never
   * chose with an invalid pick (-1 -> eliminated) and flipping revealed=true, so
   * the reveal/advance runs even if someone disconnected mid-choice.
   */
  private async forceResolveRound(): Promise<void> {
    if (!this.room || !this.room.isHost()) return;
    if (this.state !== "waitingChoice") return;

    for (let attempt = 0; attempt < 3; attempt++) {
      const matchState = await fetchMatchState<SharedGameState>(this.room.code, this.room.round());
      if (!matchState) return;
      const data = matchState.state;
      if (data.revealed) return; // already resolved (everyone chose or forced)

      for (const p of data.surviving) {
        if (data.choices[p] === undefined) data.choices[p] = -1;
      }
      data.revealed = true;

      const ok = await updateMatchState(this.room.code, this.room.round(), data, matchState.version);
      if (ok) {
        this.room.ping();
        void this.syncRoomState();
        return;
      }
      // Version conflict: re-read and retry.
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  private selectCup(cup: Cup): void {
    if (this.state !== "waitingChoice") return;

    SoundEffects.playSelect();
    this.selectedCupIndex = cup.currentSlot;

    // Highlight selected
    this.cups.forEach((c) => c.el.classList.remove("selected", "selectable"));
    cup.el.classList.add("selected");

    if (this.room) {
      this.submitRoomChoice(cup.currentSlot);
    } else {
      this.revealResult();
    }
  }

  private async revealResult(): Promise<void> {
    this.state = "revealing";

    // Show correct coin location
    this.positionCoin(this.currentCoinSlot);
    this.hud.coin.classList.remove("hidden");

    // Lift chosen cup and correct cup
    const chosenCup = this.cups.find((c) => c.currentSlot === this.selectedCupIndex);
    const correctCup = this.cups.find((c) => c.currentSlot === this.currentCoinSlot);

    if (chosenCup) {
      chosenCup.el.classList.add("lifted");
    }

    if (correctCup && correctCup !== chosenCup) {
      correctCup.el.classList.add("lifted");
    }

    const isCorrect = this.selectedCupIndex === this.currentCoinSlot;

    if (isCorrect) {
      SoundEffects.playSuccess();
      if (chosenCup) chosenCup.el.classList.add("correct-reveal");
    } else {
      SoundEffects.playFail();
      if (chosenCup) chosenCup.el.classList.add("incorrect-reveal");
    }

    await new Promise((resolve) => setTimeout(resolve, 2500));

    if (chosenCup) chosenCup.el.classList.remove("lifted", "correct-reveal", "incorrect-reveal", "selected");
    if (correctCup) correctCup.el.classList.remove("lifted");

    if (this.room) {
      this.hud.hideMultiplayerStatus();
      const score = this.calculateRoomScore();
      this.room!.reportScore(score);
    } else {
      if (isCorrect) {
        this.state = "roundEnd";
        this.level++;
        this.hud.updateStats(this.level);
        this.hud.showCountdown("Listo");
        setTimeout(() => this.onAction(), 1000);
      } else {
        this.endGame();
      }
    }
  }

  private startNextLevel(): void {
    this.hud.showCountdown(null);
    // Keep a ghost of the finished board on screen while the next one is rebuilt,
    // so they crossfade (the new board is faded in and the ghost faded out by
    // playShufflingSequence -> revealBoard) instead of blanking out for a frame.
    this.hud.beginCrossfade();
    this.startRound();
  }

  private endGame(): void {
    this.state = "gameOver";

    let isNewBest = false;
    if (this.bestLevel === null || this.level > this.bestLevel) {
      this.bestLevel = this.level;
      localStorage.setItem(BEST_KEY, this.level.toString());
      isNewBest = true;
    }

    this.hud.showGameOver(this.level, isNewBest, this.bestLevel, !!this.room);
    this.hud.showRanking("shell-game", this.level);
  }

  /**
   * Partial score for the timeout cutoff (the room's getScore hook): reward how
   * far this player reached in the Battle Royale, on the same 1000-per-level
   * scale as the final scores in endMultiplayerGame.
   */
  private calculateRoomScore(): number {
    if (!this.roomState) return 0;
    const me = this.room?.me ?? "";
    const failLevel = this.roomState.eliminated[me];
    if (failLevel !== undefined) return failLevel * 1000;
    // Still surviving: credit the current level reached.
    return this.level * 1000;
  }

  // ---------- Multiplayer (Room Mode) Logic ----------

  private async startRoomMode(): Promise<void> {
    this.hud.updateStats(this.level);
    this.roomBootAt = Date.now();

    this.room!.onSync(() => void this.syncRoomState());

    await this.syncRoomState();
    void this.waitForRoomState();
  }

  /**
   * Reintenta hasta que exista el estado compartido de la ronda. Sin esto, si el
   * host no llegaba a crearlo (se desconecto antes de cargar la ronda) los demas
   * se quedaban esperando para siempre: `syncRoomState` solo se dispara con el
   * broadcast "sync", que en ese caso no llega nunca. Pasado CREATE_FALLBACK_MS
   * el propio reintento lo crea (ver `syncRoomState`).
   */
  private async waitForRoomState(): Promise<void> {
    for (let attempt = 0; attempt < 30 && !this.roomState; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      if (this.roomState || !this.room) return;
      await this.syncRoomState();
    }
  }

  private async syncRoomState(): Promise<void> {
    if (!this.room) return;

    const matchState = await fetchMatchState<SharedGameState>(this.room.code, this.room.round());
    
    if (matchState) {
      const data = matchState.state;
      this.roomState = data;

      // 1. If choices list updated, update display
      if (this.state === "waitingChoice") {
        this.hud.updateMultiplayerStatus(
          this.room.players(),
          data.choices,
          data.surviving,
          this.room.me
        );
      }

      // 2. If revealed is true and we are in waitingChoice state, trigger reveal
      if (data.revealed && this.state === "waitingChoice") {
        this.hud.hideMultiplayerStatus();
        this.revealMultiplayerChoices(data.choices, data);
      }

      // 3. If there is a winner declared and we aren't already finished
      if (data.winners && data.winners.length > 0 && this.state !== "gameOver" && this.state !== "revealing") {
        this.endMultiplayerGame(data);
      }

      // 4. If the round advanced to next level and we are waiting
      if (this.state === "roundEnd" && data.level > this.level) {
        this.level = data.level;
        this.startNextLevel();
      }

    } else if (this.room.isHost() || Date.now() - this.roomBootAt > CREATE_FALLBACK_MS) {
      // Normalmente lo crea el host; si no aparece, lo crea cualquiera pasado el
      // margen (el insert es idempotente por PK: gana el primero).
      const config = getRoomLevelConfig(1);
      const initialCoinSlot = Math.floor(Math.random() * config.cups);
      const swaps = this.generateSwapsList(config.cups, config.swaps);

      const initialState: SharedGameState = {
        level: 1,
        surviving: this.room.players(),
        cupsCount: config.cups,
        initialCoinSlot,
        swaps,
        speed: config.speed,
        choices: {},
        revealed: false,
        eliminated: {},
        winners: [],
      };

      const ok = await createMatchState(this.room.code, this.room.round(), initialState);
      if (ok) {
        this.room.ping();
        void this.syncRoomState();
      }
    }
  }

  private async submitRoomChoice(chosenSlot: number): Promise<void> {
    if (!this.room || this.localChoiceSubmitted || !this.roomState) return;
    this.localChoiceSubmitted = true;

    // Show local choice immediately on overlay (optimistic)
    const optimisticChoices = { ...this.roomState.choices, [this.room.me]: chosenSlot };
    this.hud.updateMultiplayerStatus(
      this.room.players(),
      optimisticChoices,
      this.roomState.surviving,
      this.room.me
    );

    let attempts = 0;
    while (attempts < 5) {
      const matchState = await fetchMatchState<SharedGameState>(this.room.code, this.room.round());
      if (!matchState) break;

      const data = matchState.state;

      // Check if we were already eliminated in DB to prevent double submission
      if (!data.surviving.includes(this.room.me)) {
        break;
      }

      data.choices[this.room.me] = chosenSlot;

      const allChosen = data.surviving.every((p) => data.choices[p] !== undefined);
      if (allChosen) {
        data.revealed = true;
      }

      const ok = await updateMatchState(this.room.code, this.room.round(), data, matchState.version);
      if (ok) {
        this.room.ping();
        // The broadcast does not echo to the sender (broadcast.self=false), so
        // the player whose choice completes the round (sets revealed=true) would
        // never receive a sync to trigger their own reveal. Re-sync locally so
        // the last chooser reveals too, instead of hanging in waitingChoice.
        void this.syncRoomState();
        break;
      }
      attempts++;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  private async revealMultiplayerChoices(choices: Record<string, number>, data: SharedGameState): Promise<void> {
    this.state = "revealing";
    this.clearSelectionTimer();

    this.positionCoin(this.currentCoinSlot);
    this.hud.coin.classList.remove("hidden");

    this.cups.forEach((cup) => {
      const tagsContainer = document.createElement("div");
      tagsContainer.className = "cup-player-tags";

      const choosingPlayers = Object.keys(choices).filter((p) => choices[p] === cup.currentSlot);
      choosingPlayers.forEach((player) => {
        const tag = document.createElement("div");
        tag.className = `player-tag ${player === this.room!.me ? "me" : ""}`;
        tag.textContent = player;
        tagsContainer.append(tag);
      });

      cup.el.append(tagsContainer);

      cup.el.classList.add("lifted");

      const isCorrect = cup.currentSlot === this.currentCoinSlot;
      if (isCorrect) {
        cup.el.classList.add("correct-reveal");
      } else if (choosingPlayers.length > 0) {
        cup.el.classList.add("incorrect-reveal");
      }
    });

    const isSurviving = data.surviving.includes(this.room!.me);
    const myChoice = choices[this.room!.me];
    const isCorrect = myChoice === this.currentCoinSlot;

    if (isSurviving) {
      if (isCorrect) {
        SoundEffects.playSuccess();
      } else {
        SoundEffects.playFail();
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 4000));

    this.cups.forEach((cup) => {
      cup.el.classList.remove("lifted", "correct-reveal", "incorrect-reveal", "selected");
      const tags = cup.el.querySelector(".cup-player-tags");
      if (tags) tags.remove();
    });

    if (this.room!.isHost()) {
      await this.advanceMultiplayerState();
    } else {
      this.state = "roundEnd";
      // If guest completed reveal animation, check if DB state already progressed
      if (this.roomState) {
        if (this.roomState.winners && this.roomState.winners.length > 0) {
          this.endMultiplayerGame(this.roomState);
        } else if (this.roomState.level > this.level) {
          this.level = this.roomState.level;
          this.startNextLevel();
        }
      }
    }
  }

  private async advanceMultiplayerState(): Promise<void> {
    if (!this.room || !this.room.isHost()) return;

    const matchState = await fetchMatchState<SharedGameState>(this.room.code, this.room.round());
    if (!matchState) return;

    const data = matchState.state;

    const survivors: string[] = [];
    const newlyEliminated: string[] = [];

    data.surviving.forEach((player) => {
      const choice = data.choices[player];
      if (choice === this.currentCoinSlot) {
        survivors.push(player);
      } else {
        newlyEliminated.push(player);
      }
    });

    newlyEliminated.forEach((player) => {
      data.eliminated[player] = data.level;
    });

    if (survivors.length === 1) {
      // 1 winner remains
      data.winners = survivors;
      data.surviving = [];
    } else if (survivors.length === 0) {
      // Everyone failed in this level -> all remaining players of this level are joint winners
      data.winners = data.surviving;
      data.surviving = [];
    } else {
      // Continue to next level
      data.level++;
      data.surviving = survivors;
      data.choices = {};
      data.revealed = false;

      const config = getRoomLevelConfig(data.level);
      data.cupsCount = config.cups;
      data.initialCoinSlot = Math.floor(Math.random() * config.cups);
      data.swaps = this.generateSwapsList(config.cups, config.swaps);
      data.speed = config.speed;
    }

    const ok = await updateMatchState(this.room.code, this.room.round(), data, matchState.version);
    if (ok) {
      this.room.ping();
      
      // Host transitions immediately
      if (data.winners && data.winners.length > 0) {
        this.endMultiplayerGame(data);
      } else {
        this.level = data.level;
        this.startNextLevel();
      }
    }
  }

  private endMultiplayerGame(data: SharedGameState): void {
    this.state = "gameOver";
    this.clearSelectionTimer();

    const me = this.room!.me;
    const isWinner = data.winners.includes(me);

    let myFinalScore = 0;
    if (isWinner) {
      myFinalScore = data.level * 1000 + 5000;
    } else {
      const failLevel = data.eliminated[me] || 1;
      myFinalScore = failLevel * 1000;
    }

    this.hud.hideOverlay();
    this.hud.hideMultiplayerStatus();

    this.hud.overlay.classList.remove("hidden");
    const titleEl = this.hud.overlay.querySelector(".overlay__title") as HTMLDivElement;
    const subtitleEl = this.hud.overlay.querySelector(".overlay__subtitle") as HTMLDivElement;
    const scoreEl = this.hud.overlay.querySelector(".overlay__score") as HTMLDivElement;
    const hintEl = this.hud.overlay.querySelector(".overlay__hint") as HTMLDivElement;

    titleEl.textContent = isWinner ? "¡HAS GANADO!" : "ELIMINADO";

    if (data.winners.length === 1) {
      subtitleEl.textContent = `Ganador de la sala: ${data.winners[0]}`;
    } else {
      subtitleEl.textContent = `Empate entre ganadores: ${data.winners.join(", ")}`;
    }

    scoreEl.textContent = isWinner
      ? `Sobreviviste hasta el Nivel ${data.level}`
      : `Fuiste eliminado en el Nivel ${data.eliminated[me]}`;

    hintEl.textContent = "esperando que el host inicie una nueva ronda";

    this.room!.reportScore(myFinalScore);
  }

  // ---------- Game Loop ----------

  private tick = (now: number): void => {
    const dt = Math.min((now - this.lastTime) / 1000, MAX_DT);
    this.lastTime = now;

    this.update(dt);

    requestAnimationFrame(this.tick);
  };

  private update(dt: number): void {
    if (this.state === "countdown") {
      this.countdownTime += dt;
      const index = Math.floor(this.countdownTime / COUNTDOWN_STEP);

      if (index !== this.lastCountdownIndex) {
        this.lastCountdownIndex = index;
        if (index >= COUNTDOWN_LABELS.length) {
          this.hud.showCountdown(null);
          this.playShufflingSequence();
        } else if (index >= 0) {
          SoundEffects.playTick();
          this.hud.showCountdown(COUNTDOWN_LABELS[index]);
        }
      }
    }
  }

  private async playShufflingSequence(): Promise<void> {
    if (this.room) {
      let config: SharedGameState | null = null;
      let attempts = 0;

      while (!config && attempts < 15) {
        const matchState = await fetchMatchState<SharedGameState>(this.room.code, this.room.round());
        if (matchState) {
          config = matchState.state;
        } else {
          attempts++;
          await new Promise((resolve) => setTimeout(resolve, 300));
        }
      }

      if (!config) {
        this.initBoard(3, 1);
        this.hud.revealBoard();
        SoundEffects.playStart();
        await this.animateRevealCoin();
        const fallbackSwaps = this.generateSwapsList(3, 3);
        await this.runShuffling(fallbackSwaps, 550);
        this.enableChoicesSelection();
        return;
      }

      // The level being played is the one in the shared match state, not the
      // room's playlist round. Sync it so the HUD and the advancement check
      // (data.level > this.level in syncRoomState) work from a shared baseline.
      this.level = config.level;
      this.hud.updateStats(this.level);

      this.initBoard(config.cupsCount, config.initialCoinSlot);
      this.hud.revealBoard();
      SoundEffects.playStart();
      await this.animateRevealCoin();
      await this.runShuffling(config.swaps, config.speed);
      this.enableChoicesSelection();
      this.hud.updateMultiplayerStatus(this.room.players(), config.choices, config.surviving, this.room.me);
    } else {
      const config = getLevelConfig(this.level);
      
      // Only randomize the starting cup on Level 1.
      // Subsequent levels start the coin under the cup it was revealed under in the previous round.
      if (this.level === 1) {
        this.currentCoinSlot = Math.floor(Math.random() * config.cups);
      }
      this.currentCoinSlot = Math.min(this.currentCoinSlot, config.cups - 1);
      
      this.initBoard(config.cups, this.currentCoinSlot);
      this.hud.revealBoard();
      SoundEffects.playStart();
      await this.animateRevealCoin();
      
      const swaps = this.generateSwapsList(config.cups, config.swaps);
      await this.runShuffling(swaps, config.speed);
      this.enableChoicesSelection();
    }
  }

  dispose(): void {
    window.removeEventListener("keydown", this.handleKeyDown);
    this.container?.removeEventListener("pointerdown", this.handlePointerDown);
    this.clearSelectionTimer();
  }
}
