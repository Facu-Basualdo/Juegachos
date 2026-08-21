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

3. **La escalera es el escenario y tambien el enemigo.** La cinta es lo unico
   iluminado de punta a punta: cada escalon lleva un **filo frio** en el borde, y
   esa hilera de filos desfilando hacia abajo es la cadencia visual del juego. La
   repeticion es exacta a proposito: cadencia pareja = mecanismo; irregular =
   accidente. Nada decorativo puede competir con esa hilera.

4. **La flecha manda sobre todo lo demas.** El rack de pantallas de matriz de
   puntos cuelga sobre el hueco y se lleva el tercio superior del cuadro entero:
   una pantalla grande ambar (lo que hay que apretar **ahora**) y cuatro chicas
   hueso arriba (lo que viene). Es la unica informacion del juego, asi que es la
   unica cosa a la que se le permite brillar de verdad. Por eso el puntaje del
   HUD se corrio a la esquina: el centro no se comparte.

5. **Un solo cuerpo, leido por silueta.** El obrero es la unica figura del
   cuadro: proporciones de dibujo (cabeza grande, torso rechoncho, botas
   pesadas), mameluco casi negro contra el hierro y **el casco amarillo como
   unica nota saturada del muñeco**. Se lee por silueta y por casco, nunca por
   detalle facial: a la velocidad del juego no hay tiempo de mirarle la cara.

6. **El rojo no decora: avisa.** El rubi aparece en tres lugares y siempre
   significa lo mismo — las puas del pozo, el destello del error y la barra de
   tiempo cuando se te vence la flecha. Si algo es rojo, te esta por matar.

7. **La recompensa es ponerse mas raro, no mas lindo.** Cada 15 puntos el tinte
   ambiente se desliza un paso (indigo, granate, teal ahogado, violeta) siempre
   dentro del registro casi-negro, como en Danger Wings: sobrevivir no ilumina el
   hueco, lo enrarece.

## Paleta

| Rol | Color | Uso |
| --- | --- | --- |
| Vacio | `#06070a` | fondo, todo lo que no se gano su luz |
| Hierro | `#3a3f49` | huella de los escalones, puas |
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

## Portada (Krea)

Prompt en `public/covers/README.md` (bloque "La Escalera"). Debe mostrar la
escalera en picado, el obrero de casco amarillo subiendola y el pozo de puas
rojo al pie, con el titulo integrado.
