# Telefono Cortado (telefono-cortado)

Telefono descompuesto con dibujos, **solo de sala**. Cada jugador escribe una frase
secreta; despues le llega la frase de **otro** y la dibuja; despues le llega el dibujo
de un **tercero** y tiene que adivinar la frase original. Al final se revelan las
cadenas completas (frase -> dibujo -> adivinanza).

Estuvo fuera del roster (`hidden: true`) del 2026-08-10 al 2026-09-25 por los bugs de
abajo ("Lo que se arreglo al volver al roster"); `added` lleva la fecha de la vuelta.

Juego con **game server autoritativo** (`server/`, socket.io en Railway), como Bomba
Palabra / Cadena de Palabras / PONG / Basta / Impostor. Como Basta e Impostor, el
server **NO consulta el diccionario**: solo arbitra el flujo (fases + deadlines),
guarda las frases y los dibujos, valida las adivinanzas y computa el puntaje. Ver la
seccion "Game server" del `CLAUDE.md` raiz.

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
  `ranking.length - place`, con empates compartidos (dos primeros reportan lo mismo). El
  parcial (`getScore`, si alguien se va antes del gameover) usa **la misma escala**: el
  placement segun los totales del ultimo estado, no el total crudo (un parcial de 250
  le ganaria a un final de 3). El ranking global cuenta victorias en sala (`ranking: "wins"` en `meta.ts`): el puesto viaja aparte en `reportScore(score, { place, players })`.
- **Game server** (`/telefonocortado`): frases, asignacion de cadenas, dibujos,
  validacion de las adivinanzas, puntaje y las transiciones de fase (todas con
  `setTimeout` propio, no dependen del host del room).

Como el server arbitra sus fases solo, la partida llega a "over" aunque todos esten
idle => **NO declara `roomTimeLimitSec`** (igual que Basta / Impostor / Bomba / Cadena /
Pong). Y como el puntaje es `direction: "higher"` (default), `meta.ts` **omite**
`scoring`. El unico agujero de eso es un server que no contesta nunca: lo cubre
`CONNECT_TIMEOUT_MS` (ver "Server caido").

## Flujo de un partido (fases del server, `TcPhase`)

1. `waiting` — espera a que conecte el roster (gracia `START_GRACE_MS` = 8s). Arranca
   apenas estan todos conectados o al vencer la gracia.
2. `writing` — cada uno escribe su frase (`tc:phrase`). Tope `WRITE_MS` (40s). Al que no
   llego se le asigna una del banco (`PHRASE_BANK`, ~80 frases): su cadena se juega
   igual, y el reveal la marca como "Frase sorteada" (`TcChainView.filled`).
   **Con menos de `MIN_PLAYERS_TO_WRITE` (3) jugadores esta fase no existe** y se pasa
   directo a `drawing` con frases del banco (ver "Rotacion").
3. `drawing` — el jugador `i` dibuja la frase del jugador `i-1`. Tope `DRAW_MS` (100s).
   El dibujo va en `tc:draw` como dataURL **JPEG reducido** (ver "Peso de los dibujos").
4. `guessing` — a cada uno le toca un dibujo cuya frase **no conoce**. Tope `GUESS_MS`
   (60s), intentos ilimitados. Cada `tc:guess` lo juzga el **server** (ver "Adivinanza
   tolerante"); el cliente nunca tiene la frase.
5. `reveal` — se difunden las cadenas completas y se muestran. Dura
   `REVEAL_BASE_MS` (8s) + `REVEAL_PER_CHAIN_MS` (4s) por cadena, con tope
   `REVEAL_MAX_MS` (40s).
6. `over` — `tc:gameover` con el ranking por puntaje; cada cliente reporta su placement.
   La galeria **sigue montada** (el `viewKey` de reveal y over es el mismo).

Cualquier fase se **cierra antes del deadline** si ya entregaron todos los jugadores que
siguen conectados (`maybeAdvance`); no se espera a los ausentes, igual que el resto de
las salas.

**Autoenvio al cierre (`AUTO_SUBMIT_MARGIN_MS`, 2.5s).** Cuando al reloj le queda ese
margen, el `Hud` manda solo lo que haya en pantalla: la frase tipeada sin enviar, o el
dibujo a medio hacer. Antes el que no apretaba "Enviar" a tiempo perdia el dibujo
entero y **su cadena quedaba sin nada que adivinar** para otro jugador. Un lienzo en
blanco no se manda (tampoco con el boton: avisa "Dibuja algo"). El chequeo corre en un
`setInterval`, no en el rAF del reloj: el rAF se pausa en una pestaña en segundo plano.

## Rotacion de cadenas

`chains[i].owner === seats[i]` (el orden del roster de Supabase, por `joined_at`, que es
el mismo en todos los clientes). La regla de quien puede adivinar una cadena es una sola
(`knowsPhrase`): **no el que la dibujo, y no el que la escribio salvo que la frase sea
del banco** (`filled`, o sea que tampoco la conoce).

- **3+ jugadores (con escritura):** el dibujo se corre **un** asiento (`i` dibuja la
  cadena `i-1`) y la adivinanza **dos** (`i` adivina la cadena `i-2`), asi que a nadie le
  toca su propia frase ni su propio dibujo.
- **1-2 jugadores (sin escritura):** cada uno dibuja la frase del banco de **su** cadena
  (nadie mas la conoce) y adivina la del **otro**. Antes habia fase de escritura igual, y
  con dos jugadores el unico candidato a adivinar cada frase era el que la escribio: un
  fallback de `assignGuessers` ("cualquiera libre") le daba **a cada uno su propia
  frase**. Ese fallback ya no existe: si no hay cadena valida, al jugador le toca mirar.
  Con uno solo nadie puede adivinar y se salta al reveal.

`assignGuessers` respeta la preferencia de desplazamiento pero gira hasta encontrar una
cadena libre, **con dibujo** y cuya frase el jugador no conozca. Si nadie llego a
dibujar nada, salta directo al reveal.

## Adivinanza tolerante

La comparacion exacta era injugable: una frase libre de 20-30 letras no se acierta
caracter por caracter, y "perro en bicicleta" fallaba contra "Un perro en bicicleta".
`judgeGuess` compara la forma **compacta** de las dos (`compact`: minusculas, sin
acentos, ñ conservada, **sin articulos** `un/una/unos/unas/el/la/los/las`, sin espacios
ni puntuacion) con distancia de edicion, y tolera errores en proporcion al largo
(0 hasta 4 letras, 1 hasta 9, 2 hasta 16, 3 despues). Mas lejos, pero a menos de ~30%
del largo, devuelve `"close"` y el cliente muestra "esta muy cerca" en amarillo.

El server avisa cada intento con `tc:you.attempts` (y `close`): comparar `submitted`
no alcanzaba, porque repetir el mismo intento fallido no lo cambiaba y el cliente no
mostraba nada. La validacion sigue siendo **server-side**; no mover esa comparacion al
cliente: le daria la frase.

## Pista tipo ahorcado

`HINT_EVERY_MS` (10s) revela una letra al azar por cadena sin resolver, dejando siempre
`HINT_KEEP_HIDDEN` (3) tapadas. Solo se tapan letras y numeros: espacios y puntuacion
viajan tal cual. El cliente la dibuja **por palabras** (`renderHint`: una casilla por
letra, las tapadas subrayadas, las palabras separadas y con salto de linea); antes era
el texto con espacios intercalados y no se veia donde terminaba cada palabra.

## Puntaje

- Acertar: `POINTS_GUESS` (100) + hasta `POINTS_SPEED_MAX` (50) por reloj restante.
- El **dibujante** de una cadena acertada: `POINTS_ARTIST` (100).
- El **autor** de una cadena acertada: `POINTS_AUTHOR` (50), solo si la escribio el
  (no si la frase es del banco). Premia escribir algo dibujable.

## Peso de los dibujos

El lienzo es de 800x500 pero **no** se manda su PNG: se exporta a `EXPORT_WIDTH` x
`EXPORT_HEIGHT` (400x250) en JPEG `EXPORT_QUALITY` (0.6), o sea ~30-60KB por dibujo en
base64. Importa porque en el reveal el server retransmite todos los dibujos de la sala:
en PNG a resolucion completa, 8 jugadores pasarian holgado el `maxHttpBufferSize` de
socket.io (1MB por defecto). Por lo mismo las cadenas se difunden **de a una**
(`tc:chain`, un mensaje por cadena) en vez de un array con todas, y el sim rechaza
cualquier dataURL de mas de `MAX_IMAGE_CHARS` (400k).

## Rondas, llegadas tarde y F5

- **Estado scopeado por ronda.** `tc:join` lleva `round` (`room.round()`), como Neon
  Drift / Manchon. Si la sala vuelve a votar este juego, el `GameRoom` de la partida
  anterior puede seguir vivo (en `over`) porque alguien no navego todavia: sin el scope,
  el que entraba recibia **el gameover viejo** y reportaba ese puntaje. Una ronda mas
  nueva resetea el sim; una pagina de una ronda vieja se ignora.
- **`joined`: presente = conectado Y anunciado en esta ronda.** `room.isConnected` no
  alcanza: el socket de la pagina vieja de un jugador (todavia en los resultados) esta
  en el mismo `GameRoom`, y contarlo como presente largaba la partida nueva sin
  esperarlo. Medido en la simulacion antes del arreglo.
- **Llegar tarde.** Un jugador del roster que se conecta con la partida ya en `writing`
  entra con su cadena (la rotacion se calcula recien al pasar a dibujo). Despues de eso
  queda como espectador: ve "La partida ya habia arrancado" y la galeria al final, y
  reporta 0.
- **F5.** Patron server-authoritative: **no** usa `roomRun.ts`/sessionStorage (como
  Basta/Bomba). Al reconectar el `join` reenvia el `tc:you` con la tarea del jugador (y
  lo que ya haya entregado, en `submitted`), el `tc:state` y, si la partida termino, las
  cadenas y el `tc:gameover`. Un dibujo a medio hacer **si** se pierde (no se va
  sincronizando trazo a trazo); recargar en plena fase de dibujo cuesta el dibujo, que
  es la penalidad natural.

## Server caido

`CONNECT_TIMEOUT_MS` (20s): si desde que arranca la conexion no llega ni un `tc:state`,
se muestra "Sin conexion" y se reporta un 0. Sin esto, como el juego no declara
`roomTimeLimitSec`, un server caido colgaba la ronda de la sala para siempre (nadie
reportaba). Una caida **despues** de haber jugado solo muestra el aviso "Reconectando"
(`Hud.setConnection`); socket.io reconecta solo y el `join` devuelve el estado.

## Lienzo

- **Pointer events con captura** (`setPointerCapture`): un solo camino para mouse,
  dedo y lapiz, y el trazo sigue aunque el puntero salga del lienzo. Reemplaza a
  mouse + touch por separado, el `mouseleave` que cortaba el trazo y el `mouseup` en
  `window` que habia que acordarse de remover. Usa `getCoalescedEvents` para las
  curvas rapidas.
- **Un toque deja un punto** (antes un clic sin arrastrar no dibujaba nada).
- **El marcador no se acumula.** Es translucido (`MARKER_ALPHA`): pintado de a
  segmento, cada superposicion sumaba opacidad y quedaba casi opaco y manchado. Ahora
  se repone el lienzo de antes del trazo y se redibuja el trazo entero de una.
- **Deshacer** (boton y Ctrl+Z, `UNDO_LIMIT` = 15 pasos de ImageData). El listener de
  teclado vive en `window` y se remueve en `disposeCanvas`; ignora el Ctrl+Z dentro de
  un `<input>`.
- Paleta de 14 colores y grosores `THICKNESSES` (3/6/12/24, arranca en
  `DEFAULT_THICKNESS`: antes arrancaba en 3, que no era ninguno de los botones).
- En escritorio la caja de herramientas va en **dos columnas** y el lienzo se achica con
  el alto de la ventana (`max-width` en funcion de `100vh`), asi la fase entra sin
  scroll en una notebook. En celular (<=768px) las herramientas pasan a una fila arriba
  del lienzo.

## Probar sin Supabase (`devRoom.ts`)

Copiado de `pista-loca`: `?dev=NICK&roster=A,B,C&code=TEST` juega contra el game server
local sin crear salas en la base real (solo en `import.meta.env.DEV`; Vite lo elimina
del build). Arranca solo al segundo y el puntaje va a la consola y a
`window.__tcScore`. Para apuntar el front al server local sin tocar `.env.local`:
`VITE_GAME_SERVER_URL=http://localhost:8787 VITE_GAME_SERVER_FALLBACK_URL=http://localhost:8787 npm run dev`
(las variables del proceso le ganan a los `.env`), y `npm run dev` dentro de `server/`.
Una pestaña por jugador, todas con el mismo `code` y `roster`.

## Module layout

- `main.ts` — monta `Game` en `#app`.
- `game/Game.ts` — orquestador: detecta modo sala (`initRoomMode`, o `devRoom` en
  desarrollo), carteles, countdown 3/2/1/YA (dispara `connect()` en paralelo), enruta
  `tc:state` / `tc:you` / `tc:chain` al Hud (descarta la tarea si es de otra fase),
  sonidos de fase / fallo / acierto, timeout de conexion, y reporta el placement en
  `tc:gameover`.
- `game/Hud.ts` — todo el DOM: topbar (titulo de fase + reloj), roster, aviso de
  conexion, y una vista por fase (escribir / dibujar / adivinar / galeria / espectador).
  Incluye el lienzo completo (lapiz, marcador, balde, circulo, rectangulo, goma, 4
  grosores, paleta, deshacer, borrar), el `floodFill` por scanline con tolerancia y el
  autoenvio.
- `game/TelefonoTransport.ts` — interfaz de transporte + tipos que **espejan**
  `server/src/protocol.ts` (regla de decoupling; si cambia el protocolo, tocar ambos lados).
- `game/SocketTransport.ts` — socket.io-client (import dinamico) contra `/telefonocortado`;
  avisa caidas y reconexiones (`onConnection`).
- `game/devRoom.ts` — sala falsa de desarrollo (ver arriba).
- `game/SoundEffects.ts` — Web Audio sintetizado (countdown tick 750Hz obligatorio, fase,
  envio, acierto, fallo, reveal, ganar/perder).
- `game/constants.ts` — countdown, medidas del lienzo y de la exportacion, paleta,
  grosores, deshacer, margen de autoenvio, timeout de conexion.

## Tuning (server, `server/src/games/telefonocortado.ts`)

- Fases: `START_GRACE_MS` (8s), `WRITE_MS` (40s), `DRAW_MS` (100s), `GUESS_MS` (60s),
  reveal `REVEAL_BASE_MS` (8s) + `REVEAL_PER_CHAIN_MS` (4s) por cadena, tope
  `REVEAL_MAX_MS` (40s).
- `MIN_PLAYERS_TO_WRITE` (3): por debajo, frases del banco y sin fase de escritura.
- Pista: `HINT_EVERY_MS` (10s), `HINT_KEEP_HIDDEN` (3).
- Puntaje: `POINTS_GUESS` (100), `POINTS_SPEED_MAX` (50), `POINTS_ARTIST` (100),
  `POINTS_AUTHOR` (50).
- Tolerancia de la adivinanza: umbrales en `judgeGuess`.
- Largos: `MAX_PHRASE_LEN` / `MAX_GUESS_LEN` (60), `MAX_IMAGE_CHARS` (400k).
- Banco: `PHRASE_BANK` (editable a mano; requiere redeploy del server).

## Gotchas

- Los tipos del protocolo estan **duplicados** en cliente y server a proposito
  (decoupling). Mantenerlos en sync a mano; requiere redeploy del server al tocarlos.
  **El cliente nuevo necesita el server nuevo** (`round` en el join, `attempts` /
  `close` en `tc:you`): deployar los dos juntos.
- **La vista de una fase no se reconstruye en cada snapshot.** El `Hud` calcula una firma
  (`viewKey`) y solo rebuildea cuando cambia la tarea; si no, refresca reloj, roster y
  pista. Reconstruir en cada `tc:state` perderia el foco del input, lo tipeado y el
  dibujo a medio hacer.
- **`tc:you` va antes que `tc:state` al cambiar de fase** (`announce()`), y aun asi
  `Game.applyState` descarta la tarea si es de otra fase. Al reves, el cliente pintaba
  la fase nueva con la tarea de la anterior: al pasar a dibujo, la frase recien escrita
  aparecia como un "dibujo enviado" roto hasta que llegaba la tarea nueva.
- **El Enter de los inputs se corta con `stopPropagation`.** Todos los juegos del repo
  atan su countdown a un `keydown` en `window`; sin cortarlo, apretar Enter para mandar
  la frase dispararia tambien ese countdown (era un bug real de la primera version).
- Los titulos de `showMessage` van por `innerHTML` (traen entidades como `&eacute;`);
  con `textContent` se leia "Tel&eacute;fono" literal en pantalla.
- La barra del reloj **no** tiene `transition` de ancho: ya se anima cuadro a cuadro,
  y la transicion de 1s la dejaba un segundo atrasada.
- El puntaje de sala es placement-based, asi que **no** es una marca: el ranking global de este juego cuenta **victorias en sala** (`scoring.ranking: "wins"` en `meta.ts`; el game-over pasa `{ place, players }` a `reportScore`, y el que no figura en el ranking del server — entro tarde — reporta `{ ranked: false }`). Ver "Global rankings" en el CLAUDE.md raiz.
