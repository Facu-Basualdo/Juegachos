# Tinta — Design: "Escenario a oscuras, un color que grita"

## Filosofía

El juego es un **conflicto entre leer y ver**: la palabra dice un color, la tinta
es otro. Para que ese conflicto sea el protagonista absoluto, el escenario es
**monocromo y oscuro**, y lo único con color saturado es **la palabra gigante**,
pintada en su tinta. Todo lo demás (score, reloj, chrome) es crema sobre
carbón, para que el color no compita con nada. La pregunta que guía: **¿el color
de la tinta te pega en la cara y la palabra te tienta a equivocarte?**

Reglas que salen de ahí:

- **Chrome monocromo, palabra a todo color.** Fondo carbón cálido, textos crema.
  El color se reserva **solo** para la palabra-estímulo y los swatches de
  respuesta. Así la tinta resalta y la trampa funciona.
- **La palabra es enorme.** Ocupa el centro, con contorno oscuro tipo sticker
  para que el color flote sobre el carbón.
- **Respuestas = swatches de color** (bloques 3D con relieve), sin texto: se
  responde por color puro (tocás el color de la tinta), no leyendo otra palabra.
- **El reloj es tensión.** Una barra que drena, que se pone de calma a alarma
  (verde → ámbar → rojo) a medida que se vacía.

## Paleta

Chrome (neutro):

| Token | Hex | Uso |
|---|---|---|
| `--bg` | `#141117` | Fondo carbón cálido |
| `--bg-2` | `#211c28` | Superficies (chips) |
| `--cream` | `#f4f0ea` | Texto de alto contraste |
| `--ash` | `#8a8494` | Texto secundario |
| `--sink` | `#0c0a10` | Sombra dura de los bloques |

Colores del juego (nombres + tinta), la única fuente de color saturado:

`ROJO #ff3b4e` · `VERDE #3ee06a` · `AZUL #3a9dff` · `AMARILLO #ffd23d` ·
`VIOLETA #b475ff` · `NARANJA #ff913d`

## Tipografía

- **Palabra-estímulo / score / countdown:** monoespaciada gruesa, mayúsculas, con
  contorno desplazado (sticker), como la familia arcade.
- **Etiquetas / hints:** Archivo, mayúsculas con letter-spacing.

## Movimiento

- **Nueva palabra:** pop rápido al aparecer.
- **Acierto:** flash del color acertado + la palabra "salta" a la siguiente.
- **Error:** sacudida + flash rojo, y la barra pega un tirón hacia abajo.
- **Barra de tiempo:** drena suave; cambia de color según cuánto queda.
- **Countdown:** número gigante crema con contorno.
- Respetar `prefers-reduced-motion`.

## Qué NO hacer

- No teñir el fondo ni el chrome con los colores del juego: el color es **solo**
  la palabra y los swatches. Fondo y textos, monocromos.
- Los swatches no llevan texto (si dijeran el nombre serían otra capa de Stroop
  innecesaria y confusa): son color puro.
- Sin bordes de tinta neo-brutalistas de la landing; acá el relieve es "sticker".
