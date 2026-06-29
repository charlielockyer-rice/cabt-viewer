<script lang="ts">
  import { onDestroy } from 'svelte';
  import { actionAnimationBatchEvents, actionAnimationStartMs, actionAnimationTiming } from '../cabt/actionAnimationSchedule';
  import { claimAnimationElementEffect } from '../animations/animationElementEffects';
  import { resolveExactAnimationAnchorElement } from '../animations/animationAnchors';
  import { pulseMotionPlanKey, ScheduledAnimationEffectRunner } from '../animations/plannedPulseEffects';
  import { createPrefersReducedMotion } from '../animations/prefersReducedMotion.svelte';
  import { ReplayAnimationRunState } from '../animations/replayAnimationRunState';
  import { replayAnimationPlanHasPhase, type PulseAnimationMotion, type ReplayAnimationPhasePlan } from '../animations/replayAnimationPlan';
  import type { ActionTimelineEvent } from '../game/types';

  type Props = {
    events?: ActionTimelineEvent[];
    scopeKey?: string | number;
    replayMode?: boolean;
    animationPlan?: ReplayAnimationPhasePlan;
  };

  type AbilityEffectMotion = PulseAnimationMotion | {
    startMs: number;
    durationMs: number;
    event: ActionTimelineEvent;
    label: string;
  };

  let {
    events = [],
    scopeKey = '',
    replayMode = false,
    animationPlan,
  }: Props = $props();

  const runState = new ReplayAnimationRunState();
  const effectRunner = new ScheduledAnimationEffectRunner<AbilityEffectMotion>();
  const prefersReducedMotion = createPrefersReducedMotion();
  let reduceMotion = $derived(prefersReducedMotion.current);

  onDestroy(() => {
    clearAbilityAnimations();
  });

  $effect(() => {
    const currentEvents = events;
    const currentScopeKey = scopeKey;
    const currentPlan = animationPlan;
    const plannedPulses = abilityPulseMotions(currentPlan);
    const planKey = pulseMotionPlanKey(plannedPulses);
    const run = runState.update(currentScopeKey, planKey);
    if (run.scopeChanged || run.planChanged) {
      clearAbilityAnimations();
    }

    if (plannedPulses.length) {
      if (!reduceMotion && run.shouldStartPlan) {
        startPlannedAbilityAnnouncements(plannedPulses);
      }
      runState.markEventsSeen(currentEvents);
      return;
    }

    if (run.firstRun) {
      runState.markEventsSeen(currentEvents);
      return;
    }

    if (replayMode) {
      runState.markEventsSeen(currentEvents);
      return;
    }

    const animationEvents = actionAnimationBatchEvents(currentEvents, runState.seenEventIds);
    runState.markEventsSeen(currentEvents);
    if (!animationEvents.length || reduceMotion) {
      return;
    }

    startAbilityAnnouncements(animationEvents);
  });

  function abilityPulseMotions(plan: ReplayAnimationPhasePlan | undefined): PulseAnimationMotion[] {
    return (plan?.motions ?? []).filter((motion): motion is PulseAnimationMotion =>
      motion.kind === 'pulse'
      && motion.anchor.kind === 'board-slot'
      && motion.spriteVisual.kind === 'pulse'
      && motion.spriteVisual.tone === 'ability'
      && replayAnimationPlanHasPhase(plan, 'Ability', motion.anchor.playerIndex),
    );
  }

  function startPlannedAbilityAnnouncements(motions: PulseAnimationMotion[]) {
    startAbilityEffectMotions(motions);
  }

  function startAbilityAnnouncements(animationEvents: ActionTimelineEvent[]) {
    startAbilityEffectMotions(animationEvents
      .filter((candidate) => candidate.kind === 'Ability')
      .map((event) => ({
        event,
        label: abilityNameForEvent(event),
        startMs: actionAnimationStartMs(animationEvents, event),
        durationMs: actionAnimationTiming.abilityAnnounceMs,
      })));
  }

  function startAbilityEffectMotions(motions: AbilityEffectMotion[]) {
    effectRunner.start(motions, {
      resolveElement: (motion) => 'event' in motion ? slotElementForEvent(motion.event) : slotElementForMotion(motion),
      activate: (element, motion) => activateAbilityElement(element, motion.label ?? 'Ability'),
    });
  }

  function slotElementForMotion(motion: PulseAnimationMotion): HTMLElement | null {
    const element = resolveExactAnimationAnchorElement(motion.anchor, { identity: motion.identity });
    return element instanceof HTMLElement ? element : null;
  }

  function clearAbilityAnimations() {
    effectRunner.clear();
  }

  function activateAbilityElement(element: HTMLElement, abilityName: string) {
    return claimAnimationElementEffect({
      element,
      attributes: { 'data-ability-announce-active': 'true' },
      styles: { '--ability-name': JSON.stringify(abilityName) },
    });
  }

  function slotElementForEvent(event: ActionTimelineEvent): HTMLElement | null {
    const params = event.params as Record<string, unknown> | undefined;
    const serial = Number(params?.serial);
    if (Number.isFinite(serial)) {
      const bySerial = document.querySelector(`[data-pokemon-serial="${serial}"]`);
      if (bySerial instanceof HTMLElement) {
        return bySerial;
      }
    }
    const cardId = Number(params?.cardId);
    if (Number.isFinite(cardId) && event.playerIndex !== undefined) {
      const byCard = document.querySelector(`[data-owner-index="${event.playerIndex}"][data-pokemon-card-id="${cardId}"]`);
      if (byCard instanceof HTMLElement) {
        return byCard;
      }
    }
    return null;
  }

  function abilityNameForEvent(event: ActionTimelineEvent): string {
    const params = event.params as Record<string, unknown> | undefined;
    const explicit = typeof params?.abilityName === 'string' ? params.abilityName.trim() : '';
    if (explicit) {
      return explicit;
    }
    const match = event.message.match(/\bused\s+(.+?)\s+with\b/i);
    return match?.[1] ?? 'Ability';
  }
</script>

<span class="ability-animation-layer" aria-hidden="true"></span>

<style>
  .ability-animation-layer {
    position: fixed;
    inset: 0;
    z-index: 28;
    pointer-events: none;
  }

  :global(.board-slot[data-ability-announce-active="true"]) {
    animation: ability-announcement-glow 560ms ease-out both;
  }

  :global(.board-slot[data-ability-announce-active="true"]::after) {
    content: var(--ability-name);
    position: absolute;
    left: 50%;
    top: -10px;
    z-index: 12;
    min-width: max-content;
    max-width: 220px;
    padding: 6px 10px;
    border: 1px solid rgba(186, 230, 253, 0.86);
    border-radius: 999px;
    background: rgba(8, 47, 73, 0.92);
    color: #ecfeff;
    box-shadow:
      0 10px 24px rgba(8, 47, 73, 0.28),
      0 0 0 5px rgba(14, 165, 233, 0.16);
    font-size: 12px;
    font-weight: 900;
    line-height: 1;
    text-align: center;
    transform: translate(-50%, -100%);
    animation: ability-name-pop 560ms ease-out both;
    pointer-events: none;
  }

  @keyframes ability-announcement-glow {
    0% {
      filter: drop-shadow(0 0 0 rgba(14, 165, 233, 0));
    }
    32% {
      filter:
        drop-shadow(0 0 10px rgba(14, 165, 233, 0.72))
        drop-shadow(0 0 22px rgba(34, 211, 238, 0.34));
    }
    100% {
      filter: drop-shadow(0 0 0 rgba(14, 165, 233, 0));
    }
  }

  @keyframes ability-name-pop {
    0% {
      opacity: 0;
      transform: translate(-50%, -88%) scale(0.92);
    }
    22% {
      opacity: 1;
      transform: translate(-50%, -118%) scale(1.04);
    }
    78% {
      opacity: 1;
      transform: translate(-50%, -112%) scale(1);
    }
    100% {
      opacity: 0;
      transform: translate(-50%, -124%) scale(0.98);
    }
  }
</style>
