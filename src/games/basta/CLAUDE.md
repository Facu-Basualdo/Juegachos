# Basta (basta)

Basta / Tutti Frutti, **solo de sala**. Se sortea una LETRA y cada jugador llena 7
categorias (Nombre, Apellido, Pais/Ciudad, Color, Comida, Animal, Cosa) con palabras
que empiecen con ella. El primero que completa las 7 grita **BASTA** y corta a los
demas (gracia corta). Despues las respuestas se validan por **votacion entre
jugadores**: cada uno puede tachar las ajenas y la mayoria las tumba. Un partido son
`LETTERS_PER_MATCH` letras (3); gana el de mas puntos.

Es el 4to juego con **game server autoritativo** (`server/`, socket.io en Railway),
como Bomba Palabra / Cadena de Palabras / PONG. A diferencia de Bomba/Cadena, el server
**NO consulta el diccionario**: Basta no valida palabras contra un corpus, la mesa
decide por voto. El server solo arbitra el flujo (fases + deadlines), guarda las
respuestas y computa el puntaje. Ver la seccion "Game server" del `CLAUDE.md` raiz.

## Solo de sala (sin modo un jugador)

No tiene modo solo: sin `?room=` muestra "Solo en salas" con link a `/rooms/`. Sin
credenciales de Supabase o sin `VITE_GAME_SERVER_URL` muestra "No disponible".
**Excepcion deliberada a la regla de degradacion** del repo (igual que Bomba/Cadena):
Basta existe por el server. Aparece en la landing y en el picker/votacion de salas.

## Reparto de responsabilidades

- **Supabase / RoomMode**: lobby, briefing, marcador acumulado, rejoin, deadline de
  ronda (corte duro). `initRoomMode("basta", {...})`; al terminar `room.reportScore(...)`
  en vez de `hud.showRanking(...)`. Puntaje de la ronda **placement-based** (mayor =
  mejor): `ranking.length - place`. No va al ranking global.
- **Game server** (`/basta`): letra, respuestas de cada jugador, votos, puntaje y las
  transiciones de fase (todas con `setTimeout` propio, no dependen del host del room).

Como el server arbitra sus fases solo, la partida llega a "over" aunque todos esten
idle => **NO declara `roomTimeLimitSec`** (igual que Bomba/Cadena/Pong). Y como el
puntaje es `direction: "higher"` (default), `meta.ts` **omite** `scoring`.

## Flujo de un partido (fases del server, `BtPhase`)

1. `waiting` — espera a que conecte el roster (gracia `START_GRACE_MS` = 8s). Arranca
   apenas estan todos conectados o al vencer la gracia.
2. `filling` — letra sorteada; cada uno llena sus 7 categorias. El cliente manda su hoja
   con `bt:fill` (debounced ~350ms); el server la guarda pero **no revela** las ajenas
   (solo el `filledCount` de cada uno, para tension). Tope `FILL_MAX_MS` (120s) si nadie
   grita BASTA.
3. `grace` — alguien mando `bt:basta` (el server exige las 7 no vacias); `BASTA_GRACE_MS`
   (5s) para que el resto cierre, y pasa a votacion. Los inputs siguen activos en la gracia.
4. `voting` — el server **revela todas las respuestas** y abre `VOTE_MS` (25s): cada uno
   togglea `bt:vote {target, category}` para tachar una respuesta ajena. Una respuesta se
   **tumba** si `rejects*2 > (jugadores - 1)` (empate = no se tumba).
5. `reveal` — computa el puntaje de la letra (`REVEAL_MS` = 8s): por celda, **valida y
   unica** = 100, **valida y repetida** (mismo texto normalizado que otro) = 50, **vacia o
   tumbada** = 0. Luego: quedan letras -> `filling`; si no -> `over`.
6. `over` — `bt:gameover` con ranking por puntaje total; cada cliente reporta su placement.

## Sobrevivir un F5

Patron server-authoritative: **no** usa `roomRun.ts`/sessionStorage (como Bomba). Las
respuestas viven en el server (llegan por `bt:fill`), asi que al reconectar durante el
llenado el server se las devuelve con el evento dirigido **`bt:you`** (el `bt:state` en
`filling` no revela texto de nadie). El `Hud.setAnswers` solo rellena inputs vacios, para
no pisar lo que el jugador este tipeando en ese instante.

## Module layout

- `main.ts` — monta `Game` en `#app`.
- `game/Game.ts` — orquestador: detecta modo sala (`initRoomMode`), carteles, countdown
  3/2/1/YA (dispara `connect()` en paralelo), renderiza `bt:state` segun fase, debounce del
  `bt:fill`, BASTA (flush de la hoja + `bt:basta`), voto, y reporta el puntaje en `bt:gameover`.
- `game/Hud.ts` — DOM "hoja de cuaderno" (ver DESIGN.md). Tres vistas segun fase:
  **filling/grace** = la hoja rayada con 7 inputs + boton BASTA (habilitado al completar las 7);
  **voting** = las respuestas de todos por categoria con boton "tachar" (cruz dibujada, no emoji)
  en las ajenas; **reveal** = las mismas con su puntaje y color por status. Topbar con la letra
  (sello), un reloj (barra anclada a `performance.now()` con `clockMs`/`clockTotalMs`, sin drift)
  y el roster con el progreso de cada uno. Los estados de espera/resultados/tablero final los
  cubre el `RoomOverlay` compartido por encima.
  - **Gotcha:** la hoja de `filling` **no** se reconstruye en cada snapshot (perderia el foco y
    lo tipeado). Se rebuildea solo al cambiar `letterIndex` (`sheetLetterIndex`); los snapshots
    siguientes solo refrescan reloj, roster y el `disabled` de BASTA. Las vistas de voting/reveal
    si se reconstruyen en cada snapshot (no tienen inputs con foco).
- `game/BastaTransport.ts` — interfaz de transporte + tipos que **espejan**
  `server/src/protocol.ts` (regla de decoupling; si cambia el protocolo, tocar ambos lados).
- `game/SocketTransport.ts` — socket.io-client (import dinamico) contra `/basta`. Anuncia
  `{code, nickname, roster}`; el server fija el orden de los jugadores con el roster.
- `game/SoundEffects.ts` — Web Audio sintetizado (countdown tick 750Hz obligatorio, basta,
  apertura de votacion, reveal, ganar/perder), con su propio AudioContext.
- `game/constants.ts` — countdown, `GAME_SERVER_URL`, y las 7 `CATEGORIES` (ids espejo del server).

## Tuning (server, `server/src/games/basta.ts`)

- Fases: `START_GRACE_MS` (8s), `FILL_MAX_MS` (120s), `BASTA_GRACE_MS` (5s), `VOTE_MS` (25s),
  `REVEAL_MS` (8s). Partido: `LETTERS_PER_MATCH` (3). Letras jugables: `LETTERS` (sin K/W/X/Y/Z/Ñ/Q).
- Puntaje: `POINTS_UNIQUE` (100), `POINTS_REPEATED` (50), `BASTA_BONUS` (0; subir para premiar cortar).
- La votacion tumba con mayoria estricta de los **demas** jugadores (empate = sobrevive). La
  desconexion no elimina: si vuelve, se reengancha y recupera su hoja por `bt:you`.

## Gotchas

- **El `hidden` del Hud necesita ayuda del CSS.** `showStage` / `showMessage` / `showCountdown`
  prenden y apagan la escena, el cartel y el countdown con el atributo `hidden`, pero
  `.bt__stage` (flex), `.bt__overlay` y `.bt__countdown` (grid) declaran su propio `display`,
  que pisa el `display: none` del user-agent. Sin la regla `.bt [hidden] { display: none
  !important; }` de `style.css` el cartel de "esperando" y el **"YA" del countdown quedan
  clavados arriba de la hoja** y el juego se ve trabado (la partida corre atras, pero no se
  puede jugar). Si se agrega otro elemento que se apague con `hidden`, va adentro de `.bt`.
- Los tipos del protocolo estan **duplicados** en cliente y server a proposito (decoupling).
  Mantenerlos en sync a mano; requiere redeploy del server al tocarlos.
- El server **no** usa `dictionary.ts` (a diferencia de Bomba/Cadena): la validacion es 100%
  por voto de la mesa. No re-introducir el diccionario aca sin cambiar el diseño.
- Los votos viajan **crudos** en `bt:state` (`votes: {voter,target,category}[]`), no como un
  contador ni un flag "mine": el cliente cuenta los rechazos por celda y deriva los propios
  (`voter === me`). Es a proposito, para que el `bt:state` sea un unico broadcast (no per-cliente).
- Puntaje de sala placement-based y **no** va al ranking global (como el resto de las salas).
