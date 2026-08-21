# Mecano (mecano)

A 30-second typing sprint. Words stream in from a pool of common Spanish words (no diacritics, so any keyboard layout can type them); the player types them one by one and the run is scored by **PPM** (palabras por minuto / WPM). Higher is better.

> Historia: este juego fue el "Mecano" original (id `typing-race`). En el commit `d623bb7` ese id se reconvirtio en "Final Sentence" (thriller de ruleta rusa), reemplazando a Mecano. Aca se restauro Mecano como juego aparte con id propio `mecano`, dejando a Final Sentence en `typing-race`. Por eso el `BEST_KEY` es `mecano:best` y el ranking usa el id `mecano`.

## Module layout

- `main.ts` — entry point, mounts the `Game` instance to `#app`.
- `game/Game.ts` — state machine, keyboard handling, the 30s delta-time timer, live stats, WPM/accuracy scoring, and best-score persistence in localStorage.
- `game/Hud.ts` — DOM manager: HUD stat bar (time / PPM / precision), the word stream with per-character feedback and a blinking caret, the start/game-over overlays, the countdown, and the leaderboard panel.
- `game/SoundEffects.ts` — synthesized Web Audio effects (no assets): countdown tick, a soft click per correct keystroke, a bright blip on a completed word, a low buzz on a mistyped character, and a rising flourish on finish.
- `game/constants.ts` — tuning: sprint duration (30s), storage key, how many words to render ahead (`VISIBLE_WORDS`), countdown steps, and the `WORD_POOL`.
- `style.css` — dark glassmorphic styling; monospace word stream (JetBrains Mono) with correct/incorrect/extra character colors and an animated caret.

## How it works

1. **Countdown**: Enter starts the mandatory 3 / 2 / 1 / YA countdown, then play begins.
2. **Typing**: The stream renders the current word (with live per-character feedback) plus upcoming context. Letters append to the current buffer; `Backspace` deletes; `Space` submits the word and advances. The word list grows on the fly (`ensureWordsAhead`) so it never runs out.
3. **Scoring**: On each submitted word, matched characters are counted. Net WPM = correct characters / 5 / minutes (a completed word contributes its space too); accuracy = correct characters / total keystrokes. When the 30s expire the final WPM is computed, compared with the personal best, stored, and submitted to the global ranking.

## State machine (`Game.ts`)

- `ready`: start screen, Enter begins the countdown.
- `countdown`: 3 / 2 / 1 / YA.
- `playing`: keystrokes drive typing; the frame loop decrements `timeLeft` and refreshes the HUD.
- `gameOver`: results overlay (PPM, precision, correct words) + retry with Enter.

## Non-obvious decisions

- **Word pool has no accents or ñ** so the game is fair across keyboard layouts; typing an accented character would otherwise be impossible on some layouts.
- **Space is the only word delimiter** — a word is not auto-submitted when it matches, so the player controls the rhythm. A space with an empty buffer is ignored (no skipping).
- **Only single-character keys type** (`e.key.length === 1`); modifier combos (Ctrl/Meta/Alt) are ignored so shortcuts still work.
- **Live WPM needs ~1s of elapsed time** before it reads non-zero (avoids a divide-by-zero / absurd spike at the very start).
- **Default scoring (`direction: "higher"`)**, so `meta.ts` omits `export const scoring` per the root convention. `endGame()` submits the WPM via `hud.showRanking("mecano", wpm)`.

## Room mode (multiplayer)

Wired to the shared party mode: the constructor calls `initRoomMode("mecano", { getScore: () => this.liveWpm(), onStart: () => this.beginCountdown() })`. With `?room=` in the URL, `endGame()` reports the WPM to the room instead of the global ranking, the game-over Enter-to-restart is blocked (one run per round), and every player's run auto-starts together via `onStart`.

- **No `roomTimeLimitSec`.** The 30s sprint reaches game over on its own, so per the root `CLAUDE.md` rule the round needs no clock: it closes when every player has reported. `getScore` (the live WPM) is still wired as the generic partial for the paths that need one (`reportPartialIfNeeded`, `leaveForCurrentRound`), but no deadline fires it.
- **Why the limit was removed** (it used to be 120s): it made the round's window 130s (`roomTimeLimitSec` + `NAV_GRACE_SEC`) for a 30-second game. A player who reloaded near the end of that window restarted their run and then got cut by the deadline at t=130s with `liveWpm()` still 0. Worse, `submitScore` renders the waiting overlay, and `RoomOverlay` swallows `Space` at the window capture phase — and **Space is Mecano's word-submit key**, so from that point the player could type forever without a single word being credited. With no limit the deadline never exists and neither does the trap.
