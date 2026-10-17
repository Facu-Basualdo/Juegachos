# Agar

Clon de agar.io: una celula que sigue al mouse, come comida para crecer y se come a
las celulas con al menos 1.25 veces menos masa que ella. Cuanto mas grande, mas lenta
y mas lejos ve. Dos modos con el mismo codigo: la **arena publica** (desde la landing:
entras con un nombre, reapareces al morir, el mapa nunca termina) y la **sala** (una
vida por ronda, sin tope de tiempo, gana el primero que llega a la meta de masa).

Direccion de arte: `DESIGN.md` ("Camara de Conteo"). Como correrlo, simular latencia
y que se puede ajustar: `README.md`.

## Arquitectura (server autoritativo)

Todo lo simula el game server (namespace `/agar`, prefijo `ag:`):

| Archivo | Que hace |
| --- | --- |
| `server/src/games/agar-config.ts` | **Toda** la configuracion: mapa, cadencias, masa, velocidad, zoom, comida, red, nombres, bots. |
| `server/src/games/agar.ts` | Capa de red: administrador de arenas, validacion de cada mensaje, rate limit (`Guard`). |
| `server/src/games/agar-arena.ts` | La simulacion de una arena: movimiento, comer, culling, snapshots, bots. |
| `server/src/games/agar-grid.ts` | Spatial hash (comida estatica, celulas reconstruidas en cada paso). |
| `server/src/games/agar-bot.ts` | IA de los bots (Utility AI). |
| `server/scripts/agar-check.ts` | `npm run check:agar`: reglas, grilla, culling, bots, nombres (sin red). |
| `server/scripts/agar-net-check.ts` | `npm run check:agar-net`: lo mismo pero con sockets reales (validacion, rate limit, reconexion, arenas). |

El cliente manda **solo input**: `[n, t, dx, dy, act]`, un vector de modulo <= 1 (el
server lo recorta). Nunca posicion ni masa. La config que el cliente necesita para
predecir viaja en el `ag:init` (`clientConfig`), asi que **no hay constantes de juego
duplicadas** en el front: se cambia el tuning en el server y listo.

### Por que no usa `registerGame` de `rooms.ts`

Ese molde es "una sala de Supabase = un GameRoom con su roster". La arena publica no
tiene codigo ni roster: es un mapa abierto que se llena y, al llenarse
(`arena.maxSocketsPerArena`), abre otra. Las arenas de sala si van por `CODIGO:ronda`,
como Manchon (estado scopeado por ronda: entre rondas los clientes navegan y no todos
a la vez).

### Por que socket.io y no `ws` / Colyseus

Es lo que ya usa todo el server: un namespace mas en el mismo proceso, el mismo
`/health`, el mismo CORS, y heartbeat + reconexion de fabrica. `ws` hubiera sido un
segundo servidor de WebSocket al lado del existente; Colyseus trae su propio esquema
de estado y matchmaking, que chocan con el resto del repo.

## Red: los tres relojes

Mismo esquema que Manchon (ver "Interpolar sobre el reloj del server" en el CLAUDE.md
raiz). Medido con `?lag=150&jitter=40`: correccion media de la celula propia 1.25 u
(radio inicial 27), 0 tirones en los rivales.

- **Server: paso fijo de 40 Hz, snapshot cada 2 pasos (20 Hz)**, con el chequeo
  adentro del bucle de pasos. El pedido original era 30/20 Hz, que no encaja: el
  envio tiene que ser un multiplo entero del paso.
- **Celulas propias: prediccion + reconciliacion por acuse** (`Predictor.ts`). El
  snapshot trae `n` (ultimo input aplicado) y `a` (cuanto de el ya rige); el cliente
  parte de la posicion del server y vuelve a aplicar los inputs posteriores. Lo unico
  que corrige es lo que no puede predecir: comer cambia la masa y con ella la velocidad.
  El server aplica cada input con el **buffer de jitter** (`inputBufferMs`) para que
  dure alla lo mismo que aca.
- **Celulas ajenas: interpoladas** (`Timeline.ts`) `INTERP_DELAY` (110 ms = 2
  snapshots + margen) en el pasado, sobre el reloj de la simulacion con offset.
- **Comida que desaparece**: se borra cuando la interpolacion alcanza el snapshot que
  lo informo, no al llegar (si no, desaparecia antes de que la celula ajena,
  dibujada en el pasado, la tocara). Cada pellet guarda el snapshot que lo trajo, asi
  una baja vieja no borra un alta nueva del mismo id.

### Culling

Un snapshot por cliente con solo lo que entra en su vista: la misma cuenta que hace la
camara (centro de masa propio, alto `viewHeightOf(radio)`, proporcion de pantalla que
manda el cliente) por `cullMargin`. La comida no se repite: viaja como altas (`pa`) y
bajas (`pd`) respecto de lo que el cliente ya tiene (`knownPellets`), que se vacia en
cada `attach` (pagina nueva = no tiene nada dibujado).

Consecuencia: el **espectador** solo ve lo que esta cerca de su camara (`cx`/`cy` del
snapshot: donde murio, o el centro del mapa). No se puede "seguir" a una celula lejana
desde el cliente porque el server no la manda.

## Reglas (agar-config.ts)

- Comer: masa >= 1.25x y distancia entre centros < `R - 0.4 r` ("la cubre
  mayormente"). Se procesa de la mas grande a la mas chica.
- Las celulas del mismo dueno no se comen entre si: es el punto donde, al agregar
  dividir, se fusionarian.
- Por encima de 150 de masa se pierde 0.2% por segundo, para que el primero que crece
  no se quede con el mapa.
- Reaparicion: de 12 puntos al azar, el mas lejos de cualquier celula que se lo pueda
  comer.

## Sala sin tope de tiempo (y por que igual termina)

El programador pidio la sala **sin** `roomTimeLimitSec`. La regla del repo es que una
ronda tiene que poder terminar sola aunque alguien no toque nada, y aca se cumple sin
reloj:

1. Una vida por jugador (`respawn: false`): al morir reporta su masa maxima.
2. El primer humano que llega a `room.winMass` (1000) gana: la arena se congela, se
   manda `ag:over` y los vivos reportan lo suyo.
3. Los **bots no ceden su lugar** en la sala (`botsYield: false`) y se comen al que
   se queda quieto (medido: ~1.7 s con un bot cerca; en una sala real de dos
   navegadores quietos la ronda cerro sola en ~2.5 min).
4. Sin cambiar el input `room.afkMs` (45 s), la celula se disuelve.
5. Si el server se cae: a los 20 s sin conexion el cliente reporta lo que tenia
   (`ranked: false`).

`F5` en sala: el server reconoce al jugador por su nickname y le devuelve su celula; si
ya habia muerto, `canSpawn: false` en el init y queda mirando (no hay segunda vida).

## Puntaje y ranking

El puntaje es la **masa maxima de la vida**. La arena publica lo manda al ranking
global (`hud.showRanking`) al morir. Las partidas de sala reportan a la sala pero
**no** van al global (`roomRanked: false`): mapa mas chico, meta que corta y una sola
vida, no se comparan con la publica. El nombre es el mismo del sitio
(`shared/nickname`); el formulario de nombre del `LeaderboardPanel` esta oculto por CSS
para no duplicar el de la tarjeta.

## Robustez

- Heartbeat: el de socket.io (ping cada 25 s, timeout 20 s), explicito en `index.ts`
  porque Cloudflare Tunnel corta un WebSocket inactivo a los 100 s. Es del server
  entero, no por namespace.
- Reconexion: la hace socket.io. La arena publica da un **token** en el `ag:init`;
  reconectando con el dentro de `reconnectGraceMs` (10 s) se recupera la celula
  (quieta mientras tanto). El token de un jugador conectado no se puede usar.
- Validacion (`agar.ts`): un `ag:join` por socket, tipos y rangos de cada campo,
  nombres saneados (solo letras, numeros, espacio y `_ - .`, 12 como mucho),
  eventos desconocidos descartados, `maxMessageBytes` (256) por mensaje.
- Rate limit (`Guard`): token bucket de 60 con recarga de 40/s por conexion; 200
  faltas en 10 s cortan la conexion. El cliente legitimo manda <= 30/s.
- El `maxHttpBufferSize` de socket.io (1 MB) es del server entero y no se baja porque
  Imitame sube audios: el tope fino es el de `Guard`.
- `/health`: `clients` **no cuenta** las conexiones de la arena publica (es un mapa
  abierto que casi nunca queda vacio y el auto-update de la netbook no saldria
  nunca); `agar` trae el detalle. Las de sala si cuentan.

## Preparado para dividir (Espacio) y expulsar masa (W)

Fuera del alcance inicial, pero el codigo los espera:

- `Player.cells` es una lista desde el dia uno; movimiento, colisiones, culling,
  camara (centro de masa) y reconciliacion (`Predictor`, por id de celula) ya la
  iteran.
- `Cell.vx/vy` es un impulso que el paso ya integra y amortigua: dividir es crear la
  celula con impulso.
- El input trae `act` (bitmask, 1 = dividir, 2 = expulsar); `InputController` ya los
  junta con Espacio y W y el server los recibe en `player.act`. Hoy se ignoran.
- Falta: la regla de fusion (hoy las propias no se tocan) y que la prediccion tenga en
  cuenta el impulso (hoy lo corregiria la reconciliacion).

## Gotchas

- `tsconfig` del front tiene `erasableSyntaxOnly`: nada de parameter properties en
  `src/` (en `server/` si se puede).
- Los bots piensan con la grilla de celulas del paso anterior, que puede traer
  celulas ya comidas: por eso filtran con `owner.cells.includes(cell)`.
- La arena copia su `ModeConfig` (`{ ...modeConfig(kind) }`): sin la copia, cualquier
  cambio en una arena (o en un test) tocaba la config compartida.
- `?debug=1` expone el juego como `window.__agar` (lo usan las mediciones de
  Playwright del README).
