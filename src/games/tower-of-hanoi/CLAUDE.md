# Torres de Hanoi (tower-of-hanoi)

Rompecabezas clasico de las Torres de Hanoi: mover toda la torre de discos de la
primera varilla a la ultima, moviendo un disco a la vez y sin apoyar nunca un
disco sobre otro mas chico. Objetivo: resolver en la menor cantidad de
movimientos (el minimo es `2^n - 1`) y en el menor tiempo.

- **Solo (sin `?room=`)**: elegis la cantidad de discos (3, 4, 5, 6 o 7) y
  resolves. Ranking global por cantidad de discos (una variante por tamano).
- **Sala (`?room=`)**: antes de cada ronda se **vota** con cuantos discos se
  juega; despues cada jugador resuelve **su propia** torre y compite por
  movimientos/tiempo (no es tablero compartido, solo se comparte la cantidad de
  discos votada).

## Module layout

- `main.ts` — entry point, monta `Game` en `#app`.
- `game/Game.ts` — estados `ready | roomVote | countdown | playing | victory`,
  logica del tablero (3 varillas como pilas de tamanos), `handlePegClick` (la
  interaccion converge aca), teclas 1/2/3, countdown 3/2/1/YA compartido,
  victoria y ranking.
- `game/Hud.ts` — DOM: HUD (movimientos, discos, tiempo), tablero de varillas y
  discos, overlays (inicio con selector de discos, votacion de sala, victoria),
  countdown y `LeaderboardPanel`. Ademas la **interaccion con puntero**
  (`pointerdown`/`move`/`up` globales): clic-para-mover **y arrastrar**. Un tap
  levanta el disco de arriba y lo deja seleccionado; un arrastre (supera un
  umbral de 6px) lo hace seguir al puntero y lo suelta en la varilla de destino.
  Ambos caminos se reducen a llamadas a `onPegClick` del juego (levantar =
  seleccionar, soltar sobre otra = mover, soltar sobre la misma / afuera =
  deseleccionar), asi teclado, clic y arrastre comparten la misma logica.
- `game/roomVote.ts` — controlador de la votacion de discos del modo sala (ver
  abajo).
- `game/constants.ts` — discos disponibles, claves de localStorage, countdown,
  `optimalMoves(n)` = `2^n - 1`.
- `game/SoundEffects.ts` — Web Audio sintetizado: countdown tick, levantar,
  soltar, invalido, victoria.
- `style.css` — tablero de varillas (rod + base + pila `column-reverse`), discos
  de ancho segun tamano y color por `hsl`, overlays y countdown, acento naranja.

## Modelo del tablero

`pegs: number[][]` — tres pilas; cada una lista de tamanos del fondo (indice 0)
al tope. La torre arranca completa en `pegs[0]` (mas grande abajo). `selected`
es la varilla con el disco levantado, o `null`. Tocar/levantar una varilla vacia
sin seleccion no hace nada; con seleccion, mover al tope destino solo si el disco
es mas chico que el de arriba (o la varilla esta vacia). Se gana cuando
`pegs[TARGET_PEG]` (la ultima, resaltada en dorado) tiene los `n` discos. Un
movimiento invalido (disco mayor sobre menor) suena y deselecciona. El Hud
mantiene un espejo de `selected` (via `renderBoard`) para saber, durante un
arrastre, si ya hay un disco levantado.

## Ranking global (por discos: menos movimientos, luego menos tiempo)

Declara su `scoring` en `meta.ts` con `direction: "lower"` y
`variants: ["3","4","5","6","7"]` (una tabla por cantidad de discos). Como la
tabla guarda un solo `score` numerico, se codifican **movimientos y tiempo** en
un numero con `encodeMovesTime(moves, seconds)` de `src/shared/scoring-core.ts`
(`movimientos * BASE + centisegundos`): ordenar ascendente ("lower") ordena por
movimientos y usa el tiempo como desempate. El `format` (`formatMovesTime`) lo
decodifica a `N mov - M:SS.cc`. A diferencia de sliding-puzzle / memory-match
(que ordenan por tiempo con `encodeTimeMoves`), aca **manda el movimiento**
porque el minimo (`2^n - 1`) es la marca a batir y el tiempo solo desempata
entre soluciones igual de eficientes.

## Modo sala: votacion de discos

La cantidad de discos de cada ronda se vota antes de jugar. Se implementa
**del lado del juego** (respetando el desacople: solo Hanoi necesita esta
votacion) reutilizando `public.room_match_state` (una fila jsonb por sala+ronda,
via `src/shared/room/matchState.ts`) — el mismo mecanismo que los tableros
compartidos, pero aca **no** es tablero compartido: cada jugador resuelve su
propia torre y solo se comparte el numero votado.

Flujo (`game/roomVote.ts`), disparado por el hook `onStart` de `RoomMode` cuando
la ronda pasa a `playing`:
- Estado durable: `{ phase: "voting" | "playing", votes: Record<player, discos>,
  discs, startedAt }`.
- El **host** crea la fila al cargar (insert; gana el primero ante la carrera
  host-viejo/host-nuevo). Si el host no aparece, pasados `CREATE_FALLBACK_MS`
  (6s, de `matchState.ts`) la crea cualquier jugador. Todos ven el overlay de
  votacion (`Hud.showDiscVote`).
- Cada jugador vota con un UPDATE optimista (version) local-first + ping; ante
  conflicto se refetchea. Patron identico a `sharedMatch.ts` de Memoria.
- El host cierra la votacion (mayoria; empate al azar) cuando **todos** votaron o
  al vencer `VOTE_TIMEOUT_MS`, y escribe `phase: "playing"` + `discs`.
- Cuando la fase pasa a `playing`, cada cliente arranca su ronda con esos discos
  (`beginCountdown()` con countdown 3/2/1/YA). El puntaje se reporta a la sala
  con `encodeMovesTime` (parcial por timeout = `direction "lower"` sin resolver,
  que `points.ts` ordena detras de las torres resueltas, igual que
  sliding-puzzle).

Cableado estandar (contrato minimo de `RoomMode`) mas el contexto extendido
(`code`, `me`, `round()`, `players()`, `isHost()`, `ping()`, `onSync()`) que usa
`RoomVote`. En el game-over el input manual (Enter) esta bloqueado en modo sala.

Gotcha: la votacion es host-autoritativa (el host tallya). Si el host se
desconecta durante la votacion, `roomMode` migra el control **solo** a los 20s
(antes el takeover era un boton manual que ni se dibujaba en fase `playing`, asi
que la votacion quedaba trabada hasta el tope de ronda) y el host nuevo la cierra.
El tope `VOTE_TIMEOUT_MS` acota la espera y cuenta contra el tope de ronda (3 min,
`roomTimeLimitSec` en `meta.ts`).

## Modo sala: F5 no reinicia la partida

Las varillas, los movimientos y el arranque del cronometro se persisten en
`sessionStorage` via `src/shared/room/roomRun.ts` (clave por sala+ronda+juego).
El corte esta en `startRoomVote()` —el hook `onStart`, que un reload vuelve a
disparar—: si `resumeSavedRun()` encuentra un snapshot, **se saltea la votacion
de discos** (ya se voto) y se retoma el tablero tal cual, sin countdown. El
tiempo se guarda como `startedAt` epoch y `update()` lo recalcula con
`elapsedSince()` mientras haya sala, asi recargar no reinicia ni pausa el reloj
(sin sala se sigue sumando `dt`). `handleVictory()` limpia el snapshot. Sin esto,
al recargar se rearmaba la torre con `moves = 0` y el cronometro desde cero, lo
que ademas era ventaja: el ranking es `direction: "lower"`.
