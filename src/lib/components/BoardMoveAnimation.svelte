<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte';
  import { actionAnimationBatchEvents, actionAnimationStartMs, actionAnimationTiming } from '../cabt/actionAnimationSchedule';
  import { cabtCardToView } from '../cabt/cardView';
  import { CabtAreaType } from '../cabt/types';
  import { cardBackCssVar } from '../game/cardAssets';
  import { replayAnimationPhaseGapMs } from '../game/replay';
  import type { ActionTimelineEvent } from '../game/types';

  type Props = {
    events?: ActionTimelineEvent[];
    scopeKey?: string | number;
    replayMode?: boolean;
  };

  type BoardMoveSprite = {
    id: string;
    html: string;
    fallbackName: string;
    left: number;
    top: number;
    width: number;
    height: number;
    startX: number;
    startY: number;
    startScale: number;
    correctionX: number;
    correctionY: number;
    destinationCardId: number;
    destinationSerial?: number;
    waitForDestinationCard: boolean;
    toDeck: boolean;
    fromDeck: boolean;
    opponentSide: boolean;
    delayMs: number;
    measuring: boolean;
  };

  type BoardMoveInstruction = {
    event: ActionTimelineEvent;
    source: HTMLElement;
    target: HTMLElement;
    cardId: number;
    serial?: number;
    waitForDestinationCard: boolean;
    toDeck: boolean;
    fromDeck: boolean;
    key: string;
  };

  const boardMoveHandoffPollMs = 16;
  const boardMoveHandoffMaxWaitMs = 300;
  const replayHandoffSettleMs = 40;

  let {
    events = [],
    scopeKey = '',
    replayMode = false,
  }: Props = $props();

  let motionLayer = $state<HTMLElement>();
  const timers: ReturnType<typeof setTimeout>[] = [];
  let seenEventIds = new Set<number>();
  let initialized = false;
  let lastScopeKey: string | number = '';
  let reduceMotion = $state(false);
  let sprites = $state<BoardMoveSprite[]>([]);
  let animationGeneration = 0;
  const activeHiddenElements = new Set<HTMLElement>();

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
    clearBoardMoves();
  });

  $effect(() => {
    const currentEvents = events;
    const currentScopeKey = scopeKey;
    const scopeChanged = initialized && currentScopeKey !== lastScopeKey;
    if (scopeChanged) {
      clearBoardMoves();
    }
    lastScopeKey = currentScopeKey;

    if (!initialized) {
      for (const event of currentEvents) {
        seenEventIds.add(event.id);
      }
      initialized = true;
      return;
    }

    const animationEvents = actionAnimationBatchEvents(currentEvents, seenEventIds, replayMode, scopeChanged);
    for (const event of currentEvents) {
      seenEventIds.add(event.id);
    }
    if (!animationEvents.length || reduceMotion) {
      return;
    }

    startBoardMoves(animationEvents);
  });

  function startBoardMoves(animationEvents: ActionTimelineEvent[]) {
    const boardPlane = motionLayer?.parentElement;
    if (!motionLayer || !boardPlane) {
      return;
    }
    const generation = animationGeneration;
    const moveEvents = animationEvents.filter(isBoardMoveEvent);
    for (const instruction of moveEvents.flatMap((event) => moveInstructionsForEvent(event, moveEvents))) {
      const sourceElement = instruction.source;
      const targetElement = instruction.target;
      const sourceRect = localElementRect(sourceElement, boardPlane);
      const targetRect = localElementRect(targetElement, boardPlane);
      if (!sourceRect || !targetRect || sourceRect.width <= 0 || targetRect.width <= 0) {
        continue;
      }

      const delayMs = actionAnimationStartMs(animationEvents, instruction.event);
      const sprite: BoardMoveSprite = {
        id: `${instruction.event.id}-${instruction.key}`,
        html: spriteHtml(sourceElement, targetElement, instruction.fromDeck),
        fallbackName: cabtCardToView(instruction.cardId).name,
        left: targetRect.left,
        top: targetRect.top,
        width: targetRect.width,
        height: targetRect.height,
        startX: sourceRect.left + sourceRect.width / 2 - (targetRect.left + targetRect.width / 2),
        startY: sourceRect.top + sourceRect.height / 2 - (targetRect.top + targetRect.height / 2),
        startScale: sourceRect.width / targetRect.width,
        correctionX: 0,
        correctionY: 0,
        destinationCardId: instruction.cardId,
        destinationSerial: instruction.serial,
        waitForDestinationCard: instruction.waitForDestinationCard,
        toDeck: instruction.toDeck,
        fromDeck: instruction.fromDeck,
        opponentSide: isOpponentSide(sourceElement) || isOpponentSide(targetElement),
        delayMs,
        measuring: true,
      };

      const startTimer = setTimeout(async () => {
        if (generation !== animationGeneration) {
          return;
        }
        sprites = [...sprites, sprite];
        await tick();
        if (generation !== animationGeneration) {
          return;
        }
        if (!document.body.contains(sourceElement) || !document.body.contains(targetElement)) {
          sprites = sprites.filter((item) => item.id !== sprite.id);
          return;
        }

        const correction = measureSpriteCorrection(sprite, targetElement);
        hideBoardMoveElement(sourceElement);
        hideBoardMoveElement(targetElement);
        sprites = sprites.map((item) => item.id === sprite.id
          ? {
              ...item,
              correctionX: correction.x,
              correctionY: correction.y,
              measuring: false,
            }
          : item);
        const finishTimer = setTimeout(() => {
          handOffWhenDestinationReady(sourceElement, targetElement, sprite, Date.now(), generation);
        }, boardMoveHandoffDelayMs(animationEvents, instruction, delayMs));
        timers.push(finishTimer);
      }, delayMs);
      timers.push(startTimer);
    }
  }

  function boardMoveHandoffDelayMs(
    animationEvents: ActionTimelineEvent[],
    instruction: BoardMoveInstruction,
    delayMs: number,
  ) {
    if (!instruction.fromDeck) {
      return actionAnimationTiming.boardMoveMs + replayHandoffHoldMs();
    }
    const latestDeckPlacementStartMs = Math.max(
      0,
      ...animationEvents
        .filter(isDeckBoardPlacementEvent)
        .map((event) => actionAnimationStartMs(animationEvents, event)),
    );
    return actionAnimationTiming.boardMoveMs
      + Math.max(0, latestDeckPlacementStartMs - delayMs)
      + replayHandoffHoldMs();
  }

  function replayHandoffHoldMs() {
    return replayMode ? replayAnimationPhaseGapMs + replayHandoffSettleMs : 0;
  }

  function isBoardMoveEvent(event: ActionTimelineEvent) {
    const params = event.params as Record<string, unknown> | undefined;
    const fromArea = Number(params?.fromArea);
    const toArea = Number(params?.toArea);
    return event.kind === 'Switch'
      || (
        event.kind === 'MoveCard'
        && (
          (fromArea === CabtAreaType.BENCH && toArea === CabtAreaType.ACTIVE)
          || (fromArea === CabtAreaType.ACTIVE && toArea === CabtAreaType.BENCH)
          || (fromArea === CabtAreaType.DECK && (toArea === CabtAreaType.ACTIVE || toArea === CabtAreaType.BENCH))
          || ((fromArea === CabtAreaType.ACTIVE || fromArea === CabtAreaType.BENCH) && toArea === CabtAreaType.DECK)
          || (fromArea === CabtAreaType.STADIUM && toArea === CabtAreaType.DISCARD)
        )
      );
  }

  function isDeckBoardPlacementEvent(event: ActionTimelineEvent) {
    const params = event.params as Record<string, unknown> | undefined;
    const fromArea = Number(params?.fromArea);
    const toArea = Number(params?.toArea);
    return event.kind === 'MoveCard'
      && fromArea === CabtAreaType.DECK
      && (toArea === CabtAreaType.ACTIVE || toArea === CabtAreaType.BENCH);
  }

  function moveInstructionsForEvent(event: ActionTimelineEvent, moveEvents: ActionTimelineEvent[]): BoardMoveInstruction[] {
    if (event.kind === 'Switch') {
      return switchMoveInstructions(event);
    }

    const source = sourceElementForEvent(event);
    const target = targetElementForEvent(event, moveEvents);
    const params = event.params as Record<string, unknown> | undefined;
    const cardId = Number(params?.cardId);
    if (!source || !target || !Number.isFinite(cardId)) {
      return [];
    }
    return [{
      event,
      source,
      target,
      cardId,
      serial: Number.isFinite(Number(params?.serial)) ? Number(params?.serial) : undefined,
      waitForDestinationCard: Number(params?.toArea) === CabtAreaType.DISCARD,
      toDeck: Number(params?.toArea) === CabtAreaType.DECK,
      fromDeck: Number(params?.fromArea) === CabtAreaType.DECK,
      key: `${params?.serial ?? cardId}`,
    }];
  }

  function switchMoveInstructions(event: ActionTimelineEvent): BoardMoveInstruction[] {
    const params = event.params as Record<string, unknown> | undefined;
    const activeCardId = Number(params?.cardIdActive);
    const benchCardId = Number(params?.cardIdBench);
    const activeSource = pokemonElementForIdentity(Number(params?.serialActive), activeCardId, event.playerIndex);
    const benchSource = pokemonElementForIdentity(Number(params?.serialBench), benchCardId, event.playerIndex);
    if (!activeSource || !benchSource || !Number.isFinite(activeCardId) || !Number.isFinite(benchCardId)) {
      return [];
    }
    return [
      {
        event,
        source: activeSource,
        target: benchSource,
        cardId: activeCardId,
        serial: Number.isFinite(Number(params?.serialActive)) ? Number(params?.serialActive) : undefined,
        waitForDestinationCard: false,
        toDeck: false,
        fromDeck: false,
        key: `active-${params?.serialActive ?? activeCardId}`,
      },
      {
        event,
        source: benchSource,
        target: activeSource,
        cardId: benchCardId,
        serial: Number.isFinite(Number(params?.serialBench)) ? Number(params?.serialBench) : undefined,
        waitForDestinationCard: false,
        toDeck: false,
        fromDeck: false,
        key: `bench-${params?.serialBench ?? benchCardId}`,
      },
    ];
  }

  function sourceElementForEvent(event: ActionTimelineEvent): HTMLElement | null {
    const params = event.params as Record<string, unknown> | undefined;
    if (Number(params?.fromArea) === CabtAreaType.STADIUM && event.playerIndex !== undefined) {
      const stadium = document.querySelector(`[data-card-anchor="player:${event.playerIndex}:stadium"][data-card-serial="${Number(params?.serial)}"]`);
      return stadium instanceof HTMLElement ? stadium : null;
    }
    if (Number(params?.fromArea) === CabtAreaType.DECK && event.playerIndex !== undefined) {
      return deckTopElement(event.playerIndex);
    }
    const cardId = Number(params?.cardId);
    return pokemonElementForIdentity(Number(params?.serial), cardId, event.playerIndex);
  }

  function targetElementForEvent(event: ActionTimelineEvent, moveEvents: ActionTimelineEvent[]): HTMLElement | null {
    const params = event.params as Record<string, unknown> | undefined;
    const playerIndex = event.playerIndex;
    if (playerIndex === undefined) {
      return null;
    }
    const toArea = Number(params?.toArea);
    if (toArea === CabtAreaType.ACTIVE) {
      const destination = pokemonElementForIdentity(Number(params?.serial), Number(params?.cardId), playerIndex);
      if (destination) {
        return destination;
      }
      return boardAnchor(playerIndex, 'active', 0);
    }
    if (toArea === CabtAreaType.BENCH) {
      const destination = pokemonElementForIdentity(Number(params?.serial), Number(params?.cardId), playerIndex);
      if (destination) {
        return destination;
      }
      const benchIndex = Number(params?.toIndex ?? params?.index ?? params?.benchIndex);
      if (Number.isInteger(benchIndex)) {
        return boardAnchor(playerIndex, 'bench', benchIndex);
      }
      return pairedBenchSourceElement(event, moveEvents);
    }
    if (toArea === CabtAreaType.DISCARD && Number(params?.fromArea) === CabtAreaType.STADIUM) {
      const discard = document.querySelector(`[data-card-anchor="player:${playerIndex}:discard"]`);
      return discard instanceof HTMLElement ? discard : null;
    }
    if (toArea === CabtAreaType.DECK) {
      return deckTopElement(playerIndex);
    }
    return null;
  }

  function pairedBenchSourceElement(event: ActionTimelineEvent, moveEvents: ActionTimelineEvent[]): HTMLElement | null {
    const params = event.params as Record<string, unknown> | undefined;
    const fromArea = Number(params?.fromArea);
    const toArea = Number(params?.toArea);
    if (fromArea !== CabtAreaType.ACTIVE || toArea !== CabtAreaType.BENCH) {
      return null;
    }
    const pairedEvent = moveEvents.find((candidate) => {
      const candidateParams = candidate.params as Record<string, unknown> | undefined;
      return candidate !== event
        && candidate.playerIndex === event.playerIndex
        && Number(candidateParams?.fromArea) === CabtAreaType.BENCH
        && Number(candidateParams?.toArea) === CabtAreaType.ACTIVE;
    });
    return pairedEvent ? sourceElementForEvent(pairedEvent) : null;
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

  function pokemonElementForIdentity(serial: number, cardId: number, playerIndex: number | undefined): HTMLElement | null {
    if (Number.isFinite(serial)) {
      const bySerial = document.querySelector(`[data-pokemon-serial="${serial}"]`);
      if (bySerial instanceof HTMLElement) {
        return bySerial;
      }
    }
    if (Number.isFinite(cardId) && playerIndex !== undefined) {
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

  function localElementRect(element: HTMLElement, root: HTMLElement) {
    let left = 0;
    let top = 0;
    let current: HTMLElement | null = element;
    while (current && current !== root) {
      left += current.offsetLeft;
      top += current.offsetTop;
      current = current.offsetParent instanceof HTMLElement ? current.offsetParent : null;
    }
    if (current !== root) {
      return null;
    }
    const style = getComputedStyle(element);
    const width = parsedPixelValue(style.width) ?? element.offsetWidth;
    const height = parsedPixelValue(style.height) ?? element.offsetHeight;
    return {
      left,
      top,
      width,
      height,
    };
  }

  function parsedPixelValue(value: string) {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }

  function clearBoardMoves() {
    animationGeneration += 1;
    for (const timer of timers) {
      clearTimeout(timer);
    }
    timers.length = 0;
    for (const element of activeHiddenElements) {
      delete element.dataset.boardMoveAnimationHidden;
    }
    activeHiddenElements.clear();
    sprites = [];
  }

  function hideBoardMoveElement(element: HTMLElement) {
    activeHiddenElements.add(element);
    element.dataset.boardMoveAnimationHidden = 'true';
  }

  function showBoardMoveElement(element: HTMLElement) {
    delete element.dataset.boardMoveAnimationHidden;
    activeHiddenElements.delete(element);
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

  function spriteHtml(source: HTMLElement, target: HTMLElement, fromDeck = false) {
    const cloneSource = fromDeck ? target : source;
    const clone = cloneSource.cloneNode(true);
    if (!(clone instanceof HTMLElement)) {
      return cloneSource.outerHTML;
    }

    if (cloneSource.classList.contains('stadium-card')) {
      const cardTile = cloneSource.querySelector('.card-tile');
      return cardTile instanceof HTMLElement ? cardTile.outerHTML : cloneSource.outerHTML;
    }

    clone.className = target.classList.contains('board-slot') ? target.className : source.className;
    clone.classList.remove('empty');
    clone.classList.add('board-slot');
    clone.removeAttribute('id');
    clone.removeAttribute('data-testid');
    clone.removeAttribute('data-card-anchor');
    clone.removeAttribute('data-owner-index');
    clone.removeAttribute('data-slot-kind');
    clone.removeAttribute('data-slot-index');
    clone.removeAttribute('data-pokemon-card-id');
    clone.removeAttribute('data-pokemon-serial');
    clone.removeAttribute('title');
    clone.removeAttribute('data-board-move-animation-hidden');
    clone.removeAttribute('data-reveal-animation-hidden');
    return clone.outerHTML;
  }

  function handOffWhenDestinationReady(
    source: HTMLElement,
    target: HTMLElement,
    sprite: BoardMoveSprite,
    startTime: number,
    generation: number,
  ) {
    if (generation !== animationGeneration) {
      return;
    }
    const destinationReady = sprite.waitForDestinationCard
      ? destinationContainsCard(target, sprite)
      : sprite.toDeck
        ? true
      : !!target.querySelector('.card-tile');
    const timedOut = Date.now() - startTime >= boardMoveHandoffMaxWaitMs;
    const detached = !document.body.contains(source) || !document.body.contains(target);
    if (destinationReady || timedOut || detached) {
      showBoardMoveElement(source);
      showBoardMoveElement(target);
      sprites = sprites.filter((item) => item.id !== sprite.id);
      return;
    }

    const retry = setTimeout(() => {
      handOffWhenDestinationReady(source, target, sprite, startTime, generation);
    }, boardMoveHandoffPollMs);
    timers.push(retry);
  }

  function destinationContainsCard(target: HTMLElement, sprite: BoardMoveSprite) {
    const selector = sprite.destinationSerial !== undefined
      ? `.card-tile[data-card-serial="${sprite.destinationSerial}"]`
      : `.card-tile[data-card-id="${sprite.destinationCardId}"]`;
    return !!target.querySelector(selector);
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
    ].join('; ');
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
        {#if sprite.html}
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
    animation: board-card-move 520ms cubic-bezier(0.22, 0.78, 0.2, 1) both;
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
    animation: board-card-flip-to-back 520ms ease-in-out both;
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
