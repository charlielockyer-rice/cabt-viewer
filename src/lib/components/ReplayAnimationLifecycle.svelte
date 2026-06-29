<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import { createPrefersReducedMotion } from '../animations/prefersReducedMotion.svelte';
  import { replayAnimationVisibility } from '../animations/animationVisibility';
  import { ReplayAnimationVisibilityLifecycle } from '../animations/replayAnimationVisibilityLifecycle';
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

  let refreshGeneration = 0;
  const prefersReducedMotion = createPrefersReducedMotion();
  const visibilityLifecycle = new ReplayAnimationVisibilityLifecycle({
    refresh: scheduleVisibilityRefresh,
  });
  let reduceMotion = $derived(prefersReducedMotion.current);

  onDestroy(() => {
    visibilityLifecycle.destroy();
  });

  $effect(() => {
    visibilityLifecycle.update({
      active,
      scopeKey,
      animationPlan,
      reduceMotion,
    });
  });

  function scheduleVisibilityRefresh() {
    const generation = ++refreshGeneration;
    void tick().then(() => {
      if (generation === refreshGeneration) {
        replayAnimationVisibility.refresh();
      }
    });
  }

</script>
