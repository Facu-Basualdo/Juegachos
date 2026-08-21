# Tinta (stroop)

El efecto Stroop hecho juego de reflejos. Aparece el **nombre de un color**
pintado con **otra tinta** (p.ej. "AZUL" en rojo); hay que tocar el **color de la
tinta**, no lo que dice la palabra. Reloj que **drena**: cada acierto suma tiempo,
cada error resta; se termina cuando el reloj llega a 0. Puntaje = aciertos.

## Módulos

- `main.ts` — monta `Game` en `#app`.
- `game/Game.ts` — máquina de estados, loop `rAF` (el reloj drena por dt),
  generación de consignas, input (teclado 1-9 + swatches + tap para arrancar),
  best en localStorage y salas.
- `game/Hud.ts` — capa DOM: barra (score / récord), la palabra-estímulo, la barra
  de tiempo, los swatches de respuesta, countdown y overlay inicio/fin con el
  `LeaderboardPanel`.
- `game/SoundEffects.ts` — efectos sintetizados (Web Audio, sin assets).
- `game/constants.ts` — `COLORS` (6, nombre+hex), `optionsFor` (4→5→6 según score),
  `CONGRUENT_CHANCE`, tiempos del reloj (`START_TIME`/`MAX_TIME`/`TIME_GAIN`/
  `TIME_PENALTY`), countdown, `BEST_KEY`.
- `style.css` — la piel "Tinta" (ver `DESIGN.md`).

## Cómo funciona

1. **Countdown** 3 / 2 / 1 / YA obligatorio.
2. **newPrompt**: se eligen `optionsFor(score)` colores activos; una **tinta** al
   azar (la respuesta correcta) y una **palabra** que casi siempre dice otro color
   (incongruente; con prob. `CONGRUENT_CHANCE` coincide, para que no se pueda
   "nunca elegir lo que dice"). Los **swatches** son los colores activos barajados
   (color puro, sin texto).
3. **onPick(hex)**: si es la tinta → `score++` y `timeLeft += TIME_GAIN` (tope
   `MAX_TIME`), nueva consigna; si no → `timeLeft -= TIME_PENALTY` + sacudida.
4. El reloj **drena** por `dt` en el `tick`; al llegar a 0 → game over.

## Dificultad

Sube sola con el reloj drenante (hay que ser rápido para sumar tiempo) y con
`optionsFor`: a **12** puntos entra el 5.o color, a **26** el 6.o (más swatches =
más difícil identificar la tinta). Los swatches se **rebarajan** cada consigna
(no hay memoria de posición).

## Estados

`ready` → `countdown` → `playing` → `gameOver`. Desde `ready`/`gameOver`, Enter o
tap arrancan (bloqueado en sala: lo dispara `RoomMode.onStart`). En juego, teclas
1-9 o clic en el swatch responden.

## Salas (multijugador)

`initRoomMode("stroop", { getScore, onStart })`. `getScore` = aciertos hasta ahora.
Con `?room=`, `endGame()` reporta a la sala en vez del ranking global. "Cada uno en
su pantalla".

## Portada

`public/covers/stroop.jpg` (1:1, estética "Tinta"). El prompt está en
`public/covers/README.md`.
