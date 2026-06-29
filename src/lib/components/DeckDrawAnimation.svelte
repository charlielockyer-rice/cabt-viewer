<script lang="ts">
  import { cardBackCssVar, cardFaceImageUrl } from '../game/cardAssets';
  import { onDestroy } from 'svelte';
  import {
    hideElementForAnimation,
    releaseElementVisibilityClaim,
    type ElementVisibilityClaim,
  } from '../animations/animationVisibilityClaims';
  import { createReplayPhasePlanRunner } from '../animations/replayPhasePlanRunner.svelte';
  import { scheduleReplayAnimationGroupRemoval, scheduleReplayAnimationScopeClear } from '../animations/replayAnimationSpriteLifecycle';
  import { replayAnimationScopeExitSettleMs } from '../animations/replayAnimationHandoff';
  import { replayAnimationPlanHasPhase, replayAnimationSelectedMotionsPlanKey, type CardMoveAnimationMotion, type ReplayAnimationPhasePlan } from '../animations/replayAnimationPlan';
  import {
    strictVisualElementForMotionAnchor,
    cardHeightToWidthRatio,
    centerOf,
    deckTopElement,
    fallbackHandTarget,
    handAnchor,
    handCardSlots,
    handSlotForSerial,
    isConcealedHandTarget,
    plannedMotionCard,
    plannedMotionFaceDown,
  } from '../animations/viewportCardMotion';
  import { actionAnimationBatchEvents, actionAnimationStartMs } from '../cabt/actionAnimationSchedule';
  import { cabtCardToView } from '../cabt/cardView';
  import { isReplayMoveBetween } from '../cabt/replayEventAreas';
  import { CabtAreaType } from '../cabt/types';
  import type { ActionTimelineEvent, CardView } from '../game/types';

  type Props = {
    events?: ActionTimelineEvent[];
    scopeKey?: string | number;
    replayMode?: boolean;
    animationPlan?: ReplayAnimationPhasePlan;
  };

  type DrawSpriteBase = {
    id: string;
    card?: CardView;
    reveal: boolean;
    order: number;
    delayMs: number;
    durationMs: number;
    startX: number;
    startY: number;
    width: number;
    height: number;
    moveX: number;
    moveY: number;
    scale: number;
    arcY: number;
    rotation: number;
  };

  type PlannedDrawSprite = DrawSpriteBase & { lifecycle: { kind: 'planned' } };
  type LiveDrawSprite = DrawSpriteBase & { lifecycle: { kind: 'live'; targetElement?: HTMLElement } };
  type DrawSprite = PlannedDrawSprite | LiveDrawSprite;

  type DrawAnimation = {
    id: number;
    sprites: DrawSprite[];
    lifecycle: DrawAnimationLifecycle;
  };

  type PlayerDrawSprites = {
    sprites: DrawSprite[];
    liveHiddenTargets: HTMLElement[];
  };

  type LiveHiddenDrawTarget = ElementVisibilityClaim;
  type DrawAnimationLifecycle =
    | { kind: 'planned' }
    | { kind: 'live'; hiddenTargets: LiveHiddenDrawTarget[] };

  let {
    events = [],
    scopeKey = '',
    replayMode = false,
    animationPlan,
  }: Props = $props();

  const timers: ReturnType<typeof setTimeout>[] = [];
  const cardMoveDurationMs = 320;
  const cardHandoffMs = Math.round(cardMoveDurationMs * 0.88);
  let draws = $state<DrawAnimation[]>([]);
  let nextAnimationId = 1;
  const replayPlanRunner = createReplayPhasePlanRunner({
    selectMotions: drawPlanMotions,
    planKey: replayAnimationSelectedMotionsPlanKey,
    lifecycle: 'replay',
    onScopeChange: settleDraws,
    onPlanChange: clearDraws,
    startPlanned: startPlannedDraw,
  });

  onDestroy(() => {
    clearDraws();
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
    const drawEvents = animationEvents.filter((event) => {
      if (!isDrawEvent(event)) {
        return false;
      }
      if (replayPlanRunner.hasSeen(event)) {
        return false;
      }
      return true;
    });

    replay.markEventsSeen(currentEvents);

    if (drawEvents.length) {
      startDraw(drawEvents, animationEvents);
    }
  });

  function drawPlanMotions(plan: ReplayAnimationPhasePlan | undefined): CardMoveAnimationMotion[] {
    return (plan?.motions ?? []).filter((motion): motion is CardMoveAnimationMotion =>
      motion.kind === 'card-move'
      && motion.coordinateSpace === 'viewport'
      && motion.sourceAnchor.kind === 'deck-top'
      && motion.targetAnchor.kind === 'hand-card'
      && replayAnimationPlanHasPhase(plan, 'Draw', motion.sourceAnchor.playerIndex),
    );
  }

  function isDrawEvent(event: ActionTimelineEvent): boolean {
    return event.kind === 'Draw' || event.kind === 'DrawReverse';
  }

  function startPlannedDraw(motions: CardMoveAnimationMotion[]) {
    const sprites = motions.flatMap((motion, index) => plannedSpriteForMotion(motion, index) ?? []);
    if (!sprites.length) {
      return;
    }

    const animation: DrawAnimation = {
      id: nextAnimationId++,
      sprites,
      lifecycle: { kind: 'planned' },
    };
    draws = [...draws, animation];

    scheduleReplayAnimationGroupRemoval({
      item: animation,
      motions,
      phaseDurationMs: animationPlan?.durationMs,
      timers,
      removeIds: removeDraws,
    });
  }

  function plannedSpriteForMotion(motion: CardMoveAnimationMotion, index: number): PlannedDrawSprite | undefined {
    const sourceElement = strictVisualElementForMotionAnchor(motion.sourceAnchor, motion.identity);
    const targetElement = strictVisualElementForMotionAnchor(motion.targetAnchor, motion.identity);
    if (!sourceElement || !targetElement) {
      return undefined;
    }
    const sourceRect = sourceElement.getBoundingClientRect();
    const targetRect = targetElement.getBoundingClientRect();
    if (sourceRect.width <= 0 || sourceRect.height <= 0 || targetRect.width <= 0 || targetRect.height <= 0) {
      return undefined;
    }

    const startCenter = centerOf(sourceRect);
    const targetCenter = centerOf(targetRect);
    const spriteWidth = sourceRect.width;
    const spriteHeight = spriteWidth * cardHeightToWidthRatio;
    const card = plannedMotionCard(motion);
    const reveal = !plannedMotionFaceDown(motion) && !isConcealedHandTarget(targetElement) && !!card;

    return {
      id: motion.id,
      card,
      reveal,
      order: index + 1,
      delayMs: motion.startMs,
      durationMs: motion.durationMs,
      startX: startCenter.x - spriteWidth / 2,
      startY: startCenter.y - spriteHeight / 2,
      width: spriteWidth,
      height: spriteHeight,
      moveX: targetCenter.x - startCenter.x,
      moveY: targetCenter.y - startCenter.y,
      scale: Math.max(0.5, Math.min(1.5, targetRect.width / spriteWidth)),
      arcY: motion.sourceAnchor.playerIndex === 0 ? -18 : 18,
      rotation: motion.sourceAnchor.playerIndex === 0 ? -3 : 3,
      lifecycle: { kind: 'planned' },
    };
  }

  function startDraw(
    drawEvents: ActionTimelineEvent[],
    animationEvents: ActionTimelineEvent[],
  ) {
    if (replayPlanRunner.reduceMotion) {
      return;
    }

    const eventsByPlayer = new Map<number, ActionTimelineEvent[]>();
    for (const event of drawEvents) {
      if (event.playerIndex === undefined) {
        continue;
      }
      const playerEvents = eventsByPlayer.get(event.playerIndex) ?? [];
      playerEvents.push(event);
      eventsByPlayer.set(event.playerIndex, playerEvents);
    }

    const playerDraws = [...eventsByPlayer.entries()].map(([playerIndex, playerEvents]) =>
      spritesForPlayer(playerIndex, playerEvents, animationEvents),
    );
    const sprites = playerDraws.flatMap((draw) => draw.sprites);
    const targetElements = playerDraws.flatMap((draw) => draw.liveHiddenTargets);
    if (!sprites.length) {
      return;
    }
    const liveHiddenTargets = hideLiveTargets(targetElements);

    const animation: DrawAnimation = {
      id: nextAnimationId++,
      sprites,
      lifecycle: { kind: 'live', hiddenTargets: liveHiddenTargets },
    };
    draws = [...draws, animation];
    for (const sprite of sprites) {
      const targetElement = sprite.lifecycle.targetElement;
      if (!targetElement) {
        continue;
      }
      const timer = setTimeout(() => {
        showLiveTargets(liveHiddenTargets.filter((target) => target.element === targetElement));
      }, sprite.delayMs + cardHandoffMs);
      timers.push(timer);
    }
    const timer = setTimeout(() => {
      showDrawLiveTargets(animation);
      draws = draws.filter((item) => item.id !== animation.id);
    }, Math.max(...sprites.map((sprite) => sprite.delayMs)) + cardMoveDurationMs + 120);
    timers.push(timer);
  }

  function clearDraws() {
    for (const timer of timers) {
      clearTimeout(timer);
    }
    timers.length = 0;
    for (const draw of draws) {
      showDrawLiveTargets(draw);
    }
    draws = [];
  }

  function settleDraws() {
    scheduleReplayAnimationScopeClear({
      items: draws,
      timers,
      delayMs: replayAnimationScopeExitSettleMs,
      removeIds: removeDraws,
    });
  }

  function removeDraws(ids: ReadonlySet<number>) {
    const removed = draws.filter((item) => ids.has(item.id));
    for (const animation of removed) {
      showDrawLiveTargets(animation);
    }
    draws = draws.filter((item) => !ids.has(item.id));
  }

  function showDrawLiveTargets(animation: DrawAnimation) {
    if (animation.lifecycle.kind !== 'live') {
      return;
    }
    showLiveTargets(animation.lifecycle.hiddenTargets);
    animation.lifecycle.hiddenTargets = [];
  }

  function spritesForPlayer(playerIndex: number, playerEvents: ActionTimelineEvent[], animationEvents: ActionTimelineEvent[]): PlayerDrawSprites {
    const deckElement = deckTopElement(playerIndex);
    const handElement = handAnchor(playerIndex);
    if (!deckElement || !handElement) {
      return { sprites: [], liveHiddenTargets: [] };
    }

    const deckRect = deckElement.getBoundingClientRect();
    const handRect = handElement.getBoundingClientRect();
    if (deckRect.width <= 0 || deckRect.height <= 0 || handRect.width <= 0 || handRect.height <= 0) {
      return { sprites: [], liveHiddenTargets: [] };
    }

    const handSlots = handCardSlots(handElement, playerIndex);
    const firstTargetIndex = Math.max(0, handSlots.length - playerEvents.length);
    const handConcealed = handElement.classList.contains('concealed');
    const startCenter = centerOf(deckRect);
    const spriteWidth = deckRect.width;
    const spriteHeight = spriteWidth * cardHeightToWidthRatio;
    const resetHandBeforeDraw = hasHandToDeckReset(playerIndex, animationEvents);
    const liveHiddenTargets: HTMLElement[] = resetHandBeforeDraw ? [...handSlots] : [];

    const sprites = playerEvents.map((event, index) => {
      const params = event.params as Record<string, unknown> | undefined;
      const serial = Number(params?.serial);
      const targetElement = resetHandBeforeDraw
        ? handSlotForSerial(handSlots, serial) ?? handSlots[index]
        : handSlots[firstTargetIndex + index];
      if (targetElement && !resetHandBeforeDraw) {
        liveHiddenTargets.push(targetElement);
      }
      const targetRect = targetElement?.getBoundingClientRect() ?? fallbackHandTarget(handRect, index, playerEvents.length);
      const targetCenter = centerOf(targetRect);
      const cardId = Number(params?.cardId);
      const reveal = !handConcealed && event.kind === 'Draw' && Number.isFinite(cardId);
      return {
        id: `${event.id}-${Number.isFinite(serial) ? serial : index}`,
        card: reveal ? cabtCardToView(cardId) : undefined,
        reveal,
        order: index + 1,
        delayMs: actionAnimationStartMs(animationEvents, event),
        durationMs: cardMoveDurationMs,
        startX: startCenter.x - spriteWidth / 2,
        startY: startCenter.y - spriteHeight / 2,
        width: spriteWidth,
        height: spriteHeight,
        moveX: targetCenter.x - startCenter.x,
        moveY: targetCenter.y - startCenter.y,
        scale: Math.max(0.5, Math.min(1.5, targetRect.width / spriteWidth)),
        arcY: playerIndex === 0 ? -18 : 18,
        rotation: playerIndex === 0 ? -3 : 3,
        lifecycle: { kind: 'live', targetElement },
      };
    });
    return { sprites, liveHiddenTargets };
  }

  function hasHandToDeckReset(playerIndex: number, animationEvents: ActionTimelineEvent[]): boolean {
    return animationEvents.some((event) => {
      return isReplayMoveBetween(event, CabtAreaType.HAND, CabtAreaType.DECK)
        && event.playerIndex === playerIndex
        && event.kind === 'MoveCard';
    });
  }

  function hideLiveTargets(targets: HTMLElement[]) {
    const liveHiddenClaims: LiveHiddenDrawTarget[] = [];
    for (const target of targets) {
      liveHiddenClaims.push(hideElementForAnimation({
        element: target,
        scopeKey,
        role: 'destination',
        fallbackAttribute: 'data-draw-animation-hidden',
      }));
    }
    return liveHiddenClaims;
  }

  function showLiveTargets(targets: LiveHiddenDrawTarget[]) {
    for (const target of targets) {
      releaseElementVisibilityClaim(target);
    }
  }

  function spriteStyle(sprite: DrawSprite): string {
    return [
      `left: ${sprite.startX}px`,
      `top: ${sprite.startY}px`,
      `width: ${sprite.width}px`,
      `height: ${sprite.height}px`,
      `--draw-x: ${sprite.moveX.toFixed(1)}px`,
      `--draw-y: ${sprite.moveY.toFixed(1)}px`,
      `--draw-scale: ${sprite.scale.toFixed(3)}`,
      `--draw-mid-scale: ${(1 + (sprite.scale - 1) * 0.45).toFixed(3)}`,
      `--draw-arc-y: ${sprite.arcY.toFixed(1)}px`,
      `--draw-rotation: ${sprite.rotation.toFixed(1)}deg`,
      `--draw-delay: ${sprite.delayMs}ms`,
      `--draw-duration: ${sprite.durationMs}ms`,
      `z-index: ${sprite.order}`,
    ].join('; ');
  }
</script>

<span class="deck-draw-animation" aria-hidden="true">
  {#each draws as draw (draw.id)}
    {#each draw.sprites as sprite (sprite.id)}
      <span class="draw-card" class:revealed={sprite.reveal} style={spriteStyle(sprite)}>
        <span class="draw-card-inner">
          <span class="draw-card-face draw-card-back" style={cardBackCssVar()}></span>
          <span class="draw-card-face draw-card-front">
            {#if cardFaceImageUrl(sprite.card)}
              <img src={cardFaceImageUrl(sprite.card)} alt="" draggable="false" />
            {:else}
              <span class="fallback-name">{sprite.card?.name ?? 'Card'}</span>
            {/if}
          </span>
        </span>
      </span>
    {/each}
  {/each}
</span>

<style>
  .deck-draw-animation {
    position: fixed;
    inset: 0;
    z-index: 32;
    overflow: visible;
    pointer-events: none;
    transform-style: preserve-3d;
  }

  :global([data-draw-animation-hidden='true']) {
    visibility: hidden;
  }

  .draw-card {
    position: absolute;
    display: block;
    border-radius: 6px;
    pointer-events: none;
    transform-origin: center;
    transform-style: preserve-3d;
    animation: deck-draw-travel var(--draw-duration, 320ms) cubic-bezier(0.2, 0.82, 0.22, 1) var(--draw-delay) both;
    will-change: transform, opacity;
  }

  .draw-card-inner {
    position: absolute;
    inset: 0;
    display: block;
    border-radius: inherit;
    transform-style: preserve-3d;
    will-change: transform;
  }

  .draw-card.revealed .draw-card-inner {
    animation: deck-draw-flip var(--draw-duration, 320ms) ease-in-out var(--draw-delay) both;
  }

  .draw-card-face {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    overflow: hidden;
    border-radius: inherit;
    box-shadow:
      0 10px 22px rgba(23, 30, 38, 0.22),
      0 0 0 1px rgba(18, 21, 26, 0.18);
    backface-visibility: hidden;
  }

  .draw-card-back {
    background:
      var(--card-back-image, var(--cardback-shade)),
      linear-gradient(135deg, rgba(255, 255, 255, 0.1), transparent 28%),
      repeating-linear-gradient(45deg, rgba(255, 255, 255, 0.08) 0 6px, transparent 6px 12px),
      linear-gradient(145deg, #203654, #111a2c);
    background-size: cover, auto, auto, auto;
    background-position: center;
  }

  .draw-card-front {
    transform: rotateY(180deg);
    background: #f7f8fa;
  }

  .draw-card:not(.revealed) .draw-card-front {
    display: none;
  }

  .draw-card-front img {
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

  @keyframes deck-draw-travel {
    0% {
      opacity: 0;
      transform: translate3d(0, 0, 0) scale(1) rotate(0deg);
    }
    1% {
      opacity: 1;
      transform: translate3d(0, 0, 0) scale(1) rotate(0deg);
    }
    48% {
      opacity: 1;
      transform:
        translate3d(calc(var(--draw-x) * 0.56), calc(var(--draw-y) * 0.56 + var(--draw-arc-y)), 0)
        scale(var(--draw-mid-scale))
        rotate(var(--draw-rotation));
    }
    88% {
      opacity: 1;
      transform: translate3d(var(--draw-x), var(--draw-y), 0) scale(var(--draw-scale)) rotate(0deg);
    }
    100% {
      opacity: 0;
      transform: translate3d(var(--draw-x), var(--draw-y), 0) scale(var(--draw-scale)) rotate(0deg);
    }
  }

  @keyframes deck-draw-flip {
    0% {
      transform: rotateY(0deg);
    }
    100% {
      transform: rotateY(180deg);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .draw-card,
    .draw-card.revealed .draw-card-inner {
      animation: none;
    }
  }
</style>
