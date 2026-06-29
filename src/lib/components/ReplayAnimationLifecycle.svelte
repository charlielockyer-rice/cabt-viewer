<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import { replayAnimationVisibility, type AnimationVisibilityToken } from '../animations/animationVisibility';
  import { releaseAnimationVisibilityScope } from '../animations/animationVisibilityClaims';
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
  let planTokens: AnimationVisibilityToken[] = [];
  let planTokenReleaseTimer: ReturnType<typeof setTimeout> | undefined;
  const staleScopeReleaseTimers: ReturnType<typeof setTimeout>[] = [];
  let refreshGeneration = 0;

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

    if (currentPlan?.visibilityClaims.length) {
      planTokens = currentPlan.visibilityClaims.map((claim) =>
        replayAnimationVisibility.hide({
          ...claim,
          scopeKey: currentScopeKey,
        }));
      const releaseMs = Math.min(currentPlan.durationMs, 240);
      planTokenReleaseTimer = setTimeout(() => {
        releasePlanTokens();
        scheduleVisibilityRefresh();
      }, releaseMs);
    }

    scheduleVisibilityRefresh();
  });

  function releasePlanTokens() {
    if (planTokenReleaseTimer) {
      clearTimeout(planTokenReleaseTimer);
      planTokenReleaseTimer = undefined;
    }
    for (const token of planTokens) {
      replayAnimationVisibility.release(token);
    }
    planTokens = [];
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
