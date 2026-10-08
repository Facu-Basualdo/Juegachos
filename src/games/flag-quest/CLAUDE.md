# FlagQuest (flag-quest)

Adivina la bandera: aparece una bandera y hay 5 segundos para elegir el pais entre
cuatro opciones. Todo DOM + CSS, sin canvas (estetica de atlas antiguo, ver
`DESIGN.md`). Creado por emi1i0.

## Modulos

- `main.ts` — entry point, monta `Game` en `#app`.
- `game/countries.ts` — **el catalogo**: codigo de `flag-icons`, nombre en espanol,
  region y nivel (1-5), mas `LOOKALIKES`, las familias de banderas que se confunden
  (Chad / Rumania / Andorra / Moldavia...). Agregar una bandera es agregar una fila.
- `game/constants.ts` — tiempos (`ANSWER_MS`, `FEEDBACK_MS`), puntaje (`pointsFor`),
  vidas y ritmo del solitario, el calendario de niveles de la sala (`ROOM_TIERS`), el
  PRNG sembrado y el armado de preguntas (`buildQuestion`, `buildRoomQuiz`).
- `game/flags.ts` — URL de cada SVG (glob de `node_modules/flag-icons/flags/4x3`) y
  precarga.
- `game/Game.ts` — maquina de estados `ready -> countdown -> question -> feedback ->
  gameOver`, el reloj, input y el wiring de sala (incluido el F5).
- `game/Hud.ts` — todo el DOM: barra superior (lamina, rosas = vidas, puntaje), lamina
  con la bandera y el sello, escala-reloj, las cuatro opciones, overlays y countdown.
- `game/Friar.ts` — el fraile cartografo (ver abajo).
- `game/SoundEffects.ts` — blips Web Audio (countdown 750 Hz, YA, acierto, error).

## Dos modos, dos tableros

- **Solitario ("clasico")**: sin fin, 3 vidas (`SOLO_LIVES`). Un error o un tiempo
  vencido cuesta una vida. Sube un nivel cada `SOLO_LEVEL_EVERY` (6) banderas.
- **Sala ("sala")**: 15 banderas fijas, tres de cada nivel (`ROOM_TIERS`), sin vidas.
  Termina sola: 15 x (5 s + 1.1 s) ~ 92 s como mucho (dejado quieto llega al final
  por los tiempos vencidos). Igual declara `roomTimeLimitSec: 150`, pero no como
  corte: es por la semilla (ver abajo).

Puntaje igual en los dos: por acierto `100 + 100 * (tiempo que sobro / 5 s)`. Son
tableros separados (`variants: ["clasico", "sala"]`) porque no se comparan: un
solitario puede durar 40 banderas. La sala reporta con `{ variant: "sala" }`.

## Niveles y territorios

Nivel 1 = las que conoce cualquiera, 4 = paises que casi nadie ubica, 5 = territorios
(Aruba, Feroe, Cataluna...). Los territorios famosos (Puerto Rico, Groenlandia, Hong
Kong, Escocia, Inglaterra, Gales, Palestina) estan en el 3: el programador pidio que
los territorios aparezcan a medida que sube la dificultad. Las opciones trampa
tambien escalan (`pickDistractors`): en el nivel 1 son nombres conocidos de cualquier
lado, desde el 2 una es de la region, desde el 3 una es una bandera parecida y desde
el 4 todas las parecidas que haya.

**Quedan afuera las banderas repetidas en `flag-icons`**: Guadalupe, Reunion,
Mayotte, San Martin, San Bartolome, Guayana Francesa y Martinica traen la francesa;
Bouvet y Svalbard la noruega; Heard la australiana; las islas menores de EE.UU. la
estadounidense. Serian preguntas sin respuesta. Antes de agregar un territorio,
mirar su SVG.

## Decisiones no obvias

**El reloj es de pared y se cobra hacia atras.** Todo se mide con `Date.now()`
contra `phaseStart` (epoch), nunca acumulando `dt`, y `advance(now)` es un **bucle**:
cada fase vencida arranca la siguiente en el instante en que vencio, no al volver.
Asi el que se va 20 s a otra pestana pierde las banderas que pasaron en esos 20 s,
como si hubiera estado mirando sin responder. Lo verificado: con el hilo bloqueado
12 s en la lamina 1, al soltar la partida esta en la lamina 3 con dos vidas menos.
Ademas de `requestAnimationFrame` corre un `setInterval` (`BACKGROUND_TICK_MS`): el
rAF se pausa en segundo plano, y en sala la partida tiene que terminar y reportarse
aunque el jugador no vuelva. Al cobrar de a varias no suena la rafaga (`live` en
`resolve`).

**No se marca error por el solo hecho de ocultar la pestana** (la opcion que se
descarto con el programador): castigaria una notificacion o un cambio de app sin
querer en el celular, y con 5 s buscar la bandera en otra pestana ya casi no da.

**Mismas banderas en sala sin game server, distintas en cada ronda.** `buildRoomQuiz`
siembra el PRNG con `code:round:<vencimiento>` (`Game.roomSeed`): todos generan las
mismas 15 banderas, con las mismas opciones en el mismo orden. El vencimiento
(`room.deadline()`) es lo que la hace distinta en cada partida: con `code:round`
solo, "Volver a la sala" reinicia la numeracion y **la revancha en la misma sala
repetia exactamente las mismas banderas** (bug reportado por el programador). El
vencimiento lo escribe el host en la misma fila que pasa la ronda a `playing`, asi
que es igual para todos, cambia en cada ronda y sobrevive un F5 — por eso el juego
declara `roomTimeLimitSec` aunque termine solo; sacarlo vuelve a traer el bug. Ojo:
`birome`, `cannon-dodge`, `el-cohete`, `flash-math`, `minotauro` y `templo-rodante`
siembran con `code:round` y tienen el mismo problema en la revancha.

**F5 en sala (`roomRun.ts`).** Es un juego `"higher"`, que normalmente no lo
necesita, pero aca si: como las banderas son las mismas al recargar, reiniciar seria
jugar la ronda de nuevo sabiendo las respuestas. Se guarda `index`, `score`, `hits`,
la fase y su `phaseStart` (epoch); las preguntas salen de nuevo de la semilla. Al
volver, `advance` cobra lo que vencio durante la recarga.

**Las banderas chicas vienen en linea.** Vite mete como `data:` URI los SVG de menos
de 4 KB, asi que `flagImg.src` no siempre termina en `<codigo>.svg` (importa para
los tests, no para el juego). Las 15 de la sala se precargan durante el countdown;
en solitario, las 3 siguientes.

**Input.** El arranque escucha `pointerdown` sobre el container y filtra por estado
(regla del repo: nunca sobre el canvas); los botones de opcion cortan el
`pointerdown` para no disparar el arranque. Teclas 1-4 eligen la opcion en ese
orden (los numerales romanos de las cartelas).

## El fraile (`Friar.ts`)

Avatar pedido por el programador: un fraile gordito al estilo de Fra Mauro (el monje
veneciano del mapamundi de 1450), en su atril con el libro y el tintero, que
reacciona a cada respuesta. **Solo gestos, sin texto ni globos** (decision del
programador). Es un SVG en linea dibujado a mano, sin assets, a tinta sepia con
sombreado de rayas: no lleva color propio para no competirle a la bandera.

Esta armado por partes y cada humor es una clase en la raiz (`is-idle`,
`is-correct`, `is-cheer`, `is-wrong`, `is-timeout`, `is-sleep`, mas
`is-urgent` encima de `is-idle`); el CSS (`style.css`, seccion del fraile) decide
que ojos / boca se ven y como se mueven brazos, cabeza y cejas. Los
`transform-origin` estan en unidades del `viewBox` (`transform-box: view-box`).

Quien decide el humor es `Game.friarMood`: acierto -> `correct`, desde el tercero
seguido -> `cheer`; error -> `wrong` (se tapa la cara); tiempo vencido ->
`timeout`, y con dos seguidos se queda `sleep` (dormido) en la bandera siguiente
hasta que respondas. `is-urgent` lo prende `Hud.setTime` en el ultimo segundo y medio.

Ubicacion: en compu, en el margen izquierdo de la lamina (`.fq-board` la contiene
y el fraile va absoluto a su costado). Hasta 900px de ancho no hay margen, asi que
se asoma por arriba de la lamina con el atril escondido detras; en pantallas bajas
(<= 720px de alto) se achica para que las opciones no se salgan. Medido a 1280x800,
1366x650, 768x1024, 390x844 y 375x667: nada queda fuera de la pantalla.
