# Impostor — Direccion de arte: "Expediente noir"

Evolucion de la "sala de interrogatorio" original (mismo cuarto, misma dupla ambar/rojo), llevada
de una lista de cajas oscuras a una **puesta en escena**: un cuarto a oscuras con una lampara que
cuelga sobre un escritorio, un **expediente** abierto en la mesa y **fichas policiales** de cada
sospechoso. Todo se hace con CSS y SVG en linea: ningun asset, ninguna fuente externa, ningun emoji.

## Principio

**Todos son sospechosos y cada fase es una pieza del expediente.** La pantalla no es una app con
paneles: es una mesa de detective. De un vistazo se leen tres cosas segun la fase y cada fase
ilumina una sola: **quien sos** (el sobre confidencial con tu palabra, o el sello rojo de
impostor), **que se declaro** (la hoja de declaraciones a maquina) y **a quien le cae la
sospecha** (la rueda de reconocimiento).

## La sala

- **Fondo**: carbon casi negro con una **lampara cenital** que tira un cono de luz calida hacia la
  mesa, polvo que flota despacio adentro del cono, **viñeta** fuerte en los bordes y un **grano de
  pelicula** sutil encima de todo (ruido SVG en linea). La lampara titila apenas de vez en cuando:
  el cuarto esta vivo, no animado.
- **La mesa**: el contenido vive sobre papeles con textura (manila y papel de maquina), levemente
  girados, con sombra dura. Nada flota en el vacio.

## Piezas

- **Ficha policial** (`avatar.ts`): cada jugador tiene un retrato generado desde su nombre (la
  misma cara en todas las pantallas): cabeza, pelo o sombrero, ojos, cejas, nariz, boca y algun
  detalle (bigote, anteojos, cicatriz, aro). Va en blanco y negro calido, con la **regla de
  altura** detras y la **pizarra de detenido** abajo (numero + nombre). Es el personaje del jugador
  en todo el juego.
- **Sobre CONFIDENCIAL** (reveal): un sobre manila con el sello rojo que se abre y deja ver la
  tarjeta. Inocente: la categoria y **la palabra secreta en ambar**, escrita a maquina. Impostor: un
  **sello rojo SOS EL IMPOSTOR** que golpea la tarjeta, con la categoria como unica pista.
- **Hoja de declaraciones** (clues): papel de maquina con renglones; cada pista es una linea a
  maquina con la mini ficha del que la dio. La ultima entra tipeandose. Tu turno es un renglon con
  el cursor titilando y el boton **DECLARAR**.
- **Rueda de reconocimiento** (voting): las fichas de todos en fila frente a la regla de altura.
  Tocar una la **marca con un circulo rojo de fibron** y los votos aparecen como **chinches rojas**.
  Vos mismo quedas atenuado con la marca "vos".
- **Ultima chance** (guess): la luz se pone roja, el acusado en grande bajo el foco.
- **Caso cerrado** (result): los **sellos golpean**: CULPABLE sobre el impostor, INOCENTE sobre un
  acusado que no lo era, y CASO CERRADO sobre el expediente. La palabra se revela en ambar y los
  puntos van como un **libro de registro** a maquina.

## Paleta

- **Carbon** `#0a0a0c` — el cuarto.
- **Manila** `#d9c294` / `#c8ad78` — los sobres y la carpeta; **papel** `#ece4d2` para las hojas.
- **Tinta** `#1d1a15` sobre papel; **tinta clara** `#ecebe4` sobre el carbon; **apagado** `#8b8d97`.
- **Ambar** `#e4b64c` — la luz de la lampara y **la palabra secreta**. Lo unico de valor iluminado.
- **Rojo sello** `#c3262f` (profundo `#7d1419`) — el impostor, las acusaciones, los sellos, el
  reloj en el ultimo cuarto.
- **Azul frio** `#57b6d6` — el equipo inocente en el resultado.

## Tipografia (sin fuentes externas)

- **Maquina de escribir** (`"Courier New", Courier, monospace`): las pistas, la palabra, el registro.
- **Carteleria condensada** (`Impact`, `"Arial Narrow"`, condensadas del sistema): titulos, sellos,
  el countdown, los botones.
- **Sans del sistema** para las ayudas chicas.

## Movimiento

Sobrio, con **tres gestos fuertes** y nada mas: el **sobre que se abre** (reveal), la **linea que
se tipea** (pista nueva) y el **sello que golpea** (acusacion y veredicto: cae grande, rebota una
vez y queda torcido). El resto esta quieto bajo la lampara. El countdown 3/2/1/YA entra como un
sello rojo.

## Que evitar

- **Neon party** (cyan/magenta, glow por todos lados): es otra linea del roster.
- **Emojis** (regla del repo): iconos, chinches y sellos se dibujan con CSS/SVG.
- **Revelar de mas**: la palabra y el impostor solo se muestran en tu sobre o en el resultado.
- **Tapar la lectura**: la lampara, el polvo y el grano son ambiente; nunca compiten con la
  palabra, las declaraciones ni la acusacion.
