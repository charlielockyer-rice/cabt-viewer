<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import CardTile from './CardTile.svelte';
  import { cardBackCssVar } from '../game/cardAssets';
  import { cardIdentityKey } from '../game/cardIdentity';
  import { AnimAttr, attr, cardAnchorValue } from '../anim/domContract';
  import type { CardView, PlayerView } from '../game/types';

  type Props = {
    topPlayer: PlayerView;
    bottomPlayer: PlayerView;
    boardTilt?: number;
    projectedHoverPile?: string;
    topLostPileElement?: HTMLButtonElement;
    topDiscardPileElement?: HTMLButtonElement;
    bottomLostPileElement?: HTMLButtonElement;
    bottomDiscardPileElement?: HTMLButtonElement;
    showLostZone: (player: PlayerView) => void;
    showDiscard: (player: PlayerView) => void;
  };

  let {
    topPlayer,
    bottomPlayer,
    boardTilt = 8,
    projectedHoverPile = '',
    topLostPileElement = $bindable(),
    topDiscardPileElement = $bindable(),
    bottomLostPileElement = $bindable(),
    bottomDiscardPileElement = $bindable(),
    showLostZone,
    showDiscard,
  }: Props = $props();

  // Pile blocks are keyed by player.index and rendered in a stable order, so
  // the follow-active seat flip only flips each block's top/bottom class (a CSS
  // reposition) instead of swapping which player each block renders — the pile
  // cards keep their DOM nodes through the flip (M2). The animation anchors are
  // already player-index based, so nothing downstream changes.
  let orderedPlayers = $derived([topPlayer, bottomPlayer].slice().sort((a, b) => a.index - b.index));

  // The pile elements GameBoard hit-tests for the projected-pile hover are held
  // by player.index here and mapped back onto its top/bottom bindables, so the
  // stable DOM blocks stay decoupled from their current screen position.
  let lostPileElements = $state<Record<number, HTMLButtonElement | undefined>>({});
  let discardPileElements = $state<Record<number, HTMLButtonElement | undefined>>({});
  $effect(() => {
    topLostPileElement = lostPileElements[topPlayer.index];
    topDiscardPileElement = discardPileElements[topPlayer.index];
    bottomLostPileElement = lostPileElements[bottomPlayer.index];
    bottomDiscardPileElement = discardPileElements[bottomPlayer.index];
  });

  let resolvingDiscardAnimations = $state<ResolvingDiscardAnimation[]>([]);
  let previousResolvingCards = new Map<number, ResolvingCardSnapshot>();
  let nextResolvingDiscardAnimationId = 0;
  const resolvingDiscardTimers: ReturnType<typeof setTimeout>[] = [];

  type ResolvingCardSnapshot = {
    playerIndex: number;
    card: CardView;
    left: number;
    top: number;
    width: number;
    height: number;
    opponent: boolean;
  };

  type ResolvingDiscardAnimation = ResolvingCardSnapshot & {
    id: number;
    moveX: number;
    moveY: number;
    scale: number;
  };

  onDestroy(() => {
    for (const timer of resolvingDiscardTimers) {
      clearTimeout(timer);
    }
  });

  $effect(() => {
    syncOrSnapshotResolvingCard(() => topPlayer, true);
    syncOrSnapshotResolvingCard(() => bottomPlayer, false);
  });

  function deckPileStyle(deckCount: number, direction: -1 | 1) {
    const layers = visibleDeckLayers(deckCount).length;
    const step = Math.max(0.8, Math.min(1.6, boardTilt * 0.16));
    return [
      `--deck-step-x: ${(direction * step).toFixed(2)}px`,
      `--deck-step-y: ${(-step).toFixed(2)}px`,
      `--deck-top-x: ${(direction * layers * step).toFixed(2)}px`,
      `--deck-top-y: ${(-layers * step).toFixed(2)}px`,
    ].join('; ');
  }

  function visibleDeckLayers(deckCount: number) {
    const count = deckCount <= 0 ? 0 : Math.min(8, Math.max(1, Math.ceil(deckCount / 8)));
    return Array.from({ length: count }, (_, index) => count - index);
  }

  function visiblePrizeCards(prizesLeft: number) {
    const count = Math.min(6, Math.max(0, Math.round(prizesLeft)));
    return Array.from({ length: count }, (_, index) => index);
  }

  // Keyed by the CARD, never the layer: when a new top lands, the covered
  // card keeps its DOM node (and its loaded <img>) and only changes class —
  // a remount would blank the pile while the image refetches.
  function visibleDiscardCards(discard: CardView[]) {
    return discard.slice(-2).map((card, index, cards) => ({
      card,
      key: cardIdentityKey(card),
      layer: index === cards.length - 1 ? 'top' : 'under',
    }));
  }

  function resolvingCard(player: PlayerView): CardView | undefined {
    return player.playZone.at(-1);
  }

  function resolvingStateKey(player: PlayerView): string {
    const card = resolvingCard(player);
    const discardTop = player.discard.at(-1);
    return [
      player.index,
      cardIdentityKey(card),
      cardIdentityKey(discardTop),
      player.discard.length,
    ].join(':');
  }

  function syncOrSnapshotResolvingCard(playerForSnapshot: () => PlayerView, opponent: boolean) {
    const player = playerForSnapshot();
    if (!resolvingCard(player)) {
      syncResolvingDiscardAnimation(player, opponent);
      return;
    }

    const snapshotKey = resolvingStateKey(player);
    void tick().then(() => {
      const currentPlayer = playerForSnapshot();
      if (snapshotKey === resolvingStateKey(currentPlayer)) {
        syncResolvingDiscardAnimation(currentPlayer, opponent);
      }
    });
  }

  function syncResolvingDiscardAnimation(player: PlayerView, opponent: boolean) {
    const current = resolvingCard(player);
    if (current) {
      const snapshot = resolvingSnapshotFor(player.index, current, opponent);
      if (snapshot) {
        previousResolvingCards.set(player.index, snapshot);
      }
      return;
    }

    const previous = previousResolvingCards.get(player.index);
    if (!previous) {
      return;
    }
    previousResolvingCards.delete(player.index);
    if (!player.discard.some((card) => sameKnownCard(card, previous.card))) {
      return;
    }
    startResolvingDiscardAnimation(previous);
  }

  function resolvingSnapshotFor(playerIndex: number, card: CardView, opponent: boolean): ResolvingCardSnapshot | undefined {
    const zone = document.querySelector(`${attr(AnimAttr.cardAnchor, cardAnchorValue.playZone(playerIndex))} .card-tile`);
    const box = elementBoxInBoardPlane(zone);
    if (!box) {
      return undefined;
    }
    return {
      playerIndex,
      card,
      opponent,
      ...box,
    };
  }

  function startResolvingDiscardAnimation(snapshot: ResolvingCardSnapshot) {
    const target = discardCardElement(snapshot.playerIndex, snapshot.card)
      ?? document.querySelector(attr(AnimAttr.cardAnchor, cardAnchorValue.discard(snapshot.playerIndex)));
    const targetBox = elementBoxInBoardPlane(target);
    if (!targetBox) {
      return;
    }
    const animation: ResolvingDiscardAnimation = {
      ...snapshot,
      id: nextResolvingDiscardAnimationId++,
      moveX: targetBox.left + targetBox.width / 2 - snapshot.left - snapshot.width / 2,
      moveY: targetBox.top + targetBox.height / 2 - snapshot.top - snapshot.height / 2,
      scale: Math.max(0.45, Math.min(1.1, targetBox.width / snapshot.width)),
    };
    resolvingDiscardAnimations = [...resolvingDiscardAnimations, animation];
    const timer = setTimeout(() => {
      resolvingDiscardAnimations = resolvingDiscardAnimations.filter((item) => item.id !== animation.id);
    }, 420);
    resolvingDiscardTimers.push(timer);
  }

  function discardCardElement(playerIndex: number, card: CardView): Element | null {
    if (card.serial !== undefined) {
      return document.querySelector(`${attr(AnimAttr.cardAnchor, cardAnchorValue.discard(playerIndex))} ${attr(AnimAttr.cardSerial, card.serial)}`);
    }
    if (card.id !== undefined) {
      return document.querySelector(`${attr(AnimAttr.cardAnchor, cardAnchorValue.discard(playerIndex))} ${attr(AnimAttr.cardId, card.id)}`);
    }
    return null;
  }

  function elementBoxInBoardPlane(element: Element | null): { left: number; top: number; width: number; height: number } | undefined {
    if (!(element instanceof HTMLElement)) {
      return undefined;
    }
    const plane = element.closest('.game-board-plane');
    if (!(plane instanceof HTMLElement)) {
      return undefined;
    }
    if (element.offsetWidth <= 0 || element.offsetHeight <= 0) {
      return undefined;
    }
    let left = 0;
    let top = 0;
    let current: HTMLElement | null = element;
    while (current && current !== plane) {
      left += current.offsetLeft;
      top += current.offsetTop;
      current = current.offsetParent as HTMLElement | null;
    }
    if (current !== plane) {
      const planeRect = plane.getBoundingClientRect();
      const rect = element.getBoundingClientRect();
      left = rect.left - planeRect.left;
      top = rect.top - planeRect.top;
    }
    return {
      left,
      top,
      width: element.offsetWidth,
      height: element.offsetHeight,
    };
  }

  function resolvingDiscardAnimationStyle(animation: ResolvingDiscardAnimation): string {
    return [
      `left: ${animation.left.toFixed(1)}px`,
      `top: ${animation.top.toFixed(1)}px`,
      `width: ${animation.width.toFixed(1)}px`,
      `height: ${animation.height.toFixed(1)}px`,
      `--resolving-discard-x: ${animation.moveX.toFixed(1)}px`,
      `--resolving-discard-y: ${animation.moveY.toFixed(1)}px`,
      `--resolving-discard-scale: ${animation.scale.toFixed(3)}`,
    ].join('; ');
  }

  function isResolvingDiscardTarget(playerIndex: number, card: CardView): boolean {
    return resolvingDiscardAnimations.some((animation) =>
      animation.playerIndex === playerIndex && sameKnownCard(animation.card, card));
  }

  function sameKnownCard(left: CardView, right: CardView): boolean {
    if (left.serial !== undefined && right.serial !== undefined) {
      return left.serial === right.serial;
    }
    return left.id === right.id && left.name === right.name;
  }
</script>

<div class="center-stack">
  {#each orderedPlayers as player (player.index)}
    {@const isTop = player.index !== bottomPlayer.index}
    {@const position = isTop ? 'top' : 'bottom'}
    <div class="field-piles" class:top-piles={isTop} class:bottom-piles={!isTop}>
      <div class="left-piles">
        <button
          type="button"
          class="stack-pile lost-pile"
          class:projected-hover={projectedHoverPile === `${position}-lost`}
          title={`${player.name} lost zone`}
          bind:this={lostPileElements[player.index]}
          onclick={() => showLostZone(player)}
        >
          {#if player.lostZone.length}
            <CardTile card={player.lostZone[player.lostZone.length - 1]} compact />
          {/if}
          <span class="pile-count">{player.lostZone.length}</span>
        </button>
        <div class="prize-grid" title={`${player.name} prizes`} aria-label={`${player.name} prizes`}>
          {#each visiblePrizeCards(player.prizesLeft) as index}
            <span
              data-card-anchor={`player:${player.index}:prize:${index}`}
              style={`--row: ${Math.floor(index / 2)}; --col: ${index % 2}; ${cardBackCssVar()}`}
            ></span>
          {/each}
        </div>
      </div>
      <div class="right-field">
        {#if !isTop && resolvingCard(player)}
          <span
            class="resolving-zone"
            data-card-anchor={`player:${player.index}:playZone`}
            title={`${player.name} played card`}
          >
            <CardTile card={resolvingCard(player)} compact />
          </span>
        {/if}
        <div class="right-piles">
          <span
            class="stack-pile deck-pile"
            style={`${deckPileStyle(player.deckCount, isTop ? -1 : 1)}; ${cardBackCssVar()}`}
            title={`${player.name} deck`}
          >
            <span class="card-anchor" data-card-anchor={`player:${player.index}:deck`}></span>
            {#each visibleDeckLayers(player.deckCount) as layer, layerIndex}
              <span class="deck-card-layer" style={`--deck-layer: ${layerIndex};`}></span>
            {/each}
            {#if player.deckCount > 0}
              <span class="deck-card-face"></span>
            {/if}
            <span class="pile-count">{player.deckCount}</span>
          </span>
          <button
            type="button"
            class="stack-pile discard-pile"
            class:projected-hover={projectedHoverPile === `${position}-discard`}
            data-card-anchor={`player:${player.index}:discard`}
            title={`${player.name} discard`}
            bind:this={discardPileElements[player.index]}
            onclick={() => showDiscard(player)}
          >
            {#if player.discard.length}
              <span class="discard-card-stack">
                {#each visibleDiscardCards(player.discard) as entry (entry.key)}
                  <span
                    class:discard-card-under={entry.layer === 'under'}
                    class:discard-card-top={entry.layer === 'top'}
                    class:resolving-discard-target={entry.layer === 'top' && isResolvingDiscardTarget(player.index, entry.card)}
                  >
                    <CardTile card={entry.card} compact />
                  </span>
                {/each}
              </span>
            {/if}
            <span class="pile-count">{player.discard.length}</span>
          </button>
        </div>
        {#if isTop && resolvingCard(player)}
          <span
            class="resolving-zone"
            data-card-anchor={`player:${player.index}:playZone`}
            title={`${player.name} played card`}
          >
            <CardTile card={resolvingCard(player)} compact />
          </span>
        {/if}
      </div>
    </div>
  {/each}

  {#if resolvingDiscardAnimations.length}
    <span class="resolving-discard-layer" aria-hidden="true">
      {#each resolvingDiscardAnimations as animation (animation.id)}
        <span
          class="resolving-discard-card"
          class:opponent={animation.opponent}
          style={resolvingDiscardAnimationStyle(animation)}
        >
          <CardTile card={animation.card} compact />
        </span>
      {/each}
    </span>
  {/if}
</div>

<style>
  .center-stack {
    z-index: 2;
    display: contents;
    color: var(--text-primary);
    font-size: 12px;
    opacity: 0.96;
    pointer-events: none;
  }

  :global(.debug-zones) .center-stack {
    color: var(--text-primary);
  }

  .field-piles {
    display: contents;
    pointer-events: none;
  }

  :global(.debug-zones) .field-piles {
    outline: 2px dashed rgba(168, 85, 247, 0.84);
    outline-offset: 3px;
    background: rgba(168, 85, 247, 0.06);
  }

  .top-piles {
    align-items: start;
  }

  .bottom-piles {
    align-items: end;
  }

  .left-piles,
  .right-piles {
    display: grid;
    gap: calc(var(--card-w) * 0.12);
    pointer-events: none;
  }

  .right-piles {
    position: relative;
  }

  :global(.debug-zones) .left-piles,
  :global(.debug-zones) .right-piles,
  :global(.debug-zones) .right-field {
    outline: 2px solid rgba(234, 88, 12, 0.78);
    outline-offset: 3px;
    background: rgba(234, 88, 12, 0.06);
  }

  .top-piles .left-piles {
    grid-area: top-right;
    align-self: var(--board-top-row-align, start);
    justify-self: end;
    display: flex;
    flex-direction: column-reverse;
    align-items: center;
  }

  .top-piles .right-piles {
    display: flex;
    flex-direction: column-reverse;
    align-items: center;
  }

  .top-piles .right-field {
    grid-area: top-left;
    align-self: var(--board-top-row-align, start);
    justify-self: start;
  }

  .bottom-piles .left-piles {
    grid-area: bottom-left;
    align-self: var(--board-bottom-row-align, end);
    justify-self: start;
    justify-items: center;
  }

  .bottom-piles .right-field {
    grid-area: bottom-right;
    align-self: var(--board-bottom-row-align, end);
    justify-self: end;
  }

  .right-field {
    display: grid;
    gap: calc(var(--card-w) * 0.62);
    align-items: center;
    pointer-events: none;
  }

  .top-piles .right-field {
    grid-auto-flow: column;
    align-items: end;
  }

  .bottom-piles .right-field {
    grid-auto-flow: column;
    align-items: start;
  }

  .resolving-zone {
    position: relative;
    width: var(--pile-w);
    aspect-ratio: 63 / 88;
    display: grid;
    place-items: center;
    justify-self: center;
    border-radius: 6px;
    pointer-events: none;
  }

  .top-piles .resolving-zone {
    align-self: end;
  }

  .bottom-piles .resolving-zone {
    align-self: start;
  }

  .resolving-zone :global(.card-tile) {
    width: 100%;
    height: 100%;
  }

  .resolving-discard-layer {
    position: absolute;
    inset: 0;
    z-index: 8;
    pointer-events: none;
    transform-style: preserve-3d;
  }

  .resolving-discard-card {
    position: absolute;
    display: block;
    transform-origin: center;
    animation: resolving-card-to-discard 380ms cubic-bezier(0.24, 0.78, 0.24, 1) both;
    will-change: transform, opacity;
  }

  .resolving-discard-card :global(.card-tile) {
    width: 100%;
    height: 100%;
  }

  .resolving-discard-card.opponent :global(.card-tile) {
    transform: rotate(180deg);
  }

  .resolving-discard-target {
    visibility: hidden;
  }

  .left-piles {
    justify-items: center;
  }

  .right-piles {
    justify-items: center;
  }

  .stack-pile {
    position: relative;
    width: var(--pile-w);
    aspect-ratio: 63 / 88;
    height: auto;
    display: grid;
    place-items: center;
    padding: 0;
    border-radius: 5px;
    color: var(--pile-text);
    font-weight: 800;
    background: var(--pile-bg);
    border: 1px solid var(--pile-border);
    box-shadow: 0 4px 10px rgba(23, 30, 38, 0.14);
    font-size: calc(var(--pile-w) * 0.25);
  }

  :global(.debug-zones) .stack-pile {
    outline: 2px solid rgba(220, 38, 38, 0.72);
    outline-offset: 3px;
  }

  .stack-pile.projected-hover {
    border-color: rgba(55, 150, 132, 0.85);
  }

  button.stack-pile {
    pointer-events: none;
  }

  .deck-pile {
    --deck-step-x: 1.35px;
    --deck-step-y: -1.35px;
    --deck-top-x: 0px;
    --deck-top-y: 0px;
    z-index: 1;
    isolation: isolate;
    color: #f7f8ff;
    background: transparent;
    border-color: transparent;
    box-shadow: none;
    overflow: visible;
    transform-style: preserve-3d;
  }

  .deck-card-face,
  .deck-card-layer,
  .card-anchor {
    position: absolute;
    display: block;
    pointer-events: none;
  }

  .card-anchor {
    inset: 0;
    z-index: -1;
  }

  .deck-card-face,
  .deck-card-layer {
    inset: 0;
    border-radius: inherit;
    background:
      var(--card-back-image, var(--cardback-shade)),
      linear-gradient(135deg, rgba(255, 255, 255, 0.1), transparent 28%),
      repeating-linear-gradient(45deg, rgba(255, 255, 255, 0.08) 0 6px, transparent 6px 12px),
      linear-gradient(145deg, #203654, #111a2c);
    background-size: cover, auto, auto, auto;
    background-position: center;
  }

  .deck-card-face {
    z-index: 12;
    transform: translate(var(--deck-top-x), var(--deck-top-y));
    box-shadow:
      0 3px 8px rgba(23, 30, 38, 0.12),
      0 0 0 1px rgba(18, 21, 26, 0.2);
  }

  .deck-card-layer {
    z-index: var(--deck-layer);
    opacity: calc(0.5 + (var(--deck-layer) * 0.08));
    filter: brightness(0.86) saturate(0.9);
    transform: translate(
      calc(var(--deck-step-x) * var(--deck-layer)),
      calc(var(--deck-step-y) * var(--deck-layer))
    );
    box-shadow: none;
  }

  .top-piles .discard-pile :global(.card-tile),
  .top-piles .resolving-zone :global(.card-tile),
  .top-piles .prize-grid {
    transform: rotate(180deg);
  }

  @keyframes resolving-card-to-discard {
    0% {
      opacity: 1;
      transform: translate3d(0, 0, 0) scale(1);
    }
    72% {
      opacity: 1;
      transform:
        translate3d(calc(var(--resolving-discard-x) * 0.88), calc(var(--resolving-discard-y) * 0.88), 0)
        scale(calc(1 + ((var(--resolving-discard-scale) - 1) * 0.72)));
    }
    100% {
      opacity: 0.98;
      transform:
        translate3d(var(--resolving-discard-x), var(--resolving-discard-y), 0)
        scale(var(--resolving-discard-scale));
    }
  }

  .top-piles .deck-card-face {
    transform: translate(var(--deck-top-x), var(--deck-top-y)) rotate(180deg);
  }

  .top-piles .deck-card-layer {
    transform: translate(
      calc(var(--deck-step-x) * var(--deck-layer)),
      calc(var(--deck-step-y) * var(--deck-layer))
    ) rotate(180deg);
  }

  .discard-pile {
    color: var(--discard-text);
    background: var(--discard-bg);
    overflow: visible;
  }

  .discard-card-stack,
  .discard-card-stack > span {
    position: absolute;
    inset: 0;
    display: block;
    pointer-events: none;
  }

  .discard-card-under {
    z-index: 1;
  }

  .discard-card-top {
    z-index: 2;
  }

  .discard-pile :global(.card-tile) {
    width: 100%;
    height: 100%;
  }

  .pile-count {
    position: absolute;
    left: 50%;
    top: 50%;
    z-index: 35;
    min-width: 24px;
    min-height: 24px;
    display: grid;
    place-items: center;
    transform: translate(-50%, -50%);
    padding: 2px 6px;
    border-radius: 999px;
    background: var(--pile-count-bg);
    border: 1px solid var(--pile-count-border);
    color: var(--pile-count-text);
    box-shadow: 0 3px 10px rgba(23, 30, 38, 0.16);
    font-size: calc(var(--pile-w) * 0.18);
    font-weight: 850;
    transition: transform 160ms ease;
  }

  .deck-pile .pile-count {
    right: auto;
    bottom: auto;
    z-index: 13;
    transform: translate(calc(-50% + var(--deck-top-x)), calc(-50% + var(--deck-top-y)));
  }

  .lost-pile {
    width: calc(var(--prize-card-w) * 1.397);
    aspect-ratio: 88 / 63;
    margin-block: calc(var(--card-w) * 0.08);
    color: var(--lost-text);
    background: var(--lost-bg);
    border-color: var(--lost-border);
    box-shadow: none;
    font-size: calc(var(--card-w) * 0.17);
    overflow: visible;
  }

  .lost-pile :global(.card-tile) {
    width: var(--prize-card-w);
    height: calc(var(--prize-card-w) * 1.397);
    transform: rotate(-90deg);
  }

  .prize-grid {
    position: relative;
    width: calc(var(--prize-card-w) * 1.98);
    height: calc((var(--prize-card-w) * 1.397) + (var(--prize-card-w) * 1.42));
    pointer-events: none;
  }

  :global(.debug-zones) .prize-grid {
    outline: 2px solid rgba(250, 204, 21, 0.9);
    outline-offset: 4px;
    background: rgba(250, 204, 21, 0.08);
  }

  .prize-grid span {
    position: absolute;
    left: calc(var(--col) * var(--prize-card-w) * 0.98);
    top: calc(var(--row) * var(--prize-card-w) * 0.71);
    width: var(--prize-card-w);
    aspect-ratio: 63 / 88;
    border-radius: 4px;
    border: 1px solid var(--prize-border);
    background:
      var(--card-back-image, var(--cardback-shade)),
      linear-gradient(135deg, rgba(255, 255, 255, 0.1), transparent 28%),
      repeating-linear-gradient(45deg, rgba(255, 255, 255, 0.08) 0 6px, transparent 6px 12px),
      linear-gradient(145deg, #203654, #111a2c);
    background-size: cover, auto, auto, auto;
    background-position: center;
    box-shadow: 0 3px 8px rgba(23, 30, 38, 0.16);
  }

</style>
