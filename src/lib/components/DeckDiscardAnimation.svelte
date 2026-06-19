<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
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
  const cardSequenceStepMs = cardMoveDurationMs;
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
    for (const timer of timers) {
      clearTimeout(timer);
    }
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

    const discardEvents = currentEvents.filter((event) => {
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
      startDiscard(discardEvents);
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

  function startDiscard(discardEvents: ActionTimelineEvent[]) {
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
        delayMs: index * cardSequenceStepMs,
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
    };

    discards = [...discards, animation];
    const timer = setTimeout(() => {
      discards = discards.filter((item) => item.id !== animation.id);
    }, Math.max(0, sprites.length - 1) * cardSequenceStepMs + cardMoveDurationMs + 120);
    timers.push(timer);
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
          <span class="discard-card-face discard-card-back"></span>
          <span class="discard-card-face discard-card-front">
            {#if sprite.card.imageUrl}
              <img src={sprite.card.imageUrl} alt="" draggable="false" />
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
      var(--cardback-shade),
      url("/assets/cardback.png") center / cover no-repeat;
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
