# Simon (Secuencia)

Juego de memoria clasico: una secuencia creciente de colores se muestra y el jugador debe repetirla. Cada ronda agrega un paso; el puntaje es la cantidad de rondas (largo de secuencia) que se logra repetir sin equivocarse. Gana quien llega mas lejos ("quien aguanta mas").

## Mecanica

- 4 pads en grilla 2x2 (verde / rojo / azul / amarillo), cada uno con su propio tono (`SoundEffects.playPad`).
- Ciclo por ronda: `nextRound()` agrega un pad aleatorio a `sequence` y `playSequence()` la reproduce iluminando cada pad; luego el estado pasa a `"input"` y el jugador repite. Al completar la secuencia el puntaje sube y arranca la ronda siguiente; al primer error se termina.
- La reproduccion se acelera con la longitud: `step = max(MIN_STEP_MS, BASE_STEP_MS - (len-1)*STEP_DECAY_MS)`; `FLASH_RATIO` es la fraccion encendida de cada paso. Ajustar la dificultad se hace solo con esas constantes en `constants.ts`.
- Estados: `ready | countdown | showing | input | gameOver`. `showing` cubre tanto la reproduccion como la pausa entre rondas (`ROUND_GAP_MS`); los pads solo aceptan toque en `input` (el tablero lleva `is-locked` el resto del tiempo).

## Gotchas

- La reproduccion de la secuencia usa `setTimeout` (no el loop `tick`), agendados via `schedule()`. Cada partida incrementa `runId` en `cancelPending()`, y los timeouts viejos se descartan comparando su `runId` capturado; por eso reiniciar (Enter) o cambiar de ronda no dispara callbacks huerfanos. El loop `requestAnimationFrame` solo maneja el countdown.
- **`menuVisible` gatea el reinicio (no el estado).** Al perder, `endGame()` pone el estado en `gameOver` pero el overlay de fin aparece `GAME_OVER_REVEAL_MS` despues (revelado del error). En esa ventana el estado ya es `gameOver`, asi que gatear el Enter de reinicio por estado hacia que un toque reflejo reiniciara la partida — y el `setTimeout` del revelado (que estaba **crudo**, sin pasar por `schedule()`, por eso ni el `runId` lo cubria) disparaba igual sobre el juego nuevo. Resultado: nunca se veia el puntaje ni el ranking. El flag `menuVisible` es true solo con el overlay realmente en pantalla, y el revelado ahora va por `schedule()`.
- El puntaje reportado (`getScore` en modo sala, parcial por timeout) es `this.score` = rondas completadas hasta el momento, no la ronda en curso a medio repetir.

## Integraciones estandar

- Countdown 3/2/1/YA compartido (`COUNTDOWN_LABELS`/`COUNTDOWN_STEP`, `beginCountdown`, `Hud.showCountdown`, blip `playCountdownTick`).
- Ranking global: scoring por defecto (`direction: "higher"`, mayor ronda = mejor), asi que `meta.ts` no exporta `scoring`. `hud.showRanking("simon", score)` en game over.
- Modo sala: `initRoomMode("simon", { getScore, onStart: beginCountdown })`; en game over se llama `room.reportScore(score)` en vez del ranking, y el reintento se bloquea con `if (this.room) return`.
