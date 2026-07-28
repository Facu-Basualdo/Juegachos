export interface ChainStep {
  type: "text" | "drawing";
  author: string;
  content: string;
}

export interface GameChain {
  ownerId: string;
  steps: ChainStep[];
}

export interface IGameAdapter {
  submitStep(step: ChainStep): Promise<void>;
  getChain(ownerId: string): Promise<GameChain>;
  onPhaseChange(callback: (phase: string) => void): void;
}
