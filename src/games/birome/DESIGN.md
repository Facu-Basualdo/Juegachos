# Birome — Direccion de arte: "Cuaderno Cuadriculado"

Birome se ve como el fondo de la carpeta de la escuela: una **hoja cuadriculada**
crema, con **margenes rojos** arriba y abajo, donde alguien arranco a hacer una raya
con la birome y no la levanto mas. Los obstaculos no son "enemigos": son lo que ya
habia en la hoja — **tachones** rayados con bronca y **manchones** de tinta que se
corrio. La tension la pone la mano, no la interfaz.

## Principio

**La hoja es el mundo y la tinta es el jugador.** Todo lo que existe en pantalla
podria existir en un papel: la cuadricula, los margenes, la regla con los cm, la raya
azul, las manchas. Nada brilla, nada tiene glow ni degradés de app. De un vistazo se
leen tres cosas, en este orden: **donde esta mi punta**, **por donde esta el hueco** y
**cuanto llevo**.

## Paleta

- **Papel** `#f7f1e1` — crema. Cuadricula `#d6e1ee` (azul de cuaderno) cada 24 px.
- **Escritorio** `#d9d2c4` — lo que se ve fuera de la hoja (bandas y fondo del body).
- **Margen** `#d9534f` — dos lineas rojas, arriba y abajo. Afuera, un velo rojo apenas
  (`rgba(217, 83, 79, 0.10)`) que dice "no pasar" sin gritar.
- **Tinta** `#1f2433` — tachones y manchones. Casi negra, con un lavado translucido
  `rgba(31, 36, 51, 0.16)` debajo, como el papel que chupo la tinta.
- **Birome azul** `#2f5bd8` — el jugador propio, SIEMPRE. Es el mismo azul de Basta: la
  familia de juegos de papel comparte la birome.
- **Tintas rivales** — naranja, verde, violeta, rosa, petroleo, marron, grafito y rojo
  oscuro, por asiento de la sala. Nunca azul: el azul es "yo" en todas las pantallas.
- **Lapiz** `#2b2b33` — textos chicos, la regla y las anotaciones.

## Vocabulario visual

- **Tachon**: rectangulo rayado a mano en **dos pasadas cruzadas** (una apretada a 45,
  otra mas suelta al reves) con un contorno **temblado**. El temblor es sembrado: el
  mismo tachon se ve igual cuadro a cuadro, no vibra.
- **Manchon**: contorno irregular suave (curvas por los puntos medios), una aureola
  de papel embebido y un **brillo humedo** chico arriba a la izquierda. La zona que
  mata es un poco mas chica que la mancha dibujada: perdonar el borde se siente justo.
- **La raya**: trazo continuo a 45 grados, con juntas redondas. La propia va mas
  gruesa y opaca; las rivales, finas y translucidas, por debajo.
- **La birome propia**: cuerpo de plastico transparente, el tubito de tinta azul
  adentro, cono de metal con la bolita y el tapon azul. Inclinada como en la mano, y
  se ladea apenas al subir o bajar.
- **Rivales**: solo la bolita de su color, con el nombre y los cm escritos al lado a
  mano. Si quedan fuera de cuadro, un cartelito en el borde con una flecha de texto.
- **Choque**: mancha de la tinta de ese jugador que crece en un instante, con gotas
  alrededor. Queda en la hoja hasta la proxima partida.
- **Tipografia**: manuscrita del sistema (`Segoe Print` / `Bradley Hand` / `Comic Sans
  MS` / cursive) para todo lo "escrito en la hoja": el puntaje, el titulo, el
  countdown, los nombres. El chrome (subtitulos, ayudas) en sans-serif del sistema,
  mas chico. Sin fuentes externas.
- **Tarjetas** (inicio / fin): hoja crema con borde de tinta, sombra dura desplazada
  y apenas torcida (`-1deg`), como un papelito pegado encima.

## Movimiento

Casi nada se mueve salvo la hoja deslizandose y la punta. El **countdown 3/2/1/YA**
entra con el pop del repo, escrito en birome y torcido. Al chocar: un sacudon corto
(0.35 s) y la mancha. Ni parallax, ni particulas ambientales, ni rebotes: la
velocidad que sube es la unica animacion que importa.

## Que evitar

- **Neon, glow o fondos oscuros**: rompen la metafora del papel.
- **Emojis** (regla del repo): todo icono y toda flecha van dibujados o escritos.
- **Obstaculos "de videojuego"** (pinches, sierras, calaveras): en una hoja no hay
  eso. Si algo mata, es tinta.
- **Colorear a un rival de azul**, aunque la paleta se quede corta: el azul es tuyo.
- **Texto que compita con la punta**: los nombres de los rivales son anotaciones
  chicas y translucidas, nunca carteles.
