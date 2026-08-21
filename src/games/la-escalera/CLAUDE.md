# La Escalera

Juego de reflejos en **Three.js**. Un obrero sube una escalera mecanica que baja
hacia un pozo de puas. Un rack de pantallas colgado sobre el hueco pide una
flecha por vez (izquierda / arriba / derecha / abajo): acertarla lo empuja un
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

`MAX_HEIGHT` (0.8) es el tope real de subida: la boca de arriba es escenografia y
el rack cuelga delante de ella, asi que dejar subir hasta 1 le tapaba la cabeza
al muñeco justo cuando mejor venias jugando. El medidor del HUD se normaliza
(`height / MAX_HEIGHT`) para que el tope se vea como barra llena.

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
- `game/Escalator.ts` — la maquina: cinta de escalones que baja y wrapea,
  faldones / balaustrada / pasamanos, chapas de peine y el pozo de puas con su
  luz rubi (`pulsePit` late mas fuerte cuanto mas cerca estas).
- `game/Climber.ts` — el obrero. Animacion 100% procedural (ciclo de piernas,
  envion por acierto, manotazo por error, tumbo al morir); sin skinning ni
  assets. `update(dt, t, effort)` lo coloca y anima; `idle(t, elapsed)` es la
  pose de menu / countdown.
- `game/PromptRack.ts` — el rack de pantallas: una grande con la flecha actual,
  cuatro chicas con las que vienen, barra de tiempo y luz propia que tiñe la boca
  segun acierto (hueso) o error (rubi). El glifo se genera una vez como
  **matriz de puntos** (una flecha vectorial rasterizada a una grilla de 17x17 y
  redibujada como circulos) y se rota por direccion: una sola textura para las
  cuatro flechas.
- `game/Environment.ts` — escenografia del hueco: muros de reja, vigas (solo por
  **detras** del rack), cadenas, lamparas ambar parpadeantes y polvo que cae.
- `game/Particles.ts` — pool de chispas fire-and-forget (acierto, error, muerte).
- `game/InputController.ts` — cuatro flechas (teclado o WASD) + accion
  (Enter / Espacio) y la **cruceta tactil** que se monta sobre el canvas y el CSS
  muestra solo en punteros gruesos.
- `game/Hud.ts` — overlay DOM: puntaje (arriba a la **derecha**, el centro es del
  rack), racha, medidor de altura, countdown, flash y start / game-over con
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
cada flecha es `beat = max(BEAT_MIN, BEAT_START - score * BEAT_PER_POINT)`. Las
dos rampas juntas son lo que **garantiza que la partida termine**: al principio
un jugador perfecto gana terreno (0.055 por acierto contra ~0.042 de arrastre por
ventana), pero pasados ~100 puntos el arrastre por ventana supera lo que da un
acierto y hasta el juego perfecto empieza a ceder. Bajar `DRIFT_PER_POINT` alarga
las partidas; subirlo las corta.

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

**Una sola textura de flecha para las cuatro direcciones.** El glifo se dibuja
apuntando arriba y cada pantalla rota su plano (`DIR_ROTATION`). Como es matriz
de puntos, la rotacion de 90 grados no se nota "torcida" y no hay que generar ni
cargar cuatro imagenes.

**`showVoting`-style idempotencia en el rack.** `PromptRack.setQueue` solo cambia
rotaciones y visibilidad (no reconstruye meshes) porque se llama en cada flecha;
`update` interpola el color de la actual entre el ambar base y el color del
flash, asi el feedback de acierto / error es la misma pantalla cambiando de
temperatura y no un cartel nuevo.

**La cinta se ve mas rapida que el arrastre real.** `STEP_SCROLL_BASE +
drift * STEP_SCROLL_PER_DRIFT`: la maquina tiene que leerse fuerte aunque el
jugador este ganando terreno. Es feedback, no fisica.

**Enter-to-start countdown.** Desde start / game-over, la accion entra en
`countdown` 3/2/1/YA (`COUNTDOWN_LABELS`, `COUNTDOWN_STEP`) con el tick de 750 Hz;
durante el countdown el muñeco hace `idle` y el input de flechas se ignora.
Patron compartido obligatorio (ver `CLAUDE.md` raiz).

## Room mode (multiplayer)

Cableado estandar: el constructor llama `initRoomMode("la-escalera", { getScore:
() => this.score, onStart: () => this.beginCountdown() })`. Con `?room=` en la URL
el game-over reporta a la sala en vez del ranking global y el restart queda
bloqueado (una corrida por ronda). `meta.ts` declara `roomTimeLimitSec: 120`
porque un jugador muy bueno puede estirar la corrida varios minutos antes de que
la rampa de dificultad lo alcance; al vencer el tope, cada uno reporta su parcial
(`getScore` = aciertos hasta ese momento).
