# Telefono Cortado (telefono-cortado)

> **Fuera del roster.** `meta.ts` declara `hidden: true`, asi que no aparece ni en la
> landing ni en el picker / votacion de salas (igual que Basta e Impostor). El codigo y
> su sim del server (`server/src/games/telefonocortado.ts`) siguen en el repo: para
> volver a habilitarlo, sacar esa linea del `meta.ts`.

Telefono descompuesto con dibujos, **solo de sala**. Cada jugador escribe una frase
secreta; despues le llega la frase de **otro** y la dibuja; despues le llega el dibujo
de un **tercero** y tiene que adivinar la frase original. Al final se revelan las
cadenas completas (frase -> dibujo -> adivinanza).

Es el 6to juego con **game server autoritativo** (`server/`, socket.io en Railway),
como Bomba Palabra / Cadena de Palabras / PONG / Basta / Impostor. Como Basta e
Impostor, el server **NO consulta el diccionario**: solo arbitra el flujo (fases +
deadlines), guarda las frases y los dibujos, valida las adivinanzas y computa el
puntaje. Ver la seccion "Game server" del `CLAUDE.md` raiz.

## Solo de sala (sin modo un jugador)

No tiene modo solo: sin `?room=` muestra "Solo en salas" con link a `/rooms/`. Sin
credenciales de Supabase o sin `VITE_GAME_SERVER_URL` muestra "No disponible".
**Excepcion deliberada a la regla de degradacion** del repo (igual que Bomba / Cadena /
Basta / Impostor). Aca el server no es comodidad sino diseño: es el unico que conoce
las frases secretas. Si la frase a adivinar viajara al cliente, se leeria desde las
devtools y adivinar no valdria nada.

## Reparto de responsabilidades

- **Supabase / RoomMode**: lobby, briefing, marcador acumulado, rejoin.
  `initRoomMode("telefono-cortado", {...})`; al terminar `room.reportScore(...)` en vez
  de `hud.showRanking(...)`. Puntaje de la ronda **placement-based** (mayor = mejor):
  `ranking.length - place`. No va al ranking global.
- **Game server** (`/telefonocortado`): frases, asignacion de cadenas, dibujos,
  validacion de las adivinanzas, puntaje y las transiciones de fase (todas con
  `setTimeout` propio, no dependen del host del room).

Como el server arbitra sus fases solo, la partida llega a "over" aunque todos esten
idle => **NO declara `roomTimeLimitSec`** (igual que Basta / Impostor / Bomba / Cadena /
Pong). Y como el puntaje es `direction: "higher"` (default), `meta.ts` **omite**
`scoring`.

## Flujo de un partido (fases del server, `TcPhase`)

1. `waiting` — espera a que conecte el roster (gracia `START_GRACE_MS` = 8s). Arranca
   apenas estan todos conectados o al vencer la gracia.
2. `writing` — cada uno escribe su frase (`tc:phrase`). Tope `WRITE_MS` (40s). Al que no
   llego se le asigna una de `FALLBACK_PHRASES`: su cadena se juega igual, y el reveal
   la marca como "Frase automatica" (`TcChainView.filled`).
3. `drawing` — el jugador `i` dibuja la frase del jugador `i-1`. Tope `DRAW_MS` (100s).
   El dibujo va en `tc:draw` como dataURL **JPEG reducido** (ver "Peso de los dibujos").
4. `guessing` — a cada uno le toca un dibujo **ajeno** de una frase **ajena** (ver
   "Rotacion"). Tope `GUESS_MS` (50s), intentos ilimitados. Cada `tc:guess` lo compara el
   **server** contra la frase normalizada; el cliente nunca la tiene. Acertar da
   `POINTS_GUESS` (100) + hasta `POINTS_SPEED_MAX` (50) por reloj restante, y el
   **dibujante** cobra `POINTS_ARTIST` (100) por haber sido entendido.
5. `reveal` — se difunden las cadenas completas y se muestran. Dura
   `REVEAL_BASE_MS + REVEAL_PER_CHAIN_MS * cadenas`, con tope `REVEAL_MAX_MS` (30s).
6. `over` — `tc:gameover` con el ranking por puntaje; cada cliente reporta su placement.

Cualquier fase se **cierra antes del deadline** si ya entregaron todos los jugadores que
siguen conectados (`maybeAdvance`); no se espera a los ausentes, igual que el resto de
las salas.

## Rotacion de cadenas

`chains[i].owner === seats[i]` (el orden del roster de Supabase, por `joined_at`, que es
el mismo en todos los clientes). El dibujo se corre **un** asiento (`i` dibuja la cadena
`i-1`) y la adivinanza **dos** (`i` adivina la cadena `i-2`), asi que con 3+ jugadores a
nadie le toca su propia frase ni su propio dibujo. `assignGuessers` respeta esa
preferencia pero gira hasta encontrar una cadena libre **con dibujo**, y cae a "cualquiera
libre" en salas de 1-2 jugadores, donde el desplazamiento colapsa por aritmetica. Si
nadie llego a dibujar nada, salta directo al reveal.

## Peso de los dibujos

El lienzo es de 800x500 pero **no** se manda su PNG: se exporta a `EXPORT_WIDTH` x
`EXPORT_HEIGHT` (400x250) en JPEG `EXPORT_QUALITY` (0.6), o sea ~30-60KB por dibujo en
base64. Importa porque en el reveal el server retransmite todos los dibujos de la sala:
en PNG a resolucion completa, 8 jugadores pasarian holgado el `maxHttpBufferSize` de
socket.io (1MB por defecto). Por lo mismo las cadenas se difunden **de a una**
(`tc:chain`, un mensaje por cadena) en vez de un array con todas, y el sim rechaza
cualquier dataURL de mas de `MAX_IMAGE_CHARS` (400k).

## Sobrevivir un F5

Patron server-authoritative: **no** usa `roomRun.ts`/sessionStorage (como Basta/Bomba).
Todo vive en el server, asi que al reconectar el `join` reenvia el `tc:state`, el
`tc:you` con la tarea del jugador (y lo que ya haya entregado, en `submitted`) y, si la
partida termino, las cadenas y el `tc:gameover`. Un dibujo a medio hacer **si** se pierde
(no se va sincronizando trazo a trazo); recargar en plena fase de dibujo cuesta el
dibujo, que es la penalidad natural.

## Module layout

- `main.ts` — monta `Game` en `#app`.
- `game/Game.ts` — orquestador: detecta modo sala (`initRoomMode`), carteles, countdown
  3/2/1/YA (dispara `connect()` en paralelo), enruta `tc:state` / `tc:you` / `tc:chain` al
  Hud, sonidos de fase, y reporta el placement en `tc:gameover`.
- `game/Hud.ts` — todo el DOM: topbar (titulo de fase + reloj), roster, y una vista por
  fase (escribir / dibujar / adivinar / galeria). Incluye el lienzo completo (lapiz,
  marcador, balde, circulo, rectangulo, goma, 4 grosores, paleta, borrar) y el
  `floodFill` por scanline con tolerancia.
- `game/TelefonoTransport.ts` — interfaz de transporte + tipos que **espejan**
  `server/src/protocol.ts` (regla de decoupling; si cambia el protocolo, tocar ambos lados).
- `game/SocketTransport.ts` — socket.io-client (import dinamico) contra `/telefonocortado`.
- `game/SoundEffects.ts` — Web Audio sintetizado (countdown tick 750Hz obligatorio, fase,
  envio, acierto, fallo, reveal, ganar/perder).
- `game/constants.ts` — countdown, medidas del lienzo y de la exportacion, paleta, grosores.

## Tuning (server, `server/src/games/telefonocortado.ts`)

- Fases: `START_GRACE_MS` (8s), `WRITE_MS` (40s), `DRAW_MS` (100s), `GUESS_MS` (50s),
  reveal `REVEAL_BASE_MS` (6s) + `REVEAL_PER_CHAIN_MS` (3s) por cadena, tope
  `REVEAL_MAX_MS` (30s).
- Pista: `HINT_EVERY_MS` (12s) revela una letra al azar por cadena sin resolver, dejando
  siempre `HINT_KEEP_HIDDEN` (2) tapadas. La pista va en `tc:you.hint` con las ocultas
  como "_": la frase completa **nunca** se manda antes del reveal.
- Puntaje: `POINTS_GUESS` (100), `POINTS_SPEED_MAX` (50), `POINTS_ARTIST` (100).
- Largos: `MAX_PHRASE_LEN` / `MAX_GUESS_LEN` (60), `MAX_IMAGE_CHARS` (400k).

## Gotchas

- Los tipos del protocolo estan **duplicados** en cliente y server a proposito
  (decoupling). Mantenerlos en sync a mano; requiere redeploy del server al tocarlos.
- **La vista de una fase no se reconstruye en cada snapshot.** El `Hud` calcula una firma
  (`viewKey`) y solo rebuildea cuando cambia la tarea; si no, refresca reloj, roster y
  pista. Reconstruir en cada `tc:state` perderia el foco del input, lo tipeado y el
  dibujo a medio hacer.
- **El Enter de los inputs se corta con `stopPropagation`.** Todos los juegos del repo
  atan su countdown a un `keydown` en `window`; sin cortarlo, apretar Enter para mandar
  la frase dispararia tambien ese countdown (era un bug real de la primera version).
- El listener de `mouseup` del lienzo vive en `window` (soltar el boton afuera termina el
  trazo) y se **remueve** en `disposeCanvas`. Montar el lienzo sin removerlo acumula un
  listener por fase de dibujo.
- La validacion de la adivinanza es **server-side** y normalizada (minusculas, sin
  acentos, ñ conservada, espacios colapsados). No mover esa comparacion al cliente: le
  daria la frase.
- Puntaje de sala placement-based y **no** va al ranking global (como el resto de las salas).
