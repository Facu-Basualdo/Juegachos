# Agar

Clon de agar.io en tiempo real con server autoritativo. Detalle tecnico en
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

Abrir `http://localhost:5173/games/agar/`. Las variables de entorno del proceso le
ganan al `.env`, asi que no hace falta tocarlo. Para la sala hacen falta ademas las
credenciales de Supabase del `.env` (ver el CLAUDE.md raiz, "Salas").

Para probar con varios jugadores, abrir la pagina en varias pestanas (o ventanas de
incognito, para tener nombres distintos). Con los bots prendidos ya hay con quien
jugar desde la primera.

## Simular latencia

Agregar a la URL:

```
/games/agar/?lag=150&jitter=40
```

- `lag`: ida y vuelta en ms. Se suma la mitad a cada mensaje que sale y la mitad a
  cada uno que llega.
- `jitter`: extra al azar de 0 a N ms en cada sentido (sin desordenar mensajes, como
  TCP).

Va en el cliente porque el throttling de red de las devtools no afecta a los
WebSockets. `?debug=1` ademas expone el juego en `window.__agar` para medir desde la
consola (por ejemplo `__agar.predictor.cells` para ver el resto de correccion).

## Chequeos

```bash
cd server
npm run check:agar       # reglas, spatial hash, culling, bots, nombres (~1 s)
npm run check:agar-net   # con sockets reales: validacion, rate limit, reconexion, arenas (~20 s)
```

## Parametros

Todos en `server/src/games/agar-config.ts`; el cliente los recibe al conectar.

| Grupo | Parametro | Default | Que hace |
| --- | --- | --- | --- |
| `sim` | `tickHz` | 40 | Paso fijo de la simulacion. |
| | `snapshotEvery` | 2 | Snapshot cada N pasos (20 Hz). Tiene que ser entero. |
| | `inputBufferMs` | 30 | Buffer de jitter de los inputs. |
| `arena` | `maxSocketsPerArena` | 40 | Conexiones por arena publica; al llenarse se abre otra. |
| `public` / `room` | `mapSize` | 5000 / 3200 | Lado del mapa. |
| | `pelletCount` | 900 / 450 | Comida que se mantiene. |
| | `bots` | 10 / 6 | Bots de la arena. |
| | `botsYield` | si / no | Si los bots se van a medida que entran humanos. |
| | `respawn` | si / no | Reaparecer al morir (en sala, una vida). |
| | `winMass` | 0 / 1000 | Masa que gana la ronda (0 = sin meta). |
| | `afkMs` | 120 s / 45 s | Sin cambiar el input, la celula se disuelve. |
| | `reconnectGraceMs` | 10 s / 20 s | Cuanto se espera a un desconectado. |
| `cell` | `startMass` | 20 | Masa al aparecer. |
| | `radiusK` | 6 | radio = radiusK x raiz(masa). |
| | `speedBase`, `speedExp` | 760, 0.31 | velocidad = speedBase x masa^-speedExp. |
| | `maxMass` | 20000 | Tope de masa. |
| | `decayMinMass`, `decayPerSec` | 150, 0.002 | Perdida de masa de las grandes. |
| `eat` | `ratio` | 1.25 | Proporcion de masa para comerse a otra. |
| | `overlap` | 0.4 | Cuanto tiene que cubrirla (dist < R - overlap x r). |
| `pellet` | `mass`, `radius`, `colors`, `respawnPerTick` | 1, 7, 6, 3 | Comida. |
| `view` | `baseHeight`, `exp` | 1100, 0.45 | Zoom: alto visible = base x (radio / radio inicial)^exp. |
| | `spectatorHeight` | 1700 | Alto visible del espectador. |
| | `cullMargin` | 1.2 | Margen del culling sobre lo visible. |
| `net` | `pingIntervalMs`, `pingTimeoutMs` | 25 s, 20 s | Heartbeat (de todo el server). |
| | `maxMessageBytes` | 256 | Tope por mensaje entrante. |
| | `rateCapacity`, `rateRefillPerSec` | 60, 40 | Rate limit por conexion. |
| | `maxStrikes` | 200 | Faltas en 10 s antes de cortar. |
| | `spawnCooldownMs` | 1000 | Minimo entre morir y reaparecer. |
| `names` | `maxLen`, `fallback` | 12, "Celula" | Nombres. |
| `bots` | `enabled` | si | Interruptor general de bots. |
| | `thinkEvery`, `respawnMs` | 4, 2500 | Cada cuantos pasos piensan y cuanto tardan en volver. |
