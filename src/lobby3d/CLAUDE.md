# La Feria (`src/lobby3d/`)

La sala 3D: una feria abandonada de noche, en primera persona, donde los jugadores
de una sala caminan juntos **entre juego y juego**. Ahi se ve el lobby, se vota el
proximo juego parandose frente a su afiche, se marca "listo" subiendose al escenario,
se ven los resultados de cada ronda y la final. Mientras esperan, trepan **La Torre**
(un parkour) por la corona de la sala. **No es un juego**: no tiene `meta.ts` (si lo
tuviera apareceria en el roster), vive en `/rooms/lobby/` (`rooms/lobby/index.html`,
entry `lobby3d` en `vite.config.ts`).

Primer nombre: "la Isla" (low poly pastel). El programador cambio la estetica; en el
codigo quedan nombres de entonces (`hub`, `isl-` en el CSS, `mg:island-look`).

Estetica: ver [DESIGN.md](DESIGN.md) ("Cinta Gastada"): PS1 de terror, Puppet Combo
y Misery.

## Como se engancha con las salas

Es **opcional por sala**: `settings.lobby3d = true` (jsonb, sin migracion). Se crea
con el boton "Crear sala 3D (La Feria)" de `/rooms/`, que solo aparece con el game
server configurado. Las salas comunes no cambian en nada.

- **Toda la logica de sala es la de siempre** (`src/shared/room/roomMode.ts`): la
  feria arranca el mismo `RoomModeController` con `initRoomHub(presenter)` y el
  gameId `HUB_ID` ("lobby3d"). Lo unico distinto es quien dibuja: en vez del
  `RoomOverlay`, el `Hub` implementa `HubPresenter` (= `RoomPresenter` + `showLobby`).
  Host, votos, listos, compresion de la votacion, migracion de host, heartbeat y
  espectadores no se duplicaron: si se toca esa logica, se toca una vez.
- **Quien esta donde.** En una sala 3D la pagina del juego **solo** muestra la
  partida (`playing`). Cualquier otra fase la devuelve a la feria (reportando antes
  el parcial si hacia falta, via `leaveForCurrentRound(hubUrl)`), y la feria, al ver
  `playing`, navega al juego. O sea que el briefing, los resultados, la votacion y
  la final pasan en la feria, y el lobby de `/rooms/` redirige a la feria.
- **La feria sobrevive a varias partidas**, cosa que ninguna pagina de juego hace:
  al volver al lobby limpia lo latcheado por ronda (`resetHubMatch`), porque la
  revancha vuelve a numerar desde la ronda 1 y reusaria las mismas claves (voto
  programado, votacion comprimida, final ya mostrado).
- **Pool de juegos**: solo los `roomsOnly` (campo de `GameEntry`; hoy 13). Son los
  afiches de las carteleras y el pool de `pickVoteOptions(settings)` en una sala 3D
  (`votePool` en `src/shared/room/hub.ts`). Un juego rooms-only nuevo tiene que
  declarar `roomsOnly: true` para aparecer.
- **Se votan todos, no 5** (pedido del programador: "que cada uno vote el juego que
  quiera"). En una sala 3D `pickVoteOptions` devuelve el pool entero; la sala comun
  sigue sorteando `VOTE_OPTION_COUNT` (5). Como "encendido" ya no distingue nada, lo
  que se lee de lejos son los votos (`World.setVoting`): la chapa de un afiche votado
  brilla mas, su foco se prende (hay `VOTE_LIGHTS` = 5 focos, van a los mas votados; el
  lider mas fuerte) y arriba sale el contador (solo en los votados, dorado el que va
  ganando, rojo el propio). El contador es un sprite **a tamaño fijo en pantalla**
  (`sizeAttenuation: false`): en metros, a 12 m eran tres pixeles.
- **Se ve quien voto que**: `VotingView.voters` (opcional; lo arma `renderVoting` en
  `roomMode.ts` con el orden de la sala, el overlay comun lo ignora). El cartel del
  afiche dice "3 - Ana, Caro +1" (`voteLabel`: dos nombres y el resto abreviado) y el
  panel lista los nombres bajo cada juego. El voto propio es optimista tambien en los
  nombres (me muevo de afiche al toque) y va primero, para no quedar escondido en el
  "+N".
- **Pisar = tocar.** Pararse en la chapa encendida de un afiche llama al mismo
  `onVote` que el boton del overlay; subirse al escenario LISTO, al mismo `onReady`.
  Con el mouse capturado tambien se apunta y se hace clic (`World.pick`). El panel
  del HUD deja votar / marcar listo tocando, por si alguien esta arriba de la torre.
  El voto propio es optimista (`voteLocal`) hasta que la DB lo confirma.

## Red: relay en el game server

Namespace `/lobby`, prefijo `lb:` (`server/src/games/lobby.ts`; tipos duplicados en
`game/LobbyProtocol.ts`). Cada cliente simula su muñeco y manda `lb:pos` ~15/s solo
si cambio, con un keepalive de 1 s quieto (`POS_SEND_MS` / `POS_IDLE_MS`, loop en
`setInterval`, nunca en el rAF). El server estampa el nickname, reenvia, recuerda la
ultima posicion y el accesorio de cada uno (`lb:init` al que llega) y avisa
entradas/salidas (`lb:hi` / `lb:bye`). Reacciones: `lb:emote` con cooldown.

Ademas:

- **Reloj compartido** (`lb:ping` / `lb:pong`, cada `CLOCK_PING_MS`): el cliente se
  queda con la muestra de menor ida y vuelta (`Hub.onPong`) y de ahi sale
  `worldTime()`. Todo lo que se mueve en la torre es funcion de ese reloj, asi todos
  lo ven en el mismo lugar sin mandarlo por la red.
- **Record de la torre** (`lb:top` -> `lb:summit` a todos, y `lb:crown` si es record):
  el server valida lo imposible (menos de `MIN_CLIMB_MS` = 15 s, o la ultima posicion
  por debajo de `TOP_MIN_Y` = 20 m; la cima esta a 23.6, **si se cambia la torre,
  revisar ese numero en el server**) y guarda el record por codigo de sala en un
  `Map` **afuera del sim**: entre ronda y ronda todos se van a la pagina del juego,
  el GameRoom se vacia y se descarta, y la corona no se puede morir con el. Dura 6 h.

Por que el server y no el canal de Supabase: 8 x 15/s = 120 msg/s, arriba del tope
de ~100 por canal (ver "Canales efimeros" en el CLAUDE.md raiz). **Sin server** la
feria funciona igual como sala (votos, listos, resultados son de Supabase); solo no
se ven los demas muñecos (lo avisa un cartel), el reloj es el local y la corona no
sale de tu pantalla.

## Simulacion (metodo aprobado por el programador)

Controlador **cinematico de paso fijo** (1/120) contra un mundo de cajas, sin
autoridad (`game/Physics.ts` + `game/Player.ts`). El programador pidio "la
simulacion que creas correcta" para el parkour; el arquetipo mas cercano de
`SIMULATION_ARCHITECTURE.md` es "Saltos reactivos" (trayectoria analitica).

- El mundo (`CollisionWorld`) tiene cajas con giro en Y (`Box`), cilindros verticales
  (`Circle`), cosas que empujan (`Hazard`) y cosas que se mueven (`Animated`), mas el
  piso (y = 0) y el alambrado (`boundary`): **no hay borde para caerse**.
- Por paso: el mundo se pone en el instante del paso (`world.pose(t)`); si el muñeco
  esta parado sobre algo que se mueve, lo acompaña (desplazamiento de la caja). Se
  mueve y se resuelve contra cada caja **por la menor penetracion**, con tres casos
  antes: venia de arriba -> aterriza; venia de abajo -> cabezazo; estaba apoyado y es
  un escalon bajo (`STEP_UP`) -> se sube solo. Al caminar se "pega" a un escalon que
  baja (`SNAP_DOWN`).
- Los empujones (barredores, ganchos) setean la velocidad y quitan el control
  `KNOCK_LOCK` segundos.
- `onGround` (apoyado en el piso del claro, no en una caja) es lo que anula una
  carrera de la torre.

Los muñecos ajenos se suavizan con un ease exponencial hacia el ultimo snapshot
(`REMOTE_EASE`), como Derrumbe.

## La Torre (`game/Tower.ts`)

Espiral de ~30 tramos alrededor de un mastil al suroeste del claro, desde la largada
a cuadros en el piso hasta la cima (23.6 m) con un trono y la baliza roja. Cuatro
vueltas: cajas y tablon; plataforma que va y viene y postes; tablones que se caen y
un barredor; vigas angostas, un montacargas y un pasillo con ganchos; plataformas
que se cruzan, mas tablones, un barredor doble, y los ultimos postes. Todo sale de
`COURSE` con un cursor en polares (`gap` sobre el espiral, `rise` de altura). Ojo:
las piezas largas son rectas y el espiral curvo, asi que el hueco real puede diferir
del `gap`.

- **Carrera**: se arma parado en la largada, arranca al salir de ella, termina al
  pararse en la cima (`Hub.updateRun`). Tocar el piso del claro la anula. Caerse de un
  tramo suele dejarte en la vuelta de abajo, no en el piso.
- **Corona**: la tiene el **record de la sala** (el primero que llega se la lleva y el
  que baja el tiempo se la roba). La lleva puesta en el muñeco (`Avatar.setCrown`),
  sale en la barra del HUD y en los carteles de la largada y de la cima.
- **Se verifico que se puede** con un bot que usa la fisica real (Playwright contra
  `?dev=`, via `window.__isla`): para cada par de tramos consecutivos prueba 81
  instantes de largada, camina hasta el borde del tramo, salta y mira si aterriza en
  el siguiente (y salta las barras que vienen). Todos los saltos tienen exito en
  alguno; los mas dificiles para el bot son los tablones que se caen a los 16 m (~27%)
  y el barredor doble (~5%). Un humano puede esperar el momento; el bot no. **Si se
  toca el salto (`JUMP_VELOCITY` / `GRAVITY` / `SPEED`) o `COURSE`, volver a correrlo.**

## La escena

- `retro.ts`: el filtro PS1. `psx(material)` ajusta los vertices a la grilla de la
  resolucion baja; `RetroPass` dibuja la escena a 400 lineas (`SHORT_SIDE`) en un
  render target, la estira con pixeles duros y le pone cuantizacion
  con tramado, grano, viñeteado y el tinte rojo. Los carteles de texto (nombres,
  votos, record) van en la capa `LABEL_LAYER` y se dibujan despues, a resolucion
  completa. **Todo objeto nuevo usa `psxLambert` / `psxBasic`**, si no se ve fuera de
  lugar.
- **Legibilidad antes que estetica** (pedido del programador): los afiches se tienen
  que reconocer de lejos. Por eso la imagen interna es de 400 lineas (con 240 no se
  leian), los afiches y carteles son texturas nitidas con mipmaps (`crispTexture`:
  afiches de 256 px, carteles pintados a 8x), los afiches y sus titulos no llevan
  niebla, y **no hay mapeo afin** (la primera version lo tenia: al mirar el piso o un
  afiche de costado se veia la diagonal de los triangulos estirando la imagen). Lo
  demas (madera, oxido, tierra) sigue en 16-64 px con filtro al mas cercano.
- **Lo que va pegado sobre otra superficie usa `decal(material)`** (afiches y titulos
  sobre su tabla, pantalla del televisor, LISTO pintado, largada de la torre): le da
  prioridad de profundidad (`polygonOffset`) y va a ~4 cm de la superficie. Sin eso hay
  z-fighting: el temblor de vertices corre cada esquina por separado mas que la
  separacion entre las caras, y de lejos los afiches se veian cortados en diagonal
  (en uno de sus dos triangulos ganaba la madera).
- La pagina **espera la fuente VT323** antes de armar la escena (`main.ts`, tope de
  1.5 s): los carteles se pintan una sola vez en canvas y sin eso salian con la fuente
  de reemplazo.
- `textures.ts`: texturas de 16-64 px pintadas por codigo (tierra, madera, oxido,
  franjas, cuadros, tela, mascaras), los afiches (la portada a 256 px, apenas
  amarillenta, con manchas solo en el borde) y los carteles pintados.
- `World.ts`: el claro, alambrado, bosque (instanciado), carteleras con su chapa de
  votacion y su foco, el televisor CRT del centro (canvas de 64x48: estatica o la
  portada del juego con lineas de barrido), el escenario LISTO, guirnaldas y trastos.
- `Night.ts`: niebla, luna, relleno y lluvia. **La noche empeora con la partida**
  (`dread`, `Hub.updateDread`): el lobby esta "abierto", cada ronda jugada quema
  lamparitas, espesa la niebla y tiñe de rojo; la final es con luna roja. El clima
  (despejado / niebla cerrada / lluvia) sale de una semilla (codigo + rondas jugadas),
  asi todos ven la misma noche; lobby y final, despejados.
- `Avatar.ts`: muñeco de trapo (cabeza de arpillera con ojos de boton y boca cosida;
  la mascara palida de antes se saco), remera por asiento (orden de llegada),
  accesorio elegible (`LOOKS`: gorra, gorro de fiesta, vincha, galera; `localStorage`
  `mg:island-look`, viaja en el `lb:join`) y la corona del record. Los accesorios se
  miden contra la cabeza (`HEAD_TOP`, `headRadiusAt`): la primera version los ponia a
  ojo y atravesaban el craneo.
- **Primera persona.** La camara va en los ojos (`EYE_HEIGHT`) con un balanceo minimo
  al caminar, rotacion en orden `YXZ`, pitch topeado. El muñeco propio **no se
  dibuja**; los demas lo ven mirando hacia donde mira la camara (`player.yaw = camYaw
  + PI`, porque el muñeco mira a +Z y la camara a -Z). Las reacciones propias salen
  como cartel en pantalla (`Hud.flash`).
- **Luz**: hay ~15 luces puntuales (postes, focos de los candidatos, escenario,
  televisor, lamparas de obra de la torre, baliza). La torre sin sus lamparas no se
  leia de noche.

## Marcador y final (`Scoreboard.ts`, `Fireworks.ts`)

- En **resultados** y en la **final** el televisor se hunde bajo el piso
  (`World.setTvSink`, atado a `Scoreboard.raise`) y suben columnas de chapa del color
  de cada jugador, alto proporcional a los puntos, en **orden de podio**. En los
  resultados crecen desde los puntos de antes de la ronda y sale un "+N"; el `key` (la
  ronda) hace que salga una sola vez aunque `showResults` se llame en cada sync. En la
  final el ganador lleva corona.
- Las columnas chocan (sus colliders estan en el mundo; radio 0 guardadas) y tienen
  `emissive` para verse en la oscuridad.
- **Final**: bengalas rojas detras de las carteleras y ceniza cayendo. Local, no viaja
  nada por la red. La ceniza arranca "en el piso" (apagada): si arrancara en el aire
  caeria al cargar la pagina en cualquier fase.

## Controles

Compu: un clic en la escena **captura el mouse** (pointer lock) y el mouse mira; ESC
lo suelta para usar el panel (sin captura tambien se mira arrastrando). WASD / flechas
caminan relativo a la mirada, ESPACIO salta, 1-4 reacciones ("Hola", "GG", "Jaja",
"Vamos"). Celu: un dedo en la mitad izquierda es un joystick flotante y uno en la mitad
derecha mira; boton SALTAR y botones de reaccion. El panel se puede ocultar.

## Probar sin Supabase (`game/devRoom.ts`)

`/rooms/lobby/?dev=Ana&roster=Ana,Beto&code=TEST` en **dev**: escena + relay contra
el game server, sin tocar la base. `&phase=lobby|voting|briefing|results|final` pinta
una fase con datos de mentira, `&dread=0..1` fija cuanto empeoro la noche,
`&weather=clear|fog|rain` el clima y `&dolls=1` pone una fila de muñecos quietos
delante del spawn, uno por accesorio y uno con corona (para revisarlos de cerca). Deja el `Hub` en `window.__isla` (para el bot de la
torre). Server local: `PORT=8799 npx tsx src/index.ts` en `server/`, y Vite con
`VITE_GAME_SERVER_URL=http://localhost:8799`.

Gotchas de Playwright:

- Para ver a dos jugadores usar **dos navegadores** (`chromium.launch()` dos veces):
  dos pestañas del mismo navegador dejan una en segundo plano y su rAF no dibuja.
- Con el mouse capturado, `page.mouse.move` no trae `movementX`, asi que no gira. Se
  simula con `document.dispatchEvent(new MouseEvent("mousemove", { movementX, movementY }))`.

## Pendiente

- Empujones entre jugadores, voz de proximidad.
- La espera "ya termine, faltan otros" sigue en la pagina del juego; podria pasar a
  la feria (y a la torre).
