<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { cabtCardToView } from '../cabt/cardView';
  import type { ActionTimelineEvent, CardView } from '../game/types';

  type Props = {
    events?: ActionTimelineEvent[];
    scopeKey?: string | number;
    replayMode?: boolean;
  };

  type DrawSprite = {
    id: string;
    card?: CardView;
    reveal: boolean;
    order: number;
    delayMs: number;
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
    hiddenTargets: HTMLElement[];
  };

  type PlayerDrawSprites = {
    sprites: DrawSprite[];
    hiddenTargets: HTMLElement[];
  };

  let {
    events = [],
    scopeKey = '',
    replayMode = false,
  }: Props = $props();

  const timers: ReturnType<typeof setTimeout>[] = [];
  const cardMoveDurationMs = 320;
  const cardSequenceStepMs = 35;
  const cardHandoffMs = Math.round(cardMoveDurationMs * 0.88);
  let draws = $state<DrawAnimation[]>([]);
  let seenEventIds = new Set<number>();
  let initialized = false;
  let nextAnimationId = 1;
  let reduceMotion = $state(false);
  let lastScopeKey: string | number = '';
  const hiddenTargetCounts = new WeakMap<HTMLElement, number>();

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
    const scopeChanged = initialized && currentScopeKey !== lastScopeKey;
    lastScopeKey = currentScopeKey;

    if (!initialized) {
      for (const event of currentEvents) {
        seenEventIds.add(event.id);
      }
      initialized = true;
      return;
    }

    if (replayMode && scopeChanged) {
      clearDraws();
    }

    const drawEvents = currentEvents.filter((event) => {
      if (!isDrawEvent(event)) {
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

    if (drawEvents.length) {
      startDraw(drawEvents);
    }
  });

  function isDrawEvent(event: ActionTimelineEvent): boolean {
    return event.kind === 'Draw' || event.kind === 'DrawReverse';
  }

  function startDraw(drawEvents: ActionTimelineEvent[]) {
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
      spritesForPlayer(playerIndex, playerEvents),
    );
    const sprites = playerDraws.flatMap((draw) => draw.sprites);
    const hiddenTargets = playerDraws.flatMap((draw) => draw.hiddenTargets);
    if (!sprites.length) {
      return;
    }
    hideTargets(hiddenTargets);

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
        showTargets([sprite.targetElement!]);
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

  function spritesForPlayer(playerIndex: number, playerEvents: ActionTimelineEvent[]): PlayerDrawSprites {
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
    const hiddenTargets: HTMLElement[] = [];

    const sprites = playerEvents.map((event, index) => {
      const targetElement = handSlots[firstTargetIndex + index];
      if (targetElement) {
        hiddenTargets.push(targetElement);
      }
      const targetRect = targetElement?.getBoundingClientRect() ?? fallbackHandTarget(handRect, index, playerEvents.length);
      const targetCenter = centerOf(targetRect);
      const params = event.params as Record<string, unknown> | undefined;
      const cardId = Number(params?.cardId);
      const serial = Number(params?.serial);
      const reveal = !handConcealed && event.kind === 'Draw' && Number.isFinite(cardId);
      return {
        id: `${event.id}-${Number.isFinite(serial) ? serial : index}`,
        card: reveal ? cabtCardToView(cardId) : undefined,
        reveal,
        order: index + 1,
        delayMs: index * cardSequenceStepMs,
        startX: deckRect.left,
        startY: deckRect.top,
        width: deckRect.width,
        height: deckRect.height,
        moveX: targetCenter.x - startCenter.x,
        moveY: targetCenter.y - startCenter.y,
        scale: Math.max(0.5, Math.min(1.5, targetRect.width / deckRect.width)),
        arcY: playerIndex === 0 ? -18 : 18,
        rotation: playerIndex === 0 ? -3 : 3,
        targetElement,
      };
    });
    return { sprites, hiddenTargets };
  }

  function hideTargets(targets: HTMLElement[]) {
    for (const target of targets) {
      const count = hiddenTargetCounts.get(target) ?? 0;
      hiddenTargetCounts.set(target, count + 1);
      target.dataset.drawAnimationHidden = 'true';
    }
  }

  function showTargets(targets: HTMLElement[]) {
    for (const target of targets) {
      const count = (hiddenTargetCounts.get(target) ?? 1) - 1;
      if (count > 0) {
        hiddenTargetCounts.set(target, count);
        continue;
      }
      hiddenTargetCounts.delete(target);
      delete target.dataset.drawAnimationHidden;
    }
  }

  function deckTopElement(playerIndex: number): HTMLElement | null {
    const anchor = document.querySelector(`[data-card-anchor="player:${playerIndex}:deck"]`);
    const pile = anchor?.closest('.deck-pile') as HTMLElement | null;
    return pile?.querySelector('.deck-card-face') ?? pile;
  }

  function handAnchor(playerIndex: number): HTMLElement | null {
    return document.querySelector(`[data-card-anchor="player:${playerIndex}:hand"]`);
  }

  function handCardSlots(handElement: HTMLElement, playerIndex: number): HTMLElement[] {
    return Array.from(handElement.querySelectorAll(`[data-testid^="hand-card-${playerIndex}-"]`))
      .filter((element): element is HTMLElement => element instanceof HTMLElement);
  }

  function fallbackHandTarget(handRect: DOMRect, index: number, count: number): DOMRect {
    const width = Math.min(handRect.height / 1.397, handRect.width / Math.max(1, count));
    const height = width * 1.397;
    const step = Math.min(width * 0.82, handRect.width / Math.max(1, count));
    const centerX = handRect.left + handRect.width / 2 + (index - (count - 1) / 2) * step;
    const centerY = handRect.top + handRect.height / 2;
    return {
      left: centerX - width / 2,
      top: centerY - height / 2,
      right: centerX + width / 2,
      bottom: centerY + height / 2,
      x: centerX - width / 2,
      y: centerY - height / 2,
      width,
      height,
      toJSON: () => ({}),
    } as DOMRect;
  }

  function centerOf(rect: DOMRect): { x: number; y: number } {
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    };
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
      `z-index: ${sprite.order}`,
    ].join('; ');
  }
</script>

<span class="deck-draw-animation" aria-hidden="true">
  {#each draws as draw (draw.id)}
    {#each draw.sprites as sprite (sprite.id)}
      <span class="draw-card" class:revealed={sprite.reveal} style={spriteStyle(sprite)}>
        <span class="draw-card-inner">
          <span class="draw-card-face draw-card-back"></span>
          <span class="draw-card-face draw-card-front">
            {#if sprite.card?.imageUrl}
              <img src={sprite.card.imageUrl} alt="" draggable="false" />
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
    border-radius: 5px;
    pointer-events: none;
    transform-origin: center;
    transform-style: preserve-3d;
    animation: deck-draw-travel 320ms cubic-bezier(0.2, 0.82, 0.22, 1) var(--draw-delay) both;
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
    animation: deck-draw-flip 320ms ease-in-out var(--draw-delay) both;
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
      var(--cardback-shade),
      url("/assets/cardback.png") center / cover no-repeat;
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
