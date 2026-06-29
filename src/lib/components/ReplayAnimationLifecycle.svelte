<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte';
  import { serializeAnimationAnchor } from '../animations/animationAnchors';
  import { replayAnimationVisibility, type AnimationVisibilityClaim, type AnimationVisibilityToken } from '../animations/animationVisibility';
  import { releaseAnimationVisibilityScope } from '../animations/animationVisibilityClaims';
  import type { AnimationHandoffPolicy, ReplayAnimationPhasePlan } from '../animations/replayAnimationPlan';

  type Props = {
    active?: boolean;
    scopeKey?: string | number;
    animationPlan?: ReplayAnimationPhasePlan;
  };

  let {
    active = false,
    scopeKey = '',
    animationPlan,
  }: Props = $props();

  let lastScopeKey: string | undefined;
  let lastPlan: ReplayAnimationPhasePlan | undefined;
  let planTokens: AnimationVisibilityToken[] = [];
  const planTokenReleaseTimers: ReturnType<typeof setTimeout>[] = [];
  const staleScopeReleaseTimers: ReturnType<typeof setTimeout>[] = [];
  let refreshGeneration = 0;
  let reduceMotion = $state(false);

  type TargetMotionTiming = {
    identity?: { serial?: number; cardId?: number };
    startMs: number;
    durationMs: number;
    handoffPolicy: AnimationHandoffPolicy;
  };

  onMount(() => {
    if (typeof window.matchMedia !== 'function') {
      return;
    }
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const updateMotionPreference = () => {
      reduceMotion = media.matches;
    };
    updateMotionPreference();
    media.addEventListener('change', updateMotionPreference);
    return () => media.removeEventListener('change', updateMotionPreference);
  });

  onDestroy(() => {
    releasePlanTokens();
    clearStaleScopeReleaseTimers();
    if (lastScopeKey) {
      releaseAnimationVisibilityScope(lastScopeKey);
      lastScopeKey = undefined;
    }
  });

  $effect(() => {
    const currentScopeKey = String(scopeKey);
    const currentPlan = animationPlan;
    const currentActive = active;
    const scopeChanged = lastScopeKey !== undefined && lastScopeKey !== currentScopeKey;
    const planChanged = lastPlan !== currentPlan;

    if (!currentActive) {
      releasePlanTokens();
      clearStaleScopeReleaseTimers();
      if (lastScopeKey) {
        releaseAnimationVisibilityScope(lastScopeKey);
        lastScopeKey = undefined;
      }
      lastPlan = undefined;
      scheduleVisibilityRefresh();
      return;
    }

    if (scopeChanged && lastScopeKey) {
      releasePlanTokens();
      scheduleStaleScopeRelease(lastScopeKey);
    } else if (planChanged) {
      releasePlanTokens();
    }

    lastScopeKey = currentScopeKey;
    lastPlan = currentPlan;

    if (!reduceMotion && currentPlan?.visibilityClaims.length) {
      for (const claim of currentPlan.visibilityClaims) {
        const token = replayAnimationVisibility.hide({
          ...claim,
          scopeKey: currentScopeKey,
        });
        const releaseMs = visibilityClaimReleaseMs(currentPlan, claim);
        planTokens = [...planTokens, token];
        const releaseTimer = setTimeout(() => {
          replayAnimationVisibility.release(token);
          planTokens = planTokens.filter((candidate) => candidate !== token);
          const timerIndex = planTokenReleaseTimers.indexOf(releaseTimer);
          if (timerIndex >= 0) {
            planTokenReleaseTimers.splice(timerIndex, 1);
          }
          scheduleVisibilityRefresh();
        }, releaseMs);
        planTokenReleaseTimers.push(releaseTimer);
      }
    }

    scheduleVisibilityRefresh();
  });

  function releasePlanTokens() {
    for (const timer of planTokenReleaseTimers) {
      clearTimeout(timer);
    }
    planTokenReleaseTimers.length = 0;
    for (const token of planTokens) {
      replayAnimationVisibility.release(token);
    }
    planTokens = [];
  }

  function visibilityClaimReleaseMs(plan: ReplayAnimationPhasePlan, claim: AnimationVisibilityClaim): number {
    const motion = matchingMotionForClaim(plan, claim);
    if (!motion) {
      return Math.min(plan.durationMs, 240);
    }
    if (claim.role === 'source') {
      if (motion.handoffPolicy.hideSourceUntil === 'phase-end') {
        return plan.durationMs;
      }
      if (motion.handoffPolicy.hideSourceUntil === 'snapshot') {
        return motion.startMs;
      }
      return 0;
    }
    if (motion.handoffPolicy.hideDestinationUntil === 'prepaint') {
      return motion.startMs + Math.round(motion.durationMs * 0.88);
    }
    if (motion.handoffPolicy.hideDestinationUntil === 'arrival') {
      return motion.startMs + motion.durationMs;
    }
    return 0;
  }

  function matchingMotionForClaim(plan: ReplayAnimationPhasePlan, claim: AnimationVisibilityClaim): TargetMotionTiming | undefined {
    const claimAnchorKey = serializeAnimationAnchor(claim.anchor);
    for (const motion of plan.motions) {
      if (
        claim.role === 'source'
        && 'sourceAnchor' in motion
        && serializeAnimationAnchor(motion.sourceAnchor) === claimAnchorKey
        && motionIdentityMatchesClaim(motion.identity, claim)
      ) {
        return motion;
      }
      if (
        claim.role !== 'source'
        && 'targetAnchor' in motion
        && serializeAnimationAnchor(motion.targetAnchor) === claimAnchorKey
        && motionIdentityMatchesClaim(motion.identity, claim)
      ) {
        return motion;
      }
      if (motion.kind !== 'reveal-session') {
        continue;
      }
      for (const step of motion.steps) {
        if (
          claim.role === 'source'
          && step.sourceAnchor
          && step.handoffPolicy
          && serializeAnimationAnchor(step.sourceAnchor) === claimAnchorKey
          && motionIdentityMatchesClaim(step.identity, claim)
        ) {
          return {
            identity: step.identity,
            startMs: motion.startMs + step.startMs,
            durationMs: step.durationMs,
            handoffPolicy: step.handoffPolicy,
          };
        }
        if (
          claim.role !== 'source'
          && step.targetAnchor
          && step.handoffPolicy
          && serializeAnimationAnchor(step.targetAnchor) === claimAnchorKey
          && motionIdentityMatchesClaim(step.identity, claim)
        ) {
          return {
            identity: step.identity,
            startMs: motion.startMs + step.startMs,
            durationMs: step.durationMs,
            handoffPolicy: step.handoffPolicy,
          };
        }
      }
    }
    return undefined;
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

  function scheduleStaleScopeRelease(scopeKey: string) {
    const timer = setTimeout(() => {
      const timerIndex = staleScopeReleaseTimers.indexOf(timer);
      if (timerIndex >= 0) {
        staleScopeReleaseTimers.splice(timerIndex, 1);
      }
      if (lastScopeKey !== scopeKey) {
        releaseAnimationVisibilityScope(scopeKey);
        scheduleVisibilityRefresh();
      }
    }, 220);
    staleScopeReleaseTimers.push(timer);
  }

  function clearStaleScopeReleaseTimers() {
    for (const timer of staleScopeReleaseTimers) {
      clearTimeout(timer);
    }
    staleScopeReleaseTimers.length = 0;
  }

  function scheduleVisibilityRefresh() {
    const generation = ++refreshGeneration;
    void tick().then(() => {
      if (generation === refreshGeneration) {
        replayAnimationVisibility.refresh();
      }
    });
  }

</script>
