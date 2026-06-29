import type { CardView, GameView } from '../game/types';
import type { AnimationAnchorRef, AnimationIdentity } from './animationAnchors';
import type { AnimationVisibilityClaim } from './animationVisibility';

export type { AnimationAnchorRef, AnimationIdentity } from './animationAnchors';
export type { AnimationVisibilityClaim } from './animationVisibility';

export type AnimationCoordinateSpace = 'board' | 'viewport' | 'cross-plane';

export type AnimationSpriteVisual =
  | {
      kind: 'card';
      card?: Pick<CardView, 'id' | 'serial' | 'name' | 'fullName' | 'cardImage' | 'imageUrl'>;
      faceDown?: boolean;
    }
  | {
      kind: 'anchor-snapshot';
      anchor: AnimationAnchorRef;
    }
  | {
      kind: 'pulse';
      tone: 'ability' | 'attack' | 'damage' | 'neutral';
    };

export type AnimationHandoffPolicy = {
  hideSourceUntil: 'none' | 'snapshot' | 'phase-end' | 'scope-exit';
  hideDestinationUntil: 'none' | 'arrival' | 'prepaint';
  removeSprite: 'arrival' | 'prepaint' | 'phase-end' | 'scope-exit';
  prepaintFrames?: number;
};

export type TimedAnimationMotionBase = {
  id: string;
  identity?: AnimationIdentity;
  startMs: number;
  durationMs: number;
};

export type CardMoveAnimationMotion = TimedAnimationMotionBase & {
  kind: 'card-move';
  sourceAnchor: AnimationAnchorRef;
  targetAnchor: AnimationAnchorRef;
  coordinateSpace: AnimationCoordinateSpace;
  spriteVisual: AnimationSpriteVisual;
  handoffPolicy: AnimationHandoffPolicy;
};

export type RevealSessionStep = TimedAnimationMotionBase & {
  kind: 'reveal' | 'select' | 'return' | 'take' | 'attach' | 'shuffle';
  sourceAnchor?: AnimationAnchorRef;
  targetAnchor?: AnimationAnchorRef;
  spriteVisual?: AnimationSpriteVisual;
  handoffPolicy?: AnimationHandoffPolicy;
};

export type RevealSessionAnimationMotion = TimedAnimationMotionBase & {
  kind: 'reveal-session';
  playerIndex: number;
  coordinateSpace: 'viewport';
  revealCount?: number;
  steps: RevealSessionStep[];
  handoffPolicy: AnimationHandoffPolicy;
};

export type PulseAnimationMotion = TimedAnimationMotionBase & {
  kind: 'pulse';
  anchor: AnimationAnchorRef;
  sourceAnchor?: AnimationAnchorRef;
  coordinateSpace: AnimationCoordinateSpace;
  spriteVisual: AnimationSpriteVisual;
  label?: string;
  value?: number;
};

export type ShuffleAnimationMotion = TimedAnimationMotionBase & {
  kind: 'shuffle';
  anchor: AnimationAnchorRef;
  coordinateSpace: AnimationCoordinateSpace;
};

export type SettleAnimationMotion = TimedAnimationMotionBase & {
  kind: 'settle';
  anchor: AnimationAnchorRef;
  coordinateSpace: AnimationCoordinateSpace;
  handoffPolicy: AnimationHandoffPolicy;
};

export type AnimationMotion =
  | CardMoveAnimationMotion
  | RevealSessionAnimationMotion
  | PulseAnimationMotion
  | ShuffleAnimationMotion
  | SettleAnimationMotion;

export type ReplayAnimationPhasePlan = {
  key: string;
  label?: string;
  view: GameView;
  durationMs: number;
  motions: AnimationMotion[];
  visibilityClaims: AnimationVisibilityClaim[];
};

export type ReplayAnimationMotionTiming = {
  id: string;
  startMs: number;
  durationMs: number;
  endMs: number;
};

export function createReplayAnimationPhasePlan(input: {
  key: string;
  label?: string;
  view: GameView;
  durationMs: number;
  motions?: AnimationMotion[];
  visibilityClaims?: AnimationVisibilityClaim[];
}): ReplayAnimationPhasePlan {
  const motions = input.motions ?? [];
  const visibilityClaims = input.visibilityClaims ?? [];
  assertFiniteNonNegative(input.durationMs, 'durationMs');

  for (const motion of motions) {
    validateMotionTiming(motion);
  }
  validateVisibilityClaims(input.key, motions, visibilityClaims);

  const motionSpanMs = replayAnimationMotionSpanMs(motions);
  if (input.durationMs < motionSpanMs) {
    throw new Error(`Replay animation phase "${input.key}" duration ${input.durationMs}ms is shorter than motion span ${motionSpanMs}ms.`);
  }

  return {
    key: input.key,
    label: input.label,
    view: input.view,
    durationMs: input.durationMs,
    motions,
    visibilityClaims,
  };
}

export function replayAnimationMotionTiming(motion: AnimationMotion): ReplayAnimationMotionTiming {
  return {
    id: motion.id,
    startMs: motion.startMs,
    durationMs: motion.durationMs,
    endMs: motion.startMs + motion.durationMs,
  };
}

export function replayAnimationMotionTimings(plan: Pick<ReplayAnimationPhasePlan, 'motions'>): ReplayAnimationMotionTiming[] {
  return plan.motions.map(replayAnimationMotionTiming);
}

export function replayAnimationMotionSpanMs(motions: readonly AnimationMotion[]): number {
  return motions.reduce((spanMs, motion) => Math.max(spanMs, motion.startMs + motion.durationMs), 0);
}

export function replayAnimationPhasePlanDurationMs(plan: Pick<ReplayAnimationPhasePlan, 'durationMs'>): number {
  return plan.durationMs;
}

function validateMotionTiming(motion: AnimationMotion): void {
  assertFiniteNonNegative(motion.startMs, `${motion.id}.startMs`);
  assertFiniteNonNegative(motion.durationMs, `${motion.id}.durationMs`);

  if (motion.kind === 'reveal-session') {
    for (const step of motion.steps) {
      assertFiniteNonNegative(step.startMs, `${motion.id}.${step.id}.startMs`);
      assertFiniteNonNegative(step.durationMs, `${motion.id}.${step.id}.durationMs`);
    }
  }
}

function validateVisibilityClaims(
  phaseKey: string,
  motions: readonly AnimationMotion[],
  claims: readonly AnimationVisibilityClaim[],
): void {
  const motionsById = new Map(motions.map((motion) => [motion.id, motion]));
  for (const claim of claims) {
    if (!claim.motionId) {
      throw new Error(`Replay animation phase "${phaseKey}" visibility claim for ${claim.role} is missing a motion id.`);
    }
    const motion = motionsById.get(claim.motionId);
    if (!motion) {
      throw new Error(`Replay animation phase "${phaseKey}" visibility claim references unknown motion "${claim.motionId}".`);
    }
    if (motion.kind !== 'reveal-session') {
      if (claim.stepId) {
        throw new Error(`Replay animation phase "${phaseKey}" visibility claim for motion "${claim.motionId}" must not include a step id.`);
      }
      continue;
    }
    if (!claim.stepId) {
      throw new Error(`Replay animation phase "${phaseKey}" visibility claim for reveal session "${claim.motionId}" is missing a step id.`);
    }
    if (!motion.steps.some((step) => step.id === claim.stepId)) {
      throw new Error(`Replay animation phase "${phaseKey}" visibility claim references unknown step "${claim.stepId}".`);
    }
  }
}

function assertFiniteNonNegative(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`Replay animation timing "${label}" must be a finite non-negative number.`);
  }
}
