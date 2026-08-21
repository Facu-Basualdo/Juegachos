# Neon Drift (car-race)

Carrera 2D top-down con estilo neon. Modo solo = contrarreloj (mejorar el mejor
tiempo local); modo sala = todos corren el mismo circuito con posiciones en vivo.

## Mecanicas

- **Manejo grip realista** ([Car.ts](game/Car.ts)): la velocidad se guarda como
  vector `(vx, vy)` y cada frame se descompone en avance + lateral. El agarre
  lateral alto (`GRIP_ON`) amortigua rapido el componente transversal (trazada
  limpia); a alta velocidad el grip baja (`GRIP_SPEED_FALLOFF`) y aparece un
  derrape sutil.
- **Paredes en el borde** ([Game.ts](game/Game.ts) `applyWalls`): el asfalto es
  cerrado; si el auto se pasa del ancho (`width/2 - WALL_MARGIN`) se lo reubica al
  borde y se anula la velocidad hacia afuera. No hay pasto: no se puede cortar
  camino ni meterse en el hueco entre dos tramos. El cordon brillante al filo del
  asfalto es la lectura visual de la pared.
  - **Gotcha**: la normal de la pared apunta HACIA AFUERA (del centro al auto),
    convencion OPUESTA a `Car.bounce` (pensada para obstaculos, normal hacia el
    auto). Por eso `applyWalls` maneja la velocidad inline: anula el componente
    solo cuando `vn > 0` (empuja hacia afuera). Usar `Car.bounce` aca pegaba el
    auto a la pared (no podia despegarse) y era la causa del "no puedo avanzar".
- **Anchos de pista**: las calles son anchas a pedido (monaco 112, shanghai 152,
  silverstone 138, red-dune 200, glacier 196, magma 205). El limite real de
  ensanche no es el radio de curva (el juego tolera medio-ancho > radio porque
  `applyWalls` reubica al auto), sino el **auto-acercamiento** del trazado (que
  dos tramos distintos no fusionen su asfalto): el ancho debe quedar bien por
  debajo de la distancia minima entre tramos no adyacentes. Al cambiar anchos o
  waypoints, re-verificar con un autopilot que da vueltas (no debe quedar
  trabado); ver scratchpad, se testeo asi tras ensanchar.
- **Circuitos por spline** ([tracks.ts](game/tracks.ts)): cada `TrackDef` define
  los nodos de control de una spline Catmull-Rom cerrada de dos formas posibles:
  `nodes` polares `[anguloGrados, radio]` con angulos crecientes (no se
  autointersecta; usado por las 3 pistas proceduraes) o `waypoints` cartesianos
  libres `[x, y]` (se auto-centran en su centroide) para reproducir trazados
  reales que se doblan sobre si mismos. 3 circuitos estan **trazados sobre pistas
  de F1**: `monaco` (callejero angosto trazado sobre Montecarlo, con horquilla
  lenta), `silverstone` (sweeps + esses tipo Maggotts/Becketts) y `shanghai`
  (semi-fiel: su recta trasera larga + horquilla; el "snail" de entrada real es
  imposible como loop cerrado sin autointersecarse, asi que va como curva simple).
  6 circuitos en total, cada uno con su `themeId`. La `curvature[]` por punto
  ubica los hazards. Constraint clave: el radio de curva minimo debe superar el
  medio ancho (si no, el borde interno colapsa y las paredes traban al auto).
- **`progressAt` con continuidad**: proyectar la posicion sobre la centerline usa
  un `hint` (el `s` del frame anterior) y busca solo en una ventana alrededor, no
  el global mas cercano. Sin esto, en tramos donde el circuito pasa cerca de si
  mismo (espiral de Shanghai) el progreso saltaria al tramo equivocado y romperia
  la logica de vueltas. Sin hint (largada) hace busqueda global.
- **`trackPreview(index)`**: genera un path SVG normalizado del trazado para la
  miniatura de cada chip del selector.
- **Temas visuales** ([themes.ts](game/themes.ts)): 6 paletas (city, space,
  desert, ice, jungle, volcano) con gradiente de fondo + backdrop decorativo
  (grid, estrellas, dunas, hielo, follaje, brasas). Solo cambian colores/adornos,
  no la geometria.
- **Obstaculos deterministas** ([obstacles.ts](game/obstacles.ts)):
  `buildObstacles(track, seed)` recorre el circuito y en las **rectas** coloca
  **boost pads** y **barreras** parciales a un lado (rebote solido). **Sin conos**
  (se sacaron a pedido; `cones` se devuelve vacio para no tocar Renderer/Game,
  que siguen iterando una lista vacia). Todo sale de un PRNG mulberry32 sembrado,
  asi en sala todos ven el
  mismo layout. El **boost** no es un salto instantaneo: `Car.applyBoost` solo
  arranca un timer y `Car.update` aplica `BOOST_ACCEL` sostenido (evita el tiron
  visual que daba el kick de velocidad).
- **Selector de circuito** ([Hud.ts](game/Hud.ts) `buildMapSelector`): en modo
  solo el overlay muestra un chip por circuito con **miniatura SVG del trazado**;
  `onSelectMap` reconstruye la pista y la previsualiza detras del menu.
- **Votacion de circuito en sala** ([Game.ts](game/Game.ts) `startMapVote`):
  antes de largar, todos votan el circuito. Los votos viajan por
  [RaceChannel](game/RaceChannel.ts) (eventos `vote`/`map`, broadcast efimero, sin
  DB). El **anfitrion** (por `host` de la sala) cierra cuando votaron todos o al
  vencer el tope (`MAP_VOTE_MS`), computa el ganador (`tallyWinner`: mas votos,
  empate/0 votos al azar por `seed`) y lo anuncia con `sendMap`; el resto lo
  aplica al recibir `map`. Fallback del no-host si no llega el anuncio: recomputa
  el mismo `tallyWinner()` (determinista, mismos votos + seed), no un mapa
  arbitrario. El `obstacleSeed` sigue saliendo de `hashStr(code:round)`, asi el
  layout de hazards es igual para todos sobre el circuito votado. **Con game
  server el que entra tarde queda cubierto**: el sim recuerda el `cr:map` de la
  ronda y se lo reenvia al conectar. Sobre el fallback de Supabase sigue el gotcha
  viejo — el anuncio es efimero, asi que el que entra a mitad de carrera (o
  espectador) no lo escucho y cae al mapa por defecto por seed, que puede no ser
  el votado.
- **Flechas de direccion** ([Renderer.ts](game/Renderer.ts) `drawDirectionArrows`):
  chevrons sutiles repartidos por distancia sobre la centerline (`track.pointAt`),
  apuntando en el sentido de avance (tangente de la spline), para que se lea hacia
  donde correr. Se saltan cerca de la meta para no pisar la grilla de largada.
- **Ranking por circuito**: cada pista tiene su propia tabla global. `car-race`
  declara `variants` (los 6 `id` de pista) en [meta.ts](meta.ts);
  `finishRace` llama `hud.showRanking("car-race", ms, track.def.id)` y la landing
  ofrece el selector de variante automaticamente. En el overlay, el ranking
  **sigue al circuito elegido en el selector**: `onSelectMap` re-renderiza el
  ranking de esa pista (solo lectura, salvo el circuito recien corrido, que
  muestra el puntaje via `lastResult`). El **mejor tiempo local** tambien es por
  circuito (`car-race:best:<id>`, ver `bestKey()`).
- **Colisiones y derrape** ([Game.ts](game/Game.ts)): `handleCollisions` maneja
  boost (envion en el flanco de entrada) y barreras (capsula: empuje fuera +
  `Car.bounce`). El manejo de conos (`Car.slowDown`) sigue en el codigo pero
  quedo inerte (ya no se generan conos). `recordSkids` deja marcas de goma cuando
  `car.slip` es alto, que se desvanecen.

## Seed

`setupTrack(idx, seed)` recibe el indice de pista y deriva el layout de
obstaculos (`hashStr("obs:"+seed)`). Solo: idx elegido en el menu, seed aleatorio
por carrera. Sala: el `seed` es `hashStr(code + ":" + round)` (determinista para
todos, fija los hazards y el mapa por defecto), pero el **indice de pista sale de
la votacion**, no del seed.

## Camara y render

Camara **suavizada** con estado propio en el Renderer (`this.cam`): persigue al
auto con un ease y un look-ahead minimo (`v * 0.09`), en vez de saltar con la
velocidad cruda; asi los envones del boost no producen tirones. `snapCamera()`
reencuadra sin paneo cuando el auto se reposiciona en la grilla. Leve zoom-out a
alta velocidad, tambien interpolado. Minimapa con la traza, los boosts y todos
los autos. Autos con brillo neon, faros, aleron y llama de boost.

## Tuning (constants.ts)

`ENGINE_ACCEL`, `MAX_SPEED`, `GRIP_ON/OFF`, `GRIP_SPEED_FALLOFF`, `TURN_RATE`,
`BOOST_*`, `CONE_SLOW`, `BARRIER_RESTITUTION`. El umbral de derrape para las
marcas (`car.slip > 45`) esta en `recordSkids`.

## Countdown

Cumple el patron obligatorio Enter-para-empezar 3/2/1/YA (estado `countdown` +
`Hud.showCountdown`). En sala arranca solo tras cerrarse la votacion de circuito
(estado `mapvote` -> `countdown`), sin que cada jugador tenga que tocar Enter.

## Modo sala: el enlace de posiciones

Cada cliente corre su propia carrera (misma pista y mismos obstaculos por seed) y
solo difunde su posicion para que los demas lo vean. Hay **dos transportes
intercambiables** detras de la interfaz `RaceLink`
([RaceTransport.ts](game/RaceTransport.ts)), y `openLink()` en `Game.ts` elige:

| | Cuando | Cadencia |
| --- | --- | --- |
| [RaceSocket](game/RaceSocket.ts) — game server, namespace `/carrace` | hay `VITE_GAME_SERVER_URL` | `NET_SEND_SERVER_MS` (60 ms) |
| [RaceChannel](game/RaceChannel.ts) — broadcast de Supabase | fallback sin game server | `NET_SEND_MS` (100 ms) |

**La eleccion es por configuracion, nunca en runtime.** La env es la misma para
todos los clientes del deploy, asi que todos coinciden. Caer al otro transporte
porque a este cliente le fallo la conexion partiria la sala en dos grupos que
corren la misma carrera **sin verse** — un bug mudo, peor que quedarse sin
rivales en pantalla. Con el server configurado pero caido no se ven los rivales y
la carrera sigue: la votacion cae al `tallyWinner()` determinista, que da el mismo
circuito en todos lados.

**Por que existe el server aca** (es un relay, no arbitra nada): Supabase topea
~100 mensajes/s por canal y la sala llena rozaba el tope (`8 x 10/s` = 80/s). Al
pasarse, Realtime cerraba el socket, el cliente no se enteraba y **todos los
rivales desaparecian de la pantalla**. El server saca ese techo (de ahi los 60 ms),
trae la reconexion de socket.io de fabrica, estampa el nickname del emisor (nadie
mueve el auto ajeno) y le reenvia el circuito ya votado al que se conecta tarde
—lo que arregla el gotcha viejo de la votacion, ver arriba.

Reglas que sobreviven en el camino Supabase (ver "Canales efimeros de alta
frecuencia" en el CLAUDE.md raiz):

- **El canal se cae y hay que enterarse.** `subscribe()` se llama **con callback
  de estado**: un `CHANNEL_ERROR` / `TIMED_OUT` / `CLOSED` baja el flag `ready`
  (que gatea `send()`) y reconstruye el canal con backoff. Sin eso la caida era
  silenciosa y total. **No bajar `NET_SEND_MS` de 100** sin hacer la
  multiplicacion por 8 jugadores. Los eventos de la votacion (`vote` / `map`)
  **no** se gatean con `ready` a proposito: son uno por jugador y por carrera, y
  ahi el fallback REST de realtime-js entrega el voto igual si el canal todavia no
  se unio.
- **El heartbeat corre sobre `setInterval`, no sobre el rAF** (en los dos
  transportes). El navegador frena `requestAnimationFrame` en pestañas de fondo,
  asi que emitir desde el loop hacia desaparecer a cualquiera que mirara otra
  pestaña. `emitPos` ademas saltea el snapshot repetido (auto quieto en el
  countdown, o ya terminado) y baja a un keepalive de `NET_IDLE_MS`.
- `dispose()` (en `pagehide` no-`persisted`) frena el timer y suelta el enlace al
  navegar a la ronda siguiente.

## Modo sala: F5 no reinicia la carrera

La carrera (circuito votado, vuelta, instante de largada) se persiste en
`sessionStorage` via `src/shared/room/roomRun.ts`, al largar (`go`) y en cada
vuelta. El resume se engancha donde el loop larga la votacion (estado `loading` +
sala en `playing`): si hay snapshot, se saltea la votacion (ya paso) y se retoma.

- **El reloj no se reinicia**: `startEpoch` es reloj de pared, y al retomar
  `startTime = performance.now() - (Date.now() - startEpoch)`. Sin esto, recargar
  medía el tiempo desde la recarga y **mejoraba** el resultado, porque el ranking
  es `direction: "lower"`. Recargar ahora cuesta el tiempo real que tardo.
- **El auto vuelve a la grilla** y hay que rehacer los sectores de la vuelta en
  curso: recargar es castigo, no atajo. No se serializa posicion ni velocidad.
- **Gotcha:** `setupTrack` -> `placeAtGrid` ya deja `lap` en 0, `sectors` limpios y
  `prevS` **justo antes de la meta** (~0.98). `resumeSavedRun` solo pisa `lap`: si
  ademas pusiera `prevS = 0`, la deteccion de cruce de meta
  (`prevS > 0.9 && s < 0.1`) no dispararia y la vuelta no cerraria nunca.
- `finishRace` limpia el snapshot.
