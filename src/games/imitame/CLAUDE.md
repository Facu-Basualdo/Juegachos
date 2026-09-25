# Imitame (imitame)

Clon simplificado de **Mimic Party** (Steam), **solo de sala** y con microfono. Suena un
sonido UNA vez (un gato, una sirena, un "ta-ta-ta-taaa"), todos lo imitan a la vez con la
voz en una sola toma, cada navegador puntua su propia toma (melodia, ritmo, golpes; no el
timbre), las tomas se reproducen una por una para toda la sala y una ruleta reparte bonus
y sabotajes para la ronda siguiente. Un partido son `ROUNDS_PER_MATCH` (4) sonidos.

Es un **prototipo**: sin chat de voz, sin packs de la comunidad, una sola ruleta por
ronda. Estado: server probado de punta a punta con clientes simulados (fases, relay de
tomas, multiplicadores, gameover); la UI y la grabadora probadas en Chromium con el micro
falso de Playwright. **Falta probarlo con gente real en una sala** y en un telefono
(`mobile: false` hasta entonces).

## Reparto de responsabilidades

- **Supabase / RoomMode**: lobby, briefing, marcador acumulado, rejoin. Puntaje de sala
  placement-based (`ranking.length - place`), como Basta. No va al ranking global.
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

1. `intro` (3.5s) — cartel "Ronda N / pack / nombre del sonido" y el efecto que te dejo la
   ruleta anterior.
2. `listen` (3.8s) — cada cliente sintetiza y reproduce la referencia al recibir la fase.
   Suena una sola vez; el trazo celeste se dibuja mientras suena.
3. `ready` (2.1s) — "3 / 2 / 1" antes de grabar, derivado del reloj de la fase.
4. `record` (`RECORD_MS` = 4.5s) — cada cliente graba con **su propio timer** de 4.5s
   desde que recibe la fase (no con el deadline del server), asi la latencia no le come
   tiempo a nadie. Al cortar: analiza, muestra su tarjeta y manda `mt:take`.
5. `upload` (tope 6s) — cierra apenas llegaron las tomas de todos los conectados.
6. `playback` — una fase por toma, en orden aleatorio. Al abrirse, el server reenvia todas
   las tomas (`mt:take`, binario). Cada turno dura lo que dura la toma (con helio, /1.5)
   mas `SLOT_PAD_MS` para mostrar el puntaje. Los totales suben al cerrar cada turno.
7. `wheel` (7s, no en la ultima ronda) — sale un efecto y un blanco; el cliente anima la
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
- `game/Hud.ts` — DOM + tres canvas (la Boca, el trazo de melodia, la ruleta) en un solo
  loop de rAF.
- `game/sounds.ts` — biblioteca de sonidos (ids espejados en el server).
- `game/synth.ts` — sintesis de la referencia por timbre y reproduccion con sabotajes.
- `game/analysis.ts` — el jurado.
- `game/recorder.ts` — micro, downsampling, cuadros en vivo, mu-law.
- `game/audio.ts` — `AudioContext`, bus con analizador (mueve la boca), desbloqueo.
- `game/ImitameTransport.ts` / `SocketTransport.ts` — protocolo (espejo de
  `server/src/protocol.ts`) y socket.io.
- `game/constants.ts` — countdown, `RECORD_MS`, `EFFECTS` (espejados en el server).
- `game/SoundEffects.ts` — blips (countdown tick 750 Hz obligatorio, rec, ruleta, puntaje).

## Agregar un sonido

Sumarlo a `SOUNDS` en `sounds.ts` **y** su id a `SOUND_IDS` del server, y redeployar el
server. Que no pase de ~2.6s (`LISTEN_MS` = 3.8s tiene que alcanzar para escucharlo).

## Gotchas

- `RECORD_MS`, `MAX_TAKE_BYTES`, `EFFECTS` y los ids de sonidos estan **duplicados** en
  cliente y server (regla de decoupling). Tocarlos en los dos lados.
- La reproduccion llega por dos caminos: el cambio de `playIndex` en el `mt:state` y la
  llegada del `mt:take`. El que llega segundo dispara el audio; `playedSlot` evita que
  suene dos veces.
- Un F5 durante `record` pierde la toma de esa ronda (no se puede volver a escuchar la
  referencia). En `playback` / `wheel` el server le reenvia las tomas al reconectar.
