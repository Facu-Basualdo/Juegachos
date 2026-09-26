# Imitame (imitame)

Clon simplificado de **Mimic Party** (Steam), **solo de sala** y con microfono. Suena un
sonido UNA vez (un gato, una sirena, un "ta-ta-ta-taaa"), todos lo imitan a la vez con la
voz en una sola toma, cada navegador puntua su propia toma (melodia, ritmo, golpes; no el
timbre), las tomas se reproducen una por una para toda la sala y una ruleta reparte bonus
y sabotajes para la ronda siguiente. Un partido son `ROUNDS_PER_MATCH` (3) sonidos (eran 4; se bajo a 3 porque el partido se hacia largo).

Tiene **chat de voz embebido** (WebRTC, ver abajo) y una **biblioteca de audios de la
comunidad** (Supabase, ver abajo) ademas de los sonidos sintetizados; una sola ruleta por
ronda. Estado: server probado de punta a punta con clientes simulados (fases, relay de
tomas y de la senalizacion del chat, multiplicadores, gameover); la UI y la grabadora
probadas en Chromium con el micro falso de Playwright. **El chat de voz no se probo con
dos personas reales** y el juego no se probo en un telefono (`mobile: false`).

## Reparto de responsabilidades

- **Supabase / RoomMode**: lobby, briefing, marcador acumulado, rejoin. Puntaje de sala
  placement-based (`ranking.length - place`), como Basta. El ranking global cuenta victorias en sala (`ranking: "wins"` en `meta.ts`): el puesto viaja aparte en `reportScore(score, { place, players })`.
- **Game server** (`/imitame`, `server/src/games/imitame.ts`): sortea el sonido, corre las
  fases con `setTimeout` propio, hace de **relay de las tomas** (binario, socket.io),
  aplica el multiplicador de la ruleta y lleva los totales.
- **Cliente**: sintetiza la referencia, graba, **puntua su propia toma** (el "jurado" de
  `analysis.ts`, equivalente a la IA local del original) y reproduce las tomas ajenas con
  su sabotaje. El puntaje crudo viaja del cliente: spoofeable, mismo nivel ya aceptado en
  el resto de las salas.

Como el server arbitra todas sus fases, la partida llega a "over" aunque todos esten idle
=> **no declara `roomTimeLimitSec`**. Sin `?room=` muestra "Solo en salas"; sin
`VITE_GAME_SERVER_URL` muestra "No disponible" (excepcion documentada a la degradacion,
igual que Basta / Bomba).

## Flujo de una ronda (fases del server, `MtPhase`)

**Todo va con aire a proposito.** La primera version era demasiado rapida: no daba para
escuchar la toma del otro ni reirse. Los tiempos de abajo son los de ahora.

1. `intro` (5s) — cartel "Ronda N / pack / nombre del sonido" y el efecto que te dejo la
   ruleta anterior. Mesa abierta (chat de voz).
2. `listen` (5s) — cada cliente sintetiza (o baja, si es de la biblioteca) y reproduce la
   referencia al recibir la fase. Suena una sola vez; el trazo celeste se dibuja mientras
   suena. Mesa en silencio.
3. `ready` (3s) — "3 / 2 / 1" antes de grabar (`READY_STEP_MS` 1s), derivado del reloj.
   Aparece un microfono en la cara de todos.
4. `record` (`RECORD_MS` = 4.5s) — cada cliente graba con **su propio timer** de 4.5s
   desde que recibe la fase (no con el deadline del server), asi la latencia no le come
   tiempo a nadie. Al cortar: analiza, muestra su tarjeta y manda `mt:take`.
5. `upload` (tope 6s) — cierra apenas llegaron las tomas de todos los conectados. Mesa abierta.
6. `playback` — una fase por toma, en orden aleatorio. Al abrirse, el server reenvia todas
   las tomas (`mt:take`, binario). Cada turno: `PRE_SLOT_MS` (1.5s) en que el microfono
   vuela a la cara del que le toca, la toma (con helio, /1.5) con la mesa en silencio, y
   `REVEAL_MS` (5.5s) en que el jurado arma la tarjeta de a poco (melodia, ritmo, golpes,
   puntaje, multiplicador, "+N") con la mesa abierta; al final salta el "+N" sobre la
   cabeza del jugador y su total cuenta para arriba. `PRE_SLOT_MS` y la demora del "+N"
   (`CARD_SUM_DELAY_MS`, espejo del CSS) estan duplicados cliente / server.
7. `summary` (7s) — resumen de la ronda: tabla con cuanto sumo cada uno y el total.
8. `wheel` (8s, no en la ultima ronda) — sale un efecto y un blanco; el cliente anima la
   ruleta hasta la porcion que mando el server (`jitter` fija donde frena, igual en todas
   las pantallas). Los bonus caen en la mitad de abajo de la tabla y los sabotajes en la de
   arriba: es lo que mantiene la partida abierta.

## El jurado (`game/analysis.ts`)

Los sonidos son **definiciones** (`sounds.ts`: notas con contorno MIDI), no audio: de la
misma definicion salen el sintetizado y la partitura de referencia, asi que la referencia
no se analiza, se lee. La toma si se analiza: YIN para la altura (cuadros de 45ms cada
20ms, 70-1100 Hz) y RMS con histeresis para los ataques. Tres notas, cada una 0..1:

- **Golpes**: cantidad de ataques contra la referencia. Un ataque es el arranque de un
  segmento con sonido, un re-ataque adentro de uno (bajo y vuelve a subir) o un salto de
  altura sostenido (`NOTE_JUMP`), para los "ta-taa" ligados.
- **Ritmo**: donde caen los ataques, con la toma estirada al largo de la referencia (no
  importa cantar un poco mas lento), mas cuanto se parece la duracion total.
- **Melodia**: contornos remuestreados a 40 puntos y centrados en su mediana (un grave y
  un agudo que dibujan la misma curva empatan; un salto de octava suelto se pliega), con
  DTW de banda 6. `MELODY_ZERO_AT` (2.5 semitonos de desvio medio) = 0.

Total = 25% golpes + 30% ritmo + 45% melodia (sonidos sin altura, como las palmas: mitad
golpes, mitad ritmo). Calibrado con voces sinteticas: imitacion buena 85-97, melodia plana
60-80, al azar ~55, un "aaa" largo 15-40. **Tuning con gente real pendiente.**

## La pantalla: todos los jugadores

El escenario (`Hud`, canvas `.mt__scene`) muestra **a todos**: una bola de color por
jugador con su nombre, su total y el efecto que carga. Hasta 3 por fila (4 con 7-8) y el
alto del canvas crece con las filas, asi en el celular se lee. El microfono se dibuja en la
cara de quien le toca: de todos mientras se graba (con luz de REC en el propio), y en la
reproduccion **vuela en arco** a la cara del que suena, que se agranda y abre la boca con lo
que sale por el parlante. Un anillo verde marca a quien esta hablando por el chat de voz.

## Chat de voz (`VoiceChat.ts`)

WebRTC de audio en malla (todos con todos), senalizacion por el game server (`mt:rtc`, que
el server solo reenvia con el remitente estampado). Ofrece el de nickname menor; el otro
manda un "hello" al estar listo, porque una oferta que llega antes de tener el micro se
pierde. Al desconectarse un par (el server lo marca) se cierra su conexion y al volver se
arma de cero. Solo STUN publico, sin TURN: detras de NATs estrictos algun par puede no
conectar.

**La mesa se silencia sola** (ni se manda ni se escucha, `CHAT_OPEN_PHASES` en `Game.ts`)
mientras suena la referencia, mientras se graba y mientras suena cada toma; se abre en el
intro, al entregar, mientras el jurado muestra el puntaje, en el resumen y en la ruleta.
Como en el juego original: el chiste es comentar, pero no encima de lo que hay que escuchar.
El micro del chat es un stream aparte del de la grabadora, CON cancelacion de eco y
supresion de ruido. Boton "Voz" arriba a la derecha para silenciarse.

## Biblioteca de la comunidad (`clips.ts`, `Library.ts`)

El "Workshop" de Imitame: audios que sube la gente, en la tabla `imitame_clips` de Supabase
(`supabase/imitame.sql`, **correrlo en el SQL Editor**). Fuera de una sala, la pagina del
juego ES la biblioteca: se arrastran audios (o se eligen con un toque) y se suben solos con
el nombre del archivo; la lista deja escucharlos y borrar los propios.

El audio se procesa **entero en el navegador** antes de subir: se decodifica lo que el
navegador sepa leer, se recortan los silencios, se corta a `MAX_CLIP_S` (3s), se baja a
~11 kHz y se guarda como mu-law en base64 (~45 KB la fila). La tabla tiene un formato unico
y el archivo original no sale de la maquina.

En la sala, cada cliente lee los ids de la biblioteca antes de conectar y los manda en el
`mt:join`; el server sortea entre la union (`CLIP_CHANCE`: la mitad de las rondas, si hay
alguno) y los manda como `soundId = "clip:<uuid>"`. El server no toca la DB. Cada cliente
baja el audio en el `intro` y saca la referencia **analizandolo con el mismo jurado** que
analiza las tomas, asi la comparacion es pareja.

Mismo nivel de confianza que el resto: anon key + RLS abierta, cualquiera sube y borra.

## Tomas

`recorder.ts` graba con `ScriptProcessorNode` y baja a ~11 kHz en el momento. Las tomas
viajan como **mu-law de 8 bits crudo**, no con `MediaRecorder`: Safari graba mp4 y Firefox
webm, y no todos decodifican lo del otro; PCM lo reproduce cualquiera. Antes de mandar se
recortan los silencios de las puntas y se normaliza el volumen. Tope `MAX_TAKE_BYTES`
(80 KB, espejado en el server).

El micro se pide en el constructor (el permiso sale mientras se lee el briefing) y sin
supresion de ruido ni cancelacion de eco, que aplanan la altura. Sin micro, la toma va
vacia y suma 0.

## Audio bloqueado

El audio no es decoracion aca: sin sonido no hay juego. `audio.ts` despierta el
`AudioContext` con el primer gesto en cualquier lado (captura en `window`, porque el
`RoomOverlay` corta la propagacion en su raiz; el "Listo" del briefing ya cuenta), y si al
entrar a jugar sigue suspendido el Hud muestra un boton "Toca para activar el sonido".

## Sabotajes (reproduccion, `synth.ts`)

Eco (delay con realimentacion), saturado (waveshaper), helio (playbackRate 1.5), cortado
(compuerta cuadrada a 7 Hz) y pedo (la toma no suena, suena un pedo sintetizado). El
castigo real es el multiplicador (`EFFECTS`), el efecto es la parte comica.

## Module layout

- `game/Game.ts` — orquestador: room mode, countdown 3/2/1/YA, fases, grabacion, turnos de
  reproduccion, ruleta, reporte del placement.
- `game/Hud.ts` — DOM + tres canvas (el escenario con todos los jugadores, el trazo de
  melodia, la ruleta) en un solo loop de rAF, tarjeta del jurado y resumen.
- `game/VoiceChat.ts` — chat de voz WebRTC.
- `game/clips.ts` — biblioteca de la comunidad en Supabase (leer, procesar, subir, borrar).
- `game/Library.ts` — la pagina de la biblioteca (arrastrar y soltar).
- `game/sounds.ts` — sonidos sintetizados (ids espejados en el server).
- `game/synth.ts` — sintesis de la referencia por timbre y reproduccion con sabotajes.
- `game/analysis.ts` — el jurado.
- `game/recorder.ts` — micro, downsampling, cuadros en vivo, mu-law.
- `game/audio.ts` — `AudioContext`, bus con analizador (mueve la boca), desbloqueo.
- `game/ImitameTransport.ts` / `SocketTransport.ts` — protocolo (espejo de
  `server/src/protocol.ts`) y socket.io.
- `game/constants.ts` — countdown, `RECORD_MS`, `EFFECTS` (espejados en el server).
- `game/SoundEffects.ts` — blips (countdown tick 750 Hz obligatorio, rec, ruleta, puntaje).

## Agregar un sonido

Sintetizado: sumarlo a `SOUNDS` en `sounds.ts` **y** su id a `SOUND_IDS` del server, y
redeployar el server. Que no pase de ~2.6s (`LISTEN_MS` = 3.8s tiene que alcanzar para
escucharlo). Audio real: se sube desde la biblioteca, sin tocar codigo.

## Gotchas

- `RECORD_MS`, `MAX_TAKE_BYTES`, `EFFECTS` y los ids de sonidos estan **duplicados** en
  cliente y server (regla de decoupling). Tocarlos en los dos lados.
- La reproduccion llega por dos caminos: el cambio de `playIndex` en el `mt:state` y la
  llegada del `mt:take`. El que llega segundo dispara el audio; `playedSlot` evita que
  suene dos veces.
- Un F5 durante `record` pierde la toma de esa ronda (no se puede volver a escuchar la
  referencia). En `playback` / `summary` / `wheel` el server le reenvia las tomas al reconectar.
- **Chrome no hace sonar un stream WebRTC remoto por Web Audio** si no esta tambien en un
  elemento `<audio>`: la salida del chat son elementos `Audio` y el analizador (el anillo de
  "esta hablando") solo mide.
