# Birome (`birome`)

Sos la punta de una birome que avanza sola por una hoja cuadriculada. **Apretado sube
a 45 grados, suelto baja a 45 grados** (el "wave" de Geometry Dash). Hay que colarse
entre tachones y manchones de tinta sin tocar los margenes rojos. La velocidad sube
con la distancia. Puntaje = **cm recorridos** (`direction: "higher"`).

Se juega solo y en salas. En sala todos corren **el mismo recorrido sembrado** y ven
las rayas de los demas en vivo.

Estetica: ver [DESIGN.md](DESIGN.md) ("Cuaderno Cuadriculado").

## Por que la red no se siente (la leccion de Manchon)

Manchon se siente con lag porque los ocho jugadores escriben **el mismo tablero** al
mismo tiempo: quien se queda con cada celda lo decide el server, y eso viaja con el
ida y vuelta. Birome esta disenado para que eso no exista:

1. **Tu partida es 100% local.** El recorrido sale de una semilla
   (`hashStr(code:round)`), el choque se calcula en tu cliente y la red no participa
   en nada de lo que controlas. Con 400 ms de latencia el control responde igual que
   en solo.
2. **Lo que viaja son QUIEBRES, no posiciones.** Como la pendiente es siempre +-45
   grados sin importar la velocidad, el recorrido en el plano queda definido solo por
   los puntos donde el jugador apreto o solto. Cada quiebre es `[x, y, h]`; entre dos,
   la linea es recta. El receptor la reconstruye **exacta** (`Trail`).
3. **La velocidad depende de la distancia, no del tiempo** (`speedAt(x)`). Asi el
   receptor adelanta la punta del rival desde su ultima `x` conocida sin saber cuando
   arranco ni sincronizar relojes.
4. **A los rivales se los dibuja `REMOTE_DELAY_S` (0.2 s) en el pasado.** El quiebre
   que todavia viaja llega antes de que la punta lo necesite, asi que la linea nunca
   se corrige a la vista.

**Medido** con red simulada (60 s, quiebres cada 120-600 ms, entrega en orden como el
websocket): con `REMOTE_DELAY_S = 0.2` el error de la linea del rival es **0 px en
todos los cuadros** hasta 250 ms + 150 ms de jitter. Con 0.12 ya aparecen saltos a
partir de ~250 ms. El precio es que el rival se ve unos cientos de px detras de donde
esta: es cosmetico (su puntaje viaja aparte y es el que va a la ronda).

### Trafico

~**3 msg/s por jugador** medido (~24/s con la sala llena), contra el tope de ~100/s
por canal de Realtime. Por eso va por un **canal de Supabase** (`InkChannel`, copia del
patron de `DodgeChannel`: status callback, `send` solo con el canal unido, reapertura
con backoff) y **no necesita el game server**. Techo duro: la cola se vacia cada
`NET_FLUSH_MS` (120 ms) = 8.3 msg/s por jugador, ~67/s con 8 aunque todos aprieten
como locos.

- **Keepalive** cada `NET_KEEPALIVE_MS` (500 ms) si no hubo quiebres: manda la
  posicion actual **como quiebre**. Esta sobre la linea, asi que no la deforma, y
  repara cualquier quiebre perdido (la linea queda recta entre los dos que llegaron).
- **Con el canal caido la cola se conserva** (`send` devuelve false) hasta
  `MAX_QUEUE_VERTS`; al volver se manda todo junto y la linea se completa.
- Los timers de red van en `setInterval`, no en el rAF (el navegador frena el rAF en
  pestanas de fondo).
- **Muerte**: el ultimo quiebre es el punto del choque y el mensaje va con `d: 1`; el
  receptor pone la mancha ahi. El muerto sigue mandando keepalive (con `d: 1`) para no
  ser purgado por `REMOTE_STALE_MS` y para que un mensaje perdido no lo deje "vivo".
- **Recarga del rival**: si llega un quiebre 200 px detras de lo que ya teniamos, es
  una partida nueva y se descarta el trazo viejo.

## Recorrido (`Course`)

Compuertas (dos tachones con un hueco) separadas `SPACING_MIN..MAX`, a veces
**tuneles** largos (hay que zigzaguear adentro, un poco mas holgados), y manchones en
el tramo abierto. **La factibilidad esta garantizada por construccion**: cada hueco
queda al alcance del anterior con pendiente <= 0.8, y los manchones se ponen a
`BLOT_CLEARANCE` del segmento entre huecos. Verificado con un DP sobre la grilla de
45 grados: 60 semillas, todas pasables hasta 1000 cm.

- **No se poda nunca**: el muerto en sala sigue con la camara al rival que va
  adelante, que puede estar detras. Son pocas compuertas por segundo.
- `obstacles` esta ordenado por `left` (los manchones se insertan antes de la
  compuerta que cierra su tramo). `firstFrom` hace busqueda binaria con un margen de
  `MAX_OBSTACLE_W` hacia atras; si agregas un obstaculo mas ancho, subilo.

## Tuning

| Constante | Valor | Nota |
| --- | --- | --- |
| `V0` / `ACCEL` / `V_MAX` | 320 / 0.012 / 640 | px/s; tope a ~58 s de juego |
| `SLOPE` | 1 | **no tocar sin revisar la red**: el Trail asume +-SLOPE |
| `GAP_START` / `GAP_MIN` | 170 / 92 | se cierra hasta `GAP_SHRINK_UNTIL` (30000 px) |
| `PX_PER_CM` | 40 | puntaje |
| `NET_FLUSH_MS` / `NET_KEEPALIVE_MS` | 120 / 500 | |
| `REMOTE_DELAY_S` | 0.2 | ver arriba antes de bajarlo |

## Sala

- `initRoomMode("birome", { getScore, onStart: beginCountdown, onReportedWaiting })`.
  Al chocar se reporta y se queda mirando (`onReportedWaiting` -> true): la camara
  sigue al rival vivo que va mas adelante.
- **No necesita `roomTimeLimitSec`**: quieto, la punta baja a 45 y toca el margen en
  menos de un segundo. Termina sola.
- `direction: "higher"`: no usa `roomRun.ts` (recargar solo te hace perder lo que
  llevabas).
- Colores de rival por asiento (`players()` ordenado por `joined_at`), iguales en
  todas las pantallas; a uno mismo siempre se lo ve azul.

## Movil

`mobile: true`, verificado con Playwright a 390x844 con `hasTouch` (el toque arranca,
senal `.countdown`). El dedo en cualquier lado = apretado. El `pointerdown` cuelga del
container. **En vertical la hoja se dibuja ROTADA 90 grados** (`rotated` en
`resize()`): la birome sube por la pantalla y apretar la corre a la izquierda. Los
textos del canvas pasan por `Renderer.label`, que los endereza.

## Gotchas

- El `LeaderboardPanel` trae texto blanco (pensado para overlays oscuros): el
  `style.css` lo pasa a tinta sobre la tarjeta crema, como Wordle.
- El HUD arranca en `top: 34px` para no quedar debajo de la barra de la sala.
- `start()` toma `input.isHeld`: si el jugador venia apretando durante el countdown,
  larga subiendo (y ese es el primer quiebre que se manda).
