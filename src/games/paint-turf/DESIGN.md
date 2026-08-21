# Manchon — Direccion de arte: "Tempera Humeda"

Filosofia visual del juego. Toda decision del `Renderer.ts` y del `style.css`
responde a este documento; si algo se ve bien pero contradice lo de aca, se saca.

## El manifiesto

Una hoja de papel apoyada sobre una mesa, y encima pigmento. Eso es todo lo que
existe en Manchon. No hay pantalla, no hay grilla de juego, no hay interfaz
flotando en el vacio: hay una **superficie fisica** con grano, borde y sombra, y
hay **materia** que se deposita sobre ella. La pregunta que decide cada linea de
codigo de dibujo es siempre la misma: *esto, en el mundo real, seria papel o seria
pintura?* Lo que no es ninguna de las dos cosas no entra. Esa disciplina — sostenida
sin excepciones, celda por celda, cuadro por cuadro — es lo que separa un tablero de
colores de una obra que parece haber pasado por las manos de alguien que lleva anos
haciendo esto.

**El pigmento es opaco y desparejo.** La tempera no es tinta digital: se seca en
capas de espesor distinto, carga mas donde el pincel apoyo y menos donde se
arrastro, y jamas cubre dos veces igual. Ninguna region de color plano puede
quedar plana. Cada unidad de pintura lleva su propia variacion de carga y su
propia pincelada encima, decididas de forma determinista para que la mancha sea
siempre la misma mancha — porque una textura que titila entre cuadros delata la
maquina, y la textura que se queda quieta se lee como pintura seca. El trabajo
esta en la acumulacion: cientos de variaciones minusculas, ninguna visible sola,
todas juntas la razon por la que la superficie parece pintada a mano.

**El borde de una mancha nunca es una linea recta.** El error que arruinaria todo
seria dejar ver la grilla que hay debajo. La pintura se desborda de su unidad hacia
las vecinas en cantidades distintas por lado, asi que los limites internos de un
territorio desaparecen bajo el pigmento del vecino y solo sobrevive dentado el
contorno exterior, que es exactamente lo que hace el agua en el papel. Un
territorio tiene que leerse como **un** manchon, no como muchos cuadraditos del
mismo color; el momento en que el ojo cuenta celdas, la ilusion se murio.

**El color es una caja de tempera escolar, y esta cerrada.** Ocho pigmentos
elegidos con criterio de pintor: cada uno tiene que distinguirse de los otros
siete y ademas del crema del papel, tambien en una mancha del tamano de una
moneda y tambien para quien confunde el rojo con el verde. Bermellon, ultramar,
ocre, savia, violeta, naranja quemado, aniil, frambuesa. Nada fluorescente, nada
que brille: la tempera absorbe la luz, no la emite. El unico negro del juego es la
**tinta** del contorno, y por eso vale tanto — se reserva para lo que tiene que
leerse primero: el borde del pincel, el marco de la hoja, los nombres.

**La jerarquia la manda el juego, no el adorno.** Ocho pinceles moviendose sobre
un tablero que cambia entero cada segundo es demasiada informacion; el diseno esta
para ordenarla. El pincel propio se distingue por algo que no es su color, porque
con ocho colores el color solo no alcanza. El territorio se lee de un vistazo en
una sola barra repartida, nunca comparando ocho numeros. El aturdimiento se ve
antes de leerse: el pincel tambalea y deja de largar pigmento. Lo que no informa
nada se saca, por lindo que sea.

**El HUD esta escrito sobre la mesa, no montado sobre vidrio.** Nada de paneles
translucidos con desenfoque ni bordes que brillan. La informacion se apoya en el
mismo mundo: tinta sobre crema, carteles que son hojas con su sombra proyectada,
botones que se cargan de pintura de abajo hacia arriba. Y lo que ocupe tablero
tiene que dejar ver lo que hay abajo, porque el jugador puede estar justo ahi.

**El resultado tiene que parecer trabajado durante meses.** No por cantidad de
efectos — el catalogo es corto a proposito — sino por la obstinacion con que se
aplica el mismo puñado de reglas en cada milimetro: el grano del papel que
tambien se ve sobre el pigmento, el reflejo humedo del pincel siempre en la misma
esquina, la sombra que cae siempre para el mismo lado porque la luz de la
habitacion no se mueve. Consistencia de nivel maestro en decisiones que nadie
nombra pero todos sienten. Nada debe quedar que un buen pintor todavia tendria
ganas de retocar.
