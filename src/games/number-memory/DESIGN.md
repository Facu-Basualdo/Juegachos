# Número Fugaz — Design: "Flash de neón" (arcade 3D)

## Filosofía

Un número es un **destello de neón** que aparece con fuerza, se lee un instante y
**se esfuma**. La interfaz adopta el lenguaje arcade con **relieve tipo sticker
3D** (bloques con sombra dura, que "se hunden" al tocarlos) y **tipografía
gruesa con contorno desplazado**, pero con **identidad propia**: no los colores de
Bounce Rush ni el ámbar anterior, sino un **magenta eléctrico de destello** sobre
índigo-berenjena, con aqua de apoyo. La pregunta que guía todo: **¿se siente como
un flash de neón que hay que atrapar antes de que se apague?**

Reglas que salen de ahí:

- **Índigo profundo + destello magenta.** Fondo `#181026` con resplandor magenta
  arriba y aqua abajo. El magenta es el color del flash (el número, el acento);
  el aqua es el acierto y el apoyo.
- **Relieve 3D en todo lo tocable.** Teclas, slots y botones de modo son bloques
  con `box-shadow: 0 Npx 0` (sombra dura inferior) que da volumen; al presionar
  bajan y achican la sombra (feedback táctil arcade).
- **Números con contorno sticker.** El dígito es crema con un contorno magenta
  desplazado (`text-shadow` duro) + glow; se lee como cartel de neón, no como
  texto plano. El acierto lo vuelve aqua, el error rojo.
- **La fugacidad sigue en la salida.** El número no titila: brilla estable y
  **después** se esfuma (blur + deriva hacia arriba).

## Paleta

| Token | Hex | Uso |
|---|---|---|
| `--void` / `--void-2` / `--void-3` | `#181026` / `#241834` / `#2f2043` | Fondo y superficies |
| `--sink` | `#0d0817` | Sombra dura de los bloques (relieve) |
| `--flash` / `--flash-dark` | `#ff2e88` / `#a3155a` | Magenta destello: número, acento, modo Aleatorio |
| `--aqua` / `--aqua-dark` | `#22e0d6` / `#128d86` | Aqua: acierto, modo Escalera |
| `--cream` | `#fff4fb` | Dígitos / texto de alto contraste |
| `--wrong` / `--wrong-dark` | `#ff5252` / `#a32c2c` | Error |
| `--ash` | `#9a86b5` | Texto secundario (lavanda) |

Dos modos, dos acentos: **Aleatorio = magenta**, **Escalera = aqua** (identidad y
variedad de un vistazo).

## Tipografía

- **Números / countdown / valores:** monoespaciada gruesa (`Consolas`…), tabular,
  con contorno desplazado.
- **Etiquetas / nombres de modo / hints:** Archivo (la del sitio), mayúsculas con
  letter-spacing.

## Movimiento

- **Aparición:** scale-in + bloom rápido.
- **Esfumado (clave):** blur + deriva hacia arriba + fade.
- **Acierto:** pop aqua; **error:** shake + rojo.
- **Toque de tecla/botón:** el bloque baja (translateY) y su sombra se achica.
- **Countdown:** número gigante crema con contorno magenta.
- Respetar `prefers-reduced-motion`.

## Qué NO hacer

- No volver al ámbar minimalista anterior ("Fósforo") ni copiar el navy/naranja de
  Bounce Rush: la identidad es el **magenta+aqua sobre índigo**.
- El número no parpadea mientras se muestra (la fugacidad está en la salida).
- El relieve es "sticker 3D" (sombra dura), no bordes de tinta neo-brutalistas.
