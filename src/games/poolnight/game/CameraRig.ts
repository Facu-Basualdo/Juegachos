import * as THREE from "three";
import { BALL_R, CAM_FOV_AIM, CAM_FOV_PLAN } from "./constants";

/**
 * Las cuatro camaras (DESIGN.md: la camara es direccion, no encuadre):
 *  - plan: cenital inclinada, la mesa SIEMPRE entera. En un celular vertical rota 90 grados
 *    para que el eje largo de la mesa siga el eje largo de la pantalla.
 *  - aim: baja detras de la blanca, mirando la linea de tiro (el "primera persona" bien
 *    usado: un modo, no la vista base).
 *  - action: durante la jugada, un poco mas cerca y siguiendo el centro de lo que se mueve.
 *  - spectator: lateral y suave, tipo transmision, mientras tira otro.
 * Todas las transiciones tienen inercia (suavizado exponencial): jamas un corte seco.
 */

export type CamMode = "plan" | "aim" | "action" | "spectator";

export interface CamContext {
  aspect: number;
  /** La blanca, y hacia donde se apunta (para la camara baja). */
  cueX: number;
  cueZ: number;
  aimAngle: number;
  /** Centro de lo que se mueve (camara de accion). */
  focusX: number;
  focusZ: number;
  /** Reloj en segundos (la deriva lenta del espectador). */
  time: number;
  /** Inclinacion del taco (rad), para la camara baja. */
  cueElevation: number;
}

const PLAN_EL = (68 * Math.PI) / 180;
/** Camara de la bola: cuanto atras de la blanca (medido sobre el taco) y cuanto por encima de su eje. */
const AIM_BACK = 0.85;
const AIM_ABOVE = 0.14;
/** Cuanto por debajo del centro de la pantalla queda la blanca en la camara de la bola. */
const AIM_BALL_BELOW = (11 * Math.PI) / 180;

export class CameraRig {
  mode: CamMode = "plan";
  private readonly camera: THREE.PerspectiveCamera;
  private readonly look = new THREE.Vector3();
  private readonly targetPos = new THREE.Vector3();
  private readonly targetLook = new THREE.Vector3();
  private targetFov = CAM_FOV_PLAN;
  private ready = false;
  /** Hacia donde mira la camara baja: sigue a la mira con inercia en vez de saltar con ella. */
  private yaw = 0;
  /** La inclinacion del taco, suavizada: la camara baja va siempre por encima de el. */
  private elev = 0.1;

  constructor(camera: THREE.PerspectiveCamera) {
    this.camera = camera;
  }

  setMode(mode: CamMode, aimAngle = 0, cueElevation = 0.1): void {
    // Al entrar en la camara baja parte ya mirando hacia la mira (sin barrer desde un angulo viejo).
    if (mode === "aim" && this.mode !== "aim") {
      this.yaw = aimAngle;
      this.elev = cueElevation;
    }
    this.mode = mode;
  }

  /** True si la camara esta en un vuelo largo (para no teletransportarla al arrancar). */
  update(dt: number, ctx: CamContext): void {
    this.computeTarget(ctx, dt);
    if (!this.ready) {
      // Primer cuadro: se parte ya en la pose objetivo, sin viaje desde el origen.
      this.camera.position.copy(this.targetPos);
      this.look.copy(this.targetLook);
      this.camera.fov = this.targetFov;
      this.ready = true;
    } else {
      // En el vuelo de una camara a otra, suave; con la baja ya en su lugar, pegada a la orbita (si
      // siguiera con el mismo suavizado cortaria por la cuerda del circulo al girar la mira).
      const settled = this.mode === "aim" && this.camera.position.distanceTo(this.targetPos) < 0.3;
      const k = 1 - Math.exp(-dt * (settled ? 18 : 4.2));
      this.camera.position.lerp(this.targetPos, k);
      this.look.lerp(this.targetLook, k);
      this.camera.fov += (this.targetFov - this.camera.fov) * k;
    }
    this.camera.lookAt(this.look);
    this.camera.updateProjectionMatrix();
  }

  private computeTarget(ctx: CamContext, dt: number): void {
    const portrait = ctx.aspect < 0.95;
    const tanHalf = Math.tan((CAM_FOV_PLAN * Math.PI) / 360);
    // La mesa entera con sus bandas: ~1.7 m de semiancho y ~0.95 m de semialto.
    const halfX = portrait ? 0.95 : 1.7;
    const halfY = portrait ? 1.7 : 0.95;
    const dist = Math.max(halfX / (tanHalf * ctx.aspect), halfY / tanHalf) * 1.08;
    const planX = portrait ? dist * Math.cos(PLAN_EL) : 0;
    const planZ = portrait ? 0 : dist * Math.cos(PLAN_EL);
    const planY = dist * Math.sin(PLAN_EL);

    switch (this.mode) {
      case "plan":
        this.targetPos.set(planX, planY, planZ);
        this.targetLook.set(0, 0, 0);
        this.targetFov = CAM_FOV_PLAN;
        break;
      case "aim": {
        // El yaw da la vuelta por el camino corto y con inercia: la camara ORBITA a la blanca en vez de
        // cruzar en linea recta (que era lo que la acercaba y alejaba "raro" al girar la mira).
        let diff = ctx.aimAngle - this.yaw;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        this.yaw += diff * (1 - Math.exp(-dt * 7));
        const dx = Math.cos(this.yaw);
        const dz = Math.sin(this.yaw);
        // Sobre el taco, como en los juegos de pool de verdad: centrada en la linea de tiro, apoyada
        // un poco por encima del eje del taco y a AIM_BACK de la blanca. Cuando el taco se levanta (la
        // blanca pegada a una banda) la camara sube con el, asi nunca lo atraviesa; con el taco bajo
        // queda baja y el taco entra desde abajo hasta la bola. La version "por encima del hombro"
        // la corria al costado: la linea de tiro quedaba torcida y, con el taco levantado, se le metia.
        this.elev += (ctx.cueElevation - this.elev) * (1 - Math.exp(-dt * 6));
        const along = AIM_BACK * Math.cos(this.elev);
        this.targetPos.set(ctx.cueX - dx * along, BALL_R + AIM_BACK * Math.sin(this.elev) + AIM_ABOVE, ctx.cueZ - dz * along);
        // Encuadre fijo: la vista apunta de forma que la blanca quede AIM_BALL_BELOW por debajo del
        // centro (con un punto de mira fijo en el paño quedaba cortada en el borde de abajo, y con el
        // taco levantado se iba de cuadro). Asi la mesa y el objetivo ocupan el resto de la pantalla.
        const toBall = Math.hypot(ctx.cueX - this.targetPos.x, ctx.cueZ - this.targetPos.z);
        const down = Math.atan2(this.targetPos.y - BALL_R, toBall);
        const pitch = Math.max(0, down - AIM_BALL_BELOW);
        this.targetLook.set(
          this.targetPos.x + dx * 2 * Math.cos(pitch),
          this.targetPos.y - 2 * Math.sin(pitch),
          this.targetPos.z + dz * 2 * Math.cos(pitch),
        );
        this.targetFov = CAM_FOV_AIM;
        break;
      }
      case "action":
        // Quieta y apenas mas cerca: la que perseguia el centro de las bolas en movimiento se
        // sacudia cada vez que una bola se frenaba o entraba a una tronera.
        this.targetPos.set(planX * 0.92, planY * 0.92, planZ * 0.92);
        this.targetLook.set(0, 0, 0);
        this.targetFov = CAM_FOV_PLAN;
        break;
      case "spectator": {
        const drift = Math.sin(ctx.time * 0.18) * 0.6;
        if (portrait) this.targetPos.set(1.7, 1.0, drift);
        else this.targetPos.set(drift, 0.95, 1.95);
        this.targetLook.set(0, 0.02, 0);
        this.targetFov = 44;
        break;
      }
    }
  }
}
