# Basta — Direccion de arte: "Hoja de cuaderno"

Basta se ve como donde se jugo siempre: una **hoja de cuaderno rayada**, con su
**margen rojo** a la izquierda, escrita a mano con **lapiz y birome azul**. No es una
interfaz de app: es la mesa del recreo. La tension no viene de luces ni motion, viene
del **reloj corriendo mientras completas a las apuradas** y del momento en que alguien
grita BASTA y todos frenan la mano.

## Principio

**La pantalla es papel.** Cada elemento es algo que existiria en una hoja: la letra
sorteada como un **sello** torcido arriba, las categorias como **renglones**, las
respuestas escritas en **birome**, los errores **tachados**. De un vistazo tenes que
leer tres cosas: **que letra toca**, **cuanto tiempo queda** y **cuanto te falta
completar** (o, en la votacion, **que respuestas estan en duda**).

## Layout

- **La hoja** ocupa el centro (ancho de cuaderno, `min(680px, 100%)`), con el resto de
  la pantalla como escritorio (`#d9d2c4`). Renglones azules horizontales y una **linea
  de margen roja** vertical; todo el contenido respeta ese margen.
- **Topbar**: la **letra** en un circulo de birome roja, rotada `-6deg`, como estampada
  a mano; al lado el **reloj** (una barra que se vacia de azul a rojo); debajo el
  **roster** con el progreso de cada jugador (cuantas categorias lleva, o su puntaje).
- **Vista de llenado**: las 7 categorias como **renglones** — etiqueta a la izquierda,
  campo escribible a la derecha, subrayado como el renglon del cuaderno. El texto propio
  se escribe en **birome azul**. Abajo, centrado, el **boton BASTA** (rojo, tipografia
  de marcador), apagado hasta que estan las 7 llenas.
- **Vista de votacion**: las respuestas de todos, agrupadas por categoria. Cada una con
  el nombre chico y la palabra; en las **ajenas** un boton **tachar** (una cruz dibujada).
  Tachar una la marca en rojo con una **linea encima**; si junta mayoria, se ve condenada.
- **Vista de reveal**: las mismas respuestas con su **puntaje** al costado (100 verde
  unica, 50 ambar repetida, 0 gris vacia/tachada) y el subtotal de la letra.

## Paleta

- **Papel** `#fbfaf3` — crema, con renglones `#cfe0f0` (azul cuaderno) y **margen**
  `#e7a3a3` (rojo tenue).
- **Birome / tinta** `#2f5bd8` — el azul de lo que escribe el jugador y el acento del juego.
- **Lapiz** `#2b2b33` — etiquetas y texto neutro, gris grafito.
- **Rojo** `#d23b3b` — la letra sellada, el BASTA, los tachones y lo condenado.
- **Puntaje**: unica `#2e9e5b` (verde), repetida `#c98a1e` (ambar), nula gris `#9a958a`.
- **Escritorio** `#d9d2c4` — el fondo fuera de la hoja.

## Vocabulario visual

- **Tipografia manuscrita** (`Bradley Hand` / `Comic Sans MS` / `Segoe Print` / cursive
  del sistema, sin fuentes externas): todo lo "escrito a mano" — la letra, las categorias,
  las respuestas, el countdown — usa esa pila. El chrome (nombres, contadores) va en
  sans-serif del sistema, mas chico, como anotaciones al margen.
- **La letra como sello**: circulo de birome roja, apenas rotado, no un badge plano.
- **Renglones reales**: los campos se subrayan como el renglon; el papel tiene sus lineas
  de fondo. Escribir "sobre el renglon" es la metafora central.
- **Tachar, no un pulgar abajo**: rechazar una respuesta la **tacha** (linea roja encima),
  que es exactamente lo que harias en papel. La cruz del boton es un trazo dibujado (SVG),
  **nunca un emoji** (regla del repo).
- **Reloj como barra**, no un numero grande: una tira que se vacia arriba, discreta, para
  no robarle protagonismo a la hoja.

## Movimiento

Sobrio, de papel: casi todo esta quieto. El **reloj** se vacia parejo y se pone **rojo**
en el ultimo cuarto. El **countdown 3/2/1/YA** entra con un "pop" (la unica animacion
elastica, como el resto del repo). Al gritar BASTA aparece el **banner rojo** de cierre.
Nada de glow, parallax ni rebotes: la urgencia la pone el reloj y la mano del jugador,
no la interfaz.

## Que evitar

- Convertirlo en una **app oscura con neon**: rompe la metafora del papel (esa es la
  linea de Bomba/Cadena, no la de Basta).
- **Emojis** en cualquier lado (regla del repo): la cruz de tachar y todo icono van
  dibujados.
- Una **tabla densa** tipo planilla en la votacion: se agrupa por categoria, en bloques
  legibles en el celular, no una grilla jugador x categoria que no entra en pantalla.
- Fuentes externas o assets: la sensacion manuscrita sale de fuentes del sistema y CSS.
- Tapar la lectura: el reloj y el roster son **anotaciones**, nunca compiten con la letra,
  las categorias ni el BASTA.
