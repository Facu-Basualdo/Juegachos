# Hackerman

Tres minijuegos de "hackeo" inspirados en los golpes de GTA Online, encadenados
como **3 niveles** de una sola corrida. El score es el **tiempo total** en
resolver los tres (menor mejor). No hay vidas ni game-over por fallar: errar solo
cuesta tiempo.

## Niveles

1. **Clon de huella** (`levels/fingerprint.ts`) — la huella objetivo esta a la
   derecha; a la izquierda esta partida en 6 franjas horizontales. Cada franja
   cicla entre 4 candidatos (la franja del objetivo + 3 senuelos, que son la misma
   franja de huellas distintas). Se confirma (Enter/click) la que coincide; acierto
   fija la franja (verde), error da flash rojo y bloqueo de `WRONG_LOCK_MS` (750 ms).
   Las huellas se generan proceduralmente (`makeFingerprint`: anillos ovalados
   concentricos alrededor de un nucleo, girados y deformados con un warp de dominio
   en dos ejes para que las crestas queden continuas tipo "loop" y no ruido en
   bloques) y se pintan pixel a pixel en canvas (`image-rendering: pixelated`). La
   UI imita la pantalla de GTA: cada franja va enmarcada, la franja en foco se
   dibuja casi blanca con flechas `‹ ›`, y una fila de "SENALES DESCIFRADAS" marca
   el progreso.
2. **Decodificador** (`levels/decoder.ts`) — un codigo de 4 numeros de dos digitos
   (estilo IP) esta plantado como corrida horizontal contigua en una grilla 8x10.
   La grilla **se desliza sola cada `SCRAMBLE_SEC` (3s)** (animado via `update(dt)`,
   con barra "REORGANIZANDO"): toda la grilla se corre una celda en una direccion
   al azar (izq/der/arriba/abajo) con **wrap toroidal** (`SHIFTS`), arrastrando el
   codigo — hay que engancharlo mientras se mueve. El cursor arrastra una ventana
   de 4 celdas que **da la vuelta** (loop: sale por un borde, entra por el opuesto),
   asi que la ventana puede atravesar la pared; `renderCursor`/`confirm` calculan la
   pertenencia con `(cursorCol + i) % COLS`. Enter/click valida. Encontrar la
   corrida correcta (`CODES` = 1) pasa el nivel.
3. **BruteForce** (`levels/bruteforce.ts`) — un carrete de letras por columna que
   scrollea **hacia abajo** sin parar (animado via `update(dt)`). La clave siempre
   tiene `WORD_LEN` (6) letras — se sortea de `WORD_POOL` (palabras de exactamente
   6 letras), asi el nivel no cambia de tamano. Una banda central marca la fila de
   captura y en cada carrete hay una letra objetivo en ROJO. El jugador DETIENE la
   columna activa (Espacio/Enter/Abajo, o tap) justo cuando su letra roja cae en la
   banda: acierto -> se fija (verde) y el foco pasa a la siguiente; **fallo ->
   reinicia todas las columnas** (se vuelve a empezar desde cero). Todas fijadas =
   nivel resuelto. Es un juego de reflejos, no de alineado.

Cada nivel implementa `HackLevel` (`levels/types.ts`) y recibe un `LevelContext`
con `onSolved` (fin de nivel), `onProgress` (paso intermedio; dispara el save
anti-F5) y `setStatus` (linea de estado del HUD). `Game` enruta el teclado al
nivel activo y llama su `update(dt)` opcional en cada frame (solo BruteForce lo
implementa, para animar el scroll); cada nivel maneja sus propios clicks/pointer
sobre su DOM.

## Module Layout

- `main.ts` — monta `Game` en `#app`.
- `game/Game.ts` — máquina de estados (`ready` -> `countdown` -> `playing` ->
  `victory`), orquesta los 3 niveles, cronometro, best local, ranking y modo sala.
- `game/Hud.ts` — DOM: barra (tiempo / nivel / estado), info de nivel, stage donde
  se montan los niveles, overlay de inicio/victoria (con `LeaderboardPanel`) y
  countdown.
- `game/constants.ts` — countdown, `LEVEL_COUNT`, clave del best local.
- `game/SoundEffects.ts` — Web Audio: countdown tick, move, cycle, lock, error,
  level-clear, victory.
- `levels/` — los tres subjuegos + `types.ts` (`HackLevel`, `LevelContext`,
  `mulberry32`).
- `style.css` — tema verde CRT (scanlines + glow), estilos de los tres niveles.

## Estado y score

`ready` -> `countdown` (3/2/1/YA compartido) -> `playing` (nivel 0, 1, 2) ->
`victory`. El cronometro arranca al pasar a `playing` y es uno solo para toda la
corrida. El score enviado al ranking es `Math.round(elapsed * 100)`
(centisegundos); `meta.ts` declara `direction: "lower"` y `format: formatClock`.
Best local en `localStorage` (`hackerman_best_centis`). Sin variantes de ranking.

## Modo sala (multijugador)

`initRoomMode("hackerman", { getScore, onStart })`. `getScore` devuelve los
centisegundos actuales (parcial por timeout; un parcial "lower" no compite con una
corrida terminada, lo maneja `points.ts`). `onStart` dispara `beginCountdown()`.
En victoria se reporta a la sala en vez del ranking global, y Enter-para-reintentar
queda bloqueado (una corrida por ronda). El juego **no termina solo** si el jugador
se queda quieto, asi que declara `roomTimeLimitSec: 240` en `meta.ts`.

**F5 no reinicia la corrida.** Al ser `direction: "lower"`, recargar reiniciaria
el reloj y seria un exploit. Se persiste en `sessionStorage` (`roomRun.ts`) solo
`{ level, startedAt }`: como en circuit-breaker, un reload reinicia el puzzle del
nivel en curso (aceptable, como un choque) pero conserva el nivel alcanzado y el
tiempo ya gastado — `startedAt` es epoch, el reloj se recalcula con `elapsedSince`.
Se guarda al arrancar la corrida y al superar cada nivel (`onProgress` tambien
guarda). `handleVictory` limpia el snapshot.
