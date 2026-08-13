# Luz de Dosel

Direccion de arte para el renderer 2D de Macaco Tilt. Toda decision visual de `Renderer.ts`,
`Jungle.ts`, `Monkey.ts` y `Particles.ts` responde a este documento.

La selva no es un fondo verde: es un volumen de aire cargado de humedad, atravesado por una
sola fuente de luz que entra desde arriba y a la izquierda, se rompe contra el follaje y llega
al suelo hecha polvo dorado. Todo lo que se dibuja acepta esa luz o se esconde de ella. Nada
flota en tinta plana. Un tronco tiene un lado iluminado y un lado en sombra; una hoja tiene el
haz encendido y el enves apagado; el pelaje del mono se aclara en el hombro que mira al sol y
se hunde en la panza. Esta es la regla madre — **la luz viene de un solo lugar y todos la
obedecen** — y es lo que separa una escena pintada de un conjunto de calcomanias.

La profundidad se gana por capas, no por perspectiva. Tres planos, y cada uno paga su distancia
con tres monedas a la vez: se oscurece hacia el fondo, se desatura, y pierde contraste interno.
El dosel lejano es casi una silueta azulada sin detalle; el plano medio tiene troncos y lianas
con volumen suave; el frente es follaje nitido, caliente y recortado. Entre capa y capa hay
neblina — una banda de aire que las separa. Si dos capas se pueden distinguir por su dibujo pero
no por su atmosfera, la atmosfera esta mal.

El color es un vocabulario cerrado y humedo. El verde manda, pero nunca el mismo verde: la
profundidad se dice con verdes que van del azulado frio (`#0d2818`) al vivo iluminado (`#4a9c5d`),
jamas agregando hues nuevos. El dorado (`#f4d03f`) es la luz y solo la luz — rayos, motas,
reflejos altos — y por eso es el color mas raro de la pantalla y el que mas pesa. La madera del
tablon (`#c8873f` a `#8b5a2b`) es el unico calido terroso, y existe para separarse del verde por
temperatura: el jugador tiene que encontrar el tablon en un cuarto de segundo. El rojo (`#e8503a`)
esta reservado al peligro y no aparece en ningun otro lado, nunca como decoracion.

Las formas son redondas y pesadas, con volumen sombreado. Nada de contornos negros uniformes:
el borde de un objeto se define por el contraste con lo que tiene detras y por su propio rim de
luz arriba, no por una linea. El bambu es cilindrico y se nota — un degrade transversal, nudos
que interrumpen la fibra, una veta que corre a lo largo. El mono es una construccion de masas
ovaladas que se pisan (panza, pecho, cabeza, extremidades), cada una con su gradiente propio,
porque un personaje hecho de volumenes lee como criatura y uno hecho de rectangulos lee como
icono.

La cara es el juego. El tablon dice cuanto peligro hay en numeros; la cara lo dice en emocion, y
es la que el jugador mira. Los rasgos son pocos y grandes — ojos amplios con brillo especular,
cejas que hacen todo el trabajo, boca elastica — y cambian de juego completo segun el estado, no
rasgo por rasgo: calma, concentrado, panico, caida son cuatro caras distintas, no una cara con
variaciones. Las gotas de sudor salen volando cuando el angulo se pone feo y son informacion
disfrazada de chiste: aparecen antes de que el jugador entienda que esta en problemas. Misma
escuela que las caritas de Bomba Palabra y Cadena de Palabras — expresion dibujada, exagerada y
legible a tamano chico, nunca un glifo.

La composicion es un instrumento leido a 60 cuadros por segundo. El centro de la pantalla es
sagrado: ahi vive el tablon y nada mas puede competir. La jerarquia es absoluta — el mono quema
primero, el tablon segundo, el mundo se hunde en atmosfera calibrada. **No hay medidores.** El
angulo del tablon contra la horizontal de la pantalla ya dice todo lo que hay que saber, y la
cara del mono lo dice otra vez en emocion; un indicador encima de eso solo compite con el
centro de la pantalla, que es sagrado. Las
hojas del viento son la unica excepcion autorizada a invadir el centro, y lo hacen porque son
una advertencia: entran desde el borde, cruzan, y avisan de que lado viene el golpe antes de que
llegue. Cualquier adorno que compita con esa lectura se saca, por lindo que sea. Lo que queda
tiene que parecer inevitable.
