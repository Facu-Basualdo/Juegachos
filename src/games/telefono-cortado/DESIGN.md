# El Lienzo en la Oscuridad

Direccion de arte de Telefono Cortado. Toda decision visual del `Hud` y de
`style.css` responde a este documento. Amplia la direccion original del juego
(minimalismo contrastante, urgencia y claridad) sin cambiarla.

**El lienzo es el protagonista y todo lo demas se aparta.** La pantalla existe para
sostener un rectangulo blanco: lo unico verdaderamente iluminado de la composicion. El
fondo es la foto del juego desenfocada y bajada a un cuarto de su brillo — presencia,
no informacion — y sobre ella las superficies son paneles casi negros y semitransparentes.
Nada compite con el papel. Cuando aparece un dibujo ajeno para adivinar, se lo trata con
el mismo respeto que al lienzo propio: fondo blanco, marco grueso, sombra proyectada, como
una foto sobre una mesa oscura.

**La interfaz es utilitaria, no decorativa.** Las herramientas son iconos de linea de un
solo trazo, del ancho de un lapiz, en una columna angosta al costado del papel: se leen de
un vistazo y no piden atencion. Los radios de esquina son cortos — lo suficiente para
sentirse software, nunca lo suficiente para sentirse un juguete. No hay ilustracion, ni
texturas, ni sombras internas de adorno. Todo lo que no sea el dibujo, el reloj o el texto
que hay que leer, sobra y se saca.

**El color habla tres idiomas y ninguno mas.** El azul (`#007bff`) es la accion: el boton
que avanza, la herramienta elegida, la barra de tiempo mientras hay tiempo. El amarillo
(`#ffcc00`) es la palabra: la frase propia, la pista del ahorcado, los puntos — todo lo que
es lenguaje en un juego que trata sobre el lenguaje deformandose. El rojo aparece una sola
vez, cuando al reloj le queda menos de un cuarto, y por eso significa algo. El verde queda
reservado para el unico hecho binario del roster: ya entregaste. Fuera de esos, gris.

**El tiempo se ve antes de leerse.** Cada fase tiene un reloj y el reloj es primero una
barra que se vacia y despues un numero. Se anima contra el reloj de la pared, no contra los
snapshots del server, porque una barra que salta delata la red y arruina la tension; una que
baja parejo es la fase acabandose. El color del relleno es la unica alarma que el juego se
permite.

**Cada fase es una sola pregunta.** Escribir, dibujar, adivinar: en pantalla hay un
enunciado, un campo y un boton, en ese orden vertical y centrados. No hay navegacion, ni
pestañas, ni nada opcional; el jugador nunca tiene que decidir donde mirar, porque la fase
ya decidio por el. El roster vive arriba, chico y al margen, como un dato de fondo — quien
falta, quien ya esta — y jamas interrumpe.

**El final es una vitrina, no una tabla.** El reveal abandona la austeridad de las fases:
las cadenas se muestran como fichas — la frase en amarillo arriba, el dibujo en su marco
blanco, la autoria en gris pequeño, el veredicto abajo — repetidas en una grilla que se
puede recorrer. Es el unico momento en que el juego invita a quedarse mirando en vez de
apurar, y la composicion tiene que darle permiso.
