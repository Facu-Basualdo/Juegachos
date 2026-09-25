# Luz Roja, Luz Verde (`luz-roja`)

La cancha de "luz roja, luz verde" de Squid Game, en 3D (Three.js, camara fija
detras del jugador). La muñeca gigante canta de espaldas y todos corren hacia la
linea roja; cuando gira la cabeza y se le prenden los ojos, el que se mueve queda
eliminado. 45 segundos para cruzar. **Solo se juega en salas** y **necesita el game
server** (como Derrumbe o Manchon).

Estetica: ver [DESIGN.md](DESIGN.md) ("Patio Pintado"). Homenaje a la escenografia
de la serie (paredes con cielo pintado, muñeca, arbol, guardias de rosa, joggings
numerados), todo hecho por codigo, sin logos ni imagenes del original.

## Pedido del programador

"Que no sea tan largo, pero que sea complicado", y despues (2026-09-25) "hay que hacerlo mas
complicado". Corto: 45 s de tope y 60 m de cancha. Complicado por todos estos lados, todos de
tuning (primera version -> la actual):

- **Cuatro ritmos de verde** (`GREEN_PROFILES` del server): **relampago** 0.65-1 s (nuevo, 20%),
  rapido 1.1-1.9 s, medio 2.2-3.3 s y lento 3.6-4.8 s. El relampago no deja ni arrancar.
- **La cancion no siempre va pareja** (`SONG_MODES`, viaja como `song` en el estado): pareja,
  **acelerada** (arranca lenta y las ultimas silabas se atropellan) o **cortada** (canta seis
  silabas, se calla y remata el "1, 2, 3" de golpe). Contar silabas ya no alcanza. El primer
  verde y los relampago cantan parejo.
- **Amagues** (`TEASE_CHANCE` 0.25 -> **0.45**): a mitad de un verde de 1.6 s o mas, la muñeca
  arranca a girar la cabeza y vuelve. No cambia la luz; castiga al que frena de mas.
- **Frenar cuesta mas** (`ACCEL` 11 -> **8.5**: de lleno a quieto ~0.35 s).
- **Menos margen** (`TURN_MS` 600 -> **450** ms desde que se ve el rojo hasta que se prenden los
  ojos) y **mas sensible** (`MOVE_EPS` 0.35 -> **0.25** m/s). Con el margen y el frenado, reaccionar
  al giro no alcanza: hay que soltar antes, leyendo la cancion.

## Arquitectura

- **Server** (`server/src/games/luzroja.ts`, namespace `/luzroja`, prefijo `lr:`):
  duenio del semaforo, del reloj y del resultado de cada uno. Valida la llegada
  (`lr:fin` solo vale si la ultima posicion declarada ya cruzo) y elimina al que no
  cruzo a los 45 s. Reenvia las posiciones a 20 Hz.
- **Cliente** (`game/Game.ts`): simula su muñeco y **juzga su propia
  eliminacion**. Es a proposito: el rojo le llega a cada uno con su latencia, y
  juzgarlo en el server eliminaria al de peor conexion mientras en su pantalla
  todavia era verde. El margen `TURN_MS` se cuenta desde que ESTE cliente recibe
  el rojo. Spoofeable, como la posicion: mismo nivel de confianza que ya acepta el
  repo para los puntajes.

La cancion se agenda con el reloj del `AudioContext` (sub-ms), no con timers: cada
silaba cae exacta en su lugar del verde. El HUD marca las silabas cantadas, asi el
ritmo tambien se ve con el telefono en silencio.

**Puntaje (`higher`):** el que cruza suma `100 + segundos que le sobraron`; el que no,
su avance hacia la meta (0-100). Un solo numero ordena bien a todos: cualquiera que
cruzo le gana a cualquiera que no, y entre los que no cruzaron gana el que llego mas
lejos. El `format` del `meta.ts` lo muestra como "paso (+X s)" o "N% del camino".

**Sale solo:** quieto no te eliminan, pero a los 45 s el server elimina a todos
los que no cruzaron. `roomTimeLimitSec: 70` es la red por si el server se cae
despues de largar.

## Gotchas

- **La muñeca le da la ESPALDA a la cancha con el cuerpo** y solo gira la cabeza,
  como en la serie. En `Doll.ts` el `root` esta rotado PI y el angulo de la cabeza
  es local: 0 = hacia el arbol, PI = hacia la cancha.
- **El primer verde lo manda el server**, no el fin del countdown local: sin luz no
  hay como saber cuando es seguro correr, asi que el cliente no larga solo.
- **La posicion de cada asiento se siembra con la largada** (como en Derrumbe):
  sin eso cada uno es invisible para los demas durante el countdown.
- **Al cruzar se manda la posicion ANTES del `lr:fin`**: el server valida la
  llegada contra la ultima posicion declarada.
- **El reloj del HUD corre local** entre mensajes, a partir del ultimo `elapsed` y
  de cuando llego ese estado.
- **Resuelto (eliminado o pasado), se sigue mirando la cancha** desde atras de la
  largada: `onReportedWaiting` devuelve true. Los caidos quedan tendidos con su
  mancha, que es parte de la puesta en escena.
- **El `Hud` no monta el `LeaderboardPanel`:** en sala solo se reporta a la ronda, pero la partida **terminada** igual entra al ranking global: la registra `RoomMode` (ver "Global rankings" en el CLAUDE.md raiz), y se ve desde el boton "Ranking" de la card en la landing.
- **El HUD arranca en `top: 38px`** para no quedar debajo de la barra de la sala.

## Probar sin Supabase (`devRoom.ts`)

`/games/luz-roja/?dev=Ana&roster=Ana,Beto&code=TEST` en **dev**, una pestaña por
nickname con el mismo `code` y `roster`, contra un game server local
(`PORT=8811 npx tsx src/index.ts` en `server/` y Vite con
`VITE_GAME_SERVER_URL=http://localhost:8811`). El puntaje va a la consola y a
`window.__luzRojaScore`. En el build queda eliminado.

## Movil

`mobile: true`, verificado **en emulacion** (Playwright, iPhone 13, touch), no en un
telefono real: un dedo en cualquier lado es un joystick flotante, y soltarlo es
frenar. Los listeners cuelgan del container. En vertical el FOV se abre 16 grados.
No aplica el bug del "toque de arranque": la partida la larga RoomMode.
