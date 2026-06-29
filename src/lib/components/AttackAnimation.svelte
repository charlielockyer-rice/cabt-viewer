<script lang="ts">
  import { onDestroy } from 'svelte';
  import { resolveExactAnimationAnchorElement } from '../animations/animationAnchors';
  import {
    claimAnimationElementEffect,
    releaseAnimationElementEffectClaim,
    releaseAnimationElementEffectClaims,
    type AnimationElementEffectClaim,
  } from '../animations/animationElementEffects';
  import { createPrefersReducedMotion } from '../animations/prefersReducedMotion.svelte';
  import { pulseMotionPlanKey, ScheduledAnimationEffectRunner } from '../animations/plannedPulseEffects';
  import { ReplayAnimationRunState } from '../animations/replayAnimationRunState';
  import { actionAnimationBatchEvents, actionAnimationStartMs, actionAnimationTiming } from '../cabt/actionAnimationSchedule';
  import { replayAnimationPlanHasPhase, type PulseAnimationMotion, type ReplayAnimationPhasePlan } from '../animations/replayAnimationPlan';
  import type { ActionTimelineEvent } from '../game/types';

  type Props = {
    events?: ActionTimelineEvent[];
    stepEvents?: ActionTimelineEvent[];
    scopeKey?: string | number;
    replayMode?: boolean;
    animationPlan?: ReplayAnimationPhasePlan;
  };

  type DamageSprite = {
    id: string;
    value: number;
    left: number;
    top: number;
    delayMs: number;
  };

  type AttackAnnouncementMotion = PulseAnimationMotion | {
    startMs: number;
    durationMs: number;
    event: ActionTimelineEvent;
    label: string;
  };

  let {
    events = [],
    stepEvents = [],
    scopeKey = '',
    replayMode = false,
    animationPlan,
  }: Props = $props();

  const timers: ReturnType<typeof setTimeout>[] = [];
  const runState = new ReplayAnimationRunState();
  const attackAnnouncementRunner = new ScheduledAnimationEffectRunner<AttackAnnouncementMotion>();
  const prefersReducedMotion = createPrefersReducedMotion();
  let reduceMotion = $derived(prefersReducedMotion.current);
  let damageSprites = $state<DamageSprite[]>([]);
  let animationGeneration = 0;
  const activeAttackLunges = new Set<AnimationElementEffectClaim>();

  onDestroy(() => {
    clearAttackAnimations();
  });

  $effect(() => {
    const currentEvents = events;
    const currentScopeKey = scopeKey;
    const plannedPulses = attackPulseMotions(animationPlan);
    const planKey = pulseMotionPlanKey(plannedPulses);
    const run = runState.update(currentScopeKey, planKey);
    if (run.scopeChanged || run.planChanged) {
      clearAttackAnimations();
    }

    if (plannedPulses.length) {
      if (!reduceMotion && run.shouldStartPlan) {
        startPlannedPulses(plannedPulses);
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

    startAttackAnnouncements(animationEvents);
    startDamageAnimations(animationEvents);
  });

  function attackPulseMotions(plan: ReplayAnimationPhasePlan | undefined): PulseAnimationMotion[] {
    return (plan?.motions ?? []).filter((motion): motion is PulseAnimationMotion =>
      motion.kind === 'pulse'
      && motion.anchor.kind === 'board-slot'
      && motion.spriteVisual.kind === 'pulse'
      && (motion.spriteVisual.tone === 'attack' || motion.spriteVisual.tone === 'damage')
      && (
        replayAnimationPlanHasPhase(plan, 'Attack', motion.anchor.playerIndex)
        || replayAnimationPlanHasPhase(plan, 'Damage', motion.anchor.playerIndex)
      ),
    );
  }

  function startPlannedPulses(motions: PulseAnimationMotion[]) {
    for (const motion of motions) {
      if (motion.spriteVisual.kind !== 'pulse') {
        continue;
      }
      if (motion.spriteVisual.tone === 'attack') {
        startPlannedAttackAnnouncement(motion);
      }
      if (motion.spriteVisual.tone === 'damage') {
        startPlannedDamageAnimation(motion);
      }
    }
  }

  function startPlannedAttackAnnouncement(motion: PulseAnimationMotion) {
    attackAnnouncementRunner.start([motion], {
      resolveElement: (candidate) => 'event' in candidate ? slotElementForEvent(candidate.event) : slotElementForMotion(candidate),
      activate: (element, candidate) => activateAttackAnnouncement(element, candidate.label ?? 'Attack'),
    });
  }

  function startPlannedDamageAnimation(motion: PulseAnimationMotion) {
    const generation = animationGeneration;
    const timer = setTimeout(() => {
      if (generation !== animationGeneration) {
        return;
      }
      const target = slotElementForMotion(motion);
      if (!target) {
        return;
      }
      const attacker = motion.sourceAnchor ? slotElementForAnchor(motion.sourceAnchor) : null;
      const targetRect = target.getBoundingClientRect();
      if (attacker) {
        startAttackLunge(attacker, targetRect, motion.durationMs);
      }
      const value = motion.value ?? 0;
      if (value <= 0) {
        return;
      }
      const sprite: DamageSprite = {
        id: motion.id,
        value,
        left: targetRect.left + targetRect.width / 2,
        top: targetRect.top + targetRect.height * 0.42,
        delayMs: 0,
      };
      damageSprites = [...damageSprites, sprite];
      const cleanup = setTimeout(() => {
        if (generation !== animationGeneration) {
          return;
        }
        damageSprites = damageSprites.filter((item) => item.id !== sprite.id);
      }, motion.durationMs);
      timers.push(cleanup);
    }, motion.startMs);
    timers.push(timer);
  }

  function startAttackAnnouncements(animationEvents: ActionTimelineEvent[]) {
    attackAnnouncementRunner.start(animationEvents
      .filter((candidate) => candidate.kind === 'Attack')
      .map((event) => ({
        event,
        label: attackNameForEvent(event),
        startMs: actionAnimationStartMs(animationEvents, event),
        durationMs: actionAnimationTiming.attackAnnounceMs,
      })), {
        resolveElement: (motion) => 'event' in motion ? slotElementForEvent(motion.event) : slotElementForMotion(motion),
        activate: (element, motion) => activateAttackAnnouncement(element, motion.label ?? 'Attack'),
      });
  }

  function startDamageAnimations(animationEvents: ActionTimelineEvent[]) {
    const attackEvent = stepEvents.find((event) => event.kind === 'Attack');
    for (const event of animationEvents.filter(isDamageEvent)) {
      const target = slotElementForEvent(event);
      const attacker = attackEvent ? slotElementForEvent(attackEvent) : null;
      if (!target) {
        continue;
      }
      const delayMs = actionAnimationStartMs(animationEvents, event);
      const targetRect = target.getBoundingClientRect();
      const value = damageValue(event);

      if (attacker) {
        const lungeTimer = setTimeout(() => {
          startAttackLunge(attacker, targetRect, actionAnimationTiming.damageVisualMs);
        }, delayMs);
        timers.push(lungeTimer);
      }

      if (value > 0) {
        const sprite: DamageSprite = {
          id: `${event.id}-${value}`,
          value,
          left: targetRect.left + targetRect.width / 2,
          top: targetRect.top + targetRect.height * 0.42,
          delayMs,
        };
        damageSprites = [...damageSprites, sprite];
        const cleanup = setTimeout(() => {
          damageSprites = damageSprites.filter((item) => item.id !== sprite.id);
        }, delayMs + actionAnimationTiming.damageVisualMs);
        timers.push(cleanup);
      }
    }
  }

  function startAttackLunge(attacker: HTMLElement, targetRect: DOMRect, durationMs: number) {
    const sourceRect = attacker.getBoundingClientRect();
    const dx = targetRect.left + targetRect.width / 2 - (sourceRect.left + sourceRect.width / 2);
    const dy = targetRect.top + targetRect.height / 2 - (sourceRect.top + sourceRect.height / 2);
    const distance = Math.max(1, Math.hypot(dx, dy));
    const claim = claimAnimationElementEffect({
      element: attacker,
      attributes: { 'data-attack-lunge-active': 'true' },
      styles: {
        '--attack-lunge-x': `${(dx / distance * 22).toFixed(1)}px`,
        '--attack-lunge-y': `${(dy / distance * 22).toFixed(1)}px`,
        '--damage-visual-ms': `${durationMs}ms`,
      },
    });
    activeAttackLunges.add(claim);
    const cleanup = setTimeout(() => {
      clearAttackLunge(claim);
    }, durationMs);
    timers.push(cleanup);
  }

  function clearAttackAnimations() {
    animationGeneration += 1;
    for (const timer of timers) {
      clearTimeout(timer);
    }
    timers.length = 0;
    attackAnnouncementRunner.clear();
    releaseAnimationElementEffectClaims(activeAttackLunges);
    activeAttackLunges.clear();
    damageSprites = [];
  }

  function activateAttackAnnouncement(element: HTMLElement, attackName: string) {
    return claimAnimationElementEffect({
      element,
      attributes: { 'data-attack-announce-active': 'true' },
      styles: { '--attack-name': JSON.stringify(attackName) },
    });
  }

  function clearAttackLunge(claim: AnimationElementEffectClaim) {
    releaseAnimationElementEffectClaim(claim);
    activeAttackLunges.delete(claim);
  }

  function isDamageEvent(event: ActionTimelineEvent) {
    return event.kind === 'HpChange' || event.kind === 'HPChange';
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

  function slotElementForMotion(motion: PulseAnimationMotion): HTMLElement | null {
    return slotElementForAnchor(motion.anchor, motion.identity);
  }

  function slotElementForAnchor(anchor: PulseAnimationMotion['anchor'], identity?: PulseAnimationMotion['identity']): HTMLElement | null {
    const element = resolveExactAnimationAnchorElement(anchor, { identity });
    return element instanceof HTMLElement ? element : null;
  }

  function attackNameForEvent(event: ActionTimelineEvent): string {
    const match = event.message.match(/\bused\s+(.+?)\s+with\b/i);
    return match?.[1] ?? 'Attack';
  }

  function damageValue(event: ActionTimelineEvent): number {
    const params = event.params as Record<string, unknown> | undefined;
    const value = Number(params?.value);
    return Number.isFinite(value) ? Math.abs(Math.min(0, value)) : 0;
  }

  function damageSpriteStyle(sprite: DamageSprite) {
    return [
      `left: ${sprite.left}px`,
      `top: ${sprite.top}px`,
      `--attack-delay: ${sprite.delayMs}ms`,
      `--damage-visual-ms: ${actionAnimationTiming.damageVisualMs}ms`,
    ].join('; ');
  }

</script>

<span class="attack-animation-layer" aria-hidden="true">
  {#each damageSprites as sprite (sprite.id)}
    <span class="attack-damage-number" style={damageSpriteStyle(sprite)}>{sprite.value}</span>
  {/each}
</span>

<style>
  .attack-animation-layer {
    position: fixed;
    inset: 0;
    z-index: 30;
    pointer-events: none;
  }

  :global(.board-slot[data-attack-announce-active="true"]) {
    animation: attack-announcement-glow 520ms ease-out both;
  }

  :global(.board-slot[data-attack-announce-active="true"]::after) {
    content: var(--attack-name);
    position: absolute;
    left: 50%;
    top: -12px;
    z-index: 12;
    min-width: max-content;
    max-width: 210px;
    padding: 6px 10px;
    border-radius: 999px;
    background: rgba(17, 24, 39, 0.9);
    color: white;
    box-shadow: 0 8px 20px rgba(17, 24, 39, 0.24);
    font-size: 12px;
    font-weight: 900;
    line-height: 1;
    text-align: center;
    transform: translate(-50%, -100%);
    animation: attack-name-pop 520ms ease-out both;
    pointer-events: none;
  }

  :global(.board-slot[data-attack-lunge-active="true"]) {
    animation: attack-lunge var(--damage-visual-ms, 560ms) cubic-bezier(0.2, 0.82, 0.22, 1) both;
  }

  .attack-damage-number {
    position: fixed;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 64px;
    height: 42px;
    padding: 0 12px;
    border-radius: 8px;
    border: 2px solid rgba(255, 255, 255, 0.86);
    background:
      linear-gradient(180deg, #fef2f2 0%, #fecaca 42%, #dc2626 100%);
    box-shadow:
      0 12px 26px rgba(127, 29, 29, 0.32),
      0 0 0 5px rgba(248, 113, 113, 0.16),
      inset 0 2px 2px rgba(255, 255, 255, 0.72);
    color: #fff;
    font-size: 27px;
    font-weight: 950;
    line-height: 1;
    letter-spacing: 0;
    -webkit-text-stroke: 1.2px #450a0a;
    paint-order: stroke fill;
    transform: translate(-50%, -50%);
    text-shadow: 0 2px 2px rgba(69, 10, 10, 0.32);
    animation: attack-damage-number var(--damage-visual-ms, 560ms) ease-out var(--attack-delay) both;
  }

  .attack-damage-number::before,
  .attack-damage-number::after {
    content: none;
  }

  @keyframes attack-announcement-glow {
    0% {
      filter: none;
      box-shadow: none;
    }
    35%,
    70% {
      filter: saturate(1.15) brightness(1.04);
      box-shadow: 0 0 0 4px rgba(251, 191, 36, 0.62), 0 0 22px rgba(251, 191, 36, 0.58);
    }
    100% {
      filter: none;
      box-shadow: none;
    }
  }

  @keyframes attack-name-pop {
    0% {
      opacity: 0;
      transform: translate(-50%, -88%) scale(0.88);
    }
    22%,
    78% {
      opacity: 1;
      transform: translate(-50%, -100%) scale(1);
    }
    100% {
      opacity: 0;
      transform: translate(-50%, -112%) scale(0.98);
    }
  }

  @keyframes attack-lunge {
    0%,
    100% {
      translate: 0 0;
      filter: none;
    }
    42% {
      translate: var(--attack-lunge-x) var(--attack-lunge-y);
      filter: saturate(1.12) brightness(1.03);
    }
  }

  @keyframes attack-damage-number {
    0% {
      opacity: 0;
      transform: translate(-50%, -38%) scale(0.76);
    }
    18%,
    68% {
      opacity: 1;
      transform: translate(-50%, -56%) scale(1);
    }
    100% {
      opacity: 0;
      transform: translate(-50%, -78%) scale(1.08);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    :global(.board-slot[data-attack-announce-active="true"]),
    :global(.board-slot[data-attack-lunge-active="true"]),
    .attack-damage-number {
      animation: none;
    }
  }
</style>
