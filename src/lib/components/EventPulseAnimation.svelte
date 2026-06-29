<script lang="ts">
  import { onDestroy } from 'svelte';
  import { resolveExactAnimationAnchorElement } from '../animations/animationAnchors';
  import { claimAnimationElementEffect } from '../animations/animationElementEffects';
  import { pulseMotionPlanKey, ScheduledAnimationEffectRunner } from '../animations/plannedPulseEffects';
  import { createPrefersReducedMotion } from '../animations/prefersReducedMotion.svelte';
  import { ReplayAnimationRunState } from '../animations/replayAnimationRunState';
  import { replayAnimationPlanHasPhase, type PulseAnimationMotion, type ReplayAnimationPhasePlan } from '../animations/replayAnimationPlan';

  type Props = {
    scopeKey?: string | number;
    replayMode?: boolean;
    animationPlan?: ReplayAnimationPhasePlan;
  };

  let {
    scopeKey = '',
    replayMode = false,
    animationPlan,
  }: Props = $props();

  const runState = new ReplayAnimationRunState();
  const effectRunner = new ScheduledAnimationEffectRunner<PulseAnimationMotion>();
  const prefersReducedMotion = createPrefersReducedMotion();
  let reduceMotion = $derived(prefersReducedMotion.current);

  onDestroy(() => {
    clearPulses();
  });

  $effect(() => {
    const pulses = eventPulseMotions(animationPlan);
    const planKey = pulseMotionPlanKey(pulses);
    const run = runState.update(scopeKey, planKey);
    if (run.scopeChanged || run.planChanged) {
      clearPulses();
    }

    if (!replayMode || reduceMotion || !pulses.length || !run.shouldStartPlan) {
      return;
    }

    startEventPulses(pulses);
  });

  function eventPulseMotions(plan: ReplayAnimationPhasePlan | undefined): PulseAnimationMotion[] {
    return (plan?.motions ?? []).filter((motion): motion is PulseAnimationMotion =>
      motion.kind === 'pulse'
      && motion.spriteVisual.kind === 'pulse'
      && motion.spriteVisual.tone === 'neutral'
      && replayAnimationPlanHasPhase(plan, 'Coin', motion.anchor.playerIndex),
    );
  }

  function startEventPulses(motions: PulseAnimationMotion[]) {
    effectRunner.start(motions, {
      resolveElement: pulseElementForMotion,
      activate: (element, motion) => activatePulse(element, motion.label ?? 'Event', motion.durationMs),
    });
  }

  function pulseElementForMotion(motion: PulseAnimationMotion): HTMLElement | null {
    const anchor = resolveExactAnimationAnchorElement(motion.anchor, { identity: motion.identity });
    if (!(anchor instanceof HTMLElement)) {
      return null;
    }
    const pile = anchor.closest('.stack-pile');
    return pile instanceof HTMLElement ? pile : anchor;
  }

  function activatePulse(element: HTMLElement, label: string, durationMs: number) {
    return claimAnimationElementEffect({
      element,
      attributes: { 'data-event-pulse-active': 'true' },
      styles: {
        '--event-pulse-label': JSON.stringify(label),
        '--event-pulse-ms': `${durationMs}ms`,
      },
    });
  }

  function clearPulses() {
    effectRunner.clear();
  }
</script>

<span class="event-pulse-animation-layer" aria-hidden="true"></span>

<style>
  .event-pulse-animation-layer {
    position: fixed;
    inset: 0;
    z-index: 28;
    pointer-events: none;
  }

  :global(.stack-pile[data-event-pulse-active="true"]) {
    animation: event-pulse-glow var(--event-pulse-ms, 520ms) ease-out both;
  }

  :global(.stack-pile[data-event-pulse-active="true"]::after) {
    content: var(--event-pulse-label);
    position: absolute;
    left: 50%;
    top: 50%;
    z-index: 14;
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
    :global(.stack-pile[data-event-pulse-active="true"]::after) {
      animation: none;
    }
  }
</style>
