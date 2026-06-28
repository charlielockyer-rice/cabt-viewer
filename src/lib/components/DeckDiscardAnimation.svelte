<script lang="ts">
  import { cardBackCssVar, cardFaceImageUrl } from '../game/cardAssets';
  import { onDestroy, onMount } from 'svelte';
  import {
    hideElementForAnimation,
    releaseElementVisibilityClaims,
    type ElementVisibilityClaim,
  } from '../animations/animationVisibilityClaims';
  import { actionAnimationBatchEvents, actionAnimationStartMs } from '../cabt/actionAnimationSchedule';
  import { cabtCardToView } from '../cabt/cardView';
  import { CabtAreaType } from '../cabt/types';
  import type { ActionTimelineEvent, CardView } from '../game/types';

  type Props = {
    events?: ActionTimelineEvent[];
    playerIndex: number;
    deckElement?: HTMLElement;
    discardElement?: HTMLElement;
    scopeKey?: string | number;
    replayMode?: boolean;
    opponent?: boolean;
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
  };

  type DiscardAnimation = {
    id: number;
    sprites: DiscardSprite[];
    destinationClaims: ElementVisibilityClaim[];
  };

  let {
    events = [],
    playerIndex,
    deckElement,
    discardElement,
    scopeKey = '',
    replayMode = false,
    opponent = false,
  }: Props = $props();

  const timers: ReturnType<typeof setTimeout>[] = [];
  const cardMoveDurationMs = 300;
  let discards = $state<DiscardAnimation[]>([]);
  let seenEventIds = new Set<number>();
  let initialized = false;
  let nextAnimationId = 1;
  let reduceMotion = $state(false);
  let lastScopeKey: string | number = '';

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
    clearDiscards();
  });

  $effect(() => {
    const currentEvents = events;
    const currentScopeKey = scopeKey;
    const scopeChanged = initialized && currentScopeKey !== lastScopeKey;
    lastScopeKey = currentScopeKey;

    if (!initialized) {
      for (const event of currentEvents) {
        seenEventIds.add(event.id);
      }
      initialized = true;
      return;
    }

    if (scopeChanged && replayMode) {
      clearDiscards();
    }

    const animationEvents = actionAnimationBatchEvents(currentEvents, seenEventIds, replayMode, scopeChanged);
    const discardEvents = animationEvents.filter((event) => {
      if (!isDeckDiscardEvent(event)) {
        return false;
      }
      if ((!replayMode || !scopeChanged) && seenEventIds.has(event.id)) {
        return false;
      }
      return true;
    });

    for (const event of currentEvents) {
      seenEventIds.add(event.id);
    }

    if (discardEvents.length) {
      startDiscard(discardEvents, animationEvents);
    }
  });

  function isDeckDiscardEvent(event: ActionTimelineEvent) {
    const params = event.params as Record<string, unknown> | undefined;
    return event.kind === 'MoveCard'
      && event.playerIndex === playerIndex
      && Number(params?.fromArea) === CabtAreaType.DECK
      && Number(params?.toArea) === CabtAreaType.DISCARD
      && Number.isFinite(Number(params?.cardId));
  }

  function startDiscard(discardEvents: ActionTimelineEvent[], animationEvents: ActionTimelineEvent[]) {
    if (reduceMotion || !deckElement || !discardElement) {
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
      };
    });

    const animation: DiscardAnimation = {
      id: nextAnimationId++,
      sprites,
      destinationClaims: discardEvents.flatMap((event) => destinationClaimsForEvent(event)),
    };

    discards = [...discards, animation];
    const timer = setTimeout(() => {
      releaseDestinationClaims(animation);
      discards = discards.filter((item) => item.id !== animation.id);
      const timerIndex = timers.indexOf(timer);
      if (timerIndex >= 0) {
        timers.splice(timerIndex, 1);
      }
    }, Math.max(...sprites.map((sprite) => sprite.delayMs)) + cardMoveDurationMs + 120);
    timers.push(timer);
  }

  function clearDiscards() {
    for (const timer of timers) {
      clearTimeout(timer);
    }
    timers.length = 0;
    for (const discard of discards) {
      releaseDestinationClaims(discard);
    }
    discards = [];
  }

  function destinationClaimsForEvent(event: ActionTimelineEvent): ElementVisibilityClaim[] {
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

  function releaseDestinationClaims(animation: DiscardAnimation) {
    releaseElementVisibilityClaims(animation.destinationClaims);
    animation.destinationClaims = [];
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
      `z-index: ${sprite.order}`,
    ].join('; ');
  }

  function cssPixelValue(value: string): number {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
</script>

<span class="deck-discard-animation" aria-hidden="true">
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
    animation: deck-discard-travel 300ms cubic-bezier(0.24, 0.78, 0.24, 1) var(--discard-delay) both;
    will-change: transform, opacity;
  }

  .discard-card-inner {
    position: absolute;
    inset: 0;
    display: block;
    border-radius: inherit;
    transform-style: preserve-3d;
    animation: deck-discard-flip 300ms ease-in-out var(--discard-delay) both;
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
