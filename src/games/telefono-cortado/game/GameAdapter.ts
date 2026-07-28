import type { IGameAdapter, GameChain, ChainStep } from "./Types";

export class LocalMockAdapter implements IGameAdapter {
  private chain: GameChain;
  private phaseListeners: ((phase: string) => void)[] = [];

  constructor(ownerId: string) {
    this.chain = { ownerId, steps: [] };
  }

  async submitStep(step: ChainStep): Promise<void> {
    // Si es el primer turno (prompt inicial) y estamos en LocalMock (SinglePlayer),
    // guardamos nuestro prompt, pero simulamos que nos rotan una cadena de un Bot.
    if (step.type === "text" && this.chain.steps.length === 0) {
      const botPhrases = [
        "Un gato tocando el piano",
        "Un astronauta comiendo pizza",
        "Un dinosaurio en monopatin",
        "Una vaca abducida por aliens"
      ];
      const randomBotPhrase = botPhrases[Math.floor(Math.random() * botPhrases.length)];
      
      this.chain = {
        ownerId: "Bot_123",
        steps: [{
          type: "text",
          author: "Bot_123",
          content: randomBotPhrase
        }]
      };
    } else {
      this.chain.steps.push(step);
    }

    setTimeout(() => {
      this.triggerPhaseChange(step.type === "text" ? "drawing_phase" : "text_phase");
    }, 500);
  }

  async getChain(_ownerId: string): Promise<GameChain> {
    return this.chain;
  }

  onPhaseChange(callback: (phase: string) => void): void {
    this.phaseListeners.push(callback);
  }

  private triggerPhaseChange(phase: string): void {
    for (const listener of this.phaseListeners) {
      listener(phase);
    }
  }
}

export class MultiplayerAdapter implements IGameAdapter {
  private socket: any = null;
  private ownerId: string;
  private phaseListeners: ((phase: string) => void)[] = [];
  
  constructor(ownerId: string) {
    this.ownerId = ownerId;
  }

  async connect(serverUrl: string, code: string): Promise<void> {
    const { io } = await import("socket.io-client");
    const base = serverUrl.replace(/\/$/, "");
    this.socket = io(`${base}/telefono-cortado`, {
      transports: ["websocket"],
      reconnection: true,
    });
    
    this.socket.on("connect", () => {
      this.socket.emit("join", { code, nickname: this.ownerId });
    });
    
    this.socket.on("phase_changed", (data: { phase: string }) => {
      for (const listener of this.phaseListeners) {
        listener(data.phase);
      }
    });
  }

  async submitStep(step: ChainStep): Promise<void> {
    if (this.socket) {
      this.socket.emit("submit_step", { ownerId: this.ownerId, step });
    }
  }

  async getChain(ownerId: string): Promise<GameChain> {
    return new Promise((resolve) => {
      if (!this.socket) return resolve({ ownerId, steps: [] });
      this.socket.emit("get_chain", { ownerId }, (response: GameChain) => {
        resolve(response);
      });
    });
  }

  onPhaseChange(callback: (phase: string) => void): void {
    this.phaseListeners.push(callback);
  }
}
