/**
 * Contrato de mensajes socket.io de Bomba Palabra (namespace `/wordbomb`).
 *
 * El server es autoritativo: mantiene el turno, la mecha (deadline absoluto),
 * las vidas y el set de palabras usadas, y valida cada palabra contra el
 * diccionario embebido. Los clientes solo mandan su intento y animan localmente
 * la mecha entre snapshots. Mismo nivel de confianza spoofeable ya aceptado en el
 * repo (los clientes declaran su nickname); el server no escribe en Supabase.
 */

/** Vista publica de un jugador dentro de la partida. */
export interface WbPlayerView {
  nickname: string;
  lives: number;
  alive: boolean;
  /** Conectado al server ahora mismo (para las luces de estado del cliente). */
  connected: boolean;
}

export type WbPhase = "waiting" | "playing" | "over";

/** Snapshot completo que el server difunde en cada cambio. */
export interface WbState {
  phase: WbPhase;
  /** Nickname del jugador de turno, o null fuera de "playing". */
  turn: string | null;
  /** Fragmento (silaba/combo) que la palabra debe contener. */
  fragment: string | null;
  /** Fin de la mecha en epoch ms (el cliente lo anima), o null. */
  deadline: number | null;
  /** Ms restantes de la mecha al momento del broadcast. El cliente los ancla a su
   *  reloj monotono local (performance.now()) para animar el anillo sin depender
   *  del epoch del server (evita el drift de reloj entre maquinas). */
  fuseMs: number | null;
  /** Duracion total de la mecha de este turno, para la fraccion del anillo. */
  fuseTotalMs: number | null;
  players: WbPlayerView[];
  /** Palabras aceptadas en la partida (para mostrar el ritmo). */
  usedCount: number;
  /** Ultima palabra aceptada, para animarla una vez en los demas clientes. */
  lastAccepted: { player: string; word: string; seq: number } | null;
}

/** Motivo por el que se rechazo un intento (feedback privado al que lo mando). */
export type WbRejectReason = "not-a-word" | "missing-fragment" | "already-used" | "not-your-turn";

/**
 * Reacciones: el jugador cambia la cara de su personaje por un instante. Es un id
 * de un set cerrado (no texto libre, no emojis: el repo los prohibe y las caras se
 * dibujan en el SVG del personaje). El server solo las retransmite -- no tocan el
 * estado de la partida -- validando el id contra el allowlist y con un cooldown por
 * jugador. Se duplican en el cliente (game/constants.ts + game/WordBombTransport.ts).
 */
export type WbEmoteId = "risa" | "sorpresa" | "enojo" | "burla" | "llanto";

export interface WbGameover {
  /** Puesto por jugador: 1 = ganador (ultimo en pie). */
  ranking: { nickname: string; place: number }[];
}

/** Cliente -> Server. */
export interface WbClientToServer {
  "wb:join": (msg: { code: string; nickname: string; roster: string[] }) => void;
  "wb:submit": (msg: { word: string }) => void;
  /** Texto en vivo del jugador de turno (se retransmite tal cual, sin validar). */
  "wb:typing": (msg: { text: string }) => void;
  /** Reaccion del jugador (id del allowlist; el server la valida y la difunde). */
  "wb:emote": (msg: { emote: WbEmoteId }) => void;
}

/** Server -> Cliente. */
export interface WbServerToClient {
  "wb:state": (state: WbState) => void;
  "wb:invalid": (msg: { reason: WbRejectReason }) => void;
  "wb:typing": (msg: { player: string; text: string }) => void;
  "wb:emote": (msg: { player: string; emote: WbEmoteId }) => void;
  "wb:gameover": (msg: WbGameover) => void;
}

/* ==================== CADENA DE PALABRAS (namespace /wordchain) ==================== */

/**
 * Contrato de mensajes socket.io de Cadena de Palabras (namespace `/wordchain`).
 *
 * Fork de Bomba Palabra con otra mecanica: el reto es una LETRA (no un fragmento) y
 * la palabra tiene que EMPEZAR con ella; su ultima letra pasa a ser el reto del
 * siguiente. Una sola vida: si se te acaba el reloj quedas eliminado en el acto.
 * Server autoritativo igual que Bomba (turno, reloj, validacion contra el diccionario)
 * y misma confianza spoofeable; no escribe en Supabase.
 */

export interface WcPlayerView {
  nickname: string;
  /** Sigue en pie. Con una sola vida, `false` = eliminado. */
  alive: boolean;
  connected: boolean;
  /** Cuantos eslabones aporto (palabras aceptadas) — se muestra como su racha. */
  links: number;
}

export type WcPhase = "waiting" | "playing" | "over";

export interface WcState {
  phase: WcPhase;
  turn: string | null;
  /** Letra con la que tiene que empezar la palabra del jugador de turno. */
  letter: string | null;
  /** Fin del reloj del turno en epoch ms, o null. */
  deadline: number | null;
  /** Ms restantes al momento del broadcast; el cliente los ancla a performance.now()
   *  para animar el anillo sin drift de reloj (ver Bomba Palabra). */
  clockMs: number | null;
  /** Duracion total del reloj de este turno, para la fraccion del anillo. */
  clockTotalMs: number | null;
  players: WcPlayerView[];
  /** Largo de la cadena forjada (palabras aceptadas en la partida). */
  chainLength: number;
  /** Ultima palabra aceptada, para sellarla una vez en los demas clientes. */
  lastAccepted: { player: string; word: string; seq: number } | null;
}

/** Motivo del rechazo (feedback privado al que lo mando). */
export type WcRejectReason = "not-a-word" | "wrong-initial" | "already-used" | "not-your-turn";

/** Reacciones: mismo set cerrado que Bomba Palabra (ids, nunca glifos). */
export type WcEmoteId = "risa" | "sorpresa" | "enojo" | "burla" | "llanto";

export interface WcGameover {
  /** Puesto por jugador: 1 = ganador (ultimo en pie). */
  ranking: { nickname: string; place: number }[];
}

/** Cliente -> Server. */
export interface WcClientToServer {
  "wc:join": (msg: { code: string; nickname: string; roster: string[] }) => void;
  "wc:submit": (msg: { word: string }) => void;
  "wc:typing": (msg: { text: string }) => void;
  "wc:emote": (msg: { emote: WcEmoteId }) => void;
}

/** Server -> Cliente. */
export interface WcServerToClient {
  "wc:state": (state: WcState) => void;
  "wc:invalid": (msg: { reason: WcRejectReason }) => void;
  "wc:typing": (msg: { player: string; text: string }) => void;
  "wc:emote": (msg: { player: string; emote: WcEmoteId }) => void;
  "wc:gameover": (msg: WcGameover) => void;
}

/* ============================ PONG (namespace /pong) ============================ */

/**
 * Contrato de mensajes socket.io de PONG (namespace `/pong`).
 *
 * En sala el juego es PvP: la sala se empareja de a dos (jugadores 0-1, 2-3, ...);
 * el impar juega contra la IA. Cada par es un "match" con su propia pelota. El
 * server es autoritativo de la fisica de la pelota, las colisiones y el puntaje;
 * cada cliente solo controla su paleta (manda su Y) y renderiza los snapshots
 * (prediccion + reconciliacion suave entre ellos). Mismo nivel de confianza
 * spoofeable ya aceptado en el repo; el server no escribe en Supabase.
 */

export interface PongBall {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Rapidez actual (rampa por cada rebote de paleta). */
  speed: number;
  /** Rebotes de paleta acumulados (para la rampa de velocidad). */
  hits: number;
}

export type PongPhase = "countdown" | "playing" | "over";

/** Snapshot del match que el server difunde a cada jugador del par. */
export interface PongMatchState {
  /** Lado de ESTE jugador: "p1" = paleta izquierda, "p2" = paleta derecha. */
  side: "p1" | "p2";
  /** Reloj de la SIMULACION (ms, epoch del server) al que corresponde este estado.
   *  Avanza de a TICK_MS exactos, no es el Date.now() del envio: es la linea de
   *  tiempo sobre la que el cliente interpola (ver `renderFromSnaps` del cliente).
   *  Sin esto el cliente tiene que usar la hora de llegada del paquete y el jitter
   *  de entrega se convierte en velocidad falsa de la pelota. */
  t: number;
  phase: PongPhase;
  ball: PongBall;
  /** Y de la paleta izquierda / derecha (coord de vista, no escaladas). */
  p1Y: number;
  p2Y: number;
  p1Score: number;
  p2Score: number;
  /** El rival de ESTE jugador es la IA del server (impar sin pareja o ausente). */
  vsAi: boolean;
}

/** Cliente -> Server. */
export interface PongClientToServer {
  "pg:join": (msg: { code: string; nickname: string; roster: string[] }) => void;
  /** Posicion Y de la paleta propia (coord de vista). */
  "pg:paddle": (msg: { y: number }) => void;
}

/** Server -> Cliente. */
export interface PongServerToClient {
  "pg:state": (state: PongMatchState) => void;
}

/* ============================ BASTA (namespace /basta) ============================ */

/**
 * Contrato de mensajes socket.io de Basta / Tutti Frutti (namespace `/basta`).
 *
 * Se sortea una LETRA y cada jugador llena 7 categorias con palabras que empiecen
 * con ella. El primero que completa las 7 grita BASTA y corta a los demas (gracia
 * corta). Despues las respuestas se validan por VOTACION entre jugadores: cada uno
 * puede tachar como invalidas las respuestas ajenas, y la mayoria las tumba. El
 * server NO valida contra el diccionario (a diferencia de Bomba/Cadena) — solo
 * arbitra el flujo, guarda las respuestas y computa el puntaje. Un partido son
 * varias letras; gana el de mas puntos. Mismo nivel de confianza spoofeable ya
 * aceptado en el repo; el server no escribe en Supabase.
 */

/** Las 7 categorias (ids fijos). Deben coincidir con `CATEGORIES` del cliente. */
export type BtCategoryId =
  | "nombre"
  | "apellido"
  | "lugar"
  | "color"
  | "comida"
  | "animal"
  | "cosa";

export type BtPhase = "waiting" | "filling" | "grace" | "voting" | "reveal" | "over";

/** Vista publica de un jugador dentro de la partida. */
export interface BtPlayerView {
  nickname: string;
  connected: boolean;
  /** Cuantas de las 7 categorias tiene llenas en la letra actual (solo en filling,
   *  para la tension; NO revela el contenido). */
  filledCount: number;
  /** Puntaje acumulado del partido. */
  total: number;
  /** Solo en voting: ya mando su hoja de tachados. Es lo unico que se sabe del voto
   *  ajeno hasta el reveal (a quien tacho no se ve, para no arrastrar a la mesa). */
  voted: boolean;
}

/**
 * Como quedo puntuada una respuesta al revelar (para el desglose). `invalid` es la
 * anulacion automatica: una sola letra no es una palabra (con la letra A, un apellido
 * que dice "A"), asi que el server la descarta sin pasar por la votacion.
 */
export type BtCellStatus = "unique" | "repeated" | "rejected" | "empty" | "invalid";

/** Una celda revelada (en voting/reveal): la respuesta de un jugador en una categoria. */
export interface BtCell {
  player: string;
  category: BtCategoryId;
  /** Texto tal cual lo escribio (vacio si no puso nada). */
  text: string;
  /** Solo en reveal: como quedo puntuada y cuantos puntos dio. */
  status: BtCellStatus | null;
  points: number | null;
}

/** Un voto de rechazo crudo. Se difunden recien en el REVEAL (durante la votacion
 *  solo se sabe QUIEN ya voto, no a quien tacho): la hoja de tachados se manda
 *  entera y de una sola vez al confirmar. */
export interface BtVote {
  voter: string;
  target: string;
  category: BtCategoryId;
}

/** Snapshot completo que el server difunde en cada cambio. */
export interface BtState {
  phase: BtPhase;
  /** Letra en juego (mayuscula), o null fuera de una letra. */
  letter: string | null;
  /** Indice de la letra actual (0-based) y total de letras del partido. */
  letterIndex: number;
  totalLetters: number;
  /** Fin de la fase actual en epoch ms (filling tope / grace / voting / reveal), o null. */
  deadline: number | null;
  /** Ms restantes de la fase al broadcast; el cliente los ancla a performance.now()
   *  para animar el reloj sin drift (ver Bomba Palabra). */
  clockMs: number | null;
  /** Duracion total de la fase actual (para la fraccion de la barra). */
  clockTotalMs: number | null;
  players: BtPlayerView[];
  /** Quien grito BASTA en esta letra, o null. */
  bastaBy: string | null;
  /** Respuestas reveladas de TODOS (solo en voting/reveal; null en filling). */
  cells: BtCell[] | null;
  /** Votos de rechazo crudos, solo en REVEAL (null en el resto, votacion incluida:
   *  mientras se vota, lo unico publico es el `voted` de cada jugador). */
  votes: BtVote[] | null;
  /** Puntos ganados por cada jugador en esta letra (solo en reveal; null si no). */
  letterScores: { player: string; points: number }[] | null;
}

export interface BtGameover {
  /** Puesto por jugador: 1 = ganador (mas puntos). Incluye el total final. */
  ranking: { nickname: string; place: number; total: number }[];
}

/** Cliente -> Server. */
export interface BtClientToServer {
  "bt:join": (msg: { code: string; nickname: string; roster: string[] }) => void;
  /** Hoja completa del jugador para la letra actual (debounced; el server guarda la ultima). */
  "bt:fill": (msg: { answers: Partial<Record<BtCategoryId, string>> }) => void;
  /** Declara BASTA: el server exige tener las 7 categorias no vacias. */
  "bt:basta": (msg: Record<string, never>) => void;
  /** Hoja de tachados COMPLETA del votante, mandada de una sola vez al confirmar
   *  ("Listo"): mientras revisa, el tachado es local y nadie lo ve. Confirma una
   *  vez por letra — el server ignora los reenvios. Cuando confirmaron todos los
   *  jugadores conectados, la votacion se cierra sin esperar el tope. */
  "bt:vote": (msg: { rejects: { target: string; category: BtCategoryId }[] }) => void;
}

/** Server -> Cliente. */
export interface BtServerToClient {
  "bt:state": (state: BtState) => void;
  /** Dirigido: al (re)conectar durante el llenado, el server le devuelve al jugador
   *  SU propia hoja (que vive en el server) para que un F5 no la pierda. */
  "bt:you": (msg: { answers: Partial<Record<BtCategoryId, string>> }) => void;
  "bt:gameover": (msg: BtGameover) => void;
}

/* ========================= NEON DRIFT (namespace /carrace) ========================= */

/**
 * Contrato de mensajes socket.io de Neon Drift (namespace `/carrace`).
 *
 * A diferencia del resto, el server NO simula: es un RELAY. Cada cliente corre su
 * propia carrera (fisica local, mismo circuito y mismos obstaculos por seed) y solo
 * difunde su posicion para que los demas lo vean; el server la reenvia. Reemplaza al
 * canal de broadcast de Supabase, que topea ~100 mensajes/s por canal — justo donde
 * caia una sala llena (8 jugadores x 10/s = 80/s) y el socket se moria en silencio.
 *
 * Lo unico que el server si recuerda es la votacion de circuito de la ronda: el
 * ultimo `cr:map` anunciado se le reenvia a cualquiera que se conecte despues, que es
 * lo que el modelo de Supabase no podia dar (el que entraba tarde se quedaba sin el
 * anuncio y caia al circuito por seed, no al votado).
 *
 * Mismo nivel de confianza spoofeable ya aceptado en el repo; el server no escribe en
 * Supabase (lobby / marcador / rejoin siguen en la DB).
 */

/** Snapshot de posicion de un auto. El `p` lo estampa el SERVER con el nickname del
 *  socket emisor: asi nadie puede mover el auto de otro (el cliente manda el resto). */
export interface CrPos {
  /** Nickname del emisor (lo pone el server, no el cliente). */
  p: string;
  x: number;
  y: number;
  /** Angulo del auto en radianes. */
  a: number;
  /** Vuelta actual (0-based). */
  l: number;
  /** Progreso dentro de la vuelta ∈ [0,1). */
  s: number;
  /** True cuando el emisor ya cruzo la meta final. */
  f: boolean;
}

/** Cliente -> Server. */
export interface CrClientToServer {
  /** `round` scopea el estado: una ronda nueva descarta los votos de la anterior. */
  "cr:join": (msg: { code: string; nickname: string; roster: string[]; round: number }) => void;
  /** Posicion propia (sin `p`: lo estampa el server). */
  "cr:pos": (msg: Omit<CrPos, "p">) => void;
  /** Voto por un circuito (indice), antes de largar. */
  "cr:vote": (msg: { m: number }) => void;
  /** Circuito ganador que anuncia el anfitrion al cerrar la votacion. */
  "cr:map": (msg: { m: number }) => void;
}

/** Server -> Cliente. */
export interface CrServerToClient {
  "cr:pos": (msg: CrPos) => void;
  "cr:vote": (msg: { p: string; m: number }) => void;
  "cr:map": (msg: { m: number }) => void;
}

/* ========================== IMPOSTOR (namespace /impostor) ========================== */

/**
 * Contrato de mensajes socket.io de Impostor (namespace `/impostor`).
 *
 * Deduccion social: a todos menos al/los impostor/es se les muestra en PRIVADO la misma
 * palabra secreta y su categoria; el impostor solo ve la categoria (sabe que es impostor,
 * no la palabra). Por turnos cada uno escribe UNA palabra-pista relacionada; todos las ven.
 * Despues se VOTA quien es el impostor. Si el mas votado es un impostor, tiene una chance de
 * ADIVINAR la palabra para robar la ronda. Un partido son varias rondas; gana el de mas puntos.
 *
 * Como Basta, el server arbitra todo el flujo (fases + deadlines con setTimeout propio) y NO
 * usa el diccionario. El rol (palabra / impostor) viaja SOLO por el evento dirigido `im:you`,
 * nunca en el broadcast `im:state`, para que no se pueda espiar quien es el impostor.
 */

export type ImPhase = "waiting" | "reveal" | "clues" | "voting" | "guess" | "result" | "over";

/** Vista publica de un jugador (nunca revela su rol). */
export interface ImPlayerView {
  nickname: string;
  connected: boolean;
  /** Puntaje acumulado del partido. */
  total: number;
  /** Ya dio su pista en la ronda de pistas (solo en clues). */
  clued: boolean;
  /** Ya voto (solo en voting; no revela a quien). */
  voted: boolean;
}

/** Una pista dada, en orden de turno. */
export interface ImClue {
  player: string;
  word: string;
}

/** Un voto crudo (se revela en voting/result; el cliente cuenta y deriva el propio). */
export interface ImVoteView {
  voter: string;
  target: string;
}

export type ImOutcomeKind = "impostor-survived" | "impostor-guessed" | "impostor-caught";

/** Resumen de la ronda (solo en result). */
export interface ImOutcome {
  kind: ImOutcomeKind;
  /** Que escribio el impostor al intentar adivinar, o null. */
  guess: string | null;
  /** Puntos ganados esta ronda por jugador. */
  scores: { player: string; points: number }[];
  winners: "impostores" | "inocentes";
}

/** Snapshot que el server difunde en cada cambio. NUNCA incluye roles ni la palabra
 *  salvo en `result` (donde ya termino la ronda y se puede revelar). */
export interface ImState {
  phase: ImPhase;
  /** Ronda actual (1-based) y total del partido. */
  round: number;
  totalRounds: number;
  /** Categoria de la palabra secreta (visible a todos, incluido el impostor). */
  category: string | null;
  /** Fin de la fase actual en epoch ms, o null. */
  deadline: number | null;
  /** Ms restantes de la fase al broadcast; el cliente los ancla a performance.now(). */
  clockMs: number | null;
  clockTotalMs: number | null;
  players: ImPlayerView[];
  /** Nickname del jugador de turno en clues, o null. */
  turn: string | null;
  /** Pistas dadas hasta ahora en la ronda, en orden de turno. */
  clues: ImClue[];
  /** Votos crudos (solo en voting/result; null si no). */
  votes: ImVoteView[] | null;
  /** Impostor/es revelado/s (solo en result). */
  impostors: string[] | null;
  /** Palabra secreta revelada (solo en result). */
  word: string | null;
  /** Acusado = mas votado (solo en guess/result; null si empate o nadie). */
  accused: string | null;
  /** Resumen de la ronda (solo en result). */
  outcome: ImOutcome | null;
}

export interface ImGameover {
  ranking: { nickname: string; place: number; total: number }[];
}

/** Rol privado que recibe cada jugador al empezar la ronda (y al reconectar). */
export interface ImYou {
  round: number;
  impostor: boolean;
  /** La palabra secreta si es inocente; null si es impostor. */
  word: string | null;
  category: string;
  /** Los otros impostores (solo si es impostor y hay 2). */
  mates: string[];
}

/** Cliente -> Server. */
export interface ImClientToServer {
  "im:join": (msg: { code: string; nickname: string; roster: string[] }) => void;
  /** Pista del jugador de turno (una palabra). El server valida que sea su turno. */
  "im:clue": (msg: { word: string }) => void;
  /** Voto de quien cree que es el impostor (cambiable hasta cerrar). */
  "im:vote": (msg: { target: string }) => void;
  /** Intento de adivinar la palabra (solo el impostor acusado, en guess). */
  "im:guess": (msg: { word: string }) => void;
}

/** Server -> Cliente. */
export interface ImServerToClient {
  "im:state": (state: ImState) => void;
  /** Dirigido: el rol privado del jugador (palabra o impostor). No viaja en im:state. */
  "im:you": (msg: ImYou) => void;
  "im:gameover": (msg: ImGameover) => void;
}

/* ------------------------------------------------------------------ *
 * Telefono Cortado (`tc:*`, namespace /telefonocortado)
 * ------------------------------------------------------------------ *
 *
 * Telefono descompuesto con dibujos. Cada jugador escribe una frase secreta; despues
 * le llega la frase de OTRO y la dibuja; despues le llega el dibujo de un TERCERO y
 * tiene que adivinar la frase original. Al final se revela cada cadena completa
 * (frase -> dibujo -> adivinanza).
 *
 * Como Basta e Impostor, el server arbitra todo el flujo (fases + deadlines con
 * setTimeout propio) y NO usa el diccionario. Lo que le toca a cada jugador (la frase
 * a dibujar, el dibujo a adivinar, la pista) viaja SOLO por el evento dirigido
 * `tc:you`, nunca en el broadcast `tc:state`: si la frase a adivinar viajara en el
 * state, se leeria desde las devtools y la adivinanza no valdria nada.
 */

export type TcPhase = "waiting" | "writing" | "drawing" | "guessing" | "reveal" | "over";

/** Vista publica de un jugador (nunca revela su frase, su dibujo ni su pista). */
export interface TcPlayerView {
  nickname: string;
  connected: boolean;
  /** Ya entrego lo que pedia la fase actual (frase / dibujo / acierto). */
  done: boolean;
  /** Puntaje acumulado del partido. */
  total: number;
}

/** Snapshot que el server difunde en cada cambio. Sin contenido secreto. */
export interface TcState {
  phase: TcPhase;
  /** Fin de la fase actual en epoch ms, o null. */
  deadline: number | null;
  /** Ms restantes de la fase al broadcast; el cliente los ancla a performance.now(). */
  clockMs: number | null;
  clockTotalMs: number | null;
  players: TcPlayerView[];
  /** Cuantas cadenas se van a revelar (solo en reveal/over). */
  totalChains: number | null;
}

/**
 * Lo que le toca al jugador en la fase actual. Dirigido, y reenviado al reconectar
 * (F5) y cada vez que avanza la pista.
 */
export interface TcYou {
  phase: TcPhase;
  /** Frase ajena que te toca dibujar (solo en drawing). */
  phrase: string | null;
  /** Dibujo ajeno que te toca adivinar, dataURL (solo en guessing). */
  drawing: string | null;
  /**
   * Pista tipo ahorcado de la frase a adivinar (solo en guessing): las letras
   * reveladas van tal cual, las ocultas como "_" y los espacios como " ". La frase
   * completa NUNCA se manda hasta el reveal.
   */
  hint: string | null;
  /** Lo ya entregado en esta fase, para repintarlo tras un F5. */
  submitted: string | null;
  /** Ya acertaste la frase (solo en guessing). */
  solved: boolean;
}

/** Una cadena completa, revelada al final. Se manda de a una (ver `tc:chain`). */
export interface TcChainView {
  /** Indice de la cadena y total, para que el cliente sepa cuando las tiene todas. */
  index: number;
  total: number;
  /** Quien escribio la frase. */
  author: string;
  phrase: string;
  /** True si la frase la puso el server porque el autor no llego a escribirla. */
  filled: boolean;
  /** Quien la dibujo (null si nadie llego a dibujarla). */
  artist: string | null;
  /** dataURL del dibujo, o null. */
  drawing: string | null;
  /** Quien intento adivinarla (null si a nadie le toco). */
  guesser: string | null;
  /** Su ultimo intento, o null. */
  guess: string | null;
  solved: boolean;
}

export interface TcGameover {
  ranking: { nickname: string; place: number; total: number }[];
}

/** Cliente -> Server. */
export interface TcClientToServer {
  "tc:join": (msg: { code: string; nickname: string; roster: string[] }) => void;
  /** La frase secreta propia (solo en writing). */
  "tc:phrase": (msg: { text: string }) => void;
  /** El dibujo terminado, dataURL (solo en drawing). */
  "tc:draw": (msg: { image: string }) => void;
  /** Un intento de adivinanza (solo en guessing; ilimitados hasta acertar). */
  "tc:guess": (msg: { text: string }) => void;
}

/** Server -> Cliente. */
export interface TcServerToClient {
  "tc:state": (state: TcState) => void;
  /** Dirigido: la tarea privada del jugador. No viaja en tc:state. */
  "tc:you": (msg: TcYou) => void;
  /**
   * Una cadena revelada. Se manda de a UNA (no un array con todas) porque cada
   * dibujo son decenas de KB en base64 y una sala de 8 juntaria ~500KB en un solo
   * mensaje, cerca del `maxHttpBufferSize` de socket.io (1MB por defecto).
   */
  "tc:chain": (msg: TcChainView) => void;
  "tc:gameover": (msg: TcGameover) => void;
}
