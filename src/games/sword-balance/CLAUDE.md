# Pulso de Acero (`sword-balance`)

Juego 3D de equilibrio: una mano sostiene una katana y hay que mantenerla parada
(péndulo invertido) el mayor tiempo posible antes de que se caiga. Se **mantiene
presionado** izquierda/derecha para inclinar y corregir. El puntaje es el **tiempo
sobrevivido en segundos** (más es mejor). Estética: dojo cinematográfico (ver
`DESIGN.md`).

## Módulos

- `main.ts` — entry point, monta `Game` en `#app`.
- `game/Game.ts` — escena/cámara/renderer (ACESFilmic + `EffectComposer` con bloom
  sutil + `RoomEnvironment` para reflejos del acero), luces (spotlight cálido +
  rim frío), la máquina de estados (`ready` / `countdown` / `playing` / `gameover`),
  la **física del péndulo invertido** y el loop de render. **Tuneá la física acá y en
  `constants.ts`.**
- `game/Sword.ts` — la mano + katana. El brazo/puño quedan fijos; el `blade` (grupo
  del arma) pivota en el mango (origen) por el ángulo de equilibrio. `setAngle(rad)`,
  `setLean(-1/0/1)` (muñeca), `update(dt)` suaviza la muñeca, `reset()`.
- `game/Dojo.ts` — piso oscuro con el pool de luz, aro tenue de tatami y motas de
  polvo que flotan en el haz. Solo atmósfera.
- `game/InputController.ts` — **hold** de izquierda/derecha (flechas/A-D o mitad
  izq/der de la pantalla). `lean()` devuelve -1 / 0 / +1.
- `game/Hud.ts` — overlay DOM: tiempo grande, mejor, el **medidor de inclinación**
  (`setTilt(-1..1)`, verde→rojo cerca del borde), start/game-over y countdown.
- `game/SoundEffects.ts` — Web Audio: tick de countdown, "shing" de acero al empezar,
  wobble metálico al acercarse al borde, clang pesado al caer.
- `game/constants.ts` — todos los valores de física y tuning.

## Física (péndulo invertido)

Ángulo `angle` en radianes (0 = vertical). Cada frame:
`accel = GRAVITY*sin(angle) + lean*CONTROL_TORQUE - DAMPING*angleVel + jitter`,
luego `angleVel += accel*dt; angle += angleVel*dt`. La gravedad **desestabiliza**
(equilibrio inestable), así que si te quedás quieto se cae; hay que corregir. Al
pasar `FAIL_ANGLE` el estado pasa a `gameover` y `stepFall` deja que la gravedad
tire la hoja hasta el piso (≈90°) → clang + shake + overlay. Las **ráfagas** (gusts)
son impulsos aleatorios a `angleVel` cuya magnitud **crece con el tiempo sobrevivido**
(`GUST_BASE + elapsed*GUST_RAMP`, cap `GUST_MAX`) — eso obliga a jugar activo y sube
la dificultad. Un `JITTER` continuo y un `START_KICK` inicial evitan el punto muerto
perfectamente estable.

Signo del control: `lean = -1` (izquierda) resta al ángulo (empuja la hoja a la
izquierda), `lean = +1` (derecha) suma. Regla intuitiva: "se cae para la derecha →
apretá izquierda".

## Enter-to-start countdown

Patrón compartido obligatorio: desde start/game-over, Enter (o tocar) entra al estado
`countdown` que muestra 3 / 2 / 1 / YA (`COUNTDOWN_LABELS`, `COUNTDOWN_STEP` c/u, en
`Game.ts`) con un tick de 750 Hz por número; recién ahí arranca la partida
(`playUnsheathe`). El medidor de inclinación se muestra durante el countdown.

## Salas (multiplayer)

Wiring estándar: `initRoomMode("sword-balance", { getScore, onStart })`. `getScore`
devuelve el tiempo en curso (parcial por timeout) o el final; `onStart` dispara
`beginCountdown()`. En game over, con sala se hace `reportScore`; si no, `showRanking`.
Con `?room=` el reintento queda bloqueado (una corrida por ronda). Scoring no-default
(`direction: "higher"`, formato `s`), declarado en `meta.ts`.

## Gotchas

- El **fall/land** ocurre en `stepFall` durante `gameover` (no en `fail`): el score y
  el mejor se congelan en `fail`, pero el overlay/ranking/clang salen recién cuando la
  hoja "aterriza" (~90°), para que se vea la caída antes del resultado.
- La física usa `MAX_DT` (0.05) para no pegar saltos al volver de una pestaña en
  segundo plano (un `dt` grande dispararía `angle` y sería una caída injusta).
- `getScore` para el parcial de sala lee `elapsed` mientras se juega y `score`
  después de caer, para no reportar 0 si el timeout llega justo al caer.

## Posibles mejoras

La mano y la katana son primitivas procedurales (cero assets). Una mano/hoja modelada
en Blender exportada a glTF podría reemplazar `Sword` manteniendo la interfaz
`setAngle` / `setLean` para no tocar `Game.ts`.
