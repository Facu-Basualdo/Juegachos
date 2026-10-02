# Paño y Humo

Una filosofia de diseño para un salon a oscuras con un solo rectangulo encendido. Es la direccion de arte de **Poolnight**: cada decision visual (escena 3D, luces, materiales, camara, HUD) tiene que responder a ella.

Un bar de madrugada se reconoce por lo que no se ve. Las paredes, la barra, las sillas y el resto de las mesas se disuelven en una penumbra espesa, y toda la luz del mundo cae sobre un unico paño. La mesa no esta en el salon: es el escenario, y el salon es el publico que se calla. Por eso el fondo se mantiene dos pasos mas oscuro de lo que la tentacion pide: la oscuridad no es vacio, es lo que le da peso al rectangulo verde. Humo fino en el aire, apenas visible, solo donde la luz lo atraviesa; nunca niebla pareja.

La luz es una lampara, no un ambiente. Hay una fuente grande, calida (ambar, tres mil grados), colgada sobre el centro de la mesa, con un cono que se abre, una penumbra que se come los bordes y un charco de luz sobre el paño cuyo borde cae de forma medida. Todo lo demas son brasas: el resplandor de una rockola lejana, un cartel rojo apagado fuera de foco, el reflejo tenue de la lampara en la madera. Donde la luz pega, el material responde; donde no llega, se hunde. Esta regla —la luz se comporta— es lo que separa una escena de un set de pegatinas, y se aplica sin excepciones a cada bola, cada banda y cada marca de tiza.

Los materiales son los protagonistas y son honestos. El paño es lana: mate, con pelo corto, mas claro bajo la lampara y mas oscuro hacia las bandas, jamas un verde plano. La madera es nogal laqueado, profundo, con una franja de reflejo de la lampara que corre por la banda. Los diamantes de los rieles y las chapas de las troneras son laton, con un punto caliente de brillo y nada mas. Las bolas son resina con barniz: una sola gota de luz nitida —la lampara reflejada— y el color debajo. Esa gota y el numero que gira son lo que hace que una esfera lea como bola de pool. El efecto tiene que verse: la bola rota de verdad, y quien mira entiende el top o el retroceso por como giran el numero y la banda, sin leer una cifra.

El color es un vocabulario corto, dicho en voz baja. El verde es el campo, el ambar es la luz, y nada mas tiene voz fuerte. Los dos equipos, azul y naranja, aparecen solo donde hay informacion —la linea de punteria, el brillo bajo la blanca, la tira de luz del riel, el HUD— y nunca tiñen las bolas ni la mesa, porque ahi mandan los colores del juego. El neon del bar es senaletica y nada mas: el titulo en cursiva color ambar y, lejos y desenfocado, una copa de martini roja. Son una puntuacion y no una competencia: ninguno ocupa mas de un ocho por ciento del cuadro, y el neon jamas toca un objeto del juego (bolas, taco, linea de tiro). Por la ventana, una ciudad azul de noche con sus ventanas encendidas: es el unico azul frio de la escena y esta siempre fuera de foco.

La camara es direccion, no encuadre. La vista de planificacion es serena y legible: la mesa entera, siempre. La de apuntado baja y se vuelve intima, detras de la blanca, para el tiro fino. La de accion sigue con contencion, y la camara lenta se reserva para lo que la merece: la rotura, la bola ocho, una embocada imposible. Los movimientos de camara son suaves y con inercia, nunca un corte seco, y ninguno puede poner en riesgo la lectura de la mesa. La informacion que importa vive dentro del mundo —marcas de tiza sobre el paño, luz sobre la blanca, el taco que se carga— antes que en un panel superpuesto; el HUD se queda con lo que el mundo no puede decir, y lo dice chico.

La jerarquia es absoluta: la bola en juego y la linea de tiro brillan primero, el resto de la mesa lee en segundo plano, y el salon recede en atmosfera calibrada. Todo adorno que compita con la lectura del tiro se saca, por lindo que sea. Lo que queda tiene que verse inevitable, como una mesa que alguien dejo lista para jugar y no hubo que tocar.

## Vocabulario concreto

Los valores son de partida y se ajustan mirando la escena; la regla de cada token es lo que no se negocia.

| Token | Valor | Regla |
| --- | --- | --- |
| Salon | `#07080b` | Base casi negra con un matiz calido. El fondo nunca es negro puro ni gris. |
| Paño (centro de la luz) | `#17665f` | Verde azulado profundo, mate: el de la portada, no un esmeralda. |
| Paño (borde, sin luz) | `#0a3b39` | Del centro al borde cae gradual, nunca en escalon. |
| Madera (nogal) | `#3a2113` | Laca profunda; reflejo de lampara en `#8a5a35`. |
| Laton | `#c8a04a` / sombra `#6e5420` | Solo diamantes, chapas de troneras y herrajes. |
| Lampara | `#ffb15e` | La unica luz grande, naranja calido como la pantalla de la portada. Cono con penumbra y caida suave. |
| Neon del titulo | `#ffb54a` (nucleo `#fff1cf`) | Cursiva ambar con nucleo casi blanco y halo naranja. Solo el logo y el cartel del menu. |
| Neon del martini | `#ff4d6a` | Fuera de foco, <= 8% del cuadro. |
| Ciudad por la ventana | `#0b1330` con ventanas `#ffcf6a` | Siempre desenfocada, nunca compite con la mesa. |
| Equipo A (lisas) | `#3aa0ff` | Solo informacion: linea, brillo bajo la blanca, riel, HUD. |
| Equipo B (rayadas) | `#ff8a2e` | Ídem. |
| Blanca | `#f3ecd8` | Marfil, no blanco puro. |

Bolas (lisas 1-7; las rayadas 9-15 repiten el color con una franja blanca; la 8 es negra `#101010`): 1 `#f2c230`, 2 `#1f4fc0`, 3 `#d02a22`, 4 `#5a2a8a`, 5 `#ee7a1c`, 6 `#1b7a3c`, 7 `#7a1a1a`. Numeros en un circulo marfil.

## Lo que no se hace

- Nada de contornos gruesos ni sombreado de dibujo animado: es un objeto fisico, no una ilustracion.
- Nada de verde plano ni de brillo parejo sobre el paño.
- Nada de glow neon sobre las bolas: el unico brillo es la gota de la lampara.
- Los colores de equipo nunca tiñen bolas, paño ni madera.
- Nada de emojis, tampoco en el HUD.
- La postproduccion (bloom suave, viñeta, un poco de grano) es un aliento sobre la imagen, no la imagen. Lo caro (profundidad de campo) es opcional y solo en equipos que lo bancan.

## La portada como referencia

La portada (`public/covers/poolnight.jpg`, original en `docs/`) es la vara de la atmosfera, no un plano de escena: un bar negro de los años cincuenta, humo, una lampara naranja arriba a la derecha, el neon ambar del nombre, la copa roja al fondo y la ciudad azul por el ventanal. De ahi se toma el clima y la paleta de esta tabla. **No se toma** el personaje ni la camara baja del dibujo: el juego se ve desde arriba y la gente de la sala son los jugadores. Las bolas de la portada (la 8 negra, la blanca marfil, naranja y azul rayadas, la roja) son el vocabulario de bolas de abajo.
