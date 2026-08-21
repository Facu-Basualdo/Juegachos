# La Escalera — Direccion de arte: "Descenso Pintado"

Todo el juego pasa en un hueco de maquinas sin ventanas: una escalera mecanica
vieja que baja para siempre hacia un pozo de dientes de hierro, y un solo obrero
subiendola. La referencia es doble y deliberada: se usa **el manual visual de
Pizza Express** (historieta cel-shaded, formas gordas, lectura instantanea) y se
lo baja al **registro sombrio de Danger Wings** (casi-negro, luz racionada,
hierro forjado, el rojo como amenaza). Dibujo animado, si — pero un dibujo
animado que te mata.

## La sensacion unica

**"La maquina gana."** Cada cuadro tiene que sentirse como el segundo previo a
resbalarse: la cinta arrastra, los escalones desfilan hacia abajo sin parar, el
pozo late en rojo abajo y el unico que se mueve para el otro lado es el muñeco.
Si una decision hace que la escena se sienta amable, quieta o segura, esta mal.

## Principios

1. **Historieta, no realismo — pero apagada.** El sombreado es **cel** puro
   (`MeshToonMaterial` con rampa escalonada, `toon.ts`), igual que Pizza Express:
   bandas planas, siluetas gordas, nada de PBR brillante. La diferencia es que la
   rampa de tonos esta **sesgada al oscuro** (`pow(t, 1.7)` en vez del sesgo
   claro de Pizza Express): la mayoria de las superficies cae en las bandas de
   sombra y la luz hay que ganarsela. Historieta a las tres de la mañana en un
   subsuelo, no historieta al atardecer.

2. **La oscuridad es el material; la luz esta racionada.** No hay luz de relleno
   generosa. Existen exactamente cuatro fuentes y cada una esta justificada por
   un objeto: la luz de servicio fria de arriba, las lamparas ambar de aviso
   atornilladas a los muros, el resplandor rubi que sube del pozo, y el cartel de
   flechas. El bloom solo alcanza a esas cuatro (umbral 0.8). Todo lo demas —
   muros, vigas, cadenas — se hunde en el casi-negro y solo aporta encierro.

3. **La escalera es una escalera de local, y ahi esta el chiste.** No es una
   maquina de tortura inventada: es el aparato mas cotidiano que hay, con todo
   su vocabulario intacto — huellas de chapa estriada, **demarcacion amarilla**
   en el frente de cada escalon, faldones de inoxidable, cepillo de seguridad,
   **balaustrada de vidrio**, zocalo iluminado y pasamanos de goma que se ve
   correr. Un supermercado a las tres de la mañana que termina en un pozo de
   hierro. Esa hilera de bordes amarillos desfilando hacia abajo es la cadencia
   visual del juego: la repeticion es exacta a proposito (cadencia pareja =
   mecanismo), y nada decorativo puede competir con ella.

4. **Una sola flecha, y nada al lado.** El cartel de matriz de puntos cuelga
   sobre el hueco y se lleva el tercio superior del cuadro: **una** pantalla
   ambar con lo que hay que apretar ahora, ocupando de verdad ese tercio (el
   glifo llena casi toda la pantalla y el marco es apenas un borde). Nada se le
   superpone: el muñeco tiene su propio tramo de escalera mas abajo y el cartel
   se apaga al morir. Ni barra de tiempo debajo ni medidor al costado: el reloj lo cuenta la flecha misma (se corre al rubi y late) y la
   altura la cuenta el muñeco en la escalera. Cada barra que se saco es una cosa
   menos entre el jugador y la escena. Nada de fila de "las que vienen" —
   se probo y las flechas chicas de arriba se llevaban el ojo justo en el
   momento de reaccionar a la grande. Por lo mismo el puntaje del HUD vive en la
   esquina: el centro no se comparte. Y el **acierto no enciende nada**: el
   cambio de glifo ya es el aviso, mientras que un destello blanco por acierto
   lavaba la pantalla varias veces por segundo y arruinaba la penumbra.

5. **Un cuerpo humano, leido por silueta.** El obrero se lee por silueta y por
   casco, nunca por detalle facial — a la velocidad del juego no hay tiempo de
   mirarle la cara. Pero la silueta es **anatomica, no de juguete**: cabeza chica
   (~1/8 del alto), hombros mas anchos que la cadera, torso que se afina en la
   cintura y miembros de capsulas, no de cajas apiladas. El mundo es de
   historieta; el cuerpo, no. Mameluco casi negro contra el hierro y **el casco
   amarillo como unica nota saturada**. En sala cada rival lleva el mismo cuerpo
   en otro color de mameluco: se distinguen por color y por el nombre flotando,
   nunca por forma.

6. **El rojo no decora: avisa.** El rubi aparece siempre por lo mismo — el
   resplandor del pozo, el destello del error y la barra de tiempo cuando se te
   vence la flecha. Si algo es rojo, te esta por matar.

7. **La sangre es el unico exceso permitido.** Todo el juego es contencion:
   luz racionada, color contado, ornamento removido. Cuando el cuerpo llega a
   las puas, esa regla se rompe de golpe y a proposito — estallido de gotas,
   chorro que sigue saliendo, manchas que se acumulan en el fondo del pozo,
   hilos escurriendo por los hierros, un charco que crece y no para, y
   salpicadura sobre el lente que **no se limpia** hasta la proxima partida. El
   contraste es el efecto: dos minutos de maquina gris y prolija terminan en un
   desastre. La sangre es granate oscuro (`#8e0a16` fresca, `#4a0209`
   encharcada), nunca rojo brillante de dibujito.

8. **El hierro que mata puede pagar el especular.** Unica excepcion a la regla
   "nada de PBR": las puas usan `MeshStandardMaterial` (metalico medio,
   rugosidad baja) mientras el resto de la escena es cel-shaded. El brillo
   corrido a lo largo del filo es lo que las hace leer como metal afilado de
   verdad, y son exactamente el objeto que tiene que dar miedo. Ninguna otra
   superficie tiene ese permiso.

9. **La recompensa es ponerse mas raro, no mas lindo.** Cada 15 puntos el tinte
   ambiente se desliza un paso (indigo, granate, teal ahogado, violeta) siempre
   dentro del registro casi-negro, como en Danger Wings: sobrevivir no ilumina el
   hueco, lo enrarece.

## Paleta

| Rol | Color | Uso |
| --- | --- | --- |
| Vacio | `#06070a` | fondo, todo lo que no se gano su luz |
| Hierro | `#3a3f49` | estructura, rieles |
| Inoxidable | `#6b727e` | huellas de los escalones, faldones |
| Amarillo de seguridad | `#b98b1e` | demarcacion del escalon, peines, cepillo |
| Vidrio | `#5d7690` | balaustrada (apenas azulada, casi transparente) |
| Sangre | `#8e0a16` / `#4a0209` | fresca / encharcada. Solo al morir |
| Hierro oscuro | `#22252c` | contrahuellas, faldones, vigas, estructura |
| Filo frio | `#8d94a2` | borde de cada escalon, punta de las puas |
| Piedra | `#191a22` | muros de reja del hueco |
| Goma | `#14161b` | pasamanos, botas |
| Hueso | `#e8e2d0` | luz de servicio, flechas por venir, barra de tiempo |
| Ambar de aviso | `#ff7a2a` | lamparas, flecha actual, racha, acentos del HUD |
| Ambar profundo | `#b1471a` | la sombra del ambar, luz de las lamparas |
| Rubi | `#c41530` | pozo, error, alarma: siempre peligro |
| Oro gastado | `#c9a24a` / `#5d4520` | chapas de peine, jaulas de lampara, textos chicos |
| Mameluco | `#2a3550` / `#18203a` | ropa del obrero (azul apagado, casi negro) |
| Casco | `#d8a12c` | la unica nota saturada del muñeco |

Luz clave **hueso fria** desde arriba (la unica que castea sombras),
hemisferica indigo sobre negro para que los reversos no sean vacio absoluto, y
las lamparas ambar (sin sombra) como unico contraste de temperatura. Niebla
exponencial del color del tinte ambiente: el fondo del hueco se traga la
geometria en vez de recortarla.

## Anti-goals

- Nada de neon, cromo, ni PBR brillante: esto es dibujo, no render.
- Nada de luz gratis: si algo brilla, tiene que haber un objeto que lo emita.
- Nada que compita con la hilera de filos de los escalones ni con la flecha.
- Nada de paletas alegres al avanzar: progresar enfria, nunca ilumina.
- Nada de detalle en el muñeco que no se lea en un cuarto de segundo.
- Nada de destellos por acierto: premiar con luz es lo contrario de esta paleta.
- Nada de sangre roja brillante de dibujito: granate oscuro, siempre.

## Portada (Krea)

Prompt en `public/covers/README.md` (bloque "La Escalera"). Debe mostrar la
escalera en picado, el obrero de casco amarillo subiendola y el pozo de puas
rojo al pie, con el titulo integrado.
