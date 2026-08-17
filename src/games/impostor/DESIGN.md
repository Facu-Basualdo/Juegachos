# Impostor — Direccion de arte: "Sala de interrogatorio"

Impostor se ve como un **interrogatorio**: un cuarto a oscuras, un **foco cenital** sobre la
mesa, y todos bajo sospecha hasta demostrar lo contrario. La tension no viene del motion ni del
glow gratis, viene de **la palabra que tenes que proteger**, del **turno que corre** y del
momento en que la mesa **senala** a alguien. Es el reverso de Basta (papel, recreo, luz de dia):
aca es de noche y hay algo que ocultar.

## Principio

**La pantalla es la sala de interrogatorio.** Lo importante esta **iluminado**; el resto se
hunde en el carbon. De un vistazo tenes que leer tres cosas segun la fase: **quien sos** (tu
palabra, o que sos el impostor), **de que se esta hablando** (la categoria y las pistas), y
**a quien esta por caerle la sospecha** (los votos). Cada fase ilumina una sola de esas cosas.

## Layout

- **Escena** centrada (ancho de celular, `min(560px, 100%)`) sobre un fondo **carbon** con un
  **foco** radial arriba al centro (calido, tenue). El chrome vive arriba, el foco abajo.
- **Topbar** en dos filas: arriba la **ronda** y la **fase** (condensadas: la ronda tenue, la fase
  en ambar — dice que esta midiendo el reloj) con el **roster** a la derecha, chips por jugador
  (el de turno resaltado en rojo, un punto cuando ya dio su pista o voto, su puntaje si no); abajo
  el **reloj** a lo ancho, una barra que se vacia de ambar a rojo. El reloj va abajo y la escena
  deja aire arriba porque la franja de la sala ocupa el borde superior.
- **Reveal**: una **ficha de rol** al centro, iluminada. Inocente: la **palabra secreta en ambar**,
  grande, con la categoria arriba. Impostor: **SOS EL IMPOSTOR en rojo**, la categoria como unica
  pista, y el complice si son dos.
- **Clues**: la **categoria** como sello arriba, un recordatorio chico de tu rol, la **lista de
  pistas** dadas (la tuya marcada; la **ultima entra iluminada**, que es la que hay que leer), y
  abajo tu **input** cuando es tu turno (si no, "Turno de X"). Dada la ultima pista la mesa queda
  unos segundos con todas las pistas a la vista antes de abrir la votacion: nadie tiene que
  perderse lo que escribio el que cerro.
- **Voting**: los jugadores como **sospechosos** en fichas apiladas — nombre, su pista, y el contador
  de votos; tocar uno lo acusa (se marca en rojo). Vos mismo aparecas deshabilitado ("vos").
- **Guess**: si te descubrieron, un cuarto en **rojo** con el input para adivinar la palabra; si no,
  el aviso de que el acusado esta intentando adivinar.
- **Result**: el **veredicto** (quien era el impostor, la palabra en ambar, quien gano) y los
  **puntos** de la ronda con el rol de cada uno.

## Paleta

- **Carbon** `#0d0e12` — el cuarto a oscuras; paneles `#16181f` / `#1e212b`, lineas `#2a2d38`.
- **Tinta clara** `#ecebe4` — el texto principal; **apagado** `#8b8d97` para lo secundario.
- **Ambar** `#e4b64c` — **la palabra secreta** y lo que el jugador protege (el foco, el reloj lleno,
  el acento propio). Es lo unico "de valor" iluminado.
- **Rojo sospecha** `#d23b45` (profundo `#8f2129`) — el impostor, el peligro, la acusacion, el
  countdown, el reloj en el ultimo cuarto.
- **Azul frio** `#57b6d6` — el equipo inocente en el resultado (contrapunto al rojo del impostor).

## Vocabulario visual

- **Tipografia condensada en mayusculas** (`Bebas Neue` / `Oswald` / `Arial Narrow` / condensadas
  del sistema, sin fuentes externas) para titulos, la palabra, la categoria, el countdown y los
  botones — voz de expediente/carteleria. El cuerpo (pistas, ayudas, nombres) va en sans-serif del
  sistema, mas humano.
- **El foco cenital** como fondo: un radial calido arriba que cae al negro. Nada de flat uniforme.
- **Iluminar, no recuadrar**: la ficha activa (rol, sospechoso votado, veredicto) se separa con luz
  y un borde de color; lo inactivo queda en el carbon.
- **La palabra en ambar**: el dato que se protege siempre brilla en ambar; el impostor y el riesgo
  siempre en rojo. Esa dupla ambar/rojo es la lectura de un vistazo.
- **Votar es senalar**: tocar un sospechoso lo marca en rojo con su contador. Sin pulgares ni
  emojis (regla del repo); la acusacion es el resaltado rojo y el numero.
- **Reloj como barra**, no un numero grande: discreto arriba, se vacia parejo y se pone rojo en el
  ultimo cuarto.

## Movimiento

Sobrio y tenso: casi todo esta quieto bajo el foco. El **reloj** se vacia parejo. El **countdown
3/2/1/YA** entra con un "pop" (la unica animacion elastica, como el resto del repo) en rojo con
halo. El reveal del rol y el veredicto **aparecen** iluminados, sin rebotes. La urgencia la pone
el reloj y el turno, no la interfaz.

## Que evitar

- Convertirlo en **neon party** (cyan/magenta, glow por todos lados): rompe el tono de interrogatorio.
  Esa es otra linea del roster, no la de Impostor.
- **Emojis** (regla del repo): todo icono/acento va en color y tipografia, dibujado si hace falta.
- **Revelar de mas**: la palabra y el impostor solo se iluminan cuando corresponde (tu ficha privada,
  o el result). Nunca mostrar el rol de otro antes de tiempo — es la esencia del juego (y va en linea
  con que el rol no viaja en el broadcast, ver CLAUDE.md).
- Fuentes externas o assets: el clima sale de fondo, color y fuentes del sistema.
- Tapar la lectura: reloj y roster son chrome, nunca compiten con la palabra, la categoria ni la
  acusacion.
