# Derrumbe (`derrumbe`)

TNT Run para salas, en 3D (Three.js, camara fija en tercera persona). Cuatro pisos de
bloques circulares apilados sobre la lava; cada bloque que pisas titila medio
segundo y se cae. No hay donde quedarse quieto: se corre, se saltan los agujeros y
se le rompe el piso a los demas. Gana el ultimo en pie. **Solo se juega en salas**
y **necesita el game server** (como Manchon, Basta o Impostor).

Estetica: ver [DESIGN.md](DESIGN.md) ("Mediodia Cuadrado"): homenaje voxel a
Minecraft, todo pintado por codigo (ningun asset, logo ni tipografia del original).

## Arquitectura: piso autoritativo, movimiento del cliente

El reparto es **distinto al de Manchon a proposito**:

- **Server** (`server/src/games/derrumbe.ts`, namespace `/derrumbe`, prefijo
  `dr:`): duenio del **piso** y del **orden de eliminacion**. Programa la caida de
  cada bloque pisado, pudre el piso a partir de `DECAY_START_MS`, corta en
  `MATCH_MAX_MS` y reenvia las posiciones a 20 Hz.
- **Cliente** (`game/Game.ts` + `Player.ts`): simula su propio muñeco, **predice**
  los bloques que pisa (titilan y caen sin esperar la red), declara sus pasos
  (`dr:step`) y su caida a la lava (`dr:dead`).
- **Supabase / RoomMode**: lobby, marcador, rejoin y el reporte del puntaje. El
  server no toca la DB.

**Por que no autoritativo por input como Manchon:** es un plataformero 3D con
saltos. Reconciliar la fisica vertical contra un server a ~150 ms se siente como
correr en barro, justo en el juego donde un salto al borde de un agujero decide la
partida. Y la mecanica ya absorbe la latencia: un bloque cae `FALL_DELAY_MS` (500)
despues de pisarlo, asi que el agujero que abre un rival llega con media latencia de
retraso y nadie lo nota. La contra es que la posicion es spoofeable; el server
valida lo unico que le arruinaria la partida a otro: un paso tiene que caer a
`STEP_TOLERANCE` de la ultima posicion declarada (no se rompen bloques a distancia).

**Por que no un relay puro como Neon Drift:** el piso es estado compartido en el
que los ocho escriben a la vez. Sin un duenio, el orden de llegada de los pasos
dejaria pantallas con agujeros distintos.

### El piso en el cliente (`Arena.ts`)

- Pasos propios: se predicen al instante (`trigger` con la mecha completa).
- Pasos ajenos: llegan en `dr:snap.f` y caen `FALL_DELAY_MS` despues de **llegar**.
  Todo es "caer en X ms desde que me entere", asi que no hace falta sincronizar
  relojes con el server.
- Una vez por segundo llega el tablero entero (`dr:snap.doom`, hex, un bit por
  celda pisada o caida) y `reconcile` cura en las dos direcciones: lo que el server
  da por pisado se prende (con media mecha), y lo que el cliente dio por caido y el
  server no se **restaura** — salvo que se haya predicho hace menos de
  `RESTORE_AFTER_MS`, porque ese paso puede estar todavia viajando.

### Fisica (`Player.ts`)

Apoyo por **huella**: el muñeco se sostiene si cualquier bloque toca el circulo de
`FOOT_RADIUS` de sus pies, y **todos** los bloques que toca se prenden. Es la regla
de TNT Run: se puede pararse en el filo de un agujero, pero el filo tambien se cae.
Choque lateral solo contra la losa del piso que el cuerpo esta atravesando al caer;
los pisos estan a `LAYER_GAP` (11) y no hay techo contra el que chocar. Coyote time
y buffer de salto para que el salto al borde perdone unos ms.

## Reglas de la partida (server)

| Constante | Valor | Nota |
| --- | --- | --- |
| `GRID` x `LAYERS` | 25 x 4 | circulo de radio `ARENA_RADIUS` 12.4, ~483 bloques por piso |
| `FALL_DELAY_MS` | 500 | la mecha: titila y se hunde, despues cae |
| `PREROLL_MS` | 3000 | el countdown 3/2/1/YA sale de aca |
| `START_GRACE_MS` | 8000 | espera al resto del roster antes de largar |
| `LAP_MS` | 3000 | vuelta de honor del ultimo en pie |
| `DECAY_START_MS` / `DECAY_BASE` / `DECAY_GROWTH` | 40 s / 3 por s / +3 cada 10 s | el piso se pudre solo |
| `MATCH_MAX_MS` | 120 000 | tope duro (red de seguridad) |
| `DISCONNECT_KILL_MS` | 10 000 | sin volver en este tiempo, cae con el tiempo de cuando se fue |

Las constantes de geometria y reglas estan **duplicadas** en `game/constants.ts`
por la regla de decoupling: si cambia el tuning, tocar los dos lados.

**Puntaje:** segundos aguantados (`direction: "higher"`, formato `N.N s`). Cuando
queda uno solo (con 2+ largando), el server abre la **vuelta de honor**: ese sigue
corriendo `LAP_MS` y su tiempo final es el de cierre, asi que siempre supera al
ultimo que cayo (sin esto empatarian). Con un solo jugador en la sala la partida
termina cuando se cae.

**Sale sola:** quieto, el bloque de abajo cae en medio segundo y se baja piso por
piso hasta la lava (~6 s). Encima el deterioro y el tope de 120 s cortan cualquier
partida, asi que `roomTimeLimitSec: 140` es solo la red por si el server se cae
**despues** de largar.

## Gotchas

- **El estado del server esta scopeado por RONDA** (`round` en el `dr:join`), igual
  que Manchon y Neon Drift: el `GameRoom` sobrevive entre rondas.
- **La posicion de cada asiento se siembra con la largada.** Sin eso cada jugador
  es invisible para los demas hasta su primer `dr:pos`, o sea todo el countdown.
- **El que no esta conectado al largar queda afuera con 0** (`launch`). Sin eso un
  jugador que nunca abrio la pagina seria "vivo" para siempre.
- **F5 en plena partida:** el `dr:init` devuelve al jugador a su ultima posicion y
  entra jugando, sin countdown. **Recargar no es un escudo:** al desconectarse el
  server le prende la mecha a los bloques bajo sus pies (`triggerUnder`), porque
  desconectado no declara pasos y volveria a un piso intacto. Medido: vuelve y cae
  por su propio agujero. Si la sala tiene **un solo** jugador, el F5 vacia el room
  del server y la partida arranca de nuevo (lo generico de `registerGame`).
- **`DISCONNECT_KILL_MS` era 6 s y no alcanzaba:** un headless lento tardaba mas en
  recargar + arrancar RoomMode + reconectar, y el server ya lo daba por caido.
- **La camara es FIJA y eso ata la altura de los pisos.** Siempre detras (+Z) y
  arriba del muñeco, nunca gira: W es siempre "arriba en la pantalla" y en el celu
  el joystick puede apoyarse en cualquier lado (lo pidio el programador; antes se
  giraba con Q/E, el mouse o el dedo derecho). Para ver alrededor sin girar, la
  camara va alta (`CAM_PITCH` ~54 grados, `CAM_DISTANCE` 10), a ~9.3 sobre los pies,
  y por eso `LAYER_GAP` es **11**: la camara tiene que quedar por debajo de la losa
  del piso de arriba (`LAYER_GAP - 1`). Con los 8 de antes quedaba adentro del piso
  de arriba y lo tenia delante de todo (la primera version lo tapaba volviendo
  translucidos los pisos de arriba; con esta cuenta ya no hace falta). **Si se toca
  la camara o `LAYER_GAP`, rehacer la cuenta** (esta en `constants.ts`). El
  espectador tambien es fijo: todo el piso desde el mismo lado.
- **`MAX_DT` es 0.1, no 1/20.** Con 1/20 la fisica se frenaba a los pocos FPS del
  headless (un jugador quieto tardaba 15 s en llegar a la lava en vez de ~6). La
  fisica igual se parte en pasos de `PHYSICS_STEP` (1/120).
- **La muerte se reporta al confirmarla el server** (su `times[seat]` es el que
  vale); si no confirma en `DEATH_CONFIRM_MS`, se reporta el tiempo local para no
  trabar la ronda. Caido, `onReportedWaiting` devuelve true y se sigue mirando la
  partida (camara orbital) en vez de la espera generica de la sala.
- **El HUD arranca en `top: 38px`** para no quedar debajo de la barra de la sala.
- **El `Hud` no monta el `LeaderboardPanel`:** en sala el puntaje nunca va al
  ranking global.

## Probar sin Supabase (`devRoom.ts`)

`/games/derrumbe/?dev=Ana&roster=Ana,Beto&code=TEST` en **dev** arma una sala
falsa contra el game server local, sin crear salas en la base real: una pestaña por
nickname, mismo `code` y `roster`. Arranca sola al segundo y el puntaje va a la
consola (y a `window.__derrumbeScore`). En el build `import.meta.env.DEV` es false
y queda eliminado. Levantar el server con `PORT=8799 npx tsx src/index.ts` (en
`server/`) y Vite con `VITE_GAME_SERVER_URL=http://localhost:8799`.

## Movil

`mobile: true`, verificado **en emulacion** (Playwright, iPhone 13, touch), no en un
telefono real: un dedo en cualquier lado es un joystick flotante (no hay input de
camara, que es fija) y el boton SALTAR (solo con `pointer: coarse`) va abajo a la
derecha, con `pointerdown`. En la compu el mouse no hace nada. Los listeners cuelgan
del container. No aplica el bug del "toque de arranque": la partida la larga
RoomMode (`onStart`). En vertical se abre el FOV 14 grados.
