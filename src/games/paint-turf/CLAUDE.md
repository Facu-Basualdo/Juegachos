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
  paso fijo a 50 Hz, broadcast cada 40 ms exactos de tiempo de simulacion.
- **Cliente** (`game/Game.ts`): manda su direccion numerada, predice su propio
  pincel, reconcilia reproduciendo los inputs que el server todavia no acuso, e
  interpola a los rivales sobre el reloj del server.
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

8 jugadores x 25 broadcasts/s = **~200 emits/s por sala**, menos de la mitad de lo
que ya mueve PONG (60 Hz x 8). De subida son otros 240/s (30 Hz de input), que para
el server no es nada. La grilla completa (805 celdas, un caracter por celda)
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
| `TICK_MS` / `BROADCAST_MS` | 20 / 40 | 50 Hz de simulacion, 25 Hz de red |
| `INPUT_INTERVAL` (cliente) | 33 ms | 30 Hz de subida |
| `INTERP_DELAY` (cliente) | 110 ms | ~2.75 espaciados de snapshot |

**`BRUSH_RADIUS` no baja de 21.** Yendo en diagonal, los centros de las celdas
vecinas a la trayectoria caen a `CELL / raiz(2)` = **16.97 px** de ella. Con radio
17 esas celdas entran o no segun el subpixel y el trazo diagonal sale entrecortado
como un tablero de ajedrez (se vio en la primera prueba con dos clientes); con 21
la fila de al lado entra siempre y el trazo es una banda continua.

## La red: lo que se rompio en el primer deploy

En local todo se veia perfecto porque la latencia era cero. Con el server real
(~150 ms de ida y vuelta contra Railway) aparecieron dos sintomas, y cada uno tenia
su propia causa. Las dos son faciles de reintroducir, asi que estan documentadas.

### "El control responde tarde"

La primera version reconciliaba interpolando la posicion propia hacia la del ultimo
snapshot. Con latencia real eso es un elastico: el snapshot dice donde estaba el
pincel hace ~100 ms, asi que la correccion tira permanentemente hacia atras contra
la prediccion y cada cambio de direccion arrastra un rato la trayectoria vieja.
**Medido**: al girar, el pincel recorria el **47%** de lo que deberia en los
primeros 200 ms.

Ojo con el arreglo intuitivo, que tambien esta mal: comparar contra "donde estaba yo
cuando el server capturo el snapshot" deja un desfase de ida MAS vuelta (~30 px a
esta velocidad) y, como se vuelve a medir igual en cada snapshot, arrastra el pincel
hacia atras sin parar.

La unica forma de no adivinar latencias es que el server **acuse el input**: cada
`pt:input` lleva un `n` y el snapshot devuelve, por jugador, el ultimo `n` que el
server tenia aplicado (`PtPlayerView.n`). Con eso el cliente parte de la posicion
autoritativa y **vuelve a aplicar los inputs posteriores** con la misma fisica
(`reconcile` en `Game.ts`). Moviendose derecho no queda correccion ninguna; solo se
corrige lo que el cliente no predijo (aturdimiento, tope contra el borde, paquete
perdido). **Medido despues**: 99-103% de la respuesta ideal con 150 ms emulados.

### "Los rivales se mueven a los tirones"

El espaciado de los snapshots **en la linea de tiempo de la simulacion** era
irregular: el sim emitia "uno de cada dos despertares del timer", y un despertar
simula cero, uno o dos pasos segun cuanto se atraso el `setInterval` (en Windows la
resolucion es de ~15.6 ms). **Medido con un cliente crudo de socket.io**: espaciado
de 60 a 80 ms, media 62, desvio 6.1 — contra un `INTERP_DELAY` de 80 ms, o sea
**cero margen**. Con el jitter de una red real el buffer del cliente se queda seco,
y ahi el rival se congela en su ultima posicion y pega un salto cuando llega el
snapshot siguiente.

Tres cambios: el broadcast se mide en `simTime` y **el chequeo va adentro del bucle
de pasos** (afuera vuelve a heredar el jitter del timer: medido daba 50 u 80 ms
alternados), `BROADCAST_MS` es multiplo exacto de `TICK_MS`, y el `INTERP_DELAY`
subio a 110 ms. **Medido despues**: 40 ms exactos, desvio 0.0. Ademas, cuando falta
un snapshot el cliente **extrapola** el ultimo tramo hasta `EXTRAPOLATE_MS` en vez
de congelar al rival.

Advertencia honesta sobre esta segunda mitad: el sintoma **no se pudo reproducir en
el banco de pruebas**, porque la latencia emulada por CDP es constante y sin jitter
(y su `packetLoss` no alcanzo a generarlo sobre TCP). Lo verificado es la causa —el
espaciado— y el margen, no el sintoma.

## Gotchas

- **No reintroducir un lerp hacia la posicion del snapshot.** Es la correccion que
  parece obvia y es exactamente la que se siente como lag (ver arriba).
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
