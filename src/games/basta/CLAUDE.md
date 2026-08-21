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
   grita BASTA. Una celda **cuenta como llena solo con `MIN_ANSWER_LEN` (2) letras
   reales** (ver "Respuestas de una sola letra" abajo).
3. `grace` — alguien mando `bt:basta` (el server exige las 7 no vacias); `BASTA_GRACE_MS`
   (5s) para que el resto cierre, y pasa a votacion. Los inputs siguen activos en la gracia.
   Al entrar en esta fase suena el **grito de BASTA** (`BastaAudio`) en **todas** las
   pantallas: lo dispara el cambio de fase, no el click, asi que suena una sola vez por
   letra y tambien en la del que corto.
4. `voting` — el server **revela todas las respuestas** y abre `VOTE_MS` (2 min, solo un
   **tope**: en la practica manda el "Listo" de la mesa y casi nunca se alcanza). El tachado es **local**: se marcan las que no valen y recien al confirmar
   ("Listo") viaja la hoja entera en un `bt:vote {rejects: [{target, category}]}`. El
   server acepta **un solo envio por letra** (los reenvios se ignoran: no se recula) y
   **cierra la fase apenas confirmaron todos los conectados**, sin esperar el tope. Una
   respuesta se **tumba** si `rejects*2 > (jugadores - 1)` (empate = no se tumba).
   Mientras se vota, lo unico publico es **quien** ya confirmo (`BtPlayerView.voted`, que
   el Hud muestra como "n/m listos"): los votos crudos (`BtState.votes`) viajan recien en
   el `reveal`, asi nadie se deja arrastrar por el conteo ajeno.
5. `reveal` — computa el puntaje de la letra (`REVEAL_MS` = 8s): por celda, **valida y
   unica** = 100, **valida y repetida** (mismo texto normalizado que otro) = 50, **vacia,
   tumbada o muy corta** = 0. Luego: quedan letras -> `filling`; si no -> `over`.
6. `over` — `bt:gameover` con ranking por puntaje total; cada cliente reporta su placement.

## Respuestas de una sola letra (anulacion automatica)

Una respuesta con menos de `MIN_ANSWER_LEN` (2) **letras reales** no vale: con la letra A,
un apellido que dice "A" no es un apellido. Se mide sobre el texto **normalizado y sin
espacios**, asi que "A." o "a " tampoco pasan. Es una regla del juego, no una validacion de
diccionario — Basta sigue sin consultar el corpus, la mesa decide todo lo demas por voto.

Pega en tres lugares, y los tres hacen falta:

- **`filledCount` (server)**: la celda corta **no cuenta como llena**, asi que no habilita
  el BASTA. Ese era el agujero real: llenar las 7 con la letra suelta era la forma de cortar
  a todos en dos segundos.
- **`scoreLetter` (server)**: la celda queda con status **`invalid`** y 0 puntos, sin pasar
  por la votacion (no se gasta un voto en algo que no es palabra).
- **Hud (cliente)**: `MIN_ANSWER_LEN` y `answerLength` **espejan** los del server — el
  arbitro es el server, aca solo se decide si se habilita BASTA y se marca la celda en rojo
  (`.bt__input.is-short`) mientras se escribe. Sin esa marca el boton queda muerto sin que se
  entienda por que. En la votacion la celda anulada se muestra ya caida, con el motivo ("muy
  corta") y **sin cruz para tachar**; en `voting` el server manda `status: null` para todas,
  asi que el cliente lo deriva con la misma regla.

Subir el umbral **invalida palabras reales de dos letras** ("Ir", "Ya", "Uy"), asi que si se
toca `MIN_ANSWER_LEN` hay que tocarlo en los dos lados y redeployar el server.

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
  en las ajenas, mas el **boton de confirmar** ("LISTO (n)" -> "ENVIADO"); **reveal** = las
  mismas con su puntaje y color por status.
  Es **un solo boton fisico abajo** (`.bt__basta`): grita BASTA en el llenado y confirma el
  voto en la votacion (`.is-vote` lo pinta con la tinta azul), asi que el que toca su `click`
  mira el `panelMode`.
  Entre fase y fase se cruza un cartel de transicion (`showTransition`, `.bt__wipe`): "A VOTAR"
  al abrirse la votacion, "PUNTAJE" al cerrarse y "LETRA N" al empezar cada letra nueva (la
  primera ya la anuncia el countdown). Es decorativo y **no bloquea**: `pointer-events: none`,
  la vista de abajo se renderiza *antes* de lanzarlo y se borra solo por timeout, asi que si se
  pierde (pestaña en segundo plano) no deja nada trabado. Topbar con la letra
  (sello), un reloj (barra anclada a `performance.now()` con `clockMs`/`clockTotalMs`, sin drift)
  y el roster con el progreso de cada uno. Los estados de espera/resultados/tablero final los
  cubre el `RoomOverlay` compartido por encima.
  - **Gotcha:** la hoja de `filling` **no** se reconstruye en cada snapshot (perderia el foco y
    lo tipeado). Se rebuildea solo al cambiar `letterIndex` (`sheetLetterIndex`); los snapshots
    siguientes solo refrescan reloj, roster y el `disabled` de BASTA. **La votacion es igual**
    (`votingLetterIndex`): los tachados son estado local (`pendingRejects`) hasta que se
    confirman, y cada vez que alguien confirma llega un snapshot — rebuildear ahi le haria
    saltar el scroll al que todavia esta revisando. Solo el `reveal` se reconstruye siempre.
- `game/BastaTransport.ts` — interfaz de transporte + tipos que **espejan**
  `server/src/protocol.ts` (regla de decoupling; si cambia el protocolo, tocar ambos lados).
- `game/SocketTransport.ts` — socket.io-client (import dinamico) contra `/basta`. Anuncia
  `{code, nickname, roster}`; el server fija el orden de los jugadores con el roster.
- `game/SoundEffects.ts` — Web Audio sintetizado (countdown tick 750Hz obligatorio, basta,
  apertura de votacion, reveal, ganar/perder).
- `game/BastaAudio.ts` — **sample real** (`public/sfx/basta/basta.mp3`, ver su README) del
  grito de BASTA: una de las dos excepciones del repo a la regla de sintetizar todo con Web
  Audio (la otra son las reacciones de Bomba Palabra). Se precarga en el constructor del
  `Game` — se baja, se decodifica y queda en memoria — para que suene en el instante del
  corte. **Degrada**: si el mp3 falta o no decodifica, `play()` devuelve `false` y
  `SoundEffects.playBasta()` cae al campanazo sintetizado.
- `game/audioContext.ts` — el `AudioContext` compartido por los dos de arriba (modulo hoja,
  para que el fallback no cierre un ciclo de imports con `BastaAudio`).
- `game/constants.ts` — countdown, `GAME_SERVER_URL`, y las 7 `CATEGORIES` (ids espejo del server).

## Tuning (server, `server/src/games/basta.ts`)

- Fases: `START_GRACE_MS` (8s), `FILL_MAX_MS` (120s), `BASTA_GRACE_MS` (5s), `VOTE_MS` (2 min,
  solo tope: `maybeCloseVoting` cierra antes), `REVEAL_MS` (8s). Partido: `LETTERS_PER_MATCH` (3).
  Letras jugables: `LETTERS` (sin K/W/X/Y/Z/Ñ/Q).
- Puntaje: `POINTS_UNIQUE` (100), `POINTS_REPEATED` (50), `BASTA_BONUS` (0; subir para premiar cortar).
- Largo minimo de una respuesta: `MIN_ANSWER_LEN` (2). Espejado en el `Hud` del cliente.
- La votacion tumba con mayoria estricta de los **demas** jugadores (empate = sobrevive). La
  desconexion no elimina: si vuelve, se reengancha y recupera su hoja por `bt:you`.
- `maybeCloseVoting` espera solo a los **conectados**, y tambien corre en `leave`: si el que
  faltaba confirmar se desconecta, la fase cierra en vez de comerse el tope entero.

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
- Los votos viajan **crudos** en `bt:state` (`votes: {voter,target,category}[]`) pero **solo en
  el `reveal`**: durante la votacion el campo es `null` y el cliente pinta los tachados desde su
  propio `pendingRejects`. Asi el `bt:state` sigue siendo un unico broadcast (no per-cliente) sin
  filtrar el voto ajeno antes de tiempo.
- Confirmar el voto es **irreversible** y se puede perder: el que no aprieta "Listo" antes del
  tope pierde TODOS sus tachados (por eso `VOTE_MS` es de 2 min y no de los 25s de cuando cada
  tachado contaba solo: la mesa lee y discute la grilla entera antes de confirmar). Si se quiere
  permitir corregir, hay que sacar el `submittedVotes.has(voter)` del `onVote` **y** decidir que
  pasa con el cierre anticipado (hoy cierra apenas confirman todos).
- Puntaje de sala placement-based y **no** va al ranking global (como el resto de las salas).
