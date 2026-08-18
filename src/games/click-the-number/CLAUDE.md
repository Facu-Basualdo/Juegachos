# Click the Number

Test de agilidad visual: una grilla con los numeros del 1 al N desordenados, hay que tocarlos en orden ascendente lo mas rapido posible. El puntaje es puro tiempo (menor mejor).

## Module Layout

- `main.ts` - Entry point, mounts the `Game` instance to `#app`.
- `game/Game.ts` - Shuffle, progreso (`next`), state machine, cronometro y score.
- `game/Hud.ts` - DOM manager: overlay de inicio con selector de tamano (1-9, 1-16, 1-25), countdown, barra de stats (proximo numero, tablero, tiempo), grilla y overlay de victoria.
- `game/constants.ts` - Countdown config, localStorage key, tamanos, duracion del flash de error.
- `game/SoundEffects.ts` - Web Audio API: countdown tick, acierto (click de tecla que sube de pitch con el progreso), error (tick sordo), victoria (dos notas).
- `style.css` - Tema "Sala Fria" (`#22d3ee` sobre `#060a12`); ver `DESIGN.md`.

## How it works

**Tablero**: Fisher-Yates sobre `1..size*size`. No hay tableros invalidos ni triviales que filtrar — cualquier permutacion es igual de jugable —, asi que no hay reroll como en Lights Out.

**Progreso**: `next` es el numero buscado. Tocar la celda con `value === next` la apaga y avanza; tocar otra celda **viva** es error (flash rojo + tick sordo) y tocar una ya apagada (`value < next`) no hace nada — esa celda dejo de existir. El error **no** tiene penalidad de tiempo: el cronometro ya la cobra.

**Sin cursor de teclado** (a diferencia de Lights Out): el juego mide con que velocidad el ojo encuentra un numero y el dedo llega, y navegar una grilla con flechas mide otra cosa. Enter solo arranca / reinicia.

**Tamano del digito**: `font-size` sale de `--grid-size` con un `clamp`, asi que las tres grillas mantienen el mismo peso optico. Las cifras son tabulares en todos lados (grilla, HUD, overlays) — ver `DESIGN.md`: si los digitos bailan de ancho, el ojo pierde milisegundos recalibrando.

## State Machine

`ready` -> `countdown` (3/2/1/YA compartido) -> `playing` -> `victory`.

## Global ranking (por tamano, menor tiempo gana)

`meta.ts` declara `direction: "lower"`, `variants: ["3", "4", "5"]` y `format: formatClock`. El puntaje son **centesimas de segundo crudas** (`encodeTime`): a diferencia de Numerix / Lights Out no hay movimientos que codificar, porque cada acierto es forzoso (el orden lo fija el juego) y contarlos solo mediria los errores, que el reloj ya castiga. Mejores tiempos por tamano en localStorage con prefijo `click_the_number_best_`.

El rating del overlay de victoria se mide en **segundos por celda**, no en tiempo total, para que un 3x3 y un 5x5 se juzguen con la misma vara.

## Room mode (multiplayer)

`initRoomMode("click-the-number", { getScore, onStart })`. Con `?room=` el tamano queda fijo en `ROOM_VARIANTS["click-the-number"]` ("5", o sea el 1-25 clasico) y el selector se oculta; la victoria reporta el tiempo a la sala en vez del ranking global, y Enter-para-reintentar se bloquea (una partida por ronda).

**Tope de ronda: 90 s** (`roomTimeLimitSec`). Es obligatorio: el juego no puede terminar solo, un jugador que no toca nada dejaria la ronda colgada para siempre. El parcial por timeout es el tiempo corrido; como el juego es `direction: "lower"`, `points.ts` empata todos los parciales detras de los que si limpiaron la grilla y los muestra como "sin terminar".

**F5 no reinicia la partida.** En sala el layout, el progreso (`next`) y el arranque del cronometro se persisten en `sessionStorage` via `src/shared/room/roomRun.ts` (clave por sala+ronda+juego). `beginCountdown()` corta temprano si `resumeSavedRun()` encuentra un snapshot: retoma el mismo tablero, en el mismo numero, sin countdown. `next` se guarda en vez de derivarse porque el layout **no** registra que celdas se apagaron (no es un cursor derivable, es el progreso mismo). El tiempo va como `startedAt` epoch y `update()` lo recalcula con `elapsedSince()` mientras haya sala — recargar no reinicia ni pausa el reloj (sin sala se sigue sumando `dt`). `handleVictory()` limpia el snapshot.

## Arranque por toque (movil)

El arranque/reintento entra por un `pointerdown` en el container, con **los botones de tamano (1-9 / 1-16 / 1-25)
exentos** (`e.target.closest(".overlay__size-selector")` devuelve temprano): tocar una opcion la
elige y muestra su record, y el toque en cualquier otro lado arranca.

Antes el unico arranque era `Enter`, porque el handler del selector solo guardaba
la opcion y no empezaba nada: en el telefono se podia elegir el tamano y despues
no habia forma de jugar. Por eso el hint dice "toca la pantalla o presiona ENTER"
— un toque que arranca desde todos lados menos los botones no se adivina solo.
Ver el `CLAUDE.md` raiz, "El toque de arranque no puede colgar del canvas".
