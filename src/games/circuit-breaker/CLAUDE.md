# Circuit Breaker

Recreacion del **VLSI Circuit Breaker 2.0** de GTA Online. Hay un area abierta
(corredores) sobre una placa de circuitos; llevas una senal desde el pad de origen
(A, abajo-izquierda) hasta el conector destino (B, arriba-derecha) **sin tocar las
paredes**. Si tocas una pared = choque: la senal vuelve al inicio y se cuenta.

## Mecanica (clave)

- **La senal avanza sola** (un circulo, `SIGNAL_RADIUS`) a `SPEED` px/seg en `dir`;
  el jugador SOLO cambia la direccion (`setDir`, 4 direcciones) con WASD/flechas (o
  swipe en tactil). NO hay colision de deslizamiento: la deteccion de pared es
  "tocar = perder". `startDir` (derecha) es la direccion inicial segura; se restaura
  al arrancar y tras cada choque.
- **Paredes mortales**: `hitsWall` testea el circulo contra las celdas de pared
  (`#`) y contra el borde del tablero. Si toca => `crash`: `state = "crash"`,
  flash rojo + sacudida + banner "CHOQUE" durante `CRASH_FREEZE`, `crashes++`, y
  la senal vuelve a `startCenter`. El tiempo de la corrida sigue corriendo durante
  el choque (penaliza chocar).
- **Llegar a B**: el conector mide **3 celdas** a lo largo de la pared, asi que la
  zona de llegada (`reachedEnd`) es un rectangulo que cubre las 3 celdas (eje
  perpendicular a `endFacing`, +-`CELL*1.5`) con `CELL*0.7` de fondo — no solo un
  circulo en la celda central. Entrar por cualquier borde cuenta como superado.
- Movimiento por substeps dentro de `updatePlaying` para no atravesar paredes finas
  en frames largos.
- Controles: flechas / WASD para girar (la senal avanza sola) o swipe en tactil.
  Enter/tap para empezar y reintentar.

## Puntaje

- **Tiempo que tardo + veces que choco** (menor es mejor). Se codifica con
  `encodeTimeMoves(segundos, choques)` de `scoring-core` (el tiempo manda el orden,
  los choques desempatan). `meta.ts` declara `scoring` con `direction: "lower"` y un
  `format` propio que muestra "M:SS.CC - N choques". El mejor local se guarda
  codificado en `BEST_KEY`.

## Niveles (`levels.ts`)

- Cada nivel es un **mapa de bitmap** (`LEVEL_N_MAP`: una fila = un string).
  Caracteres: `#` pared (mortal), `.` corredor, `A` origen, `B` destino, `t`/`T` ancla
  del HUD/cronometro (`t` sobre corredor, `T` sobre pared; opcional). `parseGrid` lo
  limpia a `#`/`.` y extrae `start`/`end`/`hud`.
- `LEVEL_MAPS` es la lista ordenada de mapas; `LEVEL_COUNT` su cantidad;
  `getLevel(index)` (1-based, acotado) devuelve el `Level`. **Para agregar un nivel:
  pegar su `LEVEL_N_MAP` y sumarlo a `LEVEL_MAPS`** (nada mas).
- Se juegan en orden 1..N; el timer y los choques **se acumulan** en toda la corrida.
  Llegar a B en el ultimo nivel cierra la corrida (`reachEnd` -> `win`); en los
  intermedios muestra el cartel "NIVEL N" (estado `clear`, `LEVEL_FLASH`, timer en
  pausa) y carga el siguiente.
- **Gotcha (deteccion de llegada):** la deteccion de B corre dentro del bucle de
  substeps de `updatePlaying` (solo mientras `state === "playing"`), **antes** del
  `hitsWall`, para que llegar a B tenga prioridad sobre chocar (entrar por un borde
  del conector, que esta pegado a la pared, cuenta como superado y no como choque).
  Solo se evalua en `playing`, asi que tras ganar la senal queda sobre B pero
  `reachEnd()`/`win()` no se re-disparan cada frame (antes la deteccion vivia en
  `updateParticles`, que corre en cualquier estado, e inundaba el ranking con
  `fetch`/`insert` -> `ERR_INSUFFICIENT_RESOURCES`). `win()` ademas tiene un guard
  anti-reentrada (`if (this.state === "won") return`). `startDir` se recalcula por nivel (`computeStartDir`:
  primer vecino de A que sea corredor). Conviene verificar A->B (el editor lo hace por
  BFS en vivo con el radio real de la senal).

## Editor visual (`MazeEditor.ts`, solo dev)

- Abrir el juego con **`?edit=1`** (`main.ts` lo carga con import dinamico guardado por
  `import.meta.env.DEV`, asi no entra en el build de produccion).
- Se pinta el laberinto en una grilla: herramientas Corredor / Pared / Inicio A /
  Destino B / **Cronometro** (ancla del HUD, marcador unico dibujado como reloj), tamano
  de pincel, tamano de grilla (cols/filas), selector de **Nivel**, vaciar/rellenar y
  "Cargar nivel" (carga `getLevel(n)` para retocar). Muestra en vivo si **A->B** es
  resoluble (BFS).
- **"Copiar mapa"** exporta el bitmap como `const LEVEL_N_MAP = [...]` (segun el numero
  de Nivel; al portapapeles y a un textarea) listo para pegar en `levels.ts`.

## Render (`Game.ts`)

- Placa toda de cobre (`COLOR_COPPER`, pared) con los corredores cavados encima
  (`COLOR_CHANNEL`, oscuro) y su contorno luminoso (`COLOR_EDGE`, la "pared" a
  evitar). Serigrafia de componentes sobre bloques 3x3 de cobre (`buildDeco`,
  sembrada). Pad de origen A (circulo). Destino B = un **puerto USB-A** de **3x1 celdas**
  (`drawUsbConnector`: panel, cavidad, lengueta y 4 contactos dorados; resplandor
  pulsante; helper `roundRectPath`). Vista frontal montada **contra la pared**: el lado
  largo (3) corre a lo largo de la pared y solo entra 1 celda al corredor, con la boca
  hacia el corredor. Rota segun `endFacing`/`computeEndFacing` (la pared vecina de B; la
  boca mira al corredor por donde llega el cable): horizontal en paredes arriba/abajo,
  vertical en laterales. La senal es solo la **punta de un cable permanente**
  fino azul (`path`, grosor ~1/3 del original, `COLOR_CABLE`/`COLOR_CABLE_GLOW`) que
  dibuja todo el recorrido de la corrida (se reinicia al empezar y tras cada choque; al
  ganar queda conectando A con B); **no hay circulo/cabeza** en el extremo. La punta
  **desprende chispas electricas azules** (zigzag tipo rayo con parpadeo, disparadas
  hacia los costados: `particles`, `spawnParticles`/`updateParticles`/`drawParticles`).
  Letterbox por nivel (`resize`).
- **HUD posicionable por nivel**: el grupo de lecturas (nivel/tiempo/choques) vive en
  `.hud__readout`. Si el nivel define `hud` (marcador `t`/`T`), `updateHudPosition`
  (llamado en `resize`) convierte esa celda de mundo a px CSS y lo ancla ahi con
  `Hud.setReadoutPosition`; si no, queda arriba-centro (CSS por defecto).

## Ajustes (tuning)

- Dificultad: `SPEED` (mas rapido = mas dificil), `SIGNAL_RADIUS` (mas grande = menos
  holgura en las curvas), ancho de corredor (las `w/h` de los rects en `levels.ts`).
- `CRASH_FREEZE`: cuanto dura el castigo del choque antes de volver al inicio.

## Rankings / salas

- Scoring "lower" (tiempo+choques, `encodeTimeMoves`) declarado en `meta.ts`, con
  **variants**: `general` (los niveles juntos) + `nivel-N` por cada nivel (la lista se
  arma con `LEVEL_COUNT`, por eso `meta.ts` importa `./game/levels`). Todos comparten
  direccion/formato.
- Cada nivel mide su propio tiempo/choques (`levelStartElapsed`/`levelStartCrashes`
  marcados en `loadLevel`; `reachEnd` guarda `levelScores[nivel-1] =
  encodeTimeMoves(tiempoNivel, choquesNivel)`). El general es el total acumulado.
- **La marca de cada nivel se envia al pasarlo** (no al final): `reachEnd` llama
  `submitScoreIfTop("circuit-breaker", lvlScore, { variant: nivel-N })`, que envia solo
  si entra al Top 10 (y hay nickname). Asi queda registrada aunque la corrida no termine.
- En `win` (sin sala) arma `scores = { general, nivel-1, ... }` y llama
  `hud.showRankings(gameId, scores, ["general"])`: un **selector de pestanas** (general
  por defecto) sobre el `LeaderboardPanel`. Solo las variantes en `submittable` (el
  general, que recien se conoce al final) se envian desde el game-over; las pestanas de
  nivel son de **solo lectura** (ya se enviaron al pasarlas). `rankSubmitted` evita
  reenviar al alternar. Con sala: `reportScore(encoded)` del total, sin rankings.
- La landing arma su propio selector de variantes desde `scoring.variants`/`variantLabel`
  (el campeon de la tarjeta usa `variants[0]` = `general`).
- La ronda de sala tiene un tope de 3 min (`roomTimeLimitSec` en `meta.ts`).

## Modo sala: F5 no reinicia la corrida

La corrida (nivel alcanzado, reloj, choques, `levelScores`) se persiste en
`sessionStorage` via `src/shared/room/roomRun.ts`, con guardado periodico
(`SAVE_INTERVAL`, 0.5 s), al chocar, al pasar de nivel y al arrancar.
`beginCountdown()` corta temprano si `resumeSavedRun()` encuentra un snapshot.

- **La senal reaparece en el origen del nivel**, no en su posicion exacta: es
  justo lo que hace un choque, asi que no hay que serializar posicion/direccion/
  `path`.
- **El reload se paga.** El snapshot guarda `savedAt` (epoch) y al retomar se suma
  `elapsedSince(savedAt)` al `elapsed`: recargar no es una forma gratis de volver
  al inicio del nivel. Sin esto seria ventaja, porque el ranking es
  `direction: "lower"` (tiempo + choques).
- **Al pasar de nivel se guarda el nivel SIGUIENTE** (`saveRun(levelIndex + 1, ...)`
  en `reachEnd`). Si no, un reload durante el cartel "NIVEL N" haria repetir un
  nivel que ya quedo puntuado en `levelScores`.
- `loadLevel` remarca `levelStartElapsed`/`levelStartCrashes` contra el `elapsed`
  actual, asi que `resumeSavedRun` los pisa con los guardados: si no, el puntaje
  propio del nivel saldria falseado.
- `win()` limpia el snapshot.

## Arranque por toque (movil)

El arranque/reintento entra por el `pointerdown` del container (antes sobre el canvas, junto con el swipe).
**No devolverlo al canvas**: la pantalla de inicio y la de game over son un overlay
que lo tapa, asi que el toque moria ahi y en celular el juego no se podia empezar
(no hay Enter). Es `pointerdown` y no `click` porque el `LeaderboardPanel` compartido
corta la propagacion de los `pointerdown` de su propia UI. Ver el `CLAUDE.md` raiz,
"El toque de arranque no puede colgar del canvas".
