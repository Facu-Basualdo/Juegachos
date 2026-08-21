# Bomba Palabra (word-bomb)

Bomba de palabras por turnos (estilo BombParty), **solo de sala**. Aparece un
fragmento (una silaba o combo de 2-3 letras) y el jugador de turno tiene hasta
que se agota la mecha para escribir una **palabra real** en espanol que lo
contenga y no se haya usado. Si la mecha explota pierde una vida; al quedarse sin
vidas queda eliminado. **Gana el ultimo en pie.**

Es el primer juego que usa el **game server autoritativo** (`server/`, socket.io
en Railway): a diferencia del resto del repo, su estado en-ronda NO vive en
Supabase sino en el server, que ademas valida cada palabra contra un diccionario
de espanol embebido (no spoofeable, y sin peso en el bundle del front). Ver la
seccion "Game server" del `CLAUDE.md` raiz.

## Solo de sala (sin modo un jugador)

No tiene modo solo: sin `?room=` muestra un cartel "Solo en salas" con link a
`/rooms/`. Sin las credenciales de Supabase o sin `VITE_GAME_SERVER_URL` muestra
"No disponible". **Esto es una excepcion deliberada a la regla de degradacion**
del repo (el resto de los juegos siguen jugables sin credenciales): Bomba Palabra
existe por el server, no puede funcionar sin el. Aparece en la landing (para
descubrirlo) y en el picker/votacion de salas como cualquier otro juego de sala.

## Reparto de responsabilidades

- **Supabase / RoomMode**: lobby, briefing, marcador acumulado, rejoin, deadline
  de ronda (corte duro). Igual que Ta-Te-Ti: `initRoomMode("word-bomb", {...})`,
  y al terminar `room.reportScore(...)` en vez de `hud.showRanking(...)`. El
  puntaje de la ronda es **placement-based** (mayor = mejor): `ranking.length -
  place`, asi el ultimo en pie (place 1) suma mas. No va al ranking global.
- **Game server** (`/wordbomb`): turno actual, mecha (deadline absoluto), vidas,
  set de palabras usadas, validacion y orden de eliminacion. Difunde `wb:state`
  en cada cambio; el cliente anima la mecha localmente entre snapshots. Tambien
  retransmite las reacciones (ver abajo).

## Module layout

- `main.ts` — monta `Game` en `#app`.
- `game/Game.ts` — orquestador: detecta modo sala (`initRoomMode`), muestra los
  carteles de "solo en salas" / "no disponible", corre el countdown 3/2/1/YA
  (disparado por `onStart` de RoomMode al pasar la ronda a "playing"), conecta el
  transporte al server, renderiza los `wb:state`, maneja rechazos/tipeo y reporta
  el puntaje en el `wb:gameover`.
- `game/Hud.ts` — DOM "fiesta de la bomba" (ver DESIGN.md): los jugadores forman un
  **circulo** alrededor de la **bomba central** (repartidos por angulo, `i*360/n`
  desde arriba, soporta 2-8 jugadores). Cada jugador es una columna: **nombre
  arriba**, **personaje** (bocha violeta `CHARACTER_SVG` con **cara reactiva**: todas
  las variantes de ojos/cejas/boca/sudor viven en el SVG y el CSS muestra la que toca
  segun las clases de la tarjeta —`is-turn` concentrado, `is-out` muerto con ojos en
  X, `is-happy` feliz al acertar— y el `is-critical` del stage —panico con sudor y
  globo "RAPIDO!"—; `stage.is-critical` lo togglea `tickFuse`). Corazones/calavera van
  **dibujados** (`HEART_SVG`/`SKULL_SVG`, nada de emojis), y **debajo lo que escribe**. La **bomba** es cartoon: esfera con brillo (`.wb__bomb`), **collar
  metalico** (`.wb__collar`), **mecha trenzada con chispa** que titila
  (`.wb__wick`/`.wb__spark`), apoyada en un **socket de luz ambar** (`.wb__socket`);
  el fragmento va en **tiza** blanca. De fondo suben **brasas** (`.wb__embers`,
  sembradas por `buildEmbers` con posicion/tiempos random). Una **flecha amarilla
  gira** apuntando al jugador de turno (por fuera del anillo y de la mecha, distancia
  `clamp(96px,20vmin,150px)` para no encimarse); su nombre se pone **verde**. **No hay caja de texto**: un
  `<input>` invisible (opacity 0, cubre la arena) captura el tecleo y summonea el
  teclado en movil, y el texto se refleja bajo el avatar propio; el tipeo ajeno
  llega por el relay `wb:typing` y se muestra bajo el avatar del rival de turno
  (el **eco del tipeo propio se ignora** en `Game.ts` — llega con lag y pisaria lo
  recien escrito, causando parpadeo). La ultima palabra aceptada de cada jugador
  queda bajo su avatar (`lastWords` en `Game.ts`). **La mecha es visible para todos**:
  un **anillo alrededor de la bomba** (un **arco de 300deg con hueco arriba** — SVG
  rotado -60deg — para no cruzar la mecha) se consume, con los **segundos** bajo el
  fragmento (de chispa amarilla a rojo, con pulso al final). El server manda
  `fuseMs`/`fuseTotalMs` en cada `wb:state` y `Hud.setFuse` los ancla a
  `performance.now()` para animar sin drift de reloj entre maquinas; el rAF corre
  solo en la Hud (`tickFuse`) y `clearFuse` lo detiene fuera de juego. La **mecha**
  (`.wb__wick`) tambien se **quema** con el tiempo (`Hud.tickFuse` acorta su alto con
  `frac^WICK_EXP`, no lineal, para que su quemado coincida con el vaciado del anillo;
  se resetea sola por turno). Al **perder una vida** la bomba **explota**
  (`Hud.flashExplosion`: fogonazo + onda + esquirlas + sacudida, ~700ms), disparada
  desde `Game.playDiffSounds` cuando cae una vida. El server sigue siendo el arbitro
  real del deadline (hace explotar la bomba). Los estados de
  espera/resultados/tablero final los cubre el `RoomOverlay` compartido por encima.
- `game/WordBombTransport.ts` — interfaz de transporte + tipos que **espejan**
  `server/src/protocol.ts` (no se comparte modulo entre `src/` y `server/` por la
  regla de decoupling; si cambia el protocolo, tocar los dos lados).
- `game/SocketTransport.ts` — implementacion socket.io-client (import dinamico)
  contra el namespace `/wordbomb`. Anuncia `{code, nickname, roster}`; el server
  fija el orden de turnos con el `roster` (= `room.players()`, por `joined_at`).
- `game/SoundEffects.ts` — Web Audio sintetizado (countdown tick, sello de
  aceptada, zumbido de rechazo, explosion, ganar/perder) + fallback de reacciones.
- `game/EmoteAudio.ts` — samples mp3 de las reacciones, con fallback al sintetizado.
- `game/audioContext.ts` — el `AudioContext` compartido por los dos de arriba.
- `game/constants.ts` — countdown, paleta y umbral de peligro de la mecha. La URL
  del server **no** vive aca: la resuelve `shared/server-status.ts` (principal con
  caida al respaldo); `Game.ts` usa `isGameServerConfigured()` / `resolveGameServerUrl()`.

## Flujo de una ronda

1. RoomMode pasa la sala a "playing" y dispara `onStart` -> `beginCountdown()`.
2. El countdown arranca y en paralelo el cliente conecta al server (`connect()`),
   anunciando el roster.
3. El server arranca la partida cuando **todos los del roster** conectaron, o al
   vencer una gracia (`START_GRACE_MS`, 8s). Los del roster que no conectaron a
   tiempo quedan afuera (miran).
4. Se juega por turnos hasta que queda uno vivo -> `wb:gameover` con el ranking.
5. Cada cliente reporta su puntaje placement-based; el `RoomOverlay` muestra el
   resultado de la ronda y el marcador acumulado.

## Reacciones (las "caritas")

Durante la partida cualquier jugador puede mandar una reaccion, y lo que cambia es
**la cara de su propio personaje** por `EMOTE_MS` (1.8s) mas un salto del avatar.
**No son emojis** (el repo los prohibe): el protocolo manda un **id** de un allowlist
cerrado (`risa` / `sorpresa` / `enojo` / `burla` / `llanto`) y cada cara esta
**dibujada en el SVG** del personaje, igual que los corazones y la calavera.

- **Quien y cuando**: todos los jugadores del roster, vivos o eliminados (el muerto
  burlandose es medio la gracia) y tambien el de turno. **Los espectadores no**: nunca
  llegan a conectar al game server, porque `RoomMode.applyState` corta antes de
  `autoStartGame` para ellos y `onStart` (que dispara el `connect()`) jamas se llama.
- **Animacion**: cada cara **se mueve** mientras dura la reaccion (bloque "Caras vivas" en
  `style.css`): keyframes CSS sobre los paths del SVG, sin video ni sprites. La **risa es una
  rana** (cuerpo verde, ojos saltones, saltitos), dos lagrimas alternadas en el llanto,
  temblor y cuerpo recalentado en el enojo, guino en la burla. Los rasgos animables llevan un
  gancho `wb__a-*` puesto en el `Hud` (asi el CSS no depende de `nth-of-type`). **Gotcha**:
  `transform-box: fill-box` es obligatorio, o el transform SVG toma como origen la esquina del
  `viewBox`. **Gotcha de cascada**: para tenir el cuerpo hay que ganarle a `.is-out.is-emote
  .wb__face-body` (0,4,0); el enojo le gana sin querer porque su color lo pone una animacion
  (las animaciones pisan las declaraciones normales), y la risa necesita el `.is-emote` extra
  o el eliminado que se rie queda violeta con ojos de rana. Se apagan con
  `prefers-reduced-motion`.
- **Sonido**: cada reaccion suena con un **sample real** (`game/EmoteAudio.ts`), unica
  excepcion del repo a la regla de sintetizar todo con Web Audio. Los mp3 viven en
  `public/sfx/emotes/<id>.mp3` (ver su README) y se precargan en el constructor del
  `Game`. **Degrada**: si el mp3 falta o no decodifica, cae a la voz sintetizada de
  `SoundEffects.playEmote(id)` (risa de tres silabas, "oh!" que sube, gruñido grave,
  cantito de burla, dos sollozos). Ojo que en `npm run dev` un archivo faltante **no da
  404**: Vite responde 200 con el index.html y falla el decode; el mismo `catch` lo cubre.
  Suenan para todos, asi que van bajas (pico <= 0.09 las sintetizadas, `SAMPLE_GAIN` = 0.45
  los samples). `blip()` acepta un `delay` para encadenar silabas. **Los samples se superponen
  a proposito**: duran entre 1.2s y 5s, mas que el cooldown de 1s y mas que la cara, asi que
  con la mesa llena se apilan. Es deliberado; no cortar el anterior ni limitar la duracion. El `AudioContext` vive en `game/audioContext.ts`
  (modulo hoja, para que el fallback no cierre un ciclo de imports con `EmoteAudio`).
- **Como**: dock de cabecitas en la **esquina inferior derecha** (`.wb__emotes`, z-index
  por encima del input invisible) o atajos **1-5**. Estaba **centrado abajo** y le tapaba
  la palabra al jugador de las 6 en punto — o sea, el de turno no podia leer lo que
  escribia. Medido con Playwright sobre el HUD real: pasaba desde 1366x768 para abajo, con
  2, 4, 5, 6 y 8 jugadores. Ver "El dock nunca puede tapar una palabra" mas abajo. Los atajos escuchan en `window` y hacen `preventDefault`,
  lo que cancela la insercion del digito en el input del jugador de turno — no se
  pierde nada, las palabras son solo `[a-zñ]`. El boton hace `preventDefault` en su
  `pointerdown` para **no robarle el foco al input** a mitad de palabra.
- **Server** (`wb:emote`): puro relay. Valida el id contra el allowlist, aplica un
  cooldown de 1s por jugador y difunde `{player, emote}`. **No toca el estado de la
  partida ni entra en `wb:state`**, asi que es efimera: quien recarga la pagina no
  revive las reacciones viejas. El dock tiene su propio cooldown (1.2s, un poco mas
  largo) solo para no ofrecer un boton que el server va a descartar en silencio.
- **La cara propia se pinta con el eco del server**, no de forma optimista: uno ve
  exactamente lo mismo que ven los demas y el cooldown del server es el unico arbitro.
  (Es lo contrario de `wb:typing`, que **si** se pinta local y **ignora** su eco,
  porque llega por tecla y con lag pisaria lo recien escrito.)

**El dock nunca puede tapar una palabra.** Es la regla que manda sobre la estetica: lo que
el jugador de turno escribe se lee bajo su avatar, y si no lo ve, no puede jugar. Tres capas,
las tres necesarias (medidas con Playwright sobre el HUD real, 2-8 jugadores):

1. El dock vive en la **esquina inferior derecha**, no centrado abajo (ver arriba). Solo con
   eso desaparecen los 75 casos de solape del barrido de escritorio/tablet/celular.
2. `.wb__player` tiene **z-index 25**, por encima del dock (20), y `pointer-events: none`:
   la palabra se dibuja **sobre** el dock y los botones se siguen pudiendo tocar por abajo
   (la tarjeta no tiene nada interactivo). Es la garantia dura, no depende de la geometria.
3. En pantallas **bajas** (`max-height: 500px`: celular apaisado, o vertical con el teclado
   abierto — el stage es `100dvh` y se achica) el dock pasa a **columna sobre el borde
   derecho**: ahi el circulo ocupa todo el alto y la esquina de abajo deja de estar libre,
   pero la banda lateral sobra (la arena es cuadrada, 92vmin). Mas un **halo oscuro** en
   `.wb__word` para que la palabra se lea sobre cualquier fondo.

Cadena de Palabras tiene su propia copia de las tres capas (cada juego tiene su CSS; tocar
uno no toca el otro).

**Gotcha del DOM**: `Hud.render()` reconstruye todas las tarjetas en cada `wb:state`
(que llega en cada turno y en cada palabra aceptada). Por eso la reaccion vigente vive
en `Hud.emoteState` y se **re-aplica** al crear la tarjeta; si se apoyara solo en la
clase del nodo, la cara se borraria al primer snapshot. El "pop" no se repone en el
re-render (ya sono al llegar la reaccion).

**Gotcha del CSS**: los rasgos automaticos van en `<g class="wb__base-face">` y los de
reaccion en `<g class="wb__emote-face">`. Son **grupos excluyentes**: reaccionar apaga
el grupo entero. Es a proposito — las caras automaticas se seleccionan con hasta cinco
clases (`.wb__stage.is-critical .wb__player.is-turn .wb__mouth--panic`), asi que pisar
rasgo por rasgo obligaria a una guerra de especificidad; ocultar el `<g>` padre la evita.

**Agregar una reaccion**: sumar el id a `EMOTES` en `game/constants.ts`, dibujar su cara
en `EMOTE_FACES` de `game/Hud.ts`, sumar la regla `is-emote--<id>` en `style.css`, y
sumar el id al allowlist `EMOTES` de `server/src/games/wordbomb.ts` **y** al tipo
`WbEmoteId` de `server/src/protocol.ts` + `game/WordBombTransport.ts` (los tipos estan
duplicados a proposito, ver Gotchas). Requiere redeploy del server.

## Diccionario y fragmentos (server-side)

`server/src/dictionary.ts` carga `an-array-of-spanish-words` (~636k palabras)
**mas las palabras extra de `server/src/extra-words.ts` y los toponimos de
`server/src/places.ts`** (paises, capitales y ciudades, agregados para Cadena de
Palabras y compartidos con este juego: sumaron el fragmento jugable `air`),
normaliza (minuscula,
saca acentos de vocales y dieresis pero **conserva la ñ**, descarta lo que no sea
`[a-zñ]`) y **precomputa los fragmentos jugables**: todas las subcadenas de 2-3
letras que existen en al menos `MIN_WORDS_PER_FRAGMENT` (500) palabras (~1800
fragmentos). Asi nunca se ofrece un reto sin solucion. Una palabra es valida si
(contiene el fragmento) + (esta en el diccionario) + (no se uso antes en la
partida).

**Agregar palabras**: editar el array `EXTRA_WORDS` en
`server/src/extra-words.ts` (jerga, regionalismos, terminos que el diccionario
base no trae) o `PLACES` en `server/src/places.ts` (toponimos). Se normalizan y
suman igual que el resto via el helper `ingest`;
sumar palabras las hace **validas como respuesta** pero no crea fragmentos nuevos
(eso depende de `MIN_WORDS_PER_FRAGMENT`; una lista corta no llega al umbral).
El diccionario se arma al arrancar el proceso, asi que **hay que redeployar el
server en Railway** tras editar.

## Tuning (server, `server/src/games/wordbomb.ts`)

- `STARTING_LIVES` (3), mecha `FUSE_BASE_MS` (13s) que se acorta `FUSE_STEP_MS`
  (150ms) por palabra aceptada con piso `FUSE_MIN_MS` (6s), `START_GRACE_MS` (8s).
- Desconexion = NO elimina: la mecha castiga el turno del ausente como a un AFK y,
  si vuelve (recarga de pagina), se reengancha. Solo se elimina al quedarse sin
  vidas.
- Reto (silaba/combo) y su dificultad se ajustan con `MIN_WORDS_PER_FRAGMENT` y
  `FRAGMENT_LENGTHS` en `dictionary.ts`.

## Gotchas

- Los tipos del protocolo estan **duplicados** en cliente y server a proposito
  (regla de decoupling del repo). Mantenerlos en sync a mano.
- La mecha del cliente es solo visual: la verdad la tiene el server (el `setTimeout`
  del deadline). Si hay drift de reloj, el corte real lo decide el server.
- El puntaje de sala es placement-based y **no** va al ranking global (como el
  resto de los juegos de sala).
