import type { GameView } from './types';
import type { ActionTimelineEvent } from './types';
import type { ReplayAnimationPhaseKind, ReplayAnimationPhasePlan } from '../animations/replayAnimationPlan';

export type ReplayPlayerInfo = {
  userId: number;
  name: string;
};

export type ReplayStep = {
  index: number;
  label: string;
  stateIndex: number;
  actionIndex: number | null;
  sequence?: number;
  turn: number;
  phase: number;
  activePlayerIndex: number;
  type: string;
  payload: unknown;
  actionTimeline?: ActionTimelineEvent[];
  displayView?: GameView;
  animationPhases?: ReplayAnimationPhase[];
};

export type ReplayAnimationPhase = {
  key: string;
  kind: ReplayAnimationPhaseKind;
  label?: string;
  view: GameView;
  actionTimeline: ActionTimelineEvent[];
  durationMs: number;
  animationPlan?: ReplayAnimationPhasePlan;
};

export const replayAnimationPhaseGapMs = 120;

export function replayStepPlaybackDelayMs(step: ReplayStep | null | undefined, fallbackDelayMs: number): number {
  const phases = step?.animationPhases;
  if (!phases?.length) {
    return fallbackDelayMs;
  }
  const phaseDurationMs = phases.reduce((totalMs, phase) => totalMs + phase.durationMs + replayAnimationPhaseGapMs, 0);
  return Math.max(fallbackDelayMs, phaseDurationMs);
}

export type ReplaySnapshot = {
  id: string;
  name: string;
  created: number;
  players: ReplayPlayerInfo[];
  winner: number;
  stateCount: number;
  actionCount: number;
  turnCount: number;
  cardNames: string[];
  views: GameView[];
  steps: ReplayStep[];
};

export type ReplayLoadResponse = {
  ok: boolean;
  replay?: ReplaySnapshot;
  error?: string;
};
