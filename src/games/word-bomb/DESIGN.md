# Bomba Palabra — Direccion de arte: "Fiesta de la bomba"

Bomba Palabra se ve como su **portada**: una **mecha encendida en el centro de una
mesa caliente**, con la bomba latiendo en un charco de luz ambar, chispas volando
y los jugadores en ronda alrededor apurados. Es cartoon, calido y urgente, con
humor. NO es un tablero sobrio: es una fiesta con tension. La referencia es el
cover (`public/covers/word-bomb.jpg`), y cada decision visual responde a el.

## Principio

**El calor sube con la tension.** El centro de la escena es una bomba con la mecha
prendida: la luz ambar, la chispa y el anillo del tiempo concentran la mirada ahi.
En cada turno hay un unico protagonista (el jugador de turno, encendido en verde),
pero a diferencia de antes la mesa **no** esta apagada: respira fuego. De un
vistazo tenes que leer tres cosas: **cuanto le queda a la bomba**, **de quien es el
turno** y **que esta escribiendo**.

## Layout

- **Circulo de jugadores** alrededor del centro, repartidos por angulo (uno
  arriba, el resto girando), de 2 a **8** jugadores sin solaparse.
- **La bomba en el centro**, apoyada en un **socket de luz ambar** (el charco
  encendido de la portada). Es una esfera negra cartoon con brillo, **collar
  metalico** arriba y una **mecha trenzada encendida con chispa** que titila. El
  **fragmento** va escrito en la panza en **blanco tiza**, apenas torcido.
- **Anillo del tiempo** rodeando la bomba: un **arco** (con un hueco arriba por
  donde sale la mecha, para no cruzarla) que se consume del amarillo chispa al rojo
  peligro, con los **segundos** debajo del fragmento. Es informacion central del
  juego (ver el `CLAUDE.md`), visible para todos en todos los turnos.
- **Una flecha/chispa** ambar sale de la bomba y **gira** apuntando al jugador de
  turno.
- **Cada jugador** es una columna: **nombre arriba**, **personaje** (bocha violeta
  generica con **cara que reacciona al estado** — nunca fotos ni imagenes propias),
  y **debajo lo que escribe**. Encima, su estado: corazones (vidas) o calavera si
  quedo afuera. Las caras: **neutral** (calma), **concentrado** en su turno,
  **panico** con gota de sudor y globo "RAPIDO!" cuando aprieta el tiempo, **feliz**
  al acertar, y **muerto** (ojos en X) al quedar eliminado.
- **Sin caja de texto.** El de turno escribe y el texto aparece bajo su avatar (un
  input invisible summonea el teclado en movil).
- **Ambiente:** fondo noche calido, **resplandor ambar** detras de la bomba,
  **brasas** subiendo lento y vignette oscura en los bordes. Nada de esto tapa la
  lectura: es atmosfera, va por detras y en baja intensidad.

## Paleta (de la portada)

- **Noche** `#161016` -> `#0b0910` — fondo profundo, calido, con vignette.
- **Resplandor** `#ff7a18` / **brasa** `#ffb24d` — el charco de luz y las chispas.
- **Chispa** `#ffd23f` — la punta de la mecha encendida y el amarillo del anillo lleno.
- **Bomba** `#141013` con highlight frio `#3a3f4a`; **collar** metal `#8a8f99` ->
  `#4a4e57`.
- **Nombre / tiza** `#f7efe6` — blanco calido, peso alto.
- **Personaje** bocha violeta `#7c4dcc` (cuerpo) con rasgos en `#241033`; gris
  `#4a4a52` al quedar eliminado. Corazones `#ff5a5f`, gota de sudor `#8fd3ff`.
- **Turno** `#46d16a` — el nombre del jugador de turno se pone verde.
- **Vidas** corazones rojos `#ff5a5f`; **eliminado** calavera + nombre tachado.
  **Desconectado** en cursiva/gris (sigue en la ronda, la mecha lo castiga como AFK).
- **Rojo peligro** `#e23b3b` — el anillo por vaciarse, la palabra rechazada y el
  golpe de la explosion.
- **Ficha dorada** `#e7c66a` con letra `#5a4a2a` — para las fichas decorativas
  (capa posterior; ver "Roadmap").

## Vocabulario visual

- **Bomba cartoon**: esfera con brillo alto a la izquierda-arriba, collar metalico y
  **mecha trenzada** (textura de cuerda) que termina en una **chispa que titila**.
  Es el corazon caliente de la escena, no un disco liso.
- **Anillo del tiempo** como gauge exterior: un **arco de 300deg** con un hueco
  arriba (para que no cruce la mecha), chispa -> rojo, pulso al final, con los
  **segundos** en tiza bajo el fragmento.
- **Fragmento en tiza** blanco, apenas rotado, como pintado a mano en la bomba.
- **Corazones y calavera** dibujados (SVG), no emojis (el repo prohibe emojis), como
  marcas claras arriba del avatar.
- **Brasas** que suben lento y **resplandor ambar** detras de la bomba: atmosfera de
  la portada, siempre por detras y sutil.
- **Texto en vivo** debajo del avatar: lo que se teclea se ve al instante (propio y
  ajeno, via el relay del server). La ultima palabra aceptada queda ahi hasta el
  proximo turno de ese jugador.
- **Reacciones = la cara del personaje.** No hay globo de emoji ni sticker flotando:
  reaccionar es **prestarle la cara a tu bocha**. Cinco caras dibujadas (risa,
  sorpresa, enojo, burla, llanto) en el mismo trazo `#241033` que la cara base, con la
  lengua rosa y la lagrima celeste como unicos colores nuevos. El enojo le calienta el
  cuerpo al violeta (rojo `#a8384f`). Es la respuesta de este juego a los emojis: la
  expresividad ya vive en el personaje, no hace falta importar un glifo ajeno.

## Movimiento

Calido y con foco: la **chispa de la mecha titila** siempre; las **brasas** suben
lento de fondo; al pasar el turno la flecha **gira** hacia el nuevo jugador y su
nombre se enciende. La palabra aceptada da un pequeno "sello"; el rechazo sacude el
avatar. El anillo se vacia parejo y **pulsa en rojo** cuando esta por explotar. Al
perder una vida la bomba **explota**: un golpe seco y calido (fogonazo + onda
expansiva + esquirlas + sacudida de la bomba, ~700ms) y sigue el turno. La energia
esta en el calor del centro y en el foco que salta de jugador en jugador; nada de
rebotes elasticos. Al **reaccionar**, el personaje cambia de cara y pega un **salto
corto** (~380ms, con overshoot): el unico rebote elastico permitido, porque es la voz
del jugador y tiene que verse desde el otro lado de la ronda. Y **se escucha**: cada
cara trae su propia voz sintetizada (la risa en tres silabas, el gruñido grave del
enojo), siempre por debajo de la mecha y la explosion — subraya el gesto, no compite
con la partida.

## Que evitar

- Volver a la **mesa apagada y plana**: el centro tiene que respirar fuego.
- Fotos / avatares personalizados: siempre la bocha violeta generica (la identidad
  la da el nombre). Lo que cambia es la **cara** segun el estado, no la persona.
- Una caja de input visible: se escribe directo, el texto vive bajo el avatar.
- **Emojis** en cualquier lado (regla del repo): corazones, calavera y las caras de
  reaccion van dibujados. Una reaccion se manda como **id** (`risa`), nunca como glifo.
- Sobrecargar: las brasas, el resplandor y las fichas son **atmosfera** — nunca
  compiten con la bomba, el anillo ni el nombre del turno.

## Roadmap (capas del rediseno hacia el cover)

Se hace por capas (decision del programador, incremental):

1. **Ambiente + bomba** (esta capa): fondo caliente, resplandor, brasas, vignette,
   socket ambar, bomba cartoon con collar + mecha + chispa, fragmento en tiza,
   anillo tintado. **Sin tocar personajes.**
2. **Personajes expresivos** (HECHA): bocha violeta con **cara segun estado**
   (neutral / concentrado / panico con sudor / feliz / muerto), corazones y calavera
   dibujados (sin emojis) y globo "RAPIDO!" en el de turno cuando aprieta el tiempo.
3. **Fichas y pantallitas**: fichas doradas tipo Scrabble desperdigadas de fondo y
   las vidas como pantallita estilo cover.
