# El Cohete (`el-cohete`)

Juego de *crash* en 3D (Three.js) con estética de casino de los 50. Se apuesta con fichas
de mentira, despega un cohete de hojalata y el multiplicador sube hasta que **explota de la
nada**: el que cobra antes se lleva lo apostado por el multiplicador; el que sigue arriba
lo pierde. Cuatro vuelos por partida, se arranca con 1.000 fichas y el puntaje son las
fichas del final. Se juega solo (con ranking global) y en salas (todos ven el mismo cohete,
sin game server).

Estética: ver [DESIGN.md](DESIGN.md) ("Neón Atómico").

## Flujo

`ready` -> `countdown` -> (`bet` -> `flight` -> `after`) x4 -> `over`.

- **Todos los relojes de fase son de pared** (`performance.now()`): cuenta regresiva,
  ventana de apuestas, vuelo y pausa. Nada se acumula por cuadro, así una pestaña lenta o
  en segundo plano no se atrasa respecto del resto de la mesa. (La primera versión contaba
  la cuenta regresiva con `dt` topeado y, con el render lento del navegador de pruebas,
  nunca llegaba a la apuesta.)
- `bet`: en sala la ventana dura `BET_TIME` (7 s) fija. Solo dura `SOLO_BET_TIME` (14 s) y
  **apostar despega** a los `SOLO_LAUNCH_DELAY` (0.8 s). **Apostado queda apostado**: el
  paño se va y no hay cómo retirarla.
- `flight`: se cobra **tocando cualquier parte de la pantalla** (o ESPACIO), con
  `pointerdown` sobre el container y el **instante del evento** (`e.timeStamp`), no el del
  cuadro siguiente. Se cobra el multiplicador redondeado hacia abajo a centésimos, que es
  el que se muestra.
- `after`: `AFTER_TIME` (2.8 s) mirando la explosión; después fundido a negro y cohete
  nuevo en la plataforma.
- Solo, si no alcanza para la apuesta mínima, la partida termina ("Te fundiste"). En sala
  se sigue mirando hasta el final.

## Que se entienda de un vistazo (pedido del programador)

La primera versión no se entendía: fichas que "sumaban", botones ½ / x2 / Borrar, y un
"x1.00" en el cartel mientras se apostaba. Lo que quedó:

- **Paño con dos pasos numerados**: "1 Elegí cuánto apostar" (cada ficha **fija** la
  apuesta: 50, 100, 250, 500 o TODO; la elegida sube con aro dorado) y "2 Tocá para
  apostar" (el botón dice "APOSTAR 250"). Debajo de las fichas, un ejemplo: "Si cobrás en
  x2 te llevás 500". El paso que toca late. En el celu se apilan en ese orden (con el 2
  arriba del 1 no se entendía).
- **Antes del despegue el cartel grande es la cuenta regresiva** ("12 segundos para
  apostar"), no un multiplicador.
- **Con fichas arriba se va todo** (paño, marquesina, historial) y queda un **número
  gigante** (`Hud.setLive`): el multiplicador, "+N si cobrás ahora" y una pastilla que late
  "tocá la pantalla para cobrar". Al cobrar se pone turquesa pero **sigue subiendo con el
  cohete** (pedido del programador: ver todo lo que se perdió): abajo queda fijo "Cobraste en
  x1.40 · +N" y la pastilla dice "si seguías: +M". El paño vuelve recién cuando explota.
- La tarjeta de inicio lo explica en tres pasos.

## Simulación (`Flight.ts`)

Consultado `SIMULATION_ARCHITECTURE.md`: el crash no está en la matriz. **Punto de explosión
sembrado + curva exponencial cerrada**, sin física.

- Cada vuelo se decide al despegar a partir de su semilla (`hashSeed(base:vuelo)`, con
  `base` = `código:ronda` en sala o al azar solo). Nada de `Math.random()` adentro: todos
  los clientes ven el mismo cohete.
- Explosión: `P(llegar a xN) = EDGE / N` con `EDGE` = 0.97 (3% revienta en la plataforma) y
  tope `MAX_CRASH` = x50. Multiplicador `m(t) = e^(GROWTH·t)`, `GROWTH` = 0.11 (x2 a los
  6.3 s, x10 a los 21 s).
- **Explota sin aviso, a propósito: es timba.** Hubo una versión con avisos (el motor tosía
  con humo negro antes de explotar y amagaba con humo blanco), validada con bots para que
  la habilidad pesara; el programador la sacó porque "es casino y timba". Consecuencia
  conocida y aceptada: en promedio todas las estrategias de cobro valen lo mismo (el valor
  esperado de cada ficha apostada es 0.97); el juego es de nervios y de suerte, no de
  reflejos. No volver a meter avisos sin preguntar.

## Escena (`Stage.ts` y compañía)

- `City.ts`: tejado del casino con la plataforma, la torre con brazo que se retira al
  despegar, el letrero con bombitas que corren (`InstancedMesh`), la avenida (todos los
  edificios en **una** malla con `mergeGeometries`, UV escaladas al tamaño de cada uno),
  letreros de neón, reflectores, la alfombra de luces del piso y un **dirigible** con
  letrero de neón que cruza el cielo.
- `Stage.ts` además tira **fuegos artificiales** sobre la avenida mientras se apuesta.
- `Rocket.ts`: casco torneado (`LatheGeometry`) con laca, faja y remaches; nariz y tobera
  cromadas; aletas en flecha orientadas para que ninguna quede de canto; fuego con shader
  propio (dos conos aditivos).
- `Sky.ts`: domo con gradiente según la altura (el espacio llega hacia x10), estrellas,
  estrellas atómicas de cuatro puntas, nubes, la luna del fondo (se apaga en el espacio) y
  el Sputnik.
- `Space.ts`: **lo que se cruza subiendo mucho** — la Luna (x5.6), Marte (x9.4), un planeta
  con anillos (x14), un gigante azul (x20), uno verde con anillos (x27.5) y uno de lava
  (x36.5), cada uno con atmósfera; un cinturón de asteroides entre x11 y x17, y polvo
  espacial que pasa más rápido cuanto más rápido va el cohete. **Los planetas se ubican
  con la dirección de la cámara de vuelo** (`at(d, l)`: distancia por la mirada y
  corrimiento lateral): puestos en x/z del mundo a ojo quedaban fuera de cuadro (la cámara
  mira hacia −x/−z) o tapando al cohete.
- `Particles.ts`: dos pools en `THREE.Points` (aditivo y normal) con Float32Arrays
  preasignados, sin `new` por cuadro.
- `Parachute.ts`: el que cobra salta con el muñeco de bloques de la casa (remera del color de
  su asiento) colgado de un paracaídas a rayas, con su nombre.
- Altura: `y = 10·(m − 1)`, que acelera con el multiplicador.

Gotchas medidos en capturas (no "simplificar"):

- **La cámara de vuelo va pegada al cohete**: se interpola el desplazamiento respecto del
  cohete, no la posición. A x30 sube a ~35 unidades/s y una cámara que lo "persigue" se
  quedaba atrás mirando solo el fuego.
- **El entorno de reflejos va SOLO en lo metálico** (cohete, Sputnik, planetas) y es una
  noche de neón propia (`neonEnvironment`). Con el `RoomEnvironment` de three en toda la
  escena la noche quedaba lavada y el cromo tenía manchas quemadas.
- **Bloom con umbral alto (0.94):** florecen el neón, el fuego y las bombitas (color por
  encima de 1 y `toneMapped: false`); la laca y la faja crema, no.
- **La luz del fuego va debajo de la tobera y es chica:** arriba lavaba la laca roja a blanco.
- **Las explosiones usan pocas partículas aditivas y medio transparentes:** amontonadas
  saturaban la pantalla a un disco blanco.
- **La tapa del casino queda 0.2 por debajo del techo:** a la misma altura había z-fighting.
- Los letreros se pintan en canvas con **Monoton relleno** (en trazo salía rayado).
  `main.ts` espera las fuentes antes de crear el juego.

## Salas

- `initRoomMode` con `onStart` -> `beginCountdown`. No necesita `roomTimeLimitSec`: los
  cuatro vuelos corren solos aunque nadie apueste (peor caso ~3 min).
- `getScore` (parcial si se corta la ronda): fichas más lo apostado si el corte cae en la
  ventana de apuestas; en vuelo, lo apostado está en juego y no se cuenta.
- **En vivo** (`Rivals.ts`), por el `broadcastLive` de la sala: `{g:"ck", r, f, b, c, k}`
  (vuelo, apuesta, multiplicador al que cobró x100 o −1 si explotó, fichas). Solo cuando
  cambia algo más un keepalive cada 2 s: unos pocos mensajes por segundo con la sala llena.
  Cuando un rival cobra en el vuelo en curso, salta su paracaídas con su nombre y aparece
  el aviso. La lista "La mesa" ordena por fichas.
- `devRoom.ts`: sala falsa solo en desarrollo (`?dev=Ana&roster=Ana,Beto&code=X`, una
  pestaña por jugador, viaja por `BroadcastChannel`).

## Celular

`mobile: true`. Arranque por toque sobre el container; cobrar es tocar la pantalla. El paño
se reacomoda a 760 px y la cámara abre el campo en vertical. Verificado a 390x844.

## Pruebas

Para medir de verdad, Playwright tiene que usar la GPU (`--use-angle=metal --enable-gpu
--ignore-gpu-blocklist`): con el SwiftShader por defecto va a ~7 cuadros por segundo, la
escena se ve distinta y cualquier prueba que espere un tiempo de juego se vuelve eterna.
