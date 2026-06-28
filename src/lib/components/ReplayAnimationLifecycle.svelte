<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import { replayAnimationVisibility, type AnimationVisibilityToken } from '../animations/animationVisibility';
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
  let refreshGeneration = 0;

  onDestroy(() => {
    releasePlanTokens();
    if (lastScopeKey) {
      replayAnimationVisibility.releaseScope(lastScopeKey);
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
      if (lastScopeKey) {
        replayAnimationVisibility.releaseScope(lastScopeKey);
        lastScopeKey = undefined;
      }
      lastPlan = undefined;
      scheduleVisibilityRefresh();
      return;
    }

    if (scopeChanged && lastScopeKey) {
      releasePlanTokens();
      replayAnimationVisibility.releaseScope(lastScopeKey);
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
    }

    scheduleVisibilityRefresh();
  });

  function releasePlanTokens() {
    for (const token of planTokens) {
      replayAnimationVisibility.release(token);
    }
    planTokens = [];
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
