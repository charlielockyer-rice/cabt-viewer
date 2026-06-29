import type { CardView, GameView } from '../game/types';
import type { ActionAnimationPhaseKind } from '../cabt/actionAnimationPhases';
import {
  serializeAnimationAnchor,
  serializeAnimationIdentity,
  type AnimationAnchorRef,
  type AnimationIdentity,
} from './animationAnchors';
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
      kind: 'pulse';
      tone: 'ability' | 'attack' | 'damage' | 'neutral';
    };

export type AnimationHandoffPolicy = {
  hideSourceUntil: 'none' | 'snapshot' | 'phase-end' | 'scope-exit';
  hideDestinationUntil: 'none' | 'arrival' | 'prepaint';
  removeSprite: 'arrival' | 'prepaint' | 'phase-end' | 'scope-exit';
  prepaintFrames?: number;
};

export type CardMoveAnimationPurpose = 'resolving-cleanup';

export type TimedAnimationMotionBase = {
  id: string;
  identity?: AnimationIdentity;
  startMs: number;
  durationMs: number;
};

export type CardMoveAnimationMotion = TimedAnimationMotionBase & {
  kind: 'card-move';
  purpose?: CardMoveAnimationPurpose;
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
  kind: ReplayAnimationPhaseKind;
  playerIndex?: number;
  label?: string;
  view: GameView;
  durationMs: number;
  motions: AnimationMotion[];
  visibilityClaims: AnimationVisibilityClaim[];
};

export type ReplayAnimationPhaseKind = ActionAnimationPhaseKind;

export function isResolvingCleanupCardMoveMotion(motion: CardMoveAnimationMotion): boolean {
  return motion.purpose === 'resolving-cleanup'
    && motion.coordinateSpace === 'board'
    && motion.sourceAnchor.kind === 'play-zone-card'
    && motion.targetAnchor.kind === 'discard-card'
    && motion.identity?.kind === 'card'
    && motion.identity.serial !== undefined
    && motion.sourceAnchor.serial === motion.identity.serial
    && motion.targetAnchor.serial === motion.identity.serial;
}

export function createReplayAnimationPhasePlan(input: {
  key: string;
  kind: ReplayAnimationPhaseKind;
  playerIndex?: number;
  label?: string;
  view: GameView;
  durationMs: number;
  motions?: AnimationMotion[];
}): ReplayAnimationPhasePlan {
  const motions = input.motions ?? [];
  const visibilityClaims = replayAnimationVisibilityClaimsForMotions(input.key, motions);
  assertFiniteNonNegative(input.durationMs, 'durationMs');

  for (const motion of motions) {
    validateMotionTiming(motion);
    validateMotionCoordinateSpace(input.key, motion);
    validateMotionPurpose(input.key, motion);
  }
  validateVisibilityClaims(input.key, motions, visibilityClaims);

  const motionSpanMs = replayAnimationMotionSpanMs(motions);
  if (input.durationMs < motionSpanMs) {
    throw new Error(`Replay animation phase "${input.key}" duration ${input.durationMs}ms is shorter than motion span ${motionSpanMs}ms.`);
  }

  return {
    key: input.key,
    kind: input.kind,
    playerIndex: input.playerIndex,
    label: input.label,
    view: input.view,
    durationMs: input.durationMs,
    motions,
    visibilityClaims,
  };
}

export function replayAnimationVisibilityClaimsForMotions(
  scopeKey: string,
  motions: readonly AnimationMotion[],
): AnimationVisibilityClaim[] {
  const claims: AnimationVisibilityClaim[] = [];
  for (const motion of motions) {
    if (motion.kind === 'card-move') {
      appendMotionVisibilityClaim(claims, {
        scopeKey,
        motionId: motion.id,
        anchor: motion.sourceAnchor,
        identity: motion.identity,
        role: 'source',
        policy: motion.handoffPolicy.hideSourceUntil,
      });
      appendMotionVisibilityClaim(claims, {
        scopeKey,
        motionId: motion.id,
        anchor: motion.targetAnchor,
        identity: motion.identity,
        role: 'destination',
        policy: motion.handoffPolicy.hideDestinationUntil,
      });
      continue;
    }
    if (motion.kind !== 'reveal-session') {
      continue;
    }
    for (const step of motion.steps) {
      appendMotionVisibilityClaim(claims, {
        scopeKey,
        motionId: motion.id,
        stepId: step.id,
        anchor: step.sourceAnchor,
        identity: step.identity,
        role: 'source',
        policy: step.handoffPolicy?.hideSourceUntil,
      });
      appendMotionVisibilityClaim(claims, {
        scopeKey,
        motionId: motion.id,
        stepId: step.id,
        anchor: step.targetAnchor,
        identity: step.identity,
        role: 'destination',
        policy: step.handoffPolicy?.hideDestinationUntil,
      });
    }
  }
  return claims;
}

export function replayAnimationPlanHasPhase(
  plan: Pick<ReplayAnimationPhasePlan, 'kind' | 'playerIndex'> | undefined,
  kind: ReplayAnimationPhaseKind,
  playerIndex?: number,
): boolean {
  if (!plan) {
    return false;
  }
  return plan.kind === kind && (playerIndex === undefined || plan.playerIndex === playerIndex);
}

export function replayAnimationPlanHasAnyPhase(
  plan: Pick<ReplayAnimationPhasePlan, 'kind' | 'playerIndex'> | undefined,
  kinds: readonly ReplayAnimationPhaseKind[],
  playerIndex?: number,
): boolean {
  return kinds.some((kind) => replayAnimationPlanHasPhase(plan, kind, playerIndex));
}

export function replayAnimationPlanOwnsMotion(
  plan: Pick<ReplayAnimationPhasePlan, 'kind' | 'playerIndex'> | undefined,
  motion: AnimationMotion,
  kinds: readonly ReplayAnimationPhaseKind[],
): boolean {
  return replayAnimationPlanHasAnyPhase(plan, kinds, replayAnimationMotionPlayerIndex(motion));
}

export function replayAnimationMotionPlayerIndex(motion: AnimationMotion): number | undefined {
  if (motion.kind === 'reveal-session') {
    return motion.playerIndex;
  }
  if (motion.kind === 'pulse') {
    return playerIndexForAnchor(motion.anchor) ?? playerIndexForAnchor(motion.sourceAnchor);
  }
  if (motion.kind === 'shuffle' || motion.kind === 'settle') {
    return playerIndexForAnchor(motion.anchor);
  }
  return playerIndexForAnchor(motion.sourceAnchor) ?? playerIndexForAnchor(motion.targetAnchor);
}

function playerIndexForAnchor(anchor: AnimationAnchorRef | undefined): number | undefined {
  return anchor && 'playerIndex' in anchor ? anchor.playerIndex : undefined;
}

export function replayAnimationMotionKey(motion: AnimationMotion): string {
  const base = [
    motion.kind,
    motion.id,
    motion.startMs,
    motion.durationMs,
    serializeAnimationIdentity(motion.identity),
  ];
  if (motion.kind === 'card-move') {
    return stableMotionKey([
      ...base,
      motion.purpose ?? '',
      motion.coordinateSpace,
      serializeAnimationAnchor(motion.sourceAnchor),
      serializeAnimationAnchor(motion.targetAnchor),
      spriteVisualKey(motion.spriteVisual),
      handoffPolicyKey(motion.handoffPolicy),
    ]);
  }
  if (motion.kind === 'reveal-session') {
    return stableMotionKey([
      ...base,
      motion.playerIndex,
      motion.coordinateSpace,
      motion.revealCount ?? '',
      handoffPolicyKey(motion.handoffPolicy),
      motion.steps.map((step) => [
        step.kind,
        step.id,
        step.startMs,
        step.durationMs,
        serializeAnimationIdentity(step.identity),
        step.sourceAnchor ? serializeAnimationAnchor(step.sourceAnchor) : '',
        step.targetAnchor ? serializeAnimationAnchor(step.targetAnchor) : '',
        step.spriteVisual ? spriteVisualKey(step.spriteVisual) : '',
        step.handoffPolicy ? handoffPolicyKey(step.handoffPolicy) : '',
      ]),
    ]);
  }
  if (motion.kind === 'pulse') {
    return stableMotionKey([
      ...base,
      motion.coordinateSpace,
      serializeAnimationAnchor(motion.anchor),
      motion.sourceAnchor ? serializeAnimationAnchor(motion.sourceAnchor) : '',
      spriteVisualKey(motion.spriteVisual),
      motion.label ?? '',
      motion.value ?? '',
    ]);
  }
  if (motion.kind === 'shuffle') {
    return stableMotionKey([
      ...base,
      motion.coordinateSpace,
      serializeAnimationAnchor(motion.anchor),
    ]);
  }
  return stableMotionKey([
    ...base,
    motion.coordinateSpace,
    serializeAnimationAnchor(motion.anchor),
    handoffPolicyKey(motion.handoffPolicy),
  ]);
}

export function replayAnimationMotionsKey(motions: readonly AnimationMotion[]): string {
  return motions.map(replayAnimationMotionKey).join('|');
}

export function replayAnimationPhasePlanKey(plan: Pick<ReplayAnimationPhasePlan, 'key' | 'durationMs' | 'motions'> | undefined): string {
  return plan ? `${plan.key}:${plan.durationMs}:${replayAnimationMotionsKey(plan.motions)}` : '';
}

export function replayAnimationMotionSpanMs(motions: readonly AnimationMotion[]): number {
  return motions.reduce((spanMs, motion) => Math.max(spanMs, motion.startMs + motion.durationMs), 0);
}

function validateMotionCoordinateSpace(phaseKey: string, motion: AnimationMotion): void {
  if (motion.kind !== 'card-move') {
    return;
  }
  if (motion.coordinateSpace === 'board') {
    if (!isBoardPlaneAnchor(motion.sourceAnchor) || !isBoardPlaneAnchor(motion.targetAnchor)) {
      throw new Error(`Replay animation phase "${phaseKey}" board motion "${motion.id}" must use board-plane anchors.`);
    }
    return;
  }
  if (motion.coordinateSpace === 'cross-plane') {
    const sourceBoard = isBoardPlaneAnchor(motion.sourceAnchor);
    const targetBoard = isBoardPlaneAnchor(motion.targetAnchor);
    if (sourceBoard === targetBoard) {
      throw new Error(`Replay animation phase "${phaseKey}" cross-plane motion "${motion.id}" must cross between board and viewport anchors.`);
    }
  }
}

function validateMotionPurpose(phaseKey: string, motion: AnimationMotion): void {
  if (motion.kind !== 'card-move' || motion.purpose === undefined) {
    return;
  }
  if (motion.purpose === 'resolving-cleanup' && isResolvingCleanupCardMoveMotion(motion)) {
    return;
  }
  throw new Error(`Replay animation phase "${phaseKey}" card move "${motion.id}" has invalid purpose "${motion.purpose}".`);
}

function stableMotionKey(parts: unknown[]): string {
  return JSON.stringify(parts);
}

function handoffPolicyKey(policy: AnimationHandoffPolicy): string {
  return stableMotionKey([
    policy.hideSourceUntil,
    policy.hideDestinationUntil,
    policy.removeSprite,
    policy.prepaintFrames ?? '',
  ]);
}

function spriteVisualKey(visual: AnimationSpriteVisual): string {
  if (visual.kind === 'pulse') {
    return stableMotionKey([visual.kind, visual.tone]);
  }
  return stableMotionKey([
    visual.kind,
    visual.faceDown === true,
    visual.card?.serial ?? '',
    visual.card?.id ?? '',
    visual.card?.name ?? '',
    visual.card?.imageUrl ?? '',
    visual.card?.cardImage ?? '',
  ]);
}

function isBoardPlaneAnchor(anchor: AnimationAnchorRef): boolean {
  return anchor.kind !== 'hand'
    && anchor.kind !== 'hand-card'
    && anchor.kind !== 'hand-slot'
    && anchor.kind !== 'reveal-card';
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

function appendMotionVisibilityClaim(
  claims: AnimationVisibilityClaim[],
  input: {
    scopeKey: string;
    motionId: string;
    stepId?: string;
    anchor: AnimationAnchorRef | undefined;
    identity: AnimationIdentity | undefined;
    role: AnimationVisibilityClaim['role'];
    policy: AnimationHandoffPolicy['hideSourceUntil'] | AnimationHandoffPolicy['hideDestinationUntil'] | undefined;
  },
) {
  const { scopeKey, motionId, stepId, anchor, identity, role, policy } = input;
  if (!anchor || !policy || policy === 'none') {
    return;
  }
  if (role === 'source' && anchor.kind === 'deck-top') {
    return;
  }
  claims.push({
    scopeKey,
    motionId,
    ...(stepId ? { stepId } : {}),
    anchor,
    identity,
    role,
  });
}

function assertFiniteNonNegative(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`Replay animation timing "${label}" must be a finite non-negative number.`);
  }
}
