# Cálculo Flash (flash-math)

Juego de calculo mental relampago: aparecen numeros de a uno en el centro de la
pantalla, sumandose y restandose, y al final el jugador escribe el resultado con
un teclado numerico. Canvas no; todo es DOM + CSS (estetica minimalista
crema/tinta, ver `DESIGN.md`).

## Modulos

- `main.ts` — entry point, monta `Game` en `#app`.
- `game/constants.ts` — **tunear aca primero**. Ritmo de la fase "showing"
  (`GAP_MS`, `FIRST_DELAY_MS`, `FEEDBACK_MS`), config de dificultad
  (`soloRoundConfig`, `roundPoints`), config fija de sala (`ROOM_*`), el
  generador de secuencia (`buildSequence`) y el PRNG sembrado (`mulberry32` +
  `hashSeed`).
- `game/Game.ts` — maquina de estados `ready → countdown → showing → input →
  feedback → gameOver`, loop `requestAnimationFrame`, teclado numerico, scoring
  y wiring de sala.
- `game/Hud.ts` — todo el DOM: barra superior, escenario central (numero grande +
  cartel de ronda), panel de respuesta (display + teclado), overlays de
  inicio/fin y el label del countdown. Recibe un `onKey` para el teclado.
- `game/SoundEffects.ts` — blips Web Audio (countdown tick 750 Hz, aparicion de
  numero, tecla, correcto, error), sin assets.
- `DESIGN.md` — direccion de arte ("Tinta sobre papel").

## Decisiones no obvias

**El total nunca baja de 0.** En `buildSequence`, si una resta hundiria el total
por debajo de cero se fuerza suma. Asi la respuesta es siempre un entero no
negativo y el teclado no necesita signo (ni el jugador tiene que pensar en
negativos). El primer termino siempre es positivo y se muestra sin signo; el
resto se muestran como `+n` (verde) o `−n` (terracota).

**Fase "showing" por acumulacion de ms.** `updateShowing` alterna
numero-visible / hueco-en-blanco contando `phaseMs` contra `config.showMs` y
`GAP_MS`. El primer hueco usa `FIRST_DELAY_MS` (mas largo, muestra el cartel
"Ronda N") y despues del ultimo numero se salta directo a `input` sin hueco.

**Tope de 10s para responder** (`ANSWER_TIME_MS`, fase `input`). Al vencer se
**envía lo que haya tipeado** (`submitAnswer()`), no se descarta: el puntaje de
sala es por cercanía, así que una respuesta a medias todavía vale, y una vacía ya
valía 0. En solitario una respuesta incompleta es un error y termina la partida,
igual que si la hubiera mandado el jugador. El reloj es un `answerDeadline`
absoluto contra `performance.now()`, evaluado en `updateInput()` desde el loop —
**no** un acumulador de `dt`: acumulando, irse a otra pestaña lo congelaría (el
loop `rAF` se pausa) y regalaría tiempo infinito para pensar, que en salas es
trampa. Con un deadline, volver a la pestaña envía en el acto. La UI es `fm-timer`
(regla de tinta que se consume + segundos), dentro de `fm-input`, así que se
oculta sola con el panel; pasa a `--accent` cuando quedan `ANSWER_URGENT_MS` (3s).

**Un solo countdown por partida, no por ronda.** El 3/2/1/YA (patron obligatorio
del repo) corre una vez al arrancar; las rondas siguientes del solitario entran
directo a "showing" con un cartel breve "Ronda N". Repetir el countdown en cada
ronda seria molesto.

**Solitario vs sala = mismo puntaje "pts", higher-is-better.** El ranking global
(`meta.ts` declara `scoring` con `direction: "higher"`, formato `N pts`) es el
mismo que usa `rankRound` en sala, asi que ambos modos reportan un numero donde
mas es mejor:
- **Solitario:** rondas que suben de dificultad (mas numeros, mas rapido, mas
  grandes). Acertar suma `roundPoints` y avanza; **un error termina la partida**.
  El puntaje es el total acumulado y va al ranking global via `hud.showRanking`.
- **Sala:** una sola ronda; el puntaje se reparte por **cercania** al resultado
  (`max(0, 1000 - error * ROOM_PENALTY)`, exacto = 1000). El modo sala lo reporta
  con `room.reportScore` (no va al ranking global).

**Secuencia compartida en sala.** Para que la cercania sea justa, todos los
jugadores ven la MISMA secuencia: se siembra el PRNG con
`hashSeed(code + ":" + round + ":flash-math")`. La config de sala es fija
(`ROOM_COUNT` / `ROOM_SHOW_MS` / `ROOM_MAX_VAL`).

**El teclado numerico convive con el fisico.** Los botones (`Hud`) hacen
`preventDefault` en mousedown (no roban foco) y `stopPropagation` en click (no
disparan el arranque del contenedor). El teclado fisico se rutea en
`handleKeyDown` solo cuando el estado es `input` (digitos, Backspace = borrar,
Enter = OK), y ahi se hace `preventDefault` para que Enter no arranque otra cosa.
Fuera de `input`, Enter/clic solo sirven para empezar o reiniciar.

## Modo sala (multiplayer)

`initRoomMode("flash-math", { getScore: () => this.roomScore, onStart: () =>
this.beginCountdown() })`. `getScore` devuelve el puntaje de cercania (0 hasta
responder) para el parcial por timeout. En `gameOver` con `this.room` el input de
reinicio se ignora (una partida por ronda) y se reporta con `room.reportScore` en
vez de `hud.showRanking`.
