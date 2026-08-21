// Todo el tuning de La Escalera. Tocar aca antes que la logica.
//
// Geometria: la escalera sube en el plano YZ desde `RAMP_BOTTOM` (cerca de la
// camara, donde estan las puas) hasta `RAMP_TOP` (el fondo, donde estan las
// pantallas con las flechas). La posicion del jugador es un solo escalar
// `t` en [0, 1]: 1 = arriba del todo (a salvo), 0 = el pozo de puas.

export const BEST_SCORE_KEY = "la-escalera:best";

// --- Rampa ------------------------------------------------------------------
export const RAMP_BOTTOM: readonly [number, number, number] = [0, 0.6, 4.5];
export const RAMP_TOP: readonly [number, number, number] = [0, 6.0, -5.5];
export const RAMP_HALF_WIDTH = 1.75; // media anchura de la cinta de escalones
export const STEP_SPACING = 0.62; // distancia entre escalones a lo largo de la rampa
export const STEP_HEIGHT = 0.16; // espesor del escalon
export const STEP_NOSE = 0.07; // saliente claro del borde del escalon

// --- Jugador ----------------------------------------------------------------
export const START_T = 0.7; // arranca cerca de arriba, con margen para errar
// Tope de altura: la boca de la escalera es escenografia y el rack de pantallas
// cuelga delante de ella, asi que el muñeco no sube mas alla de aca (si no, la
// cabeza queda tapada por el cartel justo cuando mejor estas jugando).
export const MAX_HEIGHT = 0.8;
export const CLIMB_GAIN = 0.055; // cuanto sube por acierto
export const COMBO_BOOST = 0.06; // empujon extra al completar una racha
export const COMBO_STEP = 10; // aciertos seguidos por racha
export const SLIP_WRONG = 0.1; // cuanto resbala por apretar mal
export const SLIP_TIMEOUT = 0.075; // cuanto resbala por dejar vencer la flecha
export const STUMBLE_TIME = 0.55; // segundos de tropiezo (arrastre x2) tras un error
export const STUMBLE_DRIFT_MULT = 2.2;

// --- Arrastre de la escalera (siempre te tira hacia las puas) ---------------
export const DRIFT_BASE = 0.028; // t/s al empezar
export const DRIFT_PER_POINT = 0.0011; // sube por punto: aun jugando perfecto, cede
export const DRIFT_MAX = 0.3;
// La cinta se ve mas rapida que el arrastre real: la maquina tiene que leerse
// fuerte aunque el jugador este ganando terreno.
export const STEP_SCROLL_BASE = 0.14; // t/s de los escalones al empezar
export const STEP_SCROLL_PER_DRIFT = 2.4; // cuanto suma el arrastre a esa velocidad

// --- Ritmo de las flechas ---------------------------------------------------
export const BEAT_START = 1.5; // segundos de ventana por flecha al empezar
export const BEAT_MIN = 0.52;
export const BEAT_PER_POINT = 0.012; // cuanto se acorta la ventana por punto
// Una sola pantalla: no hay fila de "las que vienen". Se probo y la fila de
// flechas chicas arriba se llevaba la mirada justo cuando hay que reaccionar a
// la grande, ademas de ensuciar el borde superior del cuadro.
export const PROMPT_VISIBLE = 1;
export const MAX_SAME_DIR = 2; // no repetir la misma flecha mas de esto seguido

// --- Pozo de puas -----------------------------------------------------------
export const SPIKE_ROWS = 4;
export const SPIKE_PER_ROW = 9;
export const SPIKE_LEN = 1.15; // largo de la pua tipo (cada una varia un poco)
export const SPIKE_RADIUS = 0.19; // radio de la base del filo (sin la brida)
/** Piso del pozo (cara superior). Deriva del pie de la rampa. */
export const PIT_FLOOR_Y = RAMP_BOTTOM[1] - 1.45;
/** Altura a la que el cuerpo queda ensartado: la punta de las puas. */
export const SPIKE_TIP_Y = PIT_FLOOR_Y + SPIKE_LEN;
/** Donde arranca el pozo (z): antes de esto todavia es la plataforma. */
export const PIT_START_Z = RAMP_BOTTOM[2] + 1.0;

// --- Rack de pantallas ------------------------------------------------------
// El rack cuelga SOBRE el hueco, no al fondo: pegado al fondo la flecha quedaba
// del tamaño de una moneda y detras de las vigas. Es la unica informacion del
// juego, asi que se le da el tercio superior del cuadro entero.
export const SCREEN_SIZE = 2.1; // lado de la pantalla
export const SCREEN_Y = 8.7;
export const SCREEN_Z = 2.0;

// --- Camara -----------------------------------------------------------------
export const CAM_FOV = 50;
export const CAM_POS: readonly [number, number, number] = [0, 9.0, 17.0];
export const CAM_TARGET: readonly [number, number, number] = [0, 3.6, -1.0];
export const CAM_PORTRAIT_PUSH = 5.2; // cuanto se aleja la camara en vertical

// --- Paleta ("Descenso Pintado", ver DESIGN.md) -----------------------------
export const COLOR_VOID = 0x06070a; // el negro del que sale todo
export const COLOR_IRON = 0x3a3f49; // hierro de los escalones
export const COLOR_IRON_DARK = 0x22252c; // sombra del hierro, estructura
export const COLOR_IRON_EDGE = 0x8d94a2; // filo frio del escalon / de la pua
export const COLOR_RUBBER = 0x14161b; // pasamanos, goma
export const COLOR_STONE = 0x191a22; // muros del hueco
export const COLOR_BONE = 0xe8e2d0; // luz de servicio, glifos de flecha
export const COLOR_EMBER = 0xff7a2a; // lamparas de aviso (el unico calor)
export const COLOR_EMBER_DEEP = 0xb1471a;
export const COLOR_RUBY = 0xc41530; // peligro: puas, error, el pozo
export const COLOR_GOLD = 0xc9a24a; // oro gastado: acentos chicos, textos
export const COLOR_GOLD_DEEP = 0x5d4520; // el mismo oro, ya sucio: chapas grandes
export const COLOR_SKIN = 0xb8794f;
export const COLOR_SUIT = 0x2a3550; // mameluco del obrero (azul apagado)
export const COLOR_SUIT_DARK = 0x18203a;
export const COLOR_HELMET = 0xd8a12c; // casco: la unica nota saturada del muñeco
export const COLOR_STEEL = 0x6b727e; // inoxidable de los faldones (brillo de local)
export const COLOR_SAFETY = 0xb98b1e; // amarillo de seguridad: bordes de escalon y peines
export const COLOR_GLASS = 0x5d7690; // balaustrada de vidrio (apenas azulada)
export const COLOR_BLOOD = 0x8e0a16; // sangre fresca
export const COLOR_BLOOD_DARK = 0x4a0209; // sangre encharcada / seca

// Tinte ambiente: cada TINT_PERIOD puntos el hueco se pone un paso mas raro,
// siempre dentro del registro casi-negro (nunca mas alegre).
export const TINT_CYCLE = [0x0a0b14, 0x120a10, 0x090f12, 0x0e0a18];
export const TINT_PERIOD = 15;
