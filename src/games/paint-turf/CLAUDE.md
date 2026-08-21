# Manchon (`paint-turf`)

Captura de territorio para salas: cada jugador es un pincel que pinta las celdas
por las que pasa y le roba las que ya eran de otro. A los 90 s gana el que se
quedo con mas tablero. **Solo se juega en salas** y **necesita el game server**
(como Bomba Palabra, Basta o Impostor).

Estetica: ver [DESIGN.md](DESIGN.md) ("Tempera Humeda").

## Arquitectura

Es el segundo juego de tiempo real ARBITRADO por el server (el otro es PONG). El
reparto:

- **Server** (`server/src/games/paintturf.ts`, namespace `/paintturf`): duenio de
  la grilla, de las posiciones, del aturdimiento y del puntaje. Simulacion con
  paso fijo a 40 Hz, broadcast a 20 Hz.
- **Cliente** (`game/Game.ts`): manda su direccion, predice su propio pincel para
  que el control se sienta inmediato, e interpola a los rivales sobre el reloj del
  server.
- **Supabase / RoomMode**: lobby, marcador, rejoin y el reporte del puntaje, como
  en todas las salas. El server no toca la DB.

### Por que autoritativo y no un relay (como Neon Drift)

Porque la grilla es **estado compartido en el que los ocho escriben a la vez**. Con
cada cliente simulando lo suyo, el orden en que llegan los mensajes decide quien se
quedo con cada celda: dos pantallas mostrarian tableros distintos y un ganador
distinto. Neon Drift puede ser un relay porque cada uno corre **su** carrera sobre
un seed compartido y los rivales son decoracion; aca los rivales te pisan el
territorio.

### El cliente manda input, no posicion

`pt:input` lleva una direccion que el server **normaliza** (el cliente no decide su
velocidad). Es deliberado y distinto de PONG, que acepta la Y de la paleta: aca una
posicion declarada por el cliente dejaria teletransportarse y pintar todo el tablero
desde las devtools. El puntaje spoofeable es un nivel de confianza que el repo ya
acepta; arruinarle la partida a los otros mientras se juega, no.

### El cliente NO pinta de forma predictiva

Podria pintar la celda apenas la pisa, sin esperar el snapshot. No lo hace: cuando
el server **no** confirma esa pintura — el caso tipico es un aturdimiento que llego
un snapshot tarde — la celda queda pintada de este lado y de nadie del otro, para
siempre, porque el protocolo no tiene "despintar". El hueco de un snapshot detras
del pincel se tapa con el **disco de pigmento fresco** que dibuja el Renderer
(`BrushView.wet`), que es gratis y no puede desincronizar nada.

### Trafico

8 jugadores x 20 broadcasts/s = **~160 emits/s por sala**, un tercio de lo que ya
mueve PONG (60 Hz x 8). La grilla completa (805 celdas, un caracter por celda)
viaja **solo** en el `pt:init` del join / reconexion; los snapshots llevan
unicamente las celdas cambiadas desde el anterior (`c`, aplanado
`[indice, asiento, ...]`).

## Tuning (duplicado cliente/server)

`game/constants.ts` y `server/src/games/paintturf.ts` tienen las mismas
constantes por la regla de decoupling del repo: **si cambia el tuning, tocar los
dos lados.**

| Constante | Valor | Nota |
| --- | --- | --- |
| `COLS` x `ROWS` x `CELL` | 35 x 23 x 24 | vista de 840x552, 805 celdas |
| `SPEED` | 195 px/s | |
| `BRUSH_RADIUS` | 21 | **no bajarlo**, ver abajo |
| `SPLAT_RADIUS` / `SPLAT_HIT_RADIUS` | 78 / 66 | pinta mas de lo que aturde |
| `SPLAT_COOLDOWN_MS` | 5000 | |
| `STUN_MS` / `STUN_SPEED_FACTOR` | 1100 / 0.4 | aturdido no pinta y va lento |
| `START_BLOB_RADIUS` | 46 | ~12 celdas (1.5%) para no largar en blanco |
| `MATCH_MS` / `PREROLL_MS` | 90000 / 3000 | el preroll cubre el 3/2/1/YA |
| `TICK_MS` / `BROADCAST_EVERY` | 25 / 2 | 40 Hz de simulacion, 20 Hz de red |

**`BRUSH_RADIUS` no baja de 21.** Yendo en diagonal, los centros de las celdas
vecinas a la trayectoria caen a `CELL / raiz(2)` = **16.97 px** de ella. Con radio
17 esas celdas entran o no segun el subpixel y el trazo diagonal sale entrecortado
como un tablero de ajedrez (se vio en la primera prueba con dos clientes); con 21
la fila de al lado entra siempre y el trazo es una banda continua.

## Gotchas

- **El estado del server esta scopeado por RONDA.** El `round` viaja en el
  `pt:join` y una ronda mas nueva tira el tablero anterior. Entre rondas los
  clientes navegan de una pagina a la otra y no todos a la vez, asi que el
  `GameRoom` del server puede sobrevivir con la partida de la ronda anterior
  adentro (mismo gotcha que Neon Drift).
- **El countdown se sincroniza con el `preroll` del server**, no con el reloj
  local: mientras el server esta congelado, las etiquetas 3/2/1/YA salen de su
  `msLeft`, asi el "YA" de todos cae en el mismo instante en que largan los
  pinceles. Sin snapshot todavia (pagina que arranca antes de conectar) se cuenta
  local, y si el server ya paso a `playing` se corta el countdown y se juega.
- **Si el server no contesta, el cliente reporta 0 igual** (`giveUp`, a los 12 s).
  No es cosmetico: sin puntaje de este jugador la ronda queda colgada para toda la
  sala, porque el cierre anticipado solo cubre a los **desconectados de la sala**,
  no al que esta mirando un cartel de error.
- **`roomTimeLimitSec: 120` es red de seguridad, no la duracion.** El server
  termina la partida solo a los 90 s pase lo que pase (como Basta o Impostor), pero
  si se cae **despues** de que arranco, el cliente no ve nunca el `over`. El
  numero se muestra en el briefing, asi que tampoco conviene inflarlo.
- **En vertical el tablero se dibuja ROTADO 90 grados** (`rotated` en `resize()`):
  una hoja apaisada en un celular en vertical entra como una franja de un cuarto de
  pantalla. Rotandola ocupa casi todo. **El input se rota junto con el tablero**
  (`worldDir()`: pantalla +X -> mundo -Y, pantalla +Y -> mundo +X); si se toca uno
  hay que tocar el otro. Al girar el telefono la pantalla pasa a apaisada, `rotated`
  se apaga solo y todo vuelve a la orientacion normal.
- **El HUD arranca en `top: 38px`** para no quedar debajo de la barra de la sala
  (`RoomOverlay`), que va arriba de todo y tapaba el reloj de la partida. El juego
  es solo de sala, asi que esa barra siempre esta.
- **Hay dos relojes en pantalla y son distintos**: el de la partida (90 s, el
  grande) y el de la sala (el tope de `roomTimeLimitSec`, en la barra de arriba).
- **El `Hud` no monta el `LeaderboardPanel`.** Es solo de sala, y en sala el
  puntaje va a la ronda y nunca al ranking global, asi que el panel no tendria
  nunca nada que mostrar.
- **El Renderer mantiene su propia copia de duenios** (`setOwners`), a la que el
  juego le pasa **la misma instancia** del `Int8Array`. Sirve para repintar los
  vecinos cuando una celda cambia: el `clearRect` de una celda muerde el desborde
  de las de al lado. Al aplicar un delta hay que actualizar `grid[idx]` **antes**
  de llamar a `setCell`.

## Movil

`mobile: true`, verificado con Playwright a 390x844 con `hasTouch`:

- **Joystick relativo**: el dedo apoya en cualquier lado del tablero y arrastra;
  el vector sale del desplazamiento contra el punto de apoyo (zona muerta de 10 px,
  satura a 52). El listener cuelga del **container**, nunca del canvas.
- **Boton SALPICAR** abajo a la derecha, con `pointerdown` (no `click`: en el celu
  llega ~300 ms tarde y el salpicon es una accion de reflejos). Es bien translucido
  a proposito, porque ahi abajo puede estar el pincel propio; en la compu se achica
  y queda solo como indicador del enfriamiento, que se tira con ESPACIO.
- No aplica el bug del "toque de arranque" del CLAUDE.md raiz: la partida la larga
  `RoomMode` (`onStart`), no un toque del jugador.
