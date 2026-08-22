# Arquitectura de Simulación, Físicas e IA para Suite de Minijuegos Web (Three.js / Canvas 2D)
**Documento Técnico de Referencia:** `SIMULATION_ARCHITECTURE.md`  
**Autoría:** Principal Software Engineer & Lead Physics/AI Architect  
**Entorno de Ejecución:** V8 / JavaScript Engine (Single Threaded Web Workers & Main Thread Loop), TypeScript 5.x, Three.js (WebGL/WebGPU) & Canvas 2D Context.

---

## 1. Taxonomía de Métodos de Simulación

En el desarrollo de videojuegos para la web, la tasa de refresco objetivo de 60 Hz a 120 Hz impone un presupuesto de ejecución estricto de **8 ms a 16 ms por frame**, compartido entre renderizado, física, lógica de IA y garbage collection. A continuación se desglosan los paradigmas computacionales fundamentales para sistemas interactivos deterministas y de alto rendimiento.

```
                                    TAXONOMÍA DE SIMULACIÓN WEB
                                                 │
        ┌────────────────────────┬───────────────┴───────────────┬────────────────────────┐
        ▼                        ▼                               ▼                        ▼
[Control Continuo]      [Toma de Decisiones]           [Comportamiento Emergente]  [Búsqueda Discreta]
 ├─ Verlet / Euler       ├─ Behavior Trees              ├─ Craig Reynolds (Boids)   ├─ A* / Theta*
 ├─ Controladores PID    ├─ HFSM (Hierarchical FSM)     ├─ Flow Fields / Vector     ├─ Minimax + Alfa-Beta
 ├─ FABRIK / CCD (IK)    └─ Utility Systems / Reglas    └─ Autómatas Celulares      └─ MCTS (Select/Expand)
 └─ Inverted Pendulum/ZMP
```

---

### 1.1 Control Continuo y Simulación Física

#### A. Integración Numérica: Verlet vs. Symplectic Euler vs. Euler Explícito
*   **Euler Explícito ($x_{t+1} = x_t + v_t \Delta t;\; v_{t+1} = v_t + a_t \Delta t$):** Inestable e inaceptable para simulación de dinámicas con resortes o colisiones elásticas debido a la introducción artificial de energía en el sistema (divergencia exponencial).
*   **Euler Semi-implícito / Symplectic Euler ($v_{t+1} = v_t + a_t \Delta t;\; x_{t+1} = x_t + v_{t+1} \Delta t$):** Conserva el área en el espacio de fases (simpléctico). Es el estándar de la industria para cuerpos rígidos simples ($O(1)$ por cuerpo), con estabilidad superior a costo computacional nulo.
*   **Integración Verlet (Position-Based Dynamics):**
    $$x_{t+1} = 2x_t - x_{t-1} + a_t \Delta t^2$$
    No almacena velocidad explícitamente; esta se infiere a partir del desplazamiento histórico. Permite resolver restricciones geométricas complejas (cuerdas, telas, partículas unidas por distancia fija) mediante proyecciones de posición iterativas (Relaxation de Gauss-Seidel) sin acumular divergencia energética.

#### B. Controladores PID (Proporcional-Integral-Derivativo)
Mecanismo de realimentación para dirigir una variable física continua hacia un valor de consigna (*setpoint*):
$$u(t) = K_p e(t) + K_i \int_0^t e(\tau) d\tau + K_d \frac{de(t)}{dt}$$
*   **$K_p$ (Respuesta al error actual):** Determina la rigidez y fuerza restauradora.
*   **$K_i$ (Corrección del error acumulado):** Elimina el error de régimen permanente (ej. fricción estática o gravedad residual).
*   **$K_d$ (Amortiguamiento ante la velocidad del cambio):** Previene el sobreimpulso (*overshoot*) y oscilaciones parásitas.
*   **Aplicación en Web:** Suavizado de seguimiento de cámara crítica, estabilización horizontal de aerodeslizadores y servos de apuntado.

#### C. Cinemática Inversa (IK): FABRIK vs. CCD
*   **FABRIK (Forward And Backward Reaching Inverse Kinematics):** Método iterativo basado en posiciones en lugar de cálculo trigonométrico o matrices Jacobianas. Proyecta puntos hacia adelante desde el objetivo y hacia atrás desde la raíz. Convergencia en $O(k \cdot N)$ (donde $k \le 4$ iteraciones típicas y $N$ es el número de articulaciones). Computacionalmente óptimo para patas de criaturas procedurales y extremidades de personajes 2.5D.
*   **CCD (Cyclic Coordinate Descent):** Ajusta un ángulo a la vez desde el efector final hacia la base. Simple de restringir angularmente, pero propenso a configuraciones poco naturales.

#### D. Péndulo Invertido y Zero Moment Point (ZMP)
*   Modela la dinámica de equilibrio bípedo simplificando la masa corporal a un punto montado sobre una varilla sin masa.
*   El ZMP es el punto en el suelo donde el momento neto de las fuerzas inerciales y gravitacionales es cero. Si el ZMP permanece dentro del polígono de soporte de los pies, el personaje no colapsa. Esencial para plataformas físicas y *ragdolls* activos.

---

### 1.2 Toma de Decisiones y Comportamiento Reactivo

```
      BEHAVIOR TREE (Tick-driven)                 HIERARCHICAL FSM (State-driven)
             [Selector (?)]                                [ SUPER-STATE: COMBAT ]
             /            \                                ┌───────────────────┐
      [Sequence (→)]    [Patrol Action]                    │ Idle ──(target)─> │
       /          \                                        │ Attack <────────── │
  [Is Low HP?]  [Flee Action]                              └─────────┬─────────┘
                                                                     │ (health <= 0)
                                                                     ▼
                                                              [ STATE: DEAD ]
```

#### A. Behavior Trees (Árboles de Comportamiento)
Estructuras jerárquicas dirigidas por evaluación (*ticks*) periódicos.
*   **Nodos de Control:** `Selector` (Fallback: evalúa hijos hasta que uno retorne `SUCCESS`), `Sequence` (evalúa hasta que uno retorne `FAILURE`), `Parallel`.
*   **Nodos Hoja:** `Condition` (checks booleanos sin efectos secundarios), `Action` (mutaciones de estado).
*   **Ventajas en TypeScript:** Altamente modulares, desacoplados del render loop, fáciles de serializar en JSON y depurar en caliente (*hot-reload*).

#### B. Hierarchical Finite State Machines (HFSM)
Extensión de las FSMs clásicas que agrupa estados en super-estados jerárquicos.
*   Evita la explosión combinatoria de transiciones ($O(N^2)$ a $O(N)$) compartiendo transiciones comunes a nivel de super-estado (ej. el estado `Dead` anula cualquier sub-estado de `Combat`).
*   Ideal para el controlador de estados del jugador (*State Machine de Animación y Control*).

#### C. Sistemas Basados en Reglas y Utility AI
*   **Utility AI:** Asigna a cada acción posible una función matemática de utilidad $U \in [0, 1]$ evaluando variables normalizadas del entorno mediante curvas de respuesta (logísticas, polinómicas).
*   Selecciona la acción con $\max(U(a))$. Produce comportamientos fluidos y continuos, evitando el comportamiento binario y rígido de las FSMs tradicionales.

---

### 1.3 Comportamientos Emergentes y Sistemas Multi-Agente

#### A. Flocking / Boids (Craig Reynolds)
Comportamiento de enjambre generado por la superposición de tres fuerzas vectoriales locales:
1.  **Separación:** $F_{sep} = \sum_{j \in N} \frac{p_i - p_j}{\|p_i - p_j\|^2}$ (Evita el hacinamiento).
2.  **Alineación:** $F_{ali} = \left( \frac{1}{|N|} \sum_{j \in N} v_j \right) - v_i$ (Coincidencia de velocidad con vecinos).
3.  **Cohesión:** $F_{coh} = \left( \frac{1}{|N|} \sum_{j \in N} p_j \right) - p_i$ (Atracción hacia el centro de masa local).
*   *Optimización en V8:* Requiere particionamiento espacial (*Spatial Hashing* o *BVH*) para reducir la complejidad de búsqueda de vecinos de $O(N^2)$ a $O(N)$.

#### B. Autómatas Celulares
Sistemas discretos basados en grillas donde el estado de cada celda $S_{t+1}(x,y)$ es una función pura de su vecindad de Moore o Von Neumann en el tiempo $t$.
*   **Aplicaciones:** Propagación de fluidos en minijuegos tipo *Falling Sand*, propagación de fuego, generación procedural de cuevas (*cave generation*) en pre-cálculo.
*   **Implementación Web:** Estructurados en `Uint8Array` contiguos (*Flat Array Buffers*) para garantizar *cache locality* de CPU y evitar *allocations* dinámicas.

---

### 1.4 Búsqueda y Optimización Discreta

| Algoritmo | Dominio de Aplicación | Heurística / Función Objetivo | Complejidad Temporal | Complejidad Espacial |
| :--- | :--- | :--- | :--- | :--- |
| **A\*** | Pathfinding en grillas o grafos de navegación | $f(n) = g(n) + h(n)$ (Admisible y consistente) | $O(E) = O(b^d)$ | $O(V)$ |
| **Theta\*** | Pathfinding con cualquier ángulo (*Any-Angle*) | Evalúa línea de visión (LOS) con el ancestro del padre | $O(E \cdot \text{LOS\_cost})$ | $O(V)$ |
| **Minimax + $\alpha$-$\beta$** | Juegos por turnos determ., información perfecta | Minimax con poda de ramas subóptimas: $\alpha \ge \beta$ | $O(b^{d/2})$ (con ordenamiento óptimo) | $O(d)$ |
| **MCTS** | Juegos estocásticos o con espacio de estados masivo | UCT: $\bar{X}_j + 2 C_p \sqrt{\frac{\ln n}{n_j}}$ | Depende del presupuesto de tiempo | $O(\text{nodos visitados})$ |

---

## 2. Matriz de Decisión: Minijuegos vs. Método de Simulación

Esta matriz evalúa los arquetipos comunes de minijuegos web frente a las limitaciones de rendimiento del runtime JavaScript.

| Tipo de Minijuego | Mecánica Central | Método Primario Recomendado | Método Secundario / Híbrido | Por qué descartar Monte Carlo / Métodos Ingenuos |
| :--- | :--- | :--- | :--- | :--- |
| **Equilibrio Físico / Active Ragdoll** | Mantener balance sobre plataformas dinámicas ante fuerzas externas. | **Péndulo Invertido + Controlador PID** | **Integración Verlet** con restricciones de articulación (*distance constraints*). | **Monte Carlo falla:** El muestreo aleatorio en un espacio de control continuo $N$-dimensional es intratable en 16 ms. Introduce *jitter* estocástico y latencia temporal inaceptable. |
| **Esquiva Continua de Proyectiles (Bullet Hell / Dodge)** | Enjambre de proyectiles o enemigos buscando interceptar al jugador. | **Flocking (Separation + Target Seek)** optimizado con **Spatial Hash Grid**. | **Vector Flow Fields** calculados estáticamente o con refresco asíncrono. | **Monte Carlo falla:** Probar millones de trayectorias aleatorias en tiempo real satura el hilo principal de JS. Los métodos directos de gradiente/campo de fuerza son $O(1)$ por entidad. |
| **Saltos Reactivos / Endless Runner** | Detección de precipicios y cálculo de salto con timing perfecto para bots/IA. | **Cinemática Analítica Proyectil ($y = v_0 t - \frac{1}{2}gt^2$) + HFSM** | **Raycasting determinista predictivo** (*Look-ahead probing*). | **Monte Carlo falla:** Disparar simulaciones completas de saltos por ensayo y error consume ciclos innecesarios cuando existe una solución analítica exacta cerrada en $O(1)$. |
| **Juegos de Precisión / Dardos / Trayectorias** | IA enemiga o asistente de apuntado calculando fuerza y ángulo óptimo. | **Ecuación Balística Cuadrática Cerrada** | **Búsqueda Binaria / Gradiente Unidimensional** si hay fricción de aire (drag). | **Monte Carlo falla:** El *hit-or-miss random sampling* converge lentamente ($O(1/\sqrt{N})$), arriesgando tiros erráticos o caídas drásticas de frames. |
| **Apilado de Bloques (Stacker Físico)** | Evaluar estabilidad del apilamiento de piezas poligonales. | **Contact Manifolds + Impulse Resolution (Symplectic Euler)** | **Centro de Masa Proyectado** en Polígono de Soporte ($O(1)$ heurístico). | **Monte Carlo falla:** La física de contactos requiere resolución exacta de restricciones LCP (*Linear Complementarity Problem*). Muestrear estados aleatorios genera penetraciones y rebotes fantasmas. |
| **Juegos de Tablero / Puzzles Arcade (ej. Conecta 4, Tetris AI)** | Selección de jugada óptima bajo turnos o micro-pausas. | **Minimax con Poda $\alpha$-$\beta$ + Heurística de Tablero** | **MCTS** (solo si el factor de ramificación $b > 30$ y la función de evaluación no es lineal). | **Métodos Ingenuos fallan:** Búsqueda aleatoria pura o fuerza bruta sin poda desbordan la memoria (*Heap Allocation*) del navegador y bloquean la UI. |

---

## 3. Fichas Técnicas por Arquetipo de Juego

---

### 3.1 Arquetipo: Active Balance / Stabilizer (Péndulo Invertido + PID)

```
       [ Masa m (Centro de Gravedad) ]
                     o
                    / 
                   /  Longitud L, Ángulo θ
                  /  
     ============[ Carro Base ]=============
     ───────────────► Fuerza de Control u(t)
```

#### Formulación Matemática
Para estabilizar un personaje/objeto bípedo sobre una base móvil en una dimensión:
*   Error angular: $e(t) = \theta_{target} - \theta(t)$
*   Fuerza de corrección calculada en cada *tick* $\Delta t$:
    $$u(t) = K_p e(t) + K_i \int_0^t e(\tau) d\tau + K_d \frac{e(t) - e(t - \Delta t)}{\Delta t}$$
*   Aplicación de fuerza tangencial: $F_x = u(t) \cdot \cos(\theta)$.

#### Complejidad Computacional
*   **Temporal:** $O(1)$ por evaluación.
*   **Espacial:** $O(1)$ (almacena únicamente 3 variables de estado flotantes de 64 bits).

#### Implementación en TypeScript (Production-Ready)
```typescript
export interface PIDConfig {
  kp: number;
  ki: number;
  kd: number;
  minOutput: number;
  maxOutput: number;
  integralWindupLimit: number;
}

export class PIDController {
  private integral: number = 0;
  private lastError: number = 0;
  private isFirstRun: boolean = true;

  constructor(private readonly config: PIDConfig) {}

  public update(currentValue: number, targetValue: number, dt: number): number {
    if (dt <= 0) return 0;

    const error = targetValue - currentValue;

    // Término Proporcional
    const pTerm = this.config.kp * error;

    // Término Integral con anti-windup clamping
    this.integral += error * dt;
    this.integral = Math.max(
      -this.config.integralWindupLimit,
      Math.min(this.config.integralWindupLimit, this.integral)
    );
    const iTerm = this.config.ki * this.integral;

    // Término Derivativo con protección de arranque
    let dTerm = 0;
    if (!this.isFirstRun) {
      const derivative = (error - this.lastError) / dt;
      dTerm = this.config.kd * derivative;
    } else {
      this.isFirstRun = false;
    }

    this.lastError = error;

    // Señal de control sujeta a límites de actuador
    const output = pTerm + iTerm + dTerm;
    return Math.max(this.config.minOutput, Math.min(this.config.maxOutput, output));
  }

  public reset(): void {
    this.integral = 0;
    this.lastError = 0;
    this.isFirstRun = true;
  }
}
```

---

### 3.2 Arquetipo: Cinemática Inversa Procedural para Extremidades (FABRIK)

```
  Base (Fija) P0 ●─────────○ P1 ─────────○ P2 ─────────★ P3 Efector Final
                 │◄────────────────────────────────────┤
                                                       ▼
                                                 Objetivo (Target)
  Paso 1: Backward Reaching (Target -> Base)
  Paso 2: Forward Reaching (Base -> Target)
```

#### Formulación Lógica
Dados $N$ puntos $p_0, p_1, \dots, p_{n-1}$ con distancias rígidas $d_i = \|p_{i+1} - p_i\|$ y un objetivo $T$:
1.  Si $\|T - p_0\| > \sum d_i$, el objetivo es inalcanzable: estirar todos los segmentos en la recta que une $p_0$ y $T$.
2.  Si es alcanzable, iterar hasta que $\|p_{n-1} - T\| < \epsilon$ o alcanzar iteraciones máximas:
    *   **Backward Stage:** Asignar $p_{n-1} = T$. Para $i = n-2$ bajando a $0$, mover $p_i$ a lo largo del segmento $p_{i+1} \to p_i$ a distancia fija $d_i$.
    *   **Forward Stage:** Fijar $p_0$ en la base original. Para $i = 0$ subiendo a $n-2$, mover $p_{i+1}$ a lo largo del segmento $p_i \to p_{i+1}$ a distancia fija $d_i$.

#### Complejidad Computacional
*   **Temporal:** $O(k \cdot N)$ donde $k$ es el número de iteraciones (generalmente $k \le 5$) y $N$ el número de articulaciones.
*   **Espacial:** $O(N)$ para el buffer plano de coordenadas.

#### Implementación en TypeScript (Zero GC Optimization)
```typescript
export interface Vector2D {
  x: number;
  y: number;
}

export class FabrikChain2D {
  public readonly joints: Vector2D[];
  private readonly lengths: number[];
  private readonly totalLength: number;
  private readonly origin: Vector2D;

  constructor(base: Vector2D, segmentLengths: number[]) {
    this.origin = { ...base };
    this.lengths = [...segmentLengths];
    this.joints = new Array(segmentLengths.length + 1);

    this.joints[0] = { ...base };
    let accumulatedLength = 0;
    for (let i = 0; i < segmentLengths.length; i++) {
      accumulatedLength += segmentLengths[i];
      this.joints[i + 1] = { x: base.x + accumulatedLength, y: base.y };
    }
    this.totalLength = accumulatedLength;
  }

  public solve(target: Vector2D, maxIterations: number = 8, tolerance: number = 0.01): boolean {
    const n = this.joints.length;
    const dx = target.x - this.joints[0].x;
    const dy = target.y - this.joints[0].y;
    const distToTargetSq = dx * dx + dy * dy;

    // Caso: Inalcanzable
    if (distToTargetSq > this.totalLength * this.totalLength) {
      const dist = Math.sqrt(distToTargetSq);
      const invDist = 1 / dist;
      for (let i = 0; i < n - 1; i++) {
        const ratio = this.lengths[i] * invDist;
        this.joints[i + 1].x = this.joints[i].x + (target.x - this.joints[0].x) * ratio;
        this.joints[i + 1].y = this.joints[i].y + (target.y - this.joints[0].y) * ratio;
      }
      return false;
    }

    // Caso: Alcanzable (Iteraciones FABRIK)
    const tolSq = tolerance * tolerance;
    for (let iter = 0; iter < maxIterations; iter++) {
      const endIdx = n - 1;
      const endDx = this.joints[endIdx].x - target.x;
      const endDy = this.joints[endIdx].y - target.y;

      if (endDx * endDx + endDy * endDy <= tolSq) {
        return true;
      }

      // Backward Reaching
      this.joints[endIdx].x = target.x;
      this.joints[endIdx].y = target.y;
      for (let i = n - 2; i >= 0; i--) {
        const segDx = this.joints[i].x - this.joints[i + 1].x;
        const segDy = this.joints[i].y - this.joints[i + 1].y;
        const dist = Math.sqrt(segDx * segDx + segDy * segDy) || 0.0001;
        const lambda = this.lengths[i] / dist;
        this.joints[i].x = this.joints[i + 1].x + segDx * lambda;
        this.joints[i].y = this.joints[i + 1].y + segDy * lambda;
      }

      // Forward Reaching
      this.joints[0].x = this.origin.x;
      this.joints[0].y = this.origin.y;
      for (let i = 0; i < n - 1; i++) {
        const segDx = this.joints[i + 1].x - this.joints[i].x;
        const segDy = this.joints[i + 1].y - this.joints[i].y;
        const dist = Math.sqrt(segDx * segDx + segDy * segDy) || 0.0001;
        const lambda = this.lengths[i] / dist;
        this.joints[i + 1].x = this.joints[i].x + segDx * lambda;
        this.joints[i + 1].y = this.joints[i].y + segDy * lambda;
      }
    }

    return true;
  }
}
```

---

### 3.3 Arquetipo: Enjambres con Spatial Hash Grid (Flocking / Boids $O(N)$)

```
  Spatial Hash Map: Key = hash(floor(x / cellSize), floor(y / cellSize))
  ┌────────┬────────┬────────┐
  │ (0,2)  │ (1,2)  │ (2,2)  │
  ├────────┼────────┼────────┤
  │ (0,1)  │ Boid A ●──────► │  Radio de Vecindad:
  │        │        │ Boid B │  Solo consulta las 9 celdas adyacentes
  ├────────┼────────┼────────┤
  │ (0,0)  │ (1,0)  │ (2,0)  │
  └────────┴────────┴────────┘
```

#### Formulación de Complejidad
*   **Búsqueda Naive ($N^2$):** Cada boid comprueba a todos los demás agentes. Con $N = 1000 \implies 10^6$ operaciones/frame (inviable para JS).
*   **Spatial Hash Grid:** Particiona el espacio 2D en celdas de tamaño igual al radio de visión $R$. Cada boid solo consulta su celda y las 8 vecinas contiguas.
*   **Complejidad:** $O(N)$ temporal medio, $O(N)$ espacial.

#### Implementación en TypeScript (Optimizada para Memoria)
```typescript
export class SpatialHashGrid {
  private readonly cellSize: number;
  private readonly invCellSize: number;
  private readonly cells: Map<number, number[]> = new Map();

  constructor(cellSize: number) {
    this.cellSize = cellSize;
    this.invCellSize = 1.0 / cellSize;
  }

  private hash(cellX: number, cellY: number): number {
    // Hash pairing function para enteros positivos y negativos
    const a = (cellX >= 0 ? 2 * cellX : -2 * cellX - 1);
    const b = (cellY >= 0 ? 2 * cellY : -2 * cellY - 1);
    return ((a + b) * (a + b + 1) >> 1) + b;
  }

  public clear(): void {
    for (const bucket of this.cells.values()) {
      bucket.length = 0; // Reusar arrays para prevenir GC Pressure
    }
  }

  public insert(entityIndex: number, x: number, y: number): void {
    const cx = Math.floor(x * this.invCellSize);
    const cy = Math.floor(y * this.invCellSize);
    const key = this.hash(cx, cy);

    let bucket = this.cells.get(key);
    if (!bucket) {
      bucket = [];
      this.cells.set(key, bucket);
    }
    bucket.push(entityIndex);
  }

  public queryNeighbors(x: number, y: number, radius: number, outNeighbors: number[]): void {
    outNeighbors.length = 0;
    const minCx = Math.floor((x - radius) * this.invCellSize);
    const maxCx = Math.floor((x + radius) * this.invCellSize);
    const minCy = Math.floor((y - radius) * this.invCellSize);
    const maxCy = Math.floor((y + radius) * this.invCellSize);

    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cy = minCy; cy <= maxCy; cy++) {
        const key = this.hash(cx, cy);
        const bucket = this.cells.get(key);
        if (bucket) {
          for (let i = 0; i < bucket.length; i++) {
            outNeighbors.push(bucket[i]);
          }
        }
      }
    }
  }
}
```

---

### 3.4 Arquetipo: Árboles de Comportamiento Reactivos (Behavior Tree Engine)

#### Formulación Lógica
Un árbol de comportamiento evalúa periódicamente una jerarquía basada en estados de retorno:
*   `SUCCESS`: El nodo completó su objetivo con éxito.
*   `FAILURE`: El nodo falló en cumplir su condición o ejecutar su acción.
*   `RUNNING`: La acción se encuentra en progreso y requiere continuar en los subsiguientes frames.

#### Complejidad Computacional
*   **Temporal:** $O(D)$ donde $D$ es la profundidad del camino activo evaluado (típicamente $D \le 8$).
*   **Espacial:** $O(1)$ durante el tick (no genera allocations).

#### Implementación en TypeScript (Production-Ready)
```typescript
export enum NodeState {
  SUCCESS = 'SUCCESS',
  FAILURE = 'FAILURE',
  RUNNING = 'RUNNING'
}

export interface TickContext {
  readonly dt: number;
  readonly entityId: number;
  readonly blackboard: Map<string, any>;
}

export abstract class BTNode {
  public abstract tick(context: TickContext): NodeState;
}

// Compositor: Sequence (AND lógico)
export class SequenceNode extends BTNode {
  constructor(private readonly children: BTNode[]) {
    super();
  }

  public tick(context: TickContext): NodeState {
    for (const child of this.children) {
      const status = child.tick(context);
      if (status !== NodeState.SUCCESS) {
        return status; // Retorna RUNNING o FAILURE inmediatamente
      }
    }
    return NodeState.SUCCESS;
  }
}

// Compositor: Selector / Fallback (OR lógico)
export class SelectorNode extends BTNode {
  constructor(private readonly children: BTNode[]) {
    super();
  }

  public tick(context: TickContext): NodeState {
    for (const child of this.children) {
      const status = child.tick(context);
      if (status !== NodeState.FAILURE) {
        return status; // Retorna SUCCESS o RUNNING inmediatamente
      }
    }
    return NodeState.FAILURE;
  }
}

// Nodo Hoja: Acción
export class ActionNode extends BTNode {
  constructor(private readonly actionFn: (ctx: TickContext) => NodeState) {
    super();
  }

  public tick(context: TickContext): NodeState {
    return this.actionFn(context);
  }
}

// Nodo Hoja: Condición
export class ConditionNode extends BTNode {
  constructor(private readonly predicate: (ctx: TickContext) => boolean) {
    super();
  }

  public tick(context: TickContext): NodeState {
    return this.predicate(context) ? NodeState.SUCCESS : NodeState.FAILURE;
  }
}
```

---

## 4. Guía de Prompting Técnico para Asistentes de Código (LLMs)

Al delegar la generación de módulos de simulación física e IA a modelos de lenguaje grandes (LLMs), los prompts deben ser inequívocos para evitar implementaciones abstractas, dependencias de librerías externas o algoritmos estocásticos inadecuados (como muestreo Monte Carlo en contextos continuos).

### 4.1 Diccionario de Términos Clave y Directivas de Ingeniería

| Dominio | Directiva de Prompting / Keywords Obligatorias | Errores / Antipatrones a Vetar Explícitamente |
| :--- | :--- | :--- |
| **Simulación de Físicas** | `Symplectic Euler integration`, `Position-Based Dynamics (PBD)`, `Verlet constraint projection`, `Mass-Aggregate physics`, `Sub-stepping (fixed dt = 1/60s)`. | VETAR: `Explicit Euler`, `Monte Carlo Physics`, `Math.random() trajectory estimation`, `Dynamic allocations (new Vector3 inside loop)`. |
| **Control Continuo y Vuelo** | `Discrete PID Controller`, `Anti-Windup Clamping`, `Derivative Filter`, `Target Setpoint Tracking`, `Damped Harmonic Oscillator`. | VETAR: `Genetic algorithms in-frame`, `Reinforcement Learning inference on main thread without WebWorker`. |
| **Cinemática Inversa** | `FABRIK algorithm (Forward And Backward Reaching)`, `Tolerance-based convergence`, `Distance Constraint projection`. | VETAR: `Jacobian Transpose/Pseudoinverse matrix operations on CPU`, `Recursive CCD without iteration caps`. |
| **Sistemas de IA Reactiva** | `Tick-driven Behavior Tree`, `Composite Selector/Sequence`, `Hierarchical State Machine (HFSM)`, `Blackboard pattern`. | VETAR: `Deep nested switch-case without state pattern`, `Asynchronous promise chains inside 60Hz tick`. |
| **Enjambres y Agentes Multi-objeto** | `Spatial Hash Grid`, `Uniform Grid Partitioning`, `Reynolds Flocking (Separation, Cohesion, Alignment)`, `Bitwise Spatial Hashing`. | VETAR: `All-pairs O(N^2) neighbor checks`, `Array.filter / Array.map per frame`, `GC pressure via object instantiation`. |
| **Búsqueda Discreta** | `Alpha-Beta Pruning with Transposition Table`, `Iterative Deepening`, `Bitboard representation`, `Evaluation Heuristic`. | VETAR: `Unbounded MCTS rollouts`, `Memory allocation in recursion`, `Unconstrained minimax depth`. |

---

### 4.2 Plantilla Canónica de System Prompt para Generación de Módulos

```markdown
Eres un Ingeniero Principal de Motor de Videojuegos especializado en simulación web de alto rendimiento (TypeScript / Three.js / Canvas 2D).

REGLAS CRÍTICAS DE ARQUITECTURA Y RENDIMIENTO:
1. ZERO ALLOCATION EN EL LOOP CRÍTICO:
   - Está terminantemente prohibido usar `new`, `Array.push`, `Array.filter`, `Array.map`, `Object.assign` o desestructuración `{...}` dentro de cualquier método `update()`, `tick()` o `solve()`.
   - Toda la memoria de vectores, matrices y arrays debe ser pre-asignada en el constructor o inicializada estáticamente como `TypedArrays` (`Float32Array`, `Uint32Array`).

2. DETERMINISMO Y MODELADO MATEMÁTICO:
   - Prioriza soluciones en forma cerrada (ecuaciones analíticas, cinemática directa/inversa, integradores simplécticos).
   - NO utilices aproximaciones estocásticas (Monte Carlo) para problemas donde existe una solución de control continuo determinista (PID, LQR, PBD, FABRIK).

3. MODULARIDAD Y TIPO ESTRICTO:
   - Exporta interfaces limpias y clases fuertemente tipadas en TypeScript (versión 5+).
   - Desacopla la lógica matemática/física de cualquier API de renderizado (Three.js o Canvas 2D). La salida debe consistir en buffers numéricos o estructuras de estado desacopladas.

TAREA REQUERIDA:
Implementa el módulo de: [INSERTAR DOMINIO: ej. Active Ragdoll Stabilization con PID / FABRIK 2D / Spatial Grid Boids]
Parámetros de entrada esperados: [INSERTAR FIRMA DE DATOS]
Garantías de complejidad requeridas: Temporal [O(N) / O(1)], Espacial [O(1) runtime heap allocations].
```

---

## 5. Resumen de Recomendaciones Arquitectónicas

1. **Desacoplamiento Física-Render:** Ejecutar la física en un bucle de tiempo delta fijo acumulado (*Fixed Timestep with Accumulator*):
   $$\Delta t_{fixed} = \frac{1}{60} \text{ s}$$
   Interpolando el estado visual $(\alpha = \text{accumulator} / \Delta t)$ en el ciclo `requestAnimationFrame` para eliminar el *stuttering* visual sin comprometer la estabilidad física.
2. **Web Workers para Computación Pesada:** Si un minijuego requiere pathfinding complejo ($A^*$) sobre mapas gigantes o búsqueda combinatoria profunda (Minimax / MCTS para tablero), delegar la computación a un `Dedicated WebWorker` usando `ArrayBuffer` transferibles (`postMessage(buffer, [buffer])`) para mantener la interfaz a 60-120 FPS fluidos.
3. **Control de Memoria y Garbarge Collector:** El recolector de basura de los navegadores (V8 Scavenger / Mark-Sweep) es la causa número uno de caídas de frames (*micro-stutters*). El uso de pools de objetos (*Object Pooling*) y *Spatial Hash Grids* reusables es imperativo en todos los módulos de simulación.

---

## 6. Addenda: Lecciones de Campo (Patas Largas, 2026-08)

Esta sección se agregó después de implementar el primer juego del proyecto que
usa el arquetipo **Active Balance** de la sección 3.1 (Péndulo Invertido + PID)
sobre un motor de cuerpos rígidos real (Rapier). Todo lo que sigue son cosas que
costaron horas y que el documento base no cubre.

### 6.1 El contrato con el motor de físicas (la sección que más falta)

El documento razona sobre algoritmos, pero la mayor parte del tiempo perdido no
fue de algoritmia sino de **semántica de la API del motor**. Tres reglas duras:

1. **`addForce` / `addTorque` ACUMULAN entre pasos.** En Rapier (y en Bullet, y
   en PhysX) la fuerza agregada sigue aplicándose en cada `step()` hasta que se
   llama `resetForces()` / `resetTorques()`. Un controlador que corre en
   sub-pasos a 360 Hz y agrega su salida en cada uno **multiplica por el número
   de sub-pasos acumulados**. Medido: un PID que pedía 1 m/s² producía 50 m/s² y
   el personaje salía de parado a 5.8 m/s en 80 ms. El síntoma engañoso es que
   *todo el tuning deja de responder*: cada constante que tocás queda tapada por
   el factor de acumulación. **Resetear al principio de cada sub-paso, o usar
   `applyImpulse(F · dt)`.**
2. **Nunca congelar DOFs en cuerpos unidos por constraints.** Para un juego
   plano lo natural es bloquear Z y el pitch/roll de cada cuerpo. Un revolute
   joint tiene una fila de restricción sobre ese eje; si los dos cuerpos que une
   lo tienen congelado, la masa efectiva de esa fila es **cero** y el impulso
   diverge (posiciones de orden 1e9 en menos de diez sub-pasos). La solución es
   **proyectar después del `step()`** ("riel"): devolver Z, anular la velocidad
   en Z y quedarse solo con la parte del cuaternión que gira alrededor del eje
   del juego. No toca ninguna restricción y el error queda en 1e-9.
3. **No reescribir los límites de un joint en cada sub-paso.** Parece la forma
   natural de hacer un trinquete (por ejemplo una rodilla que puede estirarse
   pero no doblarse más). Destruye el *warm-starting* del solver: el joint deja
   de arrastrar el impulso del paso anterior y termina violándose bajo carga.
   Los límites se escriben **una vez por evento**, no por frame.

### 6.2 Las saturaciones salen de la física, no del tuning

La sección 1.1.D menciona ZMP y polígono de soporte pero no cierra el círculo:
**ahí es donde salen los valores de `minOutput` / `maxOutput` del PID de 3.1.**
No son perillas.

- **Torque de tobillo:** el centro de presión no puede salirse de la huella del
  pie, o sea `tau_max = peso · (largo_pie / 2)`. Con un pie de 36 cm sobre un
  cuerpo de 2 kg eso son ~3.7 N·m, o sea que el PID **satura con 8 cm de error
  de centro de masa**. Esa no es una limitación del diseño: es la conclusión
  correcta, y dice que un personaje de patas largas y pies chicos **no se
  equilibra con el tobillo, se equilibra dando un paso**. El peso del control
  tiene que estar en la colocación del pie.
- **Impulso de despegue:** `p_max = peso · duración_del_despegue`.

**Y ojo con dónde cae la reacción.** Un torque de tobillo modelado como par
entre tibia y zapato se lo come el zapato: 86 g con inercia de 0.001 kg·m²
contra 3.7 N·m son 3600 rad/s², el pie se vuelve una turbina y sus puntas salen
a 40 m/s. En un pie real esa reacción la absorbe el piso repartiendo la presión
bajo la planta. La forma correcta en un motor con pies chicos es aplicar el
**equivalente del LIP**: `F = −tau / h` sobre el centro de masa.

### 6.3 Falta el Punto de Captura (Capture Point / ICP)

La sección 1.1.D cubre péndulo invertido y ZMP, que contestan *"¿me caigo si no
muevo los pies?"*. Para cualquier personaje que **camina**, la pregunta útil es
*"¿dónde pongo el próximo pie?"*, y el LIP la contesta en forma cerrada:

    xi = x + v / w        con     w = sqrt(g / h)

Plantar en `xi` anula el modo divergente y el cuerpo queda parado. Plantar **más
cerca** deja que siga volcando: *seguir caminando es plantar corto a propósito*.
Es O(1), determinista, y reemplaza a cualquier zancada constante: la longitud
del paso pasa a salir del estado del cuerpo en vez de ser un número que hay que
adivinar. Además da el indicador de UI honesto, porque `xi / alcance_pata` es
literalmente *"¿todavía llego a frenar esto?"*.

Dos corolarios que no son obvios:

- **La ley de plantado tiene que saber frenar.** Con un adelanto fijo solo sabe
  acelerar, y hay un techo que la geometría impone y no se negocia:
  `alcance_horizontal / duración_del_balanceo`. Por encima de eso el pie
  *siempre* aterriza tarde. El adelanto debe decrecer con la velocidad.
- **El impulso de sostén no puede ser proporcional a la velocidad actual.** La
  fórmula de la marcha de compás (`m·v·tan(2a)`, devolver el choque del talón)
  es correcta para *sostener* pero tiene un problema de huevo y gallina: desde
  quieto da cero y el personaje no arranca nunca. Conviene formularlo como
  **déficit de energía orbital** contra una velocidad de marcha objetivo: se
  auto-limita y arranca desde cero.

### 6.4 Monte Carlo: vetado en el loop, obligatorio fuera de él

La matriz de la sección 2 dice "Monte Carlo falla" en todas las filas. Es
correcto **como controlador en tiempo real** y conviene matizarlo, porque el
muestreo aleatorio sí es la herramienta adecuada **offline, como banco de
pruebas**.

Corriendo la física sin renderizar (mucho más rápido que tiempo real) con
modelos de jugador aleatorizados (un metrónomo con jitter y un jugador reactivo
con tiempo de reacción gaussiano), unos cientos de episodios encontraron cuatro
defectos que jugando a mano no se veían, y cuantificaron cada arreglo. Las
métricas que valieron la pena:

- **distribución** de la puntuación (mediana / p75 / p90 / máximo), no el
  promedio;
- **partidas en cero** (el juego que no arranca);
- **episodios con algún cuerpo en el tope de velocidad**, normalizado por
  segundo jugado: es el detector de explosiones del solver;
- **metros por paso**, que delata cuando la distancia viene de un bug (un
  personaje con patas de 2.7 m que avanza 3.4 m por paso no está caminando,
  está volando);
- **gradiente de habilidad**: puntuación mediana por cadencia de input. Si es
  plana, el juego es azar disfrazado de destreza, y eso no se ve jugando.

O sea: **estocástico para VALIDAR, determinista para CONTROLAR.**

### 6.5 El patrón de capas que terminó funcionando

```
  [ MODELO ]      LIP + punto de captura + PID     -> decide (O(1), cerrado)
       |
       v
  [ MOTOR ]       constraints + contactos           -> ejecuta
       |
       v
  [ PROYECCION ]  riel, topes de velocidad          -> corrige lo que el motor
                                                       no garantiza
```

La regla: **el modelo nunca escribe posiciones, y la proyección nunca decide
nada.** Cuando esas dos capas se mezclan (heurísticas que empujan cuerpos
"porque queda bien") el sistema deja de ser depurable, que es exactamente donde
estaba este juego antes de la reescritura.

### 6.6 Correcciones menores al documento base

- **El PID de la sección 3.1 usa derivada sobre el ERROR.** La tabla de 4.1 pide
  `Derivative Filter`, pero derivar el error produce un pico de salida
  (*derivative kick*) cada vez que cambia la consigna. La forma estándar es
  **derivada sobre la medida**, con signo invertido.
- **El anti-windup por clamp del integrador es la forma débil.** Limitar
  `integral` a `integralWindupLimit` igual permite que el integrador llegue al
  tope y después tarde en soltar. La forma que funciona es **integración
  condicional**: acumular solo si la salida no quedó saturada, o si el error
  empuja de vuelta hacia adentro del rango. Con actuadores que saturan casi
  siempre (ver 6.2) la diferencia es enorme.
- **El `SpatialHashGrid` de 3.3 hace `bucket.push()`**, que la propia regla de
  4.2 veta. La versión sin allocations es el layout plano de *counting sort*: un
  `Int32Array` de inicios de celda más un `Int32Array` de índices.
