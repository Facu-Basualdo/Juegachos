# Número Fugaz (number-memory)

Juego de memoria numérica rápido (rondas de segundos). Aparece un número, se
**esfuma**, y hay que escribirlo. Cada acierto suma un dígito; un error termina
la partida. El puntaje es la mayor cantidad de dígitos recordada de corrido.
Inspirado en el "Number Memory" de Human Benchmark.

**Dos modos** (se eligen con dos botones en la pantalla de inicio; cada uno con
su propio ranking global vía `variants`):
- **Aleatorio**: un número nuevo al azar cada ronda, un dígito más largo (arranca
  en 3).
- **Escalera**: el **mismo** número que crece: cada ronda se le agrega un dígito
  al final (4 → 47 → 473…) y se escribe la cadena completa (arranca en 1).

## Módulos

- `main.ts` — monta `Game` en `#app`.
- `game/Game.ts` — máquina de estados, timers (setTimeout/interval), input
  (teclado físico + teclado en pantalla + tap para arrancar), best en
  localStorage y el cableado de salas.
- `game/Hud.ts` — capa DOM: barra superior (dígitos actuales / récord), el
  escenario (número + slots de ingreso + feedback), el teclado calculadora, el
  countdown y el overlay de inicio / fin con el `LeaderboardPanel`.
- `game/SoundEffects.ts` — efectos sintetizados (Web Audio, sin assets): tick de
  countdown, blip de aparición, tecla, acierto, error y cierre.
- `game/constants.ts` — tuning: `START_DIGITS` (3), tiempos de exhibición
  (`showMsFor` = base + plus por dígito, con tope), `VANISH_MS`, `CORRECT_HOLD_MS`,
  countdown, `BEST_KEY`.
- `style.css` — la estética "Fósforo" (ver `DESIGN.md`).

## Cómo funciona

1. **Countdown** 3 / 2 / 1 / YA obligatorio (`runCountdown`, con `setInterval` y
   `SoundEffects.playCountdownTick` por paso).
2. **showing**: se genera un número de `digits` dígitos (sin cero inicial, así la
   cantidad no es ambigua) y se muestra `showMsFor(digits)` ms; después se
   dispara la animación de esfumado (`vanishNumber`, `VANISH_MS`).
3. **input**: se abren `digits` slots y el teclado, y arranca el **tope de
   `ANSWER_TIME_MS` (10s) para responder** (ver abajo). Se tipea con teclas físicas
   (0-9, Backspace, Enter) o el teclado en pantalla (⌫ borra, OK confirma). El
   envío (`submit`) sólo evalúa cuando están **todos** los slots llenos.
4. **correct**: `score = digits`, se actualiza el récord si mejora, y tras
   `CORRECT_HOLD_MS` sube de nivel (`digits++`) y vuelve a `showing`.
5. **wrong**: se muestra el número correcto (fantasmal) y lo tipeado ~1.5s y se
   pasa a `gameOver` (ranking / reporte de sala).

## Estados

`ready` → `countdown` → `showing` → `input` → (`correct` → `showing` | `wrong` →
`gameOver`). Desde `ready`/`gameOver` se arranca tocando un **botón de modo**
(`onPickMode`) o con Enter (usa el último modo jugado); en sala está bloqueado (el
arranque lo dispara `RoomMode.onStart`, con el modo fijo en Aleatorio).

## Decisiones no obvias

- **Score = dígitos recordados de corrido** (Aleatorio empieza en `START_DIGITS = 3`;
  Escalera en `ESCALERA_START_DIGITS = 1`). Si se falla el primero, el score es 0.
- **Dos modos con rankings separados**: `meta.ts` declara `scoring` con
  `variants: ["aleatorio", "escalera"]` (`direction: "higher"`). El récord se
  guarda por modo (`bestKey(mode)`) y `endGame()` reporta al ranking con
  `variant = mode`. En **Escalera** el número persiste en `this.target` y crece
  con un dígito por ronda (`startShowing`); en **Aleatorio** se regenera con la
  longitud actual y `digits++` en cada acierto.
- **Sin auto-submit**: hace falta OK/Enter con todos los slots llenos, para que un
  dedo de más no termine la partida sin querer.
- **Tope de 10s para responder** (`ANSWER_TIME_MS`). Al vencer **cuenta como
  error** y termina la partida (`onWrong()` con lo que hubiera tipeado): fallar es
  la única forma de perder que tiene el juego, así que un reloj sin consecuencia no
  sería un límite. El reloj corre contra `performance.now()` (un `inputDeadline`
  absoluto, refrescado por un `setInterval` de `ANSWER_TICK_MS`), **no** acumulando
  ticks: si acumulara, irse a otra pestaña lo congelaría y daría tiempo infinito
  para pensar — que en salas es directamente trampa. Se limpia en `onCorrect` /
  `onWrong` / `clearTimers`, y `tickInput` se auto-cancela si el estado dejó de ser
  `input`. La UI es `nm-timer` (mecha aqua que se consume + segundos), visible sólo
  durante el ingreso y en `--flash` cuando quedan `ANSWER_URGENT_MS` (3s).
- **El número no titila**: brilla estable y la fugacidad está en la *salida*
  (animación de esfumado), no en un parpadeo (ver `DESIGN.md`).

## Salas (multijugador)

Cableado al modo party: `initRoomMode("number-memory", { getScore, onStart })`.
`getScore` = dígitos recordados hasta ahora (parcial por timeout). Con `?room=`,
`endGame()` reporta el puntaje a la sala en vez del ranking global y se bloquea el
reinicio manual (una corrida por ronda). `onStart` dispara `beginCountdown("aleatorio")`
(el modo Escalera no se usa en salas) para que todos arranquen juntos. Es "cada
uno en su pantalla" (no tablero compartido).

## Portada

`public/covers/number-memory.jpg` (1:1, estética "Fósforo": dígitos ámbar
esfumándose en el vacío). El prompt está en `public/covers/README.md`.
