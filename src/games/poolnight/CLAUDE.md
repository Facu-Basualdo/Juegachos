# Poolnight (`poolnight`)

**Poolnight**: pool de bar, estilo 8-ball, en 3D (Three.js), como party game por equipos: **1 contra 1, 2 contra 2 o 4 contra 4, nada mas**. Todos tiran sobre la misma mesa, por turnos. **Solo se juega en salas** y **necesita el game server** (como La Cuerda o Manchon). Estetica: ver [DESIGN.md](DESIGN.md) ("Paño y Humo": bar de madrugada, una lampara sobre la mesa y todo lo demas en penumbra).

## ESTADO

**Hecho y verificado:**

- **La fisica**: `src/games/pool-physics.ts` (`simulateShot`) y `src/games/pool-rack.ts` (rack y PRNG sembrado). 22 chequeos en `scripts/pool-physics-check.ts`.
- **El motor de reglas**: `src/games/pool-match.ts` (`PoolMatch`). 52 chequeos en `scripts/pool-match-check.ts`.
- **El bot**: `src/games/pool-bot.ts` (`chooseBotAction`). 17 chequeos en `scripts/pool-bot-check.ts`.
- **La capa de red**: `src/games/pool.ts` (`PoolSim`, el `RoomSim` del namespace `/poolnight`), los tipos `Bi*` al final de `src/protocol.ts` y el `registerPool(io)` en `src/index.ts`. 25 chequeos contra un server real en `scripts/pool-net-check.ts`.

`npm run check:pool` (dentro de `server/`) corre los tres primeros archivos: 91 chequeos (22 + 52 + 17; antes se decia 70, que era un error de cuenta), unos 30 s. **`npm run check:pool-net` es aparte** porque juega en tiempo real (2-3 min: la cuenta regresiva, las animaciones y un reloj de turno de 20 s de verdad).

- **El cliente** (`src/games/poolnight/`): escena 3D, cuatro camaras, input, HUD, sonido y la reproduccion de tiros. **Se probo en un navegador real** (Chromium headless con Playwright) contra un game server local: un 1v1 entre dos navegadores, con la rotura hecha con el mouse y varios turnos con teclado, y un 2v2 con tres lugares cubiertos por bots; todo sin errores de consola. Ver "Arquitectura".
- **Esta registrado**: `meta.ts` (`roomsOnly`, `ranking: "wins"`, `mobile: false`), `games/poolnight/index.html`, la portada `public/covers/poolnight.jpg`, el README y el CLAUDE.md raiz. `npm run build` lo descubre.

Los valores marcados "de partida" son tipicos de la fisica del billar y **no estan calibrados contra el juego**: los chequeos prueban que la fisica es consistente, no que se sienta bien.

- **Se probo por la sala real** (Supabase de verdad, dos navegadores, el game server local): sala privada, 1 juego, Poolnight elegido en el selector de la sala, un segundo jugador entra por el codigo, "Empezar", el **briefing** con su `howTo` en iconos (Apuntar, Potencia, Efecto, Camara, y "12 min" de tiempo de la ronda), los dos marcan "Listo", ambas paginas navegan a `/games/poolnight/?room=CODIGO`, la partida larga sola por `onStart`, y se juegan tiros (rotura y turnos siguientes) en los dos; la barra de la sala muestra el codigo, la ronda y el reloj (11:37 al arrancar, que sale de `roomTimeLimitSec: 720`). Sin errores de consola, tres corridas. Las salas de prueba (privadas, con nombres `PtHost` / `PtGuest`) se dejaron caducar y se verifico que se purgaron.

**Lo que NO se probo** (y por lo tanto no se puede dar por hecho): (1) **terminar una partida por la sala real**: el cierre de ronda, el tablero final y el `reportScore` con `{ place, players }` al ranking global. Se evito **a proposito**: una partida terminada con dos humanos escribe una victoria en el ranking global de produccion con los nicknames de prueba, y no hay como borrarla desde aca. El camino del reporte esta cubierto por lectura del codigo y por `devRoom` (que imprime lo que reportaria), no de punta a punta; (2) el juego en un **telefono** de verdad; (3) el **sonido**, que no se puede escuchar en headless; (4) la camara baja de apuntado a fondo y el rendimiento en una GPU de verdad (el headless renderiza por software).

### Lo que ya se midio (`npm run check:pool`)

- **Casos con respuesta conocida, coinciden**: rodadura pura frena en `v^2 / (2 MU_ROLL g)` (0.2742 m contra 0.2742 esperado); el golpe centrado pasa de deslizar a rodar a los 0.29125 s y a `5/7` de la velocidad inicial (1.42857); la velocidad de impacto contra la banda sale de la cinematica (0.86973) y rebota con `E_CUSHION` (0.65230); retroceso lleva la blanca detras del contacto, seguir la pasa por donde estaba la bola, y el golpe centrado manda la bola golpeada por la linea del tiro; la blanca entra por una tronera de esquina y por la del medio, y un tiro a la banda lejos de la boca no entra.
- **Fuzz de 3000 tiros** (2 a 15 bolas al azar, potencia, angulo y efecto al azar, un tiro de cada cinco a `V_MAX`): sin NaN; ninguna bola solapada ni atravesada (distancia minima 57.143 mm contra los 57.150 mm de `2R`); ninguna bola fuera de la mesa sin haber entrado a una tronera; la energia **nunca sube** de un paso al siguiente; todos terminan solos (duracion media 4.6 s, maxima 8.8 s); el tope de iteraciones por paso nunca se agota; y es **determinista** (se repitio uno de cada cien y el resultado es identico, byte por byte). Costo: ~1.5 ms por tiro.
- **300 roturas a potencia maxima** contra el rack sembrado: sin NaN, solapes ni cortes por tiempo. ~5 ms de calculo por rotura, 6.9 s de duracion media, ~10 de 15 bolas movidas mas de 1 cm.

### El motor de reglas (`PoolMatch`) y como encaja con la capa de red

Es **puro**: no abre sockets, no usa timers ni `Date.now()` (la hora entra como parametro `now`, en ms) y **no sabe nada de bots**. Resuelve el tiro entero adentro de `takeShot` llamando a `simulateShot`. La capa de red (`PoolSim`) lo maneja asi:

1. `new PoolMatch({ humans, seed, now })` arma asientos, rack y equipo que rompe. Hasta `turnStartAt` (= `now + START_DELAY_MS`, la cuenta regresiva) no se acepta ninguna accion (`too_early`; hay 250 ms de tolerancia de latencia).
2. El que tiene el turno (`shooter`) llama `placeCue(...)` si quiere acomodar la blanca (**solo con blanca en mano, o sea tras una falta; en la rotura no**) y `takeShot(...)`. Los errores son `PoolError` con un `code` (`not_your_turn`, `too_early`, `not_in_hand`, `bad_spot`, `cue_not_placed`, `bad_shot`, `ended`...): la capa de red los traduce a un rechazo, no cae el server.
3. `takeShot` devuelve un `ShotOutcome` con **todo lo que hay que difundir**: el `result` de la fisica (los tramos y eventos), `startAt` (hora comun de arranque de la animacion, `now + PLAY_LEAD_MS`), `nextTurnAt` (cuando termina la animacion mas `SETTLE_MS`: de ahi corre el reloj del siguiente), falta, bolas embocadas, si sigue el mismo, a quien le toca y si la partida termino.
4. **Los timers los pone el que lo maneja**: cuando `timedOut(now)` es verdadero llama `handleTimeout(now)` y **despues hace jugar a un bot por ese asiento, siempre** (vencio el turno, sea el primero o el segundo). `handleTimeout` devuelve `afk`: si con este vencimiento el asiento paso a piloto automatico (a los `IDLE_TURNS_TO_BOT` = 2 seguidos). Con `isAutopilot(seat)` (bot de relleno, desconectado o AFK) la capa de red programa el bot sin esperar el reloj. Las acciones del bot van con `byBot = true`, que **no** reclaman el asiento; una accion de un humano (`byBot = false`) resetea `idle` y `afk`.
5. `capReached(now)` / `endByCap()` cortan la partida por tiempo; `setAway(seat, bool)` marca una desconexion o la reconexion; `placeOf(team)` da el puesto para el ranking (ganador 1, perdedor 2, empate 1 y 1); `snapshot()` es la foto que va en `bi:state`.

**Decisiones que se tomaron al implementarlo** (todas dentro de las reglas del archivo, pero detalles que ahi no estaban):

- **La blanca en mano es opcional si la blanca sigue en la mesa.** Tras una falta por no tocar nada la blanca esta viva y el rival puede tirar desde donde quedo o reacomodarla; solo cuando se **embocó** (`scratch`) es obligatorio ponerla (`cue_not_placed`). **La rotura NO tiene blanca en mano** (ver "Reglas").
- **La 8 de la rotura** vuelve al punto de pie, o al primer hueco libre desde ahi hacia los dos lados si esta ocupado.
- **Seguir tirando** exige haber embocado una propia **y no haber faltado**: si faltas y embocas una propia, la bola queda abajo pero el turno pasa.
- **La 8 cuenta como limpia** si **antes del tiro** no quedaban bolas del grupo; si la ultima propia cae en el mismo tiro que la 8, se pierde (`early_eight`). Embocar la 8 con la blanca, aun con el grupo limpio, tambien se pierde (`scratch_eight`).
- **Un rival que emboca una bola del otro equipo** no falta: la bola queda abajo y le cuenta al dueño.
- **Quien rompe**: sale de la semilla (`mulberry32(seed ^ 0x9e3779b9)`), asi todos los clientes y el server coinciden sin guardarlo.

**Lo que los tests de partidas completas NO dicen:** el jugador del test es un tirador tonto (apunta a una propia o a la 8 al azar, con error grande). Casi todas sus partidas terminan en `early_eight` / `scratch_eight` porque apunta a la 8 sin haber limpiado. Sirven para comprobar que el motor **no se rompe ni se cuelga** (120 partidas de 1 a 8 humanos: sin errores, todas terminan, 15 ms por partida, ninguna bola reaparece), **no** para saber como se juega ni si el reparto A/B es parejo.

### La capa de red (`pool.ts`), medida con `check:pool-net`

26 chequeos contra un server real en el proceso, con clientes de socket.io:

- **Protocolo**: 3 humanos arman un 2v2 con 1 bot de relleno; cada cliente conoce su asiento; hay ~4 s de cuenta regresiva (4000 ms) antes del primer turno; `bi:ping` devuelve la hora del server; un tiro de quien no tiene el turno se rechaza (`not_your_turn`), y el del que si lo tiene pero antes de la cuenta regresiva tambien (`too_early`).
- **Un tiro llega igual a todos**: mismo `bi:play`, numerado correlativo, con `startAt` comun. La rotura (el tiro mas pesado: 194 tramos y 54 eventos en 7.4 s) pesa **13.5 KB**; el trafico de este juego es una rafaga por tiro, no un flujo.
- **Los tramos alcanzan para que el cliente evalue sin logica de colision**: se implemento en el test el evaluador analitico (el que va a ser el `MotionPlayer` del render) y, en 674 empalmes de 6 tiros, evaluar un tramo en el instante del siguiente da su posicion con un **error maximo de 0.25 mm**. La posicion final de cada bola en movimiento coincide con el estado del server, y las bolas sin tramos siguen donde estaban. Con el redondeo del mensaje (posicion a 0.01 mm, tiempo a 0.1 ms, velocidad a 0.1 mm/s).
- **Desconexion**: el desconectado queda marcado (`on: false`, `bot: true`), su asiento lo juega un bot y la partida no se traba; al reconectar vuelve a su asiento (`bot: false`).
- **Humano inactivo**: en un 1v1 donde uno no toca nada, su turno lo juega un bot a los **20.4 s** (el reloj de 20 s), y el primer vencimiento todavia no lo deja en piloto automatico.

No se probo por red (se cubre en el motor de reglas, con la hora inyectada): el tope de partida, el segundo vencimiento seguido que pasa a AFK, y la reclamada de un asiento AFK por un humano.

### El bot (`pool-bot.ts`)

`chooseBotAction(view, level, rnd)` recibe una vista de la mesa (`PoolMatch.botView(seat)`: copia de las bolas, equipo, bolas que le quedan a cada grupo, si la blanca esta en mano, si es la rotura) y devuelve `{ place, shot, thinkMs, startAngle }`. No modifica la vista y es determinista dado el generador `rnd`. Dos niveles:

- **"parejo"** (el bot de relleno): enumera tiros bola propia x tronera con la **bola fantasma** (descarta camino bloqueado, angulo de corte > 72 grados, o una bola que no puede entrar por esa boca), suma tiros suaves de **contacto** contra las bolas legales mas cercanas (el peor caso es una jugada segura, no una falta), simula los 5 mejores a tres potencias y los de contacto con **error de punteria** (5 muestras cada uno, con la misma `simulateShot`) y se queda con el de mayor valor esperado. El tiro que sale lleva error: `angleSigma` 0.018 rad y `powerSigma` 5%.
- **"flojo"** (el que cubre a un humano AFK o desconectado): no simula; toma el mejor tiro geometrico con mucho error (0.05 rad, 18%) y apoya la blanca al azar. Decide al instante.
- **La rotura**: no mueve la blanca (sale de su posicion inicial), apunta a la punta del triangulo y tira a ~0.92 de potencia, sin simular.
- **`thinkMs`** (1.2 a 2.5 s en "parejo", 0 a 0.25 s en "flojo") y **`startAngle`** son para que la capa de red lo muestre apuntando (`bi:aim`): barre desde `startAngle` hasta `shot.angle` durante `thinkMs`.

**Calibracion (medida con `check:pool`):** el error de "parejo" se eligio barriendo valores contra mesas al azar. Con 0.008 rad el bot embocaba el 58% de los tiros y el 99% del tiro facil (un jugador de torneo: demasiado para un relleno); con 0.018 queda en **37% en mesas al azar y 77% en el tiro facil**, y "flojo" en 20% y 42%. Decide en ~27 ms de media (51 ms el peor). Son valores de partida: la vara real es jugarlo.

**Partidas bot contra bot** (14 por formato, todos los asientos "parejo"; los bots piensan 1.2-2.5 s), con los topes actuales:

| Formato | Tiros por partida | Duracion mediana / p90 | Tope | Terminan por la 8 / por el tope |
| --- | --- | --- | --- | --- |
| 1v1 | 33 | 4.4 / 5.5 min | 6 | 13 / 1 |
| 2v2 | 37 | 4.4 / 5.9 min | 8 | 14 / 0 |
| 4v4 | 36 | 4.1 / 5.8 min | 10 | 14 / 0 |

Los topes originales eran 4/6/10 min y **se quedaban cortos**: con el de 4 min, 8 de 14 partidas de 1v1 entre bots (que piensan poco) llegaban al tope. Un humano piensa mas (el reloj le da hasta 20 s), asi que se subieron a 6/8/10. Cada tiro dura ~5-7 s de animacion, casi todo cola de bolas rodando lento; si las partidas con humanos resultan largas, la palanca es `MU_ROLL` (mas rozamiento de rodadura acorta esa cola), no el tope. 2v2 y 4v4 tienen ~36 tiros porque se emboca ~1 de cada 3, asi que la duracion depende de lo bien que embocan los jugadores, no del formato. Quien rompe gano 27 de 41 partidas decididas en la primera corrida (66%): muestra chica, a vigilar con mas partidas.

### Pendiente de tuning (los numeros dicen que algo esta flojo, no que esta roto)

**Duracion de las partidas**: ver el parrafo anterior. Es la pregunta de diseno mas abierta: una partida de 6 a 10 minutos es mas larga que un party game tipico.

La rotura **emboca muy poco**: 0.06 bolas por rotura (se espera del orden de 0.5 a 1) y **la blanca se va adentro el 29% de las veces**. La fisica es consistente (los chequeos pasan), asi que es calibracion: candidatos son `V_MAX` (7 m/s; una rotura de verdad ronda los 10), `POCKET_SCALE`, `E_BALL` / `E_CUSHION` y el hueco del rack. Hay que ajustarlo mirando la rotura en pantalla, no a ciegas.

### Gotcha (costo un ciclo infinito en las roturas)

**Buscar y resolver un choque tienen que usar el mismo umbral de acercamiento** (`APPROACH_EPS` en `pool-physics.ts`). La busqueda decidia "se acercan" con `dp . dv < 0` y la resolucion con la velocidad normal `vn <= 0`; para una bola que roza a otra de costado (velocidad tangente, `vn` exactamente 0) los dos discrepaban por un ulp: la busqueda veia un choque a tiempo 0, la resolucion no hacia nada, y el paso giraba 128 veces sin avanzar. Salio solo en roturas (bolas apiñadas) y no en el fuzz de mesas sueltas. Si se agrega otro tipo de contacto, que busqueda y resolucion compartan la constante.

## Decisiones del programador (cerradas)

- 3D con Three.js, cenital inclinada de base y camara baja para apuntar (ver "Camaras").
- Formatos **1v1, 2v2 o 4v4**. No hay 3v3 ni equipos desparejos (agregado el 1v1 a pedido del programador despues de la primera version, que solo tenia 2v2 y 4v4).
- Estetica de bar nocturno ("Paño y Humo").
- Metodo de simulacion aprobado: paso fijo + colision continua + deslizamiento->rodadura, **autoritativo en el server** ([SIMULATION_ARCHITECTURE.md](../../../SIMULATION_ARCHITECTURE.md), seccion 3.5).
- El resto (reglas, reparto de asientos, bots, protocolo) lo decidio el asistente y esta justificado abajo; cambiarlo es libre mientras se actualice este archivo.

## Formato y asientos (la sala puede tener cualquier cantidad de jugadores)

Una sala tiene de 1 a 8 jugadores y el juego solo admite 2, 4 u 8 asientos, asi que se elige **el formato mas chico donde entren todos los humanos** y **los asientos vacios los ocupan bots**:

| Humanos en la sala | Formato | Bots |
| --- | --- | --- |
| 1 a 2 | 1v1 | `2 - humanos` |
| 3 a 4 | 2v2 | `4 - humanos` |
| 5 a 8 | 4v4 | `8 - humanos` |

- **Reparto determinista** (igual en todos los clientes y en el server): los humanos se ordenan por `joined_at` (orden de `players()`), y se **alternan** A, B, A, B... para repartir los humanos parejo; los bots toman los asientos que sobran. Con 5 humanos en 4v4: A tiene 3 humanos + 1 bot, B tiene 2 humanos + 2 bots. Con 2 humanos en 1v1 se enfrentan entre si.
- **Orden de turnos por asientos**: A1, B1, A2, B2, ... Cada equipo avanza su propio indice cuando **su** turno termina (si el tirador sigue tirando por embocar, no avanza).
- **Por que el formato mas chico y no siempre el mas grande:** con 2 humanos un 2v2 pondria a cada uno con un bot de companero, que es peor juego que el duelo directo. El 1v1 existe justamente para ese caso. Con 1 humano juega contra un bot.
- **Por que bots y no "los que sobran miran":** en una sala de 3 o 5, dejar gente afuera con un juego elegido por votacion es injusto, y 2v2 con 3 humanos sin bot no existe. El bot es parte del v1, no un extra.
- Un bot **no cuenta como jugador** para el ranking global (ver "Puntaje").
- Un humano que se **desconecta** pasa a bot en su asiento hasta que vuelva (reclama el asiento al reconectar); mismo mecanismo que el AFK, ver "Turnos y reloj".

## Reglas (8-ball simplificado para party)

- **Grupos fijos**: el equipo A tiene las lisas (1-7), el B las rayadas (9-15). No hay "mesa abierta": una decision menos para el que recien llega. La 8 es de los dos y va al final.
- **Rotura**: la tira un equipo sorteado por el server. **La blanca sale SIEMPRE de su posicion inicial (el punto de cabeza) y no se puede mover**: el jugador solo apunta y tira; el server rechaza `bi:place` con `not_in_hand` (verificado por red) y `PoolMatch` arranca con `cueInHand = false`. Si la 8 cae en la rotura, **vuelve al punto de pie** (no pierde nadie, no gana nadie). Rack: 8 al centro, una lisa y una rayada en las puntas de atras, el resto sorteado con la semilla del partido.
- **Sin tronera cantada**: vale cualquier embocada.
- **Turno**: el que emboca **al menos una bola de su grupo** sin faltar sigue tirando (el mismo jugador). Si no, el turno pasa al otro equipo. Una bola del rival embocada por error queda abajo y le cuenta al rival.
- **Falta** (solo dos): (1) la blanca cae en tronera o sale de la mesa; (2) la blanca no toca ninguna bola. La falta le da al **otro equipo la blanca en mano** (la coloca donde quiera con un arrastre). No hay falta por "tocar primero la bola equivocada": es una regla que cansa en una fiesta.
- **La 8**: solo se puede embocar cuando todas las de tu grupo estan abajo. Embocarla asi, **ganas**. Embocarla antes, o embocarla junto con la blanca, **perdes**. (Que "tus bolas" sean las del grupo del equipo, sin importar quien las embocó.)
- **Tope de partida**: 6 min en 1v1, 8 min en 2v2 y 10 min en 4v4 (`MATCH_CAP_MS`; subidos desde 4/6/10 despues de medir partidas bot contra bot, ver "ESTADO"). Al cortarse gana el equipo con **menos bolas de su grupo en la mesa**; empate = empate (los dos equipos ganan por igual, ver "Puntaje").

## Turnos y reloj

- **Reloj por turno: 20 s** (`TURN_MS`, valor de partida; con la blanca en mano, 25 s). Corre en el server.
- **Si se acaba**, tira un bot por vos (nivel "flojo": apunta a una bola propia con error grande y potencia media), asi la partida nunca se frena. Es lo que impide que un jugador presente pero quieto trabe la mesa.
- **Dos turnos seguidos vencidos** (`IDLE_TURNS_TO_BOT`, 2): el asiento pasa a bot hasta que el humano vuelva a hacer algo (cualquier input suyo lo reclama).
- **Desconectado**: el bot juega su turno **sin esperar** el reloj entero. Es la misma red que `presentPlayers()` en las salas por turnos (ver "Que un jugador se desconecte no puede trabar la sala" en el CLAUDE.md raiz): no se le espera el turno al que se fue.
- **El tope de partida es la red de seguridad final.** Aun con todos AFK, el server termina el partido.

## Metodo de simulacion

Arquetipo "Billar / Pool" ([SIMULATION_ARCHITECTURE.md](../../../SIMULATION_ARCHITECTURE.md) seccion 3.5). Resumen de lo aprobado:

- **`simulateShot(estado, tiro)` es una funcion pura** en `server/src/games/pool-physics.ts`: toma el estado de la mesa y un tiro (angulo, potencia, punto de golpe) y devuelve **todo el desenlace** (tramos de movimiento de cada bola, eventos, estado final). Corre **de una sola vez al recibir el tiro**, no en tiempo real: simular 10-15 s de partida cuesta milisegundos. De ahi sale casi todo lo bueno: es testeable en Node sin red, y el bot la reusa para evaluar tiros.
- **Paso fijo** (`STEP_DT`) con **tiempo de impacto analitico** esfera-esfera (la cuadratica de la seccion 3.5) y esfera-banda. Nada de detectar solapamiento y empujar: a potencia maxima la blanca recorre varios radios por paso.
- **Dos fases de rozamiento**: la bola **desliza** (fricción cinetica hasta que la velocidad de contacto con el paño se anula) y despues **rueda** (rodadura, muy baja) hasta frenar. El **efecto** (top, retroceso, lateral) entra como spin inicial del golpe.
- **Troneras**: circulo de captura en cada una; la bola cuyo centro entra se saca de la simulacion.
- **Reposo**: bola quieta con `|v|` y `|w|` bajo un umbral. Las reglas **se evaluan recien cuando toda la mesa esta quieta**.
- **Cero allocations** en el loop: `Float32Array` para posicion, velocidad, spin y la cola de eventos preasignada.

### Constantes de partida (a ajustar jugando; NO medidas)

Unidades en metros y segundos. Mesa de 9 pies: zona de juego 2.54 x 1.27 m. Estan en `constants.ts` (cliente) y duplicadas en el server (regla de decoupling, como las constantes de PONG).

| Constante | Valor | Nota |
| --- | --- | --- |
| Radio de bola `BALL_R` | 0.02857 | 5.715 cm de diametro, el estandar. |
| Restitucion bola-bola | 0.95 | |
| Restitucion banda | 0.75 | |
| Rozamiento cinetico paño `MU_SLIDE` | 0.2 | Fase deslizando. |
| Rozamiento de rodadura `MU_ROLL` | 0.01 | Desaceleracion ~0.1 m/s^2. |
| Rozamiento bola-bola | 0.05 | Genera el "throw" leve. |
| Velocidad maxima de tiro `V_MAX` | 7 m/s | La rotura puede ir a este tope. |
| Boca de tronera | ~1.15x la real | Un poco mas permisiva: es una fiesta. |

### Fuera del v1 a proposito

Masse / elevacion del taco, spin que cambia el rebote de banda con fidelidad (v1: solo un acoplamiento simple del spin lateral), bolas que saltan de la mesa. Se pueden sumar despues sin cambiar el contrato de red.

## Arquitectura

**Server** (hecho, `server/src/games/pool.ts`, namespace `/poolnight`, prefijo `bi:`; `pl:` ya es de Pista Loca): `PoolSim` es la capa de red de `PoolMatch` (reglas) + `simulateShot` (fisica) + `chooseBotAction` (bots). **No simula en tiempo real**: cuando llega un tiro valido, `PoolMatch.takeShot` lo resuelve de una vez y se difunde el desenlace. Lo que hace `PoolSim` por su cuenta:

- **Ciclo**: estado scopeado por **ronda** (`round` en el `bi:join`, como Neon Drift y La Cuerda: una ronda mas nueva descarta el estado, una vieja se ignora). La partida **larga sola** cuando estan conectados todos los del `roster`, o a los 8 s (`START_GRACE_MS`) con los ausentes jugando por bot. El asiento `s` es el indice del `roster`: los humanos ocupan los primeros asientos. Un nickname que no esta en el `roster` mira (`seat = -1`): recibe todo y no puede actuar.
- **Un tick de 100 ms** (`setInterval`, como La Cuerda: sin timers sueltos que se pierdan) maneja todo lo que depende del tiempo: el tope de partida (`endByCap`), el turno vencido de un humano (`handleTimeout` y bot "flojo") y los turnos de los asientos en piloto automatico.
- **El bot juega "visible"**: planea al llegar su turno (`BotPlan`), y mientras "piensa" difunde `bi:aim` a 10/s (barrido de punteria y carga de potencia); apoya la blanca a ~30% del pensar y tira al final. Un humano que vuelve a tocar algo (`bi:place` / `bi:shot`) le saca el turno al bot que lo cubria. Tras 3 fallos seguidos de un bot hay una jugada de emergencia (`emergency`) para que la mesa nunca se cuelgue.
- **Un tiro viaja en UN mensaje**, `bi:play`, con los tramos, los eventos y el **estado posterior**. No se difunde un `bi:state` aparte al resolver un tiro: si las bolas finales llegaran mientras el cliente anima, se veria un salto. El cliente adopta el estado de `bi:play` **cuando termina de animar**. `bi:state` solo se difunde por cambios ajenos a un tiro (conexiones, AFK, fin por tope).
- **`bi:shot` puede traer `x`, `z`**: si la blanca esta en mano, el server la apoya y tira en un solo paso. Sin eso habria carrera entre el ultimo `bi:place` (que el cliente manda a ~15/s mientras arrastra) y el tiro. `bi:place` sigue existiendo para que los demas vean moverse la blanca (`bi:cue`).

**Cliente** (`src/games/poolnight/`, hecho). Three.js sin framework, todo dibujado por codigo (canvas y primitivas), sin assets salvo la portada:

- `main.ts`, `meta.ts`, `style.css`; `games/poolnight/index.html`.
- `game/Game.ts` — el orquestador. Conecta el socket, guarda el desfase de reloj (`serverNow()`, afinado con `bi:ping`/`bi:pong`: gana la muestra de menor RTT), adopta el estado, reproduce cada tiro (`updatePlayback`), decide de quien es el turno (`updateTurn`), arma y desarma los controles propios (`arm`/`disarm`) y reporta el resultado. En sala arranca solo con `onStart` (no hay Enter) y la cuenta regresiva 3/2/1/YA sale del `turnStartAt` que manda el server, con el pitido.
- `game/MotionPlayer.ts` — evalua los tramos del `bi:play` en cualquier instante (deslizar, rodar, quieta, embocada). **No decide nada.** Es el evaluador que se midio con 0.25 mm de error.
- `game/Table.ts` — la mesa y el salon. **La mesa sigue la anatomia de una de 9 pies (reglamento WPA)**, ver "La mesa" abajo. Ademas: la lampara (con un `SpotLight` con sombras), el piso, el ventanal con la ciudad, el cartel de neon "Poolnight" y la copa roja (texturas de canvas). **La lampara solo se ve desde camaras bajas** (`setLampVisible`): desde la cenital taparia la mesa.
- `game/BallMeshes.ts` — las 16 bolas: esfera con barniz (`MeshPhysicalMaterial` con `clearcoat`) y textura de canvas con el numero y la franja. Giran con la velocidad angular de la fisica (`spin`), asi el efecto se ve en como rota el numero. La caida a la tronera es una animacion de 0.45 s (`drop`).
- `game/Cue.ts`, `game/AimGuide.ts` — el taco (origen en la punta, `setPose` con `pull`; **sube la empuñadura lo justo para pasar por encima de la madera** cuando la bola esta cerca de la banda de atras, hasta ~49 grados) y la guia sobre el paño: linea punteada hasta el primer contacto, bola fantasma y las dos salidas. Es pura geometria; **no predice el efecto ni las bandas**, a proposito.
- `game/CameraRig.ts` — las cuatro camaras, con inercia (suavizado exponencial). Plan, aim, action y spectator; en vertical (celu) la camara de plan rota 90 grados. **La baja (`aim`, "camara de la bola") va sobre el taco**, centrada en la linea de tiro como en los juegos de pool de verdad: `AIM_BACK` (0.85 m) atras de la blanca medidos a lo largo del taco y `AIM_ABOVE` (14 cm) por encima de su eje. **Sigue la inclinacion del taco** (`cueElevation`, suavizada): cuando la blanca esta pegada a la banda y el taco se levanta para pasar la madera, la camara sube con el y nunca lo atraviesa. **Encuadre fijo**: apunta de forma que la blanca quede `AIM_BALL_BELOW` (11 grados) por debajo del centro de la pantalla; con un punto de mira fijo en el paño quedaba cortada abajo o se iba de cuadro con el taco levantado. Su giro (`yaw`) se suaviza por el camino corto (orbita a la blanca en vez de cortar la cuerda), y una vez llegada se pega a la orbita con un suavizado rapido (k 18 contra 4.2 del vuelo entre camaras). **La de accion esta quieta** (no persigue las bolas).
- `game/InputController.ts` — mouse, teclado y tactil (ver "Controles").
- `game/Hud.ts` — DOM sobre el canvas: equipos con sus bolas restantes, reloj de turno, avisos, potencia, selector de efecto, botones y pantalla de resultados.
- `game/SoundEffects.ts` — sintetizado con Web Audio, pensado para sonar a salon de noche y no a bip de videojuego. `SoundEngine` (recibe cualquier `BaseAudioContext`) y la fachada `SoundEffects`. Todo pasa por un pasa-bajos suave (6.2 kHz), una **reverberacion corta de salon** (impulso de ruido que se apaga, 1 s), un compresor y un **recorte suave tanh** que acota el pico en 0.95. Los sonidos de la mesa:
  - **Bola contra bola** (`ball`): el "clack" de la resina, que es sobre todo un **transitorio brillante y cortisimo** (ruido en banda de ~3.3 kHz, 14 ms, ataque de 1.2 ms) mas un timbre inarmonico (2150 Hz x 1 / 1.34 / 1.69) que se apaga en 13-28 ms. La version anterior tenia parciales largos y graves y **sonaba a marimba**: el clack no tiene que ser una nota.
  - **Banda** (`cushion`): golpe sordo (glide 170 -> 78 Hz) con un roce de paño; la goma y el fieltro se comen el agudo.
  - **Tronera** (`pocket`): el golpe contra la boca y despues el asentarse en el cuero de la bolsa (dos golpes graves desfasados 90 ms).
  - **Taco** (`cue`): la suela de cuero, mas grave y mas corta que el choque de dos bolas.
  - **Rodado** (`rolling`): un murmullo grave (ruido filtrado 60-260 Hz, en loop de 2 s para que no se note la repeticion) cuyo volumen sigue la **suma de las velocidades** de las bolas en movimiento; `Game.updatePlayback` lo alimenta cada cuadro (`SoundEffects.setRolling`) y lo apaga una vez al terminar el tiro. La fuente es una sola y queda andando en silencio: no se crea una por tiro.
  - El volumen de un choque crece con la **raiz de la velocidad** de impacto del evento; los choques simultaneos de una rotura se reparten el volumen (1/raiz del numero en 90 ms) y a partir de 14 juntos se descartan los flojos. **Hasta el primer gesto del usuario se saltea en silencio**: Chrome avisa en la consola cada vez que se intenta arrancar audio sin gesto, y en sala nadie toca nada antes de la rotura. La cuenta 3/2/1 es una nota suave y el "YA" una mas alta (`playCountdownTick(final)`).
- `game/PoolSocket.ts`, `PoolProtocol.ts` (duplicado del server), `constants.ts`, `devRoom.ts`.

### La mesa (`Table.ts`), fiel a una real

Se rehizo siguiendo la anatomia de una mesa de 9 pies (reglamento WPA), no a ojo. Las medidas que comparten varios modulos estan en `constants.ts` (`CUSHION_W`, `RAIL_H`, `FACING_K_*`, `POCKET_HOLES`):

- **Almohadones forrados con el mismo paño** que la cama (un solo material), no una "goma" de otro color. Cada uno es una malla propia (`Table.cushion`): el perfil de la seccion barrido a lo largo, con la nariz a 36 mm de altura (63.5% del diametro de la bola, donde la toca de verdad), la cara de abajo apenas hundida y la parte de arriba casi al ras de la madera.
- **Los cortes de las bocas con los angulos del reglamento**: 142 grados en las esquinas y 104 en el medio. Son mayores a 90, asi que el corte se inclina hacia la tronera y **la garganta es mas angosta que la boca** (en las esquinas: 13.3 cm entre narices, 11.3 cm atras). Eso es lo que se ve "en angulo" en las mesas de verdad y en el 8 Ball Pool de Miniclip. **Los cortes empiezan exactamente en los nudos de la fisica** (`CORNER_GAP` / `SIDE_GAP`): donde rebota la bola es donde se ve la punta del almohadon.
- **Agujeros redondos de verdad, con profundidad**: un circulo por tronera que pasa justo por el fondo de los dos cortes de su boca (`POCKET_HOLES`, calculado, no a mano), con una bolsa negra que baja 5.5 cm y un forro sobre el corte de la madera (si no, adentro del agujero se veia la madera, como un balde). El paño entra en la garganta hasta el borde del agujero (el "estante" de la boca): el paño y la madera comparten el mismo borde (`pocketLoop`), uno con el arco de adentro de cada agujero y la otra con el de afuera.
- **La baranda a 48 mm** sobre el paño (estaba en 75, demasiado alta), 13 cm de ancho, una sola pieza extruida con el canto redondeado, herrajes de laton alrededor de cada agujero y **diamantes al ras** cada octavo del largo (3 por tramo). Debajo, un faldon por fuera de las bolsas y las patas.
- **La bola que cae a una tronera rueda hacia el centro del agujero y se hunde** (`BallMeshes.drop`), en vez de achicarse: una bola de verdad no cambia de tamaño.
- **Reflejos**: las bolas, la madera y el laton reflejan un entorno armado por codigo al arrancar (`Game.buildReflections`: el paño verde abajo y la lampara encendida arriba, pre-filtrado con `PMREMGenerator`). Va **material por material** (`BallMeshes.setReflections` 0.5, `Table.setReflections` 0.55), **no** en `scene.environment`: ver "Rendimiento". Sin el, la mitad de abajo de cada bola quedaba negra; con el toma el verde del paño, como en un bar. La luz de relleno (`HemisphereLight`) tambien tiene el verde del paño como color de abajo, por lo mismo.

Gotchas de la mesa:

- **Los almohadones NO proyectan sombra.** Con material de doble cara el mapa de sombras se los come a si mismos y salian negros (se vio asi en la esquina). Su sombra sobre el paño es casi nula igual.
- **La altura de la baranda se usa en dos lados**: `RAIL_H` en `Table.ts` y en `Cue.ts` (el taco levanta la empuñadura para pasar por encima). Viene de `constants.ts`; no duplicarla.
- **Para mirar la mesa de cerca** sin depender de la camara del juego hay un `__poolnight.peek([x, y, z], [x, y, z])` en dev (ver "Verificar el juego").

### Rendimiento

Medido en Chromium headless (SwiftShader, o sea por software: los numeros absolutos dependen mucho de la carga de la maquina, asi que **siempre comparar contra otro juego 3D en la misma corrida**; en la ultima medicion, con la maquina cargada, mini-golf daba 19 fps, city-bloxx 8 y Poolnight 5). Lo que se encontro y se hizo:

- **El costo es de GPU, no de JS.** Por cuadro: 0.7 ms de JS y ~35 ms de la llamada a `render()`; el resto del cuadro se va en el proceso de GPU ejecutando los comandos. Sube con la resolucion, asi que es sobre todo relleno de pixeles.
- **En regimen no hay trabajo periodico escondido**: con `gl.linkProgram` y `gl.texSubImage2D` interceptados durante 5 s, cero recompilaciones y cero subidas de texturas (las 16 texturas de las bolas se suben una sola vez al arrancar).
- **El reflejo va por material, no en `scene.environment`.** Puesto en la escena lo pagaba tambien el paño, que ocupa casi toda la pantalla y es mate: no se notaba y encarecia cada pixel.
- **La madera no lleva barniz (`clearcoat`)**: laca comun con reflejo (`MeshStandardMaterial`, roughness 0.3). La baranda ocupa mucha pantalla en la camara baja y la segunda capa duplica el costo de cada pixel; las bolas si lo conservan (son chicas en pantalla y el brillo es lo que las hace leer como bolas).
- **Lo mate es `MeshLambertMaterial`**: paño, almohadones, forros, piso, paredes y mueble.
- **Calidad adaptativa** (`Game.adaptQuality`): si en los primeros 120 cuadros con la mesa a la vista el promedio queda debajo de ~45 fps y la pantalla es de alta densidad, baja la resolucion interna a 1x. Pasa una sola vez.
- **Lo que NO movio la aguja** al probarlo (para no volver a intentarlo): apagar las sombras, sacar el HUD del DOM, y esconder por separado cualquier grupo de materiales. El rendimiento en una GPU de verdad sigue sin medirse.

### Que ve cada uno

- **El que tira**: el taco sigue a su cursor y la guia se dibuja en el color de su equipo; carga la potencia y el taco se aleja de la bola. A los demas les llega `bi:aim` (~10/s, suavizado) y ven el taco de quien apunta.
- **Mientras se anima un tiro**: camara de accion que sigue el centro de lo que se mueve; el taco de quien tiro avanza hasta la bola justo antes de `startAt` (el golpe) y desaparece.
- **El tirador cambia**: si no le toca enseguida, camara de espectador (lateral con deriva lenta); en 1v1 siempre le toca enseguida al otro, asi que ahi se queda en la de planificacion.

### Gotchas del cliente

- **El sonido se mide sin escucharlo.** No se puede oir en headless, pero `SoundEngine` se renderiza sin conexion con un `OfflineAudioContext` (en Playwright: `await import("/src/games/poolnight/game/SoundEffects.ts")` desde la pagina del juego en dev) y se miran el pico, el arranque (lo mas alto del primer milisegundo contra el pico: 0% en todos, o sea sin click), la cola (llega a silencio) y el peor caso de una rotura (40 choques fuertes en el mismo instante: 0.95, sin saturar). Niveles medidos (pico): golpe de bola 0.15 (suave) a 0.30 (fuerte), banda 0.10 a 0.21, tronera 0.33, taco 0.08 a 0.15, cuenta 0.17 y 0.22, falta 0.31, ganar 0.39, perder 0.30; el rodado queda en -33 dB RMS con las bolas andando y en -90 dB (silencio) al pararse. **Los jingles no tienen que pasar al golpe mas fuerte**: la primera pasada los dejo en 0.5-0.64 y sonaban mas fuertes que la partida. Lo que **no** se midio es como suena: es oido humano, no una cifra.
- **Las troneras son cortes del marco, no bloques agregados.** La primera version armaba la caja de las troneras del medio con una pieza de madera corrida hacia afuera: sobresalia del borde. Despues fueron muescas y embudos sobre la madera; ahora siguen la anatomia real (ver "La mesa").
- **El taco atravesaba la madera** cuando la bola estaba cerca de la banda: con 1.45 m de largo y una inclinacion fija de 0.1 rad, la empuñadura quedaba por debajo del tope de la madera. `Cue.setPose` mide cuanto falta hasta el borde del paño y levanta la empuñadura para pasar 1.6 cm por encima de la baranda (`RAIL_H`).
- **La camara baja y el taco.** Puesta a la altura del taco, este se veia como un poste negro en el medio de la pantalla; la correccion siguiente (por encima del hombro, corrida al costado) torcia la linea de tiro y, con el taco levantado junto a la banda, se le metia adentro. La version actual va **sobre** el eje del taco y sube con su inclinacion (ver `CameraRig`).
- **La camara de accion no tiene que perseguir las bolas.** Seguia el centro de lo que se mueve, y ese centro salta cuando una bola se frena o cae a una tronera: la camara se sacudia.
- **Las sombras tienen que cerrar el mueble.** Si la cubierta, el faldon y las patas no proyectan sombra, la luz de la lampara los atraviesa y las bolas dibujan su sombra en el piso de abajo. Se vio como **cinco circulos negros bajo la mesa** (las cinco bolas del fondo del triangulo) en la camara vertical del celu. Se arreglo con `castShadow` en el mueble (`Table.buildBody`).
- **`PCFSoftShadowMap` esta deprecado** en esta version de Three (avisa en la consola y cae a `PCFShadowMap`): se usa `PCFShadowMap`.
- **El tablero que llega con un tiro no se adopta hasta que termina de animar.** `bi:play` trae el estado posterior, pero si se aplicara al llegar, las bolas saltarian a su lugar final en medio de la animacion. `applyState` solo copia las bolas cuando no hay un tiro en curso, y `finishPlay` las adopta al terminar.
- **Un `bi:state` que llega durante la animacion** (alguien se conecta, un AFK) no pisa las bolas por la misma razon.
- **La ayuda del turno tiene que limpiarse** para quien no tira (se quedaba pegada la del turno anterior), y la cuenta regresiva se esconde en cuanto `shots > 0` (se quedaba el "YA" colgado tras la rotura).

### Como llega la animacion de un tiro (decision clave)

El server manda un **`bi:play`** con la lista completa de **tramos**: para cada bola, y cada vez que algo cambia su movimiento (arranque, choque, banda, pasar de deslizar a rodar, frenar, embocar), un registro `{ bola, t, posicion, velocidad, spin, fase }`. Entre dos registros el movimiento es **analitico** (aceleracion constante opuesta a la direccion de movimiento), asi que el cliente **evalua la posicion y la rotacion en cualquier instante** sin tick propio y sin repetir la logica de colision.

- Todos los clientes arrancan en la misma hora del server (`startAt`, con un pequeño margen de ~150 ms) usando el offset de reloj del cliente, como PONG y Papa Caliente (`bi:ping` / `bi:pong`). Todos ven el golpe a la vez.
- No se confia en que dos navegadores simulen igual por su cuenta (`Math.sin/cos` pueden diferir entre motores): **la verdad la manda el server y el cliente solo reproduce**.
- El `bi:play` lleva tambien los **eventos** (choque bola-bola, banda, embocada, con su velocidad de impacto) que disparan sonidos y efectos, y el **resultado de las reglas** (falta, quien sigue, bolas embocadas, si termino el partido).
- Tamaño: una tirada son unas pocas decenas de registros por bola en movimiento; es una rafaga corta por tiro, **no un flujo**. El trafico de este juego esta lejisimos del tope del canal.

El registro ya esta fijado en `pool-physics.ts` como `Segment` (`{ b, t, x, z, vx, vz, wx, wy, wz, ph }`, con `ph` = `PHASE_SLIDE` / `PHASE_ROLL` / `PHASE_REST` / `PHASE_POCKETED`). Solo se emiten segmentos de las bolas que **se movieron**: las demas siguen donde estaban. Se emite uno al arrancar, en cada choque o rebote, en cada cambio de fase (deslizar a rodar, rodar a quieta) y al embocar. Para evaluar la bola en `t + s` el cliente aplica, segun `ph`: **SLIDE** aceleracion constante `-MU_SLIDE * g` en la direccion de la velocidad del punto de contacto `u = (vx + R wz, vz - R wx)` hasta `|u| / (3.5 MU_SLIDE g)`; **ROLL** desaceleracion constante `MU_ROLL * g` a lo largo de la velocidad, con `wx = vz / R` y `wz = -vx / R`; **REST** quieta; **POCKETED** oculta. Es lo unico de la fisica que hay que duplicar en el cliente (sin logica de colision). La regla no se negocia: el servidor describe, el cliente evalua.

### Mensajes (prefijo `bi:`; tipos `Bi*` en `server/src/protocol.ts`, que se duplican en el cliente)

| Mensaje | Direccion | Que lleva |
| --- | --- | --- |
| `bi:join` | c -> s | `{ code, nickname, roster, round }` |
| `bi:init` | s -> uno | `{ seat, state }`: mi asiento (-1 si miro) y el estado completo. Tambien al reconectar. |
| `bi:state` | s -> todos | `BiState`: fase, asientos (con `bot` y `on`), las 16 bolas aplanadas `[x, z, vivo]`, tirador, blanca en mano, bolas que le quedan a cada grupo, `turnStartAt` / `deadline` / `capAt`, `winner` y `places`. |
| `bi:play` | s -> todos | Un tiro: `{ id, seat, startAt, dur, segs, ev, foul, own, opp, eight, respot, continues, next, hand, ended, nextTurnAt, state }`. `segs` son tuplas `[bola, t, x, z, vx, vz, wx, wy, wz, fase]`; `ev` son `[t, tipo, a, b, velocidad, x, z]` con tipo 0 taco / 1 bola / 2 banda / 3 tronera. |
| `bi:aim` | c -> s -> resto | `{ a, p }` / `{ s, a, p }`: angulo y potencia del que apunta. **Cosmetico**, a ~10/s (el server descarta lo que llegue a menos de 70 ms del anterior). Jamas fuente de verdad. |
| `bi:place` | c -> s | `{ x, z }`: acomoda la blanca. Se reenvia como `bi:cue`. |
| `bi:cue` | s -> todos | `{ x, z }`: donde esta la blanca mientras se acomoda (la acomode un humano o un bot). |
| `bi:shot` | c -> s | `{ a, p, ox, oy, x?, z? }`: angulo, potencia 0-1, punto de golpe (-1 a 1) y, si esta en mano, donde apoyar la blanca. Nunca posiciones de bolas. |
| `bi:reject` | s -> uno | `{ why }` con el `code` del `PoolError` (`not_your_turn`, `too_early`, `not_in_hand`, `bad_spot`, ...). |
| `bi:ping` / `bi:pong` | ambos | `{ c }` / `{ c, t }`: la hora del server para el offset de reloj. |

No hay `bi:end`: el final viaja en el `ended` de `bi:play` (con `state.winner` y `state.places`) o, si fue por tope, en un `bi:state`.

El server **valida** que el tiro venga del asiento que tiene el turno, que la potencia este en rango y que la posicion de la blanca sea legal (no solapada, dentro de la zona permitida). Mismo nivel de confianza que el resto del repo (el cliente declara su nickname); no hay nada que ganar adulterando un tiro que el server vuelve a simular.

## Bots

`server/src/games/pool-bot.ts`. Un unico nivel, "parejo". Corre en el server, **fuera de cualquier tick**:

1. Enumera candidatos: cada bola propia x cada tronera, con la **bola fantasma** (el punto a `2r` detras de la bola objetivo, en linea con la tronera), descartando los que tengan una bola en el medio.
2. Puntua por dificultad (angulo de corte, distancia blanca-objetivo y objetivo-tronera, riesgo de embocar la blanca).
3. Para los mejores candidatos, **simula con `simulateShot`** unas decenas de variantes con error de punteria (Monte Carlo acotado; es legitimo aca porque esta fuera del loop, ver seccion 6.4 de `SIMULATION_ARCHITECTURE.md`) y se queda con la de mayor valor esperado.
4. **Ejecuta con error**: sigma de angulo y potencia para que falle a veces. Y **espera 1-2.5 s** apuntando visiblemente (manda `bi:aim` como un humano): que se sienta jugador, no maquina.

Para el bot que cubre un AFK se usa el mismo codigo con mas error ("flojo").

## Camaras (cuatro, `CameraRig.ts`)

1. **Planificacion (base)**: cenital inclinada ~60-70 grados, la mesa **siempre entera**. En un celular en vertical la camara **rota 90 grados** para que el eje largo de la mesa siga el eje largo de la pantalla.
2. **Apuntado**: la camara baja detras de la blanca, mirando la linea de tiro, para el contacto fino y el efecto. Se alterna con un boton / la tecla C. Es el "primera persona" bien usado: un modo, no la vista base.
3. **Accion**: durante la jugada sigue con contencion; **camara lenta** solo en la rotura, en embocar la 8 y en una embocada de varias bandas.
4. **Espectador**: mientras tira otro, una vista lateral suave tipo transmision; **vuelve sola a planificacion** unos segundos antes de que te toque. En 4v4 esto importa: entre tiro y tiro de un mismo jugador pasan 7 turnos ajenos.

Las transiciones tienen inercia, jamas un corte. Ninguna camara puede ocultar una bola de la mesa cuando es tu turno.

## Controles (`howTo` en el `meta.ts`)

- **Apuntar**: con el mouse la mira sigue al cursor sobre el paño; con A / D (Shift = fino) gira; con el dedo se arrastra por la mesa.
- **Potencia**: mantener el clic y **arrastrar hacia atras** (al reves de la mira; 0.55 m de arrastre sobre el paño = potencia maxima) y soltar para tirar. Con el teclado, W / S cargan y ESPACIO tira. **La barra NO es lineal con la velocidad**: es una curva exponencial (`POWER_EXPONENT` = 2.2 en `constants.ts`, `barToShotPower`), asi que la mitad de abajo da tiros suaves y la fuerza de verdad queda para el final: 30% de la barra = 0.5 m/s, 50% = 1.5 m/s, 70% = 3.2 m/s, 100% = 7 m/s. La conversion es del cliente; el server sigue recibiendo la fraccion de `V_MAX` (por eso los bots, que piden velocidades en m/s, no cambian). En el celu, la barra vertical de la derecha (se arrastra) y el boton TIRAR. Clic derecho o Esc cancelan la carga. Mientras se apunta, las bolas **no** se mueven.
- **Efecto**: se toca la bolita blanca de la esquina inferior izquierda donde se quiere pegarle (doble clic la vuelve al centro). Se limita a `MAX_OFFSET` (0.5 del radio): mas alla la blanca "se pifia".
- **Camara**: C o el boton CAMARA alterna entre planificacion y apuntado (baja, por encima del hombro). **Con la camara baja la mira es relativa**: el mouse GIRA la mira (`RELATIVE_SENS` 0.0018 rad por pixel, Shift = fino; con 0.0028 un movimiento chico de muñeca barria demasiada mesa) y para cargar se arrastra hacia abajo (260 px = potencia maxima). Con la cenital el mouse señala un punto de la mesa (la camara esta quieta y la cuenta es directa). Con la baja eso no se puede: la camara orbita con la mira, asi que el punto de la mesa bajo el cursor se mueve mientras uno apunta (un lazo realimentado, que era lo que se sentia raro).
- **Blanca en mano** (solo tras una falta del rival; **la rotura sale de la posicion inicial y no se puede mover**): el cursor mueve la blanca y el clic la apoya (o ESPACIO en el lugar). Se valida con el mismo criterio que el server (`canPlace`: dentro de las bandas, sin pisar bolas ni nudos; en la rotura, detras de la linea de cabeza) y un lugar invalido avisa en vez de mandarse.

La **linea de punteria** muestra solo hasta el primer contacto (la bola fantasma y las dos direcciones de salida), calculada en el cliente con pura geometria. **No predice el efecto**, a proposito: ahi esta la dificultad.

El listener de entrada va sobre el `container`, no sobre el canvas, y los controles del HUD frenan su `pointerdown` para no cargar un tiro (ver "El toque de arranque no puede colgar del canvas" en el CLAUDE.md raiz; aca el arranque es automatico, pero la regla del listener se respeta).

## Puntaje y ranking

El juego es server-side y su puntaje de sala es una **colocacion**, asi que sigue la rama de `word-bomb` / `basta` / `hot-potato`: **`ranking: "wins"`**.

- Cada humano reporta con `reportScore(score, { place, players })`: el equipo ganador es `place = 1`, el perdedor `place = 2`, y un empate **`place = 1` para los dos**. `players` son los **humanos** de la sala.
- Con `humanos < 2` (un solo humano contra bots, o sea el 1v1 contra un bot) se reporta `{ ranked: false }`: una partida contra bots no puede farmear victorias.
- Los bots nunca reportan nada.
- Los ceros de "sin conexion" y de quien no tiene asiento se reportan con `{ ranked: false }`, como en Marea de Lava.
- Como los puntos de la sala salen de `rankRound`, **verificar al cablear como trata los empates** (hay muchos: todo el equipo ganador queda a la par). Ver `src/shared/room/points.ts`.
- No monta un `LeaderboardPanel` propio: el tablero se ve desde el boton "Ranking" de la tarjeta de la landing.

## `meta.ts`

`id: "poolnight"`, `title: "Poolnight"`, `category: "Party"`, `roomsOnly: true`, `accent: "#ffb54a"` (el neon del titulo), `order: 1040` (el siguiente libre despues de La Cuerda, 1030), `added: "2026-10-02"`, `mobile: false` (ver "Movil"), `roomTimeLimitSec: 720` (red por si el server se cae despues de largar: el server corta solo a los 6 / 8 / 10 min) y `scoring: { direction: "higher", ranking: "wins" }`. Tiene `howTo` con cuatro acciones (Apuntar, Potencia, Efecto, Camara). La portada es la que puso el programador en `docs/` (`Noches de billar bajo neon.png`), comprimida a 800x800 con `scripts/compress-covers.py`.

## Movil

`mobile: false` por ahora. El apuntado tactil esta (arrastrar por la mesa para apuntar, barra lateral para la potencia, boton TIRAR y la bolita de efecto), y se vio en **emulacion** (Chromium a 390x844 con touch): la camara de plan rota 90 grados y la mesa queda vertical, el HUD entra sin desborde horizontal (`scrollWidth` = `clientWidth` = 390) y no hubo errores de consola. **No se probo en un telefono real**, y es lo mas delicado (que un dedo no tape el tiro). Cuando ande de verdad, poner `mobile: true`.

## Por probar (sin medir todavia)

Lo de la fisica ya esta verificado (ver "ESTADO"). Falta, antes de dar el juego por listo:

- **Fisica, lo que los chequeos no cubren**: el efecto lateral y el "throw" entre bolas solo se probaron por los invariantes del fuzz (energia, solapes), no contra un resultado conocido; el rebote de banda con spin lateral es un acoplamiento simple. Mirarlos jugando.
- **Ritmo del 4v4**: medir cuanto espera un jugador entre sus tiros. Si es mucho, mitigar con la camara de espectador, las reacciones rapidas entre companeros (como `wb:emote` de Bomba Palabra) o un reloj mas corto.
- **Duracion real con humanos** de un partido 1v1, 2v2 y 4v4 contra los topes de 6, 8 y 10 min. Con bots solos ya se midio (ver "ESTADO"); un humano piensa mas, asi que se esperan partidas mas largas.
- **Rendimiento en una GPU de verdad** (ver "Rendimiento"): en headless solo se midio por software. Si se suma la postproduccion (bloom, profundidad de campo), tener niveles de calidad y bajar solo en celu.
- **Espectadores de sala**: el server ya los trata (un nickname que no esta en el `roster` mira: `seat = -1`, recibe todo y no puede actuar) y el cliente muestra el estado sin controles, pero **no se probo** un espectador de verdad.
- **El final por la sala real**: `reportScore` al ranking global con `{ place, players }` y el tablero final de la sala (ver "Que falta").
- **Postproduccion**: bloom y profundidad de campo del `DESIGN.md` **no estan hechos** (solo la vineta, en CSS). Y la camara lenta en la rotura y en la 8, tampoco.
- **La rotura**: la fuerza maxima y la dispersion tienen que dar un rack que se abra de forma divertida y no siempre igual.

## Verificar el juego

`devRoom.ts` reemplaza a la sala sin Supabase, **solo en dev**: `/games/poolnight/?dev=Ana&roster=Ana,Beto&code=TEST` y una pestaña por nickname (cada jugador en su propio `browserContext` de Playwright: dos pestañas del mismo contexto se duermen entre si), contra un game server local (`PORT=8787 npx tsx src/index.ts` dentro de `server/`, y `VITE_GAME_SERVER_URL=http://localhost:8787 npx vite` en la raiz). El resultado va a la consola y a `window.__poolnightResult`.

En dev el `Game` expone `window.__poolnight` (`project(x, z, y?)` de mesa a pixeles de pantalla, `state()`, `seat()`, `angle()`, y `peek(camara, mira)` que fija la camara para inspeccionar una parte de la mesa; `peek(null)` la devuelve al juego): sirve para que Playwright apunte con el mouse sin adivinar coordenadas. En el build no existe (`import.meta.env.DEV`).

Cosas que costaron tiempo al probarlo:

- **El `code` de la sala tiene que ser el mismo en todas las pestañas.** Armarlo con `Date.now()` dentro del `goto` de cada una da dos salas de una persona cada una, y cada pagina ve al otro como desconectado (tachado y con "BOT").
- **"La partida nunca comienza y se da por finalizada" = el cliente no llega al server.** Sin `bi:init` el cliente se rinde, reporta `0` con `{ ranked: false }` y, como todos hacen lo mismo, la ronda se cierra. Las dos causas reales: (1) el `.env` apunta `VITE_GAME_SERVER_URL` al server de **produccion**, que esta caido (Cloudflare 530 cuando se probo) o es una version vieja sin el namespace `/poolnight` (socket.io contesta `Invalid namespace`); (2) nadie escucha en esa URL. Para probar en local hay que levantar `server/` (`npm run dev`, puerto 8787) y apuntar Vite a el: lo comodo es un **`.env.local`** en la raiz con `VITE_GAME_SERVER_URL=http://localhost:8787` (gitignorado por `*.local`, Vite lo prioriza sobre `.env` y reinicia solo al crearlo); tambien sirve la variable del entorno. **Ojo con el `tsx watch` del server**: si arranca con el puerto 8787 ocupado se cae y se queda esperando cambios, **vivo pero sin escuchar**; `Get-NetTCPConnection -State Listen` lo delata, y tocar cualquier archivo de `server/src` lo reinicia. Desde que el cliente maneja `connect_error` el cartel dice cual de las dos es: con namespace invalido se rinde a los ~2 s ("esta vivo pero es una version vieja, sin Poolnight"); sin server, a los 12 s ("No se pudo conectar al game server (URL) (websocket error)").
- **La barra de la sala** (`RoomOverlay`, arriba al centro: codigo, ronda, reloj y las luces de los jugadores) ocupa ~34 px: el HUD de equipos empieza mas abajo (`top: 40px`; en el celu `70px`). Antes quedaba tapado y se vio recien en la sala real, no en `devRoom`, que no la dibuja.
- **Para automatizar la sala** (`/rooms/`): los botones tienen nombres que se contienen entre si ("Crear sala" y "Crear sala 3D (La Feria)", "Listo" y "Empezar (esperando que esten listos)"), asi que `getByRole` necesita `exact: true`. El nickname se siembra con `localStorage` `mg:nickname` antes de cargar (`addInitScript`), y `VITE_GAME_SERVER_URL` del entorno pisa al del `.env`, que apunta al server de produccion (que todavia no tiene Poolnight).
- **Un screenshot con renderizado por software tarda segundos.** Entre tomas se puede vencer el reloj de turno (20 s, 25 con blanca en mano) y el server hace jugar al bot "flojo" por el humano: parece que el juego tira solo. Es la red de seguridad funcionando, no un bug.
- **Para que Playwright no serialice la escena** (referencias circulares) hay que devolver solo booleanos o datos planos desde `page.evaluate`.
- `npm run build` ejecuta el script de SEO, que ensucia ~30 `index.html` ajenos por CRLF: `git restore games/` despues.

## Que falta

Lo del registro esta hecho (ver "ESTADO"). Falta, en orden de importancia:

1. **Terminar una partida por la sala real** (cierre de ronda, tablero final, `reportScore` y la victoria en el ranking). Ya se probo hasta jugar tiros (ver "ESTADO"); falta el final. Conviene hacerlo con nicknames que no importe dejar en el ranking, o limpiando la fila despues.
2. **Probarlo en un telefono** y, si anda, `mobile: true`.
3. **Calibrar la rotura y la duracion de las partidas** (ver "Pendiente de tuning").
4. **Postproduccion y camara lenta** del `DESIGN.md` (bloom, profundidad de campo, camara lenta en la rotura y en la 8).
5. **Reacciones rapidas entre companeros** (como `wb:emote` de Bomba Palabra), si el ritmo del 4v4 lo pide.
