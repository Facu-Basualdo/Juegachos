/**
 * Verificacion del motor de reglas de Pool sin red:  npm run check:pool  (corre este y el
 * de la fisica). Escenarios con mesa armada a mano + partidas completas con un jugador
 * al azar. Sale con codigo 1 si algo falla.
 */
import { BALL_COUNT, BALL_R, HALF_L, HALF_W, V_MAX, type BallPos, type Shot } from "../src/games/pool-physics.js";
import { HEAD_SPOT, mulberry32 } from "../src/games/pool-rack.js";
import {
  HAND_BONUS_MS,
  IDLE_TURNS_TO_BOT,
  MATCH_CAP_MS,
  PoolError,
  PoolMatch,
  START_DELAY_MS,
  TURN_MS,
  formatFor,
  groupOf,
  type ShotOutcome,
  type Team,
} from "../src/games/pool-match.js";

let failures = 0;
let checks = 0;
function check(name: string, ok: boolean, detail = ""): void {
  checks++;
  if (!ok) failures++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? "  " + detail : ""}`);
}

function code(fn: () => unknown): string {
  try {
    fn();
    return "";
  } catch (e) {
    return e instanceof PoolError ? e.code : `OTRO:${String(e)}`;
  }
}

function table(...placed: [number, number, number][]): BallPos[] {
  const s: BallPos[] = [];
  for (let i = 0; i < BALL_COUNT; i++) s.push({ x: 0, z: 0, alive: false });
  for (const [id, x, z] of placed) s[id] = { x, z, alive: true };
  return s;
}

const T0 = 1_000_000;
const names = (n: number) => Array.from({ length: n }, (_, i) => `J${i + 1}`);
const shot = (angle: number, speed: number, offsetX = 0, offsetY = 0): Shot => ({ angle, power: speed / V_MAX, offsetX, offsetY });

/** Partida con mesa a medida, sin las reglas de la rotura, empezando el equipo `team`. */
function scenario(humans: number, balls: BallPos[], team: Team = 0): PoolMatch {
  return new PoolMatch({ humans: names(humans), seed: 1, now: T0, balls, breakTeam: team, skipBreak: true });
}
const GO = T0 + START_DELAY_MS;

// ------------------------------------------------------------------ asientos y formato

console.log("--- asientos");
{
  const expected: [number, number, number][] = [[1, 1, 2], [2, 1, 2], [3, 2, 4], [4, 2, 4], [5, 4, 8], [6, 4, 8], [7, 4, 8], [8, 4, 8]];
  let ok = true;
  let detail = "";
  for (const [humans, perTeam, seats] of expected) {
    const m = new PoolMatch({ humans: names(humans), seed: 7, now: T0 });
    const bots = m.seats.filter((s) => s.nickname === null).length;
    if (formatFor(humans) !== perTeam || m.perTeam !== perTeam || m.seats.length !== seats || bots !== seats - humans) {
      ok = false;
      detail += ` ${humans}:fallo`;
    }
  }
  check("formato por cantidad de humanos y bots de relleno (1-2 -> 1v1, 3-4 -> 2v2, 5-8 -> 4v4)", ok, detail);

  const m5 = new PoolMatch({ humans: names(5), seed: 7, now: T0 });
  const teamsOfHumans = m5.seats.filter((s) => s.nickname !== null).map((s) => s.team).join("");
  check("los humanos se alternan A, B, A, B, A", teamsOfHumans === "01010", teamsOfHumans);
  const humansPerTeam = [0, 1].map((t) => m5.seats.filter((s) => s.team === t && s.nickname !== null).length);
  check("5 humanos en 4v4: 3 en un equipo y 2 en el otro", humansPerTeam[0] === 3 && humansPerTeam[1] === 2, humansPerTeam.join("/"));
  check("el asiento s es slot*2 + equipo", m5.seats.every((s, i) => i === s.slot * 2 + s.team));
  check("la cantidad de jugadores fuera de 1..8 se rechaza", code(() => new PoolMatch({ humans: [], seed: 1, now: T0 })) === "bad_player_count" && code(() => new PoolMatch({ humans: names(9), seed: 1, now: T0 })) === "bad_player_count");

  let breakers = [0, 0];
  for (let seed = 1; seed <= 200; seed++) breakers[new PoolMatch({ humans: names(2), seed, now: T0 }).shooter]++;
  check("el equipo que rompe se sortea (los dos salen)", breakers[0] > 40 && breakers[1] > 40, breakers.join("/"));
}

// ------------------------------------------------------------------ rotura

console.log("--- rotura");
{
  const m = new PoolMatch({ humans: names(2), seed: 3, now: T0, breakTeam: 0 });
  check("la rotura arranca con la blanca en su posicion inicial y NO en mano", !m.cueInHand && m.phase === "aiming" && m.shooter === 0 && m.balls[0].x === HEAD_SPOT.x && m.balls[0].z === HEAD_SPOT.z, `${m.balls[0].x}, ${m.balls[0].z}`);
  check("antes de la cuenta regresiva no se puede actuar", code(() => m.takeShot(0, shot(0, 3), T0)) === "too_early");
  check("en la rotura NO se puede mover la blanca (ni detras de la linea de cabeza)", code(() => m.placeCue(0, -0.9, 0.1, GO)) === "not_in_hand" && m.balls[0].x === HEAD_SPOT.x);
  check("ni tampoco poniendola en otro lado de la mesa", code(() => m.placeCue(0, 0.1, 0, GO)) === "not_in_hand" && m.balls[0].x === HEAD_SPOT.x);
  check("solo tira el asiento que tiene el turno", code(() => m.takeShot(1, shot(0, 3), GO)) === "not_your_turn");
  const out = m.takeShot(0, shot(0, 3), GO);
  check("la rotura se tira directo, sin tener que apoyar nada", out.result.firstContact >= 0 || out.result.segments.length > 0);
}
{
  // La 8 que cae en la rotura vuelve al punto de pie y no decide nada. Blanca y 8 sobre el eje z:
  // la 8 sale derecho a la tronera del medio.
  const m = new PoolMatch({ humans: names(2), seed: 1, now: T0, breakTeam: 0, balls: table([0, 0, -0.5], [8, 0, 0], [1, 0.9, 0.2], [9, 0.9, -0.2]) });
  const out = m.takeShot(0, shot(Math.PI / 2, 2.5), GO);
  check("8 en la rotura: no termina la partida", out.ended === null && out.respotEight && !out.pottedEight, JSON.stringify({ ended: out.ended, respot: out.respotEight }));
  check("8 en la rotura: vuelve al punto de pie", m.balls[8].alive && Math.abs(m.balls[8].x - HALF_L / 2) < 0.2 && Math.abs(m.balls[8].z) < 1e-9, `${m.balls[8].x.toFixed(3)},${m.balls[8].z.toFixed(3)}`);
}

// ------------------------------------------------------------------ turnos y faltas

console.log("--- turnos y faltas");
{
  // Equipo 0 (lisas) emboca la 3 en la tronera de la esquina (+,+): sigue tirando el mismo.
  const potOwn = () => scenario(4, table([0, 0.67, 0.035], [3, HALF_L - 0.3, HALF_W - 0.3], [9, -0.8, -0.3], [10, -0.8, 0.3]), 0);
  const m = potOwn();
  const out = m.takeShot(0, shot(Math.PI / 4, 3), GO);
  check("emboca una propia: sin falta, sigue el mismo asiento", out.pottedOwn.join() === "3" && out.foul === null && out.continues && out.nextSeat === 0, JSON.stringify({ own: out.pottedOwn, foul: out.foul, next: out.nextSeat, ended: out.ended }));
  check("embocar una propia deja a la mesa con una menos para su grupo", out.groupsLeft[0] === 0 && out.groupsLeft[1] === 2);

  // Tiro sin embocar: pasa al otro equipo (asiento 1) y despues al de siguiente slot del primero.
  const m2 = scenario(4, table([0, -0.5, 0], [1, 0.0, 0.0], [9, 0.9, 0.3]), 0);
  const o1 = m2.takeShot(0, shot(0, 1.5), GO);
  check("no emboca: el turno pasa al otro equipo (asiento 1)", !o1.continues && o1.nextSeat === 1 && m2.shooter === 1, `siguiente ${o1.nextSeat}`);
  const o2 = m2.takeShot(1, shot(Math.PI, 0.3), o1.nextTurnAt);
  check("rotacion A1, B1, A2, B2: despues del 1 sigue el 2", o2.nextSeat === 2, `siguiente ${o2.nextSeat}`);
  const o3 = m2.takeShot(2, shot(0, 0.3), o2.nextTurnAt);
  check("...y despues el 3", o3.nextSeat === 3, `siguiente ${o3.nextSeat}`);
  const o4 = m2.takeShot(3, shot(0, 0.3), o3.nextTurnAt);
  check("...y vuelve al 0 (cada equipo recorre sus asientos)", o4.nextSeat === 0, `siguiente ${o4.nextSeat}`);
  check("el reloj del siguiente corre desde que termina la animacion", m2.turnStartAt === o4.nextTurnAt && m2.deadline === o4.nextTurnAt + TURN_MS + (o4.cueInHand ? HAND_BONUS_MS : 0));
}
{
  // Falta: la blanca no toca nada.
  const m = scenario(2, table([0, -0.5, 0.2], [1, 0.5, -0.4], [9, 0.9, 0.3]), 0);
  const out = m.takeShot(0, shot(Math.PI, 0.5), GO); // tira para el lado contrario, contra la banda
  check("falta por no tocar ninguna bola: pasa el turno y blanca en mano", out.foul === "no_contact" && out.cueInHand && out.nextSeat === 1 && m.phase === "placing", `falta ${out.foul}`);
  check("blanca en mano: el reloj suma la bonificacion", m.deadline === m.turnStartAt + TURN_MS + HAND_BONUS_MS);
  check("blanca en mano: la blanca puede ir a cualquier lado (no solo a la cocina)", code(() => m.placeCue(1, 0.3, 0.4, m.turnStartAt)) === "");
}
{
  // Falta: la blanca se va a la tronera. Hay que ponerla para tirar.
  const m = scenario(2, table([0, 0.67, 0.035], [1, 0.0, -0.4], [9, 0.9, 0.3]), 0);
  const out = m.takeShot(0, shot(Math.PI / 4, 3), GO); // diagonal a la esquina: la blanca cae sola
  check("falta por blanca embocada", out.foul === "scratch" && !m.balls[0].alive && out.cueInHand && out.nextSeat === 1, `falta ${out.foul}`);
  check("sin poner la blanca no se puede tirar", code(() => m.takeShot(1, shot(0, 1), m.turnStartAt)) === "cue_not_placed");
  check("tras poner la blanca se puede tirar", code(() => m.placeCue(1, -0.3, 0.3, m.turnStartAt)) === "" && code(() => m.takeShot(1, shot(0, 1), m.turnStartAt)) === "");
}
{
  // Una bola del rival embocada por error: no hay falta, queda abajo y el turno pasa.
  const m = scenario(2, table([0, 0.67, 0.035], [9, HALF_L - 0.3, HALF_W - 0.3], [1, -0.8, -0.3], [2, -0.8, 0.3]), 0);
  const out = m.takeShot(0, shot(Math.PI / 4, 3), GO);
  check("emboca una del rival: sin falta, no sigue, le cuenta al rival", out.pottedOpp.join() === "9" && out.foul === null && !out.continues && out.nextSeat === 1 && out.groupsLeft[1] === 0, JSON.stringify({ opp: out.pottedOpp, foul: out.foul, next: out.nextSeat }));
}

// ------------------------------------------------------------------ la bola 8

console.log("--- bola 8");
{
  // La 8 despues de limpiar el grupo propio: gana.
  const m = scenario(2, table([0, 0.67, 0.035], [8, HALF_L - 0.3, HALF_W - 0.3], [9, -0.8, -0.3]), 0);
  const out = m.takeShot(0, shot(Math.PI / 4, 3), GO);
  check("embocar la 8 con el grupo limpio: gana su equipo", out.ended?.winner === 0 && out.ended.reason === "eight" && m.phase === "ended" && m.winner === 0, JSON.stringify(out.ended));
  check("al terminar nadie tiene el turno", m.shooter === -1 && out.nextSeat === -1);
  check("tras terminar no se acepta nada mas", code(() => m.takeShot(0, shot(0, 1), GO)) === "ended");
  check("puestos: ganador 1 y perdedor 2", m.placeOf(0) === 1 && m.placeOf(1) === 2);
}
{
  // La 8 antes de limpiar: pierde.
  const m = scenario(2, table([0, 0.67, 0.035], [8, HALF_L - 0.3, HALF_W - 0.3], [1, -0.8, -0.3], [9, -0.8, 0.3]), 0);
  const out = m.takeShot(0, shot(Math.PI / 4, 3), GO);
  check("embocar la 8 antes de limpiar: pierde su equipo", out.ended?.winner === 1 && out.ended.reason === "early_eight", JSON.stringify(out.ended));
}
{
  // La 8 junto con la blanca: pierde aunque el grupo este limpio. Blanca y 8 en la misma diagonal, la blanca la sigue (seguir).
  const m = scenario(2, table([0, 0.8, 0.165], [8, HALF_L - 0.3, HALF_W - 0.3], [9, -0.8, -0.3]), 0);
  const out = m.takeShot(0, shot(Math.PI / 4, 4, 0, 0.45), GO);
  const both = out.result.pocketed.includes(0) && out.result.pocketed.includes(8);
  check("8 y blanca juntas: pierde (si no cayeron las dos, el caso no se armo)", !both || (out.ended?.winner === 1 && out.ended.reason === "scratch_eight"), JSON.stringify({ pocketed: out.result.pocketed, ended: out.ended }));
}

// ------------------------------------------------------------------ relojes, AFK y desconexion

console.log("--- relojes");
{
  const m = scenario(2, table([0, -0.5, 0], [1, 0.0, 0.0], [9, 0.9, 0.3]), 0);
  check("antes de vencer no hay timeout", !m.timedOut(m.deadline - 1) && code(() => m.handleTimeout(m.deadline - 1)) === "not_timed_out");
  check("al vencer hay timeout", m.timedOut(m.deadline));
  const t1 = m.handleTimeout(m.deadline);
  check("un turno vencido: se cuenta, pero todavia no es AFK", t1.seat === 0 && !t1.afk && !m.seats[0].afk && m.seats[0].idle === 1, JSON.stringify(t1));
  // Un turno vencido no es piloto automatico para un humano hasta el segundo.
  const m2 = scenario(2, table([0, -0.5, 0], [1, 0.0, 0.0], [9, 0.9, 0.3]), 0);
  m2.handleTimeout(m2.deadline);
  check("el primer vencimiento no deja al asiento en piloto automatico", !m2.isAutopilot(0));
  m2.handleTimeout(m2.deadline);
  check(`tras ${IDLE_TURNS_TO_BOT} turnos vencidos el asiento queda en piloto automatico`, m2.isAutopilot(0));
  m2.takeShot(0, shot(0, 1), m2.turnStartAt, true);
  check("si juega un bot por el, sigue en piloto automatico", m2.isAutopilot(0));
  // Cuando al humano le vuelve a tocar y actua, lo reclama. Se simula rotando hasta el asiento 0.
  const m3 = scenario(2, table([0, -0.5, 0], [1, 0.0, 0.0], [9, 0.9, 0.3]), 0);
  m3.handleTimeout(m3.deadline);
  m3.handleTimeout(m3.deadline);
  m3.takeShot(0, shot(0, 1), m3.turnStartAt, true);
  const o = m3.takeShot(1, shot(0, 0.5), m3.turnStartAt, true);
  void o;
  m3.takeShot(0, shot(0, 0.5), m3.turnStartAt);
  check("cuando el humano vuelve a actuar, deja de ser piloto automatico", !m3.isAutopilot(0) && m3.seats[0].idle === 0);
}
{
  const m = scenario(2, table([0, -0.5, 0], [1, 0.0, 0.0], [9, 0.9, 0.3]), 0);
  m.setAway(0, true);
  check("un desconectado esta en piloto automatico", m.isAutopilot(0));
  m.setAway(0, false);
  check("al reconectar lo reclama", !m.isAutopilot(0));
  check("un bot de relleno siempre esta en piloto automatico", new PoolMatch({ humans: names(1), seed: 1, now: T0 }).isAutopilot(1));
}
{
  // Tope de partida.
  const base = (): PoolMatch => scenario(2, table([0, -0.5, 0], [1, 0.0, 0.0], [2, 0.5, 0.2], [9, 0.9, 0.3]), 0);
  const m = base();
  check("el tope depende del formato (1v1)", m.capAt - GO === MATCH_CAP_MS[1]);
  check("antes del tope no se corta", !m.capReached(m.capAt - 1) && m.capReached(m.capAt));
  const r = m.endByCap();
  check("al corte gana el equipo con menos bolas de su grupo (A tiene 2, B tiene 1: gana B)", r.winner === 1 && m.winner === 1 && m.phase === "ended" && m.endReason === "cap", JSON.stringify(r));
  const draw = scenario(2, table([0, -0.5, 0], [1, 0.0, 0.0], [9, 0.9, 0.3]), 0);
  const rd = draw.endByCap();
  check("igual cantidad: empate, los dos puestos 1", rd.winner === null && draw.placeOf(0) === 1 && draw.placeOf(1) === 1);
  check("no se corta dos veces", code(() => draw.endByCap()) === "already_ended");
}

// ------------------------------------------------------------------ partidas completas al azar

console.log("--- partidas completas");
{
  const GAMES = 120;
  const rnd = mulberry32(2024);
  let ended = 0;
  const reasons: Record<string, number> = {};
  const winners = [0, 0, 0];
  let turns = 0;
  let sumTurns = 0;
  let errors = 0;
  let invariantBreaks = 0;
  let worstTurns = 0;
  const t0 = performance.now();

  for (let g = 0; g < GAMES; g++) {
    const humans = 1 + (g % 8);
    const m = new PoolMatch({ humans: names(humans), seed: 1000 + g, now: T0 });
    let now = T0;
    let n = 0;
    let potted = new Set<number>();
    try {
      while (m.phase !== "ended" && n < 500) {
        n++;
        now = Math.max(now, m.turnStartAt);
        if (m.capReached(now)) {
          m.endByCap();
          break;
        }
        const seat = m.shooter;
        if (!m.balls[0].alive || (m.cueInHand && rnd() < 0.5)) {
          // Pone la blanca en el primer lugar libre que encuentra.
          let placed = false;
          for (let tries = 0; tries < 400 && !placed; tries++) {
            const x = m.snapshot().breakShot ? HEAD_SPOT.x - rnd() * 0.5 : (rnd() * 2 - 1) * (HALF_L - 0.1);
            const z = (rnd() * 2 - 1) * (HALF_W - 0.1);
            try {
              m.placeCue(seat, x, z, now, true);
              placed = true;
            } catch (e) {
              if (!(e instanceof PoolError)) throw e;
            }
          }
          if (!placed) throw new Error("no encontro lugar para la blanca");
        }
        // Apunta a una bola viva al azar (de las propias si hay) con un poco de error.
        const team = m.seats[seat].team;
        const targets: number[] = [];
        for (let i = 1; i < BALL_COUNT; i++) if (m.balls[i].alive && (groupOf(i) === team || i === 8)) targets.push(i);
        if (targets.length === 0) for (let i = 1; i < BALL_COUNT; i++) if (m.balls[i].alive) targets.push(i);
        const tgt = m.balls[targets[Math.floor(rnd() * targets.length)]];
        const angle = Math.atan2(tgt.z - m.balls[0].z, tgt.x - m.balls[0].x) + (rnd() - 0.5) * 0.12;
        const power = 0.15 + rnd() * 0.85;
        let out: ShotOutcome;
        const before = m.balls.map((b) => b.alive);
        out = m.takeShot(seat, { angle, power, offsetX: 0, offsetY: (rnd() - 0.5) * 0.6 }, now, true);
        now = out.nextTurnAt;
        // Invariantes: ninguna bola vuelve a la vida salvo la blanca puesta y la 8 de la rotura.
        for (let i = 1; i < BALL_COUNT; i++) {
          if (!before[i] && m.balls[i].alive && !(i === 8 && out.respotEight)) invariantBreaks++;
        }
        for (const id of out.result.pocketed) potted.add(id);
        if (m.phase !== "ended" && (m.shooter < 0 || m.shooter >= m.seats.length)) invariantBreaks++;
      }
    } catch (e) {
      errors++;
      console.log("     error en partida", g, String(e));
    }
    if (m.phase === "ended") {
      ended++;
      const key = m.endReason ?? "?";
      reasons[key] = (reasons[key] ?? 0) + 1;
      winners[m.winner === null ? 2 : m.winner]++;
    }
    turns += n;
    sumTurns += n;
    worstTurns = Math.max(worstTurns, n);
  }
  const ms = performance.now() - t0;
  check(`${GAMES} partidas al azar (1 a 8 humanos): sin errores`, errors === 0, `${errors} con error`);
  check("todas terminan (por la 8 o por el tope)", ended === GAMES, `${ended}/${GAMES}`);
  check("ninguna bola vuelve a la mesa salvo la blanca puesta y la 8 de la rotura", invariantBreaks === 0, `${invariantBreaks}`);
  console.log(`     motivos: ${JSON.stringify(reasons)}  ganan A/B/empate: ${winners.join("/")}  tiros por partida: media ${(sumTurns / GAMES).toFixed(1)}, maximo ${worstTurns}  (${(ms / GAMES).toFixed(0)} ms por partida)`);
  void turns;
  void BALL_R;
}

console.log(`\n${checks - failures}/${checks} chequeos ok`);
if (failures > 0) process.exit(1);
