# Garganta de Feria

Direccion de arte de Imitame. Sale de la referencia que se pidio clonar (Mimic Party:
cartoon, colorido, comico, "la mesa se rie de la toma ajena"), traducida a canvas 2D y
DOM plano, sin 3D ni assets.

## La idea

Un show de talentos de barrio a la noche. El telon es violeta oscuro, las luces son de
caramelo y todo lo que importa esta **recortado como un sticker**: contorno de tinta
grueso y una sombra dura desplazada, sin blur. Nada es elegante; todo es un poco
torpe a proposito, porque el chiste del juego es escucharte a vos mismo haciendo de
vaca delante de tus amigos.

## Principios

1. **La Boca es el presentador.** El unico personaje es una cara redonda que abre la boca
   con lo que suena: celeste cuando escuchas la referencia, rosa (con luz de REC) cuando
   grabas, amarilla cuando suena la toma de alguien. Su color dice en que fase estas
   antes de leer nada.
2. **Sticker, no sombra.** Todo elemento con peso (boca, chips, tarjetas, ruleta,
   botones) lleva contorno `--mt-line` de 3-10px y una sombra solida desplazada abajo a
   la derecha. Nunca `box-shadow` difuso.
3. **Colores de caramelo, uno por significado.** Celeste = la referencia (lo que hay que
   copiar). Rosa = vos y tu voz. Amarillo = el foco del momento (la toma que suena, el
   numero del countdown). Lima = lo que ya esta bien (reloj con tiempo, toma entregada).
   El rosa tambien es la alarma (reloj por agotarse).
4. **La melodia se ve.** El trazo celeste de la referencia se dibuja mientras suena, y en
   la comparacion la toma aparece encima en rosa. Es la forma que el jurado compara, asi
   que mostrarla explica el puntaje sin texto.
5. **Rebote, no desliz.** Las entradas son con sobrepique (`cubic-bezier(0.2, 1.6, 0.4, 1)`)
   y un poco de giro: la tarjeta de puntaje cae como un cartel de jurado.

## Paleta

| Token | Hex | Uso |
| --- | --- | --- |
| `--mt-night` | `#1b1033` | fondo / telon |
| `--mt-stage` | `#2b1a52` | superficies oscuras (chips, trazo, reloj) |
| `--mt-line` | `#120a24` | contornos y sombras duras |
| `--mt-cream` | `#fff4e0` | texto, tarjetas |
| `--mt-pink` | `#ff4f9a` | vos, grabar, alarma |
| `--mt-yellow` | `#ffd23f` | foco, countdown |
| `--mt-cyan` | `#35d6e8` | la referencia |
| `--mt-lime` | `#8be04e` | ok / entregado |

Las porciones de la ruleta tienen su propio color por efecto (`EFFECTS` en
`constants.ts`), elegidos dentro de la misma familia de caramelo; el pedo es el unico
marron, a proposito.

## Tipografia

Pila redondeada del sistema (`"Arial Rounded MT Bold", "Nunito", "Trebuchet MS"`), peso
800-900, titulos con sombra de tinta. Sin fuentes externas.
