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
Minotauro, oscuridad, rivales, llama, ojos y particulas. La memoria de lo recorrido es
una textura de 1 px por celda escalada con suavizado (sale el difuminado gratis).

**Gotcha — el cuelgue del meandro:** `meander()` dibuja la greca en pasos de `unit`; si
el marco mide 0 (el nivel se armaba antes de `setMargins`) el bucle no avanza y la
pagina se cuelga sin error. Por eso: el guard `if (!(unit > 0.5)) return;`, `resize()`
en el constructor del `Renderer`, y `setMargins` antes del primer `buildLevel`. Se
encontro pausando la pagina con CDP (`Debugger.pause`); no lo saques.

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
  x, y, a, s}`), ~4/s y solo si cambio algo, keepalive cada 2 s. Cada uno ve las llamas
  palidas de los que estan **en su mismo nivel** y en la estela la lista con el nivel de
  cada uno (`†` el que ya murio). La posicion es cosmetica: no afecta al Minotauro ajeno.
- **`devRoom.ts`**: sala falsa solo en dev (`?dev=Ana&roster=Ana,Beto&code=X`, una
  pestana por jugador, viaja por `BroadcastChannel`). Asi se probo la vista de rivales
  sin Supabase.
