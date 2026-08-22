/**
 * Modelo de equilibrio: Pendulo Invertido Lineal (LIP) + PID.
 *
 * Es la capa que DECIDE. Antes de esto la marcha se sostenia con un monton de
 * reglas sueltas (una zancada fija, un empujon por paso, un sesgo de cadera,
 * factores de autoridad); cada una tapaba el agujero de la anterior y ninguna
 * sabia nada del estado real del cuerpo. Aca hay un solo modelo, ceirrado y
 * deterministico, del que salen las dos unicas decisiones que importan:
 *
 *  - **donde plantar el proximo pie** -> punto de captura (`capturePoint`);
 *  - **cuanto torque poner en la pata de apoyo** -> PID sobre el desplazamiento
 *    del centro de masa, saturado por el tamano del zapato.
 *
 * El LIP es la aproximacion clasica de la marcha bipeda: toda la masa
 * concentrada en el centro de masa, a altura constante `h`, pivotando sobre el
 * pie apoyado. Su dinamica es lineal y no hace falta resolverla numericamente
 * para saber lo importante:
 *
 *     x'' = w^2 * x        con     w = sqrt(g / h)
 *
 * Lo valioso de que sea lineal es que tiene una integral de movimiento y un
 * punto de captura en forma cerrada, o sea que el controlador puede ver el
 * futuro sin simularlo.
 */

/**
 * Estado del pendulo invertido respecto del pie de apoyo.
 *
 * Se integra con **Euler simplectico** (primero la velocidad con la
 * aceleracion actual, despues la posicion con la velocidad YA actualizada).
 * Con Euler explicito el pendulo invertido gana energia sola en cada paso y el
 * predictor termina prometiendo velocidades que el cuerpo real nunca tiene;
 * el simplectico conserva el volumen de fase y el error se queda acotado.
 */
export class InvertedPendulum {
  /** Desplazamiento horizontal del centro de masa respecto del pie. */
  x = 0;
  /** Velocidad horizontal del centro de masa. */
  v = 0;
  /** Altura del centro de masa sobre el pie. */
  h = 1;
  /** Frecuencia natural, sqrt(g/h). */
  omega = 1;

  private readonly gravity: number;

  constructor(gravity: number) {
    this.gravity = gravity;
  }

  /** Vuelca el estado real medido del cuerpo al modelo. */
  measure(comX: number, comY: number, comVx: number, footX: number, footY: number): void {
    this.x = comX - footX;
    this.v = comVx;
    this.h = Math.max(0.25, comY - footY);
    this.omega = Math.sqrt(this.gravity / this.h);
  }

  /** Un paso de Euler simplectico. Predice sin tocar el cuerpo real. */
  advance(dt: number): void {
    this.v += this.omega * this.omega * this.x * dt;
    this.x += this.v * dt;
  }

  /** Estado predicho `dt` adelante, sin modificar el actual. */
  predict(dt: number): { x: number; v: number } {
    const w2 = this.omega * this.omega;
    const v = this.v + w2 * this.x * dt;
    return { x: this.x + v * dt, v };
  }

  /**
   * Punto de captura: adonde habria que plantar el pie para quedar parado.
   *
   * Es EL numero de la marcha bipeda. Sale de la solucion cerrada del LIP:
   * la parte inestable de la dinamica es `x + v/w`, asi que plantar ahi anula
   * el modo divergente y el cuerpo se frena. Plantar mas CERCA deja que el
   * cuerpo siga volcando hacia adelante — o sea que seguir caminando es
   * plantar corto, a proposito, y por eso la zancada sale sola del estado en
   * vez de ser una constante que hay que adivinar.
   */
  capturePoint(): number {
    return this.x + this.v / this.omega;
  }

  /**
   * Energia orbital del LIP. Positiva: el centro de masa pasa por encima del
   * pie y sigue. Negativa: se queda corto y se vuelve para atras. Cero: llega
   * justo arriba y se queda. Es la forma exacta de preguntar "¿este paso
   * sale?" sin simular nada.
   */
  orbitalEnergy(): number {
    return 0.5 * this.v * this.v - 0.5 * this.omega * this.omega * this.x * this.x;
  }
}

/**
 * PID clasico con las dos precauciones de siempre:
 *
 * - **derivada sobre la medida**, no sobre el error, para que un cambio de
 *   consigna no pegue un pico de torque;
 * - **anti-windup por saturacion**: el integrador solo acumula si la salida no
 *   esta pegada al tope. Sin eso, en cuanto la pata satura (que en este juego
 *   es todo el tiempo: el tope de torque es el largo del zapato) el integrador
 *   se llena y despues tarda en soltar, con lo cual el bicho corrige tarde y
 *   siempre para el mismo lado.
 */
export class PID {
  private integral = 0;
  private lastMeasure = 0;
  private primed = false;

  private readonly kp: number;
  private readonly ki: number;
  private readonly kd: number;

  constructor(kp: number, ki: number, kd: number) {
    this.kp = kp;
    this.ki = ki;
    this.kd = kd;
  }

  reset(): void {
    this.integral = 0;
    this.lastMeasure = 0;
    this.primed = false;
  }

  /**
   * @param setpoint consigna
   * @param measure  medida actual
   * @param limit    saturacion simetrica de la salida
   */
  update(setpoint: number, measure: number, dt: number, limit: number): number {
    const error = setpoint - measure;

    const derivative = this.primed ? (measure - this.lastMeasure) / Math.max(1e-6, dt) : 0;
    this.lastMeasure = measure;
    this.primed = true;

    const unsaturated = this.kp * error + this.ki * this.integral - this.kd * derivative;
    const out = Math.max(-limit, Math.min(limit, unsaturated));

    // Anti-windup: solo integra si la salida no quedo contra el tope, o si el
    // error empuja de vuelta hacia adentro del rango.
    if (out === unsaturated || error * out < 0) this.integral += error * dt;

    return out;
  }
}
