# La Cuerda (`la-cuerda`)

La prueba de la cuerda de Squid Game, en 3D (Three.js, camara en tercera persona
detras del muñeco). Un puente angosto sobre el vacio con **dos cuerdas** enormes,
cada una girada por dos muñecos gigantes y cada vez mas rapido, y en el puente **se
empuja**. Para pasar cada zona hay que colarse entre dos pasadas o saltar la cuerda;
justo debajo de la primera el puente tiene un tramo roto. Gana el que llega mas
lejos, y cruzar es lo mejor. **Solo se juega en salas** y **necesita el game server**.

Es **Marea de Lava con cuerdas en el lugar de la lava** (mismo reparto
cliente/server, mismo `Player`, misma camara y mismos controles) **mas el empujon de
Pista Loca**. Si algo no esta documentado aca, mirar el `CLAUDE.md` de `marea-lava`
(y el de `pista-loca` para el empujon).

Estetica: ver [DESIGN.md](DESIGN.md) ("Patio de Pastel"). Todo por codigo.

## Metodo de simulacion (aprobado por el programador)

Arquetipo "Saltos Reactivos" de [SIMULATION_ARCHITECTURE.md](../../../SIMULATION_ARCHITECTURE.md):
cinematica analitica, nada de simular la cuerda como cuerpo fisico.

- **Cada cuerda es una funcion del tiempo** (`ropeAngle(rope, t)` en `constants.ts`):
  `th(t) = phase + dir (w0 s + 1/2 accel s^2)` (s en segundos). `th = 0` es abajo,
  rozando el tablero. Antes de la largada gira a velocidad constante, asi en la
  cuenta regresiva ya se lee el ritmo. Duplicada en el server; no viaja por la red,
  cada lado la calcula con el `elapsed` del estado.
- **Las dos cuerdas (`ROPES`)**, con 16 m entre ejes:

  | | z del eje | arranca a | gira | en la largada |
  | --- | --- | --- | --- | --- |
  | 1 | -20 | 21 vueltas/min (2.2 rad/s) | por abajo barre hacia la salida (`dir` 1) | arriba |
  | 2 | -36 | 25 vueltas/min (2.6 rad/s) | por abajo barre hacia la meta (`dir` -1) | abajo |

  Las dos aceleran 0.025 rad/s^2. La segunda gira al reves, mas rapida y desfasada
  media vuelta **a proposito**: el ritmo que aprendiste en la primera no sirve para la
  segunda. Para agregar una tercera alcanza con sumarla a `ROPES` (en los dos lados) y
  a `GIANT_SUITS` en `Stage.ts`; dejar ~6 m de puente seguro entre zonas.
- **Geometria**: cada cuerda gira alrededor del eje x (el que une las manos de sus
  muñecos, a `ROPE_AXIS_Y` = 5.55 m sobre el tablero, en `rope.z`). El punto de la
  cuerda a la altura `x` del jugador esta en
  `(z, y) = (rope.z + r sin th, ROPE_AXIS_Y - r cos th)`, con `r = ropeRadius(x)`
  (5.3 m en el medio del puente: abajo pasa a 0.25 m del tablero).
- **El golpe (`ropeHits` en `Course.ts`) barre el arco** entre el angulo del cuadro
  anterior y el actual en pasos de 0.02 rad, no mira solo el final: en la punta la
  cuerda llega a ~25 m/s y en un cuadro atraviesa el cuerpo entero. El arco puede ir
  para cualquier lado (`dir`). Si suma mas de una vuelta (pestaña dormida) se barre
  una sola: una vuelta ya pasa por todos lados.
- **El jugador** es el `Player` de Marea de Lava (Euler semi-implicito, paso fijo de
  120 Hz, choque AABB eje por eje) sin los topes de la pared: salirse del puente es
  caerse. Salto de ~2 m y 0.73 s en el aire.

Zona peligrosa de cada cuerda: pasa a la altura del cuerpo parado (<= 1.9 m) a
+-3.9 m de su eje, y a la de un cuerpo en el aire (<= 3.9 m) a +-5 m. Entre las dos
zonas quedan ~6 m de puente seguro (z de -25 a -31) para frenar y medir la segunda.

## Empujon (pedido del programador)

Es el de Pista Loca, mas suave: F en la compu, boton EMPUJAR en el celu (el clic no,
porque aca captura el mouse para mirar). Empuja hacia donde mira el muñeco.

- **Lo resuelve el server** (`push` en `lacuerda.ts`): alcanza a los que siguen en
  carrera a menos de `PUSH_RANGE` (1.6 m), a la misma altura (+-1.3 m) y adelante
  (dentro de `PUSH_ARC`, 1.2 rad, de hacia donde mira). A cada uno le manda
  **dirigido** `lc:shove` con el impulso (`PUSH_FORCE` 7 m/s, mas fuerte de cerca, y
  `PUSH_LIFT` 3.5 m/s para arriba) y a todos `lc:pushfx` para la animacion de brazos.
- **Mas suave que en Pista Loca (7 contra 11 m/s)**: en un puente de 1.2 m cualquier
  envion de costado ya te tira, y uno de frente te mete en la cuerda en mal momento.
  Medido en el navegador: un empujon a ~1 m de frente desplaza ~2 m.
- **Solo sobre el puente** (`onBridge`: el que empuja y el empujado entre z = 0 y la
  meta). En la salida, al largar, todos se tirarian del borde antes de llegar al
  puente; en la meta ya cruzaron.
- **El vuelo lo simula el empujado** (`Player.shove`): reemplaza su velocidad
  horizontal y por `SHOVE_STUN` (0.35 s) casi no controla el muñeco (`SHOVE_ACCEL`).
  Sin ese aturdimiento el joystick lo frena en el acto y el empujon no mueve a nadie.
- **Enfriamiento de 1.5 s en los dos lados** (`PUSH_COOLDOWN_MS`, duplicado): el del
  server es el que vale; el del cliente solo pinta el boton (se llena de arriba).
- **Antes del empujon se manda la posicion** (`tryPush`): el server mide el alcance con
  la ultima declarada y a 20 Hz puede tener 50 ms de atraso.
- El `pushPending` se consume en todos los estados, no solo jugando: si no, una F del
  countdown salia como empujon al largar.

## Arquitectura

- **Server** (`server/src/games/lacuerda.ts`, namespace `/lacuerda`, prefijo `lc:`):
  lleva el reloj y el resultado de cada uno (`run` / `dead` / `goal` y el mejor
  avance), resuelve los empujones, valida la meta contra la ultima posicion declarada
  y reenvia las posiciones a 20 Hz. El puente es fijo, asi que no hay semilla (a
  diferencia de Marea de Lava). Tope de 90 s: el que no cruzo queda afuera con lo que
  avanzo.
- **Red del server** (lo que en Marea de Lava hacia `LAVA_MARGIN`): elimina al que
  declara una posicion 2 m por debajo de `FALL_Y` (cayo y no pudo avisar) y les pasa
  las cuerdas a los **desconectados** con su ultima posicion: el que se quedo parado en
  una zona cae solo. El desconectado que se quedo fuera de las zonas espera al tope.
- **Cliente** (`game/Game.ts`): simula su muñeco (tambien el vuelo del empujon),
  calcula las cuerdas y declara si lo agarro una cuerda o se cayo (`lc:dead`) o si
  llego (`lc:goal`: en el piso de la plataforma de meta, 0.3 m pasada la linea).

**Por que la muerte la juzga el cliente:** como en Marea de Lava y Luz Roja, juzgarla
en el server castigaria al que tiene peor conexion.

## El recorrido (`Course.ts`)

Plataforma de salida (10 x 7 m) -> puente de 1.2 m de ancho -> cuerda 1 con el tramo
roto de 1.6 m entre `GAP_NEAR` y `GAP_FAR` (1 m pasado su eje, del lado de la meta) ->
tramo seguro -> cuerda 2 -> plataforma de meta en `GOAL_Z` (-52). El avance
(`progressOf`) son los metros de -z, de 0 a 52.

**Medido con un bot** (corre derecho, salta si alguna cuerda lo tocaria en los
proximos 120 ms y salta el tramo roto en el borde), entrando en 60 momentos distintos
de cada vuelta, a los 0, 10, ... 80 s de partida:

- La cuerda 2 sola (arrancando en el tramo seguro): cruza en el 53-78% de las
  entradas.
- El puente entero con puros reflejos: 28-52%, en cualquier momento de la partida.
- El puente entero esperando en el tramo seguro a que la cuerda 2 acabe de pasar:
  casi ninguna muerte en la cuerda 2 (45-65% de cruces, lo que queda son la cuerda 1
  y el tramo roto). La excepcion son los 10 s, donde la ventana fija del bot cae justo
  mal; es una limitacion del bot, no del juego.

O sea: siempre se puede cruzar, y elegir cuando meterse importa. **Si se toca el
salto, las cuerdas (radio, eje, velocidad, sentido) o el tramo roto, rehacer esa
medicion.**

## Gotchas

- **La largada va en dos carriles alineados con el puente**, uno detras del otro
  (`spawnPos` del server). La primera version los ponia en fila ancha sobre la
  plataforma: los de las puntas arrancaban derecho, pasaban al costado del puente y se
  caian al vacio antes de entender que habia que ir al medio. No hay choque entre
  jugadores, asi que encimarse no molesta (y el empujon esta apagado en la salida).
- **El brazo de cada muñeco cuelga del mismo grupo que su cuerda** (`Stage.ts`): gira
  con ella sin calcular nada. El hombro de ese brazo cae justo sobre el eje, por eso
  el torso del muñeco esta corrido 1.35 m en z.
- **La sombra de cada cuerda** (un rectangulo oscuro sobre el tablero, en la z por
  donde va a pasar, mas opaco cuanto mas baja viene) es informacion, no decorado: con
  la camara detras, la cuerda que baja por delante queda muchas veces fuera de cuadro.
- **El ritmo tambien se escucha**: silbido 0.7 rad antes de cada pasada por abajo (en
  el sentido de giro de esa cuerda) y un golpe seco al pasar. Cada cuerda suena mas
  fuerte cuanto mas cerca de su zona estas, asi las dos no se pisan.
- **El HUD muestra la cuerda mas cercana** ("CUERDA 2 · 25 VUELTAS/MIN"), que late en
  rojo dentro de su zona. En el celu "VUELTAS" se esconde por CSS y la lista de
  jugadores y los avisos bajan debajo del cartel: a 390 px se pisaban.
- **El cielo es una cupula con color por vertice** (`skyDome`): pastel arriba y ciruela
  debajo del horizonte. Un plano oscuro abajo se veia como un piso, no como un vacio.
- Al quedar afuera, el muñeco propio sale volando (`Player.fling` + `drift`, hacia
  donde iba la cuerda que lo agarro) y la camara pasa a una vista de costado del
  puente, siguiendo al que va adelante.
- **Puntaje (`higher`):** el avance en metros; el que cruza suma
  `100 + segundos que le sobraron`. El `format` del `meta.ts` lo muestra como
  "cruzó (+X s)" o "N m". Los ceros de "sin conexion" y del que no tiene asiento se
  reportan con `{ ranked: false }`, como en Marea de Lava.
- **Portada**: `public/covers/la-cuerda.jpg` es una captura del juego (provisoria, de
  la version de una sola cuerda), no una ilustracion como las del resto del roster.

## Probar sin Supabase (`devRoom.ts`)

`/games/la-cuerda/?dev=Ana&roster=Ana,Beto&code=TEST` en **dev**, una pestaña por
nickname con el mismo `code` y `roster`, contra un game server local
(`VITE_GAME_SERVER_URL=http://localhost:8787` en el entorno de `npx vite` pisa al
`.env`). El puntaje va a la consola y a `window.__laCuerdaScore`. Con Playwright, cada
jugador en su propio `browserContext`: dos pestañas del mismo contexto se duermen entre
si (una queda en segundo plano y deja de simular).

## Movil

`mobile: true`, verificado **en emulacion** (Playwright, 390x844, touch), no en un
telefono real: joystick flotante en la mitad izquierda, la derecha mira, y botones
EMPUJAR y SALTAR abajo a la derecha.
