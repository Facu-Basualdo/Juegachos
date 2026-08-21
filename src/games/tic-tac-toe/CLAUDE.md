# Ta-Te-Ti (tic-tac-toe)

Ta-Te-Ti (Tres en raya) neon **sin empates**. Regla que elimina el empate: cada
jugador mantiene como maximo 3 fichas; al colocar la 4ta se elimina primero la
1ra que puso, asi el tablero nunca se llena (siempre queda al menos una casilla
libre) y la partida sigue hasta que alguien arma una linea de 3. El tope de
fichas es la constante `MAX_PIECES` en `logic.ts`. Dos modos sobre el mismo
tablero 3x3:

- **Solo (sin `?room=`)**: contra una **IA dificil**. El humano es X; la IA es O
  y abre cada partida (juega primero). Es un modo de **racha de supervivencia**: cada
  victoria suma 1 y arranca otra partida; la primera derrota termina la corrida
  y la racha lograda es el puntaje. El ranking global es esa mejor racha.
- **Sala (`?room=`)**: **PvP** por turnos sobre tablero compartido (como Memoria
  y Conecta 4). A diferencia de Memoria, **cada ronda empareja a TODOS los
  jugadores en duelos 1v1** (no solo a los dos primeros): pares consecutivos por
  orden de llegada (0-1, 2-3, ...), un tablero por pareja, todos jugando al mismo
  tiempo. Si la cantidad de jugadores es **impar**, el ultimo se queda sin rival
  humano y **juega contra la IA** en su propio dispositivo (tablero local, no
  compartido) — su resultado igual puntua en la sala. Como no hay empate, siempre
  sale un ganador: gana 1, pierde 0 (esos puntajes quedan en la sala, no van al
  ranking global). El emparejado lo calcula cada cliente por su cuenta desde
  `room.players()` (orden `joined_at`, deterministico), sin guardarlo: ver
  `game/pairing.ts`.

## Module layout

- `main.ts` — entry point, monta `Game` en `#app`.
- `game/logic.ts` — **logica pura y serializable** de la variante ciclica (sin
  DOM ni red): `TttState`, `MAX_PIECES` (tope de fichas = 3), `applyMove`
  (implementa el borrado de la ficha mas vieja al llegar al maximo + deteccion
  de linea), `legalMoves`, `pieceToRemove`
  (casilla por desaparecer, para atenuarla). Es el mismo estado que viaja a
  Postgres en modo sala; solo y sala comparten estas transiciones.
- `game/ai.ts` — IA del modo solo: negamax con poda alfa-beta (`DEPTH = 8`) sobre
  la variante ciclica, evaluada siempre desde la perspectiva de la IA. Como no
  hay empate el arbol se acota en profundidad y usa una heuristica de control de
  lineas en las hojas; el ajuste por profundidad hace que prefiera ganar cuanto
  antes y demorar las derrotas. Fuerte pero vencible con dobles amenazas (lo que
  mantiene viable la racha).
- `game/pairing.ts` — **logica pura de emparejado** del modo sala: `pairFor`
  (a que tablero/pareja voy y si me toca la IA), `humanBoards` (todos los
  tableros PvP de la ronda, para que el host los administre) y `AI_NAME`. Todos
  los clientes calculan el mismo reparto desde `room.players()`.
- `game/sharedMatch.ts` — controlador de UN tablero de sala (ver abajo).
  Parametrizado por `boardNo` (fila de `room_match_state`) + `seats` (la pareja)
  + `passive` (el host administra tableros que no juega: los crea y les destraba
  el AFK sin tocar HUD/sonido/puntaje) + `spectate` (mira un tablero ajeno).
- `game/Game.ts` — estados `ready | countdown | playing | over`, countdown
  3/2/1/YA compartido, modo solo (turnos humano/IA con `busy` que bloquea el
  input mientras la IA piensa o entre partidas de la racha), y delega el modo
  sala en `SharedMatch` al terminar el countdown. Un unico handler de casilla
  (`handleCell`) enruta a la logica solo o a `SharedMatch.handleCell`.
- `game/Hud.ts` — DOM: tablero 3x3 con marcas SVG neon (X cian, O magenta),
  overlay, countdown, franja superior y marcador de jugadores de la sala. La
  ficha por desaparecer se atenua (`is-removable`) y la linea ganadora brilla
  (`is-win`).
- `game/constants.ts`, `game/SoundEffects.ts` (Web Audio sintetizado: colocar,
  eliminar ficha vieja, ganar, perder, countdown tick).

## Modo sala: como sincroniza

Estado durable en `public.room_match_state` (una fila jsonb por
**sala+ronda+tablero**: la columna `board` distingue los tableros simultaneos de
la ronda, uno por pareja; ver `supabase/rooms.sql` y
`src/shared/room/matchState.ts`, cuyas funciones toman un `board` opcional que
por defecto es 0 para los juegos de un solo tablero), con el patron estandar de
salas: **escribir -> ping broadcast "sync" -> los demas refetchean**, mas poll de
respaldo. Por turnos, la latencia por jugada no se nota.

- El estado guardado es `TttState` + `players` (los dos nicknames de X y O de esa
  pareja) + `seq` (correlativo de jugadas, para sonar cada movimiento remoto una
  vez).
- **Un unico UPDATE atomico por jugada** con version optimista; **local-first**
  para el jugador de turno (su ficha se ve al instante) y `forceRefresh` readopta
  la DB ante conflicto de version. **Todas** las llamadas a `matchState.ts` pasan
  el `boardNo` de la instancia: olvidarlo en el `updateMatchState` hace que las
  jugadas del board 1 se escriban contra el board 0 y la partida quede trabada
  (era el bug que tenia Conecta 4).
- **Emparejado**: al terminar el countdown, `Game.startRoomMatches()` calcula con
  `pairFor` mi tablero (mi pareja, o la IA si soy el jugador impar que sobra) y
  arranca un `SharedMatch` activo para el. Si me toca la IA, corro una partida
  **local** (la misma logica del modo solo, pero una sola partida) que reporta
  1/0 a la sala.
- **El host administra todos los tableros humanos**: crea la fila inicial de cada
  uno (con la pareja correcta) y les destraba el AFK. Corre su propio tablero
  activo mas un `SharedMatch` **pasivo** (`passive: true`) por cada otra pareja
  (`humanBoards`), que no toca HUD/sonido/puntaje. Los tableros vs IA no usan DB,
  asi que el host no los administra. Si el host **no aparece** (se desconecto
  antes de cargar la ronda), pasados `CREATE_FALLBACK_MS` (6s, de `matchState.ts`)
  cada jugador crea su propio tablero: sin eso la pareja se quedaba en "Esperando
  un rival..." para siempre.
- **Anti-AFK**: si el jugador de turno de un tablero no mueve en `AFK_MOVE_MS`
  (25 s), se juega una casilla al azar por el para que la partida (que no puede
  empatar) avance hasta un ganador. El deadline de ronda sigue siendo el corte
  duro.
- **El destrabe no es exclusivo del host**: tambien lo hace **el rival del jugador
  parado, en su propio tablero** (nunca su propio turno; para eso esta el host).
  Hacia falta porque los tableros ajenos los administra el host con instancias
  `passive` creadas al arrancar la ronda: un host que **toma el control a mitad de
  ronda** (migracion automatica de `roomMode`) no las tiene, asi que un host caido
  congelaba duelos en los que ni jugaba.
- **Al desconectado no se le espera la ventana AFK completa**: si el jugador de
  turno no esta en `room.presentPlayers()` se juega por el a los
  `AFK_ABSENT_MOVE_MS` (5 s) en vez de 25 s — no va a mover nunca. Con
  `presentPlayers()` vacia (canal aun sin sincronizar) se cae a la ventana normal.
- **Fin**: con `winner` definido, cada cliente reporta 1 (si gano) o 0 via
  `room.reportScore(...)`; los espectadores reportan 0. Recargar a mitad de
  partida reengancha (el estado vive en Postgres y `SharedMatch.boot()` lo
  readopta por `board`).
- **Espectar al terminar**: como los duelos duran distinto, cuando tu partida
  termina no ves la pantalla generica "esperando a los demas": pasas a **mirar
  otra partida en curso** de la ronda (con 4 jugadores, la otra; con mas, una al
  azar, y saltas a la siguiente cuando la mirada termina). Lo maneja
  `Game.beginSpectating()`/`spectateNext()`: crean un `SharedMatch` con
  `spectate: true` (renderiza el tablero ajeno en el HUD pero no juega, no
  reporta, no crea el tablero ni administra el AFK). RoomMode oculta su overlay
  de espera via el hook `onReportedWaiting` (devuelve true mientras haya algo que
  mirar; false cuando no queda ninguna y vuelve la espera de siempre). Al cambiar
  de tablero espectado se llama `SharedMatch.dispose()` para frenar los intervalos
  de la instancia anterior (el `onSync` no se puede desuscribir, asi que su
  `refresh` corta solo por el flag `disposed`).

Usa el contexto extendido de `RoomMode` (`code`, `me`, `round()`, `players()`,
`presentPlayers()`, `isHost()`, `ping()`, `onSync()`) igual que Memoria y
Conecta 4.

## Integraciones estandar

- Countdown 3/2/1/YA compartido (`COUNTDOWN_LABELS`/`COUNTDOWN_STEP`,
  `beginCountdown`, `Hud.showCountdown`, blip `playCountdownTick`).
- Ranking global: scoring por defecto (`direction: "higher"`, mayor racha =
  mejor), asi que `meta.ts` no exporta `scoring`. Solo el modo solo envia al
  ranking (`hud.showRanking("tic-tac-toe", streak)`); el modo sala nunca (sus
  1/0 quedan en la sala).
- Modo sala: `initRoomMode("tic-tac-toe", { getScore, onStart: beginCountdown })`;
  el reintento en game over se bloquea con `if (this.room) return`.

## Gotchas

- **La misma regla ciclica corre en solo y en sala**: es la identidad del juego
  (sin empates). En solo hace que la racha vs IA sea posible (un Ta-Te-Ti clasico
  vs IA perfecta siempre empataria); en sala garantiza un ganador.
- Solo el jugador de turno puede ganar en su jugada; `applyMove` primero borra la
  ficha vieja y despues coloca, luego chequea linea (el borrado nunca hace ganar
  al rival).
- La IA usa `DEPTH = 8`: si se sube mucho, el arbol sin terminales de empate se
  vuelve caro. Ajustar dificultad se hace con `DEPTH` y la heuristica en `ai.ts`.
- **`menuVisible` gatea el reinicio (no el estado).** Igual que Conecta 4: al perder
  la racha en solo, `onMatchLose` pone el estado en `over` pero el overlay de fin
  (con el ranking) se muestra `SOLO_RESULT_MS` despues. En esa ventana un Enter/tap
  reiniciaba la partida y `cancelPending()` cancelaba el `schedule` del overlay, asi
  que la corrida no mostraba puntaje ni reportaba al ranking. El flag `menuVisible`
  (true solo con el overlay en pantalla) lo bloquea; la continuacion de racha no se
  afecta porque ahi el estado sigue en `playing`.
