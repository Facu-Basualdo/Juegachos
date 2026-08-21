# Templo Rodante

Esquiva-obstáculos de dos botones en una cámara de piedra vista en **isometría 2D**
(canvas plano, sin Three.js). Por los dos extremos de la sala entran rodando vigas
con púas y hay que leerlas por altura: la **rasante** (piedra al rojo, a ras del
piso) se **salta**; la **alta** (hueso pálido, a la altura del pecho) se esquiva
**agachándose**. Un toque y se terminó. El puntaje son las **vigas esquivadas**
(`direction: "higher"`, formateado `N vigas` en `meta.ts`). La dificultad sube por
escalones con el tiempo.

Referencia de mecánica: el minijuego de las vigas rodantes de *Pummel Party*.

## Estructura

- `main.ts` — punto de entrada, monta `Game` en `#app`.
- `game/constants.ts` — geometría, física, rampa de dificultad y paleta.
  **Tunear acá primero.**
- `game/iso.ts` — la proyección isométrica, en un único lugar (`isoX` / `isoY`).
- `game/Runner.ts` — un corredor: salto parabólico, agachada con mínimo, muerte.
  **Es la misma clase para el jugador y para cada rival de la sala** — de ahí sale
  lo barato que es el canal (ver abajo).
- `game/Beam.ts` — una viga: posición, sentido, tipo (`low` / `high`), giro de las
  púas, y el test de colisión contra un corredor.
- `game/BeamField.ts` — todas las vigas vivas, la agenda y la colisión.
- `game/Renderer.ts` — todo el dibujo. Hornea la sala estática (vacío, muros,
  dintel, losas, foso) una vez en un canvas aparte y cada cuadro dibuja encima las
  llamas, las sombras, las vigas, los corredores y las partículas.
- `game/Particles.ts` — polvo del aterrizaje, chispas de la brasa, estallido de la
  muerte. En coordenadas de **mundo**, se proyectan con la iso al dibujar.
- `game/InputController.ts` — saltar / agacharse por teclado y por toque.
- `game/Hud.ts` — overlay DOM (vigas, récord, inicio / game over, countdown,
  banda de espectador, panel de ranking).
- `game/SoundEffects.ts` — Web Audio sintetizado, sin assets.
- `game/Blood.ts` — las manchas que deja una muerte, en coordenadas de MUNDO.
- `style.css` — además de la UI, define la tipografía en variables
  (`--font-display` serif para títulos y countdown, `--font-num` monoespaciada
  para el marcador, `--font-ui` para el resto). El juego venía entero en Consolas,
  o sea tipografía de terminal dentro de una cámara de piedra. Son **solo fuentes
  de sistema** a propósito: el resto del juego no carga un solo asset (audio
  sintetizado, cero imágenes) y no vale la pena depender de la red por el título.
- `game/TempleChannel.ts` — solo en sala: canal efímero de **poses**.
- `DESIGN.md` — dirección de arte ("Piedra y Brasa").

## Decisiones no obvias

**Las vigas se agendan por cuándo te CRUZAN, no por cuándo nacen.** `BeamField`
lleva un `nextArrival` (segundo de la partida en que la viga pasa por el corredor)
y recién suelta la viga cuando la distancia de spawn entra en tiempo. Agendar el
nacimiento haría que subir la velocidad acercara las llegadas sin querer, y que el
hueco real entre dos decisiones dependiera de la velocidad de cada viga. Así el
hueco entre dos acciones del jugador es exactamente `gap`, y la velocidad sólo
decide **cuánto tiempo tenés para leer** la que viene.

**Las tres alturas están atadas entre sí y no se tocan de a una.** `JUMP_HEIGHT`
(1.05) tiene que quedar por **debajo** de `BEAM_HIGH_TOP` (1.20): si el salto
pasara por encima de la viga alta, saltar esquivaría las dos y el juego se
convertiría en un solo botón. Y `BEAM_HIGH_BOTTOM` (0.62) tiene que quedar por
**encima** de `DUCK_H` (0.48), que es lo que hace que agacharse sirva. Subir
`SPEED_MAX` sin subir `SPAWN_DIST` recorta el aviso: a la velocidad máxima son
~0.8 s, que es el piso de lo jugable.

**El radio dibujado de la viga sale de su franja de altura**
(`(zMax - zMin) / 2 * Z_SCALE`), no de un número suelto. Un cilindro más fino que
su hitbox mata sin llegar a tocarte. Corolario: cuando la viga se ve **demasiado
gruesa** (parece un tronco y pierde amenaza), lo que se toca **no** es el radio.
Se recorta lo que sobresale (`spikeLen`) y se apaga el canto de abajo con una
banda oscura, de modo que la **masa luminosa** sea más angosta que el hitbox sin
mover la geometría de colisión.

**La luz tiene rango finito y por eso existe la sombra.** `lightRaw` acumula
`(1 - d/TORCH_RANGE)²` por antorcha y **corta en seco** en `TORCH_RANGE`, en vez
del `1/d²` físico que había antes. Con `1/d²` las cinco antorchas siempre suman
algo en toda la sala, el total pasaba de 1 en casi cualquier punto y el clamp
final borraba el gradiente: el piso salía de un ocre uniforme, el muro de un
marrón uniforme y las antorchas parecían calcomanías pegadas. Con rango finito
hay zonas que **ninguna** antorcha alcanza, que es lo que permite que la esquina
delantera caiga a la penumbra de `AMBIENT`. Si alguna vez el piso vuelve a verse
plano, lo primero que hay que mirar es si alguien subió `AMBIENT` o alargó el
falloff.

**El piso y el muro se exponen distinto sobre la MISMA suma de luz.**
`lightRaw` devuelve el valor crudo y cada superficie decide su exposición:
`FLOOR_GAIN` (1.65) para las losas y los cuerpos, `WALL_GAIN` (0.78) para la
piedra vertical, que recibe la llama de refilón. `wallLight` además apaga
activamente lo que está **por encima** de `z = 2.1`: las antorchas están a media
altura, el fuego sube poco y arriba del muro está el techo, que no existe y tiene
que irse a negro. La distancia es **3D** contra la posición real de la antorcha;
cuando era 2D la altura no participaba y el muro se iluminaba más abajo que a la
altura de la llama, que es exactamente al revés.

**El charco de luz va dibujado DENTRO del plano del piso.** `bakeLightPools` le
carga al contexto la matriz de la proyección iso
(`setTransform(TILE_HW, TILE_HH, -TILE_HW, TILE_HH, ORIGIN_X, ORIGIN_Y)`) y ahí un
`arc()` redondo sale como la elipse que le corresponde apoyada en las losas. Un
círculo en coordenadas de pantalla —que es lo único que había, el halo de la
llama— lee como una calcomanía flotando delante de la sala, no como luz tocando
piedra.

**Lo que muestra que la viga RUEDA son las bandas longitudinales, no los
anillos.** Los anillos perpendiculares al eje no pueden mostrar el giro: son
perpendiculares al eje de rotación, así que rodar no los mueve. Las facetas de
`drawBeam` son bandas **paralelas** al eje: una banda a ángulo `ang` aparece
corrida `R*sin(ang)` en perpendicular y con el ancho escorzado por `cos(ang)`, así
que al girar nacen en un borde, se ensanchan al pasar por el frente y se cierran
en el otro. Llevan un jitter determinista por índice (mismo `i` → mismo desvío
siempre, para que la piedra no hierva mientras gira): sin él salen equiespaciadas
y del mismo ancho, y el cilindro lee como un tubo corrugado. Lo que delata el
patrón es la **regularidad**, no el contraste.

**Las púas de la rasante van oscuras.** En color de llama (`C_FLAME`) se
recortaban clarito sobre el cuerpo naranja y leían como banderines de papel.
Piedra ennegrecida sobre brasa es lo que las hace amenazantes; en la viga alta,
en cambio, el hueso claro sí contrasta contra su propio cuerpo.

**La sangre vive en tres capas distintas y cada una tiene su razon.** No es un
solo efecto:

1. **Reventon** (`Particles.burst`): partículas en el aire, en coordenadas de
   mundo. Dos pasadas de sangre (una oscura y una viva) y una de polvo de piedra,
   en ese orden.
2. **Manchas en la sala** (`Blood.ts`): quedan pegadas al **piso** (plano z = 0)
   y al **muro de atrás** (plano y = 0), cada una dibujada con la matriz de SU
   plano — la misma técnica que los charcos de luz y el hollín. Esa es toda la
   diferencia entre sangre apoyada en la piedra y una calcomanía flotando
   delante. Persisten hasta que arranca la partida siguiente: la sala se acuerda
   de los que perdió (ver `DESIGN.md`).
3. **Sangre en el lente** (`.blood` en el HUD): va por CSS y no por canvas
   **a propósito** — es sangre sobre la cámara, no sobre la sala. Copia el
   recurso de La Escalera: salpicaduras de golpe y después chorreos que bajan.

**El lente NO se muestra en modo sala.** Ahí el caído se queda mirando correr a
los demás (`onReportedWaiting`), y un velo al 94% de opacidad lo dejaría sin ver
la ronda. Las manchas del piso y de los muros sí van en los dos modos: eso es la
sala, no la cámara.

**La silueta de cada salpicadura del lente se genera con `clipPath`, punto a
punto.** Con `border-radius` — por más asimétrico que se lo escriba — la forma
sale siempre demasiado suave y a ese tamaño lee como una pelota. Y el relleno va
**plano**: un degradado radial le da volumen de esfera y deja de leerse como algo
aplastado contra el vidrio.

**El extremo de la viga que entra al muro se APAGA, no se tapa.** `clipAtWall` la
corta contra la pared, y un corte sobre piedra encendida deja un canto plano bien
visible. La solución **no** es dibujarle una boca de agujero encima: se probó dos
veces (un óvalo oscuro en la punta, y después un agujero con marco detrás) y las
dos veces quedó peor que el corte — un círculo oscuro sobre sillería canta
muchísimo. Lo que funciona es que para cuando el recorte llega, el cilindro ya
esté en negro, que además es lo que pasa de verdad: adentro del hueco no le llega
ninguna antorcha. Así el corte cae sobre píxeles oscuros contra piedra oscura y
deja de existir como borde. Ojo con el ancho del degradado: pasarse pinta una
mancha oscura sobre los sillares de alrededor, que se nota más que la púa suelta
que queda sin apagar.

**Los muros se pasan del cuarto (`OVERRUN`) y no se desvanecen en su extremo de
afuera.** Terminaban justo en el borde de la sala y encima llevaban un `edge` que
los apagaba a negro ahí mismo, así que las dos esquinas de arriba quedaban
abiertas al vacío y se veía el corte del diorama. Son **dos** cosas y hay que
mantener las dos: el paño llega hasta salirse del cuadro **y** llega sólido.
El `edge` sigue existiendo pero sólo hacia el arranque. Lo mismo vale para el
backing (`edgeB`) y para la moldura (`edgeC`): si alguno se apaga antes que los
sillares, el hueco vuelve.

**`WALL_H` sube hasta salirse del cuadro por arriba**, y el fondo de la mitad
superior es **roca de caverna, no vacío**: lo que se ve por encima y por detrás
de los muros tiene que ser la piedra en la que está excavada la sala. Abajo sí se
mantiene oscuro — eso es el foso sobre el que flota la plataforma, y ahí el vacío
es deliberado.

**La esquina de los dos muros se resuelve con una pilastra** (`bakeCornerPost`).
Los muros se hornean por separado y se cruzaban ahí sin más: uno pisaba al otro y
la esquina era una superposición, con las hiladas de los dos paños chocando en
ángulos que no cierran. Arranca en `TUNNEL_H` y **no** en el piso: por debajo está
el vano por el que ruedan las vigas, y un pilar que bajara hasta las losas se les
pondría justo en el camino.

**Las vigas no pueden pintarse sobre los muros, y cada muro se resuelve
distinto.** Los muros están horneados y las vigas se dibujan después, así que por
defecto una viga cruza la piedra por delante. Hay dos casos y **no comparten
solución**:

- **Muro izquierdo (dintel)** → capa de frente (`this.fg`). Se hornea aparte y se
  dibuja *después* de las vigas que vienen por el pasillo. Es seguro pintarlo
  delante de todo lo de la sala porque vive de `TUNNEL_H` (1.9) para arriba, o
  sea muy por encima de corredores (z <= 1) y vigas (z <= 1.2): lo único con lo
  que llega a solaparse es una viga todavía afuera, que es justo lo que hay que
  ocluir. Las llamas se dibujan **después** del `fg` para que las antorchas del
  dintel no queden tapadas por su propia pared.
- **Muro de atrás** → recorte, no capa. **No se puede mudar al frente**: en el
  carril más pegado al fondo, la cabeza del corredor se solapa con el pie del
  muro, y pintarlo delante se la comería. Entonces se recorta la viga por el
  plano `y = 0` (`clipAtWall`), que es donde `BEAM_Y0` (-0.55) la mete adentro de
  la pared. El corte cae en la cara del muro y lee como que la viga se hunde ahí.

`drawBeams` agrupa por tipo antes de recortar: el clip es caro y uno por viga
costaba ~5 fps en render por software. Sólo hay dos alturas posibles, así que
alcanzan dos recortes por lote. Las sombras llevan el mismo recorte a `z = 0`, si
no trepan por la pared.

**El corredor NO tiene ciclo de carrera, y es a propósito.** Está clavado en
`RUNNER_X` — la sala se mueve alrededor suyo, él no avanza — así que animarle una
zancada lo hacía leer como alguien pedaleando en el aire. La pose de a pie es una
**guardia**: piernas plantadas y apenas abiertas, brazos sueltos, el cuerpo
mínimamente volcado, y una respiración lenta (`phase * 0.18`, amplitud < 1 px).
`Runner.phase` sigue avanzando a 9 rad/s y sigue siendo el reloj de la
respiración, sólo que muy desacelerado. Si alguien vuelve a poner zancada, va a
volver el mismo problema.

**La sala se dibuja como un diorama cerrado, y eso son cuatro piezas que se
sostienen entre sí.** Sacar cualquiera devuelve el aspecto de recorte flotante:

1. **Muro macizo de fondo** (`bakeWall`, paso 1): paño continuo de piedra detrás
   de toda la sillería, para que por las juntas y por los huecos entre sillares
   se vea piedra en sombra y no el vacío. Va **segmentado**, no como un polígono
   liso, para que reciba el mismo gradiente de antorchas que el resto del muro.
2. **Remate superior** (`bakeWall`, paso 2 — la moldura): losa continua que
   cierra la hilera de arriba, que si no termina en un borde dentado contra el
   vacío. Es además **la única cara que puede mostrar el espesor del muro**: en
   esta isometría sólo son visibles las caras que miran a +x, +y y +z, así que la
   cara exterior del muro no se ve nunca y la masa hacia afuera (`WALL_T`) no
   dibuja nada por sí sola. El ancho en pantalla de esa tapa *es* el grosor de la
   pared.
3. **Zócalo perimetral** (`bakePlinth`): escalón que envuelve los tres lados del
   contorno y da abajo el remate que la moldura da arriba. El tramo izquierdo no
   llega a mostrar cara de espesor (mira a -x), pero su tapa es la que cierra la
   esquina: sin ella el escalón nacía de golpe a media plataforma y dejaba una
   muesca en el canto.
4. **Oclusión de contacto** (`bakeContactShadow`): franja de sombra donde cada
   muro se apoya en el piso. Va **después** de `bakeLightPools` a propósito — la
   sombra tiene que ganarle a la luz en el rincón. Sin ella el charco de una
   antorcha llega a la base del muro con la misma intensidad que en medio de la
   sala, y el muro parece apoyado ENCIMA del piso en vez de encastrado.

Nota sobre el punto 4: este renderer **no tiene motor de sombras**. Es canvas 2D
plano, no Three.js — no hay luces, ni materiales, ni `castShadow`/`receiveShadow`,
sólo polígonos pintados en orden. Toda la oclusión está horneada a mano.

**Cada sillar del muro es un PRISMA, no un cuadrilátero.** `bakeWall` le dibuja
cara frontal, canto superior y costado. Cuando era un solo polígono plano por
bloque, el muro de atrás leía como un cartón pintado: sin canto ni costado no hay
nada que indique espesor, así que el ojo lo toma como un mosaico impreso sobre
una superficie lisa. `at(u, d, z)` proyecta con `d` = cuánto sale el bloque hacia
la sala, y las tres caras visibles en esta isometría son siempre la frontal, la
superior y la de `u1`.

Tres cosas que hay que respetar si se toca:

- **Las filas se dibujan de ARRIBA hacia abajo.** Un sillar saliente se corre
  hacia abajo en pantalla y pisa al de la fila siguiente, así que la de abajo
  tiene que pintarse después o la oclusión sale invertida.
- **El relieve tiene que ser chico** (`d` ≈ 0.05-0.21). Con el doble, el muro
  deja de leerse como un paramento y pasa a parecer una pila de cajas sueltas.
  Alcanza con insinuar el espesor.
- **La junta es angosta** (`j` = 0.028) y hay un paramento de fondo detrás de los
  bloques. Con el relieve puesto, cada bloque adelantado deja ver ese fondo por
  el hueco: con la junta ancha de antes el muro se leía derruido, agujereado en
  vez de trabado.

**El herraje de las antorchas se dibuja adelantado sobre el paramento**
(`torchMount`, `0.24` hacia la sala). Los sillares salen hasta ~0.21, así que una
antorcha clavada en el plano del muro queda hundida detrás de sus propios
bloques. Mueve **solo el dibujo**: la posición de la luz sigue siendo la de
`TORCHES`, porque correrla dos décimas no cambia el sombreado y sí obligaría a
rehornear la sala.

**El hollín se dibuja dentro del plano del piso y por acumulación.** Eran
gradientes radiales en coordenadas de pantalla, o sea círculos perfectos sobre un
piso en perspectiva, y encima con degradado gaussiano puro — que es exactamente
lo que el ojo lee como "blur mal puesto" y no como suciedad. Ahora van con la
misma matriz iso que los charcos de luz, y cada mancha es un cúmulo de manchitas
chicas e irregulares: el grano y el borde roto son lo que las hace parecer
depositadas sobre la piedra. Se anclan al pie de cada antorcha, que es lo único
que en este cuarto tizna algo.

**Las tres siluetas del corredor se dibujan en coordenadas LOCALES.** Origen en
los pies, `y` negativa hacia arriba, y la pose entera se vuelca con un `rotate`.
Cuando cada pieza se posicionaba en coordenadas de pantalla era imposible
inclinar la figura, y sin inclinación correr y saltar eran la misma campana con
dos anchos distintos. Lo que distingue cada pose:

- **Corriendo**: volcado hacia adelante, zancada real (un pie adelante y otro
  atrás en contrafase, el que va al aire se despega) y la tela volando hacia
  atrás. Los dos rectángulos verticales que había sólo se corrían de costado y
  leían como un balanceo, no como una carrera.
- **Saltando**: cuerpo enderezado, brazos arriba, piernas recogidas.
- **Agachado**: una **cuña asimétrica** — espalda arqueada atrás, cuello y
  capucha bajando adelante — y no una elipse simétrica, que se leía como una
  mancha en el piso y encima se tragaba la capucha.

**El ruedo de la túnica termina bien por encima del piso** (`hemY`). Con el ruedo
largo que tenía, la túnica tapaba las piernas enteras y la zancada era invisible,
que es justo lo único que distingue al que corre del que está parado.

**La capucha es una gota con el pico adelante, y adentro va oscuridad.** Era un
círculo con un disco de piel adentro: la cara clara medía casi lo mismo que la
capucha y se comía la silueta justo en la parte más alta del cuerpo, que es donde
el ojo busca la pose. Leía como una perla o un casco. El hueco sigue derivando de
`skin` para que se apague junto con el resto del cuerpo en penumbra.

**El rim del corredor se dibuja dentro del sistema de coordenadas de cada pose**
(`rimStroke` recibe el trazo como callback). Si se hiciera una sola vez al final
en coordenadas de pantalla, quedaría colgado horizontal encima de una cabeza
volcada.

**El corredor lleva un cerco oscuro de `shadowBlur`.** Mide ~56 px en una sala
que ahora tiene charcos de luz muy claros, y sin el cerco la túnica se funde con
las losas encendidas justo donde hay que leer la pose. Va como sombra proyectada
de canvas porque así sale gratis para cada `fill` del cuerpo, sin re-trazar el
contorno pieza por pieza. Medido: con el cerco puesto el juego sigue a 60 fps en
Chromium headless (SwiftShader, o sea render por software).

**La altura se lee por la sombra, no por el color.** La rasante lleva su sombra
pegada al cuerpo; la alta la deja despegada ~50 px abajo. El color (brasa vs.
hueso) y la posición vertical son refuerzos: la sombra es la señal que funciona
incluso de reojo. Es la razón de que `drawShadows` corra antes que las vigas.

**`mix()` devuelve `#rrggbb`, no `rgb(...)`.** Se usa anidado
(`mix(mix(a, b, t), c, u)`) por todos lados y `hex()` sólo parsea `#rrggbb`. Con
salida `rgb(...)` el parseo daba `NaN`, el `fillStyle` quedaba inválido y el canvas
seguía pintando con el color anterior: el piso entero salía casi negro. No
"simplificar" ese formato de vuelta.

**El muro de la izquierda es sólo un dintel.** Existe de `TUNNEL_H` (1.9) para
arriba: por debajo está el vano por el que entran rodando las vigas. Un muro
completo ahí taparía el pasillo. Los extremos de los muros se hunden en negro en
vez de cortarse en seco (la boca del pasillo de un lado, la salida del otro).

**El toque de arranque cuelga del `container`, no del canvas.** La pantalla de
inicio es un overlay que tapa el canvas (ver el `CLAUDE.md` raíz, "El toque de
arranque no puede colgar del canvas"). Como a cambio el handler ve los toques de
toda la pantalla, filtra por estado con `isPlaying`: en menú un toque arranca, y
en partida la mitad de arriba salta y la de abajo agacha.

**No declara `roomTimeLimitSec` y no lo necesita.** Se midió: dejado sin tocar, la
primera viga lo mata a los ~2,2 s, así que un jugador AFK no puede colgar la ronda.
Además la rampa se vuelve durísima al minuto y pico, así que la ronda no se
eterniza tampoco con alguien bueno.

**En teléfono vertical el juego queda en una banda.** La vista es fija (960x620) y
se letterboxea; en portrait el límite es el ancho, así que ocupa ~30 % del alto. No
se puede arreglar con zoom: recortar los costados taparía las bocas por donde
entran las vigas, que es justo lo que hay que ver venir. Mismo trato que el resto
del roster apaisado.

## Modo sala

Todos corren **la misma sala**: un carril por jugador (`laneFor`, por orden de
asiento, así todos los clientes derivan el mismo reparto sin guardar nada) y la
**misma semilla** (`hash(code:round)`), con lo cual las vigas que ves esquivar al
de al lado son exactamente las que te vienen a vos. Al morir se sigue mirando la
sala (`onReportedWaiting`) con la banda de espectador al pie.

**El canal transmite EVENTOS de pose, no posiciones.** `TempleChannel` manda
`jump` / `duck` / `stand` / `dead` y el receptor corre la **misma parábola** del
`Runner` con las mismas constantes. Con eso la animación sale idéntica con dos o
tres mensajes por segundo por jugador (~24/s con la sala llena de 8) en vez de los
10/s por jugador que llevaron a Neon Drift contra el tope de Realtime. Ver
"Canales efímeros de alta frecuencia" en el `CLAUDE.md` raíz.

Dos detalles que lo hacen robusto:

- **El keepalive nunca reenvía `jump`.** Reafirma `stand` / `duck` / `dead` cada
  segundo, para que un mensaje perdido no deje a nadie agachado para siempre en la
  pantalla del resto. Si reenviara `jump` reiniciaría la parábola del rival.
- **Un `stand` no corta un salto en curso.** `Runner.duckEnd()` sólo suelta la
  agachada; la parábola local termina sola. Un salto (0,56 s) siempre cabe dentro
  de la ventana del keepalive (1 s).
- El canal vigila el estado de la suscripción y se reconstruye con backoff, y el
  keepalive va sobre `setInterval` y no sobre el `requestAnimationFrame` (el
  navegador frena el rAF en pestañas de fondo y el jugador desaparecería del resto).
