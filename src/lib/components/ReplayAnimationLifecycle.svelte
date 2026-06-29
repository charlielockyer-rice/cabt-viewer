<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte';
  import { replayAnimationVisibility, type AnimationVisibilityToken } from '../animations/animationVisibility';
  import { releaseAnimationVisibilityScope } from '../animations/animationVisibilityClaims';
  import { replayAnimationClaimTiming, replayAnimationScopeExitSettleMs } from '../animations/replayAnimationHandoff';
  import type { ReplayAnimationPhasePlan } from '../animations/replayAnimationPlan';

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
  let lastReduceMotion = false;
  let planTokens: AnimationVisibilityToken[] = [];
  const planTokenStartTimers: ReturnType<typeof setTimeout>[] = [];
  const planTokenReleaseTimers: ReturnType<typeof setTimeout>[] = [];
  const delayedPlanTokenReleaseTimers: {
    timer: ReturnType<typeof setTimeout>;
    tokens: AnimationVisibilityToken[];
  }[] = [];
  const staleScopeReleaseTimers: ReturnType<typeof setTimeout>[] = [];
  let refreshGeneration = 0;
  let reduceMotion = $state(false);

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
    const motionPreferenceChanged = lastReduceMotion !== reduceMotion;
    const scopeChanged = lastScopeKey !== undefined && lastScopeKey !== currentScopeKey;
    const planChanged = lastPlan !== currentPlan;
    lastReduceMotion = reduceMotion;

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
      releasePlanTokens({ delayMs: replayAnimationScopeExitSettleMs });
      scheduleStaleScopeRelease(lastScopeKey);
    } else if (planChanged || motionPreferenceChanged) {
      releasePlanTokens();
    }

    lastScopeKey = currentScopeKey;
    lastPlan = currentPlan;

    if (currentPlan?.visibilityClaims.length) {
      // Reduced motion renders no replacement sprite, so the final DOM stays visible.
      const claims = reduceMotion ? [] : currentPlan.visibilityClaims;
      for (const claim of claims) {
        const timing = replayAnimationClaimTiming(currentPlan, claim);
        if (!timing) {
          continue;
        }
        const startMs = timing.startMs;
        const startClaim = () => {
          const token = replayAnimationVisibility.hide({
            ...claim,
            scopeKey: currentScopeKey,
          });
          const releaseMs = timing.releaseMs;
          planTokens = [...planTokens, token];
          if (releaseMs === undefined) {
            return;
          }
          const releaseTimer = setTimeout(() => {
            replayAnimationVisibility.release(token);
            planTokens = planTokens.filter((candidate) => candidate !== token);
            const timerIndex = planTokenReleaseTimers.indexOf(releaseTimer);
            if (timerIndex >= 0) {
              planTokenReleaseTimers.splice(timerIndex, 1);
            }
            scheduleVisibilityRefresh();
          }, Math.max(0, releaseMs - startMs));
          planTokenReleaseTimers.push(releaseTimer);
        };
        if (startMs <= 0) {
          startClaim();
          continue;
        }
        const startTimer = setTimeout(() => {
          const timerIndex = planTokenStartTimers.indexOf(startTimer);
          if (timerIndex >= 0) {
            planTokenStartTimers.splice(timerIndex, 1);
          }
          startClaim();
        }, startMs);
        planTokenStartTimers.push(startTimer);
      }
    }

    scheduleVisibilityRefresh();
  });

  function releasePlanTokens({ delayMs = 0 }: { delayMs?: number } = {}) {
    flushDelayedPlanTokenReleases();
    for (const timer of planTokenStartTimers) {
      clearTimeout(timer);
    }
    planTokenStartTimers.length = 0;
    for (const timer of planTokenReleaseTimers) {
      clearTimeout(timer);
    }
    planTokenReleaseTimers.length = 0;
    const tokens = planTokens;
    planTokens = [];
    if (delayMs > 0 && tokens.length) {
      scheduleDelayedPlanTokenRelease(tokens, delayMs);
      return;
    }
    for (const token of tokens) {
      replayAnimationVisibility.release(token);
    }
  }

  function scheduleDelayedPlanTokenRelease(tokens: AnimationVisibilityToken[], delayMs: number) {
    const delayedRelease = {
      tokens,
      timer: setTimeout(() => {
        const timerIndex = delayedPlanTokenReleaseTimers.indexOf(delayedRelease);
        if (timerIndex >= 0) {
          delayedPlanTokenReleaseTimers.splice(timerIndex, 1);
        }
        releaseTokens(tokens);
      }, delayMs),
    };
    delayedPlanTokenReleaseTimers.push(delayedRelease);
  }

  function flushDelayedPlanTokenReleases() {
    const delayedReleases = delayedPlanTokenReleaseTimers.splice(0);
    for (const delayedRelease of delayedReleases) {
      clearTimeout(delayedRelease.timer);
      releaseTokens(delayedRelease.tokens);
    }
  }

  function releaseTokens(tokens: AnimationVisibilityToken[]) {
    for (const token of tokens) {
      replayAnimationVisibility.release(token);
    }
    scheduleVisibilityRefresh();
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
