<script lang="ts">
  import { onDestroy } from 'svelte';
  import { actionAnimationBatchEvents, actionAnimationStartMs, actionAnimationTiming } from '../cabt/actionAnimationSchedule';
  import { cabtCardToView } from '../cabt/cardView';
  import { CabtAreaType } from '../cabt/types';
  import type { ActionTimelineEvent, CardView } from '../game/types';

  type Props = {
    events?: ActionTimelineEvent[];
    scopeKey?: string | number;
    replayMode?: boolean;
  };

  type RevealMode = 'revealing' | 'held' | 'attaching' | 'returning';

  type RevealSprite = {
    id: string;
    card: CardView;
    serial?: number;
    order: number;
    mode: RevealMode;
    delayMs: number;
    left: number;
    top: number;
    width: number;
    height: number;
    deckMoveX: number;
    deckMoveY: number;
    deckScale: number;
    exitX: number;
    exitY: number;
    exitScale: number;
    rotation: number;
  };

  type RevealAnimation = {
    id: number;
    sprites: RevealSprite[];
  };

  let {
    events = [],
    scopeKey = '',
    replayMode = false,
  }: Props = $props();

  const timers: ReturnType<typeof setTimeout>[] = [];
  const cardHeightToWidthRatio = 88 / 63;
  let reveals = $state<RevealAnimation[]>([]);
  let seenEventIds = new Set<number>();
  let initialized = false;
  let lastScopeKey: string | number = '';
  let nextAnimationId = 1;

  onDestroy(() => {
    clearReveals();
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

    const animationEvents = actionAnimationBatchEvents(currentEvents, seenEventIds, replayMode, scopeChanged);
    const revealEvents = animationEvents.filter((event) => isDeckRevealEvent(event) && shouldAnimateEvent(event, scopeChanged));
    const attachEvents = animationEvents.filter((event) => isRevealAttachEvent(event) && shouldAnimateEvent(event, scopeChanged));
    const returnEvents = animationEvents.filter((event) => isRevealReturnEvent(event) && shouldAnimateEvent(event, scopeChanged));

    if (replayMode && scopeChanged && !revealEvents.length && !attachEvents.length && !returnEvents.length) {
      clearReveals();
    }

    for (const event of currentEvents) {
      seenEventIds.add(event.id);
    }

    if (revealEvents.length) {
      startReveal(revealEvents, animationEvents);
    }
    if (attachEvents.length) {
      attachRevealedCards(attachEvents, animationEvents);
    }
    if (returnEvents.length) {
      returnRevealedCards(returnEvents, animationEvents);
    }
  });

  function shouldAnimateEvent(event: ActionTimelineEvent, scopeChanged: boolean): boolean {
    return (replayMode && scopeChanged) || !seenEventIds.has(event.id);
  }

  function isDeckRevealEvent(event: ActionTimelineEvent): boolean {
    const params = event.params as Record<string, unknown> | undefined;
    return event.kind === 'MoveCard'
      && Number(params?.fromArea) === CabtAreaType.DECK
      && Number(params?.toArea) === CabtAreaType.LOOKING
      && Number.isFinite(Number(params?.cardId));
  }

  function isRevealAttachEvent(event: ActionTimelineEvent): boolean {
    const params = event.params as Record<string, unknown> | undefined;
    const serial = Number(params?.serial);
    return event.kind === 'Attach'
      && Number.isFinite(serial)
      && reveals.some((reveal) => reveal.sprites.some((sprite) => sprite.serial === serial));
  }

  function isRevealReturnEvent(event: ActionTimelineEvent): boolean {
    const params = event.params as Record<string, unknown> | undefined;
    return event.kind === 'MoveCard'
      && Number(params?.fromArea) === CabtAreaType.LOOKING
      && Number(params?.toArea) === CabtAreaType.DECK
      && Number.isFinite(Number(params?.serial));
  }

  function startReveal(revealEvents: ActionTimelineEvent[], animationEvents: ActionTimelineEvent[]) {
    const eventsByPlayer = new Map<number, ActionTimelineEvent[]>();
    for (const event of revealEvents) {
      if (event.playerIndex === undefined) {
        continue;
      }
      const playerEvents = eventsByPlayer.get(event.playerIndex) ?? [];
      playerEvents.push(event);
      eventsByPlayer.set(event.playerIndex, playerEvents);
    }

    const sprites = [...eventsByPlayer.entries()].flatMap(([playerIndex, playerEvents]) =>
      spritesForPlayer(playerIndex, playerEvents, animationEvents),
    );
    if (!sprites.length) {
      return;
    }

    clearReveals();
    const animation: RevealAnimation = {
      id: nextAnimationId++,
      sprites,
    };
    reveals = [animation];

    const timer = setTimeout(() => {
      updateSprites((sprite) => sprite.mode === 'revealing' ? { ...sprite, mode: 'held', delayMs: 0 } : sprite);
    }, Math.max(...sprites.map((sprite) => sprite.delayMs)) + actionAnimationTiming.deckRevealMs);
    timers.push(timer);
  }

  function attachRevealedCards(attachEvents: ActionTimelineEvent[], animationEvents: ActionTimelineEvent[]) {
    for (const event of attachEvents) {
      const params = event.params as Record<string, unknown> | undefined;
      const serial = Number(params?.serial);
      const sprite = revealSprite(serial);
      const target = boardSlotByPokemonIdentity(Number(params?.serialTarget), Number(params?.cardIdTarget), event.playerIndex);
      const targetRect = visualTargetForAnimation(target)?.getBoundingClientRect();
      if (!sprite || !targetRect || targetRect.width <= 0 || targetRect.height <= 0) {
        continue;
      }

      const sourceCenter = spriteCenter(sprite);
      const targetCenter = centerOf(targetRect);
      const delayMs = actionAnimationStartMs(animationEvents, event);
      updateSprites((item) => item.serial === serial
        ? {
            ...item,
            mode: 'attaching',
            delayMs,
            exitX: targetCenter.x - sourceCenter.x,
            exitY: targetCenter.y - sourceCenter.y,
            exitScale: Math.max(0.36, Math.min(0.86, (targetRect.width / item.width) * 0.54)),
          }
        : item);
      const timer = setTimeout(() => {
        removeSprites((item) => item.serial === serial);
      }, delayMs + actionAnimationTiming.handMoveMs + 80);
      timers.push(timer);
    }
  }

  function returnRevealedCards(returnEvents: ActionTimelineEvent[], animationEvents: ActionTimelineEvent[]) {
    const eventsByPlayer = new Map<number, ActionTimelineEvent[]>();
    for (const event of returnEvents) {
      if (event.playerIndex === undefined) {
        continue;
      }
      const playerEvents = eventsByPlayer.get(event.playerIndex) ?? [];
      playerEvents.push(event);
      eventsByPlayer.set(event.playerIndex, playerEvents);
    }

    for (const [playerIndex, playerEvents] of eventsByPlayer.entries()) {
      const deckRect = deckTopElement(playerIndex)?.getBoundingClientRect();
      if (!deckRect || deckRect.width <= 0 || deckRect.height <= 0) {
        continue;
      }
      const deckCenter = centerOf(deckRect);
      for (const event of playerEvents) {
        const params = event.params as Record<string, unknown> | undefined;
        const serial = Number(params?.serial);
        const sprite = revealSprite(serial);
        if (!sprite) {
          continue;
        }
        const sourceCenter = spriteCenter(sprite);
        const delayMs = actionAnimationStartMs(animationEvents, event);
        updateSprites((item) => item.serial === serial
          ? {
              ...item,
              mode: 'returning',
              delayMs,
              exitX: deckCenter.x - sourceCenter.x,
              exitY: deckCenter.y - sourceCenter.y,
              exitScale: Math.max(0.32, Math.min(0.9, deckRect.width / item.width)),
            }
          : item);
        const timer = setTimeout(() => {
          removeSprites((item) => item.serial === serial);
        }, delayMs + actionAnimationTiming.deckRevealReturnMs + 80);
        timers.push(timer);
      }
    }
  }

  function clearReveals() {
    for (const timer of timers) {
      clearTimeout(timer);
    }
    timers.length = 0;
    reveals = [];
  }

  function spritesForPlayer(
    playerIndex: number,
    playerEvents: ActionTimelineEvent[],
    animationEvents: ActionTimelineEvent[],
  ): RevealSprite[] {
    const deckRect = deckTopElement(playerIndex)?.getBoundingClientRect();
    if (!deckRect || deckRect.width <= 0 || deckRect.height <= 0) {
      return [];
    }

    const layout = revealLayout(playerEvents.length);
    const deckCenter = centerOf(deckRect);
    return playerEvents.map((event, index) => {
      const params = event.params as Record<string, unknown> | undefined;
      const cardId = Number(params?.cardId);
      const serial = Number(params?.serial);
      const targetCenter = layout.targetCenter(index);
      const rotation = (index - (playerEvents.length - 1) / 2) * 1.2;
      return {
        id: `${event.id}-${Number.isFinite(serial) ? serial : index}`,
        card: {
          ...cabtCardToView(cardId),
          serial: Number.isFinite(serial) ? serial : undefined,
          playerIndex,
        },
        serial: Number.isFinite(serial) ? serial : undefined,
        order: index + 1,
        mode: 'revealing',
        delayMs: actionAnimationStartMs(animationEvents, event),
        left: targetCenter.x - layout.cardWidth / 2,
        top: targetCenter.y - layout.cardHeight / 2,
        width: layout.cardWidth,
        height: layout.cardHeight,
        deckMoveX: deckCenter.x - targetCenter.x,
        deckMoveY: deckCenter.y - targetCenter.y,
        deckScale: Math.max(0.32, Math.min(0.9, deckRect.width / layout.cardWidth)),
        exitX: 0,
        exitY: 0,
        exitScale: 1,
        rotation,
      };
    });
  }

  function revealLayout(count: number) {
    const viewportWidth = typeof window === 'undefined' ? 1200 : window.innerWidth;
    const viewportHeight = typeof window === 'undefined' ? 800 : window.innerHeight;
    const boardRect = typeof document === 'undefined'
      ? undefined
      : document.querySelector('.playmat')?.getBoundingClientRect();
    const centerX = boardRect ? boardRect.left + boardRect.width / 2 : viewportWidth / 2;
    const centerY = boardRect ? boardRect.top + boardRect.height * 0.5 : viewportHeight * 0.47;
    const maxWidth = boardRect ? boardRect.width - 96 : viewportWidth - 96;
    const columns = viewportWidth < 760 ? Math.min(3, count) : Math.max(1, count);
    const gap = viewportWidth < 760 ? 8 : 12;
    const availableWidth = Math.max(280, maxWidth);
    const cardWidth = Math.min(142, Math.max(86, (availableWidth - gap * (columns - 1)) / columns));
    const cardHeight = cardWidth * cardHeightToWidthRatio;
    const rows = Math.ceil(count / columns);
    const gridWidth = columns * cardWidth + (columns - 1) * gap;
    const gridHeight = rows * cardHeight + (rows - 1) * gap;
    const originX = centerX - gridWidth / 2;
    const originY = centerY - gridHeight / 2;

    return {
      cardWidth,
      cardHeight,
      targetCenter(index: number) {
        const row = Math.floor(index / columns);
        const column = index % columns;
        return {
          x: originX + column * (cardWidth + gap) + cardWidth / 2,
          y: originY + row * (cardHeight + gap) + cardHeight / 2,
        };
      },
    };
  }

  function updateSprites(update: (sprite: RevealSprite) => RevealSprite) {
    reveals = reveals.map((reveal) => ({
      ...reveal,
      sprites: reveal.sprites.map(update),
    }));
  }

  function removeSprites(predicate: (sprite: RevealSprite) => boolean) {
    reveals = reveals
      .map((reveal) => ({
        ...reveal,
        sprites: reveal.sprites.filter((sprite) => !predicate(sprite)),
      }))
      .filter((reveal) => reveal.sprites.length > 0);
  }

  function revealSprite(serial: number): RevealSprite | undefined {
    if (!Number.isFinite(serial)) {
      return undefined;
    }
    return reveals.flatMap((reveal) => reveal.sprites).find((sprite) => sprite.serial === serial);
  }

  function deckTopElement(playerIndex: number): HTMLElement | null {
    const anchor = document.querySelector(`[data-card-anchor="player:${playerIndex}:deck"]`);
    const pile = anchor?.closest('.deck-pile') as HTMLElement | null;
    return pile?.querySelector('.deck-card-face') ?? pile;
  }

  function boardSlotByPokemonIdentity(serial: number, cardId: number, playerIndex: number | undefined): HTMLElement | null {
    if (Number.isFinite(serial)) {
      const bySerial = document.querySelector(`[data-pokemon-serial="${serial}"]`);
      if (bySerial instanceof HTMLElement) {
        return bySerial;
      }
    }
    if (playerIndex !== undefined && Number.isFinite(cardId)) {
      const byId = document.querySelector(`[data-owner-index="${playerIndex}"][data-pokemon-card-id="${cardId}"]`);
      if (byId instanceof HTMLElement) {
        return byId;
      }
    }
    return null;
  }

  function visualTargetForAnimation(target: HTMLElement | null): HTMLElement | null {
    if (!target) {
      return null;
    }
    const cardTile = target.querySelector('.card-tile');
    return cardTile instanceof HTMLElement ? cardTile : target;
  }

  function spriteCenter(sprite: RevealSprite): { x: number; y: number } {
    return {
      x: sprite.left + sprite.width / 2,
      y: sprite.top + sprite.height / 2,
    };
  }

  function centerOf(rect: DOMRect): { x: number; y: number } {
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    };
  }

  function spriteStyle(sprite: RevealSprite): string {
    return [
      `left: ${sprite.left}px`,
      `top: ${sprite.top}px`,
      `width: ${sprite.width}px`,
      `height: ${sprite.height}px`,
      `--deck-x: ${sprite.deckMoveX.toFixed(1)}px`,
      `--deck-y: ${sprite.deckMoveY.toFixed(1)}px`,
      `--deck-scale: ${sprite.deckScale.toFixed(3)}`,
      `--exit-x: ${sprite.exitX.toFixed(1)}px`,
      `--exit-y: ${sprite.exitY.toFixed(1)}px`,
      `--exit-scale: ${sprite.exitScale.toFixed(3)}`,
      `--reveal-delay: ${sprite.delayMs}ms`,
      `--reveal-rotation: ${sprite.rotation.toFixed(1)}deg`,
      `z-index: ${sprite.order}`,
    ].join('; ');
  }
</script>

{#if reveals.length}
  <span class="deck-reveal-scrim" aria-hidden="true"></span>
{/if}

<span class="deck-reveal-animation" aria-hidden="true">
  {#each reveals as reveal (reveal.id)}
    {#each reveal.sprites as sprite (sprite.id)}
      <span class={`reveal-card ${sprite.mode}`} style={spriteStyle(sprite)}>
        <span class="reveal-card-inner">
          <span class="reveal-card-face reveal-card-back"></span>
          <span class="reveal-card-face reveal-card-front">
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
  .deck-reveal-scrim {
    position: fixed;
    inset: 0;
    z-index: 39;
    pointer-events: none;
    background: rgba(246, 248, 251, 0.32);
    backdrop-filter: blur(1.5px);
  }

  .deck-reveal-animation {
    position: fixed;
    inset: 0;
    z-index: 40;
    overflow: visible;
    pointer-events: none;
    perspective: 1200px;
    transform-style: preserve-3d;
  }

  .reveal-card {
    position: absolute;
    display: block;
    border-radius: 7px;
    transform-origin: center;
    transform-style: preserve-3d;
    will-change: transform, opacity;
  }

  .reveal-card.revealing {
    animation: deck-reveal-travel 1180ms cubic-bezier(0.18, 0.86, 0.24, 1) var(--reveal-delay) both;
  }

  .reveal-card.attaching {
    animation: deck-reveal-attach 360ms cubic-bezier(0.2, 0.82, 0.22, 1) var(--reveal-delay) both;
  }

  .reveal-card.returning {
    animation: deck-reveal-return 420ms cubic-bezier(0.34, 0.02, 0.24, 1) var(--reveal-delay) both;
  }

  .reveal-card-inner {
    position: absolute;
    inset: 0;
    display: block;
    border-radius: inherit;
    transform-style: preserve-3d;
    transform: rotateY(180deg);
    will-change: transform;
  }

  .reveal-card.revealing .reveal-card-inner {
    animation: deck-reveal-flip 420ms ease-in-out var(--reveal-delay) both;
  }

  .reveal-card.returning .reveal-card-inner {
    animation: deck-reveal-return-flip 320ms ease-in-out var(--reveal-delay) both;
  }

  .reveal-card-face {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    overflow: hidden;
    border-radius: inherit;
    box-shadow:
      0 18px 38px rgba(23, 30, 38, 0.26),
      0 0 0 1px rgba(18, 21, 26, 0.18);
    backface-visibility: hidden;
  }

  .reveal-card-back {
    background:
      var(--cardback-shade),
      url("/assets/cardback.png") center / cover no-repeat;
  }

  .reveal-card-front {
    transform: rotateY(180deg);
    background: #f7f8fa;
  }

  .reveal-card-front img {
    width: 100%;
    height: 100%;
    display: block;
    object-fit: fill;
    pointer-events: none;
  }

  .fallback-name {
    padding: 0 9px;
    color: #1f2933;
    font-size: 13px;
    font-weight: 900;
    line-height: 1.1;
    text-align: center;
  }

  @keyframes deck-reveal-travel {
    0% {
      opacity: 0;
      transform:
        translate3d(var(--deck-x), var(--deck-y), 0)
        scale(var(--deck-scale))
        rotate(0deg);
    }
    2% {
      opacity: 1;
      transform:
        translate3d(var(--deck-x), var(--deck-y), 0)
        scale(var(--deck-scale))
        rotate(0deg);
    }
    72%,
    100% {
      opacity: 1;
      transform: translate3d(0, 0, 0) scale(1) rotate(var(--reveal-rotation));
    }
  }

  @keyframes deck-reveal-attach {
    0% {
      opacity: 1;
      transform: translate3d(0, 0, 0) scale(1) rotate(var(--reveal-rotation));
    }
    88% {
      opacity: 1;
      transform: translate3d(var(--exit-x), var(--exit-y), 0) scale(var(--exit-scale)) rotate(0deg);
    }
    100% {
      opacity: 0;
      transform: translate3d(var(--exit-x), var(--exit-y), 0) scale(var(--exit-scale)) rotate(0deg);
    }
  }

  @keyframes deck-reveal-return {
    0% {
      opacity: 1;
      transform: translate3d(0, 0, 0) scale(1) rotate(var(--reveal-rotation));
    }
    88% {
      opacity: 1;
      transform: translate3d(var(--exit-x), var(--exit-y), 0) scale(var(--exit-scale)) rotate(0deg);
    }
    100% {
      opacity: 0;
      transform: translate3d(var(--exit-x), var(--exit-y), 0) scale(var(--exit-scale)) rotate(0deg);
    }
  }

  @keyframes deck-reveal-flip {
    0% {
      transform: rotateY(0deg);
    }
    100% {
      transform: rotateY(180deg);
    }
  }

  @keyframes deck-reveal-return-flip {
    0% {
      transform: rotateY(180deg);
    }
    100% {
      transform: rotateY(0deg);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .reveal-card.revealing,
    .reveal-card.attaching,
    .reveal-card.returning,
    .reveal-card.revealing .reveal-card-inner,
    .reveal-card.returning .reveal-card-inner {
      animation-duration: 1ms;
    }
  }
</style>
