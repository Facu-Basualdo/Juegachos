# Losa de Creta

Direccion de arte de Minotauro. Cada decision visual de `Renderer.ts`, del HUD y de `style.css` responde a este documento. La referencia pedida por el programador es "Labyrinthos" (un laberinto griego de piedra iluminado por una llama): de ahi salen la paleta terracota, la greca, las capitales romanas y la oscuridad que solo rompe el fuego. Lo que le agregamos es miedo: el laberinto tiene dueño.

El laberinto es una losa de piedra tallada vista desde arriba, como una tabla votiva que alguien dejo en un templo. Nada es plano: el piso es piedra arenisca moteada, los muros son bloques levantados con la cara de arriba mas clara y una sombra corta hacia abajo a la derecha, y alrededor corre un marco con la greca tallada y una roseta en cada esquina. La tipografia es la de una inscripcion: capitales romanas espaciadas, numeros romanos para los niveles (DESCENSVS II), palabras latinas chiquitas como rotulo y el castellano como voz del juego.

La luz es el juego. Todo esta a oscuras salvo lo que alumbra la antorcha, y la antorcha se gasta: su circulo se achica a medida que se acaba el aceite, titila, y cuando esta por morir tiembla. Lo que ya se recorrio queda en la memoria como un recuerdo tenue, en el mismo tono de la piedra pero apagado: se puede volver a encontrar el camino, pero no se ve que hay ahi ahora. La luz es calida y anaranjada, cae con suavidad y deja un halo dorado sobre el piso; nunca es blanca.

El hilo de Ariadna es la firma: un hilo rojo que el jugador va soltando por donde camina, con una curva leve como de lana, que cuenta el recorrido entero. Es lo unico de color saturado que no es fuego, y por eso se lee aun en la memoria apagada.

El Minotauro es una forma oscura con cuernos, mas negra que la piedra. No se dibuja con detalle: se adivina. En la oscuridad solo se le ven los ojos, dos brasas rojas, cuando esta despierto y cerca, y su aliento cuando persigue. Cuando entra en la luz se ve el lomo, los cuernos y las pezuñas. La pantalla le responde: un pulso rojo en los bordes al ritmo del corazon cuando esta cerca, un temblor cuando brama.

El oro es la salvacion. El ovillo de oro (la salida al nivel de abajo) y las anforas de aceite brillan un poco aunque esten lejos de la luz: tienen que encontrarse. El dorado viene en degrade, del crema al cobre, como el oro gastado de una moneda.

El HUD es piedra tallada, no interfaz: estelas de piedra a los costados con el tiempo, el nivel y el aceite (una barra como una mecha que se consume), botones como tablillas en relieve y el titulo grabado con un degrade de oro. En el celu las estelas se vuelven una franja angosta arriba y nada tapa la losa.

## Paleta

| Uso | Color |
| --- | --- |
| Noche, fondo | `#0d0704` |
| Piedra oscura / umbra | `#241509`, `#2e1c0e` |
| Piso de arenisca | `#6b4a2b` (moteado entre `#5a3c22` y `#7d5733`) |
| Muro, cara superior | `#a8743f` a `#c4773b` |
| Muro, sombra | `#3a2414` |
| Greca y relieves | `#e2b07a`, sombra `#7a4a22` |
| Oro (ovillo, titulos) | `#f6d9a8` a `#c4773b`, brillo `#e8b64a` |
| Llama de la antorcha | `#fff2c4`, `#ffb347`, `#e8592a` |
| Teseo | remera del asiento (rojo `#e2433b` en solo), pantalon `#34406a`, palo `#6b3f1f` |
| Hilo de Ariadna | `#b8231b` |
| Ojos del Minotauro, peligro | `#ff3a1f` |
| Texto | `#f0d6ac`, apagado `#a9825a` |

## Vocabulario

- **Losa**: el tablero, con su marco de greca y cuatro rosetas.
- **Teseo**: el jugador. El muñeco de bloques de la casa (el de Marea de Lava: cabeza cubica, remera del color de su asiento, pantalon azul) visto en tres cuartos desde arriba, con la antorcha levantada en la mano. La llama y las brasas salen de la punta de la antorcha. Mira para donde camina y balancea las piernas con el paso; en la sala cada uno tiene el color de su asiento y su nombre arriba en ese color.
- **Aceite**: anforas chicas tiradas en los rincones sin salida; recargan la antorcha.
- **Ovillo**: el ovillo de oro, la salida al laberinto de abajo.
- **Descensos**: los niveles, numerados en romanos.
