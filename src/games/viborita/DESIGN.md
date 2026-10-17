# Viborita — Direccion de arte: "La Landing"

Filosofia visual del juego. Toda decision del `Renderer.ts` y del `style.css`
responde a este documento; si algo se ve bien pero contradice lo de aca, se saca.

(Pedido del programador: "que la estetica sea como la de la landing". La fuente de
verdad es `src/style.css` del sitio y el `RoomOverlay`, que ya la siguen.)

## El manifiesto

Viborita no tiene un mundo propio: **es una tarjeta mas del sitio** que cobro vida.
La arena es una de las tarjetas crema de la landing, redonda, apoyada sobre el mismo
fondo caqui y con la misma sombra dura corrida hacia abajo. Las viboritas son
stickers: color plano, contorno de tinta grueso, ojos de dibujo. Si alguien pasa de la
grilla de juegos a la partida no tiene que sentir que cambio de sitio. La pregunta que
decide cada linea de dibujo: *esto, puesto al lado de una tarjeta de la landing,
parece de la misma familia?*

## Principios

**1. Tinta y crema.** Todo lo que importa lleva contorno de tinta `#111` grueso (2.5 px
en pantalla como piso, como el borde de las tarjetas), sobre crema `#efeee6`. El
fondo fuera de la arena es el caqui `#d6d3bd` del sitio. No hay gradientes, brillos
ni transparencias decorativas.

**2. La profundidad es una sombra dura.** Ni luz ni volumen: la unica profundidad es
la sombra de tinta desplazada hacia abajo que tienen las tarjetas y los botones de la
landing (`box-shadow: 0 14px 0 -6px`). La arena la tiene, las viboritas tambien (mas
suave, para no ensuciar el piso), el registro y la tarjeta central tambien.

**3. Color plano y saturado, de a uno por viborita.** Doce colores vivos del mismo
registro que los acentos de los juegos del sitio. Cada viborita tiene uno solo; las
rayas del lomo son ese mismo color aclarado, no otro. La comida usa la misma paleta, y
lo que deja una viborita al morir es de su color: se lee de quien era.

**4. Archivo, y pesado.** Titulos en Archivo 900 con tracking negativo, como el titulo
del hero; nombres de las viboritas en Archivo 800 con un filete crema para que se lean
sobre cualquier cosa. Nada en otra tipografia.

**5. Pastillas para todo lo que se aprieta o se lee rapido.** El largo, el aviso de
arriba y el campo del nombre son pastillas negras con texto crema (como el campo del
nombre de la barra del sitio). Las acciones son pastillas cian `#00f0ff` con borde de
tinta y sombra dura (como "Ver resultados finales" del `RoomOverlay`), y al apretarlas
bajan.

## El turbo

Se marca con un **halo del mismo color, aclarado**, por fuera del contorno de tinta.
Primero fue el cian del sitio y no servia: sobre una viborita cian el halo se leia
como cuerpo. En el HUD, la pastilla del largo se rodea de cian mientras dura.

## Paleta

| Rol | Color |
| --- | --- |
| Fondo fuera de la arena | `#d6d3bd` |
| Arena / tarjetas | `#efeee6` |
| Tinta (contornos, texto, pastillas) | `#111111` |
| Texto apagado | `#6f6d5e` |
| Acento (botones, `meta.ts`) | `#00f0ff` |

Viboritas y comida (indice que manda el server, 0-11): `#00e5ff` `#ff4fa3` `#ffd23f`
`#3ce88f` `#ff8a3d` `#9b6bff` `#3d7bff` `#ff4d4d` `#c6f432` `#1fd1b5` `#c4a3ff`
`#ff6f61`.

## Lo que no se hace

- Glow, neon, gradientes radiales, sombras difusas: la landing no tiene ninguna.
- Bordes finitos o de color: el contorno es tinta y es grueso.
- Fondos oscuros: el juego vive en el crema y caqui del sitio.
- Emojis o iconos de otra familia: los iconos son los de `howtoView`.
