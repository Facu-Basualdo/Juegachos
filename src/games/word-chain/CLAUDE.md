# Cadena de Palabras (word-chain)

Cadena de palabras por turnos, **solo de sala**. Al primer jugador le toca una **letra**
al azar y tiene que escribir una **palabra real** en espanol que **empiece** con ella; la
**ultima letra** de esa palabra es el reto del siguiente ("tronco" -> "o" -> "oso" -> "o"
-> ...). No se puede repetir una palabra ya usada. **Una sola vida**: si se te acaba el
reloj quedas eliminado en el acto. **Gana el ultimo en pie.**

Es un **fork de Bomba Palabra** (`word-bomb`): comparte la arquitectura (game server
autoritativo + RoomMode de Supabase), el layout de circulo, el personaje bocha con caras
reactivas y las reacciones. Lo que cambia es la mecanica (letra inicial encadenada en vez
de fragmento contenido), las vidas (1 en vez de 3) y la direccion de arte (forja en vez de
bomba, ver `DESIGN.md`). Los dos juegos conviven: ninguno importa codigo del otro (regla de
decoupling del repo), asi que **un cambio en Bomba Palabra no se propaga solo**.

## Solo de sala (sin modo un jugador)

No tiene modo solo: sin `?room=` muestra un cartel "Solo en salas" con link a `/rooms/`.
Sin las credenciales de Supabase o sin `VITE_GAME_SERVER_URL` muestra "No disponible".
**Esto es una excepcion deliberada a la regla de degradacion** del repo (el resto de los
juegos siguen jugables sin credenciales): igual que Bomba Palabra, existe por el server —
el diccionario vive ahi y la validacion no puede ser spoofeable. Aparece en la landing
(para descubrirlo) y en el picker/votacion de salas como cualquier otro juego de sala.

## Reparto de responsabilidades

- **Supabase / RoomMode**: lobby, briefing, marcador acumulado, rejoin, deadline de ronda
  (corte duro). `initRoomMode("word-chain", {...})`, y al terminar `room.reportScore(...)`
  en vez de `hud.showRanking(...)`. El puntaje de la ronda es **placement-based** (mayor =
  mejor): `ranking.length - place`, asi el ultimo en pie (place 1) suma mas. No va al
  ranking global.
- **Game server** (`/wordchain`): turno actual, letra del turno, reloj (deadline absoluto),
  vidas, set de palabras usadas, validacion y orden de eliminacion. Difunde `wc:state` en
  cada cambio; el cliente anima el anillo localmente entre snapshots. Tambien retransmite
  el tipeo y las reacciones.

## Reglas y sus casos borde (server, `server/src/games/wordchain.ts`)

- **Letra de arranque**: `randomInitial()` sortea entre las letras con al menos
  `MIN_WORDS_PER_INITIAL` (1000) palabras detras. Eso deja afuera **x** (185 palabras), **ñ**
  (317) e **y** (948), que como arranque son una condena, y adentro **q** y **u**, que son
  duras pero jugables. Quedan **22 letras** sorteables.
- **Letra encadenada**: es la ultima letra de la palabra **normalizada** (sin acentos, con
  ñ). "cancion" -> "n". Las **letras pobres se juegan igual** ("fax" -> te toca la X): es
  parte del riesgo del juego y es decision de diseno, no un bug. El unico guard es
  `hasInitial(letter)`: si la letra no tiene **ninguna** palabra detras (k y w no aparecen
  como inicial en el diccionario base) se sortea otra, porque eso dejaria la cadena muerta.
- **Timeout = eliminacion.** `STARTING_LIVES` es 1. Cuando expira el reloj, el jugador de
  turno queda afuera y **la cadena no avanza**: el siguiente hereda **la misma letra** que
  mato al anterior. Es lo justo (la letra no se resolvio) y encima es cruel, que es la
  gracia.
- **Reloj**: `CLOCK_BASE_MS` (12s) menos `CLOCK_STEP_MS` (200ms) por cada eslabon forjado,
  con piso `CLOCK_MIN_MS` (5s). Se acorta **por palabra**, no por vuelta, asi que la mesa se
  acelera sola a medida que la cadena crece.
- **Desconexion = NO elimina** por si misma: el reloj castiga el turno del ausente como a un
  AFK — y con una sola vida, ese timeout si lo elimina. Si vuelve antes (recarga de pagina)
  se reengancha.
- `START_GRACE_MS` (8s): espera a que se conecten los del roster; los que falten quedan
  afuera y miran.

## Module layout

- `main.ts` — monta `Game` en `#app`.
- `game/Game.ts` — orquestador: detecta modo sala (`initRoomMode`), muestra los carteles de
  "solo en salas" / "no disponible", corre el countdown 3/2/1/YA (disparado por `onStart` de
  RoomMode al pasar la ronda a "playing"), conecta el transporte al server, renderiza los
  `wc:state`, maneja rechazos/tipeo y reporta el puntaje en el `wc:gameover`.
- `game/Hud.ts` — DOM "cadena forjada" (ver DESIGN.md): los jugadores en **circulo**
  alrededor del **eslabon central** incandescente con la **letra** grabada, el **anillo del
  reloj** (circulo completo) alrededor, y una **flecha** que gira apuntando al de turno. Cada
  jugador es una columna: nombre, **su eslabon** (unica vida; **partido** al caer) con el
  contador de eslabones que aporto, personaje con cara reactiva, y debajo lo que escribe.
- `game/WordChainTransport.ts` — interfaz de transporte + tipos que **espejan**
  `server/src/protocol.ts`.
- `game/SocketTransport.ts` — implementacion socket.io-client (import dinamico) contra el
  namespace `/wordchain`. Anuncia `{code, nickname, roster}`; el server fija el orden de
  turnos con el `roster` (= `room.players()`, por `joined_at`).
- `game/SoundEffects.ts` — Web Audio sintetizado, en clave de forja: martillo en el yunque
  (aceptada), hierro que cede (quiebre), zumbido de rechazo, countdown tick, ganar/perder.
- `game/constants.ts` — countdown y allowlist de reacciones. La URL del server **no** vive
  aca: la resuelve `shared/server-status.ts` (principal con caida al respaldo); `Game.ts`
  usa `isGameServerConfigured()` / `resolveGameServerUrl()`.

## Flujo de una ronda

1. RoomMode pasa la sala a "playing" y dispara `onStart` -> `beginCountdown()`.
2. El countdown arranca y en paralelo el cliente conecta al server (`connect()`), anunciando
   el roster.
3. El server arranca la partida cuando **todos los del roster** conectaron, o al vencer
   `START_GRACE_MS`. Sortea la primera letra.
4. Se juega por turnos hasta que queda uno vivo -> `wc:gameover` con el ranking.
5. Cada cliente reporta su puntaje placement-based; el `RoomOverlay` muestra el resultado de
   la ronda y el marcador acumulado.

## Diferencias de implementacion con Bomba Palabra (leer antes de copiar y pegar)

- **`flashAccept` / `flashSnap` corren DESPUES de `render()`**, no antes. `render()`
  reconstruye todas las tarjetas en cada snapshot: animarlas antes es pintar sobre nodos que
  se estan por descartar y no se ve nada. Por eso `Game.applyState` esta partido en
  `diff(s)` (calcula que cambio y actualiza `lastWords`) -> `render(...)` -> `playDiff(...)`.
  Bomba Palabra hace `playDiffSounds` antes del render y su sello de "aceptada" se pierde.
- **El anillo del reloj es un circulo completo** (`TIMER_CIRC`), no un arco de 300deg: no hay
  mecha saliendo por arriba que esquivar. El SVG va rotado `-90deg` para empezar arriba.
- **No hay mecha que se queme** (`WICK_*`) ni explosion: hay un eslabon que se parte.
- **El dock de reacciones va en la esquina inferior derecha**, no centrado abajo: con 8
  jugadores hay uno a las 6 en punto y el dock centrado le tapaba la palabra. (Bomba
  Palabra arrastro el dock centrado un tiempo mas y termino corrigiendolo igual, pero
  cada juego tiene su copia del CSS: tocar uno no toca el otro.)
- **La flecha se oculta por debajo de 560px de ancho**: en la arena chica no queda banda
  libre entre el anillo del reloj y las tarjetas.
- **`lives` no viaja en `wc:state`** (siempre seria 1). Lo que viaja es `alive` y `links`
  (eslabones aportados por cada jugador).

## Reacciones (las "caritas")

Identicas a Bomba Palabra: cualquier jugador (vivo, eliminado o el de turno) manda una
reaccion y lo que cambia es **la cara de su propio personaje** por `EMOTE_MS` (1.8s) mas un
salto del avatar. **No son emojis**: el protocolo manda un **id** de un allowlist cerrado
(`risa` / `sorpresa` / `enojo` / `burla` / `llanto`) y cada cara esta **dibujada en el SVG**
del personaje. Dock en la esquina o atajos **1-5** (los digitos nunca son tecleo util: las
palabras son solo `[a-zñ]`). El server (`wc:emote`) es puro relay con cooldown de 1s por
jugador; **no toca el estado de la partida ni entra en `wc:state`**, asi que es efimera. La
cara propia se pinta con el **eco del server**, no de forma optimista (al reves que
`wc:typing`, que se pinta local y **ignora** su eco para no parpadear).

**Animacion**: cada cara **se mueve** mientras dura la reaccion, con keyframes CSS sobre los
paths del SVG (bloque "Caras vivas" en `style.css`) — nada de video ni sprites: pesan cero,
escalan perfecto y el cuerpo se sigue tinendo desde CSS. La **risa es una rana**: el cuerpo se
pone verde (`#52a447`), le salen ojos saltones por encima de la cabeza y pega saltitos con la
boca y la lengua; el llanto suelta **dos lagrimas alternadas**
(la derecha va media fase atrasada) sobre un puchero que tiembla; la sorpresa entra con un
golpe seco y late; el enojo tiembla, aprieta las cejas y se recalienta el cuerpo; la burla
sacude la lengua y guina. Los rasgos animables llevan un gancho `wc__a-*` puesto en el `Hud`
(boca, lengua, cejas, pupilas y **cada lagrima por separado**), para no apuntarlos por
`nth-of-type`. **Gotcha**: `transform-box: fill-box` es obligatorio en esos rasgos — sin el,
el origen de un transform SVG es la esquina del `viewBox` y la boca escala desde afuera de la
cara. **Gotcha de cascada**: para tenir el cuerpo hay que ganarle a `.is-out.is-emote
.wc__face-body` (0,4,0), que devuelve al eliminado su color normal. El enojo le gana **sin
querer**, porque su color lo aplica una animacion (`wc-rage-heat`) y la cascada de animaciones
pisa las declaraciones normales; la risa, que usa un `fill` comun, necesita el `.is-emote`
extra (`.wc__player.is-emote.is-emote--risa`) o el eliminado que se rie queda con el cuerpo de
acero y los ojos de rana. Las animaciones del **grupo** (`wc__emo--<id>`) no chocan con el salto del avatar
(`wc-emote-pop`, en `.wc__avatar`) ni con el temblor de panico (`wc-panic`, en `.wc__face`)
porque van en elementos distintos. Se apagan con `prefers-reduced-motion`.

**Sonido**: cada reaccion suena con un **sample real** (`game/EmoteAudio.ts`), unica excepcion
del repo a la regla de sintetizar todo con Web Audio — una risa humana no la hace un
oscilador. Los mp3 viven en `public/sfx/emotes/<id>.mp3` (ver su README: <= 1s por el cooldown
del server, livianos, sin silencio inicial). Se precargan en el constructor del `Game` (durante
el briefing) y se decodifican a `AudioBuffer` una vez por pagina. **Degrada**: si el mp3 falta,
no baja o no decodifica, `EmoteAudio.play()` devuelve `false` y `SoundEffects.playEmote` cae al
sonido sintetizado. Ojo que en `npm run dev` un archivo faltante **no da 404**: Vite responde
200 con el index.html y es el decode el que falla — el mismo `catch` cubre los dos casos. El
volumen esta en `SAMPLE_GAIN` (0.45), muy por encima del pico 0.09 de los osciladores porque un
sample viene mucho mas fuerte. El `AudioContext` es compartido via `game/audioContext.ts` (modulo
hoja: si viviera en `SoundEffects`, el fallback cerraria un ciclo de imports con `EmoteAudio`).
**Las reacciones se superponen a proposito**: los samples duran entre 1.2s y 5s — mas que el
cooldown de 1s del server y mas que la cara — asi que con la mesa llena se apilan varias. No es
un bug: es lo que hace graciosa la ronda. No cortar el sample anterior ni limitar su duracion.

**El dock nunca puede tapar una palabra.** Es la regla que manda sobre la estetica: lo que
el jugador de turno escribe se lee bajo su avatar, y si no lo ve, no puede jugar. Tres capas,
las tres necesarias (medidas con Playwright sobre el HUD real, 2-8 jugadores):

1. `.wc__player` tiene **z-index 25**, por encima del dock (20), y `pointer-events: none`.
   La palabra se dibuja **sobre** el dock, no debajo, y los botones se siguen pudiendo tocar
   por abajo (la tarjeta no tiene nada interactivo). Es la garantia dura: no depende de la
   geometria.
2. En pantallas **bajas** (`max-height: 500px`: celular apaisado, o vertical con el teclado
   abierto — el stage es `100dvh` y se achica) el dock pasa a **columna sobre el borde
   derecho**. Ahi el circulo ocupa todo el alto y la esquina de abajo deja de estar libre,
   pero la banda lateral sobra (la arena es cuadrada, 92vmin). Sin esto, el dock horizontal
   se comia la palabra entera del jugador de las 4-5 en punto a 700x350, 640x360, 480x320 y
   412x400 — y varias veces era el de TURNO.
3. La palabra lleva un **halo oscuro** (`text-shadow` doble en `.wc__word`) para leerse igual
   sobre el dock o sobre una chispa.

Queda un solape residual de <= 26px solo a 412x400 (portrait + teclado), donde la arena no
deja aire por ningun lado; ahi lo resuelve la capa 1.

**Gotcha del DOM**: `Hud.render()` reconstruye todas las tarjetas en cada `wc:state`. Por eso
la reaccion vigente vive en `Hud.emoteState` y se **re-aplica** al crear la tarjeta.

**Gotcha del CSS**: los rasgos automaticos van en `<g class="wc__base-face">` y los de
reaccion en `<g class="wc__emote-face">`. Son **grupos excluyentes**: reaccionar apaga el
grupo entero, para no pelear la especificidad de las caras automaticas.

**Agregar una reaccion**: sumar el id a `EMOTES` en `game/constants.ts`, dibujar su cara en
`EMOTE_FACES` de `game/Hud.ts`, sumar la regla `is-emote--<id>` en `style.css`, y sumar el id
al allowlist `EMOTES` de `server/src/games/wordchain.ts` **y** al tipo `WcEmoteId` de
`server/src/protocol.ts` + `game/WordChainTransport.ts`. Requiere redeploy del server.

## Diccionario (server-side)

Comparte `server/src/dictionary.ts` con Bomba Palabra (`an-array-of-spanish-words`, ~637k
palabras, mas `extra-words.ts` y `places.ts`). Este juego usa `randomInitial()` /
`hasInitial()` / `checkChainWord()`; los fragmentos (`randomFragment`) son de Bomba. Una
palabra es valida si (empieza con la letra) + (esta en el diccionario) + (no se uso antes en
la partida).

**Paises y ciudades**: viven en `server/src/places.ts` (~600 entradas). Hay que tenerlos
porque en este juego los lugares aparecen todo el tiempo (se arranca en una letra, no en una
silaba) y el corpus base solo aceptaba los que **por casualidad** son palabra comun (`chile`
el aji, `lima` la fruta, `salta` y `quito` verbos), rechazando `mexico`, `uruguay` o
`mendoza`. Los compuestos se **concatenan** al normalizar: "antigua y barbuda" ->
"antiguaybarbuda", y su ultima letra (`a`) es la que hereda el siguiente. Ojo que la palabra
que queda bajo el avatar es la **normalizada**, o sea sin espacios ("BUENOSAIRES").

**Agregar palabras**: editar `EXTRA_WORDS` en `server/src/extra-words.ts` (jerga) o `PLACES`
en `server/src/places.ts` (toponimos). El diccionario se arma al arrancar el proceso, asi que
**hay que redeployar el server en Railway** tras editar.

## Gotchas

- Los tipos del protocolo estan **duplicados** en cliente y server a proposito (regla de
  decoupling del repo). Mantenerlos en sync a mano.
- El anillo del cliente es solo visual: la verdad la tiene el server (el `setTimeout` del
  deadline). Si hay drift de reloj, el corte real lo decide el server.
- El puntaje de sala es placement-based y **no** va al ranking global (como el resto de los
  juegos de sala).
