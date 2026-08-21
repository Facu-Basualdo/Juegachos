# Trench Rush

Rail shooter 3D (Three.js) al estilo "trench run": la nave está fija en el eje Z y el jugador la mueve en X/Y dentro de una trinchera espacial que scrollea hacia la cámara. Se dispara a drones voladores, se esquivan sus láseres y rayos de energía que cruzan la trinchera, y se sobrevive lo máximo posible mientras la dificultad rampea.

## Loop y estados

`Game.ts` maneja los estados `ready | countdown | playing | gameover` en un único `renderer.setAnimationLoop(this.tick)`. `dt` se clampa a 0.05 s para evitar saltos en frames largos. El countdown 3/2/1/YA compartido es obligatorio (`beginCountdown()` + `Hud.showCountdown()`), con blip por etiqueta vía `SoundEffects.playCountdownTick()` guardado por `lastCountdownIndex`.

- **Movimiento**: la nave no avanza; el mundo (trinchera + estrellas + enemigos) scrollea hacia +Z a `speed`, que rampea de `BASE_SPEED` a `MAX_SPEED`. El jugador se mueve en X/Y con suavizado (`PLAYER_SMOOTHING`) y banca/cabecea según la velocidad.
- **Cámara**: montaje rígido en 3ra persona, "soldada" a la nave. En `tick` la posición de la cámara = posición de la nave + offset fijo (`+0.8` en Y, `CAMERA_Z` en Z), sin suavizado/lag (así no "persigue"). La orientación es constante: el target del `lookAt` es un offset fijo respecto de la propia cámara (`camPos + (0,-0.6,-20)`), no la nave, por lo que el ángulo de visión nunca cambia y la nave queda clavada en el mismo punto con la misma perspectiva. `CAMERA_Z` (constants) controla qué tan cerca está. El shake se suma al offset.
- **Score**: +1 por distancia cada 0.16 s, +10 por drone, +15 por torreta, +50 si recogés un power-up con escudo lleno.
- **Escudo**: `SHIELD_MAX = 3` celdas. Cada golpe resta 1 y da 1 s de invulnerabilidad (`invulnTimer`, la nave parpadea). Los power-ups verdes restauran 1 celda.

## Enemigos (`Enemy.ts`) y hazards (`Beam.ts`)

Dos amenazas: **drones** (`Enemy`, se disparan) y **rayos de energía** (`Beam`, se esquivan). No hay más torretas montadas en piso/paredes — se reemplazaron por los rayos.

**Drones** (`Enemy.ts`): 1 hp, vuelan hacia el jugador ondulando en X, escalados por `DRONE_SCALE` (grandes; el `radius` de colisión se multiplica por el mismo factor).
- **Color / visibilidad**: casco **blanco** con `emissive` blanco (glow base `EMISSIVE_BASE`) para quedar más brillante que las paredes y destacar vía bloom; los paneles TIE oscuros (`0x14161a`) contrastan el cuerpo blanco. Ojo rojo neón.
- **Disparo apuntado**: los láseres salen con un vector de dirección hacia la posición del jugador (más una dispersión `AIM_SPREAD`) para que sean esquivables.
- **Feedback de daño**: `takeDamage()` prende un `hitFlash` que sube el `emissiveIntensity` de `hitMats` (de `EMISSIVE_BASE` a `EMISSIVE_FLASH`) durante `HIT_FLASH_TIME` — se usa `emissiveIntensity` (no `emissive`) para no pisar el glow base.
- **Agresividad por dificultad**: el constructor recibe `difficulty` y acorta `fireInterval` y sube `relativeSpeedZ`.

**Láseres** (`Laser.ts`): los disparos **enemigos** son más gruesos, largos y brillantes (naranja `0xff5a1e` + halo aditivo) para leerse claramente como peligro entrante; los del jugador son finos (cian). El halo se libera en `destroy` junto con el resto (array `disposables`).

**Rayos** (`Beam.ts`): barra de energía que cruza toda la trinchera y scrollea hacia la nave; **no se puede disparar, sólo esquivar**. `vertical` = barra de piso a techo en un X fijo (esquivar izq/der); `horizontal` = barra de pared a pared en un Y fijo (esquivar arriba/abajo). El eje (X o Y) vive en el `group` para poder moverse: con `sweepAmp > 0` el rayo oscila sobre su eje perpendicular (`spawnMovingBeam` crea un horizontal que sube/baja). Cilindro core + halo aditivo pulsante (rojo, brilla por bloom) con dos emisores ámbar. Colisión **barrida** (`hits`): usa `prevZ`/`z` del frame para que a alta velocidad (`MAX_SPEED`) la nave no se cuele sin registrar el golpe. Usa `takeDamage(1)` con ventana de invulnerabilidad, así no pega dos veces.

**Paredes de láser** (`LaserWall.ts`): rejilla roja de barras (verticales + horizontales cada 3 u) que cubre toda la sección de la trinchera, **cortada** en una abertura rectangular (`GAP_HALF_W/H`) enmarcada por un rectángulo cian brillante que señala el paso. Scrollea hacia la nave; no se dispara. `hits` (barrida en Z) golpea salvo que la nave pase por el hueco (con `PLAYER_MARGIN` de tolerancia).

**Jefes** (`Boss.ts`): nave capital con `MAX_HEALTH` (aguanta muchos disparos). Vuela desde lejos hasta `HOLD_Z`, ahí strafea (X/Y) y dispara ráfagas de 3 láseres apuntados (que van al pool `this.lasers`, reusando la colisión láser-vs-nave). El casco tiene acentos rojos `emissive` (en `hitMats`) que flashean con el daño y un core ámbar (punto débil visual). `healthFrac` alimenta la barra del HUD (`hud.showBoss/setBossHealth/hideBoss`, estilada en `style.css` como `.boss-bar`). Al morir: fireball múltiple, `+BOSS_SCORE` (500) y reset del timer.

Spawn (`Game`): mientras hay un jefe vivo, **los hazards normales se pausan** (`if (!this.boss)`) para que la pelea se lea. El jefe aparece tras `FIRST_BOSS_AT` s y luego cada `BOSS_INTERVAL` s. `spawnHazard` reparte 50% dron / 18% rayo estático / 16% rayo móvil / 16% pared. Todos los hazards se limpian en `beginCountdown` y `dispose`; el jefe además se descarta y oculta su barra ahí.

## Láseres (`Laser.ts`)

Un solo `Mesh` cilíndrico. Constructor `(scene, x, y, z, isEnemy, dir?)`: `dir` opcional (se normaliza) orienta la velocidad y el mesh vía `quaternion.setFromUnitVectors`. El jugador dispara recto (-Z, dos cañones desde `getWeaponPorts()`); los enemigos pasan el vector apuntado. **No** llevan `PointLight` propio: el brillo lo da el `UnrealBloomPass`.

`collidesWith(tx,ty,tz,r)` es un test barato en X/Y + ventana en Z a lo largo del cilindro. Para láseres enemigos angulados es aproximado pero suficiente (la nave es una esfera de `PLAYER_RADIUS`).

## Colisiones (en `Game.ts`, orden importa)

1. Láser jugador vs enemigos (daño; el láser se autoculla con `z = -999`).
2. Láser enemigo vs jugador (`z = 999` para cullear + `takeDamage`).
3. Nave vs enemigo (choque directo: instakill al enemigo + daño a la nave).
3b. Nave vs rayo (`Beam.hits`, daño; el rayo no se destruye).
3c. Nave vs pared de láser (`LaserWall.hits`, daño salvo que pase por el hueco).
3d. Láser jugador vs jefe (varios impactos; al morir suma `BOSS_SCORE` y limpia).
4. Nave vs power-up (restaura escudo o +50 si ya está lleno).

Tras las colisiones se barre `this.enemies` y se elimina (`dispose` + `splice`) todo el que quedó `alive === false`. Sin este barrido los enemigos muertos seguían visibles scrolleando hasta pasar la cámara (sólo se cullean por `z`). La explosión ya se dispara en el momento de la muerte.

## Presupuesto de luces (gotcha)

El shader tiene un límite práctico de luces dinámicas. Se mantienen pocas a propósito: key + fill + ambient + `crashFlash` + headlight de la nave + (a lo sumo) la luz de un par de power-ups. **No** agregar un `PointLight` por láser ni por baliza de la trinchera: eso metía decenas de luces (8 segmentos x hasta 4 balizas) y causaba flicker/recompiles. Todo lo "que brilla" (láseres, balizas, motores) usa `MeshBasicMaterial` + bloom, no luces reales.

## Memoria / disposición

Cada entidad (nave, enemigo, trinchera, explosión, láser, power-up) libera sus geometrías/materiales al descartarse. Los power-ups se disponen sueltos cuando se recogen o salen de cámara; **no** meterlos en un array global de larga vida (fugaba referencias a objetos ya liberados).

## Dificultad progresiva

`Game.difficulty = elapsed / DIFFICULTY_RAMP_TIME` crece sin techo mientras jugás (llega a 1.0 a los `DIFFICULTY_RAMP_TIME` s y sigue subiendo). De ahí salen: el intervalo de spawn (`ENEMY_SPAWN_INTERVAL_START - difficulty * SPAWN_INTERVAL_DROP`, con piso `ENEMY_SPAWN_INTERVAL_MIN`), **drones extra** por trigger (`min(2, floor(difficulty*0.8))`), la **agresividad de los drones** (se les pasa `difficulty`: `fireInterval` más corto y `relativeSpeedZ` mayor), y los **jefes** (más vida — `MAX_HEALTH + floor(difficulty*9)` — y `bossTimer` más corto tras cada uno). La velocidad rampa aparte de `BASE_SPEED` a `MAX_SPEED` por `SPEED_RAMP_PER_SEC`.

## Tuning (`constants.ts`)

`BASE_SPEED`/`MAX_SPEED`/`SPEED_RAMP_PER_SEC` (velocidad y su rampa), `DIFFICULTY_RAMP_TIME`/`SPAWN_INTERVAL_DROP` (curva de dificultad), `ENEMY_SPAWN_INTERVAL_START`/`_MIN` (frecuencia de spawn), `PLAYER_FIRE_COOLDOWN`, `LASER_SPEED`/`ENEMY_LASER_SPEED`, `SHIELD_MAX`. Cadencia/fuerza del jefe: `FIRST_BOSS_AT`/`BOSS_INTERVAL`/`BOSS_SCORE` (en `Game.ts`) y `MAX_HEALTH` (en `Boss.ts`). Los límites de movimiento de la nave viven en `Player.ts` (`MAX_X`, `MIN_Y`, `MAX_Y`).

## Rankings / salas

Scoring por defecto (`higher`), así que `meta.ts` no exporta `scoring`. Room mode cableado: `initRoomMode("trench-rush", { getScore, onStart: beginCountdown })`; en game over reporta a la sala o, si es solo, a `hud.showRanking`. El input de reinicio se bloquea en room mode vía `handleActivate` (`if (this.room && this.state === "gameover") return;`).

El overlay de fin (con `reportScore`/`showRanking`) se difiere 550ms para que la explosión se vea primero, y `handleActivate` gatea el reinicio con un flag `menuVisible` (true solo con el overlay realmente en pantalla). Sin ese flag, reiniciar durante esos 550ms hacía que el `setTimeout` del overlay retornara temprano por su propio chequeo `state === "gameover"` y **el puntaje de esa corrida nunca se enviara al ranking**.
