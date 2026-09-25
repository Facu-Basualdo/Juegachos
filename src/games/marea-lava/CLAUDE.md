# Marea de Lava (`marea-lava`)

Trepada para salas, en 3D (Three.js, camara fija de frente a la pared). Una pared
de basalto llena de salientes y la lava subiendo desde abajo, cada vez mas rapido.
Se trepa saltando de plataforma en plataforma; gana el que llega mas alto, y
llegar a la cima es lo mejor. **Solo se juega en salas** y **necesita el game
server**.

Estetica: ver [DESIGN.md](DESIGN.md) ("Ascenso de Basalto"): la tercera de la
familia voxel (Derrumbe, Pista Loca), en version infernal. Todo por codigo.

## Arquitectura

- **Server** (`server/src/games/marealava.ts`, namespace `/marealava`, prefijo
  `ml:`): manda la **semilla** de la torre y el `elapsed`, lleva el resultado de
  cada uno (`run` / `dead` / `top` y la mejor altura), valida la cima contra la
  ultima posicion declarada y reenvia las posiciones a 20 Hz. Como red, elimina a
  quien quede `LAVA_MARGIN` (2 m) por debajo de la lava: un desconectado se queda
  quieto y la lava lo alcanza sola, sin timers aparte. Tope de 120 s.
- **Cliente** (`game/Game.ts`): genera la torre con la semilla (`Tower.create`),
  simula su muñeco (`Player.ts`, choque de cajas), calcula la lava con `lavaY` y el
  `elapsed` del server, y declara si lo alcanzo (`ml:dead`) o si llego (`ml:top`).

**La lava es una funcion del tiempo** (`lavaY(t) = -6 + 0.5 t + 0.006 t^2`, t en
s), duplicada en cliente y server. No viaja por la red: cada lado la calcula. Para
t = 60 s esta en ~46 m, a los ~86 s pasa la cima (80 m).

**Por que la muerte la juzga el cliente:** como en Derrumbe, reconciliar la fisica
de saltos contra el server se siente pastoso. El server solo pone la red de los 2 m.

## La torre (`Tower.ts`), lo mas delicado

Dos **caminos garantizados**, uno por mitad de la pared (sin franja compartida, no
se cruzan), mas ~26 salientes sueltos que abren rutas. Cada camino alterna dos
**carriles de profundidad** (atras y adelante) como una escalera de mano: dos
escalones seguidos estan en carriles distintos y no se pueden tapar. Cada escalon
sube 1.2-1.7 m (el salto llega a ~2 m) y queda a menos de ~2.1 m de borde a borde
del anterior. Cada camino termina en su cima (una saliente ancha a 80 m con
bandera); si las dos cimas caen en el medio, queda una sola compartida.

**La trampa a evitar:** una plataforma que tapa a otra de abajo con menos espacio
libre que cuerpo + salto (1.8 + 1.7 = 3.5 m) la vuelve inutil: desde ahi el salto
pega en la cabeza. Con direccion al azar pasaba en todas las torres, y sobre todo
en las vueltas del camino (cuando llega al borde de su mitad) y en la cima. Por eso:

- Cada escalon prueba varios candidatos (seguir, dar la vuelta en el carril, dar la
  vuelta cambiando de carril, variantes corridas y un poco mas altas) y se queda
  con el primero que no tape a ningun escalon de su carril con menos de 3.6 m y
  siga al alcance.
- La cima chequea eso contra **todas** las plataformas (una cima sobre los ultimos
  escalones del otro camino lo dejaba sin salida).
- Los salientes sueltos solo entran donde no tapan a nadie (`crowds`, 3.6 m).
- **`Tower.create(seed)` verifica la torre** (`valid()`: BFS desde el piso con el
  criterio de salto de arriba, sin contar como despegue a una plataforma tapada del
  todo) y, si alguna cima no se alcanza, prueba con la semilla siguiente. Pasa en
  ~1 de cada 70 semillas. Es deterministico: todas las pantallas terminan en la
  misma torre sin hablar entre si.

Medido: 3000 semillas, 0 torres invalidas despues de `create`; generar y
verificar tarda ~0.23 ms. Y con la fisica real: un bot trepador (apunta al escalon
alcanzable mas cercano y salta a menos de 2.25 m del borde) llego a la cima en 54 s.

**Si se toca el salto, la altura de los escalones o los carriles, rehacer la
verificacion** (el criterio de `valid()` asume ese salto).

## Gotchas

- **Nada pasa del borde del frente**: los jugadores arrancan en un pasillo delante de
  los carriles (z = 3.1). La primera version los hacia aparecer debajo del primer
  escalon, a la altura del cuerpo, y quedaban trabados sin poder moverse.
- **La geometria de la torre se arma a mano** (`TowerView.ts`) con UV en metros, en
  tres mallas (tapas de piedra negra, tapas luminosas, cantos): un pixel de textura
  mide lo mismo en todas las plataformas, sin estirarse con el tamaño.
- **Luz:** la lava lleva una luz naranja pegada a su superficie (sube con ella) y el
  jugador un "farol" frio (`Stage.setFocus`). Sin el farol, a media altura todo
  quedaba casi negro y no se distinguian las plataformas.
- **Camara:** fija de frente a la pared, sigue la altura con retraso. En vertical se
  aleja (`CAM_BACK_PORTRAIT`) y sube el encuadre: si no, media pantalla es lava.
  Resuelto, sigue al que va mas alto de los que siguen trepando.
- **La posicion de cada asiento se siembra con la largada**, como en Derrumbe.
- **Puntaje (`higher`):** la mejor altura en metros; el que llega a la cima suma
  `100 + segundos que le sobraron`, asi cualquiera que llego le gana a cualquiera
  que no. El `format` del `meta.ts` lo muestra como "cima (+X s)" o "N m".

## Probar sin Supabase (`devRoom.ts`)

`/games/marea-lava/?dev=Ana&roster=Ana,Beto&code=TEST` en **dev**, una pestaña por
nickname con el mismo `code` y `roster`, contra un game server local. El puntaje va
a la consola y a `window.__mareaLavaScore`. En el build queda eliminado.

## Movil

`mobile: true`, verificado **en emulacion** (Playwright, iPhone 13, touch), no en un
telefono real: joystick flotante en cualquier lado y boton SALTAR.
