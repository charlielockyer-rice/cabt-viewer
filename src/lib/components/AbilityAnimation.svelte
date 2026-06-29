<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { actionAnimationBatchEvents, actionAnimationStartMs, actionAnimationTiming } from '../cabt/actionAnimationSchedule';
  import { resolveExactAnimationAnchorElement } from '../animations/animationAnchors';
  import { replayAnimationPlanHasPhase, type PulseAnimationMotion, type ReplayAnimationPhasePlan } from '../animations/replayAnimationPlan';
  import type { ActionTimelineEvent } from '../game/types';

  type Props = {
    events?: ActionTimelineEvent[];
    scopeKey?: string | number;
    replayMode?: boolean;
    animationPlan?: ReplayAnimationPhasePlan;
  };

  let {
    events = [],
    scopeKey = '',
    replayMode = false,
    animationPlan,
  }: Props = $props();

  const timers: ReturnType<typeof setTimeout>[] = [];
  let seenEventIds = new Set<number>();
  let initialized = false;
  let lastScopeKey: string | number = '';
  let lastPlanKey = '';
  let reduceMotion = $state(false);
  let animationGeneration = 0;
  const activeAbilityElements = new Set<HTMLElement>();

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
    clearAbilityAnimations();
  });

  $effect(() => {
    const currentEvents = events;
    const currentScopeKey = scopeKey;
    const currentPlan = animationPlan;
    const plannedPulses = abilityPulseMotions(currentPlan);
    const planKey = abilityPulsePlanKey(plannedPulses);
    const scopeChanged = initialized && currentScopeKey !== lastScopeKey;
    const planChanged = planKey !== lastPlanKey;
    if (scopeChanged || planChanged) {
      clearAbilityAnimations();
    }
    lastScopeKey = currentScopeKey;
    lastPlanKey = planKey;

    if (plannedPulses.length) {
      initialized = true;
      if (!reduceMotion && (scopeChanged || planChanged)) {
        startPlannedAbilityAnnouncements(plannedPulses);
      }
      markEventsSeen(currentEvents);
      return;
    }

    if (!initialized) {
      markEventsSeen(currentEvents);
      initialized = true;
      return;
    }

    if (replayMode) {
      markEventsSeen(currentEvents);
      return;
    }

    const animationEvents = actionAnimationBatchEvents(currentEvents, seenEventIds);
    markEventsSeen(currentEvents);
    if (!animationEvents.length || reduceMotion) {
      return;
    }

    startAbilityAnnouncements(animationEvents);
  });

  function markEventsSeen(currentEvents: ActionTimelineEvent[]) {
    for (const event of currentEvents) {
      seenEventIds.add(event.id);
    }
  }

  function abilityPulseMotions(plan: ReplayAnimationPhasePlan | undefined): PulseAnimationMotion[] {
    return (plan?.motions ?? []).filter((motion): motion is PulseAnimationMotion =>
      motion.kind === 'pulse'
      && motion.anchor.kind === 'board-slot'
      && motion.spriteVisual.kind === 'pulse'
      && motion.spriteVisual.tone === 'ability'
      && replayAnimationPlanHasPhase(plan, 'Ability', motion.anchor.playerIndex),
    );
  }

  function abilityPulsePlanKey(motions: PulseAnimationMotion[]): string {
    return motions.map((motion) => `${motion.id}:${motion.startMs}:${motion.durationMs}`).join('|');
  }

  function startPlannedAbilityAnnouncements(motions: PulseAnimationMotion[]) {
    const generation = animationGeneration;
    for (const motion of motions) {
      const timer = setTimeout(() => {
        if (generation !== animationGeneration) {
          return;
        }
        const source = slotElementForMotion(motion);
        if (!source) {
          return;
        }
        activateAbilityElement(source, motion.label ?? 'Ability');
        const cleanup = setTimeout(() => {
          if (generation !== animationGeneration) {
            return;
          }
          clearAbilityElement(source);
        }, motion.durationMs);
        timers.push(cleanup);
      }, motion.startMs);
      timers.push(timer);
    }
  }

  function startAbilityAnnouncements(animationEvents: ActionTimelineEvent[]) {
    const generation = animationGeneration;
    for (const event of animationEvents.filter((candidate) => candidate.kind === 'Ability')) {
      const source = slotElementForEvent(event);
      if (!source) {
        continue;
      }
      const delayMs = actionAnimationStartMs(animationEvents, event);
      const timer = setTimeout(() => {
        if (generation !== animationGeneration) {
          return;
        }
        activateAbilityElement(source, abilityNameForEvent(event));
        const cleanup = setTimeout(() => {
          if (generation !== animationGeneration) {
            return;
          }
          clearAbilityElement(source);
        }, actionAnimationTiming.abilityAnnounceMs);
        timers.push(cleanup);
      }, delayMs);
      timers.push(timer);
    }
  }

  function slotElementForMotion(motion: PulseAnimationMotion): HTMLElement | null {
    const element = resolveExactAnimationAnchorElement(motion.anchor, { identity: motion.identity });
    return element instanceof HTMLElement ? element : null;
  }

  function clearAbilityAnimations() {
    animationGeneration += 1;
    for (const timer of timers) {
      clearTimeout(timer);
    }
    timers.length = 0;
    for (const element of activeAbilityElements) {
      clearAbilityElement(element);
    }
    activeAbilityElements.clear();
  }

  function activateAbilityElement(element: HTMLElement, abilityName: string) {
    activeAbilityElements.add(element);
    element.dataset.abilityAnnounceActive = 'true';
    element.style.setProperty('--ability-name', JSON.stringify(abilityName));
  }

  function clearAbilityElement(element: HTMLElement) {
    delete element.dataset.abilityAnnounceActive;
    element.style.removeProperty('--ability-name');
    activeAbilityElements.delete(element);
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
