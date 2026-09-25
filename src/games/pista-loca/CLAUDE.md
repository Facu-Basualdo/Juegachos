# Pista Loca (`pista-loca`)

Block Party para salas, en 3D (Three.js, camara fija como en Derrumbe). Una pista
de baile de 24x24 bloques de lana de colores colgada en la nada. Mientras suena la
musica se baila; cuando se corta, se pide un color y hay unos segundos para
pararse encima antes de que caiga todo lo demas. Cada ronda hay menos tiempo y el
dibujo es mas fino. Gana el ultimo en pie. **Solo se juega en salas** y **necesita
el game server**.

Estetica: ver [DESIGN.md](DESIGN.md) ("Baile de Bloques"): la hermana nocturna de
Derrumbe, voxel estilo Minecraft con luces de boliche. Todo por codigo.

## Arquitectura

- **Server** (`server/src/games/pistaloca.ts`, namespace `/pistaloca`, prefijo
  `pl:`): duenio de la pista y del ritmo. Cada ronda son cuatro pasos:
  `dance` (musica) -> `choose` (color pedido + su tiempo) -> `drop` (cae todo lo
  que no es de ese color) -> `reset` (se rearma con otro dibujo). El dibujo viaja en
  el estado como string de 576 digitos (un color por celda); el cliente no lo
  genera. Lleva el orden de eliminacion y reenvia las posiciones a 20 Hz.
- **Cliente** (`game/Game.ts`): simula su muñeco (la fisica de Derrumbe, con un solo
  piso), **hace caer su propia pista** cuando le llega el `drop` y **declara su
  caida** al vacio (`pl:dead`).

**Por que la caida la juzga el cliente:** el `choose` y el `drop` le llegan a cada
uno con la misma latencia, asi que el margen para llegar al color es identico para
todos. Juzgarlo en el server con la ultima posicion declarada castigaria al de peor
conexion (llega al color en su pantalla y el server lo ve afuera). Spoofeable, como
la posicion: mismo nivel de confianza que el repo ya acepta.

## Reglas y tuning (server)

| Que | Valor | Nota |
| --- | --- | --- |
| Musica (`danceMs`) | 3.2 s -> 1.8 s, +0-0.9 s al azar | se acorta con las rondas |
| Tiempo para llegar (`chooseMs`) | 5 s -> 1.3 s (-0.33 s por ronda) | lo que hace dificil el final |
| Colores en el dibujo (`colorsFor`) | 4 + ronda, hasta 10 | mas colores = menos lugares |
| `DROP_MS` / `RESET_MS` | 2000 / 600 | caida y rearmado |
| `MAX_ROUNDS` | 20 | tope (con un jugador o empates largos) |

Dibujos (`makePattern`): manchas grandes (Voronoi, las dos primeras rondas),
franjas diagonales, anillos y, desde la ronda 8, un mosaico de 2x2 al azar (el mas
dificil). El color pedido (`pickColor`) tiene que estar en al menos el 3% de la
pista.

**Puntaje:** rondas completas aguantadas (`higher`). El que cae en la ronda `r`
suma `r - 1`. La partida termina cuando queda uno solo (con 2+ largando), se caen
todos o se llega a 20 rondas. Empatan los que caen en la misma ronda.

**Sale sola:** quieto, a la primera ronda la pista cae salvo que estes de casualidad
sobre el color. `roomTimeLimitSec: 180` es la red por si el server se cae despues de
largar.

## Gotchas

- **El dibujo se arma una sola vez por ronda**, en el paso `reset` (el de la ronda 1
  al crear la partida). Una version lo regeneraba otra vez al arrancar la ronda y
  el dibujo que se bailaba no era el que se habia mostrado al rearmar.
- **Los pasos se aplican al CAMBIAR** (`stepKey` = ronda + paso), no con cada
  mensaje: el estado se re-difunde una vez por segundo y cada re-difusion no puede
  volver a arrancar la musica ni a tirar la pista.
- **La luz cambia de modo con la musica** (`Stage.setMode`): con musica, luz baja,
  bola girando, reflejos y haces; sin musica, todo eso se apaga y queda luz blanca
  plana para leer los colores. Los haces son tenues (opacidad 0.05) a proposito: si
  no, lavan los colores de la lana.
- **Los reflejos de la bola no flotan sobre los agujeros**: `Stage.update` recibe
  `solidAt` y esconde el que queda sobre una celda caida.
- **La musica se agenda con el reloj del AudioContext** (lookahead de 120 ms), no
  con los frames: el ritmo no puede trabarse si baja el framerate. Se acelera ronda
  a ronda (116 BPM + 2.5 por ronda, hasta 150).
- **La posicion de cada asiento se siembra con la largada**, como en Derrumbe.
- **El HUD arranca en `top: 38px`** por la barra de la sala, y el `Hud` no monta el
  `LeaderboardPanel` (en sala el puntaje nunca va al ranking global).

## Probar sin Supabase (`devRoom.ts`)

`/games/pista-loca/?dev=Ana&roster=Ana,Beto&code=TEST` en **dev**, una pestaña por
nickname con el mismo `code` y `roster`, contra un game server local. El puntaje
va a la consola y a `window.__pistaLocaScore`. En el build queda eliminado.

## Movil

`mobile: true`, verificado **en emulacion** (Playwright, iPhone 13, touch), no en un
telefono real: joystick flotante en cualquier lado y boton SALTAR (solo con
`pointer: coarse`). En vertical el FOV se abre 16 grados.
