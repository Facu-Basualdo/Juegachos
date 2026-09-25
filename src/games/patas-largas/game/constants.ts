/**
 * Patas Largas — constantes de tuning.
 *
 * Todo el juego trabaja en METROS y el mundo es plano en Z: la fisica es 2D
 * (plano XY) resuelta con Rapier 3D, y la profundidad existe solo para que la
 * camara en perspectiva la lea como 2.5D. Ver CLAUDE.md del juego.
 */

// ---------------------------------------------------------------- identidad
export const BEST_SCORE_KEY = "patas-largas:best";

// ------------------------------------------------------------------ fisica
/** Gravedad. Mas fuerte que la real: acorta el periodo del pendulo invertido. */
export const GRAVITY_Y = -12;
/** Paso fijo de simulacion. Las patas son largas y finas: 240 Hz o se doblan. */
export const PHYS_STEP = 1 / 360;
/** Tope de subpasos por cuadro (evita la espiral de la muerte). */
export const PHYS_MAX_SUBSTEPS = 16;
/** Iteraciones del solver. Cadenas largas de joints piden mas que el default. */
export const PHYS_SOLVER_ITERATIONS = 32;

/**
 * Grupos de colision (16 bits de membresia << 16 | 16 bits de filtro).
 * La criatura NUNCA choca consigo misma: sin esto los muslos y las tibias se
 * empujan entre si en cada paso y el ragdoll explota.
 */
export const GROUP_GROUND = (0x0001 << 16) | 0x0002;
export const GROUP_CREATURE = (0x0002 << 16) | 0x0001;

// ------------------------------------------------------- medidas del bicho
/** Torso/cabeza cubico: ancho (X) x alto (Y) x fondo (Z). */
export const TORSO_W = 0.62;
export const TORSO_H = 0.74;
export const TORSO_D = 0.62;
export const TORSO_DENSITY = 5.5;
/**
 * Inercia angular EXTRA del torso (se suma a la que sale de la densidad).
 *
 * Sin esto el juego no camina, y el motivo es contraintuitivo: una pata de 3.1
 * m tiene, alrededor de la cadera, MUCHA mas inercia que el cubito del torso.
 * El motor de cadera aplica pares iguales y opuestos, asi que al querer tirar
 * la pata hacia adelante lo que gira es el torso, y la pata se queda donde
 * esta. Darle al bloque una inercia comparable lo convierte en la base firme
 * contra la que la cadera puede empujar. Es un cheat honesto: sube la inercia,
 * no la masa, asi que no cambia como cae ni como pesa.
 */
export const TORSO_EXTRA_INERTIA = 12;
/**
 * Rozamiento lineal del torso. Le pone techo a la velocidad: sin esto el
 * bicho se acelera vuelta a vuelta (los motores y el par de enderezado meten
 * energia en cada paso) y termina a 11 m/s, que ninguna pata de 3 m puede
 * seguir — se abre de gambas y se cae sin que el jugador haya hecho nada mal.
 */
export const TORSO_DRAG = 0.8;

/** Cada pata: muslo + tibia, ambos del mismo largo. Absurdamente finas. */
export const THIGH_LEN = 1.36;
export const SHIN_LEN = 1.36;
export const LEG_RADIUS = 0.062;
export const LEG_DENSITY = 4;

/** Zapato: lo unico que tiene derecho a tocar el suelo. */
export const FOOT_LEN = 0.36;
export const FOOT_H = 0.11;
export const FOOT_D = 0.24;
export const FOOT_DENSITY = 9;
/** El zapato adelanta respecto del tobillo (talon corto, punta larga). */
export const FOOT_FORWARD = 0.07;
/** Friccion del zapato: alta a proposito, el pie es un eje, no un patin. */
export const FOOT_FRICTION = 2.6;
/** Por encima de esta altura el zapato se considera en el aire, sin autoridad. */
export const FOOT_GROUNDED_Y = 0.2;
export const GROUND_FRICTION = 1.4;

/** Separacion de las caderas en Z (profundidad), para que se vean las dos patas. */
export const HIP_Z = 0.17;

/** Altura de la cadera con las patas estiradas. */
export const HIP_HEIGHT = THIGH_LEN + SHIN_LEN + FOOT_H * 0.5;

// -------------------------------------------------------- limites de joints
export const HIP_LIMIT_MIN = -1.25;
export const HIP_LIMIT_MAX = 1.35;
/**
 * La rodilla dobla SOLO hacia atras (angulo negativo) y su tope superior es
 * exactamente 0: con la pata estirada el limite del joint es rigido y sostiene
 * el peso solo, sin depender de la fuerza del motor. Es lo que convierte a la
 * pata de apoyo en un puntal de verdad.
 */
export const KNEE_LIMIT_MIN = -2.2;
export const KNEE_LIMIT_MAX = 0;
export const ANKLE_LIMIT_MIN = -0.55;
export const ANKLE_LIMIT_MAX = 0.55;

// ------------------------------------------------------- motores del andar
/**
 * Pata de APOYO (el pie sobre el que bascula el cuerpo): cadera casi libre.
 * Un motor rigido aca pelea contra el enderezado del torso y el bicho se
 * arrastra para atras en vez de caminar; con la cadera suelta el cuerpo cae
 * hacia adelante como un pendulo invertido, que es de donde sale el avance.
 * La rigidez chica es un extensor de cadera suave: sostiene el andar sin
 * convertirlo en una animacion automatica.
 */
export const HIP_STANCE_STIFFNESS = 9000;
export const HIP_STANCE_DAMPING = 420;

/**
 * Pata PLANTADA (la que ya termino su balanceo y espera el proximo toque):
 * sostiene el angulo con el que aterrizo. Sin esto las dos caderas quedarian
 * libres a la vez y la A de las patas se desarma sola.
 */
export const HIP_BRACE_STIFFNESS = 3000;
export const HIP_BRACE_DAMPING = 260;
/**
 * Altura a la que la pata apoyada sostiene la cadera, en metros. Es la MISMA
 * parado que caminando, a proposito: cuando eran distintas, el primer toque
 * disparaba una bajada de 45 cm justo en el momento mas delicado de la
 * partida y dar el primer paso se volvia dificilisimo. Alta ademas significa
 * patas mas estiradas (rodillas fuertes) y menos alcance horizontal, o sea
 * pasos cortos — que es justo lo que el juego original premia.
 *
 * Es la clave del andar. Si la pata solo apuntara al punto donde piso, la IK
 * acompaniaria la caida de la cadera pidiendo cada vez mas rodilla y la
 * criatura se desinflaria hasta el piso. Y si en cambio se la obligara a estar
 * siempre estirada, el cuerpo tendria que TREPAR el arco del pendulo en cada
 * paso: hay un piso de velocidad por debajo del cual no lo pasa, y a ritmo
 * tranquilo el bicho se queda meciendose en el lugar sin avanzar (medido: con
 * toques cada 600 ms recorria 1 m en 7 pasos).
 *
 * Sosteniendo una altura fija la cadera viaja derecho: no hay barrera de
 * energia que pasar, el ritmo del jugador manda la velocidad y lo que te mata
 * es quedarte largo — cuando `hypot(dx, altura)` no entra en la pata, la IK se
 * queda corta, la cadera se viene abajo y la rodilla toca el piso.
 */
export const STANCE_HIP_HEIGHT = 2.31;
/**
 * Altura de cadera PARADA, antes del primer paso. Mas alta que la de marcha a
 * proposito: con los pies juntos la pata tiene que acortarse hasta la altura de
 * cadera, y a 2.10 sobre patas de 2.72 eso son 78 grados de rodilla — su
 * posicion mas debil. Asi la criatura arranca erguida, que ademas es como se
 * para alguien, y se agacha al empezar a caminar.
 */
export const STAND_HIP_HEIGHT = 2.31;
// (Igual a la de marcha: ver el comentario de STANCE_HIP_HEIGHT.)
/** Con que rapidez se pasa de una altura a la otra (1/s). */
export const HIP_SETTLE_RATE = 4;
/**
 * Cuanto puede "cavar" el objetivo del pie por debajo del piso. Cuando la
 * cadera se hunde, el objetivo queda bajo tierra y la pata empuja para
 * recuperar la altura; sin este tope el empuje crece sin limite y la pata
 * actua de catapulta (medido: el torso salia a 9 m de altura y a 17 m/s).
 */
export const STANCE_MAX_DIG = 0.22;
/**
 * Extension de cadera de la pata de apoyo, en radianes: es la propulsion
 * principal del andar, como en un cuerpo real. Escala con la carga del boton,
 * asi que una trancada larga tambien empuja mas.
 */
export const STANCE_DRIVE = 0.28;
/**
 * Deficit de altura de cadera (metros) entre el que la pata empieza a perder
 * fuerza para recuperarla y el que ya casi no puede. Ver `driveStance`.
 */
export const LIFT_SOFT = 0.35;
export const LIFT_LOST = 0.95;
/** Extension de cadera de la pata de apoyo, en radianes: es la propulsion. */
/** Si el zapato se aleja mas que esto de su punto de apoyo, se re-ancla. */
export const PLANT_SLIP_MAX = 0.3;
/** Cuantos subpasos se adelanta la cadera al calcular la IK de apoyo. */
/** A partir de cuanto atras (metros) la pata de apoyo empieza a frenar. */
export const STANCE_BRAKE_FROM = 1.0;
/** Dureza de ese freno, en N por metro de exceso. */
export const STANCE_BRAKE_K = 0;

/** Cuanta fuerza le queda a una pata que ya no llega al piso (ver driveStance). */
export const OVEREXTEND_FALLOFF = 0.12;

/** Pata que se BALANCEA: fuerte y rapida, tiene que llegar adelante del centro. */
export const HIP_SWING_STIFFNESS = 12000;
export const HIP_SWING_DAMPING = 460;
/** Duracion del balanceo en segundos. */
export const SWING_TIME = 0.28;

/**
 * ------------------------------------------------------------------------
 * Control de la marcha: pendulo invertido + PID (ver `balance.ts`).
 * ------------------------------------------------------------------------
 *
 * Estas cinco constantes reemplazan a media docena de perillas sueltas que
 * habia antes (zancada fija, empujon por paso, sesgo de cadera, estiramiento
 * del paso cuando llegabas tarde). Ahora la zancada y la propulsion SALEN DEL
 * ESTADO del cuerpo; lo unico que queda para elegir es cuanto empuje se quiere.
 */

/**
 * Cuanto MAS CERCA del cuerpo que el punto de captura se planta el pie, en
 * metros. Plantar justo en el punto de captura frena al bicho en seco;
 * plantar corto deja que siga volcando hacia adelante. O sea: esta constante
 * es "cuanta ganas de seguir caminando" y nada mas.
 */
export const CAPTURE_SHORTFALL = 0.25;
/**
 * Parte CONSTANTE del adelanto: cuanto se planta corto pase lo que pase. Es lo
 * que mantiene la marcha viva a velocidad de crucero, donde el termino que
 * decae con la velocidad ya no aporta nada.
 */
export const SHORTFALL_BASE = 0.34;

/**
 * Minimo adelanto del pie respecto del CENTRO DE MASA, en metros. Es el piso
 * que impide que un paso aterrice detras del cuerpo (pasa en el primer paso,
 * con velocidad cero, donde el punto de captura coincide con el centro de
 * masa). Chico a proposito: desde parado se da un pasito corto justo delante
 * del cuerpo, que es lo que uno hace, y en marcha manda el punto de captura.
 */
export const MIN_LEAD = 0.85;


/**
 * Ganancias del PID de tobillo. NO salen de probar numeros: salen del criterio
 * de estabilidad del propio LIP. Linealizado, el lazo cerrado queda
 *
 *     x'' + (kd/(m*h)) x' + (kp/(m*h) - w^2) x = (kp/(m*h)) x_ref
 *
 * o sea que es estable solo si `kp > m*h*w^2 = m*g` (con los numeros de esta
 * criatura, kp > 24) y queda criticamente amortiguado con
 * `kd = 2*m*h*sqrt(kp/(m*h) - w^2)` (~20). El integral se elige lento, a un
 * quinto de la frecuencia natural del lazo.
 *
 * Vale la pena saber que el tobillo satura casi siempre: con un zapato de
 * 36 cm el torque tope es ~3.7 N*m, o sea que el PID llega al limite con un
 * error de 8 cm de centro de masa. Es la conclusion correcta y no un defecto —
 * una criatura de patas de 3 m con pies chicos NO se equilibra con el tobillo,
 * se equilibra dando un paso. Por eso el peso del control esta en donde se
 * planta el pie y no en estas ganancias.
 */
export const ANKLE_PID_KP = 46;
export const ANKLE_PID_KI = 15;
export const ANKLE_PID_KD = 20;

/**
 * Fraccion del torque de tobillo teoricamente disponible que se usa. El tope
 * duro es `peso * medio zapato` (el centro de presion no puede salirse de la
 * huella); este margen deja el borde sin usar, como cualquier control real.
 */
export const ANKLE_TORQUE_MARGIN = 0.85;
/**
 * Fraccion de esa autoridad que el tobillo usa CAMINANDO. Parado usa toda (por
 * eso la criatura se sostiene quieta sola); caminando, apenas la mitad.
 *
 * **Es la perilla de dificultad del juego.** Con autoridad completa el tobillo
 * te salva casi cualquier error de tiempo y caminar deja de tener merito: se
 * sobrevive con cualquier cadencia. Recortandola, el equilibrio pasa a depender
 * de DONDE se planta el pie, que es lo unico que el jugador maneja. Medido, la
 * ventana de cadencias que perdonan pasa de casi todas a 2-3 de 6.
 */
export const ANKLE_WALK_SHARE = 0.55;

/**
 * Velocidad de marcha a la que apunta el despegue, en m/s. Es la unica
 * consigna de velocidad del sistema: el impulso de cada paso aporta la energia
 * orbital que falta para llegar ahi, asi que la criatura ni se frena sola ni
 * se acelera sin freno. Con patas de 2.7 m, 1.6 m/s es un paso tranquilo.
 */
export const WALK_SPEED = 3.1;

/**
 * Duracion del despegue, en segundos. Fija el tope de impulso que un tobillo
 * puede entregar: `peso * tiempo`. Es lo que impide que la ley de despegue se
 * realimente con la velocidad y convierta la caminata en saltos.
 */
export const PUSHOFF_TIME = 0.26;

/** Subpasos que se adelanta el predictor del LIP para compensar el atraso. */
export const CONTROL_LEAD_STEPS = 1.5;

/** Altura del arco que dibuja el zapato al pasar (para no barrer la arena). */
export const SWING_ARC = 0.42;
/** Fraccion del largo total que la IK puede pedir (nunca 100%: se traba). */
export const LEG_REACH_MAX = 0.995;
/**
 * Largo maximo de la pata durante el balanceo, como fraccion del total.
 *
 * **Tiene que ser mayor que `altura_de_cadera / largo_de_pata`.** Si no, la
 * pata no llega al piso: el objetivo del pie se recorta contra este tope en
 * todos los cuadros y el paso queda corto pase lo que pase. Fue exactamente lo
 * que paso al subir la cadera a 2.55 con este valor en 0.93 (2.53 m de pata
 * contra 2.555 m de altura): dar el primer paso se volvio imposible, y ninguna
 * perilla del control cambiaba nada porque todas terminaban aplastadas contra
 * este recorte.
 */
export const SWING_PLANT_REACH = 0.97;
/** A partir de este progreso, tocar el piso planta la pata antes de tiempo. */
export const SWING_PLANT_FROM = 0.88;

export const KNEE_LOCK_STIFFNESS = 26000;
export const KNEE_LOCK_DAMPING = 720;
export const KNEE_SWING_STIFFNESS = 12000;
export const KNEE_SWING_DAMPING = 460;

export const ANKLE_STIFFNESS = 22;
export const ANKLE_DAMPING = 2.5;
export const ANKLE_TARGET = 0.02;

/**
 * Envion del pie que despega (toe-off): sostiene el andar sin automatizarlo.
 * Es un IMPULSO en N*s sobre un zapato que pesa menos de 100 g, asi que el
 * numero es chico a proposito — con 2 el bicho pega una patada de mula y sale
 * disparado para atras.
 */
export const TOE_OFF_IMPULSE = 0.05;

/**
 * Envion del paso, aplicado al torso al despegar la pata: es el empuje que en
 * un cuerpo real da el tobillo de la pata que se va. Sin el, la criatura se
 * queda: cada aterrizaje come energia (el choque del zapato contra la arena) y
 * un caminante puramente pasivo sobre piso plano se frena en dos o tres pasos.
 * Es tambien lo que hace que el ritmo del jugador MANDE la velocidad, que es
 * de lo que vive el juego: tocas mas seguido, vas mas rapido, y con
 * `TORSO_DRAG` eso tiene un techo.
 */
export const STEP_PUSH_X = 2.2;
export const STEP_PUSH_Y = 0.45;

/**
 * Enderezado del torso (PD angular). Sin esto el bicho cae de trompa siempre;
 * con esto de mas, se para solo y el juego se juega solo. Es la perilla mas
 * sensible del archivo.
 */
export const TORSO_UPRIGHT_K = 300;
export const TORSO_UPRIGHT_D = 90;
export const TORSO_UPRIGHT_MAX_TORQUE = 25;


// ------------------------------------------------------------ pose inicial
export const START_X = 0;
/**
 * Separacion horizontal de los zapatos en la pose de arranque: los dos pies
 * juntos, no una zancada. No es cero por una razon de lectura, no de fisica:
 * con las dos patas exactamente superpuestas la criatura se ve de perfil como
 * si tuviera UNA sola pata. Un dedo de separacion alcanza para que se lean las
 * dos y sigue siendo, a ojo, estar parado con los pies juntos.
 */
export const START_FOOT_X = 0.18;

// ------------------------------------------------- deteccion de derrota
/**
 * Inclinacion del torso (radianes) entre la que las patas empiezan a perder
 * autoridad y la que ya no tienen nada que hacer. Ver `controlAuthority`.
 * Caminando sano la inclinacion vive en +-0.2.
 */
export const TILT_SOFT = 0.55;
export const TILT_LOST = 1.3;
/**
 * Altura a partir de la cual un zapato cuenta como "volando" para medir la
 * autoridad. Mas alta que `FOOT_GROUNDED_Y` a proposito: el pie que se
 * balancea sube medio metro en cada paso normal.
 */
export const FOOT_AIR_FATAL_Y = 0.55;
/** Segundos con los dos zapatos en el aire hasta perder toda la autoridad. */
export const AIRBORNE_LOST = 0.5;

/** Si el torso baja de esta altura, se dio por muerto aunque falle el evento. */
export const TORSO_FLOOR_Y = 1.05;
/**
 * Topes de seguridad del solver (ver `Creature.clampVelocities`). Son una red
 * para explosiones, NO un limitador de la marcha: el zapato que se balancea
 * viaja a punta de una pata de 2.7 m y pasa de 12 m/s sin que nada este mal.
 * Con el tope en 15 se recortaba medio balanceo (87 de 174 cuadros medidos) y
 * el paso salia mordido.
 */
export const MAX_BODY_SPEED = 45;
export const MAX_BODY_SPIN = 70;
/**
 * Salto maximo de velocidad de un cuerpo en UN subpaso (1/360 s). Es el freno
 * que de verdad corta las explosiones del solver: la marcha cambia de
 * velocidad de a poco y una explosion cambia de golpe.
 */
export const MAX_BODY_DV = 11;

/** Segundos que tarda en apagarse el motor de cada joint al morir. */
export const RAGDOLL_FADE = 0.09;
/** Rozamiento del cuerpo ya suelto: un muerto se desploma, no rebota. */
export const RAGDOLL_LIN_DAMP = 0.9;
export const RAGDOLL_ANG_DAMP = 3.2;
/**
 * Techo de velocidad mientras esta muerto (ver `clampVelocities`). Al ras de lo que da
 * una caida libre desde la altura de la cadera (sqrt(2*g*h) ~ 8 m/s): deja
 * caer natural y corta cualquier despegue. Con 12 ya no alcanza — medido, se
 * escapaban cuerpos 2.5 m para atras y el torso subia a 4.4 m.
 */
export const RAGDOLL_MAX_SPEED = 8.5;

/** Segundos de ragdoll antes de mostrar el game over. */
export const RAGDOLL_TIME = 1.15;

// ------------------------------------------------------------------ camara
export const CAM_FOV = 40;
export const CAM_DISTANCE = 10.5;
export const CAM_HEIGHT = 3.1;
/** La camara mira un poco adelante del bicho: se ve a donde vas. */
export const CAM_LOOK_AHEAD = 2.4;
export const CAM_LOOK_Y = 1.95;
export const CAM_LERP = 3.5;
/** Desplazamiento lateral en Z para que la perspectiva no sea de perfil puro. */
export const CAM_SIDE_Z = 0.0;

// ------------------------------------------------------------------ escena
export const SKY_TOP = 0xb9a8d6;
export const SKY_BOTTOM = 0xf6c9a8;
export const FOG_COLOR = 0xd9c3d1;
export const FOG_DENSITY = 0.014;
export const GROUND_COLOR = 0xe8d6bd;
export const GROUND_COLOR_ALT = 0xdfcbb0;
export const CREATURE_COLOR = 0xf2ede4;
export const LEG_COLOR = 0x3a3340;
export const MILESTONE_COLOR = 0xd97a5a;
export const RECORD_COLOR = 0xe8b04b;
export const DUST_COLOR = 0xd8c4a6;

// ---------------------------------------------------------------- terreno
export const SEGMENT_LENGTH = 24;
export const SEGMENT_COUNT = 9;
/** El collider del piso es uno solo y enorme: es plano e infinito, no hay que reciclarlo. */
export const GROUND_HALF_X = 300;
export const GROUND_HALF_Y = 1;
export const GROUND_HALF_Z = 40;

export const MILESTONE_EVERY = 10;
export const MILESTONE_POOL = 26;
/** Cuantos metros adelante del bicho se siguen dibujando hitos. */
export const MILESTONE_AHEAD = 130;
export const MILESTONE_BEHIND = 40;
