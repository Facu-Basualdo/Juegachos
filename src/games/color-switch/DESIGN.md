# Prisma — Design: "Espectro neón"

## Filosofía

El juego **es color**: una bola que muta entre cuatro neones y cruza anillos
divididos en esos mismos cuatro. La identidad, entonces, es el **espectro**: los
cuatro colores puros brillando sobre un **casi-negro** que los hace estallar.
Comparte el ADN arcade de los otros dos juegos (chunky, con relieve, tipografía
gruesa) pero su firma es el **arcoíris neón**. La pregunta que guía: **¿se siente
como luz de color pura sobre el vacío?**

Reglas que salen de ahí:

- **Casi-negro de fondo, color puro adelante.** `#0c0a12` para que los cuatro
  neones (rosa, cyan, lima, ámbar) sean lo único que ilumina, cada uno con glow.
- **La bola es un objeto con volumen.** Círculo del color actual con brillo
  especular arriba y sombra abajo (sticker 3D), y un halo del mismo color.
- **Los anillos son luz.** Cuatro arcos gruesos, uno por color, con resplandor;
  giran, y hay que cruzarlos cuando tu color coincide en el punto de contacto.
- **Firma tipográfica: wordmark espectral.** El título "PRISMA" va en un
  degradé de los cuatro colores (recorte de texto), único en el sitio. El resto
  del chrome es crema con contorno oscuro (misma familia arcade).

## Paleta

| Token | Hex | Uso |
|---|---|---|
| `--bg` | `#0c0a12` | Fondo casi-negro |
| color 1 | `#ff3d81` | Rosa neón (y acento del juego) |
| color 2 | `#2ee6ff` | Cyan |
| color 3 | `#b8ff3d` | Lima |
| color 4 | `#ffb03d` | Ámbar |
| `--cream` | `#fff4fb` | Texto de alto contraste |
| `--ash` | `#8a83a6` | Texto secundario |

Los cuatro colores del juego SON la paleta: no se reparten en el chrome, se
guardan para la bola, los anillos y el wordmark.

## Tipografía

- **Score / countdown / valores:** monoespaciada gruesa, tabular, con contorno
  desplazado (sticker), como los otros dos juegos.
- **Título:** wordmark en degradé espectral de los cuatro colores.
- **Etiquetas / hints:** Archivo, mayúsculas con letter-spacing.

## Movimiento

- **Bola:** física de gravedad + impulso al tocar; halo que la sigue.
- **Anillos:** rotación continua (velocidad variable por anillo).
- **Cambio de color:** al tomar el switch, un flash del nuevo color en la bola.
- **Cruce:** al pasar un anillo, un pequeño destello + sonido.
- **Muerte:** flash del color equivocado + sacudida.
- **Countdown:** número gigante crema con contorno.
- Respetar `prefers-reduced-motion` (glow/anim atenuados).

## Qué NO hacer

- No teñir el fondo ni el chrome con los cuatro colores: el espectro se reserva
  para la bola, los anillos y el título. El fondo es casi-negro.
- No copiar exactamente el índigo/magenta de Número Fugaz ni el navy/naranja de
  Constelación: acá la identidad es el arcoíris sobre negro.
