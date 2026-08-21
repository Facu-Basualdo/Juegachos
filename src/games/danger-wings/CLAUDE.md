# Danger Wings

Clon 2.5D de *Don't Touch the Spikes* con estetica gotica/tetrica (ver `DESIGN.md`, "Consecrated Iron"). Un cuervo atrapado en una celda de hierro vuela horizontalmente y rebota contra las paredes laterales; cada rebote suma +1 y hace asomar nuevas puas en la pared de enfrente. El jugador aletea (Espacio / clic / toque) para no caer sobre las puas fijas del piso ni tocar el techo, y esquiva las puas laterales que emergen en cada rebote. Reliquias rubi aparecen cada tantos rebotes y dan puntos extra. Three.js + fisica manual por vectores (sin motor de fisica).

## Module layout

- `main.ts` — entry point, monta `Game` en `#app`.
- `game/Game.ts` — orquesta scene/camera/renderer/composer, la maquina de estados `ready -> countdown -> playing -> gameover`, el loop (`setAnimationLoop`), toda la deteccion de colisiones y el puntaje. Tambien: fit de camara responsivo, screen shake, flash rojo y el cambio de tinte cada 10 puntos.
- `game/Bird.ts` — el cuervo: fisica manual (`velocity.x` constante que se invierte al rebotar, `velocity.y` con gravedad + impulso de aleteo), modelo armado con primitivas (cuerpo, pico dorado, ojos con cejas, alas que aletean, cola), tilt segun `vy`, y el `Box3` de colision.
- `game/Room.ts` — la celda: paredes de piedra (izq/der/techo/piso, **sin pared de fondo** para que el backdrop se vea a traves de la celda detras del cuervo, como en el cover) y las puas fijas de techo/piso (conos de 4 lados como dientes forjados).
- `game/Environment.ts` — la **escenografia gotica** alrededor y detras de la celda: el backdrop pintado (canvas gotico procedural por defecto: luna con corona, agujas de catedral en capas con perspectiva atmosferica y ventanas rojas, roseton, murcielagos, vineta central; o la imagen IA de Krea si existe), antorchas con luz parpadeante montadas en el marco de piedra por fuera (en los margenes, fuera del area de juego para no molestar), brasas flotantes (`THREE.Points` que suben y wrapean) y cadenas colgantes. `loadBackdrop()` intenta cargar la imagen de Krea (`BACKDROP_URL`) y si no esta deja el canvas procedural (no-op silencioso). `update(dt, elapsed)` anima el parpadeo de antorchas y las brasas.
- `game/SpikeWalls.ts` — las puas dinamicas de las paredes izquierda y derecha. Cada pared tiene `SIDE_SLOTS` posiciones; `presentWall(side, count)` elige `count` slots al azar y `retractWall(side)` las esconde. Animacion de emerger/retraer via `progress` (0..1), colision precisa con `checkHit`.
- `game/Candy.ts` — la reliquia rubi (octaedro facetado giratorio con luz propia). `spawn(y)` / `collect()`.
- `game/Particles.ts` — pool de chispas fire-and-forget para el estallido de la reliquia y la muerte. Solo cosmetico.
- `game/InputController.ts` — una sola accion (aletear / empezar / reintentar) en Space/Enter/ArrowUp/W/clic/toque; el `Game` decide segun el estado.
- `game/Hud.ts` — overlay DOM (puntaje, mejor, start/game-over, countdown, flash rojo) + `LeaderboardPanel`.
- `game/SoundEffects.ts` — efectos Web Audio sintetizados (tick de countdown, aleteo, rebote de hierro, campana de reliquia, muerte metalica). Sin assets.
- `game/constants.ts` — **todo el tuning** (dimensiones de la celda, fisica del pajaro, largo/cantidad de puas, dificultad por puntaje, economia de reliquias, paleta y ciclo de tinte). Tocar aca primero.

## Como funcionan las colisiones (todo en `Game.updatePlaying`)

Coordenadas en el plano XY; camara de frente mirando -Z. La celda va de `x = ±SIDE_X`, `y ∈ [FLOOR_Y, CEIL_Y]`.

1. **Techo / piso (puas fijas, siempre letales):** muere si `birdY + BIRD_RADIUS >= CEIL_TIP_Y` o `birdY - BIRD_RADIUS <= FLOOR_TIP_Y` (las lineas de las puntas de las puas fijas).
2. **Puas laterales:** `SpikeWalls.checkHit(x, y, dir)` chequea SOLO la pared hacia la que va el pajaro (`dir = sign(vx)`). Una pua mata si esta suficientemente afuera (`progress >= 0.35`), el pajaro esta dentro de su rango vertical (`SIDE_SPIKE_HALF`) y su borde alcanza la punta actual. La punta esta mas adentro que el limite de rebote, asi que la pua mata *antes* de que el pajaro llegue a la pared: por un hueco pasa y rebota, por una pua muere.
3. **Rebote:** si no murio y `|x|` alcanza `SIDE_X - BIRD_RADIUS`, rebota: `velocity.x *= -1`, +1 al puntaje, `bird.bounce()` aplica un pequeño empujon vertical (game feel), se recalcula la magnitud de `vx` con la rampa de dificultad, se **retrae la pared que dejo** y se **presentan puas nuevas en la pared de enfrente** (cantidad por `spikeCountRange(score)`).
4. **Reliquia:** si esta activa y la distancia al pajaro < `CANDY_COLLECT_DIST`, se colecta (+`CANDY_POINTS`, estallido de particulas, agenda la proxima a `bounces + CANDY_BOUNCE_INTERVAL`).

**Regla de "pared limpia" (fiel al original):** la pared hacia la que volas ya tiene sus puas afuera esperando (se generan en el rebote anterior, ~1-1.5s antes de llegar, y el emerger tarda `SIDE_SPIKE_EMERGE_TIME`); la que dejas se retrae al instante. Al arrancar (`beginCountdown`) el pajaro va hacia la derecha, asi que se presenta la pared derecha.

**Progresion de dificultad:** `spikeCountRange(score)` -> 0-5: 2-3 puas; 6-15: 3-5; 16-20: 4-6; >20: 5-7 (de 9 slots, casi sin huecos). La velocidad horizontal tambien sube `SPEED_X_PER_POINT` por punto hasta `SPEED_X_MAX`.

## Decisiones no obvias

**Camara con fit responsivo (`fitCamera`).** La celda entra completa en cualquier aspecto: se calcula la distancia `z` necesaria para el alto y para el ancho (segun `aspect`) y se toma el mayor, con `CAM_FIT_MARGIN`. En portrait la camara se aleja mas para que no se corte el ancho. Se recalcula en cada resize.

**Bloom moderado y racionado.** `UnrealBloomPass` con threshold alto (0.82): solo brillan de verdad la luna, las antorchas, las brasas, la reliquia rubi y los ojos del cuervo. El resto de la escena es oscuro a proposito (ver `DESIGN.md`).

**Celda abierta + backdrop pintado (patron boilerbound).** No hay pared de fondo: el backdrop vive en un plano grande (50x27.73, aspecto = imagen 2048x1136) en `z=-8` con `MeshBasicMaterial` (`toneMapped:false`, `fog:false`, `depthWrite:false`) para que la imagen pintada quede limpia, y la celda se ve como una ventana al mundo gotico. La imagen de Krea ya esta en `public/models/danger-wings/backdrop.jpg` (`Environment.loadBackdrop()` la carga); si se borra, el canvas procedural (con su propia vineta) queda de fallback y no pasa nada.

**Scrim de vineta para la legibilidad (`buildVignette`).** La imagen pintada NO trae vineta, asi que la zona de juego quedaria demasiado clara y el cuervo (silueta) perderia contraste contra la catedral. El fix: un plano con un radial oscuro-al-centro / transparente-a-los-bordes en `z=-1.6` (apenas abajo, para no matar el brillo de la luna arriba). Por el orden de profundidad **solo oscurece lo que esta detras** (el backdrop, visto a traves de la celda abierta): el cuervo, las puas y el marco son opacos, estan mas cerca de la camara, escriben profundidad y el scrim (con `depthWrite:false`, `depthTest` on) no los pisa. Resultado: el cuervo mantiene contraste pleno contra un medio-fondo oscurecido, y los margenes pintados ricos quedan intactos. Funciona con cualquier imagen de backdrop.

**Luz calida vs fria.** Las antorchas (`PointLight` naranja con parpadeo por senos superpuestos + ruido, sin sombras para no multiplicar el costo) dan el contraste calido contra la luz de luna fria (`DirectionalLight` que si castea sombra). Es el unico juego de color-temperatura de la escena.

**Puas laterales: geometria horneada para animar con un solo eje.** Cada cono se rota+traslada en el constructor de `SpikeWalls` para que la base quede en `x=0` local y la punta en `∓SIDE_SPIKE_LEN`; asi mover `mesh.position.x` es todo lo que hace falta para emerger/retraer, y la punta actual (`SIDE_X - progress*len`) es la que usa la colision. Cross-section en diamante (`rotation.x = PI/4`) para que lea como diente forjado.

**Tinte cada 10 puntos (`TINT_CYCLE`), pero hacia el frio.** A diferencia del original que se aclara en pasteles, aca el tinte del fog + `hemi.groundColor` se desliza entre tonos casi-negros (indigo -> granate sangre -> teal ahogado -> violeta sepulcral) para que "avanzar" se sienta mas frio y extraño, nunca mas alegre.

**Enter-to-start countdown.** Desde start / game-over, la accion entra en `countdown` 3/2/1/YA (`COUNTDOWN_LABELS`, `COUNTDOWN_STEP`) con el tick 750 Hz; durante el countdown el cuervo flota (`Bird.idle`) y el input se ignora. Patron compartido obligatorio (ver `CLAUDE.md` raiz).

## Room mode (multiplayer)

Cableado al modo sala: el constructor llama `initRoomMode("danger-wings", { getScore: () => this.score, onStart: () => this.beginCountdown() })`. Con `?room=` en la URL el game-over reporta a la sala en vez del ranking global, el restart queda bloqueado (una corrida por ronda) y la ronda arranca sola via `onStart`. **No** necesita `roomTimeLimitSec`: dejado sin tocar, el pajaro cae por gravedad sobre las puas del piso y la corrida termina sola. Sin el parametro, nada cambia.
