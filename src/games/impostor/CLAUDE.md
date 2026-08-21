# Impostor (impostor)

Deduccion social, **solo de sala**. A todos menos al/los impostor/es se les muestra en
privado la misma **palabra secreta** y su categoria; el impostor solo ve la **categoria**
(sabe que es impostor, no la palabra). Por turnos cada uno escribe **una palabra-pista**
relacionada; todos las ven. Despues se **vota** quien es el impostor: si el mas votado es
un impostor, tiene una chance de **adivinar la palabra** para robar la ronda. Un partido son
`ROUNDS_PER_MATCH` rondas (3); gana el de mas puntos.

Es el 5to juego con **game server autoritativo** (`server/`, socket.io en Railway), como
Bomba Palabra / Cadena de Palabras / PONG / Basta. Como Basta, el server **NO** consulta el
diccionario: usa un banco propio de palabras por categoria (`server/src/words-impostor.ts`).
El server reparte roles, arbitra el flujo (fases + deadlines) y computa el puntaje. Ver la
seccion "Game server" del `CLAUDE.md` raiz.

## Solo de sala (sin modo un jugador)

No tiene modo solo: sin `?room=` muestra "Solo en salas" con link a `/rooms/`. Sin
credenciales de Supabase o sin `VITE_GAME_SERVER_URL` muestra "No disponible". **Excepcion
deliberada a la regla de degradacion** del repo (igual que Basta / Bomba / Cadena): Impostor
existe por el server (reparte roles y arbitra fases/votos/puntaje). Aparece en la landing y en
el picker/votacion de salas.

## Reparto de responsabilidades

- **Supabase / RoomMode**: lobby, briefing, marcador acumulado, rejoin. `initRoomMode("impostor",
  {...})`; al terminar `room.reportScore(...)` en vez de `hud.showRanking(...)`. Puntaje de la
  ronda **placement-based** (mayor = mejor): `ranking.length - place`. No va al ranking global.
- **Game server** (`/impostor`): roles (palabra / impostor), pistas por turno, votos, adivinanza,
  puntaje y todas las transiciones de fase (con `setTimeout` propio, no dependen del host del room).

Como el server arbitra sus fases solo, la partida llega a "over" aunque todos esten idle =>
**NO declara `roomTimeLimitSec`** (igual que Basta/Bomba/Cadena/Pong). Y como el puntaje es
`direction: "higher"` (default), `meta.ts` **omite** `scoring`.

## El rol es privado (no espiable)

El rol (si sos impostor, y la palabra si sos inocente) viaja **solo** por el evento dirigido
**`im:you`** (`room.emitTo`), **nunca** en el broadcast `im:state`. Asi nadie puede leer del
snapshot quien es el impostor ni cual es la palabra. El server manda `im:you` a cada jugador al
empezar cada ronda (fase `reveal`) y de nuevo al **reconectar** en plena ronda (F5). La palabra
secreta solo aparece en `im:state` en la fase `result` (ya termino la ronda, se puede revelar).

## Flujo de una ronda (fases del server, `ImPhase`)

1. `waiting` — espera a que conecte el roster (gracia `START_GRACE_MS` = 8s). Arranca cuando
   estan todos conectados o al vencer la gracia. Necesita >= 2 seats (para que haya un inocente).
2. `reveal` — sortea categoria + palabra y reparte roles (`impostorCount`: 2 con 7+ jugadores,
   si no 1). `REVEAL_MS` (6s) para que cada uno lea su ficha privada (`im:you`).
3. `clues` — orden de turnos **barajado** (`CLUE_LAPS` = 1 vuelta). El jugador de turno escribe
   una palabra-pista (`im:clue`); el server la agrega y avanza. Tope por turno `CLUE_TURN_MS`
   (37.5s) -> pista vacia y pasa al siguiente. Los turnos de desconectados se saltean (pista vacia).
   Dada la **ultima** pista no se salta a la votacion: la fase sigue en `clues` con `turn = null`
   durante `CLUES_RECAP_MS` (3.5s) para que la mesa alcance a leer lo que escribio el ultimo
   (`endClues`). **`currentTurn()` devuelve null cuando se agotaron los turnos**: sin ese corte el
   modulo daba la vuelta y volvia a marcar de turno al primero durante la pausa.
4. `voting` — `VOTE_MS` (30s): cada uno vota (`im:vote {target}`, cambiable/toggle, no a si mismo).
   Cierra al vencer o `VOTE_GRACE_MS` (1.2s) despues de que votaron todos los presentes. El mas
   votado es el **acusado**; empate o sin votos -> nadie acusado (el impostor zafa).
5. `guess` — solo si el acusado **es** impostor. `GUESS_MS` (20s) para que **ese** impostor
   escriba su adivinanza (`im:guess`); acierta si normaliza igual que la palabra secreta.
6. `result` — `RESULT_MS` (9s): revela impostor/es + palabra + desenlace + puntos de la ronda.
   Desenlaces (`ImOutcomeKind`): `impostor-survived` (no fue el mas votado), `impostor-guessed`
   (descubierto pero adivino), `impostor-caught` (descubierto y fallo). Luego: quedan rondas ->
   `reveal`; si no -> `over`.
7. `over` — `im:gameover` con ranking por puntaje total; cada cliente reporta su placement.

## Puntaje (tuning, `server/src/games/impostor.ts`)

Por equipo: si ganan los **impostores** (zafaron o adivinaron), cada impostor suma
`IMPOSTOR_WIN_PTS` (3); si ganan los **inocentes** (descubrieron y el impostor no adivino),
cada inocente suma `INNOCENT_WIN_PTS` (2). Los roles se rebarajan cada ronda, asi que el rol de
impostor rota y los puntos se equilibran a lo largo del partido. (Se podria premiar solo a los
inocentes que votaron bien; hoy es team-based por simplicidad.)

## Banco de palabras

`server/src/words-impostor.ts`: categorias (`WORD_CATEGORIES`) con palabras concretas y
adivinables en espanol rioplatense. La **categoria es una pista deliberada** para el impostor, asi
que las palabras de una categoria tienen que distinguirse entre si. `pickWord(exclude)` sortea sin
repetir en el partido. Se edita a mano; requiere redeploy del server. No se usa el diccionario.

## Module layout

- `main.ts` — monta `Game` en `#app`.
- `game/Game.ts` — orquestador: detecta modo sala (`initRoomMode`), carteles, countdown 3/2/1/YA
  (dispara `connect()`), guarda el rol de `im:you`, renderiza `im:state` por fase, y reporta el
  puntaje en `im:gameover`. Sonido de "tu turno" al cambiar el turno a uno mismo en `clues`.
- `game/Hud.ts` — DOM "sala de interrogatorio" (ver DESIGN.md). Cinco vistas segun fase: reveal
  (ficha de rol), clues (categoria + pistas + input propio), voting (sospechosos), guess
  (adivinanza), result (revelado + puntos). Topbar en **dos filas**: arriba ronda + fase +
  roster, abajo el reloj (barra anclada a `performance.now()`, sin drift) a lo ancho.
  Espera/resultados/tablero final los cubre el `RoomOverlay`.
  - **Gotcha:** en `clues` el panel **no** se reconstruye en cada snapshot (perderia el foco del
    input). Se keya en `turn|clues.length|myTurn` (`cluesSig`); mientras no cambie, solo se refresca
    reloj y roster. En `guess` con input propio tampoco se reconstruye (`panelMode === "guess"`).
    Voting/reveal/result si se reconstruyen (no tienen input con foco que perder).
  - **Gotcha (layout):** el reloj va en su **propia fila** y la escena lleva `padding-top: 44px`
    porque el strip de la sala (`.mg-room-strip`: fijo, centrado y pegado al borde superior, con
    codigo / ronda / luces de jugadores) **tapaba la barra de tiempo**. Cualquier chrome nuevo
    arriba tiene que quedar fuera de esa franja.
  - En `clues` con `turn === null` (la pausa de lectura) el panel muestra la lista completa y
    "Ya estan todas las pistas. Empieza la votacion..." en vez de "Turno de X".
- `game/ImpostorTransport.ts` — interfaz de transporte + tipos que **espejan** `server/src/protocol.ts`
  (regla de decoupling; si cambia el protocolo, tocar ambos lados).
- `game/SocketTransport.ts` — socket.io-client (import dinamico) contra `/impostor`. Anuncia
  `{code, nickname, roster}`; el server fija el orden de los jugadores con el roster.
- `game/SoundEffects.ts` — Web Audio sintetizado en clave noir (countdown tick 750Hz obligatorio,
  reveal, tu turno, apertura de voto, sting de acusacion, ganar/perder), con su propio AudioContext.
- `game/constants.ts` — countdown, `GAME_SERVER_URL`, `MAX_WORD_LEN`.

## Gotchas

- **El `hidden` del Hud necesita ayuda del CSS.** `showStage` / `showMessage` / `showCountdown`
  prenden y apagan la escena, el cartel y el countdown con el atributo `hidden`, pero
  `.im__stage` (flex), `.im__overlay` y `.im__countdown` (grid) declaran su propio `display`,
  que pisa el `display: none` del user-agent. Sin la regla `.im [hidden] { display: none
  !important; }` de `style.css` el cartel de "esperando" y el **"YA" del countdown quedan
  clavados arriba de la escena**: la partida corre atras pero no se puede jugar. No sacar
  (Basta tenia el mismo bug; word-bomb y word-chain ya traian la regla). Si se agrega otro
  elemento que se apague con `hidden`, va adentro de `.im`.
- Los tipos del protocolo estan **duplicados** en cliente y server a proposito (decoupling).
  Mantenerlos en sync a mano; requiere redeploy del server al tocarlos.
- El rol **nunca** va en `im:state` (solo por `im:you`). No mover la palabra/impostor al broadcast:
  se podria espiar desde la consola quien es el impostor.
- Los votos viajan **crudos** en `im:state` (`votes: {voter,target}[]`), no como contador ni flag
  "mine": el cliente cuenta por sospechoso y deriva el propio (`voter === me`). A proposito, para que
  `im:state` sea un unico broadcast (no per-cliente).
- Puntaje de sala placement-based y **no** va al ranking global (como el resto de las salas).
