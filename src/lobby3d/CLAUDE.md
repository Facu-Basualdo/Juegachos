# La Isla (`src/lobby3d/`)

La sala 3D: una isla flotante low poly donde los jugadores de una sala caminan
juntos **entre juego y juego**. Ahi se ve el lobby, se vota el proximo juego
parandose en un portal, se marca "listo" subiendose a una plataforma, se ven los
resultados de cada ronda y la final. **No es un juego**: no tiene `meta.ts` (si
lo tuviera apareceria en el roster), vive en `/rooms/lobby/`
(`rooms/lobby/index.html`, entry `lobby3d` en `vite.config.ts`).

Estetica: ver [DESIGN.md](DESIGN.md) ("Facetas al Sol"): low poly facetado, lejos
de los cubos pixelados de Derrumbe / Marea de Lava.

## Como se engancha con las salas

Es **opcional por sala**: `settings.lobby3d = true` (jsonb, sin migracion). Se crea
con el boton "Crear sala 3D (la Isla)" de `/rooms/`, que solo aparece con el game
server configurado. Las salas comunes no cambian en nada.

- **Toda la logica de sala es la de siempre** (`src/shared/room/roomMode.ts`): la
  isla arranca el mismo `RoomModeController` con `initRoomHub(presenter)` y el
  gameId `HUB_ID` ("lobby3d"). Lo unico distinto es quien dibuja: en vez del
  `RoomOverlay`, el `Hub` implementa `HubPresenter` (= `RoomPresenter` + `showLobby`).
  Host, votos, listos, compresion de la votacion, migracion de host, heartbeat y
  espectadores no se duplicaron: si se toca esa logica, se toca una vez.
- **Quien esta donde.** En una sala 3D la pagina del juego **solo** muestra la
  partida (`playing`). Cualquier otra fase la devuelve a la isla (reportando antes
  el parcial si hacia falta, via `leaveForCurrentRound(hubUrl)`), y la isla, al ver
  `playing`, navega al juego. O sea que el briefing, los resultados, la votacion y
  la final pasan en la isla, y el lobby de `/rooms/` redirige a la isla.
- **La isla sobrevive a varias partidas**, cosa que ninguna pagina de juego hace:
  al volver al lobby limpia lo latcheado por ronda (`resetHubMatch`), porque la
  revancha vuelve a numerar desde la ronda 1 y reusaria las mismas claves (voto
  programado, votacion comprimida, final ya mostrado).
- **Pool de juegos**: solo los `roomsOnly` (el campo nuevo de `GameEntry`; hoy 13).
  Son los marcos de la galeria y el pool de `pickVoteOptions(settings)` en una sala
  3D (`votePool` en `src/shared/room/hub.ts`). Un juego rooms-only nuevo tiene que
  declarar `roomsOnly: true` para aparecer.
- **Pisar = tocar.** Pararse en un portal encendido llama al mismo `onVote` que el
  boton del overlay; subirse a la plataforma LISTO, al mismo `onReady`. El panel del
  HUD tambien deja votar / marcar listo tocando, por si alguien no llega caminando.
  El voto propio es optimista (`voteLocal`) hasta que la DB lo confirma.

## Red: relay puro en el game server

Namespace `/lobby`, prefijo `lb:` (`server/src/games/lobby.ts`; tipos duplicados en
`game/LobbyProtocol.ts`). Cada cliente simula su muñeco y manda `lb:pos` ~15/s solo
si cambio, con un keepalive de 1 s quieto (`POS_SEND_MS` / `POS_IDLE_MS`, loop en
`setInterval`, nunca en el rAF). El server estampa el nickname, reenvia, recuerda la
ultima posicion y el accesorio de cada uno (`lb:init` al que llega) y avisa
entradas/salidas (`lb:hi` / `lb:bye`). Reacciones: `lb:emote` con cooldown.

Por que el server y no el canal de Supabase: 8 x 15/s = 120 msg/s, arriba del tope
de ~100 por canal (ver "Canales efimeros" en el CLAUDE.md raiz). **Sin server** la
isla funciona igual como sala (votos, listos, resultados son de Supabase); solo no
se ven los demas muñecos, y lo avisa con un cartel.

## Simulacion (metodo aprobado por el programador)

Cinematico en el cliente, sin autoridad (`game/Player.ts`): velocidad horizontal que
acelera hacia la pedida, gravedad simple, piso por altura (`Island.groundAt`: 0 en
la isla, 0.3 sobre la plataforma LISTO, -Infinity afuera) con escalon automatico
(`STEP_UP`) y empuje contra circulos (troncos, marcos, pedestal). Paso fijo de
1/120. Caerse de la isla es a proposito: se reaparece en el spawn con un "Ups".
Los muñecos ajenos se suavizan con un ease exponencial hacia el ultimo snapshot
(`REMOTE_EASE`), como Derrumbe.

## La escena

- `Island.ts`: isla principal y decorado (todo con semilla fija), galeria de
  portadas en semicirculo al norte (norte = -Z), portales hexagonales delante de
  cada portada, pedestal central con un cartel que muestra el juego de la ronda (o
  el escudo con el codigo de la sala), plataforma LISTO al sur, islotes lejanos.
- `Sky.ts`: domo con degradado (ShaderMaterial), sol/luna, hemisferio, niebla,
  nubes, estrellas y lluvia. **La hora del dia la decide la sala** (`Hub.updateDay`):
  media mañana en el lobby, avanza con cada ronda jugada hasta el atardecer y la
  final es de noche. El clima sale de una semilla (codigo + rondas jugadas), asi
  todos ven el mismo cielo sin mandar nada: 60% despejado, 25% nublado, 15% lluvia;
  lobby y final siempre despejados.
- `Avatar.ts`: muñeco low poly (cuerpo de poroto, cabeza grande, manos flotantes),
  remera por asiento (orden de llegada a la sala), accesorio elegible (`LOOKS`,
  guardado en `localStorage` `mg:island-look`, viaja en el `lb:join`).
- **Primera persona** (pedido del programador; la primera version era tercera persona
  con camara fija). La camara va en los ojos (`EYE_HEIGHT`) con un balanceo minimo al
  caminar, rotacion en orden `YXZ` (yaw y despues pitch, si no mirar arriba inclina el
  horizonte), pitch topeado en `PITCH_LIMIT`. El muñeco propio **no se dibuja**; el
  resto lo ve mirando hacia donde mira la camara (`player.yaw = camYaw + PI`, porque el
  muñeco mira a +Z y la camara a -Z). Las reacciones propias salen como cartel en
  pantalla (`Hud.flash`). Arboles con collider del ancho de la copa: con el del tronco
  la camara se metia en las hojas.
- **Apuntar y tocar**: con el mouse capturado, un clic tira un rayo desde el centro de
  la pantalla (`Island.pick`, hasta `AIM_RANGE`) contra los marcos, los hexagonos y la
  plataforma: un portal encendido vota y la plataforma marca listo. La mira se agranda
  cuando hay algo tocable adelante. Pisar sigue funcionando igual.

## Controles

Compu: un clic en la escena **captura el mouse** (pointer lock) y el mouse mira; ESC
lo suelta para usar el panel (sin captura tambien se mira arrastrando). WASD / flechas
caminan relativo a la mirada, ESPACIO salta, 1-4 reacciones ("Hola", "GG", "Jaja",
"Vamos"). Celu: un dedo en la mitad izquierda es un joystick flotante y uno en la mitad
derecha mira; boton SALTAR y botones de reaccion. El panel se puede ocultar.

Probar la mirada en Playwright: con el mouse capturado, `page.mouse.move` no trae
`movementX`, asi que no gira. Se simula con
`document.dispatchEvent(new MouseEvent("mousemove", { movementX, movementY }))`.

## Probar sin Supabase (`game/devRoom.ts`)

`/rooms/lobby/?dev=Ana&roster=Ana,Beto&code=TEST` en **dev**: escena + relay contra
el game server, sin tocar la base. `&phase=lobby|voting|briefing|results|final` pinta
una fase con datos de mentira, `&t=0..1` fija la hora y `&weather=clear|cloudy|rain`
el clima. Server local: `PORT=8799 npx tsx src/index.ts` en `server/`, y Vite con
`VITE_GAME_SERVER_URL=http://localhost:8799`. Para ver a dos jugadores en Playwright
usar **dos navegadores** (`chromium.launch()` dos veces): dos pestañas del mismo
navegador dejan una en segundo plano y su rAF no dibuja.

## Pendiente (fases siguientes del plan)

- Podio 3D al final (columnas de puntos que crecen, confeti / fuegos artificiales).
- Empujones, pelota, arcade con juegos solo, voz de proximidad.
- La espera "ya termine, faltan otros" sigue en la pagina del juego (overlay o la
  vista propia del juego); podria pasar a la isla.
