# Minotauro (`minotauro`)

Laberinto a oscuras en 2D (canvas, vista desde arriba). Sos Teseo con una antorcha:
cada nivel hay que llegar al **ovillo de oro** (la salida) antes de que el Minotauro te
encuentre. El laberinto se ve entero un instante al bajar y despues solo ilumina la
antorcha; lo ya recorrido queda como un recuerdo tenue. Caminar no hace ruido, correr
si. Cada nivel es mas grande, el Minotauro corre mas y huele antes. Se juega solo (con
ranking global) y en salas (cada uno en su pantalla, todos en el mismo laberinto, sin
game server).

Estetica: ver [DESIGN.md](DESIGN.md) ("Losa de Creta"). La referencia de estilo fue la
"Stone Labyrinth" de la coleccion miaai-lab (losa de piedra con meandro griego, luz de
antorcha); el juego es propio.

## Flujo

`ready` -> `countdown` -> `play` -> (`descent` -> `play`)* -> `caught` -> `over`.

- **El vistazo del laberinto pasa durante el 3/2/1** (`revealLen` = la duracion del
  countdown): la losa se ve entera y se va apagando hasta dejar solo la antorcha. En
  cada bajada (`descent`, `DESCENT_TIME` 2.2 s) se repite con el laberinto nuevo.
- La partida termina solo cuando te atrapan (`CATCH_DIST` sobre las posiciones
  interpoladas). No hay tope de niveles: el tamano se planta en `SIZE_MAX` (23x23) y
  la dificultad sigue subiendo por la velocidad de persecucion y el olfato.
- Puntaje por nivel: `LEVEL_POINTS + 200*(nivel-1) + max(0, (par - tiempo) * TIME_POINTS)`,
  con `par = celdas * PAR_PER_CELL`. Ranking `"higher"` (default, sin `scoring` en el
  `meta.ts`). El record local va en `localStorage` `minotauro:best`.
- **Aceite:** se consume con el tiempo (`oilBurnFor`, mas rapido en niveles hondos) y
  achica el radio de la luz entre `LIGHT_MAX` y `LIGHT_MIN`. Nunca llega a oscuridad
  total (`LIGHT_MIN` > 1 celda) a proposito: quedarse ciego es frustrante, no tenso.
  Las anforas en los callejones sin salida devuelven `OIL_AMPHORA`.
- **Sin aceite se pierde la estela** (pedido del programador: antes quedarse sin aceite no
  tenia ninguna consecuencia y parecia un bug, con un cartel que decia que la antorcha se
  apagaba y nada pasaba). Con el aceite en 0 (`forgetTrail`), la memoria de lo recorrido se
  desvanece en `MEMORY_FORGET` (6 s) salvo lo que la brasa sigue alumbrando, y el hilo de
  Ariadna se enrolla desde la punta vieja, una celda cada `THREAD_FORGET_STEP` (0.25 s).
  Un anfora frena el borrado pero **no devuelve** lo borrado: hay que volver a
  recorrerlo. La memoria es de 8 bits, asi que `Renderer.forget` acumula la fraccion por
  cuadro (restar 1 por cuadro la borraba en 4 s a 60 fps y dependia de los fps).

## Simulacion — metodo aprobado por el programador

Consultado `SIMULATION_ARCHITECTURE.md` (arquetipo laberinto + perseguidor). Aprobado:
**laberinto sembrado + A\* + HFSM** para el Minotauro, movimiento por celdas.

- **`Maze.ts`**: backtracker recursivo sembrado (`mulberry32`) + *braiding* (`BRAID`
  0.4 de los callejones se abren): sin lazos, la unica forma de escapar de una
  persecucion seria tener suerte. `exit` = la celda mas lejana a la largada.
  `path` es A\* (heuristica Manhattan) con un predicado `avoid` opcional;
  `distancesFrom` es un BFS multi-fuente; `sees` es linea de vista por pasillo recto.
- **La guarida va FUERA de la ruta** largada -> salida (a >= 4 celdas de la ruta, >= 4
  de la salida y >= 6 de la largada). Medido: con la guarida al azar, 93 de 200
  partidas tenian al Minotauro durmiendo en el camino obligatorio y el nivel 1 era una
  ruleta.
- **`Minotaur.ts`** (HFSM): `sleep` -> `wander` -> `investigate` (fue a un ruido) ->
  `chase` (te ve: A\* directo, `chaseStepFor` por nivel) -> `search` (te perdio de vista
  `LOSE_SIGHT`, revisa la ultima posicion `SEARCH_TIME`) -> `wander`. El ruido de cada
  paso tiene radio (`NOISE_WALK` / `NOISE_RUN` / `NOISE_BUMP` al chocar una pared).
  **Olfato** (`smellFor`): si pasa ese tiempo sin pistas, va derecho a donde estas.
  Existe para que quedarse quieto no sea una estrategia, y es lo que hace que una
  partida en sala termine sola aunque el jugador no toque nada.
- **`Player.ts`**: movimiento celda a celda con lista de prioridad de direcciones (la
  ultima tecla apretada manda, si esa pared esta cerrada prueba la anterior), asi
  doblar en una esquina con dos teclas no frena. El **hilo de Ariadna** se enrolla
  cuando volves sobre tus pasos.
- **La luz no atraviesa paredes**: `lightCells` hace un BFS acotado por el radio desde la
  celda del jugador y la oscuridad se pinta con esa mascara de alcance multiplicada por
  un gradiente radial. Sin eso la antorcha "veia" a traves de los muros y el laberinto
  se resolvia mirando.

## Balance — como se midio

Con un bot explorador (DFS con memoria, camina y corre como un jugador prudente) sobre
200 semillas por nivel. Porcentaje de niveles superados:

| Nivel | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Pasa | 78% | 68% | 61% | 57% | 52% | 56% | 51% | 46% | 50% | 41% |

El bot no recuerda el vistazo inicial ni escucha las pezunas, asi que un humano anda
mejor; la curva importa mas que el valor absoluto. Lo que movio la aguja: `BRAID`
0.28 -> 0.4, `NOISE_WALK` 2.6 -> 2.0, `SLEEP_FIRST` 5 -> 8 / `SLEEP` 3 -> 4.5, `SIGHT`
7 -> 5, `MINO_CHASE_START` 0.2 -> 0.24 (mas lento). Todo el tuning esta en
`game/constants.ts`.

Rendimiento medido en el nivel 8 (23x23) a 1440x900: cuadro p50 8.3 ms, `draw()` ~5 ms.

## Render (`Renderer.ts`)

La losa (marco, meandro, rosetas, piso de arenisca, muros con biselado) se pinta **una
vez por nivel** en un canvas aparte; por cuadro solo van hilo, anforas, ovillo,
Minotauro, oscuridad, ojos, particulas y, afuera del recorte del tablero, los muñecos con su antorcha. La memoria de lo recorrido es
una textura de 1 px por celda escalada con suavizado (sale el difuminado gratis).

**Gotcha — el cuelgue del meandro:** `meander()` dibuja la greca en pasos de `unit`; si
el marco mide 0 (el nivel se armaba antes de `setMargins`) el bucle no avanza y la
pagina se cuelga sin error. Por eso: el guard `if (!(unit > 0.5)) return;`, `resize()`
en el constructor del `Renderer`, y `setMargins` antes del primer `buildLevel`. Se
encontro pausando la pagina con CDP (`Debugger.pause`); no lo saques.

## Teseo en 3D (`Doll3D.ts`, con `Doll.ts` de respaldo)

El jugador es el muñeco de bloques de la casa (el de Marea de Lava: mismas medidas, mismas
texturas pixeladas de 8x8, copiado y no importado) **en 3D**, con la antorcha levantada.
El programador lo pidio asi en dos pasos: primero "una persona con una antorcha" en vez
de la llama, y despues "que sea en 3D, no 2D". El laberinto **sigue siendo canvas 2D**:
`DollStage` tiene un solo `WebGLRenderer` chico fuera de pantalla con una camara
ortografica fija en tres cuartos (`ELEVATION` 60 grados), renderiza cada muñeco de a uno
y lo estampa con `drawImage` (por eso `preserveDrawingBuffer`). Lo alumbra una
`PointLight` en la punta de su propia antorcha mas una hemisferica calida. `draw`
devuelve la punta de la antorcha proyectada a px, y de ahi salen la llama 2D y las
brasas. Si no hay WebGL, el `Renderer` cae a `Doll.ts`, el mismo muñeco dibujado en 2D.

- El paso no viaja por la red: el `Renderer` lo deriva de cuanto se movio cada muñeco
  entre cuadros (`gait`, un paso por celda; un salto de mas de media celda es una bajada
  o una reaparicion y no se camina). El giro es continuo, por el camino corto: el propio
  mira segun `heading` (que tambien gira al chocar una pared), los rivales hacia donde
  se mueven.
- **Gotcha de lectura, medido en capturas:** visto desde arriba, dos piernas oscuras que
  se abren ocupan mas ancho que el torso de perfil y forman una cuña que parece un
  muñeco sentado. Por eso el balanceo es corto (0.28 rad), el pantalon es un poco mas
  claro que el de Marea de Lava (con la luz naranja el original se iba a negro) y el
  brazo de la antorcha va bien arriba (horizontal tapaba el torso).
- **Los muñecos se dibujan afuera del recorte del tablero**: en la primera fila la
  cabeza y la llama asoman sobre el marco, y recortadas quedaban rotas.
- Color: `lookFor(asiento)`, con el asiento = orden en `players()` (en solo, el 0,
  remera roja). Three.js va en el chunk compartido `three.module` (~150 KB gzip), el mismo
  que ya bajan los juegos 3D de la casa; el codigo propio del juego queda en ~20 KB gzip.

## HUD

A >= 1080 px dos estelas a los costados (ITER: nivel en numeros romanos, tiempo,
puntos; LVMEN: aceite, estado del Minotauro, record, la sala). Mas angosto, una tira
arriba. `margins()` le dice al renderer cuanto lugar dejar. El estado del Minotauro
("Duerme / Ronda / Escucho algo / Te busca / Te persigue") es informacion de juego, no
decoracion: es lo que permite decidir cuando correr.

## Celular

`mobile: true`. Arranque con toque sobre el **container** (la tabla de inicio tapa el
canvas). Joystick flotante: donde apoyas el dedo, arrastras para caminar; boton CORRER
en pantalla. Verificado con Playwright `hasTouch` a 390x844 (el jugador se mueve y el
hilo crece).

## Salas

- `initRoomMode` con `onStart` -> `beginCountdown`. La semilla es
  `hashSeed(code:round)`: todos bajan por los mismos laberintos y el mismo Minotauro.
- `roomTimeLimitSec: 240`: el olfato hace que un jugador quieto muera solo, pero uno
  bueno puede bajar mucho tiempo; el tope corta la ronda. El parcial (`getScore`) es el
  puntaje acumulado, comparable con el de los que ya murieron (`"higher"`).
- **Rivales en vivo** (`Rivals.ts`): por el `broadcastLive` de la sala (`{g:"mn", r, lv,
  x, y, a, s}`), ~4/s y solo si cambio algo, keepalive cada 2 s. Cada uno ve los muñecos
  de los que estan **en su mismo nivel**, con el color de su asiento (orden de `players()`) y en la estela la lista con el nivel de
  cada uno (`†` el que ya murio). La posicion es cosmetica: no afecta al Minotauro ajeno.
- **`devRoom.ts`**: sala falsa solo en dev (`?dev=Ana&roster=Ana,Beto&code=X`, una
  pestana por jugador, viaja por `BroadcastChannel`). Asi se probo la vista de rivales
  sin Supabase.
