# Viborita

Clon de slither.io en tiempo real con server autoritativo. Detalle tecnico en
`CLAUDE.md`, direccion de arte en `DESIGN.md`.

## Correrlo en local

Dos procesos:

```bash
# 1. Game server (puerto 8787), con recarga al guardar
cd server
npm install
npm run dev

# 2. Front (en otra terminal, desde la raiz), apuntando al server local
VITE_GAME_SERVER_URL=http://localhost:8787 VITE_GAME_SERVER_FALLBACK_URL= npm run dev
```

Abrir `http://localhost:5173/games/viborita/`. Las variables de entorno del proceso le
ganan al `.env`, asi que no hace falta tocarlo. Para la sala hacen falta ademas las
credenciales de Supabase del `.env` (ver el CLAUDE.md raiz, "Salas").

Con los bots prendidos ya hay con quien jugar desde la primera pestana. Para varios
humanos, abrir varias ventanas (de incognito, para tener nombres distintos).

## Simular latencia

Agregar a la URL:

```
/games/viborita/?lag=150&jitter=40
```

- `lag`: ida y vuelta en ms. Se suma la mitad a cada mensaje que sale y la mitad a
  cada uno que llega.
- `jitter`: extra al azar de 0 a N ms en cada sentido (sin desordenar mensajes, como
  TCP).

Va en el cliente porque el throttling de red de las devtools no afecta a los
WebSockets. `?debug=1` ademas expone el juego en `window.__vb` (por ejemplo
`__vb.predictor.visX` para ver el resto de correccion de la cabeza propia).

## Chequeos

```bash
cd server
npm run check:viborita       # giro, cuerpo, choques, compensacion de lag, turbo, sala, culling, bots (~40 s)
npm run check:viborita-net   # con sockets reales: validacion, rate limit, reconexion, arenas (~15 s)
```

## Parametros

Todos en `server/src/games/viborita-config.ts`; el cliente los recibe al conectar.

| Grupo | Parametro | Default | Que hace |
| --- | --- | --- | --- |
| `sim` | `tickHz` | 40 | Paso fijo de la simulacion. |
| | `snapshotEvery` | 1 | Snapshot cada N pasos (40 Hz). Tiene que ser entero. |
| | `inputBufferMs` | 20 | Buffer de jitter de los inputs. |
| `lagComp` | `maxRewindMs` | 300 | Tope de la compensacion de lag (cuanto atras se puede juzgar un choque). |
| `arena` | `maxSocketsPerArena` | 40 | Conexiones por arena publica; al llenarse se abre otra. |
| `public` / `room` | `mapRadius` | 3000 / 1800 | Radio del mapa circular. |
| | `pelletCount` | 1100 / 450 | Comida natural que se mantiene. |
| | `bots`, `botsYield` | 10 si / 5 no | Bots, y si se van al entrar humanos. |
| | `respawn` | si / no | Reaparecer al morir (en sala, una vida). |
| | `winMass` | 0 / 600 | Largo que gana la ronda (0 = sin meta). |
| | `afkMs` | 120 s / 45 s | Sin cambiar el input, se disuelve. |
| | `reconnectGraceMs` | 10 s / 20 s | Cuanto se espera a un desconectado. |
| `snake` | `startMass` | 10 | Largo al aparecer. |
| | `rBase`, `rK` | 9, 0.6 | radio = rBase + rK x raiz(largo). |
| | `lenBase`, `lenK` | 100, 3 | largo del cuerpo (u) = lenBase + lenK x largo. |
| | `speed`, `boostSpeed` | 230, 470 | Velocidad normal y con turbo (u/s). |
| | `turnBase`, `turnMassK` | 4.4, 900 | giro (rad/s) = turnBase / (1 + largo / turnMassK). |
| | `mouthK` | 1.5 | Alcance de la boca (fraccion del radio). |
| | `crashK` | 0.6 | Cuanto tiene que entrar la nariz para chocar. |
| `boost` | `minMass` | 15 | Debajo de esto no hay turbo. |
| | `tickMs`, `costFrac`, `costMin` | 150, 0.012, 0.8 | Cuanto cuesta el turbo y cada cuanto. |
| | `dropFrac` | 0.6 | Lo que se pierde que queda como comida. |
| `pellet` | `deathDropFrac` | 0.7 | Lo que deja un muerto. |
| | `deathDropMin`, `deathDropMax` | 2, 10 | Tamano de cada bocado del muerto. |
| | `maxDrops` | 2500 | Tope de comida de muertos y turbo. |
| `view` | `baseHeight`, `exp` | 1000, 0.9 | Zoom: alto visible = base x (radio / radio inicial)^exp. |
| | `spectatorHeight` | 1500 | Alto visible del espectador. |
| `net` | `pingIntervalMs`, `pingTimeoutMs` | 25 s, 20 s | Heartbeat (de todo el server). |
| | `maxMessageBytes` | 256 | Tope por mensaje entrante. |
| | `rateCapacity`, `rateRefillPerSec`, `maxStrikes` | 60, 40, 200 | Rate limit por conexion. |
| | `spawnCooldownMs` | 1000 | Minimo entre morir y reaparecer. |
| `names` | `maxLen`, `fallback` | 12, "Viborita" | Nombres. |
| `bots` | `enabled`, `thinkEvery`, `respawnMs` | si, 4, 2500 | Bots. |
