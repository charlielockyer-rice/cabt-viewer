import { serializeAnimationAnchor } from './animationAnchors';
import type { AnimationVisibilityClaim } from './animationVisibility';
import type { AnimationHandoffPolicy, ReplayAnimationPhasePlan } from './replayAnimationPlan';

type ClaimTimingMotion = {
  identity?: { serial?: number; cardId?: number };
  startMs: number;
  durationMs: number;
  handoffPolicy: AnimationHandoffPolicy;
};

export type ReplayAnimationClaimTiming = {
  startMs: number;
  releaseMs?: number;
};

export const replayAnimationScopeExitSettleMs = 40;
export const replayAnimationArrivalSettleMs = 24;

export function replayAnimationClaimTiming(
  plan: ReplayAnimationPhasePlan,
  claim: AnimationVisibilityClaim,
): ReplayAnimationClaimTiming | undefined {
  const motion = replayAnimationMotionForClaim(plan, claim);
  if (!motion) {
    return undefined;
  }
  return {
    startMs: replayAnimationClaimStartMs(motion, claim),
    releaseMs: replayAnimationClaimReleaseMs(plan, motion, claim),
  };
}

export function replayAnimationSpriteRemovalMs(
  motion: Pick<ClaimTimingMotion, 'startMs' | 'durationMs' | 'handoffPolicy'>,
  phaseDurationMs?: number,
): number | undefined {
  if (motion.handoffPolicy.removeSprite === 'scope-exit') {
    return undefined;
  }
  if (motion.handoffPolicy.removeSprite === 'phase-end') {
    return phaseDurationMs ?? (motion.startMs + motion.durationMs);
  }
  if (motion.handoffPolicy.removeSprite === 'arrival') {
    return motion.startMs + motion.durationMs + replayAnimationArrivalSettleMs;
  }
  return motion.startMs + motion.durationMs;
}

export function replayAnimationSpriteGroupRemovalMs(
  motions: Pick<ClaimTimingMotion, 'startMs' | 'durationMs' | 'handoffPolicy'>[],
  phaseDurationMs?: number,
): number | undefined {
  const removals = motions.map((motion) => replayAnimationSpriteRemovalMs(motion, phaseDurationMs));
  if (removals.some((removal) => removal === undefined)) {
    return undefined;
  }
  return Math.max(...removals.filter((removal): removal is number => removal !== undefined));
}

export function replayAnimationMotionForClaim(
  plan: ReplayAnimationPhasePlan,
  claim: AnimationVisibilityClaim,
): ClaimTimingMotion | undefined {
  if (!claim.motionId) {
    return undefined;
  }
  const motion = plan.motions.find((candidate) => candidate.id === claim.motionId);
  if (!motion) {
    return undefined;
  }
  if (motion.kind === 'card-move') {
    const motionAnchor = claim.role === 'source' ? motion.sourceAnchor : motion.targetAnchor;
    if (!anchorMatchesClaim(motionAnchor, claim) || !motionIdentityMatchesClaim(motion.identity, claim)) {
      return undefined;
    }
    return motion;
  }
  if (motion.kind === 'reveal-session') {
    const step = claim.stepId ? motion.steps.find((candidate) => candidate.id === claim.stepId) : undefined;
    if (!step?.handoffPolicy) {
      return undefined;
    }
    const stepAnchor = claim.role === 'source' ? step.sourceAnchor : step.targetAnchor;
    if (!stepAnchor || !anchorMatchesClaim(stepAnchor, claim) || !motionIdentityMatchesClaim(step.identity, claim)) {
      return undefined;
    }
    return {
      identity: step.identity,
      startMs: motion.startMs + step.startMs,
      durationMs: step.durationMs,
      handoffPolicy: step.handoffPolicy,
    };
  }
  return undefined;
}

function replayAnimationClaimStartMs(motion: ClaimTimingMotion, claim: AnimationVisibilityClaim): number {
  if (claim.role !== 'source') {
    return 0;
  }
  return motion.startMs;
}

function replayAnimationClaimReleaseMs(
  plan: ReplayAnimationPhasePlan,
  motion: ClaimTimingMotion,
  claim: AnimationVisibilityClaim,
): number | undefined {
  if (claim.role === 'source') {
    if (motion.handoffPolicy.hideSourceUntil === 'scope-exit') {
      return undefined;
    }
    if (motion.handoffPolicy.hideSourceUntil === 'phase-end') {
      return plan.durationMs;
    }
    if (motion.handoffPolicy.hideSourceUntil === 'snapshot') {
      return motion.startMs;
    }
    return 0;
  }
  if (motion.handoffPolicy.hideDestinationUntil === 'prepaint') {
    return motion.startMs + motion.durationMs;
  }
  if (motion.handoffPolicy.hideDestinationUntil === 'arrival') {
    return motion.startMs + motion.durationMs + replayAnimationArrivalSettleMs;
  }
  return 0;
}

function anchorMatchesClaim(anchor: AnimationVisibilityClaim['anchor'], claim: AnimationVisibilityClaim): boolean {
  return serializeAnimationAnchor(anchor) === serializeAnimationAnchor(claim.anchor);
}

function motionIdentityMatchesClaim(
  identity: { serial?: number; cardId?: number } | undefined,
  claim: AnimationVisibilityClaim,
): boolean {
  const claimIdentity = claim.identity;
  if (!identity || !claimIdentity) {
    return true;
  }
  if (identity.serial !== undefined && claimIdentity.serial !== undefined) {
    return identity.serial === claimIdentity.serial;
  }
  if (identity.cardId !== undefined && claimIdentity.cardId !== undefined) {
    return identity.cardId === claimIdentity.cardId;
  }
  return true;
}
