<script lang="ts">
  import { cardBackCssVar, cardFaceImageUrl } from '../game/cardAssets';
  import { onDestroy, onMount } from 'svelte';
  import {
    hideElementForAnimation,
    releaseElementVisibilityClaim,
    type ElementVisibilityClaim,
  } from '../animations/animationVisibilityClaims';
  import { replayAnimationPlanHasPhase, type CardMoveAnimationMotion, type ReplayAnimationPhasePlan } from '../animations/replayAnimationPlan';
  import {
    animationElementForMotionAnchor,
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
  import { CabtAreaType } from '../cabt/types';
  import type { ActionTimelineEvent, CardView } from '../game/types';

  type Props = {
    events?: ActionTimelineEvent[];
    scopeKey?: string | number;
    replayMode?: boolean;
    animationPlan?: ReplayAnimationPhasePlan;
  };

  type DrawSprite = {
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
    targetElement?: HTMLElement;
  };

  type DrawAnimation = {
    id: number;
    sprites: DrawSprite[];
    hiddenTargets: HiddenDrawTarget[];
  };

  type PlayerDrawSprites = {
    sprites: DrawSprite[];
    hiddenTargets: HTMLElement[];
  };

  type HiddenDrawTarget = ElementVisibilityClaim;

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
  let seenEventIds = new Set<number>();
  let initialized = false;
  let nextAnimationId = 1;
  let reduceMotion = $state(false);
  let lastScopeKey: string | number = '';
  let lastPlanKey = '';

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
    clearDraws();
  });

  $effect(() => {
    const currentEvents = events;
    const currentScopeKey = scopeKey;
    const plannedMotions = drawPlanMotions(animationPlan);
    const planKey = drawPlanKey(plannedMotions);
    const scopeChanged = initialized && currentScopeKey !== lastScopeKey;
    const planChanged = planKey !== lastPlanKey;
    lastScopeKey = currentScopeKey;
    lastPlanKey = planKey;

    if (plannedMotions.length) {
      const shouldStartPlan = !initialized || planChanged || scopeChanged;
      initialized = true;
      if (shouldStartPlan) {
        clearDraws();
        if (!reduceMotion) {
          startPlannedDraw(plannedMotions);
        }
      } else {
        markEventsSeen(currentEvents);
        return;
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
      if (scopeChanged) {
        clearDraws();
      }
      markEventsSeen(currentEvents);
      return;
    }

    const animationEvents = actionAnimationBatchEvents(currentEvents, seenEventIds);
    const drawEvents = animationEvents.filter((event) => {
      if (!isDrawEvent(event)) {
        return false;
      }
      if (seenEventIds.has(event.id)) {
        return false;
      }
      return true;
    });

    markEventsSeen(currentEvents);

    if (drawEvents.length) {
      startDraw(drawEvents, animationEvents);
    }
  });

  function markEventsSeen(currentEvents: ActionTimelineEvent[]) {
    for (const event of currentEvents) {
      seenEventIds.add(event.id);
    }
  }

  function drawPlanMotions(plan: ReplayAnimationPhasePlan | undefined): CardMoveAnimationMotion[] {
    return (plan?.motions ?? []).filter((motion): motion is CardMoveAnimationMotion =>
      motion.kind === 'card-move'
      && motion.coordinateSpace === 'viewport'
      && motion.sourceAnchor.kind === 'deck-top'
      && motion.targetAnchor.kind === 'hand-card'
      && replayAnimationPlanHasPhase(plan, 'Draw', motion.sourceAnchor.playerIndex),
    );
  }

  function drawPlanKey(motions: CardMoveAnimationMotion[]): string {
    return motions.map((motion) => motion.id).join('|');
  }

  function isDrawEvent(event: ActionTimelineEvent): boolean {
    return event.kind === 'Draw' || event.kind === 'DrawReverse';
  }

  function startPlannedDraw(motions: CardMoveAnimationMotion[]): boolean {
    const sprites = motions.flatMap((motion, index) => plannedSpriteForMotion(motion, index) ?? []);
    if (!sprites.length) {
      return false;
    }

    const animation: DrawAnimation = {
      id: nextAnimationId++,
      sprites,
      hiddenTargets: [],
    };
    draws = [...draws, animation];

    const timer = setTimeout(() => {
      showTargets(animation.hiddenTargets);
      draws = draws.filter((item) => item.id !== animation.id);
    }, Math.max(...sprites.map((sprite) => sprite.delayMs + Math.round(sprite.durationMs * 0.88))));
    timers.push(timer);
    return true;
  }

  function plannedSpriteForMotion(motion: CardMoveAnimationMotion, index: number): DrawSprite | undefined {
    const sourceElement = animationElementForMotionAnchor(motion.sourceAnchor, motion.identity);
    const targetElement = animationElementForMotionAnchor(motion.targetAnchor, motion.identity);
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
      targetElement,
    };
  }

  function startDraw(
    drawEvents: ActionTimelineEvent[],
    animationEvents: ActionTimelineEvent[],
  ) {
    if (reduceMotion) {
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
    const targetElements = playerDraws.flatMap((draw) => draw.hiddenTargets);
    if (!sprites.length) {
      return;
    }
    const hiddenTargets = hideTargets(targetElements);

    const animation: DrawAnimation = {
      id: nextAnimationId++,
      sprites,
      hiddenTargets,
    };
    draws = [...draws, animation];
    for (const sprite of sprites) {
      if (!sprite.targetElement) {
        continue;
      }
      const timer = setTimeout(() => {
        showTargets(hiddenTargets.filter((target) => target.element === sprite.targetElement));
      }, sprite.delayMs + cardHandoffMs);
      timers.push(timer);
    }
    const timer = setTimeout(() => {
      showTargets(animation.hiddenTargets);
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
      showTargets(draw.hiddenTargets);
    }
    draws = [];
  }

  function spritesForPlayer(playerIndex: number, playerEvents: ActionTimelineEvent[], animationEvents: ActionTimelineEvent[]): PlayerDrawSprites {
    const deckElement = deckTopElement(playerIndex);
    const handElement = handAnchor(playerIndex);
    if (!deckElement || !handElement) {
      return { sprites: [], hiddenTargets: [] };
    }

    const deckRect = deckElement.getBoundingClientRect();
    const handRect = handElement.getBoundingClientRect();
    if (deckRect.width <= 0 || deckRect.height <= 0 || handRect.width <= 0 || handRect.height <= 0) {
      return { sprites: [], hiddenTargets: [] };
    }

    const handSlots = handCardSlots(handElement, playerIndex);
    const firstTargetIndex = Math.max(0, handSlots.length - playerEvents.length);
    const handConcealed = handElement.classList.contains('concealed');
    const startCenter = centerOf(deckRect);
    const spriteWidth = deckRect.width;
    const spriteHeight = spriteWidth * cardHeightToWidthRatio;
    const resetHandBeforeDraw = hasHandToDeckReset(playerIndex, animationEvents);
    const hiddenTargets: HTMLElement[] = resetHandBeforeDraw ? [...handSlots] : [];

    const sprites = playerEvents.map((event, index) => {
      const params = event.params as Record<string, unknown> | undefined;
      const serial = Number(params?.serial);
      const targetElement = resetHandBeforeDraw
        ? handSlotForSerial(handSlots, serial) ?? handSlots[index]
        : handSlots[firstTargetIndex + index];
      if (targetElement && !resetHandBeforeDraw) {
        hiddenTargets.push(targetElement);
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
        targetElement,
      };
    });
    return { sprites, hiddenTargets };
  }

  function hasHandToDeckReset(playerIndex: number, animationEvents: ActionTimelineEvent[]): boolean {
    return animationEvents.some((event) => {
      const params = event.params as Record<string, unknown> | undefined;
      return event.kind === 'MoveCard'
        && event.playerIndex === playerIndex
        && Number(params?.fromArea) === CabtAreaType.HAND
        && Number(params?.toArea) === CabtAreaType.DECK;
    });
  }

  function hideTargets(targets: HTMLElement[]) {
    const hiddenTargets: HiddenDrawTarget[] = [];
    for (const target of targets) {
      hiddenTargets.push(hideElementForAnimation({
        element: target,
        scopeKey,
        role: 'destination',
        fallbackAttribute: 'data-draw-animation-hidden',
      }));
    }
    return hiddenTargets;
  }

  function showTargets(targets: HiddenDrawTarget[]) {
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
