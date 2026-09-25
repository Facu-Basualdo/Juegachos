# Ascenso de Basalto

Direccion de arte de Marea de Lava. Cada decision visual de `TowerView.ts`, `Stage.ts`, `Avatar.ts`, `textures.ts` y del HUD responde a este documento. Es la tercera de la familia voxel (Derrumbe, Pista Loca): homenaje al lenguaje de bloques de Minecraft en su version infernal, **nunca** una copia de sus assets, logos ni tipografias. Todo se pinta por codigo, 16x16, `NearestFilter`.

Es una pared de roca que sube hacia la oscuridad y una marea de lava que la persigue. El jugador la ve de frente, como un escalador visto desde el vacio: una cara ancha de basalto al fondo, y delante, salientes de piedra a distintas profundidades por donde se trepa. La composicion es vertical y tiene una sola direccion: arriba es la salvacion, abajo es la muerte, y la pantalla lo dice sin palabras porque la luz sale de abajo.

La lava es la unica fuente de luz calida del mundo y el reloj del juego. Emite naranja y amarillo en pixeles gruesos que se desplazan, ignora la niebla y tiñe de naranja todo lo que tiene cerca: las plataformas proximas a la superficie se encienden por abajo y las altas quedan en azul humo. Mientras sube, esa franja encendida sube con ella, asi que el peligro se lee por el color de la roca antes de mirar el marcador. Sobre la superficie flotan chispas cuadradas que suben y se apagan.

La roca habla en dos materiales. La pared del fondo es basalto de vetas verticales, gris oscuro y frio: es escenografia y no se pisa. Las plataformas son piedra negra con el canto un escalon mas claro, para que el borde de cada saliente se lea al instante contra la pared; las chicas (las mas dificiles) tienen la tapa de piedra luminosa amarilla, que es la unica otra luz del mundo y avisa "esta cuesta". La cima es una plataforma ancha de piedra luminosa con una bandera de bloques.

Los jugadores son los muñecos de bloques de la familia: remera del color del asiento, que es el unico color personal y lo que los identifica contra la roca. Debajo de cada uno, una sombra de contacto sobre la plataforma de abajo dice donde va a caer, que en un juego de saltos es informacion y no decorado.

Arriba todo se va a negro. La niebla es azul muy oscuro y se come lo que esta lejos de la camara; las plataformas altas aparecen de la penumbra a medida que se sube, lo justo para planear el proximo salto.

El HUD escribe como los otros juegos voxel: negrita con sombra dura, paneles negros de bordes rectos. Muestra la altura propia en metros, la distancia a la lava (que late en rojo cuando esta cerca), cuanto falta para la cima y quienes siguen en carrera. Nada mas.
