# Cinta Gastada

Filosofia de diseño de La Feria, la sala 3D de `/rooms/lobby/`. Es la direccion de arte de la escena Three.js, del filtro de pantalla y del HUD; cada decision visual de `src/lobby3d/` le responde a este documento. (Reemplaza a "Facetas al Sol", la primera version low poly pastel: el programador la cambio por esta.)

La Feria es un lugar al que no deberias haber entrado. Un claro en un bosque de pinos negros, una feria que cerro hace años y alguien volvio a enchufar: carteleras de madera podrida con afiches de juegos, un televisor de tubo sobre un cajon, guirnaldas de lamparitas que titilan y una torre de andamios oxidados que se pierde en la niebla con una luz roja arriba. Las referencias son Puppet Combo y Misery: juegos que usan la pobreza tecnica de la primera PlayStation como fuente de miedo. Nada es gore; todo es incomodo.

La imagen es una cinta gastada, no un render. La escena se dibuja a una resolucion baja (400 lineas) y se estira con pixeles duros. Los vertices se ajustan a esa grilla y tiemblan cuando la camara se mueve; los colores se cuantizan con un tramado ordenado. Arriba de todo, grano de VHS y un viñeteado que se come las esquinas. Esto no es un efecto opcional: es el material de la Feria. Cualquier objeto nuevo pasa por el mismo pipeline (`retro.ts`) o se ve fuera de lugar.

Pero la estetica nunca le gana a saber que juego es cada afiche (lo pidio el programador al verla). Por eso la imagen interna es de 400 lineas y no de 240 como la PS1 real, los afiches y los carteles van nitidos (256 px, con mipmaps) y sin niebla, y **no hay mapeo afin**: deformaba las texturas en diagonal al mirar el piso o un afiche de costado, y se veia roto, no retro.

La oscuridad es la composicion. Siempre es de noche y la niebla es densa y casi negra: se ve lo que ilumina una lamparita y poco mas. La luz tiene fuentes que se entienden (focos, guirnaldas, el televisor, la baliza de la torre) y cada una deja su charco; entre charco y charco, penumbra. Las lamparitas titilan de a una, nunca todas juntas.

La partida empeora la noche. En el lobby la feria esta "abierta": las guirnaldas prendidas, niebla moderada. Cada ronda jugada quema lamparitas, espesa la niebla y tiñe el aire de rojo. La final es con luna roja, bengalas y ceniza cayendo. El clima (lluvia, niebla cerrada) sale de una semilla de la sala: todos ven la misma noche.

Las texturas son chiquitas y sucias. 32 o 64 pixeles, filtro al mas cercano, pintadas por codigo con ruido: madera con vetas y manchas, chapa oxidada, tierra, pasto muerto, papel de afiche comido por la humedad. Ningun color plano limpio salvo lo que tiene que leerse.

Lo que se toca se lee igual. La dificultad visual nunca le puede ganar a la informacion: los afiches de los juegos candidatos se prenden con un foco y un marco rojo, la plataforma LISTO tiene su cartel pintado a mano, los contadores de votos y los nombres de los jugadores van sin filtro de profundidad, y el marcador son columnas del color de cada jugador que se ven en la oscuridad. Si algo se puede tocar, tiene su propia luz.

Los jugadores son muñecos de trapo: cuerpo de bolsa cosida, cabeza de arpillera con dos ojos de boton y la boca cosida, manos que flotan. (Tuvieron una mascara palida; el programador la saco: quedaba fea.) Los accesorios (gorra, gorro de fiesta, vincha, galera) se apoyan sobre la cabeza, nunca la atraviesan. La remera (del color del asiento, apagado) es la unica marca personal. El que tiene la corona de la torre la lleva puesta, dorada y con luz propia: es lo unico que brilla limpio en toda la feria.

El HUD es la pantalla de una videocasetera. Letra de monitor (`VT323`), texto claro sobre negro translucido, un punto rojo de REC titilando junto al codigo de la sala. Nada de papel crema: aca no hay nada prolijo.

## Paleta

| Uso | Color |
| --- | --- |
| Niebla y cielo (lobby / final) | `#0b0d10` / `#1a0506` |
| Luna | `#b9c2c9` (lobby), `#c0392b` (final) |
| Lamparitas | `#ffb35c` calido, las que fallan `#ff5a36` |
| Tierra / pasto muerto | `#3a3024`, `#4a4a2c`, `#2b2a1c` |
| Madera podrida | `#5a4632`, vetas `#3b2d20` |
| Oxido | `#6b3a22`, `#8a4b2a`, chapa `#4c4f52` |
| Baliza de la torre | `#ff2a1a` |
| Corona | `#ffcf4a` con luz propia |
| HUD | texto `#e8e4d8`, fondo `rgba(8, 8, 10, 0.72)`, acento `#ff3b30` |

Remeras de los jugadores (por asiento, apagadas por la noche pero distinguibles): `#c0504d`, `#4f81bd`, `#d8b83a`, `#6aa84f`, `#8e7cc3`, `#d9822b`, `#c27ba0`, `#45a5b5`.

## Vocabulario

- **Claro**: disco de tierra y pasto muerto, cercado por un alambrado torcido; afuera, pinos negros hasta perderse en la niebla.
- **Carteleras**: las portadas de los juegos de sala como afiches en tableros de madera, en semicirculo al norte; cada votacion sortea que juegos muestran. Se puede votar cualquiera: delante de cada una hay una chapa en el piso que brilla apenas, y mas cuando el juego tiene votos; su foco colgando se prende en los votados, el que va ganando con mas fuerza y su contador en dorado.
- **Televisor**: un CRT sobre un cajon en el centro; muestra el juego de la ronda con lineas de barrido, o estatica. Cuando salen los resultados se hunde y suben las columnas del marcador.
- **Escenario REROLL**: tarima de madera al sur del centro con el cartel pintado (era LISTO, para el briefing que la feria ya no tiene). Subirse pide otros afiches.
- **Pizarra de la noche**: pizarron de tiza apaisado en un marco de chapa oxidada sobre patas, al sur detras del spawn, con la franja roja y blanca de los puestos de feria arriba y una lampara de obra con jaula. Ahi se anota quien gano el ultimo juego y los puntos de la noche, cada nombre en la tiza del color de su remera. Es lo opuesto al cartel de records de la torre (tablas pintadas en vertical): ese es para siempre, esta se borra y se vuelve a escribir.
- **La Torre**: andamio oxidado al suroeste, parkour hasta una plataforma con un trono y la baliza roja.
