# Topos (Whack-a-Mole)

Aplasta topos sobre un canvas 2D. Grid de 3x3 agujeros (`COLS` x `ROWS`); van
asomando topos en agujeros libres y hay que hacerles click antes de que se
escondan.

**Por vidas** (solo y salas): empiezas con `INITIAL_LIVES` (3) y **solo** pierdes
una al golpear una bomba; la partida termina al llegar a 0. En salas ademas hay
un tope de tiempo de 2 minutos por ronda, declarado por el propio juego (ver
"Modo sala").

## Mecanica

- **Topo normal** (`Mole`, tipo `normal`): +`NORMAL_POINTS` (10).
- **Topo dorado** (`golden`, prob. `GOLDEN_CHANCE` 12%): +`GOLDEN_POINTS` (25).
- **Bomba** (`bomb`, prob. `BOMB_CHANCE` 16%): hay que **evitarla**; golpearla
  cuesta **una vida** (tanto en solo como en salas).
- **Bomba disfrazada** (`disguised`, prob. `DISGUISED_CHANCE` 12%): es una bomba
  **vestida de topo**. Arranca con una **finta** (fase `feint`): un topo normal
  asoma apenas (`FEINT_PEEK`, por debajo del umbral golpeable) durante
  `FEINT_TIME` y se esconde; recien despues sube la bomba con **orejas de topo**
  (`drawDisguisedBomb`). Enganha porque parece un topo comun, pero golpearla
  cuesta **una vida** como cualquier bomba. La finta no es golpeable.
- Dejar que un topo se esconda no penaliza (es amistoso). Un martillazo al vacio
  (sin topo bajo el cursor) resta `MISS_PENALTY` (3) puntos; nunca baja de 0.

Cada topo sube (`rising`), se queda arriba (`holding`, `holdDuration`) y baja
(`falling`); `Mole.offset` (0..1) lo posiciona y sirve para recortarlo contra el
nivel del suelo al dibujarlo (asoma desde el agujero). Solo es golpeable con
`whackable` (visible, subiendo/arriba, no golpeado aun). El click elige el topo
con mayor `offset` bajo el cursor.

**Dificultad**: sube linealmente en los primeros `RAMP_SEC` (45 s). Con el
progreso, el intervalo de aparicion (`SPAWN_INTERVAL_BASE`->`_MIN`) y el tiempo
que el topo se queda arriba (`HOLD_DURATION_BASE`->`_MIN`) se acortan.

**Render** (todo en `Game.ts`): fondo cielo+pasto, agujeros (monticulo + abertura
oscura por detras, borde frontal por delante para dar profundidad), topos
recortados al suelo, y un martillo animado (`Swing`) en cada click. Los `+N`/`-N`
flotan en el canvas de popups del `Hud`. Sin emojis: todo dibujado con formas.

Countdown 3/2/1/YA obligatorio con blip de 750 Hz por label
(`SoundEffects.playCountdownTick`, guard `lastCountdownIndex`), ver root
`CLAUDE.md`.

## Scoring

`direction: "higher"` por defecto (mas puntos es mejor), asi que **no** declara
`scoring` en `meta.ts`. Solo guarda el `BEST_KEY` local y llama a
`hud.showRanking("whack-a-mole", score)` en el game over fuera de salas.

## Modo sala (multiplayer)

Cableado al modo fiesta compartido (ver root `CLAUDE.md`, "Salas"):
`initRoomMode("whack-a-mole", { getScore, onStart: beginCountdown })`. En salas
la mecanica sigue siendo **por vidas** (3, se pierden con bombas) pero se agrega
un **tope de tiempo** de 2 minutos por ronda, que el juego declara con
`roomTimeLimitSec: 120` en su `meta.ts` (sin tope, una partida podria no terminar
nunca). Diferencias cuando `this.room` esta activo:
- El tope sale de `this.room.deadline()` (el fin de ronda que ya calculo la sala a
  partir de `roomTimeLimitSec`, mas el margen de navegacion). `roomRemaining()`
  cuenta hacia ese deadline; el HUD lo muestra (`setTimer`) y al llegar a 0 el
  loop llama a `gameOver()`. En solo no hay tope de tiempo (`setTimer(null)`).
- `gameOver` reporta a la sala (`this.room.reportScore`) en vez de al ranking
  global; el reintento queda bloqueado (`onPrimary` retorna si hay sala, una
  sola partida por ronda) y el inicio lo dispara `onStart` para que todos
  arranquen juntos. `getScore` da el parcial si la ronda se corta por tiempo.
