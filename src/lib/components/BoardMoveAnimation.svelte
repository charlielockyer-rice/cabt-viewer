<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import CardTile from './CardTile.svelte';
  import { actionAnimationBatchEvents, actionAnimationStartMs, actionAnimationTiming } from '../cabt/actionAnimationSchedule';
  import { isLiveBoardMoveEvent, liveBoardMoveHandoffDelayMs, ownsLiveBoardMovePhase } from '../cabt/replayBoardMoveEvents';
  import type { AnimationAnchorRef, AnimationIdentity } from '../animations/animationAnchors';
  import { afterTwoAnimationFrames } from '../animations/animationFrames';
  import { strictAnimationVisualElementForAnchor } from '../animations/animationAnchorVisuals';
  import {
    hideElementForAnimation,
    releaseElementVisibilityClaim,
    type ElementVisibilityClaim,
  } from '../animations/animationVisibilityClaims';
  import { replayAnimationScopeExitSettleMs, replayAnimationSpriteRemovalMs } from '../animations/replayAnimationHandoff';
  import { createReplayPhasePlanRunner } from '../animations/replayPhasePlanRunner.svelte';
  import {
    liveBoardMoveSpriteForInput,
    plannedBoardMoveSpriteForMotion,
    type BoardMoveSprite,
    type LiveBoardMoveHandoff,
    type LiveBoardMoveSpriteInput,
    type LiveBoardMoveSprite,
  } from '../animations/boardMoveSprites';
  import { liveBoardMoveInstructionsForEvent, type LiveBoardMoveElementResolver } from '../animations/liveBoardMoveInstructions';
  import {
    isResolvingCleanupCardMoveMotion,
    replayAnimationPhasePlanKey,
    replayAnimationPlanOwnsMotion,
    type CardMoveAnimationMotion,
    type ReplayAnimationPhasePlan,
  } from '../animations/replayAnimationPlan';
  import { elementRectInPlane } from '../dom/planeGeometry';
  import { cardBackCssVar } from '../game/cardAssets';
  import type { ActionTimelineEvent, CardView } from '../game/types';

  type Props = {
    events?: ActionTimelineEvent[];
    scopeKey?: string | number;
    replayMode?: boolean;
    animationPlan?: ReplayAnimationPhasePlan;
  };

  type LiveHiddenBoardMoveElement = ElementVisibilityClaim;

  const boardMoveHandoffPollMs = 16;
  const boardMoveHandoffMaxWaitMs = 300;

  let {
    events = [],
    scopeKey = '',
    replayMode = false,
    animationPlan,
  }: Props = $props();

  let motionLayer = $state<HTMLElement>();
  const timers: ReturnType<typeof setTimeout>[] = [];
  const handoffTimers: ReturnType<typeof setTimeout>[] = [];
  const handoffFrameIds: number[] = [];
  let sprites = $state<BoardMoveSprite[]>([]);
  let animationGeneration = 0;
  const liveHiddenElements = new Map<HTMLElement, LiveHiddenBoardMoveElement[]>();
  const liveBoardMoveElementResolver: LiveBoardMoveElementResolver = {
    stadiumCard: stadiumCardElement,
    deckTop: deckTopElement,
    pokemon: pokemonElementForIdentity,
    boardAnchor,
    discardCard: discardCardElement,
    discardPile: discardPileElement,
  };
  const replayPlanRunner = createReplayPhasePlanRunner({
    selectMotions: boardCardMoveMotions,
    planKey: (_motions, plan) => replayAnimationPhasePlanKey(plan),
    onScopeChange: () => clearBoardMoves({ settleHandoff: replayMode }),
    onPlanChange: () => clearBoardMoves({ settleHandoff: replayMode }),
    startPlanned: startPlannedBoardMoves,
  });

  onDestroy(() => {
    clearBoardMoves();
    for (const timer of handoffTimers) {
      clearTimeout(timer);
    }
    handoffTimers.length = 0;
    for (const frameId of handoffFrameIds) {
      cancelAnimationFrame(frameId);
    }
    handoffFrameIds.length = 0;
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
    replay.markEventsSeen(currentEvents);
    if (!animationEvents.length || replay.reduceMotion) {
      return;
    }

    startLiveBoardMoves(animationEvents);
  });

  function boardCardMoveMotions(plan: ReplayAnimationPhasePlan | undefined): CardMoveAnimationMotion[] {
    return (plan?.motions ?? []).filter((motion): motion is CardMoveAnimationMotion =>
      motion.kind === 'card-move'
      && motion.coordinateSpace === 'board'
      && motion.sourceAnchor.kind !== 'attached-energy'
      && motion.sourceAnchor.kind !== 'attached-tool'
      && boardMoveOwnsPlannedMotion(plan, motion));
  }

  function boardMoveOwnsPlannedMotion(plan: ReplayAnimationPhasePlan | undefined, motion: CardMoveAnimationMotion): boolean {
    if (isResolvingCleanupCardMoveMotion(motion)) {
      return true;
    }
    return replayAnimationPlanOwnsMotion(plan, motion, [
      'BoardMove',
      'BoardToDeck',
      'DeckBoardPlace',
      'DeckPrizePlace',
      'StadiumMove',
      'DiscardRecover',
      'KnockOut',
    ]);
  }

  function startPlannedBoardMoves(motions: CardMoveAnimationMotion[]) {
    const boardPlane = motionLayer?.parentElement;
    if (!motionLayer || !boardPlane) {
      return;
    }
    const generation = animationGeneration;
    for (const motion of motions) {
      const sourceElement = elementForAnchor(motion.sourceAnchor, motion.identity);
      const targetElement = elementForAnchor(motion.targetAnchor, motion.identity);
      if (!sourceElement || !targetElement) {
        continue;
      }
      const sourceRect = elementRectInPlane(sourceElement, boardPlane);
      const targetRect = elementRectInPlane(targetElement, boardPlane);
      if (!sourceRect || !targetRect) {
        continue;
      }
      const sprite = plannedBoardMoveSpriteForMotion({
        motion,
        sourceRect,
        targetRect,
        generation,
        opponentSide: isOpponentAnchor(motion.sourceAnchor) || isOpponentAnchor(motion.targetAnchor),
      });
      if (!sprite) {
        continue;
      }
      startPlannedBoardMoveSprite({
        sprite,
        source: sourceElement,
        target: targetElement,
        generation,
        handoffDelayMs: plannedBoardMoveHandoffDelayMs(motion),
        holdUntilScopeChange: motion.handoffPolicy.removeSprite === 'scope-exit',
      });
    }
  }

  function startPlannedBoardMoveSprite(input: {
    sprite: BoardMoveSprite;
    source: HTMLElement;
    target: HTMLElement;
    generation: number;
    handoffDelayMs?: number;
    holdUntilScopeChange: boolean;
  }) {
    const startTimer = setTimeout(async () => {
      if (input.generation !== animationGeneration) {
        return;
      }
      sprites = [...sprites, input.sprite];
      await tick();
      if (input.generation !== animationGeneration) {
        return;
      }
      if (!document.body.contains(input.source) || !document.body.contains(input.target)) {
        sprites = sprites.filter((item) => item.id !== input.sprite.id);
        return;
      }

      const correction = measureSpriteCorrection(input.sprite, input.target);
      sprites = sprites.map((item) => item.id === input.sprite.id
        ? {
            ...item,
            correctionX: correction.x,
            correctionY: correction.y,
            measuring: false,
          }
        : item);
      if (input.holdUntilScopeChange || input.handoffDelayMs === undefined) {
        return;
      }
      const finishTimer = setTimeout(() => {
        removeSpritesAfterPrepaint(new Set([input.sprite.id]), input.generation);
      }, input.handoffDelayMs);
      timers.push(finishTimer);
    }, input.sprite.delayMs);
    timers.push(startTimer);
  }

  function plannedBoardMoveHandoffDelayMs(motion: CardMoveAnimationMotion) {
    const removeMs = replayAnimationSpriteRemovalMs(motion, animationPlan?.durationMs);
    return removeMs === undefined ? undefined : Math.max(0, removeMs - motion.startMs);
  }

  function startLiveBoardMoves(animationEvents: ActionTimelineEvent[]) {
    const boardPlane = motionLayer?.parentElement;
    if (!motionLayer || !boardPlane) {
      return;
    }
    const generation = animationGeneration;
    const moveEvents = animationEvents.filter((event) =>
      isLiveBoardMoveEvent(event)
      && ownsLiveBoardMovePhase(animationEvents, event));
    for (const instruction of moveEvents.flatMap((event) =>
      liveBoardMoveInstructionsForEvent(event, moveEvents, liveBoardMoveElementResolver))) {
      const sourceElement = instruction.source;
      const targetElement = instruction.target;
      const sourceRect = elementRectInPlane(sourceElement, boardPlane);
      const targetRect = elementRectInPlane(targetElement, boardPlane);
      if (!sourceRect || !targetRect) {
        continue;
      }

      const delayMs = actionAnimationStartMs(animationEvents, instruction.event);
      startLiveBoardMoveInstruction({
        source: sourceElement,
        target: targetElement,
        sourceRect,
        targetRect,
        cardId: instruction.cardId,
        serial: instruction.serial,
        waitForDestinationCard: instruction.waitForDestinationCard,
        holdUntilScopeChange: instruction.holdUntilScopeChange,
        toDeck: instruction.toDeck,
        fromDeck: instruction.fromDeck,
        opponentSide: isOpponentSide(sourceElement) || isOpponentSide(targetElement),
        delayMs,
        durationMs: actionAnimationTiming.boardMoveMs,
        key: `${instruction.event.id}-${instruction.key}`,
      }, generation, liveBoardMoveHandoffDelayMs(animationEvents, {
        fromDeck: instruction.fromDeck,
        delayMs,
      }));
    }
  }

  function startLiveBoardMoveInstruction(
    instruction: Omit<LiveBoardMoveSpriteInput, 'generation'> & { holdUntilScopeChange: boolean },
    generation: number,
    handoffDelayMs?: number,
  ) {
    const sprite = liveBoardMoveSpriteForInput({
      ...instruction,
      generation,
    });
    if (!sprite) {
      return;
    }

    const startTimer = setTimeout(async () => {
      if (generation !== animationGeneration) {
        return;
      }
      sprites = [...sprites, sprite];
      await tick();
      if (generation !== animationGeneration) {
        return;
      }
      if (!document.body.contains(instruction.source) || !document.body.contains(instruction.target)) {
        sprites = sprites.filter((item) => item.id !== sprite.id);
        return;
      }

      const correction = measureSpriteCorrection(sprite, instruction.target);
      hideLiveBoardMoveElement(instruction.source);
      hideLiveBoardMoveElement(instruction.target);
      sprites = sprites.map((item) => item.id === sprite.id
        ? {
            ...item,
            correctionX: correction.x,
            correctionY: correction.y,
            measuring: false,
          }
        : item);
      if (instruction.holdUntilScopeChange) {
        return;
      }
      const resolvedHandoffDelayMs = handoffDelayMs ?? instruction.durationMs;
      if (resolvedHandoffDelayMs === undefined) {
        return;
      }
      const finishTimer = setTimeout(() => {
        handOffLiveBoardMoveWhenDestinationReady(instruction.source, instruction.target, sprite, Date.now(), generation);
      }, resolvedHandoffDelayMs);
      timers.push(finishTimer);
    }, instruction.delayMs);
    timers.push(startTimer);
  }

  function elementForAnchor(anchor: AnimationAnchorRef, identity?: AnimationIdentity): HTMLElement | null {
    return strictAnimationVisualElementForAnchor(anchor, identity) ?? null;
  }

  function isOpponentAnchor(anchor: AnimationAnchorRef): boolean {
    const element = elementForAnchor(anchor);
    return !!element && isOpponentSide(element);
  }

  function stadiumCardElement(playerIndex: number, serial: number): HTMLElement | null {
    const stadium = document.querySelector(`[data-card-anchor="player:${playerIndex}:stadium"][data-card-serial="${serial}"]`);
    return stadium instanceof HTMLElement ? stadium : null;
  }

  function discardCardElement(playerIndex: number, serial: number | undefined, cardId: number | undefined): HTMLElement | null {
    const pile = document.querySelector(`[data-card-anchor="player:${playerIndex}:discard"]`);
    if (!(pile instanceof HTMLElement)) {
      return null;
    }
    const card = serial !== undefined
      ? pile.querySelector(`.card-tile[data-card-serial="${serial}"]`)
      : cardId !== undefined
        ? pile.querySelector(`.card-tile[data-card-id="${cardId}"]`)
        : null;
    return card instanceof HTMLElement ? card : null;
  }

  function boardAnchor(playerIndex: number, slot: 'active' | 'bench', index: number): HTMLElement | null {
    const element = document.querySelector(`[data-card-anchor="player:${playerIndex}:${slot}:${index}"]`);
    return element instanceof HTMLElement ? element : null;
  }

  function deckTopElement(playerIndex: number): HTMLElement | null {
    const anchor = document.querySelector(`[data-card-anchor="player:${playerIndex}:deck"]`);
    const pile = anchor?.closest('.deck-pile') as HTMLElement | null;
    return pile?.querySelector('.deck-card-face') ?? pile;
  }

  function discardPileElement(playerIndex: number): HTMLElement | null {
    const element = document.querySelector(`[data-animation-anchor-key="player:${playerIndex}:discard-pile"]`);
    return element instanceof HTMLElement ? element : null;
  }

  function pokemonElementForIdentity(serial: number | undefined, cardId: number | undefined, playerIndex: number | undefined): HTMLElement | null {
    if (serial !== undefined) {
      const bySerial = document.querySelector(`[data-pokemon-serial="${serial}"]`);
      if (bySerial instanceof HTMLElement) {
        return bySerial;
      }
    }
    if (cardId !== undefined && playerIndex !== undefined) {
      const byCard = document.querySelector(`[data-owner-index="${playerIndex}"][data-pokemon-card-id="${cardId}"]`);
      if (byCard instanceof HTMLElement) {
        return byCard;
      }
    }
    return null;
  }

  function isOpponentSide(slotElement: HTMLElement): boolean {
    return !!slotElement.closest('.top-active-slot, .bench-row.opponent, .top-stadium-card');
  }

  function clearBoardMoves({ settleHandoff = false }: { settleHandoff?: boolean } = {}) {
    animationGeneration += 1;
    const cleanupGeneration = animationGeneration;
    for (const timer of timers) {
      clearTimeout(timer);
    }
    timers.length = 0;
    const elementsToRestore = liveHiddenElementSnapshots();
    const spriteIdsToClear = new Set(sprites.map((sprite) => sprite.id));
    if (settleHandoff && (elementsToRestore.length || spriteIdsToClear.size)) {
      const timer = setTimeout(() => {
        restoreLiveBoardMoveElements(elementsToRestore);
        removeSpritesAfterPrepaint(spriteIdsToClear, cleanupGeneration);
        const timerIndex = handoffTimers.indexOf(timer);
        if (timerIndex >= 0) {
          handoffTimers.splice(timerIndex, 1);
        }
      }, replayAnimationScopeExitSettleMs);
      handoffTimers.push(timer);
      return;
    }

    restoreLiveBoardMoveElements(elementsToRestore);
    sprites = [];
  }

  function liveHiddenElementSnapshots() {
    return [...liveHiddenElements.values()].flat();
  }

  function restoreLiveBoardMoveElements(elements: LiveHiddenBoardMoveElement[]) {
    for (const hidden of elements) {
      releaseLiveBoardMoveElementClaim(hidden);
    }
  }

  function hideLiveBoardMoveElement(element: HTMLElement) {
    const hidden = hideElementForAnimation({
      element,
      scopeKey,
      role: 'handoff',
      fallbackAttribute: 'data-board-move-animation-hidden',
    });
    const existing = liveHiddenElements.get(element) ?? [];
    liveHiddenElements.set(element, [...existing, hidden]);
  }

  function showLiveBoardMoveElement(element: HTMLElement) {
    const entries = liveHiddenElements.get(element);
    if (!entries?.length) {
      return;
    }
    for (const hidden of entries) {
      releaseElementVisibilityClaim(hidden);
    }
    liveHiddenElements.delete(element);
  }

  function releaseLiveBoardMoveElementClaim(hidden: LiveHiddenBoardMoveElement) {
    const entries = liveHiddenElements.get(hidden.element);
    if (!entries?.length) {
      return;
    }
    const index = entries.indexOf(hidden);
    if (index >= 0) {
      entries.splice(index, 1);
    }
    releaseElementVisibilityClaim(hidden);
    if (entries.length) {
      liveHiddenElements.set(hidden.element, entries);
      return;
    }
    liveHiddenElements.delete(hidden.element);
  }

  function removeSpritesAfterPrepaint(spriteIdsToClear: Set<string>, generation: number) {
    if (!spriteIdsToClear.size) {
      return;
    }
    afterTwoAnimationFrames(() => {
      if (generation === animationGeneration) {
        sprites = sprites.filter((sprite) => !spriteIdsToClear.has(sprite.id));
      }
    }, handoffFrameIds);
  }

  function measureSpriteCorrection(sprite: BoardMoveSprite, target: HTMLElement) {
    const spriteElement = document.querySelector(`[data-board-move-id="${sprite.id}"] .card-tile`);
    if (!(spriteElement instanceof HTMLElement)) {
      return { x: 0, y: 0 };
    }
    const spriteRect = spriteElement.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const projectedScaleX = spriteRect.width / sprite.width;
    const projectedScaleY = spriteRect.height / sprite.height;
    return {
      x: projectedScaleX > 0 ? (targetRect.left - spriteRect.left) / projectedScaleX : 0,
      y: projectedScaleY > 0 ? (targetRect.top - spriteRect.top) / projectedScaleY : 0,
    };
  }

  function handOffLiveBoardMoveWhenDestinationReady(
    source: HTMLElement,
    target: HTMLElement,
    sprite: LiveBoardMoveSprite,
    startTime: number,
    generation: number,
  ) {
    if (generation !== animationGeneration) {
      return;
    }
    const destinationReady = sprite.lifecycle.handoff.waitForDestinationCard
      ? liveDestinationContainsCard(target, sprite.lifecycle.handoff)
      : sprite.toDeck
        ? true
      : !!target.querySelector('.card-tile');
    const timedOut = Date.now() - startTime >= boardMoveHandoffMaxWaitMs;
    const detached = !document.body.contains(source) || !document.body.contains(target);
    if (destinationReady || timedOut || detached) {
      showLiveBoardMoveElement(source);
      showLiveBoardMoveElement(target);
      removeSpritesAfterPrepaint(new Set([sprite.id]), generation);
      return;
    }

    const retry = setTimeout(() => {
      handOffLiveBoardMoveWhenDestinationReady(source, target, sprite, startTime, generation);
    }, boardMoveHandoffPollMs);
    timers.push(retry);
  }

  function liveDestinationContainsCard(target: HTMLElement, handoff: LiveBoardMoveHandoff) {
    const selector = handoff.destinationSerial !== undefined
      ? `.card-tile[data-card-serial="${handoff.destinationSerial}"]`
      : `.card-tile[data-card-id="${handoff.destinationCardId}"]`;
    return target.matches(selector) || !!target.querySelector(selector);
  }

  function spriteStyle(sprite: BoardMoveSprite) {
    return [
      `left: ${sprite.left}px`,
      `top: ${sprite.top}px`,
      `width: ${sprite.width}px`,
      `height: ${sprite.height}px`,
      `--board-move-source-slot-w: ${sprite.width}px`,
      `--board-move-start-x: ${sprite.startX.toFixed(3)}px`,
      `--board-move-start-y: ${sprite.startY.toFixed(3)}px`,
      `--board-move-start-scale: ${sprite.startScale.toFixed(6)}`,
      `--board-move-correction-x: ${sprite.correctionX.toFixed(3)}px`,
      `--board-move-correction-y: ${sprite.correctionY.toFixed(3)}px`,
      `--board-move-duration: ${sprite.durationMs}ms`,
    ].join('; ');
  }

  function spriteCard(sprite: BoardMoveSprite): CardView | undefined {
    return sprite.card as CardView | undefined;
  }
</script>

<span class="board-move-animation-layer" style={cardBackCssVar()} bind:this={motionLayer} aria-hidden="true">
  {#each sprites as sprite (sprite.id)}
    <span
      class="board-move-card"
      class:opponent-side={sprite.opponentSide}
      class:measuring={sprite.measuring}
      class:to-deck={sprite.toDeck}
      data-board-move-id={sprite.id}
      style={spriteStyle(sprite)}
    >
      <span class="board-move-card-inner">
        {#if sprite.card || sprite.faceDown}
          <CardTile card={spriteCard(sprite)} compact faceDown={sprite.faceDown} />
        {:else if sprite.html}
          {@html sprite.html}
        {:else}
          <span class="board-move-fallback">{sprite.fallbackName}</span>
        {/if}
      </span>
    </span>
  {/each}
</span>

<style>
  .board-move-animation-layer {
    position: absolute;
    inset: 0;
    z-index: 29;
    transform-style: preserve-3d;
    pointer-events: none;
  }

  .board-move-card {
    position: absolute;
    display: block;
    transform-origin: 50% 50%;
    transform-style: preserve-3d;
    animation: board-card-move var(--board-move-duration, 520ms) cubic-bezier(0.22, 0.78, 0.2, 1) both;
    will-change: transform;
  }

  .board-move-card.measuring {
    opacity: 0;
    animation: none;
    transform:
      translate3d(0, 0, 0)
      scale(1);
  }

  .board-move-card-inner {
    position: relative;
    display: block;
    width: 100%;
    height: 100%;
    transform-style: preserve-3d;
  }

  .board-move-card.to-deck .board-move-card-inner {
    animation: board-card-flip-to-back var(--board-move-duration, 520ms) ease-in-out both;
  }

  .board-move-card.to-deck .board-move-card-inner::after {
    content: "";
    position: absolute;
    inset: 0;
    border-radius: 5px;
    background:
      var(--card-back-image),
      radial-gradient(circle at 50% 45%, rgba(255, 255, 255, 0.9) 0 14%, rgba(255, 255, 255, 0) 15%),
      linear-gradient(145deg, #2563eb 0%, #1d4ed8 46%, #f59e0b 47%, #f59e0b 53%, #1d4ed8 54%, #1e3a8a 100%);
    background-size: cover;
    background-position: center;
    box-shadow: 0 3px 8px rgba(23, 30, 38, 0.28);
    backface-visibility: hidden;
    transform: rotateY(180deg) rotate(var(--board-move-back-rotation, 0deg));
  }

  .board-move-card.to-deck.opponent-side {
    --board-move-back-rotation: 180deg;
  }

  .board-move-card.to-deck .board-move-card-inner > :global(*) {
    backface-visibility: hidden;
  }

  .board-move-card :global(.card-tile) {
    width: 100%;
    height: 100%;
    pointer-events: none;
  }

  .board-move-card :global(.board-slot) {
    --slot-card-w: var(--board-move-source-slot-w);
    width: 100%;
    height: 100%;
    pointer-events: none;
    transition: none;
  }

  .board-move-card.opponent-side :global(.card-tile) {
    transform: rotate(180deg);
  }

  .board-move-card.opponent-side :global(.energy-badges) {
    inset: calc(var(--slot-card-w) * -0.095) 0 auto auto;
    justify-content: flex-end;
    transform: rotate(180deg);
  }

  .board-move-card.opponent-side :global(.energy-badges .attached-energy-symbol) {
    transform: rotate(180deg);
  }

  .board-move-card.opponent-side :global(.tool-card-preview) {
    inset: auto auto var(--tool-preview-top) 0;
    transform: rotate(180deg);
  }

  .board-move-card.opponent-side :global(.pokemon-status) {
    inset: auto auto 0 0;
    align-items: start;
    justify-items: start;
  }

  .board-move-card.opponent-side :global(.damage-counter-value) {
    transform: rotate(180deg);
  }

  .board-move-fallback {
    display: grid;
    place-items: center;
    width: 100%;
    height: 100%;
    border-radius: 5px;
    background: #f7f8fa;
    box-shadow: 0 3px 8px rgba(23, 30, 38, 0.28);
    font-size: 12px;
    font-weight: 900;
    text-align: center;
  }

  :global(.board-slot.empty[data-board-move-animation-hidden="true"]) {
    border-color: transparent !important;
    background: transparent !important;
  }

  :global(.board-slot[data-board-move-animation-hidden="true"]) {
    transition: none !important;
  }

  :global(.board-slot[data-board-move-animation-hidden="true"] > .card-tile),
  :global(.board-slot[data-board-move-animation-hidden="true"] > .pokemon-status),
  :global(.board-slot[data-board-move-animation-hidden="true"] > .energy-badges),
  :global(.board-slot[data-board-move-animation-hidden="true"] > .tool-card-preview),
  :global(.board-slot[data-board-move-animation-hidden="true"] > .slot-badges),
  :global(.board-slot[data-board-move-animation-hidden="true"] > .empty-zone) {
    opacity: 0;
  }

  :global(.stadium-card[data-board-move-animation-hidden="true"]) {
    opacity: 0;
  }

  :global(.discard-pile .card-tile[data-board-move-animation-hidden="true"]) {
    opacity: 0;
  }

  @keyframes board-card-move {
    0% {
      transform:
        translate3d(
          calc(var(--board-move-start-x) + var(--board-move-correction-x)),
          calc(var(--board-move-start-y) + var(--board-move-correction-y)),
          0
        )
        scale(var(--board-move-start-scale));
    }
    100% {
      transform:
        translate3d(var(--board-move-correction-x), var(--board-move-correction-y), 0)
        scale(1);
    }
  }

  @keyframes board-card-flip-to-back {
    0%,
    36% {
      transform: rotateY(0deg);
    }
    100% {
      transform: rotateY(180deg);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .board-move-card {
      animation: none;
    }
  }
</style>
