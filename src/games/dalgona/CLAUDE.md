# Dalgona (`dalgona`)

La prueba de la galleta de azucar de Squid Game, en 2D (canvas, vista desde arriba
de la lata). Se elige una de cuatro latas a ciegas y adentro hay un circulo, un
triangulo, una estrella o el paraguas. Hay `TIME_LIMIT` (75 s) para sacar la figura
del caramelo con la aguja sin que se parta. Se juega solo (con ranking global) y en
salas (cada uno en su pantalla, sin game server).

Estetica: ver [DESIGN.md](DESIGN.md) ("Caramelo en la Lata"), la hermana de Luz Roja.

## Flujo

`ready` -> `countdown` -> `reveal` -> `playing` -> `broken` / `done` -> `over`.

- **La lata se elige DURANTE el 3/2/1** (clic, toque o teclas 1-4), no en una pantalla
  aparte: asi el countdown obligatorio del repo no se saltea y en salas (donde el
  `onStart` de `RoomMode` arranca a todos juntos) cada uno elige mientras cuenta. Si
  llega el YA sin elegir, toca una al azar. Las figuras se barajan entre las latas en
  cada partida (`shuffle`), asi que la eleccion es de verdad a ciegas.
- `reveal` (`REVEAL_TIME`, 1.1 s): la lata va al centro y la tapa sale. El reloj
  arranca recien despues.
- Se termina por figura afuera (`done`), galleta rota (`broken`) o reloj en cero. Las
  dos ultimas dan 0. Se mira el final `END_HOLD` (1.5 s) antes del cartel.

**Sale sola:** quieto, el reloj llega a cero y la partida termina con 0, asi que en
salas no hace falta `roomTimeLimitSec`.

## Simulacion (`Candy.ts`) — metodo aprobado por el programador

Consultado `SIMULATION_ARCHITECTURE.md`: no hay arquetipo exacto (el mas cercano es
"Precision") y **no** hay fisica de cuerpos rigidos. Modelo de **tension acumulada por
tramo**, determinista, sin azar en el bucle:

- El contorno de la figura se remuestrea cada `SAMPLE_STEP` y se parte en tramos de
  `BIN_LEN`. Cada tramo lleva `carve` (0-1, cuanto se tallo) y `stress` (0-1, cuanto
  cruje).
- **Tallar:** con la aguja a `tol` de la linea, cada pasada completa suma `PASS_DEPTH`
  (tres pasadas cortan un tramo) y quedarse quieto talla despacio
  (`CARVE_STILL_TIME`). Se talla por **largo recorrido** a proposito: una version
  tallaba por tiempo encima y entonces ir rapido no terminaba antes, solo sumaba
  riesgo. Ahora apurarse rinde y cruje: ese es el riesgo contra la recompensa.
- **Tension:** por velocidad (`K_SPEED` por el cuadrado del exceso sobre `V_SAFE`,
  repartido por largo recorrido), por apretar fuera de la linea (`K_INSIDE` del lado de
  adentro de la figura, que es la que hay que salvar; `K_OUTSIDE`, mucho menos, del lado
  de afuera y solo hasta `OUTSIDE_REACH`) y por quedarse quieto apretando el mismo tramo
  (`K_DWELL` despues de `DWELL_GRACE`). Se descarga sola (`STRESS_DECAY`). Un tramo que
  llega a 1 se raja.
- **Fragilidad por geometria**, calculada una vez: grosor de la figura hacia adentro
  (un rayo por la normal hasta el otro lado del contorno) y cuanto gira el contorno.
  Multiplica la tension del tramo (hasta ~2.4). Es lo que hace que el mango y el
  gancho del paraguas y las puntas de la estrella se rompan antes.
- **Lamer** (L o el boton LAMER, mantenido): la galleta se moja (`wet`), la tension
  entra un `WET_RELIEF` menos y se descarga `LICK_DECAY_MULT` veces mas rapido, pero
  lamiendo no se talla. Se seca con `DRY_RATE`.
- Las grietas (las de aviso de cada tramo y la de la rotura) salen de un PRNG
  sembrado (`mulberry32`), nunca de `Math.random` en el bucle.

**La velocidad de la aguja se promedia** (`SPEED_SMOOTH`, 0.1 s). Medida cuadro a
cuadro, los eventos del puntero llegan a tirones y la instantanea triplicaba la real:
el bot de prueba rompia la galleta en 0.1 s yendo despacio.

**Tolerancia con piso en px** (`MIN_TOL_PX`, 9): en un celu la galleta mide ~170 px de
radio y 0.045 radios quedaban en ~7 px, menos que el pulso de un dedo.

### Medido (bot que recorre el contorno a velocidad fija, figura perfecta)

| Figura | Velocidad (radios/s) | Resultado | Tension maxima |
| --- | --- | --- | --- |
| Circulo | 0.3 | sale en 27 s | 0 |
| Circulo | 0.7 | sale en 15 s | 0.63 |
| Circulo | 0.8 / 0.9 | se rompe al instante | - |
| Estrella | 0.6 | sale en 24 s | 0.67 |
| Estrella | 0.68 | se rompe en 1.3 s (una punta) | - |
| Paraguas | 0.3 | sale en 48 s | 0 |
| Paraguas | 0.4 | sale en 42 s | 0 |
| Paraguas | 0.5 | sale en 33 s | 0.18 |
| Paraguas | 0.6 | sale en 28 s | 0.64 |

O sea: hasta ~0.5 radios/s no hay riesgo, a 0.6 aparecen las grietas de aviso y en las
figuras fragiles se rompe apenas mas arriba. Un humano no calca perfecto: salirse
hacia adentro suma tension aparte. **Si se toca `K_SPEED`, `V_SAFE` o `PASS_DEPTH`,
rehacer esta tabla** (el bot esta descrito en el historial: maneja `tipX/tipY/pressed`
del `Game` desde un `requestAnimationFrame` de la pagina).

## Puntaje

`higher`: `points` de la figura (circulo 100, triangulo 150, estrella 250, paraguas
400) mas `POINTS_PER_SECOND` (3) por segundo sobrante. Roto o sin tiempo: 0. En sala
se reporta igual (entra al ranking global de sala: es el mismo numero que solo).

## Input

- Puntero sobre el `container` (nunca el canvas: el overlay lo tapa). Mouse: apretar y
  arrastrar; la aguja se ve al pasar. Dedo: la punta va `TOUCH_OFFSET_PX` (56) **arriba**
  del dedo, que si no tapa la linea; un aro marca donde esta el dedo.
- `pointermove` / `pointerup` escuchan en `window`, asi un arrastre que se sale del
  container no deja la aguja apretada.
- El boton LAMER corta la propagacion de su `pointerdown` (si no, tambien apretaria la
  aguja) y usa `setPointerCapture` para soltar bien.

## Movil

`mobile: true`, verificado **en emulacion** (Playwright, 390x844, touch): arranque con
un toque, eleccion de lata tocandola, arrastre con el dedo y LAMER mantenido. No en un
telefono real.
