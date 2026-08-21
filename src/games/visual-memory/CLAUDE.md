# Constelación (visual-memory)

Juego de memoria visual rápido (rondas de segundos). Se encienden unas celdas de
una grilla ~1s; hay que memorizar el patrón y, cuando se apaga, volver a marcar
esas mismas celdas. Cada nivel suma celdas (y agranda la grilla). Con 3 vidas: un
toque en una celda equivocada cuesta una vida. El puntaje es el nivel alcanzado.
Inspirado en el "Visual Memory" de Human Benchmark. Es hermano de Número Fugaz
(`number-memory`), misma familia.

## Módulos

- `main.ts` — monta `Game` en `#app`.
- `game/Game.ts` — máquina de estados, timers, best en localStorage y salas.
- `game/Hud.ts` — capa DOM: barra (nivel / vidas / récord), la grilla clickeable,
  countdown y overlay de inicio / fin con el `LeaderboardPanel`.
- `game/SoundEffects.ts` — efectos sintetizados (Web Audio, sin assets).
- `game/constants.ts` — tuning: `LIVES` (3), `tilesFor`/`gridNFor` (cuántas celdas
  y qué tamaño de grilla por nivel), `showMsFor`, countdown, `BEST_KEY`.
- `style.css` — la estética "Constelación" (ver `DESIGN.md`).

## Cómo funciona

1. **Countdown** 3 / 2 / 1 / YA obligatorio.
2. **showing**: se arma la grilla `gridNFor(level)` (crece con el nivel) y se
   encienden `tilesFor(level)` celdas al azar (nivel 1 = 3). Se ven `showMsFor(tiles)` ms.
3. **recall**: se apaga el patrón y las celdas quedan clickeables. Acertar una
   celda del patrón la marca (verde-menta); tocar una vacía marca error y **resta
   una vida**. Completar todas las del patrón → nivel completado.
4. **levelHold**: `score = level`, se actualiza récord, y tras `LEVEL_HOLD_MS`
   sube de nivel.
5. **gameOver** al quedarse sin vidas: se revelan tenues las celdas que faltaban
   y se pasa al overlay (ranking / reporte de sala).

## Estados

`ready` → `countdown` → `showing` → `recall` → (`levelHold` → `showing` |
`gameOver`). Desde `ready`/`gameOver`, Enter o tap arrancan (bloqueado en sala: lo
dispara `RoomMode.onStart`).

## Decisiones no obvias

- **Score = niveles completados** (nivel 1 = 3 celdas). Si se pierde en el 1, es 0.
  Scoring por defecto (`direction: "higher"`), por eso `meta.ts` no declara `scoring`.
- **La grilla crece sola**: `gridNFor` mantiene la densidad de celdas encendidas
  por debajo de ~50% (tope `MAX_GRID = 7`).
- **Una vida por celda equivocada**, y no se penaliza dos veces la misma celda
  (se guardan en un `Set` `wrong`).
- **`menuVisible` gatea el reinicio, no el estado.** Al perder, el estado pasa a
  `gameOver` pero el overlay recién aparece 1100ms después (revelado de celdas
  faltantes). En esa ventana el estado ya es `gameOver`, así que gatear el tap /
  Enter de reinicio por estado hacía que un toque reflejo tras perder llamara a
  `beginCountdown()`, cuyo `clearTimers()` cancelaba el `overTimer` pendiente:
  `endGame()` nunca corría y la partida se reiniciaba **sin mostrar el puntaje ni
  el ranking**. El flag `menuVisible` es true solo cuando el overlay de inicio /
  fin está realmente en pantalla, y los handlers gatean por él.

## Salas (multijugador)

`initRoomMode("visual-memory", { getScore, onStart })`. `getScore` = nivel
alcanzado hasta ahora (parcial por timeout). Con `?room=`, `endGame()` reporta a la
sala en vez del ranking global y se bloquea el reinicio manual. Es "cada uno en su
pantalla" (no tablero compartido).

## Portada

`public/covers/visual-memory.jpg` (1:1, estética Bounce Rush: bloques 3D naranjas
sobre navy con glow violeta). El prompt está en `public/covers/README.md`.
