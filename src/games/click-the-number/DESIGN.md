# Sala Fria

Direccion de arte de Click the Number. Escrita para su renderer de DOM/CSS; toda decision visual de `style.css` y `Hud.ts` responde a este documento.

Esto no es un juego de luces: es un instrumento de medicion, y el instrumento medido sos vos. La pantalla es el panel de una sala de control a las cuatro de la manana — nadie mirando, ninguna alarma sonando, solo un operador y una grilla de digitos esperando ser leidos. Todo lo que se dibuja existe para que el ojo encuentre un numero entre veinticinco en una fraccion de segundo. Lo que no ayuda a esa busqueda es ruido, por lindo que sea, y se saca.

El frio es el punto de partida, no un color. El fondo es un azul tan profundo que casi es negro, y se queda ahi: nunca compite, nunca respira, nunca palpita. Sobre el, las celdas son placas apenas mas claras — metal pintado bajo luz indirecta, no vidrio, no gelatina. Un hairline de un pixel las separa del fondo; ese hairline es toda la arquitectura que el tablero necesita. Si una celda pide mas borde, es que el contraste de adentro esta mal resuelto.

El digito manda. Es lo unico con derecho al blanco puro, monoespaciado y de cifras tabulares, porque un `11` y un `17` tienen que ocupar exactamente el mismo ancho: si los numeros bailan de posicion entre celdas, el ojo pierde milisegundos recalibrando y el juego miente sobre tu reflejo. Ni sombras, ni degrade, ni outline. Un numero legible a un metro de distancia y a treinta grados de angulo, o no sirve.

El cian es el unico acento, y se gasta una sola vez: marca lo que ya cazaste. Al acertar, la celda se hunde como una tecla mecanica que toca fondo — un desplazamiento corto, una sombra que se cierra — y el digito se apaga dejando la placa muerta y oscura. Eso es todo: sin explosion, sin particulas, sin estela. La recompensa de este juego no es un efecto, es que la grilla se vacie y encontrar el siguiente sea cada vez mas facil. La animacion dura menos de lo que tarda el dedo en llegar a la proxima celda, siempre, porque una celebracion que se interpone en el camino es un impuesto al puntaje.

El error se dice en voz baja y se olvida rapido. Un flash rojo corto en la celda equivocada, un tick sordo, y nada mas: no hay penalidad de tiempo porque el reloj ya la cobro. El rojo no persiste, no acumula, no lleva registro. Es un instrumento avisando que ese canal no responde, no un juez.

La composicion se lee de un golpe. La grilla al centro, cuadrada, con el aire suficiente para que el pulgar no dude entre dos celdas. Arriba, una barra con el cronometro y el numero que toca — la unica informacion que el jugador consulta mientras juega, en el mismo tipo tabular que el tablero, para que el reloj corriendo no tironee el ojo con cifras que cambian de ancho. Todo lo demas — titulos, records, ratings — vive en el overlay y desaparece cuando arranca la ronda. Durante la partida en pantalla hay veinticinco numeros, un reloj y silencio.
