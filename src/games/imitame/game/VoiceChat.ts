import { getAudio } from "./audio";

/**
 * Chat de voz de la sala (el "Discord embebido"): WebRTC de audio en malla, todos con
 * todos (8 jugadores = 28 conexiones, solo audio: alcanza). La senalizacion (ofertas,
 * respuestas, candidatos ICE) viaja por el game server (`mt:rtc`), que solo la reenvia al
 * destinatario con el remitente estampado.
 *
 * Quien ofrece se decide por nickname (el menor ofrece), asi dos pares nunca se ofrecen a
 * la vez. Cuando un par se va (el server lo marca desconectado) se cierra su conexion; al
 * volver (F5) se arma de cero.
 *
 * Como en el juego original, la mesa se silencia mientras suena algo que hay que escuchar
 * o mientras se graba (`setOpen(false)`): ni se manda ni se escucha. Y el micro del chat es
 * un stream aparte del de la grabadora, CON cancelacion de eco y supresion de ruido (la
 * grabadora los apaga para no aplanar la altura).
 *
 * Sin TURN: detras de NATs estrictos algun par puede no conectar. Solo STUN publico.
 */

export type Signal =
  | { type: "hello" }
  | { type: "offer"; sdp: string }
  | { type: "answer"; sdp: string }
  | { type: "ice"; candidate: RTCIceCandidateInit };

interface Peer {
  pc: RTCPeerConnection;
  audio: HTMLAudioElement;
  analyser: AnalyserNode | null;
  pendingIce: RTCIceCandidateInit[];
}

const ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];

export class VoiceChat {
  private readonly me: string;
  private readonly send: (to: string, data: Signal) => void;
  private stream: MediaStream | null = null;
  private localAnalyser: AnalyserNode | null = null;
  private readonly peers = new Map<string, Peer>();
  /** A quienes ya les avisamos que estamos listos (se limpia al cerrar el par). */
  private readonly helloSent = new Set<string>();
  private readonly levelBuf = new Float32Array(512);
  /** Lo decide la fase del juego. */
  private open = true;
  /** Lo decide el jugador con el boton. */
  private muted = false;
  private started = false;

  constructor(me: string, send: (to: string, data: Signal) => void) {
    this.me = me;
    this.send = send;
  }

  /**
   * Pide el micro del chat. Sin micro se puede escuchar igual. Hasta que termina no se
   * arma ninguna conexion (`syncPeers` espera): agregar la pista despues obligaria a
   * renegociar desde los dos lados.
   */
  async start(): Promise<boolean> {
    if (this.started) return this.stream !== null;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch {
      this.stream = null;
    }
    const a = getAudio();
    if (a && this.stream) {
      this.localAnalyser = a.ctx.createAnalyser();
      this.localAnalyser.fftSize = 512;
      a.ctx.createMediaStreamSource(this.stream).connect(this.localAnalyser);
    }
    this.started = true;
    this.applyGates();
    return this.stream !== null;
  }

  /** Arma o cierra conexiones segun quienes estan conectados ahora. */
  syncPeers(connected: string[]): void {
    if (!this.started) return;
    const others = new Set(connected.filter((n) => n !== this.me));
    for (const nick of [...this.peers.keys()]) {
      if (!others.has(nick)) this.closePeer(nick);
    }
    for (const nick of others) {
      if (this.peers.has(nick)) continue;
      // Ofrece el de nickname menor. El otro le avisa que esta listo ("hello"), porque
      // una oferta que llego antes de que tuviera el micro se perdio.
      if (this.me < nick) void this.offer(nick, this.createPeer(nick));
      else if (!this.helloSent.has(nick)) {
        this.helloSent.add(nick);
        this.send(nick, { type: "hello" });
      }
    }
  }

  async onSignal(from: string, data: Signal): Promise<void> {
    try {
      if (!this.started) return; // al arrancar mandamos "hello" y el otro vuelve a ofrecer
      if (data.type === "hello") {
        if (this.me >= from) return;
        if (this.peers.has(from)) this.closePeer(from);
        await this.offer(from, this.createPeer(from));
      } else if (data.type === "offer") {
        // Una oferta nueva de alguien que ya tenia conexion = volvio a entrar: de cero.
        if (this.peers.has(from)) this.closePeer(from);
        const peer = this.createPeer(from);
        await peer.pc.setRemoteDescription({ type: "offer", sdp: data.sdp });
        await this.flushIce(peer);
        const answer = await peer.pc.createAnswer();
        await peer.pc.setLocalDescription(answer);
        this.send(from, { type: "answer", sdp: answer.sdp ?? "" });
      } else if (data.type === "answer") {
        const peer = this.peers.get(from);
        if (!peer || peer.pc.signalingState !== "have-local-offer") return;
        await peer.pc.setRemoteDescription({ type: "answer", sdp: data.sdp });
        await this.flushIce(peer);
      } else if (data.type === "ice") {
        const peer = this.peers.get(from);
        if (!peer) return;
        if (peer.pc.remoteDescription) await peer.pc.addIceCandidate(data.candidate);
        else peer.pendingIce.push(data.candidate);
      }
    } catch (err) {
      console.warn("[imitame] chat de voz:", err);
    }
  }

  /** La fase del juego abre o cierra la mesa (escuchar la referencia, grabar, tomas). */
  setOpen(open: boolean): void {
    this.open = open;
    this.applyGates();
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    this.applyGates();
    return this.muted;
  }

  get isMuted(): boolean {
    return this.muted;
  }

  get hasMic(): boolean {
    return this.stream !== null;
  }

  /** Nivel de voz de un jugador (0 si la mesa esta cerrada o no habla). */
  level(nick: string): number {
    if (!this.open) return 0;
    if (nick === this.me) return this.muted ? 0 : this.rms(this.localAnalyser);
    return this.rms(this.peers.get(nick)?.analyser ?? null);
  }

  dispose(): void {
    for (const nick of [...this.peers.keys()]) this.closePeer(nick);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
  }

  // ---------- Internos ----------

  private createPeer(nick: string): Peer {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const audio = new Audio();
    audio.autoplay = true;
    const peer: Peer = { pc, audio, analyser: null, pendingIce: [] };
    this.peers.set(nick, peer);

    if (this.stream) {
      for (const track of this.stream.getAudioTracks()) pc.addTrack(track, this.stream);
    } else {
      // Sin micro igual se quiere escuchar a los demas.
      pc.addTransceiver("audio", { direction: "recvonly" });
    }
    pc.onicecandidate = (e) => {
      if (e.candidate) this.send(nick, { type: "ice", candidate: e.candidate.toJSON() });
    };
    pc.ontrack = (e) => {
      const [remote] = e.streams;
      const stream = remote ?? new MediaStream([e.track]);
      // Chrome no hace sonar un stream remoto por Web Audio si no esta tambien en un
      // elemento de audio: el elemento es la salida y el analizador solo mide.
      audio.srcObject = stream;
      void audio.play().catch(() => {});
      const a = getAudio();
      if (a) {
        peer.analyser = a.ctx.createAnalyser();
        peer.analyser.fftSize = 512;
        a.ctx.createMediaStreamSource(stream).connect(peer.analyser);
      }
      this.applyGates();
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed") {
        this.closePeer(nick);
        // Se reintenta en el proximo syncPeers (cada snapshot del server).
      }
    };
    return peer;
  }

  private async offer(nick: string, peer: Peer): Promise<void> {
    try {
      const offer = await peer.pc.createOffer();
      await peer.pc.setLocalDescription(offer);
      this.send(nick, { type: "offer", sdp: offer.sdp ?? "" });
    } catch (err) {
      console.warn("[imitame] chat de voz (oferta):", err);
    }
  }

  private async flushIce(peer: Peer): Promise<void> {
    for (const c of peer.pendingIce.splice(0)) {
      try {
        await peer.pc.addIceCandidate(c);
      } catch {
        // Un candidato viejo no rompe nada.
      }
    }
  }

  private closePeer(nick: string): void {
    const peer = this.peers.get(nick);
    if (!peer) return;
    peer.pc.close();
    peer.audio.srcObject = null;
    this.peers.delete(nick);
    this.helloSent.delete(nick);
  }

  private applyGates(): void {
    const talk = this.open && !this.muted;
    this.stream?.getAudioTracks().forEach((t) => (t.enabled = talk));
    for (const peer of this.peers.values()) peer.audio.muted = !this.open;
  }

  private rms(analyser: AnalyserNode | null): number {
    if (!analyser) return 0;
    analyser.getFloatTimeDomainData(this.levelBuf);
    let sum = 0;
    for (let i = 0; i < this.levelBuf.length; i++) sum += this.levelBuf[i] * this.levelBuf[i];
    return Math.sqrt(sum / this.levelBuf.length);
  }
}
