# El Cohete (`el-cohete`)

Juego de *crash* en 3D (Three.js) con estética de casino de los 50. Se apuesta con fichas
de mentira, despega un cohete de hojalata y el multiplicador sube hasta que explota: el
que se baja antes cobra lo apostado por el multiplicador; el que sigue arriba lo pierde.
Diez vuelos por partida, se arranca con 1.000 fichas y el puntaje son las fichas del
final. Se juega solo (con ranking global) y en salas (todos ven el mismo cohete, sin
game server).

Estética: ver [DESIGN.md](DESIGN.md) ("Neón Atómico").

## Flujo

`ready` -> `countdown` -> (`bet` -> `flight` -> `after`) x10 -> `over`.

- **Todos los relojes de fase son de pared** (`performance.now()`): cuenta regresiva,
  ventana de apuestas, vuelo y pausa. Nada se acumula por cuadro, así una pestaña lenta
  o en segundo plano no se atrasa respecto del resto de la mesa. (La primera versión
  contaba la cuenta regresiva con `dt` topeado y, con el render lento del navegador de
  pruebas, nunca llegaba a la apuesta.)
- `bet`: en sala la ventana dura `BET_TIME` (7 s) fija y la apuesta se puede retirar
  hasta el despegue. Solo dura `SOLO_BET_TIME` (14 s) y **apostar despega** a los
  `SOLO_LAUNCH_DELAY` (0.8 s). El último segundo y pico el motor se enciende en la
  plataforma (`IGNITE_TIME`).
- `flight`: bajarse va por `pointerdown` (no `click`) y se cobra con el **instante del
  evento** (`e.timeStamp`), no con el cuadro siguiente. Se cobra el multiplicador
  redondeado hacia abajo a centésimos, que es el que muestra el cartel.
- `after`: `AFTER_TIME` (2.8 s) mirando la explosión; después fundido a negro y cohete
  nuevo en la plataforma.
- Solo, si no alcanza para la apuesta mínima, la partida termina ("Te fundiste"). En sala
  se sigue mirando hasta el final.

## Simulación (`Flight.ts`) — método aprobado por el programador

Consultado `SIMULATION_ARCHITECTURE.md`: el crash no está en la matriz. Aprobado: **punto
de explosión sembrado + curva exponencial cerrada + avisos con amagues, validado con
bots** (Monte Carlo afuera del juego, nunca en el loop).

- Cada vuelo se decide entero al despegar a partir de su semilla
  (`hashSeed(base:vuelo)`, con `base` = `código:ronda` en sala o al azar solo). Nada de
  `Math.random()` adentro: todos los clientes ven el mismo cohete.
- Explosión: `P(llegar a xN) = EDGE / N` con `EDGE` = 0.97 (3% revienta en la plataforma,
  "falla de encendido") y tope `MAX_CRASH` = x50.
- Multiplicador: `m(t) = e^(GROWTH·t)`, con `GROWTH` = 0.11 (x2 a los 6.3 s, x10 a los 21 s).
- **Por qué hay avisos:** en un crash justo cualquier estrategia gana lo mismo en promedio,
  o sea que el juego sería azar disfrazado. Con avisos, la habilidad existe. Antes de
  explotar, el motor tose con **humo negro y el casco al rojo vivo** durante
  `warnFor(crash)`: 0.6 s en multiplicadores bajos, 0.25 s en x5 y 0.15 s de x10 para
  arriba. Además hay **amagues** de humo blanco (`FAKE_RATE` 0.3/s, `FAKE_DUR` 0.3 s), que
  castigan al que se baja con cualquier tos sin mirar el color. Los vuelos que explotan
  antes de ~x1.07 no traen aviso.

### Balance — cómo se midió

Bots que juegan 10 vuelos apostando 100, en 8.000 partidas por estrategia (script en el
scratchpad, no versionado). "Lee humo" se baja con el humo negro tras su tiempo de
reacción (gaussiano, ±0.05 s) o al llegar a su tope; distinguir negro de blanco es una
reacción de elección, que en una persona ronda 0.35-0.45 s.

| Estrategia | Mediana de fichas | p10 | p90 |
| --- | --- | --- | --- |
| Tope fijo (x1.3 a x10), sin mirar el humo | ~1.000 | 0-780 | 1.170-2.000 |
| Se baja con cualquier tos (reacción 0.22-0.3 s) | ~1.350 | 1.090 | 1.640 |
| Lee humo, reacción 0.30 s (tope x5) | 2.165 | 1.504 | 2.857 |
| Lee humo, reacción 0.35 s (tope x5) | 1.954 | 1.304 | 2.691 |
| Lee humo, reacción 0.40 s (tope x4) | 1.758 | 1.170 | 2.376 |
| Lee humo, reacción 0.45 s (tope x4) | 1.541 | 923 | 2.190 |
| Lee humo, reacción 0.55 s (tope x4) | 1.142 | 510 | 1.839 |

Lo que se buscaba: un gradiente de habilidad parejo con los reflejos, que no mirar el
humo no rinda, que bajarse con cualquier tos rinda menos que leer el color, y que la
suerte siga pesando (entre el p10 y el p90 hay más del doble de fichas). La primera
versión (avisos de 0.7 s, amagues a 0.22/s) daba que el que leía el humo casi nunca
perdía; se acortaron los avisos y se subieron los amagues. Todo el tuning está en
`game/constants.ts`.

## Escena (`Stage.ts` y compañía)

- `City.ts`: tejado del casino con la plataforma, la torre de lanzamiento con brazo que se
  retira al despegar, el letrero con bombitas que corren (`InstancedMesh`), la avenida
  (todos los edificios en **una** malla con `mergeGeometries`, con las UV escaladas al
  tamaño de cada uno), letreros de neón, reflectores y la alfombra de luces del piso.
- `Rocket.ts`: casco torneado (`LatheGeometry`) con textura de laca, faja y remaches; nariz
  y tobera cromadas; aletas en flecha (`ExtrudeGeometry`) orientadas para que ninguna
  quede de canto ante la cámara; fuego con shader propio (dos conos aditivos).
- `Sky.ts`: domo con gradiente según la altura, estrellas, estrellas atómicas de cuatro
  puntas, nubes, luna, Sputnik y planeta con anillos.
- `Particles.ts`: dos pools en `THREE.Points` (aditivo y normal) con Float32Arrays
  preasignados, sin `new` por cuadro.
- `Parachute.ts`: el que se baja salta con el muñeco de bloques de la casa (remera del color
  de su asiento) colgado de un paracaídas a rayas, con su nombre.
- Altura: `y = 10·(m − 1)`, que acelera con el multiplicador.

Gotchas medidos en capturas (no "simplificar"):

- **El entorno de reflejos va SOLO en lo metálico** (cohete y Sputnik), y es una noche de
  neón propia (`neonEnvironment`). Con el `RoomEnvironment` de three puesto en toda la
  escena la noche quedaba lavada (techo y plataforma grises claros), y en el cromo sus
  paneles blancos se volvían manchas quemadas.
- **Bloom con umbral alto (0.94):** florecen el neón, el fuego y las bombitas, que se pintan
  con color por encima de 1 y `toneMapped: false`; la laca y la faja crema, no.
- **La luz del fuego va debajo de la tobera y es chica:** arriba lavaba la laca roja a blanco.
- **La tos de verdad pone el casco al rojo vivo** (emisivo a los tirones): el humo negro
  solo no se distinguía contra el cielo de noche, y esa señal es la mecánica central.
- **El amague es gris claro, no blanco puro:** el blanco pasaba el umbral del bloom y se
  leía como un resplandor, no como humo.
- **Las explosiones usan pocas partículas aditivas y medio transparentes:** amontonadas
  saturaban la pantalla a un disco blanco.
- **La tapa del casino queda 0.2 por debajo del techo:** a la misma altura había z-fighting
  y las ventanas se colaban como baldosas de colores.
- El letrero se pinta en canvas con **Monoton relleno** (en trazo salía rayado). `main.ts`
  espera las fuentes antes de crear el juego.

## Salas

- `initRoomMode` con `onStart` -> `beginCountdown`. No necesita `roomTimeLimitSec`: los diez
  vuelos corren solos aunque nadie apueste (el peor caso son ~7.5 min).
- `getScore` (parcial si se corta la ronda): fichas más lo apostado si el corte cae en la
  ventana de apuestas; en vuelo, lo apostado está en juego y no se cuenta.
- **En vivo** (`Rivals.ts`), por el `broadcastLive` de la sala: `{g:"ck", r, f, b, c, k}`
  (vuelo, apuesta, multiplicador al que se bajó x100 o −1 si explotó, fichas). Se manda solo
  cuando cambia algo (apostó, se bajó, explotó, vuelo nuevo) más un keepalive cada 2 s: con
  8 jugadores son unos pocos mensajes por segundo, lejísimos del tope del canal. Cuando un
  rival se baja en el vuelo en curso salta su paracaídas con su nombre y aparece el aviso.
  La lista "La mesa" ordena por fichas.
- `devRoom.ts`: sala falsa solo en desarrollo (`?dev=Ana&roster=Ana,Beto&code=X`, una
  pestaña por jugador, viaja por `BroadcastChannel`).

## Celular

`mobile: true`. El arranque es por toque sobre el container. El paño se reacomoda a 760 px
(fichas y botón grande a la derecha) y la cámara abre el campo en vertical. Verificado a
390x844.

## Pruebas

Para medir de verdad, Playwright tiene que usar la GPU (`--use-angle=metal --enable-gpu
--ignore-gpu-blocklist`): con el SwiftShader por defecto va a ~7 cuadros por segundo, la
escena se ve distinta y cualquier prueba que espere un tiempo de juego se vuelve eterna.
