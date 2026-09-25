# Papa Caliente (hot-potato)

La papa pasa de mano en mano y explota a un tiempo **secreto**: el que la tiene en
ese instante queda afuera. Para pasarla hay que marcar una secuencia de flechas
(4 al principio, una mas cada 5 pases de la misma papa, tope 7), y no se la podes
devolver al que te la paso (salvo en el mano a mano, donde no hay otro). Cada
explosion elimina a uno; **gana el ultimo en pie.** Solo de sala, arbitrado por el
game server (`server/src/games/hotpotato.ts`, namespace `/hotpotato`, eventos `hp:*`).
Direccion de arte: `DESIGN.md` ("Estudio de TV").

## Solo de sala

Igual que Bomba Palabra: sin `?room=` muestra "Solo en salas"; sin Supabase o sin
`VITE_GAME_SERVER_URL`, "No disponible". Es la excepcion documentada a la regla de
degradacion: la mecha tiene que ser secreta y solo el server puede guardarla.
No necesita `roomTimeLimitSec`: cada papa explota sola (9-20 s) y elimina a alguien,
asi que una partida con todos quietos termina en N x ~23 s como mucho.

## La latencia es el diseno

El juego vive o muere por los ms: si pasar fuera un boton, perderia el que tiene mas
ping. Cuatro decisiones lo evitan, y las cuatro hacen falta:

1. **La secuencia se resuelve en el cliente.** Cada tecla responde en el mismo cuadro
   sin tocar la red; solo viaja el pase terminado (`hp:pass`). El desafio dura 1-2 s,
   asi que los ~35 ms que tarda la papa en llegarle al siguiente no deciden nada.
2. **El pase es optimista.** La papa sale volando en el acto (`Game.doPass` ->
   `pending`). Se confirma cuando el estado trae una posesion `n` mayor y se revierte
   con `hp:reject` o, si el mensaje se perdio en una reconexion, pasados
   `PENDING_TIMEOUT_MS`. Mientras hay un pase en vuelo, la papa se dibuja en el destino
   y no se acepta input.
3. **Reloj del server, no hora de llegada.** Cada `hp:state` y cada `hp:pong` traen
   `t` (epoch del server). `clockOffset` es el minimo de `(llegada - t)`, corregido lento
   hacia arriba (mismo metodo que PONG). Ese offset incluye la bajada, asi que
   `serverNow()` es **la hora del server que este cliente ve**, que es justo lo que
   hay que mandar. Al conectar se tira una rafaga de 6 pings para que el offset ya este
   asentado antes de la primera papa, y despues uno por segundo (`setInterval`, no rAF).
4. **Compensacion en el server.** El pase lleva `at` = `serverNow()` al completarlo. El
   server lo toma acotado a `[llegada - LAG_COMP_MS, llegada]` (y nunca antes de que el
   jugador recibiera la papa). Como `at` esta atrasado una bajada y el mensaje tarda una
   subida, `llegada - at` es la **ida y vuelta completa**: `LAG_COMP_MS = 250` cubre una
   conexion movil tipica; por encima, el jugador pierde `RTT - 250` ms. Para que los pases
   que ya venian viajando puedan entrar, la explosion se resuelve `LAG_COMP_MS` despues
   de vencer la mecha. Como la mecha es secreta, ese margen no lo ve nadie.

La mecha **nunca** viaja en `hp:state`. El termometro del centro llena contra
`fuseMaxMs` (el tope publico), no contra la mecha real: es informacion que ya tiene
cualquiera con un reloj, y sirve de tension sin delatar nada.

### Medido (bots contra el server local, `node` + socket.io-client con latencia simulada)

- 5 jugadores, 20-100 ms de una via, 0.7-1.5 s por secuencia: 40 pases, 40 aceptados,
  0 rechazos. El reloj percibido quedo atrasado exactamente una bajada (p50 -61 ms con
  latencias de 20-100), que es lo que se busca.
- Estres con pases de 40-150 ms y RTT de hasta 240 ms: 309 pases, 4 rechazos "tarde", y
  los 4 se habian completado **despues** de la explosion (el `at` quedo 2-126 ms pasado
  la mecha). Cero rechazos injustos.
- Holder desconectado: suelta la papa solo a los `ABSENT_PASS_MS` (2.5 s) y la partida
  cierra igual.

Lo que no se ecualiza: dos clientes ven la misma explosion con una diferencia igual a la
diferencia de sus latencias de bajada (decenas de ms). Sincronizarla atrasaria la
explosion para todos y nadie mira dos pantallas a la vez.

## Reparto de responsabilidades

- **Supabase / RoomMode**: lobby, briefing, marcador, rejoin. `initRoomMode("hot-potato",
  { getScore, onStart })`; al terminar `room.reportScore(ranking.length - place)`
  (mayor = mejor, el ultimo en pie suma mas). No va al ranking global.
- **Game server**: asientos (los del roster conectados, en orden de `joined_at`), quien
  tiene la papa, la secuencia, la mecha secreta, las eliminaciones. Estado scopeado por
  **ronda** (`round` en `hp:join`), igual que Neon Drift: la sala puede repetir el juego
  y el `GameRoom` sobrevivir entre una pagina y la siguiente.
- **No se conecta hasta el countdown.** El server arranca apenas estan todos conectados;
  conectar durante el briefing largaria la partida con la gente leyendo. Despues hay un
  `PREROLL_MS` (3 s) que cubre el 3/2/1/YA.

## Reglas finas

- **Destino.** Por defecto, el primero valido en sentido horario. Se puede elegir tocando
  un atril o con Q / E, **tambien antes de tener la papa** (queda elegido y se usa si
  sigue siendo valido). `validTargets` / `defaultTarget` estan duplicados en cliente y
  server: si se toca uno, tocar el otro.
- **Flecha equivocada** reinicia la secuencia desde cero (sin castigo de tiempo extra: el
  castigo es rehacerla con la papa encima).
- **Papa nueva:** la primera va a un jugador al azar; las siguientes, al vecino (sentido
  horario) del que exploto.
- **Desconectado:** no se elimina; si le cae la papa la suelta solo a los 2.5 s, que es
  un riesgo parecido al de un jugador lento.
- **F5:** el cliente se reengancha; el primer estado se toma como punto de partida sin
  re-anunciar pases ni explosiones viejas (`seenPassN` / `seenBoomK`).

## Controles

- Teclado: flechas o WASD para la secuencia, Q / E para cambiar el destino.
- Tactil: cruceta en pantalla (solo con `pointer: coarse`), `pointerdown` para no pagar
  la demora del `click`. Tocar un atril lo elige de destino.
- `mobile: false` en el `meta.ts` hasta probarlo en un telefono de verdad.

## Module layout

- `main.ts` — monta `Game` en `#app`.
- `game/Game.ts` — orquestador: sala, countdown, reloj, pase optimista, secuencia,
  destino, termometro y tic-tac (rAF), puntaje.
- `game/Hud.ts` — DOM: atriles en circulo (se reusan, no se reconstruyen), la papa como
  un unico elemento que vuela con transicion CSS (`FLIGHT_MS` = `--flight`), medidor,
  secuencia, cruceta, BOOM.
- `game/SocketTransport.ts` — socket.io contra `/hotpotato`, pings de reloj.
- `game/HotPotatoProtocol.ts` — tipos `hp:*`, espejo de `server/src/protocol.ts`.
- `game/constants.ts` — countdown, flechas y teclas, tuning del reloj y del pase.
- `game/SoundEffects.ts` — Web Audio sintetizado (tic del countdown, flechas, buzzer,
  pase, campana, tic-tac que se acelera con el calor, explosion).

## Tuning (server, `hotpotato.ts`)

`FUSE_MIN_MS` / `FUSE_MAX_MS` (9-20 s), `EXPLODE_PAUSE_MS` (3 s), `SEQ_BASE` /
`SEQ_STEP` / `SEQ_MAX` (4 / 5 / 7), `LAG_COMP_MS` (250), `ABSENT_PASS_MS` (2.5 s),
`PREROLL_MS` (3 s), `START_GRACE_MS` (8 s). Tocar el server pide redeploy.
