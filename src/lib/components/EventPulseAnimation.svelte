<script lang="ts">
  import { onDestroy } from 'svelte';
  import { resolveStrictAnimationAnchorElement } from '../animations/animationAnchors';
  import { claimAnimationElementEffect } from '../animations/animationElementEffects';
  import { pulseMotionPlanKey, ScheduledAnimationEffectRunner } from '../animations/plannedPulseEffects';
  import { createReplayPhasePlanRunner } from '../animations/replayPhasePlanRunner.svelte';
  import { replayAnimationPlanOwnsMotion, type PulseAnimationMotion, type ReplayAnimationPhasePlan } from '../animations/replayAnimationPlan';

  type Props = {
    scopeKey?: string | number;
    replayMode?: boolean;
    animationPlan?: ReplayAnimationPhasePlan;
  };

  type EventPulseLabel = {
    id: string;
    label: string;
    left: number;
    top: number;
    durationMs: number;
  };

  let {
    scopeKey = '',
    replayMode = false,
    animationPlan,
  }: Props = $props();

  const effectRunner = new ScheduledAnimationEffectRunner<PulseAnimationMotion>();
  const replayPlanRunner = createReplayPhasePlanRunner({
    selectMotions: eventPulseMotions,
    planKey: pulseMotionPlanKey,
    onScopeChange: clearPulses,
    onPlanChange: clearPulses,
    startPlanned: startEventPulses,
  });
  let labels = $state<EventPulseLabel[]>([]);

  onDestroy(() => {
    clearPulses();
  });

  $effect(() => {
    replayPlanRunner.update({ scopeKey, replayMode, animationPlan });
  });

  function eventPulseMotions(plan: ReplayAnimationPhasePlan | undefined): PulseAnimationMotion[] {
    return (plan?.motions ?? []).filter((motion): motion is PulseAnimationMotion =>
      motion.kind === 'pulse'
      && motion.spriteVisual.kind === 'pulse'
      && motion.spriteVisual.tone === 'neutral'
      && replayAnimationPlanOwnsMotion(plan, motion, [
        'Coin',
        'Change',
        'Condition',
        'Devolve',
        'MoveAttached',
      ]),
    );
  }

  function startEventPulses(motions: PulseAnimationMotion[]) {
    effectRunner.start(motions, {
      resolveElement: pulseElementForMotion,
      activate: activatePulse,
    });
  }

  function pulseElementForMotion(motion: PulseAnimationMotion): HTMLElement | null {
    const anchor = resolveStrictAnimationAnchorElement(motion.anchor, { identity: motion.identity });
    if (!(anchor instanceof HTMLElement)) {
      return null;
    }
    const pile = anchor.closest('.stack-pile');
    return pile instanceof HTMLElement ? pile : anchor;
  }

  function activatePulse(element: HTMLElement, motion: PulseAnimationMotion) {
    const sprite = pulseLabelForElement(element, motion);
    labels = [...labels, sprite];
    const claim = claimAnimationElementEffect({
      element,
      attributes: { 'data-event-pulse-active': 'true' },
      styles: {
        '--event-pulse-ms': `${motion.durationMs}ms`,
      },
    });
    return {
      claim,
      cleanup: () => {
        labels = labels.filter((label) => label.id !== sprite.id);
      },
    };
  }

  function pulseLabelForElement(element: HTMLElement, motion: PulseAnimationMotion): EventPulseLabel {
    const rect = element.getBoundingClientRect();
    return {
      id: motion.id,
      label: motion.label ?? 'Event',
      left: rect.left + rect.width / 2,
      top: rect.top + rect.height / 2,
      durationMs: motion.durationMs,
    };
  }

  function labelStyle(label: EventPulseLabel) {
    return [
      `left: ${label.left}px`,
      `top: ${label.top}px`,
      `--event-pulse-ms: ${label.durationMs}ms`,
    ].join('; ');
  }

  function clearPulses() {
    effectRunner.clear();
    labels = [];
  }
</script>

<span class="event-pulse-animation-layer" aria-hidden="true">
  {#each labels as label (label.id)}
    <span class="event-pulse-label" style={labelStyle(label)}>{label.label}</span>
  {/each}
</span>

<style>
  .event-pulse-animation-layer {
    position: fixed;
    inset: 0;
    z-index: 28;
    pointer-events: none;
  }

  :global(.stack-pile[data-event-pulse-active="true"]),
  :global(.board-slot[data-event-pulse-active="true"]) {
    animation: event-pulse-glow var(--event-pulse-ms, 520ms) ease-out both;
  }

  .event-pulse-label {
    position: fixed;
    z-index: 14;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: max-content;
    padding: 6px 10px;
    border: 1px solid rgba(254, 240, 138, 0.88);
    border-radius: 999px;
    background: rgba(66, 32, 6, 0.9);
    color: #fefce8;
    box-shadow:
      0 10px 24px rgba(66, 32, 6, 0.28),
      0 0 0 5px rgba(250, 204, 21, 0.18);
    font-size: 12px;
    font-weight: 900;
    line-height: 1;
    text-align: center;
    transform: translate(-50%, -50%);
    animation: event-pulse-label var(--event-pulse-ms, 520ms) ease-out both;
    pointer-events: none;
  }

  @keyframes event-pulse-glow {
    0% {
      filter: none;
      box-shadow: none;
    }
    34%,
    72% {
      filter: saturate(1.12) brightness(1.04);
      box-shadow:
        0 0 0 4px rgba(250, 204, 21, 0.48),
        0 0 22px rgba(245, 158, 11, 0.42);
    }
    100% {
      filter: none;
      box-shadow: none;
    }
  }

  @keyframes event-pulse-label {
    0% {
      opacity: 0;
      transform: translate(-50%, -36%) scale(0.9);
    }
    22%,
    74% {
      opacity: 1;
      transform: translate(-50%, -64%) scale(1);
    }
    100% {
      opacity: 0;
      transform: translate(-50%, -78%) scale(0.98);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    :global(.stack-pile[data-event-pulse-active="true"]),
    :global(.board-slot[data-event-pulse-active="true"]),
    .event-pulse-label {
      animation: none;
    }
  }
</style>
