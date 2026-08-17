# Wordle

Adivinar una palabra de 5 letras en 6 intentos. Cada intento se colorea: verde = letra en su lugar, ambar = esta en la palabra pero en otra posicion, olivo = no esta. Menos intentos es mejor y el tiempo desempata.

## Module Layout

- `main.ts` - Entry point, monta `Game` en `#app`.
- `game/Game.ts` - Maquina de estados, intentos, puntaje, sala y persistencia del F5.
- `game/Hud.ts` - DOM: barra superior, grilla 6x5 de casillas con dos caras, teclado en pantalla, overlays y countdown.
- `game/logic.ts` - Logica pura sin DOM: `normalize`, `isValidGuess`, `evaluateGuess`, `keyboardStates`, `randomSolution`, `solutionFor`.
- `game/constants.ts` - Tuning, tipo `LetterState` y el `encodeScore` / `decodeScore` del puntaje.
- `game/words.ts` - **Diccionario de intentos validos** (10964 palabras, generado).
- `game/solutions.ts` - **Palabras sorteables como respuesta** (995, curadas a mano).
- `game/SoundEffects.ts` - Web Audio: countdown tick, tecla, borrar, rechazo, sello por casilla (el tono sube con lo bueno del resultado), victoria y derrota.
- `style.css` - "Sellos sobre Papel" (ver `DESIGN.md`): crema, tinta, bordes gruesos, sombra dura.

## Las dos listas de palabras (y por que son dos)

- **`words.ts` (10964)** es lo que se puede *tipear*. Incluye conjugaciones y rarezas (`abaje`, `abalo`, `abito`) a proposito: que el juego rechace una palabra que existe se siente como un bug.
- **`solutions.ts` (995)** es lo que puede salir de *respuesta*: subconjunto curado a mano, solo palabras comunes y adivinables. Sortear de las 11k daria rondas injugables.
- **Invariante: toda solucion tiene que estar tambien en `words.ts`**, o seria imposible de tipear. Se verifico al generar; si se agregan palabras a `solutions.ts`, chequear que existan en `words.ts`.
- Alfabeto: `a-z` + `ñ`, **sin acentos**. `normalize()` baja a minusculas y saca los diacriticos, pero preserva la ñ partiendo el texto por ella: descomponerla (NFD) la volveria `n` + tilde y `año` terminaria en `ano`, que es otra palabra del diccionario.
- Ambas listas se guardan como un unico string separado por espacios y se parten al importar: pesa bastante menos que un array de ~11k literales citados.

## Diccionario en el cliente, no en el game server

El archivo original de palabras se agrego en `server/`, pero el diccionario vive **en el cliente** (`game/words.ts`) a proposito. Wordle no necesita un arbitro autoritativo (a diferencia de Bomba Palabra, donde el server valida por turnos), y teniendolo aca el juego anda sin `VITE_GAME_SERVER_URL`, como manda la regla de degradacion del repo. La contra aceptada: la solucion es visible para quien mire el bundle — mismo nivel spoofeable ya aceptado en los puntajes.

**El diccionario no toca la landing.** Solo `constants.ts` (sin imports) entra en el grafo de `meta.ts`, que la landing importa con el glob. Si algun dia `constants.ts` importara `words.ts`, la landing se comeria 69KB de palabras: no hacerlo.

## Letras repetidas

`evaluateGuess` hace las dos pasadas clasicas: primero marca las exactas y descuenta ese cupo de la solucion, y recien despues reparte los ambar mientras quede cupo de esa letra. Sin eso, `perro` contra `orden` pintaria las dos R, cuando la solucion tiene una sola (la segunda R tiene que salir olivo).

## State Machine

`ready` -> `countdown` (3/2/1/YA compartido) -> `playing` -> `revealing` -> `playing` | `over`.

`revealing` bloquea el input mientras giran las casillas (240ms de escalon + 420ms de giro). El resultado ya esta decidido al confirmar el intento: la animacion solo lo cuenta. El cronometro **sigue corriendo** durante el reveal (es parte del turno).

## Global ranking (menos intentos, el tiempo desempata)

`meta.ts` declara `direction: "lower"` y un `format` propio. El puntaje es `encodeScore(intentos, segundos)` = `intentos * 1e6 + centesimas`: los intentos mandan el orden y el tiempo desempata entre quienes usaron los mismos. Es la misma idea que `encodeMovesTime` de `shared/scoring-core` (torres-de-hanoi), con codificacion propia porque la etiqueta es otra (`4/6`, no `4 mov`) y decodificar pide la base, que ese modulo no exporta.

Quien **no** resuelve se anota con `FAILED_ATTEMPTS` (= `MAX_ATTEMPTS + 1` = 7), asi cae detras de cualquiera que haya resuelto sin necesidad de un caso especial en el orden, y el `format` lo muestra como "sin resolver". Record local en `localStorage` (`wordle_best`, `{ attempts, seconds }`).

## Room mode (multiplayer)

`initRoomMode("wordle", { getScore, onStart })`. Todos juegan **la misma palabra**, cada uno en su tablero, y gana el que la saca en menos intentos.

**La palabra se deriva, no se reparte.** `solutionFor(code, round)` la saca de un hash FNV-1a de `sala:ronda` sobre `SOLUTIONS`: sin server que arbitre, es lo que hace que todos reciban la misma sin ponerse de acuerdo por la red — y que un F5 reconstruya la misma sola (por eso **no** se guarda en el snapshot: regla de no guardar lo que se puede derivar).

`roomTimeLimitSec: 180`. **No es opcional**: la partida solo termina cuando el jugador gasta sus intentos, asi que uno quieto (presente pero AFK) colgaria la ronda para todos. Al cortar el reloj, el parcial de un juego "lower" no significa nada y `rankRound` ya empata a todos los que no terminaron detras de los que si; la fila de resultados dice "sin terminar".

**F5 no reinicia la partida** (obligatorio en un juego "lower": recargar mediria el tiempo desde la recarga y le ganaria a todos). `roomRun.ts` persiste `{ guesses, startedAt }` en `sessionStorage`; `beginCountdown()` corta temprano si `resumeSavedRun()` encuentra snapshot y repinta la grilla y el teclado desde los intentos (el teclado se deriva con `keyboardStates`, no se guarda). El tiempo va como **epoch**, nunca acumulado: `update()` lo recalcula con `elapsedSince()` mientras haya sala, asi recargar no reinicia ni pausa el reloj. El snapshot se escribe apenas se confirma un intento (no al terminar el reveal), asi que un F5 en medio de la animacion no regala un intento; y como puede caer entre el intento guardado y el cierre, `resumeSavedRun` cierra la partida en el acto si el snapshot ya es terminal (ultimo intento correcto o 6 usados), en vez de dejar al jugador tecleando sobre una partida terminada.

## Gotchas

- **El panel de ranking se repinta desde aca.** `LeaderboardPanel` es blanco sobre transparente (casi todos los juegos son oscuros) y sobre este papel crema no se leeria. Los overrides van calificados con `.overlay` a proposito: el panel inyecta su CSS al montarse, o sea despues de `style.css`, asi que a igual especificidad ganaria el suyo por orden.
- **El strip de sala tapa la barra de intentos.** Es `fixed` arriba al centro; `body:has(.mg-room-strip) #app` le abre lugar solo cuando hay sala.
- **Enter en el game over no reinicia si el foco esta en el campo de nombre** del ranking: el panel se lo queda y para la propagacion. Es comportamiento compartido e intencional del repo, no un bug de este juego.
- Las teclas en pantalla hacen `preventDefault` en `pointerdown` para no quedarse el foco: si no, el Enter fisico posterior "reclickea" la tecla en vez de llegar al juego.

## Arranque por toque (movil)

El arranque/reintento entra por un `pointerdown` en el container que solo actua en ready / over (el teclado en pantalla recien existe con la partida empezada).
**No devolverlo al canvas**: la pantalla de inicio y la de game over son un overlay
que lo tapa, asi que el toque moria ahi y en celular el juego no se podia empezar
(no hay Enter). Es `pointerdown` y no `click` porque el `LeaderboardPanel` compartido
corta la propagacion de los `pointerdown` de su propia UI. Ver el `CLAUDE.md` raiz,
"El toque de arranque no puede colgar del canvas".
