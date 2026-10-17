# Agar — Direccion de arte: "Camara de Conteo"

Filosofia visual del juego. Toda decision del `Renderer.ts` y del `style.css`
responde a este documento; si algo se ve bien pero contradice lo de aca, se saca.

(El programador no fijo una direccion estetica y delego la eleccion. Esta es la
propuesta; si se cambia, se cambia aca primero.)

## El manifiesto

El nombre del juego es una sustancia: el **agar** es el gel ambar sobre el que se
cultivan bacterias. Agar no es un tablero de colores planos, es **una muestra bajo
el microscopio**. El mapa cuadrado es una camara de conteo (el portaobjetos
cuadriculado con que un laboratorio cuenta celulas), la pantalla es lo que entra
por el ocular, y lo que se mueve encima esta **vivo**. La pregunta que decide cada
linea de dibujo: *esto, mirado por un microscopio de campo claro, como se veria?*

## Principios

**1. La luz viene de abajo.** Campo claro: el gel es la superficie mas luminosa de
la escena y todo lo demas se recorta contra ella. Nada brilla por su cuenta, nada
tiene glow. Lo que esta afuera del portaobjetos es el tubo del microscopio: casi
negro, calido, con la vineta circular del ocular cerrando la vista.

**2. Las celulas son membranas, no discos.** Cada celula es un relleno tenido y
traslucido (se adivina la cuadricula a traves) con una membrana mas oscura del mismo
tinte. El borde respira: una ondulacion lenta y chica, distinta para cada celula,
que hace que nada parezca un sticker. Las grandes muestran un nucleo. La propia se
distingue por foco, no por un color especial: su membrana es tinta nitida.

**3. El color es tincion de laboratorio.** Doce tintes reales, apagados y
reconocibles (azul de metileno, eosina, violeta de genciana, safranina, verde de
malaquita, iodo, rojo Congo, fucsina, azul de toluidina, Giemsa, sudan, Gram). La
comida son colonias chicas en seis tonos palidos del mismo vocabulario. Ningun
color saturado de pantalla: si un tono no podria salir de un frasco de tincion,
no va.

**4. La cuadricula es instrumento.** Lineas finas cada 50 unidades y triples cada
250, como el reticulo real de una camara de Neubauer. Se ven, pero en segundo
plano: el ojo tiene que leer distancia y velocidad en ellas sin que compitan con
las celulas. El borde del mapa es el canto del vidrio, una banda mas oscura.

**5. El HUD es una etiqueta de laboratorio.** Tarjetas de papel crema con borde
de tinta, numeros en monoespaciada, nombres en minuscula de cuaderno. El registro
(top 10) es una planilla, no un panel de vidrio. Nada flota con transparencias de
interfaz moderna: el texto esta escrito sobre algo.

## Paleta

| Rol | Color |
| --- | --- |
| Gel (mapa) | `#efe3c2` con la vineta del ocular |
| Tubo (fuera del mapa) | `#17130e` |
| Tinta (texto, membranas propias, reticulo) | `#2a2118` |
| Papel de etiquetas | `#f6efdc` |
| Acento del juego (`meta.ts`) | `#2b6cb0`, azul de metileno |

Tintes de celula (indice que manda el server, 0-11): `#2b6cb0` `#c2456b`
`#6b3fa0` `#b8432f` `#2f8a5b` `#b07a1e` `#c0392b` `#a3307e` `#2f7f8f` `#5b5fb5`
`#9a5b2e` `#4f7a2a`.

Comida (0-5): `#d9a441` `#d97a6c` `#8fb3d9` `#a7c97f` `#c79fd6` `#e0c070`.

## Lo que no se hace

- Glow, neon, sombras proyectadas: no hay fuente de luz arriba.
- Contornos negros gruesos de dibujo animado: la membrana es del tinte de la celula.
- Particulas decorativas que no informan nada.
- Texto blanco con sombra sobre el gel: el texto es tinta sobre papel o sobre gel.
