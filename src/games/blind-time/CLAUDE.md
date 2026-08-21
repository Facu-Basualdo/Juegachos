# Crono Ciego (blind-time)

Se sortea un **tiempo objetivo** (`MIN_TARGET_TIME` 3.0s a `MAX_TARGET_TIME` 12.0s,
redondeado a un decimal) y hay que frenar el cronometro lo mas cerca posible de
ese valor. El reloj se ve solo durante los primeros `BLIND_THRESHOLD` (1.5s): a
partir de ahi se **oculta** (estado `blind`) y hay que estimar a ciegas. El
puntaje es el error absoluto en milisegundos: **menos es mejor**.

`TOTAL_ROUNDS` es **1**: una sola estimacion por partida. El bucle de rondas del
codigo (heredado de reaction-time, con el que comparte estructura) sigue ahi, pero
en la practica solo corre una vuelta.

## Module layout

- `main.ts` — entry point, monta `Game` en `#app`.
- `game/Game.ts` — maquina de estados, sorteo del objetivo, cronometro por dt,
  registro del resultado y ranking.
- `game/Hud.ts` — overlays (inicio, espera, ciego, resultado, game over), los dots
  de progreso de ronda (`RoundStatus`) y el `LeaderboardPanel`.
- `game/SoundEffects.ts` — Web Audio sintetizado (countdown tick, exito, neutro,
  falta).
- `game/constants.ts` — `TOTAL_ROUNDS`, rango del objetivo, `BLIND_THRESHOLD`,
  clave de localStorage, countdown.

## State machine

`ready` -> `countdown` (3/2/1/YA compartido) -> `running` (se ve el reloj) ->
`blind` (a partir de `BLIND_THRESHOLD`, el reloj se oculta) -> `stopped`
(resultado) -> `gameOver`. Frenar antes de que arranque la ronda es `earlyClick`
(falta): marca el dot como `foul` y **repite la ronda**, sin registrar resultado.

**Gotcha:** el resultado se registra en `handleStop` (`roundsData.push`), pero el
puntaje recien se reporta en `endGame`, que se dispara con Enter/click desde
`stopped`. Un jugador que frena y no confirma nunca deja su puntaje: en sala la
red de seguridad es `reportPartialIfNeeded` de `roomMode`, que manda el parcial
cuando la ronda cierra.

## Ranking global (menor error, mejor)

`meta.ts` declara `direction: "lower"` y `format: (n) => \`${Math.round(n)} ms\``.
`endGame()` promedia el error absoluto de las rondas validas (no-foul). El
fallback `9999` de `calculateCurrentAverage() ?? 9999` en el hook `getScore` es un
"peor puntaje posible" para cuando todavia no hay ninguna ronda registrada; nunca
llega al tablero de resultados de sala porque `roomMode` muestra "sin terminar"
en vez del numero para los parciales de juegos `lower` (ver root `CLAUDE.md`).

## Modo sala (multiplayer)

Cableado estandar: `initRoomMode("blind-time", { getScore, onStart })`. En sala el
reintento manual desde `gameOver` esta bloqueado (una partida por ronda) y el
puntaje va a la sala en vez del ranking global.

**F5 no reinicia la partida.** El resultado ya registrado se persiste en
`sessionStorage` via `src/shared/room/roomRun.ts`. Sin esto, recargar despues de
frenar borraba el resultado y dejaba volver a estimar hasta acertar — ventaja
directa, porque el ranking es `direction: "lower"`. `beginCountdown()` corta
temprano si `resumeSavedRun()` encuentra un snapshot; como `TOTAL_ROUNDS` es 1, un
snapshot con la ronda hecha significa que la corrida termino durante el reload, asi
que se va directo a `endGame()` (reporta el puntaje) en vez de rejugar. La ronda a
jugar se **deriva** de `roundsData.length + 1`, no se guarda: un foul repite la
ronda sin registrar resultado, y un contador aparte se desfasaria. `endGame()`
limpia el snapshot.
