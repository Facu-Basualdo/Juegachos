# Macaco Tilt (`macaco-tilt`)

Arcade de supervivencia y balanceo en **Canvas 2D puro** (sin Three.js). Un mono esta parado
sobre un tablon de bambu apoyado en una cuna central, sobre un barranco. El jugador camina
izquierda/derecha para reacomodar el centro de masa; el tablon **se rompe por los extremos**
cada tantos segundos y **rafagas de viento** lo empujan. Si el mono se pasa del borde del
tablon (cada vez mas corto) o el tablon se inclina mas alla del punto de rescate, se cae al
vacio. El puntaje es el **tiempo sobrevivido** en segundos con centesimas (mas es mejor).
Estetica: selva pintada tipo Donkey Kong Country (ver `DESIGN.md`, "Luz de Dosel").

Controles: flechas o A/D **mantenidas**, o mantener apretado cada mitad de la pantalla (mas
dos botones en pantalla para pointers gruesos).

## Module layout

- `main.ts` — entry point, monta `Game` en `#app`.
- `game/Game.ts` — orquestador: canvas, maquina de estados (`ready` / `countdown` /
  `playing` / `falling` / `gameover`), el loop de `requestAnimationFrame`, el letterbox del
  view box fijo y **el acople de la fisica** (ver abajo). Tambien el shake y el spawn de
  sudor/hojas.
- `game/Plank.ts` — el tablon: angulo, velocidad angular, los **dos medios anchos por
  separado** (`halfLeft` / `halfRight`, porque los recortes lo dejan asimetrico), el
  cronograma de roturas y la **fatiga por segmento** (`stepStress`, ver abajo).
  `supports(pos, footHalf)` es el test de caida.
- `game/Monkey.ts` — posicion y velocidad **a lo largo del tablon**, la maquina de estados
  de animacion (`idle` / `walk` / `panic` / `fall`) y la caida libre en espacio de mundo.
- `game/Wind.ts` — las rafagas: `idle` -> `warning` (telegrafo) -> `gusting`. Devuelve la
  aceleracion angular del frame.
- `game/Particles.ts` — pool de sudor, astillas y hojas. Puramente cosmetico.
- `game/Jungle.ts` — el fondo con **paralaje de 3 capas** horneadas en canvas offscreen, mas
  los rayos de luz, el barranco y la neblina dibujados en vivo.
- `game/Renderer.ts` — todo el dibujo: roca, cuna, tablon de bambu, mono (las cuatro caras) y
  particulas. **Ninguna capa usa `shadowBlur`**: el glow se hace con gradientes radiales, que
  al lado de un gaussiano por frame es gratis.
- `game/InputController.ts` — el estado **mantenido** de izquierda/derecha (teclas + mitades
  de pantalla + botones). No maneja el Enter: eso vive en el `Hud`, para que un toque durante
  la partida camine en vez de reiniciar.
- `game/Hud.ts` — overlay DOM: reloj, mejor, start/game-over, countdown y el panel de ranking.
- `game/SoundEffects.ts` — Web Audio sintetizado: tick de countdown, crack de bambu, whoosh
  de viento, alarido de caida, thud final.
- `game/constants.ts` — toda la fisica, el tuning y la paleta. **Tunear aca primero.**

## La fisica (torque + deslizamiento)

El acople vive **solo en `Game.updatePlaying`**: `Plank` y `Monkey` tienen cada uno su mitad y
**ninguno importa al otro**. La posicion del mono es el brazo de palanca del tablon, y el
angulo del tablon es lo que hace deslizar al mono. Ese lazo cerrado es el juego entero.

Tablon (`Plank.update`), con `m*g` y el momento de inercia metidos en las ganancias:

```
monkeyTorque = TORQUE_GAIN * d * cos(theta)              // tau = m*g*d*cos(theta)
plankTorque  = PLANK_TORQUE_GAIN * com * cos(theta)      // el peso propio del tablon
accel = monkeyTorque + plankTorque + windAccel + jitter - ANG_DAMPING * angleVel
```

**El tablon tiene masa propia, y es lo que hace que romperse importe.** `com` es
`(halfRight - halfLeft) / 2`: cero mientras el tablon es simetrico, y en cuanto un extremo se
parte el punto medio de la barra que queda se corre al lado largo, asi que el tablon **se
inclina solo hacia ahi**. Sin esto una rotura solo sacaba piso y no cambiaba el equilibrio —
que es exactamente lo que se sentia mal. `PLANK_TORQUE_GAIN` es a proposito menor que
`TORQUE_GAIN`: con la asimetria maxima (un lado en `PLANK_HALF_MIN` y el otro entero) el sesgo
del tablon es ~0.46 rad/s2 contra los ~0.5 rad/s2 que puede hacer el mono parado en la punta
corta, o sea que sigue siendo peleable, apenas.

Mono (`Monkey.update`):

```
slide    = SLIDE_GRAVITY * sin(theta)          // lo arrastra al lado bajo
traccion = max(WALK_TRACTION_MIN, cos(theta))  // en pendiente casi no hay de que empujar
vel     += (slide + input * WALK_ACCEL * traccion) * dt
vel     -= WALK_FRICTION * vel * dt
```

**No hay fuerza de restitucion, y es a proposito.** Un tablon apoyado en una cuna esta en
equilibrio **neutro**: si lo soltas a 10 grados se queda a 10 grados. Volver a la horizontal
significa **caminar al lado alto**, que es justo la decision que el juego quiere cobrar. Meter
un resorte que lo enderece solo mataria la tension.

La aceleracion exponencial que pide el brief **emerge del lazo**, no de una formula especial:
deslizarse a la derecha alarga el brazo de palanca -> mas torque -> mas angulo -> mas
deslizamiento. Pasados los ~30 grados la caida de traccion (`cos(theta)`) hace que subir sea
una carrera perdida y no un paseo. `ANG_JITTER` es ruido angular continuo: sin el, un mono
parado exacto sobre el pivote queda en un equilibrio muerto para siempre (ver "Salas").

Dos formas de perder, las dos en `updatePlaying`: `!plank.supports(...)` (se paso del borde
del tablon recortado) o `|angle| >= FAIL_ANGLE` (~54 grados, ya no hay vuelta).

## El recorte del tablon

Por **etapas**, nunca lineal (`Plank.stepTrim`): el primer pedazo salta a los `TRIM_FIRST` (8s)
y despues cada `trimGap`, que se acorta `TRIM_INTERVAL_DECAY` por rotura hasta el piso
`TRIM_INTERVAL_MIN`. El lado es **al azar** (no alternado): la asimetria es el punto, porque
resetea de golpe la referencia visual de donde estan los bordes. Si un lado ya llego a
`PLANK_HALF_MIN` se recorta el otro. Cada rotura dispara astillas, `playCrack()` y shake.

Una rotura pega **dos veces**: el `TRIM_KICK` (impulso de 0.45 rad/s a `angleVel` hacia el lado
que queda, el tiron que hay que contestar en el momento) y el corrimiento permanente del centro
de masa de arriba (el sesgo lento con el que hay que convivir el resto de la partida). El
impulso solo se siente y se olvida; el sesgo solo no se siente. Van juntos.

Los medios anchos se miden **desde el pivote**, asi que los nudos del bambu (`Renderer.drawPlank`,
cada 64px desde el origen) se quedan quietos mientras los extremos se van — el tablon se acorta,
no se re-dibuja corrido.

## La fatiga del bambu (lo que sostiene la dificultad)

**Es la mecanica mas importante del juego y existe para matar una estrategia dominante.**
Sin ella el juego se resolvia parandose en el pivote: en `d = 0` el mono genera **torque
cero**, y como el tablon se recorta desde los extremos hacia adentro, el centro es el ultimo
lugar en desaparecer (y con `PLANK_HALF_MIN` 46 contra pies de 15, nunca desaparece del todo).
Un jugador bueno estacionaba en el centro, corregia el viento con microajustes y el juego no
tenia con que amenazarlo. Subir el viento o el ritmo de las roturas solo mordia los bordes del
problema.

`Plank.stepStress` divide el tablon en segmentos de `STRESS_SEGMENT` (34px, mas o menos una
pisada), indexados desde un **origen fijo** para que no se corran cuando los extremos se
rompen. El segmento que carga el peso acumula fatiga a `STRESS_BUILD` (~3.3s de estar quieto
para partirse) y los demas la sueltan. Al llegar a 1 el tablon **se parte ahi** y todo lo que
queda por fuera se cae, con el mismo `TRIM_KICK` que una rotura programada. Parado en el
pivote eso significa partir la tabla al medio y perder un lado entero: caida instantanea.

Dos detalles que **no** son cosmeticos:

- **El alivio es continuo en la distancia, no por segmento.** Un segmento que el mono a medias
  dejo se descarga a media velocidad (`1 - weight`, con `weight` una carpa de ancho
  `STRESS_SEGMENT`). La primera version descargaba solo el segmento activo, y entonces
  moverse *dentro* de un segmento no aliviaba nada: la tabla se rajaba abajo de un jugador que
  se estaba moviendo a la vista. Era ilegible e injusto.
- **La carga, en cambio, va entera al segmento mas cercano.** Si se repartiera con la misma
  carpa, pararse justo en el borde entre dos segmentos partiria la carga al medio y duplicaria
  la supervivencia — una costura que los jugadores encuentran.

El aviso es la **rajadura dibujada** (`Renderer.drawCracks`) mas el crujido (`playCreak` al
cruzar `STRESS_WARN`, a mitad de camino). El halo chamuscado es a proposito **mas ancho que la
parada del mono**, porque la grieta crece justo abajo de sus pies y si no el propio mono tapa
la unica advertencia que hay.

## El viento

Ciclo completo de ~3.6 a 5.6 segundos (`GUST_INTERVAL_MIN/MAX` 2-4s de espera mas 1.1s de
aviso mas 0.55s de empujon), con la primera a los `GUST_FIRST` (4s). Es **deliberadamente
frenetico**: casi no hay ventana muerta entre una rafaga y el aviso de la siguiente.

**La rafaga esta topeada contra la autoridad del jugador (`GUST_AUTHORITY`), y no es
opcional.** La fuerza sube con el tiempo transcurrido, pero la capacidad de respuesta del
jugador **baja** con el tablon: el maximo contra-torque que puede generar es
`TORQUE_GAIN * lever`, donde `lever` es lo que queda del lado en el que tiene que pararse.
Sin tope esas dos curvas se cruzan y a partir de ahi la rafaga da vuelta la tabla juegue como
juegue. Medido con `sim.cjs` (un controlador PD con 0.25s de reaccion, mejor que cualquier
humano): con `halfLeft` 46 y t=45s el pico era **54 grados contra un `FAIL_ANGLE` de 54** —
muerte inevitable, y a t=30s pasaba a 49, o sea al filo.

El tope es `strength <= GUST_AUTHORITY * TORQUE_GAIN * lever * GUST_PUSH_TIME`. A 5x recien
muerde por debajo de ~69px de medio ancho, asi que **el early y el mid game quedan intactos** y
funciona como valvula de seguridad de late game: los picos tardios bajan de 49-54 grados a
33-40. Sigue asustando, deja de ser una moneda al aire. El `lever` se lee **en el momento en
que arranca el aviso**, con los anchos de ese instante: pasarle anchos viejos vuelve a
destopear la rafaga.

Toda rafaga se **telegrafia**: `GUST_WARNING` (1.1s) de hojas cruzando la pantalla y el cartel
"VIENTO" con chevrones apuntando a donde va a empujar, **antes** de que algo empuje. Asi una
muerte se lee como "me avisaron y calcule mal" y no como ruido. El empujon se reparte sobre
`GUST_PUSH_TIME` con forma `2k` (integra exactamente `strength`) en vez de ser un impulso de un
frame: un pico no se puede telegrafiar y ademas un limite de frame podria comerselo. La
magnitud crece con el tiempo sobrevivido (`GUST_BASE + elapsed*GUST_RAMP`, tope `GUST_MAX`).

## El mono: cuatro caras, no una cara con variantes

`Renderer.drawFace` dibuja **cuatro juegos completos** de ojos/cejas/boca (`idle`, `walk`,
`panic`, `fall`), misma escuela que las reacciones de Bomba Palabra: la cara es la senal mas
fuerte que tiene el juego, asi que cada estado se dibuja entero en vez de parchear rasgos. El
`panic` entra a `PANIC_ANGLE` (25 grados) y el sudor **antes**, a `DANGER_ANGLE` (~17 grados)
— el aviso sale antes de que el jugador entienda que esta en problemas.

Todo el mono se dibuja con los pies en el origen y de pie hacia -y, posado solo desde `state` +
`phase`. Reemplazarlo por un spritesheet es cambiar ese unico metodo sin tocar la fisica.

## Enter-to-start countdown

Patron compartido obligatorio: desde start/game-over, Enter (o tocar el overlay) entra al
estado `countdown` que muestra 3 / 2 / 1 / YA (`COUNTDOWN_LABELS`, `COUNTDOWN_STEP` c/u) con el
tick de 750 Hz por etiqueta, y recien ahi arranca la partida.

## Salas (multiplayer)

Wiring estandar: `initRoomMode("macaco-tilt", { getScore, onStart })`. `getScore` devuelve
`elapsed` mientras se juega (parcial por timeout) y `score` despues de caer. En game over, con
sala se hace `reportScore`; si no, `showRanking`. Con `?room=` el reintento queda bloqueado
(una corrida por ronda). Scoring no-default (`direction: "higher"`, formato `s`), declarado en
`meta.ts`.

**No declara `roomTimeLimitSec`, y esta medido.** La pregunta del `CLAUDE.md` raiz es "sin
tocar nada, ¿la corrida llega sola a game over?". Se corrio en Playwright sin tocar una sola
tecla: termino sola entre los **3.3s y los 6.3s** (era 8.13s antes de la fatiga y 11.77s antes
de subir el viento). Ahora hay **dos** garantias independientes, cualquiera alcanza: la fatiga
parte el tablon abajo del que no se mueve en ~3.3s, y aparte `ANG_JITTER` + las rafagas que
arrancan a `GUST_FIRST` (4s) inclinan el tablon hasta que el mono desliza. Un jugador AFK no
puede colgar la ronda. Si alguna vez se saca la fatiga **y** el jitter, hay que volver a medir
esto o declarar el limite.

## Gotchas

- **No hay freno de borde, y se saco a proposito. No lo vuelvas a agregar.** Hubo uno que
  clampeaba la caminata en el labio del tablon. Se quito por dos razones: (1) era **redundante**
  — existia para tapar que las rafagas obligaban a llegar a la punta para contestarlas, y eso lo
  arregla `GUST_AUTHORITY` en su origen; y (2) era un asistente **invisible**, sin nada que le
  dijera al jugador por que habia dejado de caminar, y con el tablon corto del late game estaba
  ablandando en silencio justo la parte que tiene que apretar. Comprometerse a un contrapeso
  grande **tiene que** poder salir mal. Si alguna vez se quiere suavizar esto, que sea con
  feedback visible (el mono tambaleandose en el borde), nunca con un clamp mudo.
- **Sostener una direccion para siempre es fatal por diseno, y eso NO es un bug.** Caminar
  hasta la punta genera tu propio torque, inclina la tabla hacia vos y te terminas deslizando
  de tu propio lado. El sim lo confirma en todos los anchos. Lo que si era un bug era tener que
  llegar a la punta para contestar una rafaga; con `GUST_AUTHORITY` alcanza con una correccion
  moderada y el rebote deja de existir.

- **La roca del pivote se dibuja en espacio de mundo (`Renderer.drawLedge`), no horneada en la
  capa media de `Jungle`.** Estuvo horneada ahi y era un bug visible: esa capa se mueve contra
  la inclinacion del tablon (`SWAY_MID`), asi que la roca se deslizaba y dejaba a la cuna
  flotando justo cuando el angulo era mas dramatico.
- **No hay indicador de estabilidad, y se saco a proposito.** Hubo una plomada verde/rojo
  colgando del pivote. Se quito por pedido: la inclinacion del tablon contra la horizontal de
  la pantalla ya es el indicador, y la cara del mono la repite en emocion. Si se vuelve a
  agregar algo asi, que no viva en el centro de la pantalla.
- El paralaje **no scrollea, oscila**: la escena es un lugar fijo (una repisa sobre un
  barranco), asi que cada capa se desplaza contra la inclinacion del tablon por un factor
  proporcional a que tan cerca lee, mas una deriva lenta. No convertirlo en scroll infinito.
- `MAX_DT` (0.05) recorta el delta para que volver de una pestana en segundo plano no teletransporte
  la fisica y regale una caida injusta.
- El `InputController` **no** maneja Enter/Espacio: si lo hiciera, un toque en pantalla durante
  la partida reiniciaria en vez de caminar. El activate vive en el overlay del `Hud`.
- `window.blur` limpia las teclas mantenidas (`input.clear`), o alt-tabbear con una flecha
  apretada deja al mono caminando solo.

## Posibles mejoras

El mono y el tablon son formas compuestas procedurales (cero assets). Un spritesheet pintado
podria reemplazar `Renderer.drawMonkey` manteniendo la firma `(state, phase, facing)` para no
tocar nada mas. La cuna tambien podria ganar un pivote que rechine visualmente al inclinarse.
