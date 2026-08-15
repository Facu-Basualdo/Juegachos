# Conecta 4 (connect-four)

Conecta 4 neon sobre un tablero de 7 columnas x 6 filas. Una jugada es elegir una
columna: la ficha "cae" hasta la casilla libre mas baja. Gana quien alinea 4
fichas propias en horizontal, vertical o diagonal. Si el tablero se llena sin
linea, es empate. Dos modos sobre el mismo tablero:

- **Solo (sin `?room=`)**: contra una **IA dificil**. El humano es el jugador 0
  (cian); la IA es el 1 (rosa) y abre cada partida (juega primero). Es un modo de
  **racha de supervivencia**: cada victoria suma 1 y arranca otra partida; la
  primera derrota termina la corrida y la racha lograda es el puntaje. Un
  **empate no rompe la racha** (se juega otra partida sin sumar). El ranking
  global es esa mejor racha.
- **Sala (`?room=`)**: **PvP** por turnos sobre tablero compartido (como Memoria
  y Ta-Te-Ti). A diferencia del resto, **cada ronda empareja a TODOS los
  jugadores en duelos 1v1** (no solo a los dos primeros): pares consecutivos por
  orden de llegada (0-1, 2-3, ...), un tablero por pareja. Si la cantidad de
  jugadores es **impar**, el ultimo se queda sin rival humano y **juega contra la
  IA** en su propio dispositivo (tablero local, no compartido) — su resultado
  igual puntua en la sala. Gana 1, pierde 0; el empate reparte 0 a ambos (esos
  puntajes quedan en la sala, no van al ranking global). El emparejado lo calcula
  cada cliente por su cuenta desde `room.players()` (orden `joined_at`,
  deterministico), sin guardarlo: ver `game/pairing.ts`.

## Module layout

- `main.ts` — entry point, monta `Game` en `#app`.
- `game/logic.ts` — **logica pura y serializable** (sin DOM ni red): `C4State`,
  `COLS`/`ROWS`/`SIZE`/`CONNECT`, `applyMove` (suelta en una columna + deteccion
  de linea de 4 desde la ultima ficha + empate por tablero lleno), `legalMoves`
  (columnas no llenas), `landingRow`. Es el mismo estado que viaja a Postgres en
  modo sala; solo y sala comparten estas transiciones.
- `game/ai.ts` — IA del modo solo: negamax con poda alfa-beta (`DEPTH = 6`) con
  la heuristica clasica de Conecta 4 en las hojas (puntua cada "ventana" de 4
  casillas segun fichas propias/libres, penaliza amenazas rivales, premia el
  control de la columna central). Explora del centro hacia afuera (`COL_ORDER`)
  para mejorar la poda. Fuerte pero vencible con amenazas dobles (lo que mantiene
  viable la racha). `WINDOWS` (todas las ventanas de 4) se precomputa una vez.
- `game/pairing.ts` — **logica pura de emparejado** del modo sala: `pairFor`
  (a que tablero/pareja voy y si me toca la IA), `humanBoards` (todos los
  tableros PvP de la ronda, para que el host los administre) y `AI_NAME`. Todos
  los clientes calculan el mismo reparto desde `room.players()`.
- `game/sharedMatch.ts` — controlador de UN tablero de sala (ver abajo).
  Parametrizado por `boardNo` (fila de `room_match_state`) + `seats` (la pareja)
  + `passive` (el host administra tableros que no juega: los crea y les destraba
  el AFK sin tocar HUD/sonido/puntaje).
- `game/Game.ts` — estados `ready | countdown | playing | over`, countdown
  3/2/1/YA compartido, modo solo (turnos humano/IA con `busy` que bloquea el
  input mientras la IA piensa o entre partidas), y delega el modo sala en
  `SharedMatch` al terminar el countdown. Un unico handler de columna
  (`handleColumn`) enruta a la logica solo o a `SharedMatch.handleColumn`.
- `game/Hud.ts` — DOM: tablero 7x6 (columnas clicables con 6 huecos cada una),
  fichas cian/rosa que caen animadas, **disco fantasma** translucido en la
  casilla donde caeria la ficha al pasar el mouse por una columna
  (`setPreviewColor` + `updateGhost`), overlay, countdown, franja superior y
  marcador de jugadores de la sala. La linea ganadora brilla (`is-win`).
- `game/constants.ts`, `game/SoundEffects.ts` (Web Audio sintetizado: ficha que
  cae con tono por jugador, ganar, perder, empate, countdown tick).

## Modo sala: como sincroniza

Estado durable en `public.room_match_state` (una fila jsonb por
**sala+ronda+tablero**: la columna `board` distingue los tableros simultaneos de
la ronda, uno por pareja; ver `supabase/rooms.sql` y
`src/shared/room/matchState.ts`, cuyas funciones toman un `board` opcional que
por defecto es 0 para los juegos de un solo tablero), con el patron estandar de
salas: **escribir -> ping broadcast "sync" -> los demas refetchean**, mas poll de
respaldo. Por turnos, la latencia por jugada no se nota.

- El estado guardado es `C4State` + `players` (los dos nicknames de cian y rosa
  de esa pareja) + `seq` (correlativo de jugadas, para sonar cada movimiento
  remoto una vez).
- **Un unico UPDATE atomico por jugada** con version optimista; **local-first**
  para el jugador de turno (su ficha se ve al instante) y `forceRefresh` readopta
  la DB ante conflicto de version.
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
  (25 s), se suelta una ficha al azar por el para que la partida avance. El
  deadline de ronda sigue siendo el corte duro.
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
  `room.reportScore(...)`; el empate reporta 0; los espectadores reportan 0.
  Recargar a mitad de partida reengancha (el estado vive en Postgres y
  `SharedMatch.boot()` lo readopta por `board`).
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
Ta-Te-Ti.

## Integraciones estandar

- Countdown 3/2/1/YA compartido (`COUNTDOWN_LABELS`/`COUNTDOWN_STEP`,
  `beginCountdown`, `Hud.showCountdown`, blip `playCountdownTick`).
- Ranking global: scoring por defecto (`direction: "higher"`, mayor racha =
  mejor), asi que `meta.ts` no exporta `scoring`. Solo el modo solo envia al
  ranking (`hud.showRanking("connect-four", streak)`); el modo sala nunca (sus
  1/0 quedan en la sala).
- Modo sala: `initRoomMode("connect-four", { getScore, onStart: beginCountdown })`;
  el reintento en game over se bloquea con `if (this.room) return`.

## Gotchas

- **A diferencia de Ta-Te-Ti, aca si hay empate** (tablero lleno sin linea). En
  solo no rompe la racha (se rejuega); en sala reparte 0 a los dos.
- Solo el jugador de turno puede ganar en su jugada; `applyMove` chequea la linea
  desde la ultima ficha colocada, la unica que puede completar 4.
- El disco fantasma se calcula en el Hud a partir del ultimo tablero dibujado
  (`landingRow`), no del estado de logica: se limpia en cada `renderBoard` y al
  bloquear el tablero.
- La IA usa `DEPTH = 6`: subirlo la hace mas fuerte pero mas lenta (el arbol es
  mas grande a tablero vacio). Ajustar dificultad se hace con `DEPTH` y la
  heuristica en `ai.ts`.
- **`menuVisible` gatea el reinicio (no el estado).** Al perder la racha en solo,
  `onMatchLose` pone el estado en `over` pero el overlay de fin (con el ranking) se
  muestra `SOLO_RESULT_MS` despues (se ve un momento el tablero perdido). En esa
  ventana el estado ya es `over`, asi que gatear el Enter/tap de reinicio por estado
  hacia que un toque reiniciara la partida — y `beginCountdown`->`cancelPending()`
  cancelaba el `schedule` del overlay, dejando la corrida sin mostrar puntaje ni
  reportar al ranking. El flag `menuVisible` es true solo con el overlay realmente
  en pantalla; la continuacion de racha (victoria/empate) no se ve afectada porque
  ahi el estado sigue en `playing`.
