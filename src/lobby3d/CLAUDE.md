# La Feria (`src/lobby3d/`)

La sala 3D: una feria abandonada de noche, en primera persona, donde los jugadores
de una sala caminan juntos **entre juego y juego**. Ahi se ve el lobby, se vota el
proximo juego parandose en la chapa frente a su afiche (o se pide REROLL subiendose al
escenario del medio), se ven los resultados de cada ronda y la final. Mientras esperan, trepan **La Torre**
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
- **Sin botones (pedido del programador: "hacela jugable").** Todo pasa caminando:
  - **Lobby**: con 2+ jugadores conectados, el host (su cliente, solo) fija el
    `deadline` de la sala a `LOBBY3D_AUTOSTART_SEC` (15 s) y la barra de todos muestra
    "Votacion en 0:15"; al vencer se abre la votacion. Si quedan menos de 2, se suspende
    (`armHubLobby` en `roomMode.ts`). En ese margen el host puede elegir cuantos juegos
    tiene la partida (el panel ya no tiene "Empezar").
  - **Votacion**: `VOTE_SECONDS_3D` (30 s; hay que caminar hasta la chapa). Cuando ya
    votaron todos los conectados se comprime a 10 s, no a 3: tienen que ver como quedo y
    poder cambiar.
  - **Al vencer, directo al juego**: no hay briefing (`startRoundNow` registra la ronda y
    la pone en `playing`; todos navegan). El juego tiene su cuenta 3/2/1.
- **De a un juego, sin partida de N juegos ni final** (pedido del programador): se vota,
  se juega el juego votado y todos vuelven a la feria; despues de los resultados
  (`RESULTS_TO_VOTE_MS`) se abre la votacion siguiente, y asi mientras sigan ahi. En una
  sala 3D `totalRounds()` es `Infinity` (ninguna ronda es la ultima; se muestra "Juego N"
  sin total) y el lobby no tiene "Juegos de la partida". La final (luna roja, bengalas,
  cornetas) ya no se alcanza desde una sala 3D; el codigo queda para una sala vieja.
  La noche empeora con cada juego pero cada vez menos (`done / (done + DREAD_HALF_GAMES)`
  hacia `DREAD_LAST_ROUND`), sin llegar a la luna roja.
- **La pizarra de la noche** (`NightBoard.ts`, pedido del programador): quien gano el
  ultimo juego y los puntos acumulados de todos los juegos terminados (el mismo
  `computeTotals` de las salas: 1ro de N suma N), con lo que sumo cada uno en el ultimo.
  La arma `RoomHub.standings()` (una ronda en curso todavia no cuenta: se actualiza al
  volver) y la repinta `Hub.updateNightBoard` en cada cambio de la sala, solo si cambio
  algo. **Es otro cartel que el de records de la torre** (que no se toco) y se ve
  distinto a proposito: pizarron de tiza **apaisado** en un marco de chapa oxidada sobre
  patas, con la franja roja y blanca de los puestos y una lampara de obra con jaula,
  contra las tablas pintadas en vertical del de records. Cada nombre va en la tiza del
  color de su remera (aclarado: sobre el verde casi negro se apagaba) y el puntero lleva
  la corona. Va al **sur, detras del spawn**, de cara al centro (0, 19): a los costados
  del arco de carteleras, vista desde el centro, se superponia con los afiches de las
  puntas. Verificado con dos jugadores reales y dos juegos seguidos: acumula, las dos
  pantallas muestran lo mismo y despues del segundo se abre otra votacion.
- **Los afiches rotan y salen de TODOS los juegos de sala** (pedido del programador).
  Hay `LOBBY3D_POSTERS` (15) carteleras fijas y cada votacion sortea 15 juegos de
  `roomGames` (`pickVoteOptions` -> `sampleGames` en `src/shared/room/hub.ts`). Como
  viajan en `vote_options`, todas las pantallas muestran el mismo afiche en la misma
  cartelera (`World.setPosters`, con las texturas cacheadas por juego). Antes de la
  primera votacion se muestran 15 sorteados con el codigo de sala como semilla (iguales
  para todos). El arco de carteleras esta medido para 15: si se cambia la cantidad,
  revisar que no tape el cartel de records ni la torre.
- **Tu voto en pantalla** (`Hud.setMyVote`, arriba al medio): "Tu voto: <juego>",
  "REROLL (otros juegos)" o "Todavia no votaste - pisa la chapa de un afiche". Cada uno
  ve el suyo.
- **REROLL**: el escenario del medio (era LISTO, para el briefing que ya no existe en la
  feria; ahora dice REROLL). Subirse es un voto mas (`REROLL_VOTE` en `room_votes`,
  como el "ready"), que se cambia pisando una chapa. Con **mas de la mitad de los
  conectados** en REROLL, el host sortea 15 afiches nuevos (evitando los de ahora),
  borra los votos y reinicia la cuenta (`maybeReroll` / `rerollVote`). El panel tiene
  la fila "REROLL: otros juegos" con `n/necesarios`.
- **Se vota al ENTRAR a la chapa o al escenario, no por estar parado** (`Hub.standingSpot`,
  por indice de cartelera): si no, el que pidio REROLL y se queda arriba lo repetiria en
  bucle, y el que esta parado en una chapa votaria sin querer el juego nuevo que aparece
  ahi. Verificado: con los dos arriba del escenario hay un solo reroll.
- **Lo que se lee de lejos son los votos** (`World.setVoting`): la chapa de un afiche votado
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
  `onVote` que el boton del overlay; subirse al escenario, a `onVote(REROLL_VOTE)`.
  Con el mouse capturado tambien se apunta y se hace clic (`World.pick`). El panel
  del HUD deja votar tocando, por si alguien esta arriba de la torre.
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

**Ranking global de la torre (pedido del programador).** Ademas de la corona de la
sala, cada carrera **validada por el server** (el `lb:summit` propio, o sea que paso
`MIN_CLIMB_MS` y `TOP_MIN_Y`) se guarda para siempre en la tabla `scores` de Supabase
con `game_id = TOWER_BOARD` (`"lobby3d-torre"`) y el nickname de la sala
(`Hub.saveTowerTime`, `source: "room"`). El server **no** escribe (regla del repo: no
toca la DB); lo hace el cliente dueño de la carrera, con el mismo nivel de confianza
que el resto de los rankings. Sin server no hay validacion, asi que esa carrera no
entra.

- **Lectura:** `fetchTop(TOWER_BOARD, { direction: "lower", period: "all" })`. La
  feria no tiene `meta.ts` (apareceria en el roster), asi que el orden va a mano con
  el `direction` de `FetchOpts`. Ningun otro lugar lista ese `game_id`: la landing, el
  Salon de la fama y los rankings recorren solo el roster. Sin migracion.
- **Se relee** al cargar la feria, cada `TOWER_TOP_REFRESH_MS` (60 s) y 2.5 s despues
  de que alguien de la sala llega a la cima (su pantalla es la que guarda).
- **Avisos del HUD:** "RECORD DE LA FERIA" si el tiempo propio queda primero,
  "Entraste al top de la feria: puesto N" si entra al Top 10, y a todos "X marco el
  record de la feria" cuando cambia el primero.
- **El cartel (`RecordBoard.ts`)**: el tablero de puntajes de una feria de pueblo, al
  **sureste** de la plaza en (12.5, 12.5), del otro lado de la torre y de cara al
  centro. La primera version iba al norte del mastil y **tapaba el afiche de la punta
  oeste** de las carteleras: tiene que quedar afuera del arco de los afiches (que llega
  hasta z ~ 4.5 en las dos puntas), lejos del spawn, del escenario y de los trastos. Madera de tablas
  con marco rojo, "RECORDS / DE LA TORRE / TODAS LAS SALAS" a pincel con chorreadas, el
  Top 10 en pintura hueso con el primero dorado y su corona y los tiempos propios en
  rojo (`recordBoardTexture` en `textures.ts`). Una lampara de obra lo ilumina (lo que
  se lee tiene su propia luz) y una guirnalda alrededor titila y se quema con la noche
  como el resto; en la final va roja. Choca como un bloque entero. **La letra es
  gorda y clara a proposito**: el filtro PS1 dibuja la escena a 400 lineas y con
  letra fina las filas de abajo no se leian.
- Estados del cartel: "CARGANDO...", "NADIE LLEGO A LA CIMA TODAVIA" y, sin
  credenciales, "SIN CONEXION CON EL RANKING".
- **Probarlo sin ensuciar el ranking real:** interceptar en Playwright
  `/rest/v1/rpc/leaderboard_best` (devolver filas inventadas) y el `POST
  /rest/v1/scores` (capturar la fila y contestar 201), y llamar
  `window.__isla.saveTowerTime(ms)`. Asi se verifico: lee con `p_ascending: true` e
  inserta `{game_id: "lobby3d-torre", player, score, source: "room"}`.

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

## Reacciones y sonido (`Sounds.ts`)

- **Reacciones**: las mismas cinco de Bomba Palabra / Cadena de Palabras (risa,
  sorpresa, enojo, burla, llanto; `EMOTES` en `constants.ts`, teclas 1-5 o los botones),
  con **sus audios** (`public/sfx/emotes/<id>.mp3`, la excepcion del repo a sintetizar
  todo). Por la red viaja el **indice** (`lb:emote.e`), asi que el orden de `EMOTES` no
  se toca; el server acepta 0..7 y no hubo que redesplegarlo. Sin emojis: la carita se
  dibuja en canvas (`drawEmoteFace` en `textures.ts`), sobre la cabeza del muñeco y en
  los botones del HUD. El muñeco ademas hace un **gesto** corto (`Avatar.applyEmote`):
  se sacude de risa, salta de sorpresa, tiembla de enojo, cabecea en la burla, baja la
  cabeza con las manos en la cara si llora. La reaccion ajena suena **mas bajo cuanto
  mas lejos** y del lado donde esta (`StereoPanner` respecto de adonde mira uno); la
  propia se ve en pantalla (`Hud.flashEmote`: en primera persona uno no se ve).
  Cooldown local `EMOTE_COOLDOWN_MS` (1 s) para no mandar lo que el server descarta.
  Si un mp3 falta o no decodifica, suena un blip sintetizado.
- **Final**: fanfarria de **cornetas** al entrar (`playHornFanfare`: sierras apenas
  desafinadas con tremolo, filtradas y con caida de tono) y una suelta cada 3.5-8.5 s
  mientras dura; cada **bengala** silba al subir (`playLaunch`, ruido con un pasabanda
  que sube) y revienta con estallido grave y chisporroteo (`playBurst`), enganchado a
  `Fireworks.onLaunch` / `onBurst`. Sin sonido la final "parecia un velorio"
  (programador). Todo sintetizado con Web Audio.
- Un solo `AudioContext`; se destraba en el primer `pointerdown` / `keydown`
  (`unlockAudio`). Probarlo headless: no se escucha, pero se puede contar cuantos
  osciladores / fuentes se crean envolviendo `AudioContext` en un `addInitScript`.
- **Gotcha de las pruebas**: el server exige codigos de sala de 4+ caracteres
  (`sanitizeCode`). Con `?code=EMO` el join se ignora en silencio y los jugadores no se
  ven; parece un bug de red y no lo es.

## Controles

Compu: un clic en la escena **captura el mouse** (pointer lock) y el mouse mira; ESC
lo suelta para usar el panel (sin captura tambien se mira arrastrando). WASD / flechas
caminan relativo a la mirada, ESPACIO salta, 1-5 reacciones (ver "Reacciones y sonido").
derecha mira; boton SALTAR y botones de reaccion. El panel se puede ocultar.

La leyenda de controles de la compu es una tira abajo a la izquierda con **los mismos
iconos del briefing de las salas** (`renderHowTo` de `src/shared/howtoView.ts`, con
`CONTROLS` en `Hud.ts`), no texto. Se la re-estiliza en `style.css` para la feria
(tarjetas en fila, sin redondeo, VT323, acento rojo) con selectores que empiezan en
`.isl-hud`: los estilos del renderer se inyectan en runtime despues del CSS de la pagina
y a igual especificidad ganaban ellos. En el celu no se muestra (estan los botones).

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

## Probarlo con dos jugadores reales

En dev la pagina deja el `Hub` en `window.__isla` tambien en una sala real (no solo con
`?dev=`), asi Playwright puede pararse en una chapa: `__isla.player.placeAt(x, 0, z)` con
la `x`/`z` de `__isla.world.portals[i]`, o en el escenario con `placeAt(0, 0.4, 6.8)`.
Dos navegadores (ver gotchas), sala 3D privada creada desde `/rooms/`. **Interceptar el
`POST /rest/v1/scores`**: un juego que termina solo (Flappy) en una sala de prueba
registra la partida en el ranking global real.

Rendimiento: el renderer pide `powerPreference: "high-performance"` (en una notebook con
placa dedicada el navegador usa esa). Medido en la escena de votacion: 180 FPS con una
RTX 4050 en una ventana normal, 59 en headless con GPU y ~29 sin GPU (SwiftShader, que
es lo que usa Playwright por defecto: no sacar conclusiones de rendimiento de ahi).

## Pendiente

- Empujones entre jugadores, voz de proximidad.
- La espera "ya termine, faltan otros" sigue en la pagina del juego; podria pasar a
  la feria (y a la torre).
