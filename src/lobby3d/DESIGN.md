# Facetas al Sol

Filosofia de diseño de la Isla, la sala 3D de `/rooms/lobby/`. Es la direccion de arte de la escena Three.js y del HUD; cada decision visual de `src/lobby3d/` le responde a este documento.

La Isla es un recreo flotando en el cielo: un lugar para esperar a los demas, votar y festejar, no un nivel para ganar. No tiene que parecerse a los juegos de bloques del roster (Derrumbe, Marea de Lava, Pista Loca): esos son cubos con textura pixelada; la Isla es **low poly facetado**. Nada de pixel art, nada de voxels, nada de texturas pintadas. Cada cara de cada objeto es un solo color plano, y los degradados los hace la luz y no el pincel: una roca es un icosaedro deformado a mano con `flatShading`, un arbol es un cono de pocas caras sobre un tronco hexagonal, el pasto es una tapa irregular de catorce lados. El que mira tiene que leer "maqueta de papel al sol", nunca "Minecraft".

La luz es el material. El sol es una sola luz direccional calida que cruza el cielo con la partida: amanece en el lobby, es mediodia en las primeras rondas, se dora a la tarde y la final es de noche, con estrellas. Un hemisferio (cielo arriba, pasto abajo) rellena las sombras con color en vez de negro. Las facetas existen para que esa luz tenga donde partirse: una cara que mira al sol se aclara, la de al lado se entinta con el cielo. Sombras de contacto baratas (un disco bajo cada muñeco), sin shadow maps: tienen que andar ocho muñecos en un celular.

El color es pastel en el mundo y saturado en lo que se toca. Pasto, piedra, madera, nubes y cielo van desaturados y claros; lo unico con voz fuerte es lo interactivo: los portales encendidos de la votacion (del `accent` de cada juego), la plataforma de LISTO, las remeras de los jugadores. Si algo brilla, se puede pisar. Las portadas de los juegos son la otra excepcion: son las unicas imagenes de la escena, van enmarcadas en madera clara y sin iluminacion (se ven con sus colores reales a cualquier hora del dia).

Las formas son redondeadas por facetas, no por suavizado. Muñecos cabezones de pocas caras, manos que flotan sin brazos, pies como porotos: simpaticos y legibles a la distancia, con la remera del color del jugador como unica marca personal. Nada de caras detalladas: dos ojos, y listo.

La composicion se vive en primera persona, a la altura de los ojos de un muñeco (pedido del programador). Al entrar se mira al norte: la galeria de portadas es un semicirculo de cara al centro, asi lo primero que se ve es la pared de juegos con el pedestal adelante. Todo lo que se toca tiene que leerse de frente y a la altura de la vista: portadas grandes a 2.25 m, contadores de votos arriba del techito de cada marco, la plataforma LISTO con su cartel en el piso. El centro de la pantalla es de la mira (un punto que se agranda sobre lo tocable) y el HUD, papel crema con borde de tinta como el resto de las salas, nunca lo tapa.

## Paleta

| Uso | Color |
| --- | --- |
| Cielo mediodia (cenit / horizonte) | `#6fb7e8` / `#cfeaf5` |
| Cielo amanecer (cenit / horizonte) | `#8fa7d8` / `#ffd2b0` |
| Cielo atardecer (cenit / horizonte) | `#5a6fb8` / `#ff9f7a` |
| Cielo noche (cenit / horizonte) | `#0e1636` / `#2c3a6b` |
| Pasto (tapa de la isla) | `#8fd18b`, variaciones `#7cc47a` `#a2dc93` |
| Tierra y roca (panza de la isla) | `#c9a27a`, `#a98262`, roca `#b8b2a8` |
| Piedra de la plaza | `#e8e0cf` |
| Madera de los marcos | `#e7c79a` |
| Plataforma LISTO | `#ffcf4a` (encendida), `#e5d7b0` (apagada) |
| Tinta del HUD | `#173042` sobre crema `#fff8ea` |

Remeras de los jugadores (por asiento): `#ff6b6b`, `#4dabf7`, `#ffd43b`, `#69db7c`, `#b197fc`, `#ff922b`, `#f783ac`, `#3bc9db`.

## Vocabulario

- **Isla**: tapa de pasto facetada, panza de tierra que se afina hacia abajo en punta, rocas colgando.
- **Plaza**: disco de piedra clara en el centro, con un pedestal donde aparece la portada del juego elegido.
- **Galeria**: las portadas de los juegos de sala en marcos de madera, en semicirculo al norte. Delante de cada una, un portal (un hexagono en el piso) que se enciende cuando el juego es candidato.
- **Plataforma LISTO**: al sur, un escalon redondo amarillo; subirse es marcar listo en el briefing.
- **Cielo**: domo con degradado, sol, nubes de icosaedros que derivan, islotes lejanos, estrellas de noche, lluvia algunas rondas.
