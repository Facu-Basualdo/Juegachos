# Prisma (color-switch)

Hypercasual estilo "Color Switch": una bola sube por impulsos (tap) contra la
gravedad y cruza anillos giratorios divididos en 4 arcos de color. La bola solo
puede tocar el arco de **su color actual**; un roce de otro color termina la
partida. Entre anillos hay cambiadores que le dan un color nuevo. Puntaje = anillos
cruzados. `<canvas>` 2D, sin Three.js. Es de la familia arcade-neón de Número
Fugaz y Constelación, con identidad propia (ver `DESIGN.md`).

## Módulos

- `main.ts` — monta `Game` en `#app`.
- `game/Game.ts` — canvas, escalado letterbox (caja fija `VIEW_W`×`VIEW_H`),
  máquina de estados `ready → countdown → playing → dead`, el loop `rAF`, física
  de la bola, generación/reciclado del mundo (anillos + cambiadores), colisión por
  color, cámara, dibujo y salas.
- `game/Hud.ts` — overlay DOM: score en vivo, pantallas de inicio / fin (título
  con wordmark espectral) + `LeaderboardPanel`, y countdown.
- `game/InputController.ts` — teclado / pointer → un solo `onTap` (impulso).
- `game/SoundEffects.ts` — efectos sintetizados (Web Audio, sin assets).
- `game/constants.ts` — tuning: `GRAVITY`, `JUMP_VY`, radios de anillo,
  `RING_SPACING`, velocidad de rotación, los 4 `COLORS`, countdown, `BEST_KEY`.
- `style.css` — la piel "espectro neón" (ver `DESIGN.md`).

## Cómo funciona

- **Caja fija + letterbox** (igual que flappy-bird): todo se autora en
  `VIEW_W`×`VIEW_H` (480×780) y `render()` aplica `scale`+`translate` (con `dpr`)
  para encajarla en la ventana.
- **1D**: la bola tiene X fijo (centro); solo se mueve en Y. Todo el desafío es de
  **timing** (cronometrar el ascenso para cruzar cuando tu color coincide en el
  punto de contacto del anillo, que rota).
- **Cámara**: `camY` sigue a la bola hacia arriba (solo sube en el mundo). Si la
  bola cae por debajo del borde inferior → muerte.
- **Figuras (`SHAPES`, 10)**: cada una tiene N **regiones de color** que siempre
  incluyen los 4 colores (`makeColors`), así el color de la bola nunca falta. Dos
  familias: **círculo** (annulus con N arcos: N = 4, 6, 8, 12) y **polígono regular**
  (N lados que giran: cuadrado 4, pentágono 5, hexágono 6, heptágono 7, octágono 8,
  nonágono 9). Más segmentos = arcos/lados más finos = timing más preciso.
- **Hueco interior consistente**: TODAS las figuras comparten la misma "apotema"
  (`POLY_APOTHEM` = línea central de la banda), así el **hueco interior usable**
  (`RING_INNER`) es igual de holgado en cualquier figura — antes el cuadrado tenía
  el hueco más chico y "estar adentro" era desparejo. El circunradio del polígono
  se deriva: `R = POLY_APOTHEM / cos(pi/n)` (`polyR`), y sus esquinas sobresalen más
  para N chico, pero el hueco central no cambia.
- **Colisión (`handleRings` + `borderAt`)**: como la bola cruza por el eje vertical
  del centro, el contacto es siempre arriba o abajo (`phi = ±90°` según `ballY` vs
  `ring.y`). `borderAt` devuelve, para esa dirección y **cualquier N**, la distancia
  al borde, el medio-grosor de la banda y el color de esa región — unificado para
  círculo (radio constante) y polígono (radio = apotema / cos del ángulo al lado,
  según la rotación). Si el color no coincide con `ballColor` → muere. Puntaje al
  quedar por encima de la figura (`outerRadius`).
- **Dificultad progresiva** (`speedMul` + `spacingFor` + `minScore`), satura en
  `DIFF_SATURATE`: la **rotación se acelera** (hasta `SPEED_MUL_MAX`), la
  **separación se achica** (`RING_SPACING` → `RING_SPACING_MIN`, más apretado y
  rápido) y las figuras **más difíciles se van desbloqueando** por `minScore` (más
  lados/arcos = ventana de cruce más fina). Al arrancar solo salen círculo-4 y
  cuadrado; la variedad entra rápido.
- **Flujo de color (clave del ritmo)**: es **determinístico** para que no haya
  esperas largas. Al generar, cada cambiador fija el color de la **próxima** figura
  (`nextColor`), y esa figura se arma con **varios segmentos** de ese color
  (`makeColorsWithMatches`, cantidad aleatoria >= 2, dejando al menos uno de otro
  color). Así la bola **llega ya con el color correcto** y tiene **varias ventanas
  por vuelta** → cruza rápido, casi a la primera, sin esperar una vuelta entera.
- **Cambiadores (`handleSwitches`)**: al tocar uno, `ballColor = switcher.color`
  (el color pre-determinado que coincide con la figura siguiente), con flash.
- **`dt` clampeado** (`MAX_DT`) para que un hitch no atraviese un anillo.

## Estados

`ready` → `countdown` (3/2/1/YA) → `playing` → `dead`. Desde `ready`/`dead`, tap
(espacio / clic / toque) o Enter arrancan; en `dead` hay un pequeño delay
(`deadFor`) antes de poder reintentar. En sala el reinicio está bloqueado.

## Salas (multijugador)

`initRoomMode("color-switch", { getScore, onStart })`. `getScore` = anillos
cruzados hasta ahora (parcial por timeout). Con `?room=`, `die()` reporta a la sala
en vez del ranking global; `onStart` dispara el countdown. "Cada uno en su
pantalla".

## Portada

`public/covers/color-switch.jpg` (1:1, estética "espectro neón"). El prompt está
en `public/covers/README.md`.
