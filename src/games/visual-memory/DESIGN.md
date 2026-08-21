# Constelación — Design: "Arcade de bloques" (estilo Bounce Rush)

## Filosofía

Reusa el **lenguaje visual de Bounce Rush** (`jump-ball`): juguetón, arcade,
chunky. La grilla se lee como un tablero de **bloques con relieve** sobre un
cielo azul-noche con resplandor violeta; el patrón a memorizar se enciende en el
**naranja de la pelota**. La pregunta que guía todo: **¿se siente como el mismo
mundo alegre y con volumen de Bounce Rush?**

Reglas que salen de ahí:

- **Fondo navy + resplandor violeta.** Igual que los overlays de Bounce Rush:
  `#141d33` con un `radial-gradient` violeta.
- **Tipografía monoespaciada gruesa** (`Consolas`/`Courier New`) con **sombras
  duras tipo sticker**: los números y títulos llevan contorno de color
  desplazado (violeta en el nivel/countdown, naranja oscuro en los títulos), como
  el score y el título de Bounce Rush.
- **Bloques con relieve 3D.** Cada celda es un bloque redondeado con una sombra
  dura inferior (`box-shadow: 0 4px 0`) que le da volumen; al tocar, "se hunde"
  (baja y achica la sombra).
- **Color = estado.** Encendida = naranja (la pelota); acierto = verde; error =
  rojo; los tres con su sombra dura del mismo tono más oscuro.

## Paleta (de Bounce Rush)

| Token | Hex | Uso |
|---|---|---|
| `--bg` | `#141d33` | Fondo navy |
| `--bg-2` | `#26314f` | Celda apagada |
| `--violet` / `--violet-soft` | `#7a3fd6` / `#7c5cff` | Contornos de texto, resplandor |
| `--orange` / `--orange-dark` | `#ffb648` / `#b3661a` | Celda encendida + títulos |
| `--found` / `--miss` | `#58d68d` / `#ff5a5f` | Acierto / error |

## Movimiento

- **Encendido del patrón:** stagger sutil (celdas que aparecen una tras otra).
- **Acierto:** pop del bloque; **error:** shake + rojo, menos una vida (corazón).
- **Toque de celda:** el bloque se hunde (translateY + sombra chica), feedback
  táctil arcade.
- **Countdown:** número gigante blanco con contorno violeta, mismo pop que
  Bounce Rush.
- Respetar `prefers-reduced-motion`.

## Qué NO hacer

- No volver a la estética "cielo cian minimalista" anterior: la piel es la de
  Bounce Rush (navy + naranja + violeta, con relieve y sombras duras).
- No mezclar el neo-brutalismo de la landing: el relieve acá es el "sticker 3D"
  de Bounce Rush, no bordes de tinta.

## Nota

La **jugabilidad** (grilla que crece, patrón a reconstruir, 3 vidas, puntaje =
nivel) no cambió — sólo la piel. La lógica vive en `game/` y es agnóstica del
estilo.
