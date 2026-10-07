/**
 * El fraile cartografo: un dibujo de margen, al estilo de Fra Mauro, que reacciona
 * a cada respuesta. Es un SVG a tinta sepia (sin color: la bandera es lo unico a
 * todo color de la hoja, ver DESIGN.md) armado por partes —cabeza, cejas, ojos,
 * bocas, brazos, sudor, chispas, Zzz— y cada humor es una clase en la raiz que el
 * CSS traduce en que parte se ve y como se mueve. Sin texto ni globos: solo gestos.
 */

export type FriarMood = "idle" | "correct" | "cheer" | "wrong" | "timeout" | "sleep";

const MOODS: FriarMood[] = ["idle", "correct", "cheer", "wrong", "timeout", "sleep"];

/** Rizos del cerquillo de la tonsura, sobre la curva que cruza la frente. */
const CURLS: [number, number][] = [
  [68, 89], [69, 81], [72, 74], [78, 69], [85, 66], [92, 65], [100, 64.5],
  [108, 65], [115, 66], [122, 69], [128, 74], [131, 81], [132, 89],
];

const SVG = `
<svg class="fq-friar__svg" viewBox="0 0 200 222" aria-hidden="true">
  <defs>
    <pattern id="fq-hatch" width="3.2" height="3.2" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <line x1="0" y1="0" x2="0" y2="3.2" class="hatch-line"/>
    </pattern>
    <pattern id="fq-hatch-dense" width="2.2" height="2.2" patternUnits="userSpaceOnUse" patternTransform="rotate(-35)">
      <line x1="0" y1="0" x2="0" y2="2.2" class="hatch-line"/>
    </pattern>
  </defs>

  <g class="f-figure">
    <g class="f-torso">
      <!-- Habito: la panza asoma por encima del atril -->
      <path class="f-robe" d="M24 178 C20 134 44 114 72 111 L128 111 C156 114 180 134 176 178 Z"/>
      <path class="f-shade" d="M24 178 C20 134 44 114 72 111 L76 117 C54 128 44 150 46 178 Z"/>
      <path class="f-shade" d="M176 178 C180 134 156 114 128 111 L124 117 C146 128 156 150 154 178 Z"/>
      <path class="f-line" d="M100 128 L100 160"/>
      <!-- Cordon con nudos -->
      <path class="f-rope" d="M34 160 Q100 174 166 160"/>
      <path class="f-rope" d="M120 166 Q122 174 119 182"/>
      <circle class="f-knot" cx="120.5" cy="173" r="2.2"/>
    </g>

    <!-- Capucha caida alrededor del cuello -->
    <path class="f-cowl" d="M66 110 Q100 142 134 110 L144 122 Q100 156 56 122 Z"/>
    <path class="f-shade" d="M60 120 Q100 150 140 120 L144 122 Q100 156 56 122 Z"/>

    <g class="f-head">
      <circle class="f-skin" cx="65" cy="93" r="6.5"/>
      <circle class="f-skin" cx="135" cy="93" r="6.5"/>
      <ellipse class="f-skin" cx="100" cy="88" rx="35" ry="33"/>
      <!-- Papada -->
      <path class="f-line" d="M84 117 Q100 127 116 117"/>
      <!-- Coronilla rasurada con su brillo -->
      <path class="f-shine" d="M90 58 Q97 55 104 56"/>
      <g class="f-hair">
        ${CURLS.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="4.3"/>`).join("")}
      </g>

      <g class="f-brows">
        <path class="f-brow f-brow--l" d="M80.5 80 L94 77.5"/>
        <path class="f-brow f-brow--r" d="M106 77.5 L119.5 80"/>
      </g>

      <g class="f-eyes f-eyes--open">
        <circle class="f-pupil" cx="88" cy="90" r="3"/>
        <circle class="f-pupil" cx="112" cy="90" r="3"/>
      </g>
      <g class="f-eyes f-eyes--happy">
        <path class="f-line f-line--bold" d="M83 92 Q88 85 93 92"/>
        <path class="f-line f-line--bold" d="M107 92 Q112 85 117 92"/>
      </g>
      <g class="f-eyes f-eyes--closed">
        <path class="f-line f-line--bold" d="M83 90 Q88 94 93 90"/>
        <path class="f-line f-line--bold" d="M107 90 Q112 94 117 90"/>
      </g>

      <!-- Anteojos de remache, el invento de moda -->
      <g class="f-specs">
        <circle cx="88" cy="90" r="8.5"/>
        <circle cx="112" cy="90" r="8.5"/>
        <path d="M96.5 89 Q100 86 103.5 89"/>
      </g>

      <circle class="f-cheek" cx="78" cy="104" r="6"/>
      <circle class="f-cheek" cx="122" cy="104" r="6"/>
      <ellipse class="f-nose" cx="100" cy="100" rx="6" ry="5"/>

      <path class="f-mouth f-mouth--neutral" d="M92 111 Q100 114 108 111"/>
      <path class="f-mouth f-mouth--smile" d="M88 108 Q100 121 112 108"/>
      <path class="f-mouth f-mouth--grin f-fill-ink" d="M87 107 Q100 108 113 107 Q111 122 100 122 Q89 122 87 107 Z"/>
      <path class="f-mouth f-mouth--frown" d="M91 115 Q100 108 109 115"/>
      <ellipse class="f-mouth f-mouth--o f-fill-ink" cx="100" cy="113" rx="3.4" ry="4.2"/>

      <path class="f-sweat" d="M138 70 Q134 77 136 80 Q138 83 140.5 80 Q142 77 138 70 Z"/>
    </g>

  </g>

  <!-- Atril con el libro abierto y el tintero -->
  <g class="f-desk">
    <path class="f-wood" d="M4 175 L196 167 L196 222 L4 222 Z"/>
    <path class="f-wood-shade" d="M4 186 L196 178 L196 222 L4 222 Z"/>
    <path class="f-line" d="M4 175 L196 167"/>
    <path class="f-page" d="M54 171 L100 175 L100 160 L57 156 Z"/>
    <path class="f-page" d="M100 175 L146 169 L143 154 L100 160 Z"/>
    <path class="f-line f-line--thin" d="M62 160 L94 163 M62 164 L90 166.5 M106 163 L138 159 M108 167 L132 164"/>
    <path class="f-line f-line--thin" d="M64 168 Q74 162 84 168"/>
    <path class="f-ink" d="M160 166 L176 165.5 L175 154 L161 154.5 Z"/>
    <path class="f-ink" d="M164 154.5 L164 151 L172 150.8 L172 154.2 Z"/>
  </g>

  <!-- Brazo izquierdo: descansa en el libro; con el error se tapa la cara -->
  <g class="f-arm f-arm--l">
    <path class="f-robe" d="M54 122 C45 137 51 156 63 163 L83 157 C79 142 73 129 68 120 Z"/>
    <path class="f-shade" d="M54 122 C45 137 51 156 63 163 L68 161 C58 150 56 136 60 124 Z"/>
    <ellipse class="f-skin" cx="75" cy="159" rx="8.5" ry="6"/>
    <path class="f-line" d="M71 156 L72 161 M75 155.5 L76 161 M79 156 L79.5 161"/>
  </g>

  <!-- Brazo derecho con la pluma: escribe, y la levanta con el acierto -->
  <g class="f-arm f-arm--r">
    <path class="f-robe" d="M146 122 C155 137 149 156 137 163 L117 157 C121 142 127 129 132 120 Z"/>
    <path class="f-shade" d="M146 122 C155 137 149 156 137 163 L132 161 C142 150 144 136 140 124 Z"/>
    <path class="f-quill-shaft" d="M122 161 L152 106"/>
    <path class="f-quill" d="M138 135 C142 120 150 108 157 100 C155 112 150 124 141 134 Z"/>
    <path class="f-line f-line--thin" d="M141 131 L151 112"/>
    <ellipse class="f-skin" cx="125" cy="159" rx="8.5" ry="6"/>
    <path class="f-line" d="M121 156 L120.5 161 M125 155.5 L124 161 M129 156 L128 161"/>
  </g>

  <g class="f-sparks">
    <path d="M40 60 L40 72 M34 66 L46 66"/>
    <path d="M162 54 L162 64 M157 59 L167 59"/>
    <path d="M30 100 L37 107 M37 100 L30 107"/>
    <path d="M168 92 L174 98 M174 92 L168 98"/>
  </g>

  <g class="f-zzz">
    <text x="140" y="56">z</text>
    <text x="150" y="44">z</text>
    <text x="162" y="30">Z</text>
  </g>
</svg>`;

export class Friar {
  readonly el: HTMLDivElement;
  private mood: FriarMood = "idle";

  constructor() {
    this.el = document.createElement("div");
    this.el.className = "fq-friar is-idle";
    this.el.innerHTML = SVG;
  }

  setMood(mood: FriarMood): void {
    if (mood === this.mood) {
      // Repetir el mismo humor (dos aciertos seguidos) reinicia su animacion.
      if (mood === "idle" || mood === "sleep") return;
      this.el.classList.remove(`is-${mood}`);
      void this.el.offsetWidth;
      this.el.classList.add(`is-${mood}`);
      return;
    }
    for (const m of MOODS) this.el.classList.remove(`is-${m}`);
    this.el.classList.add(`is-${mood}`);
    this.mood = mood;
  }

  /** El reloj entro en el ultimo segundo y medio: transpira. Solo se ve pensando. */
  setUrgent(urgent: boolean): void {
    this.el.classList.toggle("is-urgent", urgent);
  }
}
