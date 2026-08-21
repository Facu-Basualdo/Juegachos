# Cadena de Palabras — Direccion de arte: "Cadena forjada"

Cadena de Palabras pasa en un **taller de herreria en una noche fria**. En el centro,
sobre el charco de calor de la forja, flota un **eslabon de hierro al rojo vivo** con
la letra del turno grabada. Cada palabra acertada es un **martillazo**: se forja un
eslabon mas y la cadena crece. Cuando a alguien se le acaba el tiempo, el hierro
**cede y se parte**. Es cartoon y calido como Bomba Palabra, pero el calor no viene de
la polvora: viene del metal.

## Principio

**El metal esta caliente mientras la cadena avanza.** Bomba Palabra cuenta una cuenta
regresiva hacia una explosion; esto cuenta una cadena que se construye y se puede
cortar. La diferencia manda toda la direccion: el centro no amenaza, **invita a
golpear**. De un vistazo tenes que leer tres cosas: **con que letra te toca arrancar**,
**cuanto tiempo te queda** y **con que letra termino la palabra anterior** — esta
ultima es la regla del juego, y por eso se dibuja, no se explica.

Y una cosa mas, porque cambia el pulso del juego: **una sola vida**. No hay corazones
que perder de a poco. Tenes tu eslabon o no lo tenes. El error es definitivo, asi que
el reloj tiene que doler.

## Layout

- **Circulo de jugadores** alrededor del centro, repartidos por angulo (uno arriba, el
  resto girando), de 2 a **8** jugadores sin solaparse.
- **El eslabon caliente en el centro**, flotando sobre el **charco de la forja**. Es un
  anillo de hierro con el aro en gradiente de metal (blanco-caliente arriba, naranja,
  rojo oscuro abajo) y el hueco en negro. La **letra** va grabada ahi adentro, en
  blanco incandescente. A los lados asoman **dos eslabones vecinos ya frios** (acero),
  que dan la lectura de "cadena" sin competir.
- **Anillo del reloj** rodeando al eslabon: un **circulo completo** (a diferencia de la
  mecha de Bomba, aca no hay nada arriba que esquivar) que se consume del metal caliente
  al rojo peligro, con los **segundos** debajo de la letra.
- **Una flecha** ambar sale del centro y **gira** apuntando al jugador de turno. En
  pantallas chicas se oculta: no hay banda libre entre el anillo y las tarjetas, y el
  turno ya se lee por el nombre verde y el glow.
- **Cada jugador** es una columna: **nombre arriba**, su **eslabon** (la unica vida) con
  el numero de eslabones que aporto, **personaje** (bocha de acero azulado con **cara
  que reacciona al estado** — nunca fotos ni imagenes propias), y **debajo lo que
  escribe**. Al caer, su eslabon aparece **partido**.
- **La cola encendida.** La ultima palabra aceptada de cada jugador muestra su **ultima
  letra al rojo**. Es la regla del juego hecha visible: esa letra es la que hereda el
  siguiente. Al quedar eliminado se le apaga (ya no hereda nada).
- **Sin caja de texto.** El de turno escribe y el texto aparece bajo su avatar (un input
  invisible summonea el teclado en movil).
- **Ambiente:** noche fria y azulada, **resplandor naranja** detras del eslabon,
  **chispas de forja** subiendo lento y vignette oscura en los bordes. Atmosfera: va por
  detras y en baja intensidad.
- **El largo de la cadena** ("CADENA 12") se graba discreto en una esquina, en acero. No
  compite con el centro; es un dato, no un protagonista.

## Paleta

- **Noche fria** `#0d1219` -> `#070a0f` — el taller a oscuras. Es **azul**, no violeta:
  el naranja del metal recorta contra ella.
- **Forja** `#ff6a1f` / **metal caliente** `#ffb347` — el charco de calor, el aro del
  eslabon, el anillo lleno.
- **Blanco caliente** `#fff3d6` — la punta del gradiente, la letra grabada, las chispas.
- **Acero** `#8fa3b8` y **acero oscuro** `#3d4c5c` — los eslabones ya frios, el contador
  de la cadena, el eslabon partido del eliminado.
- **Nombre** `#eef3f7` — blanco frio, peso alto.
- **Personaje** bocha de acero azulado `#4f7ea8` con rasgos en `#10202c`; gris `#46505c`
  al quedar eliminado. Gota de sudor `#8fd3ff`.
- **Turno** `#43dba1` — el nombre del jugador de turno se pone verde menta (el unico
  color frio brillante: no compite con el naranja del centro).
- **Rojo peligro** `#e2452f` — el anillo por vaciarse, el eslabon enfriandose, la
  palabra rechazada, el globo "RAPIDO!".

## Vocabulario visual

- **Eslabon, no bomba.** Anillo de hierro con gradiente en el aro y hueco negro. El
  gradiente se hace con dos backgrounds (`padding-box` para el centro, `border-box` para
  el aro), no con un borde plano.
- **Anillo del reloj** como gauge exterior: circulo **completo**, caliente -> rojo, pulso
  al final, con los **segundos** bajo la letra.
- **La cola al rojo**: la ultima letra de cada palabra aceptada, encendida. Es la unica
  pieza de tipografia con color propio, porque es la unica que dice la regla.
- **Eslabon entero / partido** dibujados (SVG), no emojis (el repo prohibe emojis), como
  marca de vida arriba del avatar. Una sola vida: no hay fila de corazones.
- **Chispas de forja** que suben lento y **resplandor naranja** detras del eslabon:
  atmosfera de taller, siempre por detras y sutil.
- **Texto en vivo** debajo del avatar: lo que se teclea se ve al instante (propio y
  ajeno, via el relay del server).
- **Reacciones = la cara del personaje.** Igual que en Bomba Palabra: no hay globo de
  emoji ni sticker flotando, reaccionar es **prestarle la cara a tu bocha**. Cinco caras
  dibujadas (risa, sorpresa, enojo, burla, llanto) en el mismo trazo `#10202c` que la
  cara base. El dock vive en la **esquina**, no centrado abajo: con la mesa llena hay un
  jugador a las 6 en punto y el dock le tapaba la palabra.

## Movimiento

Calido y con foco. Las **chispas** suben lento de fondo; al pasar el turno la flecha
**gira** hacia el nuevo jugador y su nombre se enciende. Al acertar, el eslabon central
recibe el **martillazo**: refulge en blanco y vuelve a su naranja (~500ms), y la palabra
queda sellada bajo el avatar con la cola al rojo. El rechazo sacude el avatar. El anillo
se vacia parejo y **pulsa en rojo** cuando esta por acabarse, y ahi el eslabon **se
enfria al rojo** — el metal avisa antes de romperse. Al agotarse el reloj, el eslabon
**se parte**: fogonazo blanco-caliente, onda, esquirlas de metal y sacudida (~700ms), y
el jugador queda afuera **para siempre**. Nada de rebotes elasticos, salvo el **salto
corto** del personaje al reaccionar (~380ms, con overshoot): es la voz del jugador y
tiene que verse desde el otro lado de la ronda. Y **se escucha**: el acierto es un
martillo en el yunque con el metal cantando; el quiebre, hierro que cede.

**La cara reacciona viva, no congelada.** Una reaccion no es una estampa: mientras dura,
la cara **actua**, y puede transformar al personaje entero. La **risa convierte a la bocha
en una rana**: se pone verde, le brotan ojos saltones por encima de la cabeza y pega
saltitos con la boca abierta y la lengua afuera — es la reaccion mas exagerada del juego,
y esta bien que lo sea. El llanto deja caer lagrimas de verdad, alternadas, sobre un
puchero que tiembla; el enojo vibra de furia y le recalienta el cuerpo; la burla sacude la
lengua y guina; la sorpresa entra de golpe y late. El movimiento **subraya lo que ya dice
el sonido**, nunca lo contradice ni compite con el. Se dibuja con los mismos paths del SVG movidos por
CSS — **nunca video, sprites ni un render 3D**: la cara tiene que pesar cero, escalar a
cualquier tamano y poder recolorearse (el rojo del enojo). Quien pida menos movimiento
(`prefers-reduced-motion`) ve la cara igual, quieta.

## Que evitar

- **Que parezca Bomba Palabra pintada de naranja.** El centro no es una esfera con una
  mecha: es un aro. La noche es azul, no violeta. El sonido es metal, no polvora.
- Fotos / avatares personalizados: siempre la bocha generica (la identidad la da el
  nombre). Lo que cambia es la **cara** segun el estado, no la persona.
- Una caja de input visible: se escribe directo, el texto vive bajo el avatar.
- **Emojis** en cualquier lado (regla del repo): el eslabon, el eslabon partido y las
  caras de reaccion van dibujados. Una reaccion se manda como **id** (`risa`), nunca
  como glifo.
- **Corazones o vidas multiples**: son de otro juego. Aca hay una sola, y esa escasez es
  la mitad de la tension.
- Sobrecargar: las chispas, el resplandor y los eslabones vecinos son **atmosfera** —
  nunca compiten con el eslabon caliente, el anillo ni el nombre del turno.
