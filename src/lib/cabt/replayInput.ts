import type { CabtReplayCardRef } from './replayCardData';

export type CabtCardRef = CabtReplayCardRef;

export type CabtPokemonRef = CabtCardRef & {
  hp?: number;
  maxHp?: number;
  energies?: number[];
  energyCards?: CabtCardRef[];
  tools?: CabtCardRef[];
  preEvolution?: CabtCardRef[];
};

export type CabtPlayerFrame = {
  active?: CabtPokemonRef[];
  bench?: CabtPokemonRef[];
  benchMax?: number;
  deckCount?: number;
  discard?: CabtCardRef[];
  hand?: CabtCardRef[];
  handCount?: number;
  prize?: Array<CabtCardRef | null>;
  poisoned?: boolean;
  burned?: boolean;
  asleep?: boolean;
  paralyzed?: boolean;
  confused?: boolean;
};

export type CabtVisualizeFrame = {
  logs?: Array<Record<string, unknown>>;
  select?: Record<string, unknown> | null;
  selected?: unknown;
  action?: unknown;
  obs?: unknown;
  current: {
    turn: number;
    yourIndex: number;
    result: number;
    stadium?: CabtCardRef[];
    players: CabtPlayerFrame[];
  };
};

export type KaggleEnvironment = {
  id?: string;
  title?: string;
  rewards?: number[];
  statuses?: string[];
  steps?: Array<Array<{
    action?: unknown;
    observation?: Record<string, unknown>;
    status?: string;
    reward?: number;
    visualize?: unknown;
  }>>;
  info?: {
    TeamNames?: string[];
    EpisodeId?: string | number;
  };
};

type KaggleContext = {
  environment?: KaggleEnvironment;
};

type CabtRunnerJson = {
  visualize?: CabtVisualizeFrame[];
  steps?: Array<{ index?: number; action?: unknown; observation?: unknown }>;
};

export function extractVisualizeFrames(input: unknown): CabtVisualizeFrame[] {
  const runnerFrames = (input as CabtRunnerJson)?.visualize;
  if (Array.isArray(runnerFrames)) {
    return runnerFrames as CabtVisualizeFrame[];
  }

  const steps = replayEnvironment(input)?.steps;
  const frames = steps?.[0]?.[0]?.observation?.visualize;
  if (Array.isArray(frames)) {
    return frames as CabtVisualizeFrame[];
  }

  const firstStepFrames = (steps?.[0]?.[0] as { visualize?: unknown } | undefined)?.visualize;
  if (Array.isArray(firstStepFrames)) {
    return firstStepFrames as CabtVisualizeFrame[];
  }
  return [];
}

export function replayEnvironment(input: unknown): KaggleEnvironment | undefined {
  const wrapped = (input as KaggleContext)?.environment;
  if (wrapped?.steps) {
    return wrapped;
  }
  const topLevel = input as KaggleEnvironment;
  if (Array.isArray(topLevel?.steps)) {
    return topLevel;
  }
  return wrapped;
}

export function replayPlayerNames(input: unknown): string[] {
  const names = replayEnvironment(input)?.info?.TeamNames;
  return names?.length ? names : ['Player 1', 'Player 2'];
}
