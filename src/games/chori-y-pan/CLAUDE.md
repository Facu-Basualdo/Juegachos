# Chori y Pan

Plataformero cooperativo de dos al estilo del juego de los dos elementos (el del fuego y el agua): **el Chori** camina sobre las brasas y el agua lo empapa; **el Pan** nada en el agua y las brasas lo queman; al **chimichurri vencido** no lo toca nadie. Botones, palancas, compuertas, ascensores, cajas y ventiladores obligan a ayudarse. Cada uno junta sus gemas (ajíes el Chori, cubitos el Pan) y la sala se supera con los dos parados en su puerta. Una carrera son **3 salas** sorteadas de las **10** que hay. Estética: `DESIGN.md` ("Parrilla Sagrada", templo perdido).

Dos modos:

- **Local (la landing):** dos jugadores en la misma compu. Chori con las flechas, Pan con WASD. Puntaje = tiempo total menos `GEM_BONUS` (2 s) por gema; ranking `direction: "lower"`.
- **Salas:** parejas que corren al mismo tiempo; gana la primera que sale del templo. Necesita el game server (`/choripan`).

## Archivos

- `game/constants.ts` — todo el tuning (física, grilla, tiempos de muerte / sala superada, `GEM_BONUS`, `LEVELS_PER_RUN`).
- `game/Level.ts` — leyenda del mapa y `parseLevel`. `#` piedra, `/` `\` rampas, `r` brasas, `w` agua, `g` chimichurri, `C` / `P` aparición, `R` / `B` puertas, `a` ají, `o` cubito, `x` caja. Los mecanismos van aparte, como listas tipadas (`PlateDef`, `LeverDef`, `GateDef{dir,invert}`, `LiftDef{dx,dy}`, `FanDef{ch?}`).
- `game/levels.ts` — los 10 niveles: atrio, montacargas, cajas, ventilador, caminos, balanza, torre, relevo, puente, corazon. **Los ids están duplicados en `server/src/games/choripan.ts` (`LEVEL_IDS`)**: si se agrega o renombra un nivel, tocar los dos lados.
- `game/World.ts` — la física y los mecanismos (ver abajo). Emite eventos (`jump`, `land`, `die{cause}`, `gem{i}`, `push{box}`, `lever`, `plate`) que consumen el renderer, los sonidos y la red.
- `game/Renderer.ts` — canvas 2D. La capa estática (pared, glifos, piedras, rampas, piletas, enredaderas) se pinta **una vez por nivel** en un canvas cache; por cuadro solo van líquidos, antorchas, mecanismos, gemas, héroes y partículas.
- `game/Sprites.ts` — los dos personajes (ver DESIGN.md): Chori cápsula horizontal con extremidades de manguera, guantes y zapatillas; Pan baguette parada con palitos. Las extremidades negras llevan un halo (`rim`) para no perderse contra la pared oscura.
- `game/Input.ts` — modo local (flechas / WASD) y modo `single` (un héroe, cualquier tecla o los botones táctiles).
- `game/Hud.ts`, `game/SoundEffects.ts` — HUD de piedra y sonidos sintetizados.
- `game/Game.ts` — flujo local `ready -> countdown -> play -> dead -> clear -> over`, y en sala delega todo en `OnlineRace`.
- `game/OnlineRace.ts`, `game/ChoriSocket.ts` — la carrera en sala (ver "Salas").
- `game/devRoom.ts` — sala falsa para desarrollo (copiada de `minotauro`).

## Física (método aprobado)

Plataformero propio a **paso fijo** (`STEP` = 1/120 s) con colisión contra tiles, en unidades de celda, `y` hacia abajo, grilla de 40x24 (entra entera en pantalla, sin cámara).

- Colisión **por eje con barrido** (`moveX` / `moveY`) contra una lista de sólidos: tiles, la media celda de cada pileta, compuertas, ascensores y cajas. Escalón automático (`STEP_UP` 0.56) para subirse a bordes bajos y a los ascensores; las cajas no se suben solas.
- Rampas `/` y `\`: `snapSlope` pega al héroe a la superficie, **y nunca lo mete en un sólido** (era un bug: lo empujaba adentro de la piedra al pie de una rampa).
- Salto con coyote (`COYOTE` 0.09), buffer (`BUFFER` 0.12) y corte al soltar (`JUMP_CUT`): `JUMP_V` 19 con `GRAVITY` 58 da un ápice de ~3 celdas.
- Las piletas están hundidas: el héroe pisa a `POOL_FLOOR` y "toca" el líquido desde `POOL_SURFACE`.
- **Mecanismos:** un canal (letra `a`–`e`) está activo si cualquier botón de ese canal está pisado (por un héroe o una caja) o cualquier palanca de ese canal está prendida. Las palancas se mueven **solo** empujándolas desde el piso, y solo un héroe local (saltar por encima no las mueve, y el compañero remoto tampoco). Los ascensores llevan a quien va arriba y no aplastan; las compuertas no se cierran sobre un cuerpo; las cajas se empujan; los ventiladores empujan para arriba.

## Reglas de diseño de niveles (aprendidas a los golpes)

Cada una salió de un nivel que el verificador encontró imposible:

- Todo salto necesita **cielo abierto** encima (un borde arriba corta el salto contra el techo).
- Entre pisos, **2 celdas de diferencia como mucho**. Para subir más, escaleras en diagonal de repisas.
- Nada de decoración en el camino (una columna decorativa tapaba una aparición).
- Una palanca no puede estar donde un jugador tiene que volver a pasar (la daba vuelta sin querer).
- El ascensor tiene que llegar al ras del piso (si queda un hueco, no se puede subir).

**Verificación:** `npx tsx scripts/chori-y-pan/levels-check.ts` resuelve los 10 niveles con guiones (`solve.ts`) contra el mismo `World` del juego, y `npx tsx scripts/chori-y-pan/physics-check.ts` corre 13 chequeos de física. Correr los dos después de tocar un nivel o la física: un cambio de constantes puede volver imposible un salto.

## Salas

**Reparto:** el server mezcla a los jugadores con una semilla `code:round` y los arma de a dos (uno Chori, otro Pan). Si sobra uno (cantidad impar), ese es el **apostador**: tiene `BET_MS` (12 s) para elegir pareja (si no elige, se le sortea una), la mira en vivo durante la carrera y su puntaje es **el de esa pareja**, así que si gana, gana él también. Con un solo jugador en la sala, ese juega los dos héroes (`role: "both"`, como el modo local).

**Niveles:** se sortean 3 por ronda y **rotan por código de sala** (`usedByCode` en el server): no se repiten hasta haber pasado los 10.

**Red (método aprobado, el mismo híbrido que Derrumbe):**

- El **movimiento** lo simula cada cliente para su propio héroe; la posición viaja a 20/s (`cp:pos` -> `cp:peer`) solo al compañero y a quien apostó por esa pareja. El compañero se dibuja suavizado.
- Los **mecanismos** los arbitra el server: cada cliente declara qué canales pisan su héroe y las cajas que ve (`cp:press`) y qué palanca movió (`cp:lever`); el server manda la unión (`cp:mech`) y las dos pantallas abren la misma compuerta. Una caja es de quien la empujó último (`BOX_OWN_MS` 900 ms) y su posición viaja por `cp:box`.
- **Muertes:** `cp:die` -> el server reinicia la sala para la pareja (`cp:reset`, con antirrebote de 800 ms para que dos muertes juntas sean una). Las gemas de esa sala se devuelven.
- **Llegada:** cada uno avisa si está en su puerta (`cp:door`); con los dos adentro, el server pasa a la pareja a la sala siguiente (`cp:level`).
- La cuenta 3/2/1/YA se alinea a `state.raceStart` con el offset de reloj del server. Tope de la carrera: 300 s (`roomTimeLimitSec` 330 cubre la apuesta y la cuenta).

**Puntaje de sala:** `roomScore(time, level)` = el tiempo en ms (menos las gemas) si la pareja terminó; si no, `10.000.000 - salas × 1.000.000`, así una pareja que llegó más lejos queda adelante. El `format` del `meta.ts` lo muestra como `m:ss.s` o "N/3 salas". `roomRanked: false`: el puntaje de sala depende de la pareja que te tocó y no se compara con el ranking local.

Sin `VITE_GAME_SERVER_URL` la sala muestra "no disponible" (como el resto de los juegos que existen por el server); el modo local no lo necesita.

## Probarlo

- **Sala falsa:** `?dev=Ana&roster=Ana,Beto&code=X` en una pestaña por nickname (mismo `code` y `roster`). Los mensajes de la sala viajan por `BroadcastChannel`; el puntaje queda en `window.__choriPanScore`. Con 3 nombres en el roster, uno (sorteado por el server) queda de apostador. La carrera igual necesita el game server: la sala falsa reemplaza a Supabase, no al server.
- **Contra un server local:** `cd server && PORT=8812 npx tsx src/index.ts` y un Vite aparte con `VITE_GAME_SERVER_URL=http://localhost:8812 npx vite --port 5345`.
- Playwright: lanzar Chromium con `--use-angle=metal --enable-gpu --ignore-gpu-blocklist` en macOS; con SwiftShader el canvas va tan lento que los guiones fallan por tiempo.
