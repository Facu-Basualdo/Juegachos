# Puerco Araña

Runner infinito de balanceo: un cerdo con máscara de araña se columpia de telaraña en telaraña entre edificios, avanzando a la derecha para siempre. Canvas 2D a pantalla completa; el mundo son píxeles y la cámara sigue al cerdo. Dirección de arte en `DESIGN.md` ("Neón al Anochecer").

## Archivos

- `game/Swing.ts` — la simulación, **pura** (sin DOM, sin sonido, sin azar propio): `pickAnchor`, `attach`, `stepPig`, `safeRope`, `nextAnchor`. Está separada para poder correrla sin pantalla con un bot (ver "Cómo se verificó").
- `game/Game.ts` — estados, input, cámara, puntaje y dibujo. Llama a `Swing.ts`.
- `game/constants.ts` — todo el tuning.
- `game/Hud.ts`, `game/SoundEffects.ts` — overlay / ranking / `HowToPanel` y sonidos sintetizados.

## Mecánica

- **Mantener pulsado** (toque o clic en cualquier parte de la pantalla, o Espacio) lanza la telaraña al anclaje marcado: el que está más adelante entre los que están por encima del cerdo (`WEB_ABOVE_MIN`), a lo sumo a `WEB_RANGE` y no más de `WEB_BEHIND_MAX` por detrás. Si no hay ninguno, mantener sigue intentando cada cuadro y engancha apenas uno entra en rango.
- **El anclaje que agarrarías ahora se marca** con un anillo que late y una línea punteada. Sin anillo, no hay nada a tiro: soltarse ahí es una apuesta. Es la información que más le faltaba al juego.
- **Soltar** conserva la velocidad íntegra (esa es la inercia del juego). Soltarse hacia adelante a más de `BONUS_SPEED` da `floor(velocidad / BONUS_DIVISOR)` puntos, **una sola vez por anclaje** (`Anchor.paid`): antes se podía tocar y soltar sobre la misma telaraña para sumar sin avanzar.
- **Colgado no se muere nunca.** El largo de la cuerda queda en la distancia del enganche, pero si con ese largo la parte baja del arco tocaría la calle, se recoge hasta `safeRope` (deja `ROPE_CLEARANCE` de margen) a `REEL_SPEED`, o más rápido si el cerdo va más rápido. Y como red final, si igual fuera a tocar la calle, la cuerda se acorta ahí mismo. **Lo único que mata es tocar la calle suelto**: soltarse mal o sin nada a tiro.
- El empuje del péndulo (`SWING_PUMP`) solo alimenta la mitad **hacia adelante** del balanceo y se apaga sobre `PUMP_MAX_SPEED`. Antes empujaba también hacia atrás, y el cerdo quedaba atrapado yendo y viniendo bajo un anclaje.
- **Avenidas**: de vez en cuando el hueco entre torres se abre a `AVENUE_GAP_*` (560-860 px). Solo se cruzan soltándose rápido y hacia arriba. Son más frecuentes y anchas con la distancia (`AVENUE_CHANCE_*`, `DIFFICULTY_DISTANCE`), igual que los huecos normales (`ANCHOR_GAP_START` -> `ANCHOR_GAP_END`). Las primeras `AVENUE_FREE_ANCHORS` nunca son avenida.
- Puntaje: `floor((distancia máxima - START_X) / PX_PER_POINT)` + bonus. Columpiarse hacia atrás nunca resta (`farthestX`).
- La partida arranca colgado de un anclaje fijo (`FIRST_ANCHOR_X`, y = 140) con velocidad hacia adelante, así la cuenta 3/2/1/YA desemboca en un balanceo y no en una caída. Mantener o soltar durante la cuenta no suelta al cerdo: el primer soltar que cuenta es el de la partida.

## Pantalla y cámara

- El canvas ocupa todo `#app` (antes era un rectángulo de 900x600 con bandas, que en un celular vertical quedaba de 390x260). La escala sale de que siempre se vean `WORLD_HEIGHT` (600) px de alto y al menos `MIN_VIEW_WIDTH` de ancho: una pantalla ancha ve más ciudad adelante, una vertical ve más cielo. `devicePixelRatio` hasta `MAX_DPR`.
- Cámara horizontal: el cerdo a `CAMERA_PIG_VIEW_X` del ancho, y en vistas angostas más a la izquierda (hasta `CAMERA_PIG_VIEW_X_MIN`) para que queden `CAMERA_MIN_AHEAD` px visibles adelante: si no, en vertical el anclaje marcado quedaba fuera de pantalla.
- Cámara vertical: la calle queda en el borde de abajo y la vista sube solo para mantener al cerdo a `CAMERA_TOP_MARGIN` del borde de arriba. Antes era fija y un lanzamiento fuerte sacaba al cerdo de la pantalla.

## Decisiones no obvias

- **Método de simulación**: Euler simpléctico + restricción de distancia por proyección (posición sobre el círculo y se anula la velocidad radial saliente), en subpasos de 1/120 s (`PHYSICS_STEP`). Es lo que recomienda `SIMULATION_ARCHITECTURE.md` para cuerdas (sección 1.A). El rework no cambió el método, solo las reglas alrededor (selección de anclaje, recogido, empuje, generación). Con la cuerda floja (adentro del círculo) el cerdo cae libre aunque esté enganchado.
- **Los anclajes se generan después de ubicar la cámara.** `spawnAnchorsAhead` genera hasta `cameraX + viewW + 600`; antes corría con la cámara de la partida anterior y cada reintento creaba miles de anclajes (cada uno dibujado con `shadowBlur`), con el juego trabado.
- El input va sobre el **container**, no sobre el canvas (regla del repo: el overlay tapa el canvas, y además así cuentan los toques en toda la pantalla). `pointerup` / `pointercancel` / `blur` en `window` sueltan la telaraña, así no queda pegada si el dedo sale de la pantalla o se cambia de pestaña. Espacio ignora `e.repeat`.
- El skyline de fondo (dos capas con parallax horizontal) se dibuja sin estado con un hash determinista `fract(sin(i * 127.1) * 43758.5453)` por índice de slot. Solo los anclajes (y sus torres) viven en una lista, podada detrás de la cámara; el anclaje enganchado nunca se poda.
- Sonidos sintetizados con Web Audio en `SoundEffects.ts` (sin assets): enganche, soltar, bonus, golpe contra la calle y el blip del countdown (guardado por `lastCountdownIndex`).
- Ranking global (`hud.showRanking("puerco-arana", score)`, scoring por defecto `higher`, sin `scoring` en `meta.ts`) y modo sala (`initRoomMode` con `onStart`) según el patrón del repo.
- **Sala: necesita `roomTimeLimitSec` (180).** Como colgado no se muere y la partida arranca colgado, un jugador quieto se columpia para siempre.

## Cómo se verificó

La simulación se corrió sin pantalla (empaquetando `Swing.ts` con rolldown) con varios bots, 200 corridas cada uno. Con el tuning actual: un bot que se suelta subiendo hacia adelante a un tercio del arco sobrevive una mediana de ~48 s (340 puntos); uno que se suelta apenas pasa el punto bajo, ~9 s; uno que aprieta y suelta a ritmo fijo sin mirar, ~6 s. Un bot planificador (simula soltarse en cada cuadro y solo se suelta si el vuelo engancha un anclaje más adelante) sobrevivió 60 corridas de 4 minutos sin trabarse, cruzando avenidas de hasta 859 px: **toda avenida se puede cruzar**. Ninguna corrida de ningún bot murió enganchada. Si se cambia el tuning de rango, huecos o avenidas, repetir esa prueba: con `WEB_RANGE` 440 un cerdo que se soltaba bajo no tenía ningún anclaje a tiro, y con el recogido fijo a 700 px/s se moría enganchado a velocidad alta.

## Tuning

Todo en `game/constants.ts`: gravedad, rango y reglas del enganche, recogido de cuerda, empuje, huecos y avenidas con su rampa de dificultad, puntaje y cámara.
