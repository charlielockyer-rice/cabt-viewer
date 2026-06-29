<script lang="ts">
  import { cardBackCssVar, cardFaceImageUrl } from '../game/cardAssets';
  import { onDestroy } from 'svelte';
  import {
    hideElementForAnimation,
    releaseElementVisibilityClaims,
    type ElementVisibilityClaim,
  } from '../animations/animationVisibilityClaims';
  import { strictAnimationVisualElementForAnchor } from '../animations/animationAnchorVisuals';
  import { createReplayPhasePlanRunner } from '../animations/replayPhasePlanRunner.svelte';
  import { scheduleReplayAnimationGroupRemoval, scheduleReplayAnimationScopeClear } from '../animations/replayAnimationSpriteLifecycle';
  import { replayAnimationScopeExitSettleMs } from '../animations/replayAnimationHandoff';
  import { replayAnimationPlanHasPhase, replayAnimationSelectedMotionsPlanKey, type CardMoveAnimationMotion, type ReplayAnimationPhasePlan } from '../animations/replayAnimationPlan';
  import { actionAnimationBatchEvents, actionAnimationStartMs } from '../cabt/actionAnimationSchedule';
  import { cabtCardToView } from '../cabt/cardView';
  import { isReplayMoveBetween } from '../cabt/replayEventAreas';
  import { CabtAreaType } from '../cabt/types';
  import { elementRectInPlane } from '../dom/planeGeometry';
  import type { ActionTimelineEvent, CardView } from '../game/types';

  type Props = {
    events?: ActionTimelineEvent[];
    playerIndex: number;
    deckElement?: HTMLElement;
    discardElement?: HTMLElement;
    scopeKey?: string | number;
    replayMode?: boolean;
    opponent?: boolean;
    animationPlan?: ReplayAnimationPhasePlan;
  };

  type DiscardSprite = {
    id: string;
    card: CardView;
    order: number;
    delayMs: number;
    startX: number;
    startY: number;
    endX: number;
    endY: number;
    width: number;
    height: number;
    durationMs: number;
  };

  type DiscardAnimation = {
    id: number;
    sprites: DiscardSprite[];
  };
  type PlannedDiscardAnimation = DiscardAnimation & { lifecycle: { kind: 'planned' } };
  type LiveDiscardAnimation = DiscardAnimation & {
    lifecycle: { kind: 'live'; destinationClaims: ElementVisibilityClaim[] };
  };
  type ActiveDiscardAnimation = PlannedDiscardAnimation | LiveDiscardAnimation;

  let {
    events = [],
    playerIndex,
    deckElement,
    discardElement,
    scopeKey = '',
    replayMode = false,
    opponent = false,
    animationPlan,
  }: Props = $props();

  const timers: ReturnType<typeof setTimeout>[] = [];
  const cardMoveDurationMs = 300;
  let discards = $state<ActiveDiscardAnimation[]>([]);
  let nextAnimationId = 1;
  let motionLayer = $state<HTMLElement>();
  const replayPlanRunner = createReplayPhasePlanRunner({
    selectMotions: deckDiscardPlanMotions,
    planKey: replayAnimationSelectedMotionsPlanKey,
    lifecycle: 'replay',
    onScopeChange: settleDiscards,
    onPlanChange: clearDiscards,
    startPlanned: startPlannedDiscard,
  });

  onDestroy(() => {
    clearDiscards();
  });

  $effect(() => {
    const currentEvents = events;
    const currentScopeKey = scopeKey;
    const replay = replayPlanRunner.update({
      events: currentEvents,
      scopeKey: currentScopeKey,
      replayMode,
      animationPlan,
    });
    if (replay.handled) {
      return;
    }

    const animationEvents = actionAnimationBatchEvents(currentEvents, replay.seenEventIds);
    const discardEvents = animationEvents.filter((event) => {
      if (!isDeckDiscardEvent(event)) {
        return false;
      }
      if (replayPlanRunner.hasSeen(event)) {
        return false;
      }
      return true;
    });

    replay.markEventsSeen(currentEvents);

    if (discardEvents.length) {
      startDiscard(discardEvents, animationEvents);
    }
  });

  function deckDiscardPlanMotions(plan: ReplayAnimationPhasePlan | undefined): CardMoveAnimationMotion[] {
    return (plan?.motions ?? []).filter((motion): motion is CardMoveAnimationMotion =>
      motion.kind === 'card-move'
      && motion.coordinateSpace === 'board'
      && motion.sourceAnchor.kind === 'deck-top'
      && motion.sourceAnchor.playerIndex === playerIndex
      && (motion.targetAnchor.kind === 'discard-card' || motion.targetAnchor.kind === 'discard-pile')
      && replayAnimationPlanHasPhase(plan, 'DeckDiscard', playerIndex),
    );
  }

  function isDeckDiscardEvent(event: ActionTimelineEvent) {
    const params = event.params as Record<string, unknown> | undefined;
    return isReplayMoveBetween(event, CabtAreaType.DECK, CabtAreaType.DISCARD)
      && event.playerIndex === playerIndex
      && Number.isFinite(Number(params?.cardId));
  }

  function startDiscard(discardEvents: ActionTimelineEvent[], animationEvents: ActionTimelineEvent[]) {
    if (replayPlanRunner.reduceMotion || !deckElement || !discardElement) {
      return;
    }
    const deckRect = deckElement.getBoundingClientRect();
    if (deckRect.width <= 0 || deckRect.height <= 0) {
      return;
    }

    const deckStyle = getComputedStyle(deckElement);
    const startX = deckElement.offsetLeft + cssPixelValue(deckStyle.getPropertyValue('--deck-top-x'));
    const startY = deckElement.offsetTop + cssPixelValue(deckStyle.getPropertyValue('--deck-top-y'));
    const endX = discardElement.offsetLeft;
    const endY = discardElement.offsetTop;
    const width = deckElement.offsetWidth;
    const height = deckElement.offsetHeight;

    const sprites = discardEvents.map((event, index) => {
      const params = event.params as Record<string, unknown>;
      const cardId = Number(params.cardId);
      const serial = Number(params.serial);
      return {
        id: `${event.id}-${Number.isFinite(serial) ? serial : cardId}`,
        card: cabtCardToView(cardId),
        order: index + 1,
        delayMs: actionAnimationStartMs(animationEvents, event),
        startX,
        startY,
        endX,
        endY,
        width,
        height,
        durationMs: cardMoveDurationMs,
      };
    });

    const animation: LiveDiscardAnimation = {
      id: nextAnimationId++,
      sprites,
      lifecycle: {
        kind: 'live',
        destinationClaims: discardEvents.flatMap((event) => liveDestinationClaimsForEvent(event)),
      },
    };

    discards = [...discards, animation];
    const timer = setTimeout(() => {
      releaseLiveDestinationClaims(animation);
      discards = discards.filter((item) => item.id !== animation.id);
      const timerIndex = timers.indexOf(timer);
      if (timerIndex >= 0) {
        timers.splice(timerIndex, 1);
      }
    }, Math.max(...sprites.map((sprite) => sprite.delayMs + sprite.durationMs)) + 120);
    timers.push(timer);
  }

  function startPlannedDiscard(motions: CardMoveAnimationMotion[]) {
    const motionPlane = motionLayer?.parentElement;
    if (!(motionPlane instanceof HTMLElement)) {
      return;
    }
    const sprites = motions.flatMap((motion, index) => plannedSpriteForMotion(motion, index, motionPlane) ?? []);
    if (!sprites.length) {
      return;
    }

    const animation: PlannedDiscardAnimation = {
      id: nextAnimationId++,
      sprites,
      lifecycle: { kind: 'planned' },
    };

    discards = [...discards, animation];
    scheduleReplayAnimationGroupRemoval({
      item: animation,
      motions,
      phaseDurationMs: animationPlan?.durationMs,
      timers,
      removeIds: removeDiscards,
    });
  }

  function plannedSpriteForMotion(
    motion: CardMoveAnimationMotion,
    index: number,
    motionPlane: HTMLElement,
  ): DiscardSprite | undefined {
    const sourceElement = strictAnimationVisualElementForAnchor(motion.sourceAnchor, motion.identity);
    const targetElement = strictAnimationVisualElementForAnchor(motion.targetAnchor, motion.identity);
    if (!sourceElement || !targetElement) {
      return undefined;
    }
    const sourceRect = elementRectInPlane(sourceElement, motionPlane);
    const targetRect = elementRectInPlane(targetElement, motionPlane);
    if (!sourceRect || !targetRect || sourceRect.width <= 0 || sourceRect.height <= 0 || targetRect.width <= 0 || targetRect.height <= 0) {
      return undefined;
    }
    const cardId = motion.identity?.cardId ?? (motion.spriteVisual.kind === 'card' ? motion.spriteVisual.card?.id : undefined);
    if (cardId === undefined) {
      return undefined;
    }
    const card = motion.spriteVisual.kind === 'card' && motion.spriteVisual.card
      ? { ...cabtCardToView(cardId), ...motion.spriteVisual.card }
      : cabtCardToView(cardId);
    return {
      id: motion.id,
      card,
      order: index + 1,
      delayMs: motion.startMs,
      startX: sourceRect.left,
      startY: sourceRect.top,
      endX: targetRect.left,
      endY: targetRect.top,
      width: targetRect.width,
      height: targetRect.height,
      durationMs: motion.durationMs,
    };
  }

  function clearDiscards() {
    for (const timer of timers) {
      clearTimeout(timer);
    }
    timers.length = 0;
    for (const discard of discards) {
      releaseLiveDestinationClaims(discard);
    }
    discards = [];
  }

  function settleDiscards() {
    scheduleReplayAnimationScopeClear({
      items: discards,
      timers,
      delayMs: replayAnimationScopeExitSettleMs,
      removeIds: removeDiscards,
    });
  }

  function removeDiscards(ids: ReadonlySet<number>) {
    const removed = discards.filter((item) => ids.has(item.id));
    for (const animation of removed) {
      releaseLiveDestinationClaims(animation);
    }
    discards = discards.filter((item) => !ids.has(item.id));
  }

  function liveDestinationClaimsForEvent(event: ActionTimelineEvent): ElementVisibilityClaim[] {
    const params = event.params as Record<string, unknown> | undefined;
    const target = discardDestinationElement(Number(params?.serial), Number(params?.cardId));
    if (!target) {
      return [];
    }
    return [hideElementForAnimation({
      element: target,
      scopeKey,
      role: 'destination',
    })];
  }

  function discardDestinationElement(serial: number, cardId: number): HTMLElement | null {
    if (!discardElement) {
      return null;
    }
    const target = Number.isFinite(serial)
      ? discardElement.querySelector(`[data-card-serial="${serial}"]`)
      : Number.isFinite(cardId)
        ? discardElement.querySelector(`[data-card-id="${cardId}"]`)
        : null;
    return target instanceof HTMLElement ? target : null;
  }

  function releaseLiveDestinationClaims(animation: ActiveDiscardAnimation) {
    if (animation.lifecycle.kind !== 'live') {
      return;
    }
    releaseElementVisibilityClaims(animation.lifecycle.destinationClaims);
    animation.lifecycle.destinationClaims = [];
  }

  function spriteStyle(sprite: DiscardSprite) {
    return [
      `left: ${sprite.startX}px`,
      `top: ${sprite.startY}px`,
      `width: ${sprite.width}px`,
      `height: ${sprite.height}px`,
      `--discard-x: ${(sprite.endX - sprite.startX).toFixed(1)}px`,
      `--discard-y: ${(sprite.endY - sprite.startY).toFixed(1)}px`,
      `--base-rotation: ${opponent ? 180 : 0}deg`,
      `--discard-delay: ${sprite.delayMs}ms`,
      `--discard-duration: ${sprite.durationMs}ms`,
      `z-index: ${sprite.order}`,
    ].join('; ');
  }

  function cssPixelValue(value: string): number {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
</script>

<span class="deck-discard-animation" bind:this={motionLayer} aria-hidden="true">
  {#each discards as discard (discard.id)}
    {#each discard.sprites as sprite (sprite.id)}
      <span class="discard-card" style={spriteStyle(sprite)}>
        <span class="discard-card-inner">
          <span class="discard-card-face discard-card-back" style={cardBackCssVar()}></span>
          <span class="discard-card-face discard-card-front">
            {#if cardFaceImageUrl(sprite.card)}
              <img src={cardFaceImageUrl(sprite.card)} alt="" draggable="false" />
            {:else}
              <span class="fallback-name">{sprite.card.name}</span>
            {/if}
          </span>
        </span>
      </span>
    {/each}
  {/each}
</span>

<style>
  .deck-discard-animation {
    position: absolute;
    inset: 0;
    z-index: 9;
    overflow: visible;
    pointer-events: none;
    transform-style: preserve-3d;
  }

  .discard-card {
    position: absolute;
    display: block;
    border-radius: 5px;
    pointer-events: none;
    transform-style: preserve-3d;
    animation: deck-discard-travel var(--discard-duration, 300ms) cubic-bezier(0.24, 0.78, 0.24, 1) var(--discard-delay) both;
    will-change: transform, opacity;
  }

  .discard-card-inner {
    position: absolute;
    inset: 0;
    display: block;
    border-radius: inherit;
    transform-style: preserve-3d;
    animation: deck-discard-flip var(--discard-duration, 300ms) ease-in-out var(--discard-delay) both;
    will-change: transform;
  }

  .discard-card-face {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    overflow: hidden;
    border-radius: inherit;
    box-shadow:
      0 8px 18px rgba(23, 30, 38, 0.24),
      0 0 0 1px rgba(18, 21, 26, 0.18);
    backface-visibility: hidden;
  }

  .discard-card-back {
    background:
      var(--card-back-image, var(--cardback-shade)),
      linear-gradient(135deg, rgba(255, 255, 255, 0.1), transparent 28%),
      repeating-linear-gradient(45deg, rgba(255, 255, 255, 0.08) 0 6px, transparent 6px 12px),
      linear-gradient(145deg, #203654, #111a2c);
    background-size: cover, auto, auto, auto;
    background-position: center;
  }

  .discard-card-front {
    transform: rotateY(180deg);
    background: #f7f8fa;
  }

  .discard-card-front img {
    width: 100%;
    height: 100%;
    display: block;
    object-fit: fill;
    pointer-events: none;
  }

  .fallback-name {
    padding: 0 7px;
    color: #1f2933;
    font-size: 11px;
    font-weight: 900;
    line-height: 1.08;
    text-align: center;
  }

  @keyframes deck-discard-travel {
    0% {
      opacity: 0;
      transform: translate3d(0, 0, 0) rotate(var(--base-rotation));
    }
    1% {
      opacity: 1;
      transform: translate3d(0, 0, 0) rotate(var(--base-rotation));
    }
    10% {
      opacity: 1;
      transform: translate3d(0, 0, 0) rotate(var(--base-rotation));
    }
    55% {
      opacity: 1;
      transform: translate3d(calc(var(--discard-x) * 0.58), calc(var(--discard-y) * 0.58 - 10px), 0) rotate(var(--base-rotation));
    }
    86% {
      opacity: 1;
      transform: translate3d(var(--discard-x), var(--discard-y), 0) rotate(var(--base-rotation));
    }
    96% {
      opacity: 1;
      transform: translate3d(var(--discard-x), var(--discard-y), 0) rotate(var(--base-rotation));
    }
    100% {
      opacity: 0;
      transform: translate3d(var(--discard-x), var(--discard-y), 0) rotate(var(--base-rotation));
    }
  }

  @keyframes deck-discard-flip {
    0% {
      transform: rotateY(0deg);
    }
    72%,
    100% {
      transform: rotateY(180deg);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .discard-card,
    .discard-card-inner {
      animation: none;
    }
  }
</style>
