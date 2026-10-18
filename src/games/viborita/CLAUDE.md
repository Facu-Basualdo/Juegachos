# Viborita

**Oculto del roster** (`hidden: true` en `meta.ts`) a pedido del programador: en la primera
prueba real "va re mal". No aparece en la landing ni en las salas, pero el codigo, el
namespace `/viborita` del server y la pagina `/games/viborita/` siguen ahi (la pagina sale con
`noindex`).

Clon de slither.io. La cabeza apunta al mouse (con un giro maximo que baja al crecer),
el cuerpo sigue el camino de la cabeza, comer alarga. Chocar la cabeza contra el
cuerpo de OTRA viborita mata (el propio no) y el muerto se convierte en comida de su
color; de frente mueren las dos; el borde del mapa circular tambien mata. **Turbo**:
mantener el click / Espacio / boton TURBO va al doble de velocidad, cuesta largo y deja
comida atras; con menos de 15 de largo no anda.

Dos modos con el mismo codigo: la **arena publica** (desde la landing: entras con un
nombre, reapareces al morir, nunca termina) y la **sala** (una vida por ronda, sin
tope de tiempo, gana la primera que llega a 600 de largo).

Reemplazo a **Agar** (clon de agar.io), que vivio en este lugar antes de mergearse y
del que hereda toda la infraestructura de red. Direccion de arte: `DESIGN.md`
("La Landing"). Como correrlo, simular latencia y que se puede ajustar: `README.md`.

## Arquitectura (server autoritativo)

Todo lo simula el game server (namespace `/viborita`, prefijo `vb:`):

| Archivo | Que hace |
| --- | --- |
| `server/src/games/viborita-config.ts` | **Toda** la configuracion, mas las formulas y `advanceHead`. |
| `server/src/games/viborita.ts` | Capa de red: administrador de arenas, validacion, rate limit (`Guard`). |
| `server/src/games/viborita-arena.ts` | La simulacion: estela y cuerpo, choques, turbo, comida, culling, bots. |
| `server/src/games/viborita-grid.ts` | Spatial hash (comida estatica, segmentos reconstruidos en cada paso). |
| `server/src/games/viborita-bot.ts` | IA de los bots (Utility AI + sondas). |
| `server/scripts/viborita-check.ts` | `npm run check:viborita`: giro, cuerpo, choques, turbo, sala, culling, bots (30 chequeos). |
| `server/scripts/viborita-net-check.ts` | `npm run check:viborita-net`: con sockets reales (15 chequeos). |

El cliente manda **solo input**: `[n, t, angulo, turbo]`. El server limita el giro y
decide si el turbo alcanza. La config que el cliente necesita viaja en el `vb:init`;
las cinco formulas (radio, largo, giro, velocidad, zoom) y `advanceHead` estan
duplicadas en `game/motion.ts` por la regla de decoupling.

No usa `registerGame` de `rooms.ts`: la arena publica no tiene codigo ni roster, es un
mapa abierto que al llenarse (`maxSocketsPerArena`) abre otro; las de sala van por
`CODIGO:ronda`. Transporte socket.io (el del resto del server), no `ws` ni Colyseus.

## Metodo de simulacion (aprobado por el programador)

Ninguna fila de la matriz de `SIMULATION_ARCHITECTURE.md` es slither; se armo con:

1. **Cabeza: cinematica con giro limitado, integrada EXACTA** (`advanceHead`): arco de
   circulo hasta alinearse con el objetivo y despues recta. El resultado no depende de
   en cuantos pedazos se parta el tiempo (chequeado: 2e-13 u entre 1 paso, 40 pasos y
   una particion al azar). Eso es lo que deja que el server (pasos de 25 ms), la
   prediccion (por cuadro) y la reconciliacion (por tramos de input) den lo mismo.
2. **Cuerpo: el camino de la cabeza, muestreado por largo de arco.** Se propuso un
   seguidor con restriccion de distancia (la pasada hacia atras de FABRIK) y se cambio
   antes de escribirlo: ese seguidor "corta las curvas" distinto segun el tamano del
   paso, asi que el cuerpo del cliente (60 fps) no coincidiria con el del server
   (40 Hz). Con la estela no hay paso que importe: cada viborita guarda las
   posiciones de su cabeza (`Snake.pushHead`) y el cuerpo son puntos a distancia fija
   sobre ese camino (`Snake.walkBody`).
3. **Choques: spatial hash de segmentos** (ficha 3.3), reconstruida en cada paso.
4. **Bots: Utility AI** (deseo: cortarle el paso a una mas chica, ir a la comida que
   mas vale o pasear) mas **sondas**: rayos en abanico desde la cabeza que miden cuanto
   se puede avanzar sin tocar cuerpos, cabezas ajenas proyectadas un poco adelante, ni
   el borde. Medido: ~0.6 muertes por bot por minuto (antes de esquivar cabezas
   chocaban de frente yendo a la misma comida y eran el doble).

## Red

- **Las cabezas viajan, los cuerpos no.** Cada snapshot trae
  `[id, dueno, x, y, angulo, masa, turbo]` por viborita visible. El cliente agrega
  cada cabeza a la estela de esa viborita (`Trail.ts`) y arma el cuerpo igual que el
  server. El cuerpo entero (`k`) viaja **solo la primera vez** que una viborita entra
  a la vista de un cliente (o al reconectar), para sembrar la estela. Medido: el cuerpo
  que dibuja el cliente se desvia 0.48 u como mucho del del server (radio 19), con
  zigzag y turbo; es la flecha de las cuerdas entre cabezas.
- **Culling por la caja del cuerpo**, no por la cabeza: una larga que cruza la pantalla
  con la cabeza afuera se tiene que ver.
- **Viborita propia: prediccion + reconciliacion por acuse** (`Predictor.ts`), con la
  misma `advanceHead`. Medido con `?lag=150&jitter=37`: correccion media ~1 u (0.35 con
  el buffer de input en 30 ms; se bajo a 20 a cambio de 10 ms menos de atraso). El
  resto de una correccion se reparte desde la cabeza hacia atras (`VIS_FADE_LEN`) para
  que el cuerpo no se doble de golpe. El server aplica cada input con el buffer de
  jitter (`inputBufferMs`), como Manchon.
- **Ajenas: interpoladas** en el pasado sobre el reloj de la simulacion
  (`Timeline.ts`), con un retraso de dos espaciados de snapshot mas 10 ms que sale del
  `snapshotHz` del server: con snapshots a 40 Hz son **60 ms** (eran 110 con 20 Hz). El
  cuerpo se arma con los puntos de la estela de hora <= ese instante. Medido: 0 a 1
  tiron cada mil cuadros, con y sin `?lag=150`.

## Compensacion de lag (por que no moris cuando el otro te tendria que chocar)

El problema (reportado por el programador en la primera prueba: "yo hago que otro me
choque pero muero yo"): la propia se ve en el presente predicho y las demas en el
pasado (latencia de bajada + interpolacion), y el input propio llega tarde (subida +
buffer). Con ~70 ms de ping eso suma unos 200 ms: las demas se veian **3 a 5 cuerpos
atras** de donde estaban, y al cruzarle adelante a una "con margen" el que metia la
cabeza en el cuerpo ajeno era uno.

La solucion es la de los shooters, **juzgar el choque en la vista del que lo da**:

- Cada input lleva, como quinto elemento, el instante del server que el cliente estaba
  dibujando de las demas (`Timeline.serverTimeAt(ahora - retraso)`, -1 si todavia no
  sabe). El server lo convierte en un atraso contra el instante en que ese input rige
  (`Player.viewLag`), acotado a `lagComp.maxRewindMs` (300 ms) para que nadie se
  invente una ventaja. Los bots tienen atraso 0.
- **Rebobinar un cuerpo es correrlo por su propio camino.** Cada viborita lleva un
  odometro con historial (`Snake.offsetAt(t)` = cuanto recorrio la cabeza desde `t`), y
  los segmentos de choque saben su distancia a la cabeza (`Segment.s`) y se muestrean
  `REWIND_DIST` mas alla de la cola. El cuerpo como estaba en `t` son los segmentos con
  `s` entre `offsetAt(t)` y `offsetAt(t) + largo`: no se guardan copias del cuerpo.
- Cada cabeza se compara contra los cuerpos ajenos **rebobinados a su propio atraso**.
  Asi uno muere solo si en su pantalla toco a otro.
- La contra (la de cualquier compensacion): con dos jugadores con latencia, a veces una
  pasa por encima del cuerpo de la otra sin morir, porque a cada una se la juzga con lo
  que veia ella. Es mucho menos frustrante que morir sin haber tocado nada.
- Chequeado en `viborita-check.ts`: el mismo cruce (cortarle adelante con 70 u de
  margen en pantalla) mata al que corta sin compensar y lo deja vivo compensando con
  200 ms, y la rival que mete la cabeza en su cuerpo muere ella.
- **Comida**: altas (`pa`, con color y masa) y bajas (`pd`) respecto de lo que el
  cliente ya tiene; las bajas se aplican cuando la interpolacion alcanza su snapshot.

## Reglas (viborita-config.ts)

- Giro maximo `turnBase / (1 + masa / turnMassK)`: las largas doblan mas abierto, que
  es lo que deja encerrarlas.
- Comer: la boca es `radio * mouthK` (1.5): la comida se "aspira" un poco antes de
  tocarla.
- Choque: cabeza propia contra segmento ajeno a menos de `r_ajeno + r_propio * crashK`
  (0.6): la nariz tiene que entrar un poco, pasar rozando no mata. Se juntan todos los
  choques del paso y se aplican juntos (de frente mueren las dos).
- Al morir, el 70% del largo queda como comida a lo largo del cuerpo, en bocados de 2 a
  10. La comida de muertos y turbo tiene tope propio (`maxDrops`) y no cuenta para la
  reposicion natural.
- Turbo: cada 150 ms cobra el 1.2% del largo (minimo 0.8); el 60% de eso queda como
  comida en la cola.

## Sala sin tope de tiempo (y por que igual termina)

1. Una vida por jugador: al morir reporta su largo maximo.
2. La primera humana que llega a `room.winMass` (600) gana: la arena se congela,
   `vb:over`, y las vivas reportan lo suyo.
3. **La que no toca nada se estrella sola**: sigue derecho y el mapa de sala (radio
   1800) se cruza en menos de 20 s. Medido en una sala real de dos navegadores quietos:
   la ronda cerro sola a los ~10 s de arrancar.
4. Los bots no ceden su lugar en la sala y le cortan el paso a la que da vueltas.
5. Sin cambiar el input `room.afkMs` (45 s), se disuelve.
6. Si el server se cae: a los 20 s sin conexion el cliente reporta lo que tenia.

## Puntaje y ranking

El puntaje es el **largo maximo de la vida**. La arena publica lo manda al ranking
global al morir; las partidas de sala no (`roomRanked: false`). El nombre es el del
sitio (`shared/nickname`); el formulario de nombre del `LeaderboardPanel` esta oculto
por CSS para no duplicar el de la tarjeta.

## Robustez

Igual que Agar: heartbeat de socket.io explicito (25 s / 20 s, del server entero, por
Cloudflare Tunnel), reconexion con token y gracia de 10 s (20 en sala), validacion de
cada mensaje, nombres saneados, `Guard` (token bucket de 60 con recarga de 40/s, 200
faltas en 10 s cortan), y el `/health` que **no cuenta** la arena publica en `clients`
(el detalle va en `viborita`).

## Gotchas

- El mapa es un circulo de centro `(R, R)`, no `(0, 0)`: la spatial hash espera
  coordenadas en `[0, 2R]`.
- Los ids de viborita son **por vida** (`nextSnakeId`), distintos del id de jugador:
  si se reusara el id del jugador, una que muere y reaparece podria heredar la estela
  vieja en el cliente.
- `Trail.seed` le pone horas apenas mas viejas que la cabeza a los puntos del cuerpo,
  asi la interpolacion no los toma como "futuro" y la viborita que recien entra no se
  dibuja hasta que la interpolacion la alcanza.
- Antes del primer movimiento del mouse la viborita sigue derecho: el `Predictor`
  arranca con el rumbo de la cabeza, no con el angulo 0.
- `tsconfig` del front tiene `erasableSyntaxOnly`: nada de parameter properties en
  `src/` (en `server/` si se puede).
- `?debug=1` expone el juego como `window.__vb` (lo usan las mediciones).
- El check `viborita-check.ts` importa el `Trail.ts` del cliente para medir el cuerpo
  dibujado contra el del server. Es el unico cruce entre `server/` y `src/`, y vive en
  un script de verificacion (no en el build del server).
