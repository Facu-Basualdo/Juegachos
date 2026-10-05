# Parrilla Sagrada

Dirección de arte de Chori y Pan. Cada decisión visual de `Renderer.ts`, `Sprites.ts`, del HUD y de `style.css` responde a este documento. La referencia pedida por el programador es el **templo perdido** del juego cooperativo de los dos elementos: ruinas de piedra con musgo, jeroglíficos que brillan, antorchas, y piletas de lava y de agua que relucen. Lo que le agregamos es humor: los que se meten en el templo son un chorizo y un pan, y el templo, visto de cerca, es una parrilla milenaria.

El templo es piedra vieja y pesada. Los bloques son arenisca verdosa tallada a mano, con el borde de arriba gastado y claro y una sombra corta abajo; donde les da el aire, les crece musgo en mechones. Las paredes del fondo están dos pasos más oscuras que los bloques donde se pisa, con relieves de jeroglíficos que respiran un brillo tenue, enredaderas que cuelgan y antorchas que tiñen la piedra de naranja. Lo que se pisa tiene que leerse al instante contra lo que es fondo: esa diferencia de valor es la regla número uno.

Los líquidos son el idioma del juego y no pueden mentir. **Las brasas** son naranja y rojo, con carbones que respiran y chispas que suben: ahí camina el Chori. **El agua** es azul con brillos que corren: ahí nada el Pan. **El chimichurri vencido** es verde ácido con burbujas y pedacitos de perejil: no lo toca nadie. Cada pileta está hundida en el piso y su superficie se mueve; nada más en la pantalla usa esos tres colores con esa saturación.

Los personajes son de juguete y con cara, en la línea de los dibujos animados de goma de los años 30. **El Chori** es un chorizo **acostado**, solo el chorizo y sin pan: una cápsula horizontal rojo cobriza con marcas de parrilla en diagonal y los nudos del hilo en las dos puntas, brazos y piernas de manguera negros con guantes blancos y zapatillas amarillas, ojos grandes a medio párpado y una sonrisa con dientes; humea un poco, porque está caliente. **El Pan** es una baguette **parada**, alta y dorada, con seis cortes en diagonal más claros, ojitos de punto, una sonrisa enorme con dientes y bracitos y patitas de palito negros. Las extremidades negras llevan un halo cálido, porque contra la pared oscura del templo se pierden. Se estiran al saltar, se aplastan al caer y mueven las patas al caminar: tienen peso. Cuando el Chori cae al agua se empapa y se pone oscuro y triste; cuando el Pan cae a las brasas se tuesta hasta quedar negro, con humo.

Los mecanismos son de templo, no de fábrica: botones de piedra, palancas de madera, compuertas de losa y ascensores de piedra colgados de cadenas. Cada canal tiene su color (dorado, violeta, turquesa, rosa) en una franja tallada y brillante, así se entiende qué botón abre qué compuerta sin leer nada. Las gemas son un ají rojo para el Chori y un cubito de hielo para el Pan, y las puertas de salida llevan el dibujo de su dueño.

El HUD es una tablilla de piedra arriba: el nivel, el reloj y las gemas. En la sala, una franja con las otras parejas y en qué nivel van.

## Paleta

| Uso | Color |
| --- | --- |
| Fondo del templo | `#14120c` a `#26241a` |
| Piedra que se pisa | `#6f6a4c`, luz `#a59d72`, sombra `#3e3a28` |
| Musgo | `#5f8a3a`, claro `#9cc65a` |
| Jeroglíficos | `#d9b45a` tenue |
| Brasas | `#ff7a1a`, `#ff3d1a`, carbón `#3a1408` |
| Agua | `#3aa8ff`, `#9fe2ff`, fondo `#14508a` |
| Chimichurri | `#7ad13a`, `#c4f06a`, fondo `#2e5a14` |
| Chori | `#b8462a`, oscuro `#7a2414`, marcas `#5a1a0c` |
| Pan | `#e3a14e`, claro `#f2b866`, cortes `#b06a24` con centro `#fbdca6` |
| Extremidades | negro `#1c1a1e`, guantes `#ffffff`, zapatillas `#f2c230`, halo `rgba(255, 222, 160, 0.75)` |
| Canales | dorado `#ffd36a`, violeta `#b48cff`, turquesa `#4ee6d2`, rosa `#ff6fae` |
| Texto | `#f3ead2`, apagado `#b3a885` |

## Vocabulario

- **Chori** y **Pan**: la pareja. Chori con las flechas, Pan con WASD (en local).
- **Brasas / agua / chimichurri**: las tres piletas.
- **Ají / cubito**: las gemas de cada uno.
- **Nivel**: una sala del templo, entra en una pantalla. Tres por carrera.
- **Canal**: el color que une un botón o una palanca con lo que mueve.
