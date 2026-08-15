# Memoria (memory-match)

Juego de memoria de pares con dos modos muy distintos sobre el mismo tablero DOM:

- **Solo (sin `?room=`)**: completar un tablero 4x4 (8 pares) lo mas rapido y con menos movimientos posible (un movimiento = cada intento de par, se cuenta al dar vuelta la segunda carta). Sin limite de tiempo; el cronometro cuenta hacia arriba. Ranking global unico "combinado" igual que sliding-puzzle: se ordena por tiempo y los movimientos desempatan y se muestran al lado (`1:23.45 - 12 mov`).
- **Sala (`?room=`)**: el primer juego de "pantalla compartida" del repo. Todos los jugadores ven el **mismo tablero** y juegan **por turnos** (regla clasica: encontrar un par = seguir jugando; fallar = pasa el turno). El puntaje de la ronda es la cantidad de pares propios.

## Module layout

- `main.ts` — entry point, monta `Game` en `#app`.
- `game/Game.ts` — estados `ready | countdown | playing | over`, countdown 3/2/1/YA compartido, modo solo completo, y delega el modo sala en `SharedMatch` al terminar el countdown.
- `game/board.ts` — **logica pura y serializable** del tablero (sin DOM ni red): `MemoryState`, `applyFlip`, `skipTurn`, `canFlip`, `pairsOf`, `boardDimsFor`. Es el mismo estado que viaja a Postgres en modo sala; solo y sala comparten estas transiciones.
- `game/sharedMatch.ts` — controlador del modo sala (ver abajo).
- `game/Hud.ts` — DOM: overlays, countdown, grilla de cartas con flip 3D CSS, banner de turno y marcador de jugadores (chips con color por jugador).
- `game/symbols.ts` — 18 figuras SVG inline + colores neon (sin emojis, regla del repo); color de jugador para los pares ganados.
- `game/constants.ts`, `game/SoundEffects.ts` (Web Audio sintetizado: flip, par, fallo, victoria).

## Modo sala: como sincroniza

Estado durable en `public.room_match_state` (una fila jsonb por sala+ronda, ver `supabase/rooms.sql` y `src/shared/room/matchState.ts`), con el patron estandar de salas: **escribir -> ping broadcast "sync" -> los demas refetchean**, mas poll de respaldo cada 5 s. Al ser por turnos, los ~200-400 ms de latencia por movimiento no se notan.

Decisiones no obvias:

- **Un unico UPDATE atomico por movimiento** con version optimista (`eq("version", esperada)`): la segunda carta de un intento resuelve todo en la misma escritura (par asignado o turno pasado), asi nunca hay transiciones a medias en la DB. El campo `reveal` (con `seq` correlativo) describe el intento para que los clientes remotos, que reciben el estado ya resuelto, puedan animar "mostrar ambas cartas ~1 s y voltear" exactamente una vez.
- **Local-first para el jugador de turno**: aplica el estado nuevo y renderiza antes de escribir; si la escritura pierde la carrera de version, `forceRefresh` readopta lo que diga la DB.
- **El host crea el tablero** al cargar la pagina de la ronda si no existe (insert; ante la carrera host-viejo/host-nuevo gana el primero, PK). El tamano depende de los jugadores registrados: 2 -> 4x4, 3-4 -> 6x4, 5-6 -> 6x5, 7+ -> 6x6 (`boardDimsFor`). Si el host **no aparece** (se desconecto antes de cargar la ronda), pasados `CREATE_FALLBACK_MS` (6s, de `matchState.ts`) lo crea cualquier jugador: sin esa salida la sala entera se quedaba en "Preparando el tablero..." para siempre.
- **Orden de turnos** = `players` de la sala **barajado al azar** (Fisher-Yates en `createState`, `board.ts`). Como solo el host crea el estado y se persiste en Postgres, todos los clientes adoptan el mismo orden aleatorio (no se ordena por `joined_at`).
- **Anti-AFK**: si el estado no cambia en 20 s (`AFK_SKIP_MS`), el host pasa el turno (`skipTurn`); el deadline de ronda sigue siendo el corte duro (el parcial por timeout son los pares propios, comparables por ser `direction: "higher"`).
- **Al jugador desconectado no se le espera el turno.** El que se va sigue en `turnOrder` (su fila de `room_players` es durable a proposito, para poder volver), asi que le tocaba jugar y **frenaba la partida 20 s por cada vuelta de turnos** — con dos caidos el tablero queda practicamente parado, que es el sintoma que se reporto ("lo pone para que juegue y quedamos todos atrapados"). Si el jugador de turno no esta en `room.presentPlayers()`, el host lo saltea a los `AFK_ABSENT_SKIP_MS` (3 s) y de paso saltea **en la misma escritura** a todos los ausentes que vengan detras (`skipAbsent`). Gotcha: con `presentPlayers()` vacia (canal aun sin sincronizar) **no** se asume que se fueron todos — se cae a la ventana AFK normal.
- **Fin**: con todos los pares encontrados cada cliente reporta sus propios pares via `room.reportScore(...)` y el flujo normal de la sala (cierre, resultados, votacion) sigue sin cambios.
- Recargar la pagina a mitad de partida reengancha: el estado vive en Postgres y `SharedMatch.boot()` lo readopta.

Cableado estandar ademas del contrato minimo: usa el contexto extendido de `RoomMode` (`code`, `me`, `round()`, `players()`, `presentPlayers()`, `isHost()`, `ping()`, `onSync()`) agregado en `src/shared/room/roomMode.ts` para este tipo de juegos.

## Gotchas

- El modo sala reporta pares (`direction: "higher"`, usado por `rankRound`), pero el ranking solo se ordena por tiempo (menor mejor). Se resuelve con una **variante** "solo" que sobrescribe la direccion a `"lower"` via `variantDirection` en el `scoring` declarado en su `meta.ts`, y codifica tiempo + movimientos en un puntaje con `encodeTimeMoves` (de `scoring-core.ts`, compartido con sliding-puzzle). El puntaje base del juego nunca recibe envios del modo solo.
- `renderCards` es declarativo (clases segun estado); el "mostrar dos cartas que no eran par" se logra con la lista temporal `holdUp` en el caller, no con estado en el Hud.
- El tablero se dimensiona con `--cols` / `--rows` en CSS para que 6x6 no desborde en pantallas bajas.
