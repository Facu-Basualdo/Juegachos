# Patas Largas (`patas-largas`)

Réplica de **Daddy Long Legs**: una criatura de torso cúbico y dos patas
larguísimas cruza una duna al amanecer. Un toque = un paso, alternando siempre
de pata. La caminata **no es una animación**: es un ragdoll de cuerpos rígidos
(Rapier) y lo único que hace el jugador es decidir **cuándo** sale cada pata.

- Vista: Three.js en perspectiva (2.5D). La criatura vive en el plano XY; la
  profundidad existe para que el sol rasante tenga adónde tirar la sombra.
- Física: `@dimforge/rapier3d-compat` (ya era dependencia del repo por
  `rocket-arena`). `main.ts` hace `await initPhysics()` antes de crear el juego.
- Puntaje: metros recorridos (`direction: "higher"`, formato `N m`).

## Módulos

| Archivo | Qué hace |
| --- | --- |
| `game/balance.ts` | **La capa que decide**: pendulo invertido lineal (LIP) integrado con Euler simplectico, punto de captura y PID. |
| `game/Creature.ts` | El ragdoll: torso + dos patas de tres piezas unidas por revolute joints, y todo el control de la marcha. Es donde está el 90% de lo delicado. |
| `game/StepController.ts` | Alternancia estricta de piernas, antirrebote del toque y calificación del paso. |
| `game/Terrain.ts` | Suelo infinito (losas y dunas recicladas), postes de hito cada 10 / 50 / 100 m y la bandera del récord. |
| `game/Renderer.ts` | Escena, luces, sombras y cámara con seguimiento suave. |
| `game/Particles.ts` | Un solo pool de partículas para el polvo al pisar y el estallido de la caída. |
| `game/Game.ts` | Máquina de estados, bucle de física a paso fijo, eventos de colisión, modo sala. |
| `game/Hud.ts` | Metros, récord, indicador de pata, **barra de tiempo del paso** y overlays. |
| `game/constants.ts` | Todas las perillas, cada una con el porqué. |

## La marcha, y por qué está armada así

Este juego se peleó mucho con el motor. Lo que sigue está **medido**, no
supuesto; si algo de esto se "simplifica", el bicho vuelve a romperse.

### 1. El riel: la criatura vive clavada en un plano, y se logra proyectando

La trayectoria del juego es una línea. Salirse de costado no es un estado
válido, es un bug — y además es el que arrastra a todos los demás: basta un
contacto de canto del zapato para sacar al bicho del plano, y a partir de ahí
los revolute joints (todos con eje Z) trabajan torcidos, el solver se desborda
y la criatura sale volando de costado, toda rota.

Lo natural sería `setEnabledTranslations(true, true, false)` y
`setEnabledRotations(false, false, true)` en cada cuerpo. **Eso revienta la
simulación en el primer paso.** El revolute joint tiene una fila de restricción
sobre Z; si los dos cuerpos que une tienen ese grado congelado, la masa efectiva
de esa fila es cero y el impulso que calcula el solver se va a infinito
(posiciones del orden de 1e9 en menos de diez subpasos).

Un par correctivo tampoco alcanza: corrige de a poco y un golpe lo pasa por
arriba.

La solución es **`constrainToRail()`, una proyección después de cada
`world.step()`**: a cada cuerpo se le devuelve su Z, se le anula la velocidad en
Z, se le deja del cuaternión solo la parte que gira alrededor de Z y se le
anulan las velocidades angulares en X e Y. No toca ninguna restricción, así que
el solver no se entera. Medido sobre una partida entera, incluido el ragdoll:
desvío máximo en Z de 1.8e-9 m y componentes X/Y del cuaternión exactamente
cero.

Los `railZ` salen de `makeBody` (torso en 0, cada pata en ±`HIP_Z`) y coinciden
con los anclajes de los joints, así que proyectar no viola ninguna unión.

### 2. Los ángulos se miden con el eje Y rotado, no con `2*atan2(q.z, q.w)`

Esa fórmula vale solo mientras `w > 0`. En cuanto un cuerpo pasa media vuelta
(pasa solo en el ragdoll) el signo del cuaternión se da vuelta y el ángulo salta
2π; restar dos ángulos así da diferencias de 4π, y cualquier cosa que lea ese
número (el trinquete de la rodilla, la IK) toma una decisión disparatada. Ver
`zAngle` / `angleDelta`.

### 3. El paso se define por DÓNDE va el pie (cinemática inversa)

Mandarle ángulos sueltos a cadera y rodilla no sirve: la rodilla doblada corre
el pie para atrás, y una cadera de 0.6 rad puede terminar plantando el zapato
**detrás** del otro pie. `solveLegIK` resuelve la pata de dos eslabones y el
balanceo dibuja el arco del zapato.

El destino de ese arco es un **punto fijo del mundo**: `STRIDE` metros por
delante del zapato sobre el que el cuerpo está apoyado. Apuntando a un ángulo
relativo a la cadera, si el cuerpo no avanza el pie tampoco: la criatura pisa
siempre en los mismos dos puntos y marcha en el lugar (medido: 29 pasos para 5
metros). Con destino en el mundo, cada toque gana terreno por definición y el
cuerpo tiene que venir atrás de sus pies — que es de donde sale la tensión.

Ojo: apuntar al mundo **solo funciona porque la cadera tiene altura
controlada** (punto 4). Con la cadera libre y más alta que el largo de la pata,
"el piso, metro y medio adelante" queda fuera de alcance, la IK lo recorta, la
pata queda como un palo y el cuerpo rebota sobre ella como un pogo.

### 4. La pata APOYADA también va por IK, y con altura fija

`driveStance` apunta al **punto del mundo donde pisó el zapato**, y ahí están
las tres decisiones que hacen que camine:

- **Objetivo fijo del mundo, no un ángulo.** Al avanzar el cuerpo, la IK
  recalcula sola la cadera y la rodilla; el motor no pelea contra el vuelco, lo
  sigue. Con la cadera de apoyo mandada a un ángulo, el retroceso del motor
  arrastra al torso y el bicho camina para atrás.
- **Altura mínima (`STANCE_HIP_HEIGHT`), no largo fijo.** Si solo apuntara al
  punto de apoyo, la IK acompañaría la caída de la cadera pidiendo cada vez más
  rodilla y la criatura se desinflaría hasta el piso. Si en cambio se la
  obligara a estar siempre estirada, el cuerpo tendría que **trepar** el arco
  del péndulo en cada paso: hay un piso de velocidad por debajo del cual no lo
  pasa y, a ritmo tranquilo, el bicho se queda meciéndose en el lugar (medido:
  con toques cada 600 ms, 1 m en 7 pasos).
- **Y el objetivo vertical va al PISO, no a "la cadera menos H".** Es el bug más
  caro que tuvo este juego. Apuntando siempre a `hip.y - H`, cuando la cadera
  queda más **alta** que H el objetivo del pie sube por encima del suelo y la
  pata **se levanta sola**: la criatura pasa la partida en puntas de pie,
  rebotando, y deja de responder a cualquier perilla — empuje, rozamiento,
  altura, zancada: todo daba exactamente el mismo resultado. El objetivo
  correcto es `min(piso, hip.y - H)`: el pie va al suelo, y sólo se mete bajo
  tierra (con tope, `STANCE_MAX_DIG`) si la cadera se hundió.
- **Extensión de cadera (`STANCE_DRIVE`): la propulsión.** Al ángulo que pide la
  IK se le resta un poco, o sea que la pata quiere quedar más volcada hacia
  atrás de lo que la geometría pide; con el zapato clavado por fricción, eso
  empuja al **cuerpo** hacia adelante. Sin este término la pata sostiene pero no
  propulsa: las patas van poniendo pasos adelante y el cuerpo se queda.
- **Cadera de apoyo FUERTE.** Es lo que transmite al piso el retroceso del motor
  de la pata que se balancea. Con la cadera de apoyo floja ese retroceso no
  tiene adónde ir más que al torso, y cada paso empuja al bicho para atrás.

Cuando `hypot(dx, altura)` ya no entra en la pata, los motores **bajan de
fuerza** (`OVEREXTEND_FALLOFF`) en vez de pelear contra una pose imposible:
peleando, el solver se desborda y la caída sale como una explosión
(velocidades de -23 m/s, rodillas dobladas al revés); aflojando, sale como lo
que es — la pata se estira, la cadera se viene abajo y la rodilla toca la arena.

### 5. El traspaso de peso es al PLANTAR, no al tocar la pantalla

Cuando la pata que se balanceaba pisa, **ella** pasa a ser el eje y la que venía
de apoyo queda de puntal (`becomePivot`). Dejar el eje en la de atrás hasta el
próximo toque arrastra al cuerpo por delante de sus pies: la de atrás se abre
cada vez más, la cadera baja y el bicho termina abierto de gambas sin que el
jugador haya hecho nada mal.

La pata de atrás, además, **arrastra** en vez de tirar: si su punto de apoyo
quedó fuera de alcance se le limita cuánto se estira pero se le respeta la
altura. Tirando de ella como de la pata de apoyo, una pata trasera lejana te
voltea sola.

### 6. Los límites de los joints se escriben UNA vez, al construirlos

Hubo una versión con un "trinquete de rodilla" que subía el límite inferior en
cada subpaso para que la pata apoyada no se doblara. Le tira abajo el
warm-starting al solver: el joint deja de arrastrar el impulso del paso
anterior, no llega a sostener el cuerpo colgado de una pata de casi 3 m y
termina violándose (la pata se "estira" a 2.3 m de un cuadro al otro y el bicho
sale despedido). No hace falta: con la rodilla resuelta por IK el ángulo pedido
es siempre el geométricamente correcto, así que no hay nada que trabar.
**`setLimits()` no se llama nunca durante la partida.**

### 7. Las ganancias de los motores son enormes a propósito

`configureMotorPosition` con `AccelerationBased` necesita valores de orden 10³ a
10⁴ para seguir el objetivo dentro de un paso de 0.4 s. Con 2600 en la rodilla,
el error de seguimiento era de 0.7 rad y la pata plantaba doblada; con eso, el
peso entra torcido y el bicho se hunde en cada paso.

### 8. Paso fijo fino

`PHYS_STEP = 1/360` con `PHYS_SOLVER_ITERATIONS = 32`. Bajar a 1/240 alcanzaba
para caminar unos pasos y después el solver empezaba a violar joints. ### 9. Que no salga volando: tres frenos, y cada uno ataca otra cosa

El riel (punto 1) sacó los despegues en profundidad. Los que quedaban, en X e
Y, salían de la **caída**, y se arreglaron así:

- **Freno de SALTO, no de velocidad (`MAX_BODY_DV`).** Lo que delata una
  explosión del solver no es que un cuerpo vaya rápido — el zapato que se
  balancea viaja en la punta de una pata de 2.7 m y pasa de 18 m/s sin que nada
  esté mal — sino que **cambie** de velocidad de golpe. Un subpaso dura 1/360 s
  y nada legítimo cambia 11 m/s en ese tiempo. Con un tope absoluto bajo (15
  m/s) se recortaba medio balanceo legítimo (87 de 174 cuadros medidos) y el
  paso salía mordido; el tope absoluto quedó alto (45) y el trabajo fino lo
  hace el salto.
- **Los motores se apagan con rampa (`RAGDOLL_FADE`), no de golpe.** En el
  cuadro de la muerte los joints vienen cargados con impulsos enormes (la
  rodilla apoyada trabaja con 26000 de rigidez); si la rigidez pasa a cero de
  un cuadro al otro, el impulso que el solver traía calentado del paso anterior
  queda sin restricción que lo justifique y se descarga entero. Medido: el
  torso saltaba de 8 a 26 m/s en un cuadro.
- **El cuerpo suelto va amortiguado y con techo propio** (`RAGDOLL_LIN_DAMP` /
  `RAGDOLL_ANG_DAMP` / `RAGDOLL_MAX_SPEED`). Sin eso las patas se revolean, se
  estrellan contra los topes de los joints (la rodilla no pasa de 0, el tobillo
  de ±0.55) y cada golpe de tope en la punta de una pata larga mete un impulso
  que termina en el torso. El techo va **al ras de la caída libre desde la
  altura de la cadera** (`sqrt(2*g*h)` ≈ 8 m/s): con 12 todavía se escapaban
  cuerpos 2.5 m para atrás y el torso subía a 4.4 m.

Auditoría de una partida entera, jugando y muerto, en tres cadencias:

```
desvío en Z ......... 1.8e-9 m      componentes X/Y del quat ... 0
pico jugando ........ ~19 m/s       altura máxima del torso .... 3.30 m
pico muerto ......... 8.5 m/s       altura máxima del torso .... 3.58 m
```

## El bug que invalidaba todo: Rapier ACUMULA fuerzas

`addForce` y `addTorque` **no son por paso**: se acumulan y se siguen aplicando
en cada `world.step()` hasta que se llama a `resetForces` / `resetTorques`.
Este juego las agrega en cada subpaso, o sea 360 veces por segundo, así que lo
que llegaba al cuerpo era la suma de todo lo pedido desde el arranque de la
ronda.

Medido con el trazador de origen: la criatura salía de parada a **5.8 m/s en
80 ms** — unos 50 m/s² de aceleración horizontal — con un controlador que
pedía menos de 1 m/s². Todos los despegues venían de ahí, y también todas las
"marcas" largas: los 500 m del Monte Carlo eran vuelos, no caminatas.

`applyMotors` ahora resetea fuerzas y pares de cada cuerpo antes de agregar los
del subpaso. **Cualquier medición anterior a este arreglo hay que descartarla**,
incluidas las tablas de tuning: estaban hechas sobre una física que multiplicaba
por cientos todo lo que se le pedía. Después del arreglo, sobre 120 episodios:
cero cuerpos en el tope de velocidad (antes 18-89% según la versión) y pico de
12 m/s contra 45.

## Cómo se decide la marcha: LIP + punto de captura + PID

Toda la lógica de control vive en `game/balance.ts`. Reemplaza a media docena
de reglas sueltas (zancada fija, empujón por paso, sesgo de cadera, factores de
autoridad) que se tapaban los agujeros entre sí y ninguna sabía nada del estado
real del cuerpo.

**El modelo.** Péndulo invertido lineal: toda la masa en el centro de masa, a
altura `h` sobre el pie apoyado, con dinámica `x'' = w² x` y `w = sqrt(g/h)`.
Es lineal, así que tiene solución cerrada y el controlador puede ver el futuro
sin simularlo. Se integra con **Euler simpléctico** (velocidad primero con la
aceleración actual, después posición con la velocidad ya actualizada): con
Euler explícito un péndulo invertido gana energía solo y el predictor termina
prometiendo velocidades que el cuerpo nunca tiene.

**Dónde se planta el pie: el punto de captura.** `ξ = x + v/w` es el lugar
donde habría que pisar para quedar parado — anula el modo divergente del LIP.
Plantar más cerca deja que el cuerpo siga volcando, o sea que *seguir caminando
es plantar corto a propósito*. Cuánto más corto depende de la velocidad: lento
se planta corto y acelera, rápido se planta en el punto de captura o pasado y
frena. Eso lo hace auto-regulado, y hace falta porque hay un techo que la
geometría impone y no se negocia: la pata alcanza `reachX` y el balanceo dura
`SWING_TIME`, así que por encima de `reachX / SWING_TIME` (~3.3 m/s) el pie
**siempre** aterriza detrás de donde hacía falta.

**Cuánto empuja la pata de apoyo: el PID.** Sobre el desplazamiento del centro
de masa, con derivada sobre la medida y anti-windup por saturación. Las
ganancias no salen de probar números sino del criterio de estabilidad del
propio LIP: linealizado, el lazo cerrado es estable solo si `kp > m·g` (con
esta criatura, kp > 24) y queda críticamente amortiguado con
`kd = 2·m·h·sqrt(kp/(m·h) − w²)` (~20).

Dos saturaciones, las dos físicas y ninguna de tuning:

- **El torque de tobillo tope es `peso · medio zapato`.** Un pie apoyado solo
  puede correr su centro de presión dentro de su propia huella. Con un zapato
  de 36 cm eso son ~3.7 N·m, o sea que el PID satura con 8 cm de error de
  centro de masa. Es la conclusión correcta y no un defecto: **una criatura de
  patas de 3 m con pies chicos no se equilibra con el tobillo, se equilibra
  dando un paso** — por eso el peso del control está en dónde se planta.
- **El impulso de despegue tope es `peso · duración del despegue`.**

**El torque de tobillo se aplica como fuerza horizontal sobre el cuerpo**, no
como par entre tibia y zapato. Físicamente es lo mismo (el propio LIP lo dice:
correr el centro de presión se ve en el centro de masa como `F = −torque/h`),
pero la reacción cae en otro lado. Como par tibia-zapato se la come el zapato:
86 g con inercia de 0.001 kg·m² contra 3.7 N·m son 3600 rad/s², el pie se
convierte en turbina y sus puntas salen a 40 m/s. En un pie de verdad esa
reacción la absorbe el piso repartiendo la presión bajo la planta, que es justo
lo que un collider tan chico no sabe representar.

**El despegue aporta la energía orbital que falta** para llegar a `WALK_SPEED`,
no un impulso fijo. La primera versión usaba la fórmula de la marcha de compás
(devolver el choque del talón, `m·v·tan(2a)`), que es correcta para *sostener*
un paso pero tiene un problema de huevo y gallina: es proporcional a la
velocidad actual, así que una criatura quieta recibe cero y no arranca nunca —
el juego daba 3 m pasara lo que pasara, sin responder a ninguna perilla, que es
la firma de algo saturado en cero.

### Lo que queda por hacer

Con la física ya honesta, la criatura camina limpio y **no despega nunca**,
pero recorre poco: 4-6 m por partida contra los ~5 m de la versión anterior,
que además tenía cohetes. Falta una pasada de calibración de la propulsión
(`WALK_SPEED`, `CAPTURE_SHORTFALL`, `PUSHOFF_TIME`, `TORSO_UPRIGHT_*`) hecha
**sobre las fuerzas reales**, porque todas las que estaban venían escaladas
para compensar, sin saberlo, el factor de acumulación. Es un problema mucho más
tratable que el anterior: ahora cada constante significa lo que dice.

## Lo que encontró el Monte Carlo

Se corrió un banco de simulación (física a mano, sin renderizar, ~300 episodios
por corrida) con dos modelos de jugador aleatorizados: **ritmo** (metrónomo
humano, período 350-1100 ms con jitter) y **reactivo** (mira la barra y toca al
cruzar un umbral, con tiempo de reacción gaussiano). De ahí salieron cuatro
defectos que no se veían jugando a mano, todos del mismo tipo: **el
controlador de caminata seguía mandando en situaciones donde ya no tenía nada
que mandar**, y el solver contestaba con velocidades absurdas.

1. **El punto de apoyo mentía (`PLANT_SLIP_MAX`).** `plantX` se fijaba al
   plantar y no se tocaba más, así que cuando el zapato patinaba, cuando un
   toque interrumpía un balanceo o cuando la criatura volaba, la pata apuntaba
   a un punto del piso que había quedado **1 a 3 m atrás**. Medido: 1153
   episodios-con-desfase sobre 400; TODOS los picos de velocidad en juego eran
   un pie. Ahora, si el zapato se aleja más de 30 cm de su punto, el punto se
   re-ancla al pie. El pie manda.
2. **Una pata en el aire mantenía toda su fuerza (`FOOT_GROUNDED_Y`).** El
   re-anclaje, solo, empeoró las explosiones (71 → 105 episodios sobre 400)
   justamente porque hizo el objetivo siempre alcanzable y la pata dejó de
   aflojar. Con el zapato por encima de 20 cm ya no hay piso contra el que
   empujar, así que se le baja la fuerza igual que cuando está fuera de alcance.
3. **El vuelco no quitaba autoridad (`controlAuthority`).** Trazando el origen
   de los despegues: el torso ya estaba a 2.33 rad (dado vuelta), las dos patas
   colgaban a metro y medio, y el controlador seguía tirando de ellas hacia
   puntos del piso que ahora estaban **por encima** de la cadera. Ahora la
   fuerza de todos los motores se desvanece con la inclinación y con el tiempo
   de vuelo. **Ojo: es autoridad, no muerte.** Se probó cortar la partida por
   inclinación y es un desastre — sobre 27 mil cuadros que todavía tenían 2 s
   de vida por delante, el percentil 90 ya estaba en 1.12 rad: cortar ahí mata
   el 76% de las corridas.
4. **Un cuerpo hecho un ovillo se levantaba de un salto (`CRUMPLE_FRACTION`).**
   Este era el origen del despegue vertical: con la cadera derrumbada a 1.5 m y
   las dos plantas en la arena, la pata seguía intentando recuperar los 2.35 m
   de altura de marcha. Resorte comprimido: la velocidad vertical del torso
   pasaba de 5.5 a **15.6 m/s en un solo cuadro**. El tope de `STANCE_MAX_DIG`
   no alcanza porque limita la distancia del objetivo, no la fuerza. Ahora, por
   debajo del 72% de la altura de marcha, la pata deja de empujar: la partida
   ya está perdida y lo que corresponde es caerse.

5. **El primer paso se caía para atrás (`launch`).** Reportado jugando y
   confirmado midiendo. Al arrancar, el eje de giro era el pie de **adelante**,
   así que el centro de masa quedaba DETRÁS del pie sobre el que bascula el
   cuerpo: la gravedad tira para atrás y hay una cuestita de energía
   (`m·g·(√(d²+h²) − h)` ≈ 8 J) que el envión inicial apenas cubría. Ahora el
   eje arranca en el pie de **atrás** — contraintuitivo, porque uno pondría el
   que aguanta el peso, pero es lo que hace que el cuerpo se caiga hacia
   adelante, que es como arranca a caminar cualquiera.

   Iba de la mano de una pose de arranque demasiado abierta: los zapatos
   partían a 2.3 m entre sí cuando el alcance horizontal de la pata es 1.34, o
   sea que la criatura empezaba **al borde de abrirse de gambas**.
   `START_FOOT_X` bajó de 1.15 a 0.75.

**El tobillo rígido fue una mala idea y el banco la cazó.** Endurecerlo parecía
razonable (el pie pesa 76 g colgando de una pata de 2.7 m) y en una prueba corta
mejoraba la distancia, pero sobre la corrida completa subía las explosiones de
2.3 a 3.6 por minuto jugado. Quedó blando.

### El resultado

| | antes | después |
| --- | --- | --- |
| distancia mediana / p90 / máxima | 6 / 10 / 31 m | 5 / 17 / 61 m |
| **partidas que terminan en 0 m** | **46 / 300 (15%)** | **9 / 300 (3%)** |
| desfases de punto de apoyo | 1153 | 0 |
| explosiones por minuto jugado | 2.4 | 3.6 |
| saltos bruscos de velocidad por segundo | 3.0 | 2.6 |
| pico de altura del torso, jugando | — | 3.29 m (parado mide 3.3) |

El eje en el pie de atrás es lo que se lleva casi todos los ceros. Se paga con
más explosiones por minuto (3.6 contra 2.3 con el eje adelante), y se eligió
igual: una partida que no arranca es un juego roto, una explosión cada veinte
segundos es un juego feo.

Lo importante no está en esa tabla: **apareció un gradiente de habilidad que
antes no existía**. Antes la distancia mediana era 5-7 m para *cualquier*
cadencia de toques (350 a 1100 ms) y *cualquier* umbral de la barra — o sea, el
juego era azar, no destreza. Ahora, ordenando los episodios por dónde cae el
toque en la barra:

```
barra 0.0-0.2 -> mediana  4 m      barra 0.6-0.8 -> mediana  8 m
barra 0.2-0.4 -> mediana  7 m      barra 0.8-1.0 -> mediana  9 m
barra 0.4-0.6 -> mediana 10 m      barra 1.2-1.4 -> mediana  5 m
```

Eso confirma que la ventana buena del HUD (0.42-0.78) está bien calibrada, y
que tocar temprano de más es peor que tocar tarde de menos.

### Lo que sigue abierto

- **El 48% de las muertes las agarra la red de seguridad** (`TORSO_FLOOR_Y`), no
  la regla de "algo que no es zapato toca la arena". Quiere decir que la
  criatura se hunde más de lo que tropieza; la caída podría leerse mejor.
- Las partidas en 0 m bajaron a 3%, pero las explosiones por minuto subieron a
  3.6 al mismo tiempo. Es la deuda que queda del cambio de eje de arranque.
- Las explosiones bajaron de nivel pero no desaparecieron: quedan ~2.3 por
  minuto jugado, y ahora son del zapato, no del torso — mucho menos visibles,
  pero están.

## ESTADO: oculto del roster (`hidden: true`)

**El juego no sale hasta que camine.** Se para bien, no despega nunca y el riel
lo mantiene en su plano, pero la marcha no se sostiene: 0-6 m segun la cadencia.
Esta oculto con `hidden: true` en su `meta.ts`, el mismo mecanismo que usa
`rocket-arena`: el codigo, el modelo de simulacion y todo lo aprendido quedan
versionados en main — que es lo valioso, porque tres de los hallazgos son del
motor y no del juego — y la ficha simplemente no aparece en la landing ni en
las salas. Para publicarlo alcanza con borrar esa linea.

## La tension geometrica que falta resolver

Es el bloqueante, y no se arregla con mas tuning: son las PROPORCIONES del
bicho. Dos condiciones tiran para lados opuestos sobre la misma variable, la
altura de cadera:

- **Para pararse** con los pies juntos la cadera tiene que estar ALTA. A
  `2.10 / 2.72 = 0.77` de extension la rodilla queda a 78 grados, su posicion
  mas debil, y la criatura se desploma sola sin que nadie toque nada.
- **Para plantar sin frenar** la cadera tiene que estar BAJA, para que a la
  pata le sobre recorrido y la rodilla absorba el golpe del aterrizaje.
  Plantando con la pata casi estirada el cuerpo choca contra un palo rigido y
  pierde todo el envion (medido: 0 m en todas las cadencias).

Con patas de 2.72 m la ventana entre ambas es de centimetros. Hoy esta en 2.31,
el punto medio: se para los 5 segundos pero camina poco.

Las salidas son de proporcion, no de constante:

1. **Acortar las patas** (2.72 -> ~2.2 m). Rodilla mas estirada parada y
   recorrido de sobra al plantar. Cuesta la silueta, que es medio el punto del
   juego.
2. **Agrandar el pie** (0.36 -> ~0.55 m). Mas poligono de soporte = mas
   autoridad de tobillo = se para con la cadera mas baja, y ahi la pata tiene
   todo el recorrido que necesita.
3. **Bajar la gravedad** (12 -> ~8). Todo pasa mas lento, la rodilla aguanta
   mas flexion y el timing perdona mas.

La combinacion (2) + (3) es la que mas mueve la jugabilidad tocando menos la
silueta.

## El bug que tapaba todo lo anterior

`SWING_PLANT_REACH` limitaba la pata durante el balanceo a MENOS que la altura
de la cadera: la pata **no llegaba al piso**, el objetivo del pie se recortaba
contra ese tope en todos los cuadros y el paso quedaba corto pasara lo que
pasara. En el trazo del primer paso el pie avanzaba 11 cm y aterrizaba DETRAS
del otro pie.

Es el tercer bug de la misma familia en este juego, y los tres se detectaron por
el mismo sintoma: **ninguna perilla cambia el resultado**. Cuando barres un
parametro por medio orden de magnitud y la medicion no se mueve, no es que falte
tuning — hay algo saturado o recortado tapandolo. Vale mas parar y trazar que
seguir barriendo.

| # | Bug | Sintoma |
| --- | --- | --- |
| 1 | `addForce`/`addTorque` de Rapier se acumulan entre pasos | El control pedia 1 m/s^2 y entregaba 50 |
| 2 | Signo invertido en el PID de tobillo | Realimentacion positiva; no podia quedarse parada, y "parecia funcionar" porque daba mas distancia |
| 3 | `SWING_PLANT_REACH` menor que la altura de cadera | La pata no llegaba al piso; el primer paso avanzaba 11 cm |

## Arranque parado, y el bug de signo que lo destapo

La criatura arranca **quieta, con los dos pies juntos**, y no se mueve hasta el
primer toque. No hay envion inicial ni traspaso de peso: el `started` de
`Creature` mantiene apagada la propulsion (extension de cadera y despegue) y le
cambia la consigna al PID de tobillo hasta que el jugador da el primer paso.

Tres cosas hicieron falta y ninguna es obvia:

1. **Parada se sostiene erguida y se agacha al caminar** (`STAND_HIP_HEIGHT`
   2.55 -> `STANCE_HIP_HEIGHT` 2.10, con transicion suave). Con los pies juntos
   la pata tiene que acortarse hasta la altura de cadera, y a la altura de
   marcha eso son 78 grados de rodilla: su posicion mas debil. A esa altura se
   desplomaba sola.
2. **El poligono de soporte son los DOS pies.** El torque de tobillo disponible
   sale del medio ancho del poligono, no del largo de un zapato. Mirando un solo
   pie el modelo se queda corto justo cuando mas margen hay — parada con las dos
   plantas en el piso.
3. **El PID de tobillo tenia el signo invertido.** Era realimentacion positiva:
   empujaba en la direccion de la caida, y por eso no habia forma de que se
   quedara parada. El LIP dice `x'' = (g/h)(x - x_cop)`: para frenar un centro de
   masa que se va hacia adelante hay que correr el centro de presion POR DELANTE
   de el, o sea fuerza hacia atras; como el PID devuelve `kp*(consigna - medida)`,
   la fuerza equivalente es `+torque/h`.

**Y ese bug estaba pagando la marcha.** El empuje espurio hacia adelante era, en
los hechos, la propulsion principal: al corregir el signo la criatura empezo a
equilibrarse bien y a caminar 0 m. El sintoma que despista es que el bug
"parecia funcionar" — daba mas distancia, porque acelerar hacia adelante hace
avanzar mas antes de caerse. Es el mismo patron que el bug de acumulacion de
fuerzas, un nivel mas abajo: **una constante mal puesta compensando otra**.

Lo que devolvio la marcha fueron dos correcciones:

- **La extension de cadera (`STANCE_DRIVE`) vuelve a ser la propulsion
  principal.** La habia sacado al pasar al LIP, con la idea de que alcanzara con
  tobillo y despegue. Es un error de modelado: en la marcha humana la mayor
  parte de la potencia la ponen los extensores de cadera, y menos todavia va a
  poner un pie de 36 cm que apenas da 3.7 N*m.
- **El piso de la zancada se mide contra el CENTRO DE MASA, no contra el pie
  anterior.** Medido contra el pie anterior obliga a una zancada minima aunque
  el cuerpo no avance: las patas van pisando cada vez mas adelante, el cuerpo se
  queda, la base de apoyo se le escapa y termina sentandose para atras. En el
  trazo se veia como el tobillo empujando **saturado hacia adelante en todos los
  cuadros** y el cuerpo yendose igual para atras.

## De donde sale la dificultad

`ANKLE_WALK_SHARE`. Parada, el tobillo usa toda su autoridad (por eso se
sostiene sola); caminando, apenas la mitad. Con autoridad completa el tobillo
salva casi cualquier error de tiempo y caminar deja de tener merito: se
sobrevive con cualquier cadencia. Recortandola, el equilibrio pasa a depender de
DONDE se planta el pie, que es lo unico que el jugador maneja.

La superficie de habilidad medida (11 s de ventana, cadencia fija por corrida):

| pulsacion | 420 ms | 520 ms | 620 ms | 720 ms | 850 ms | 1000 ms |
| --- | --- | --- | --- | --- | --- | --- |
| **100 ms** | **27 m** | 2 m | 0 m | 2 m | 3 m | 2 m |
| **260 ms** | **18 m** | **24 m** | **27 m** | 5 m | 4 m | 5 m |

Se lee solo: **pulsacion corta pide cadencia rapida; trancada larga aguanta un
ritmo mas pausado.** Las dos llegan parecido, asi que es una eleccion y no una
receta. Y aflojar el ritmo te mata, que es lo que le faltaba al juego.

## La zancada la decide el tiempo de pulsacion

Un toque seco da el paso minimo; sostener el boton lo alarga. Es lo unico que el
jugador decide ademas del **cuando**, y le da al juego su segunda dimension: el
ritmo dice cuando pisar, la pulsacion cuanto arriesgar.

**Y va al reves de lo que uno pondria.** El instinto es "apretar mas = estirar
el pie mas adelante", pero el punto de captura es justamente donde uno se
FRENA: plantar por delante de el es la maniobra de frenar. Probado asi,
sostener el boton *acortaba* el paso — medido, 1.29 m/paso con toque seco contra
0.40 m/paso sosteniendo. La trancada larga sale de ir mas rapido: la carga
planta mas **corto** (`HOLD_SHORTFALL`), eso acelera, y con mas velocidad el
propio punto de captura (`x + v/w`) se corre hacia adelante y el paso se estira
solo. Al mismo tiempo la carga sube la velocidad objetivo del despegue
(`WALK_SPEED` -> `WALK_SPEED_MAX`), porque una trancada larga sin energia para
sostenerla es siempre peor que un paso corto.

La carga queda **latcheada en la pata** y solo cuenta durante la primera mitad
del balanceo (`HOLD_WINDOW`): soltar no acorta un paso ya comprometido, y
despues de esa ventana la pata ya esta bajando y correrle el destino la mandaria
a un punto al que no llega. Se elige el largo al principio y despues hay que
bancarselo.

Medido por el camino real del teclado (`keydown` -> `keyup`), a la misma
cadencia:

| pulsacion | m por paso | m/s | distancia |
| --- | --- | --- | --- |
| toque seco | 0.57 | 0.78 | 4 m |
| 160 ms | 1.17 | 1.62 | 14 m |
| 260 ms | 1.60 | 2.23 | 32 m |
| 400 ms | 1.65 | 2.28 | 33 m |

El `InputController` sigue apretar sobre el **container** y soltar sobre
**window**: si el dedo o el mouse se van del elemento antes de soltar, el
`pointerup` no llega y el paso queda cargando para siempre.

## Reglas del juego

- **Alternancia estricta.** `StepController` fija cuál pata sale; no hay forma
  de adelantar dos veces la misma. El punto lleno del HUD indica cuál toca.
- **Derrota inmediata si toca el piso algo que no sea un zapato.** Se resuelve
  con `ActiveEvents.COLLISION_EVENTS`: cada collider que no es zapato está en
  `lethalColliders`, y el primer contacto con el suelo mata. Como red, si el
  torso baja de `TORSO_FLOOR_Y` también muere (por si un evento se escapa).
- **Fricción alta en los zapatos** (`FOOT_FRICTION` 2.6, combinada con `Max`):
  el pie es un eje, no un patín.
- **El toque llega siempre.** El paso nunca se "rechaza" por timing: sale igual
  y la física decide. La calificación (`APURADO` / `BIEN` / `PERFECTO` /
  `TARDE`) es **solo devolución** — no da bonus ni penaliza.

## La barra de tiempo del HUD

`Creature.stanceTrailRatio()` es EL número del juego: cuánto se pasó el cuerpo
respecto del pie apoyado, normalizado entre el instante del apoyo y el punto en
que la pata ya no llega (1 = te caés). La normalización arranca en `-STRIDE`
porque el zapato aterriza **adelante** del cuerpo; sin ese corrimiento la barra
empieza pasada de la mitad, termina siempre en rojo y no informa nada. El HUD lo pinta
como barra con la ventana buena marcada, y `StepController` lo usa para
calificar. Sin esa barra el jugador no tiene de dónde leer el timing: el bicho
se cae y no queda claro si fue por apurado o por tarde.

## Escenario

El **collider** del piso es uno solo y grande (`GROUND_HALF_X` 300): el suelo es
plano y horizontal, reciclarlo solo agregaría teleports de geometría debajo de
los pies. Lo que se recicla es lo visual — losas, dunas de fondo y postes de
hito. Postes chicos cada 10 m, medianos cada 50 y altos con cartel de metros
cada 100 (el cartel es un `CanvasTexture` cacheado por número).

La **bandera del récord** se planta en el mejor puntaje guardado y al pasarla
suena una campanita, sale un estallido dorado y aparece el cartel
"RECORD SUPERADO". Es decorativa a propósito: un cuerpo rígido ahí sería algo
con lo que tropezar.

**La caja de sombra del sol tiene que sobrarle.** Ajustada al pelo, su borde se
ve como una línea diagonal cruzando la arena, que parece un bug de terreno.

## Cámara

Sigue el torso con lerp exponencial. La distancia y el adelanto se corrigen por
relación de aspecto: el `fov` de Three es **vertical**, así que en un celular en
vertical el encuadre se angosta muchísimo y con los valores de escritorio la
criatura queda medio afuera del cuadro.

## Salas

Wireo estándar (`initRoomMode`, `getScore` = metros, `onStart` =
`beginCountdown`, `reportScore` en el game over). **Declara
`roomTimeLimitSec: 75`**: la pose de arranque es estable y nada voltea a la
criatura sola, así que un jugador quieto trabaría la ronda para siempre.

No usa `roomRun.ts` (F5): es `direction: "higher"`, y recargar solo tira a la
basura los metros que llevabas, que es castigo y no exploit.

## Perillas que más se notan

| Constante | Efecto |
| --- | --- |
| `STANCE_HIP_HEIGHT` | Altura de marcha. Más baja = más margen de zancada antes de abrirse de gambas (y criatura más agachada). |
| `STRIDE` | Cuánto adelante del pie apoyado aterriza el otro. Metros por paso. Tiene que entrar cómodo dentro del alcance horizontal de la pata, `sqrt((L*0.995)² - H²)`, o la criatura planta siempre pasada de rosca. |
| `STANCE_DRIVE` | Propulsión. Poco y las patas caminan solas dejando el cuerpo atrás; mucho y se va de trompa en tres pasos. |
| `SWING_TIME` | Cuánto tarda el paso. Es el techo del ritmo de toques. |
| `STEP_PUSH_X` | Envión por paso. Junto con `TORSO_DRAG` fija la velocidad de crucero. |
| `TORSO_DRAG` | Techo de velocidad. Sin él la criatura se acelera hasta que ninguna pata la sigue. |
| `TORSO_UPRIGHT_*` | Cuánto se endereza el torso. Muy poco y va de trompa siempre; mucho y se convierte en un robot que se equilibra solo. |
