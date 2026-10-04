# Neón Atómico

Dirección de arte de El Cohete. Cada decisión visual de `Stage.ts`, `Rocket.ts`, `City.ts`, `Sky.ts`, `Space.ts`, del HUD y de `style.css` responde a este documento. La referencia pedida por el programador es un **casino retro de los años 50**: Las Vegas de noche, letreros de neón, paño verde, fichas de arcilla con relieve, un cohete de hojalata como juguete a cuerda y el cielo de un póster de la era atómica. Es un homenaje a ese lenguaje, nunca la copia de un casino, una marca o un letrero real; todo se dibuja por código.

El cohete es un juguete caro. Hojalata roja laqueada con una faja crema, la nariz y la tobera cromadas, un ojo de buey con vidrio verdoso, una hilera de remaches que atrapa la luz y tres aletas en flecha como las de un auto de la época. No es una nave: es el objeto que un chico del 57 tenía en la vidriera y nunca le compraron. Se ve brillante porque el cromo refleja la ciudad, no porque brille solo; lo único del cohete que emite luz es su fuego.

La ciudad es el casino. Abajo hay un tejado con la plataforma de lanzamiento, una torre de lanzamiento reticulada pintada de rojo y el letrero gigante del casino con bombitas que corren en ronda. Alrededor, la avenida: edificios oscuros con ventanas encendidas al azar y letreros de neón en tres colores (rosa, turquesa y amarillo de bombita), reflectores que barren el cielo, un dirigible plateado que pasa con el nombre del casino en neón y fuegos artificiales mientras se apuesta: el casino está de fiesta. Desde el tejado la ciudad es un bosque de luz; a medida que el cohete sube se aplana en una alfombra brillante, y después en un resplandor violeta en el horizonte.

El cielo cuenta la altura. Empieza índigo con el resplandor rosado de la ciudad, atraviesa nubes bajas teñidas de violeta por las luces de abajo, y desemboca en el espacio de los pósters atómicos: negro azulado, estrellas de cuatro puntas que titilan, un Sputnik, un cinturón de asteroides y polvo que pasa como lluvia. Y planetas, uno detrás de otro, que el cohete deja abajo: la Luna, Marte, uno con anillos, un gigante azul, uno verde y uno de lava, cada uno con su halo. Subir más alto tiene que verse como un premio, porque lo es: cada planeta es un multiplicador que pocos ven.

El cohete explota sin avisar: es timba. La explosión es la recompensa del codicioso perdido: un fogonazo, una bola de fuego naranja que se oscurece, chispas, la onda expansiva en anillo y las aletas que salen volando.

Bajarse es literal. El que cobra salta del cohete con un paracaídas a rayas, el muñeco de bloques de la casa con la remera de su color, y baja flotando con su nombre. En la sala, ver saltar a los otros mientras uno sigue arriba es la mitad del juego.

El HUD es mobiliario de casino, no interfaz, y se entiende de un vistazo. Antes del despegue, la marquesina con bombitas cuenta los segundos para apostar, y abajo hay un paño verde con borde dorado con dos pasos numerados: "1 Elegí cuánto apostar" (fichas de arcilla con canto de rayas; tocar una fija la apuesta y la elegida sube con un aro dorado) y "2 Apostá" (una ficha gigante roja con aro cromado que dice cuánto). En cuanto se apuesta, el paño se va: la pantalla queda para el cohete y un número gigante dorado con lo que se gana si se cobra ya, y para cobrar se toca cualquier parte. Al cobrar el número se vuelve turquesa. El historial de vuelos son fichitas en fila con el multiplicador de cada explosión.

## Paleta

| Uso | Color |
| --- | --- |
| Cielo de noche (arriba / horizonte) | `#07061a` / `#2a1248` |
| Resplandor de la ciudad | `#ff5a8a` |
| Neón rosa / turquesa / bombita | `#ff3d8b` / `#2ee6d6` / `#ffd36a` |
| Bombita encendida (núcleo) | `#fff1c9` |
| Paño | `#0f5a3c`, sombra `#0a3b28` |
| Oro (bordes, marquesina, ganancias) | `#f6d58a` a `#c8962f` |
| Hojalata roja / crema / cromo | `#d7332b` / `#f3e6c8` / `#c9d1d8` |
| Humo de la estela | `#8e8296` a `#362c42` |
| Peligro, explosión | `#ff3b2f` |
| Fichas 10 / 50 / 100 / 500 | azul `#2f6fd6` / roja `#d23a33` / negra `#1d1d22` / violeta `#7d3fc0` |
| Texto | `#fff4dc`, apagado `#c9b89a` |

## Tipografía

- **Monoton**: solo el logo "EL COHETE" (neón de varias líneas).
- **Bungee**: los números de la marquesina y las fichas (letra de bloque de cartel).
- **Righteous**: rótulos, botones y textos del HUD (geometría de los 50).

## Vocabulario

- **Vuelo**: cada ronda. Cuatro por partida, numerados.
- **Despegue**: el cohete sale de la plataforma; el multiplicador arranca en x1.00.
- **Cobrar**: bajarse a tiempo. El muñeco salta con paracaídas.
- **Explotó**: el cohete revienta sin aviso; el que seguía arriba pierde lo apostado.
- **Falla de encendido**: explota en la plataforma (x1.00), sin aviso.
