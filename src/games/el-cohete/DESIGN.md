# Neón Atómico

Dirección de arte de El Cohete. Cada decisión visual de `Stage.ts`, `Rocket.ts`, `City.ts`, `Effects.ts`, del HUD y de `style.css` responde a este documento. La referencia pedida por el programador es un **casino retro de los años 50**: Las Vegas de noche, letreros de neón, paño verde, fichas de arcilla con relieve, un cohete de hojalata como juguete a cuerda y el cielo de un póster de la era atómica. Es un homenaje a ese lenguaje, nunca la copia de un casino, una marca o un letrero real; todo se dibuja por código.

El cohete es un juguete caro. Hojalata roja laqueada con una faja crema, la nariz y la tobera cromadas, un ojo de buey con vidrio verdoso, una hilera de remaches que atrapa la luz y tres aletas en flecha como las de un auto de la época. No es una nave: es el objeto que un chico del 57 tenía en la vidriera y nunca le compraron. Se ve brillante porque el cromo refleja la ciudad, no porque brille solo; lo único del cohete que emite luz es su fuego.

La ciudad es el casino. Abajo hay un tejado con la plataforma de lanzamiento, una torre de lanzamiento reticulada pintada de rojo y el letrero gigante del casino con bombitas que corren en ronda. Alrededor, la avenida: edificios oscuros con ventanas encendidas al azar y letreros de neón en tres colores (rosa, turquesa y amarillo de bombita), y reflectores que barren el cielo. Desde el tejado la ciudad es un bosque de luz; a medida que el cohete sube se aplana en una alfombra brillante, y después en un resplandor violeta en el horizonte.

El cielo cuenta la altura. Empieza índigo con el resplandor rosado de la ciudad, atraviesa nubes bajas teñidas de violeta por las luces de abajo, y desemboca en el espacio de los pósters atómicos: negro azulado, estrellas de cuatro puntas que titilan, un Sputnik que pasa y un planeta con anillos. Subir más alto tiene que verse como un premio, porque lo es.

El humo es el idioma del juego y no puede mentir. **Blanco es amague**: una bocanada limpia de vapor y el fuego vuelve. **Negro es la explosión**: el fuego se pone rojo y tose a los tirones, el casco tiembla, el humo sale espeso y negro y no para. Nada más en la pantalla usa humo negro, para que la decisión se tome con el rabillo del ojo. La explosión es la recompensa del codicioso perdido: un fogonazo blanco, una bola de fuego naranja que se oscurece, chispas, la onda expansiva en anillo y las aletas que salen volando.

Bajarse es literal. El que cobra salta del cohete con un paracaídas a rayas, el muñeco de bloques de la casa con la remera de su color, y baja flotando con su nombre. En la sala, ver saltar a los otros mientras uno sigue arriba es la mitad del juego.

El HUD es mobiliario de casino, no interfaz. El multiplicador vive en un cartel de marquesina con bombitas, en letras de bloque doradas que se encienden más cuanto más alto va. Abajo, un paño verde con borde dorado donde están las fichas: discos de arcilla con canto de rayas y relieve, en sus colores de mesa. El botón principal es una ficha gigante roja con aro cromado: APOSTAR antes del despegue, BAJARME en vuelo, con lo que se cobra escrito adentro. El historial de vuelos son fichitas en fila con el multiplicador de cada explosión.

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
| Humo de amague | `#f2efe9` |
| Humo de la explosión | `#1a1414` |
| Peligro, explosión | `#ff3b2f` |
| Fichas 10 / 50 / 100 / 500 | azul `#2f6fd6` / roja `#d23a33` / negra `#1d1d22` / violeta `#7d3fc0` |
| Texto | `#fff4dc`, apagado `#c9b89a` |

## Tipografía

- **Monoton**: solo el logo "EL COHETE" (neón de varias líneas).
- **Bungee**: los números de la marquesina y las fichas (letra de bloque de cartel).
- **Righteous**: rótulos, botones y textos del HUD (geometría de los 50).

## Vocabulario

- **Vuelo**: cada ronda. Diez por partida, numerados.
- **Despegue**: el cohete sale de la plataforma; el multiplicador arranca en x1.00.
- **Tos**: el motor falla. Humo blanco es amague; humo negro, explota.
- **Bajarse**: cobrar. El muñeco salta con paracaídas.
- **Explotó**: el cohete revienta; el que seguía arriba pierde lo apostado.
- **Falla de encendido**: explota en la plataforma (x1.00), sin aviso.
