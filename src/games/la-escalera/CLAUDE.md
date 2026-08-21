# La Escalera

Juego de reflejos en **Three.js**. Un obrero **corre** escalera mecanica arriba
mientras la escalera baja hacia un pozo de puas. Un cartel colgado sobre el hueco
pide una flecha por vez (izquierda / arriba / derecha / abajo): acertarla lo empuja un
escalon hacia arriba, errarla o dejarla vencer lo hace resbalar, y el **arrastre
constante** de la cinta (que crece con el puntaje) lo lleva siempre hacia abajo.
Si llega al pie, cae al pozo y se termina. Puntaje = escalones ganados
(aciertos), mayor es mejor, board por defecto. Direccion de arte: `DESIGN.md`
("Descenso Pintado" — el manual de Pizza Express bajado al registro de Danger
Wings).

## Sistema de coordenadas

Toda la posicion del jugador es **un solo escalar `t` en [0, 1]** sobre la recta
de la rampa (`ramp.ts`): `0` = el pozo de puas, `1` = la boca de arriba.
`rampPoint(t)` lo convierte en un punto del mundo y `RAMP_NORMAL` / `SLOPE_ANGLE`
orientan lo que se apoya encima. Los escalones usan el mismo parametro (se les
resta velocidad y wrapean), asi que la cinta y el jugador viven en la misma
escala: si el arrastre es 0.1, el muñeco pierde un 10% de la rampa por segundo.

`MAX_HEIGHT` (0.8) es el tope de subida y **`CLIMB_SPAN` (0.5) es el tramo de la
escalera donde eso se dibuja**: la altura sigue yendo de 0 a 0.8 (la economia y
la curva de dificultad no cambian), pero el muñeco se posiciona en
`rampPoint(height * CLIMB_SPAN)`, o sea la mitad de abajo de la escalera. Es lo
que resuelve el solapamiento: con el muñeco al tamaño actual, arriba del todo su
cabeza quedaba **detras** del cartel (que esta mas cerca de la camara y lo tapa).
La mitad de arriba de la escalera queda de escenografia.

Si se cambia el tamaño del muñeco o del cartel hay que rehacer esta cuenta: lo
que no puede pasar es que la cabeza a `MAX_HEIGHT` quede, en pixeles, por encima
del borde inferior del cartel.

## Module layout

- `main.ts` — entry point, monta `Game` en `#app`.
- `game/Game.ts` — orquesta scene/camera/renderer/composer, la maquina de estados
  `ready -> countdown -> playing -> gameover`, la cola de flechas, el puntaje /
  racha, el arrastre, el tinte ambiente y la camara. Es el unico que toca reglas.
- `game/constants.ts` — **todo el tuning** (geometria de la rampa, economia de
  subida y resbalon, ritmo de las flechas, camara, paleta, ciclo de tinte).
  Tocar aca primero.
- `game/ramp.ts` — la rampa como recta: `rampPoint`, `RAMP_UP`, `RAMP_NORMAL`,
  `SLOPE_ANGLE`, `RAMP_LENGTH`. Modulo hoja, sin dependencias de juego.
- `game/toon.ts` — cel-shading (`toonMat` / `glowMat`). Copiado de Pizza Express
  por la regla de decoupling, con la **rampa de tonos sesgada al oscuro**
  (`pow(t, 1.7)`) en vez del sesgo claro del original.
- `game/Escalator.ts` — la maquina: **escalera mecanica de local** (huellas de
  chapa estriada con demarcacion amarilla al frente, contrahuella acanalada,
  faldon de inoxidable con cepillo de seguridad, balaustrada de vidrio, zocalo
  iluminado y pasamanos de goma que corre con la cinta), plataformas con peine
  amarillo, y el pozo de puas con su luz rubi (`pulsePit` late mas fuerte cuanto
  mas cerca estas). Las texturas (estriado, peine, bandas del pasamanos) se
  generan a canvas en el mismo archivo; los materiales se comparten entre los
  20+ escalones.
- `game/Climber.ts` — el obrero. Animacion 100% procedural, sin skinning ni
  assets: brazos y piernas tienen **codo y rodilla** (grupos anidados) porque un
  ciclo de carrera con miembros rigidos lee como marcha de juguete. Siempre esta
  **corriendo hacia arriba** (tambien en el menu y el countdown, donde corre en
  el lugar mas tranquilo): la escalera baja, asi que correr es su estado normal.
  Encima del ciclo se montan el envion del acierto y el manotazo del error.
  `kill()` arranca el tumbo y `consumeImpale()` avisa **una sola vez** el frame
  en que el cuerpo llega a las puas (es lo que dispara la sangre). El constructor
  toma un `ClimberSkin` opcional: es lo que le da a cada rival su color de
  mameluco.
- `game/PromptRack.ts` — el cartel: **una sola** pantalla con la flecha actual y
  luz propia. No hay barra de tiempo: el reloj lo cuenta la flecha misma, que se
  corre al rubi y late sobre el final (`setProgress` -> `urgency`). El acierto
  solo da un golpe de escala (sin destello); el error tiñe de rubi. El glifo se
  genera una vez como
  **matriz de puntos** (una flecha vectorial rasterizada a una grilla de 17x17 y
  redibujada como circulos) y se rota por direccion: una sola textura para las
  cuatro flechas.
- `game/Environment.ts` — escenografia del hueco: muros de reja, vigas (solo por
  **detras** del rack), cadenas, lamparas ambar parpadeantes y polvo que cae.
- `game/Particles.ts` — pool de chispas fire-and-forget (acierto, error, muerte).
- `game/Blood.ts` — la sangre, toda **en movimiento**: el estallido lanza gotas
  con gravedad que se **estiran** segun su velocidad (una gota rapida es un hilo,
  no una bolita) y al tocar el fondo se convierten en calcos; los hilos de los
  hierros **crecen hacia abajo** con su propio retardo en vez de aparecer
  pintados; el cuerpo sigue **goteando** 14 s (`oozeTime`) y el charco crece y se
  queda. Tope de `MAX_DECALS` calcos (los viejos se descartan). Cosmetico puro:
  no toca estado ni colision.
- `game/Rivals.ts` — **solo en sala**: un carril por rival al lado del tuyo, con
  su escalera, su pozo, su muñeco (mameluco de otro color) y su nombre en un
  sprite. La altura de cada uno llega por `RoomMode.broadcastLive` (~8/s) y se
  interpola, asi los paquetes espaciados se ven como movimiento continuo. Los
  escalones de cada carril van en `InstancedMesh` (3 draw calls por carril en vez
  de 66): con 7 rivales, escalones sueltos serian ~700 llamadas de dibujo.
- `game/InputController.ts` — cuatro flechas (teclado o WASD) + accion
  (Enter / Espacio) y la **cruceta tactil** que se monta sobre el canvas y el CSS
  muestra solo en punteros gruesos.
- `game/Hud.ts` — overlay DOM: puntaje (arriba a la **derecha**, el centro es del
  cartel), racha, countdown, flash, la **salpicadura de sangre
  sobre el lente** (`showBlood` / `clearBlood`, dibujada a canvas una sola vez y
  sesgada a los bordes para no tapar el pozo) y start / game-over con
  `LeaderboardPanel`.
- `game/SoundEffects.ts` — Web Audio sintetizado (tick de countdown, bota contra
  el hierro que sube de tono con la racha, campana de racha, chirrido de
  resbalon, aviso de vencida, muerte).

## Economia de la partida (todo en `constants.ts`)

| Evento | Efecto en `t` | Extra |
| --- | --- | --- |
| Acierto | `+CLIMB_GAIN` (0.055) | +1 punto, corta el tropiezo |
| Racha de `COMBO_STEP` (10) | `+COMBO_BOOST` (0.06) | campana + chispas doradas |
| Tecla equivocada | `-SLIP_WRONG` (0.1) | corta la racha, tropiezo, shake |
| Flecha vencida | `-SLIP_TIMEOUT` (0.075) | corta la racha, tropiezo |
| Arrastre | `-drift * dt` por segundo | `x STUMBLE_DRIFT_MULT` mientras dura el tropiezo |

`drift = min(DRIFT_MAX, DRIFT_BASE + score * DRIFT_PER_POINT)` y la ventana de
cada flecha es `beat = max(BEAT_MIN, BEAT_START - score * BEAT_PER_POINT)`.

**Como sube la dificultad, y donde esta el techo.** Son dos rampas distintas:

1. **La ventana se achica** de 1.5 s a 0.52 s, y toca el piso en el **escalon 82**
   (`(1.5-0.52)/0.012`). De ahi en mas ya no se achica mas: 0.52 s es
   deliberadamente jugable — un tiempo de reaccion de 4 opciones ronda los
   0.4-0.5 s, asi que la ventana aprieta pero no es el muro.
2. **El arrastre crece** sin techo practico (satura recien en el escalon 247).
   Como la flecha siguiente sale **apenas acertas** (no espera a que venza la
   ventana), lo que importa es tu tiempo de reaccion `R`: cada acierto te da
   0.055 y te cuesta `drift * R`. El equilibrio esta donde `0.055 / R = drift`:

| Reaccion | Equilibrio | Escalones (0% error) | Con 5% error | Con 15% error |
| --- | --- | --- | --- | --- |
| 0.25 s | ~175 | 277 | 188 | 94 |
| 0.35 s | ~117 | 197 | 144 | 75 |
| 0.45 s | ~86 | 155 | 113 | 60 |
| 0.55 s | ~65 | 80 | 79 | 55 |

(Simulacion con estas mismas constantes, 400 partidas por perfil.) **Ninguna
combinacion sobrevive**: pasado su equilibrio, cada acierto rinde menos de lo que
cuesta y la caida es cuestion de tiempo. Las partidas duran **30-70 s**, que es
el formato corto que pide el repo. El techo real ronda los **80-150 escalones**
para alguien bueno y ~280 para un limite teorico de 0.25 s sin errores.

Para mover el techo, la perilla es `DRIFT_PER_POINT` (bajarlo alarga todo);
`BEAT_PER_POINT` y `BEAT_MIN` solo mueven cuando la ventana deja de apretar.

Apretar todo a lo loco **no** funciona: cada tecla equivocada cuesta casi el
doble que lo que da un acierto, asi que tres errores seguidos desde el arranque
ya te dejan al borde del pozo.

## Decisiones no obvias

**El rack cuelga sobre el hueco, no al fondo.** La primera version lo puso arriba
de la boca de la escalera (`z` bien negativo, como en la referencia): a 23
unidades de la camara la flecha quedaba del tamaño de una moneda y ademas
detras de una viga. Ahora cuelga a `SCREEN_Z = 2` (adelante, casi encima del
jugador) y se lleva el tercio superior del cuadro. Por eso tambien: las vigas de
`Environment` empiezan en `z <= -2` (una viga por delante tapaba justo la
flecha) y el puntaje del HUD se fue a la esquina superior derecha.

**La camara sigue al muñeco, pero acotado.** `updateCamera` mueve el objetivo
con la altura del jugador (`(y - 4.6) * 0.14`) **clampeado a ±0.55**. Con mas
recorrido, cuando el jugador se hundia cerca del pozo la camara bajaba lo
suficiente como para sacar del cuadro la fila de flechas que vienen — justo
cuando mas la necesita.

**Las puas son la unica excepcion PBR.** `LatheGeometry` (brida, cuello y
afilado concavo) con `MeshStandardMaterial` metalico medio, mientras toda la
escena es `MeshToonMaterial`. Sin env map, metalness alto las dejaba casi negras:
el punto dulce es metalness ~0.3 / roughness ~0.45, que da difuso frio mas un
especular corrido a lo largo del filo. Cada pua varia en alto, giro e
inclinacion sobre una geometria compartida. Documentado tambien en `DESIGN.md`.

**Una sola textura de flecha para las cuatro direcciones.** El glifo se dibuja
apuntando arriba y cada pantalla rota su plano (`DIR_ROTATION`). Como es matriz
de puntos, la rotacion de 90 grados no se nota "torcida" y no hay que generar ni
cargar cuatro imagenes.

**Sin fila de "las que vienen" y sin destello por acierto.** `PROMPT_VISIBLE` es
1: hubo una version con cuatro pantallas chicas arriba y se llevaban la mirada
justo cuando hay que reaccionar a la grande. Y el acierto ya no enciende la
pantalla en blanco (lavaba la penumbra varias veces por segundo): solo el error
tiñe de rubi. `setQueue` sigue siendo barato — cambia la rotacion del glifo, no
reconstruye nada.

**La cinta se ve mas rapida que el arrastre real.** `STEP_SCROLL_BASE +
drift * STEP_SCROLL_PER_DRIFT`: la maquina tiene que leerse fuerte aunque el
jugador este ganando terreno. Es feedback, no fisica.

**El cartel se apaga al morir.** Con la camara bajando al encuadre de muerte
(offset -1.3), el borde superior del cartel se salia del cuadro. Como al morir la
flecha ya no significa nada, `die()` lo esconde (`rack.object.visible = false`) y
`resetRun()` lo vuelve a prender; el corte cae justo con el flash rojo y el
sacudon, asi que no se ve el salto.

**Los rivales son cosmeticos y efimeros.** La posicion de los demas viaja por el
broadcast `live` del canal Realtime, no por la DB: no hay escrituras, no hay
reintentos y un paquete perdido se pierde. El puntaje sigue yendo por
`reportScore` como en cualquier otro juego de sala. `syncRivals()` compara una
firma de `players()` (que arranca vacio y puede cambiar en el lobby) y solo
rearma los carriles cuando cambia; `Environment.expand` corre los muros del hueco
y `fitCamera` calcula con el fov **horizontal** cuanto alejarse para que entren
todos los carriles (hasta 3-4 jugadores no hace falta alejarse nada).

**La muerte se mira: el game over llega tarde a proposito.** `die()` **no**
muestra el cartel; marca `overlayPending` y recien `GAMEOVER_DELAY` (1.6 s)
despues `finishDeath()` saca el overlay, el ranking y el reporte a la sala. En
ese hueco el cuerpo cae, se ensarta (`consumeImpale` -> `onImpale`) y revienta la
sangre. Ademas la camara pasa a **encuadre de muerte** (offset fijo -1.3 en vez
del seguimiento acotado) para que entre el pozo entero. El reinicio queda
bloqueado mientras `overlayPending` este en true.

**Enter-to-start countdown.** Desde start / game-over, la accion entra en
`countdown` 3/2/1/YA (`COUNTDOWN_LABELS`, `COUNTDOWN_STEP`) con el tick de 750 Hz;
durante el countdown el muñeco hace `idle` y el input de flechas se ignora.
Patron compartido obligatorio (ver `CLAUDE.md` raiz).

## Room mode (multiplayer)

Cableado estandar: el constructor llama `initRoomMode("la-escalera", { getScore:
() => this.score, onStart: () => this.beginCountdown() })`. Con `?room=` en la URL
el game-over reporta a la sala en vez del ranking global y el restart queda
bloqueado (una corrida por ronda). **Ademas se ve a los demas**: cada jugador
corre en su propia escalera al lado de la tuya, con su nombre encima (ver
`Rivals.ts` y el broadcast `live` en `src/shared/room/channel.ts`). `meta.ts` declara `roomTimeLimitSec: 120`
porque un jugador muy bueno puede estirar la corrida varios minutos antes de que
la rampa de dificultad lo alcance; al vencer el tope, cada uno reporta su parcial
(`getScore` = aciertos hasta ese momento).
