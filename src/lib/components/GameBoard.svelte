<script lang="ts">
  import ActiveDuel from './ActiveDuel.svelte';
  import BenchZone from './BenchZone.svelte';
  import BoardMoveAnimation from './BoardMoveAnimation.svelte';
  import CenterPiles from './CenterPiles.svelte';
  import DeckPrizeAnimation from './DeckPrizeAnimation.svelte';
  import type { ReplayAnimationPhasePlan } from '../animations/replayAnimationPlan';
  import type { ActionTimelineEvent, PlayerView, PokemonSlotView } from '../game/types';

  type ZoneName = 'discard' | 'lostZone' | 'stadium' | 'playZone';

  type Props = {
    topPlayer: PlayerView;
    bottomPlayer: PlayerView;
    topBenchSlots?: PokemonSlotView[];
    bottomBenchSlots?: PokemonSlotView[];
    topActiveSlot: PokemonSlotView;
    bottomActiveSlot: PokemonSlotView;
    canPlayToBenchArea: (player: PlayerView) => boolean;
    canPlaceSetupBench: (player: PlayerView) => boolean;
    playToBenchArea: (player: PlayerView) => void;
    placeSetupBench: () => void;
    allowBenchDrop: (event: DragEvent, player: PlayerView) => void;
    dropToBenchArea: (player: PlayerView, event: DragEvent) => void;
    isPlayableTarget: (slot: PokemonSlotView) => boolean;
    isBoardPromptSelectable: (slot: PokemonSlotView) => boolean;
    isBoardPromptSelected: (slot: PokemonSlotView) => boolean;
    boardSlotDelta: (slot: PokemonSlotView) => number;
    clickSlot: (slot: PokemonSlotView) => void;
    allowDrop: (event: DragEvent, slot: PokemonSlotView) => void;
    dropToSlot: (slot: PokemonSlotView, event: DragEvent) => void;
    canPlaceSetupActive: (slot: PokemonSlotView) => boolean;
    placeSetupActive: () => void;
    showZone: (playerIndex: number, zone: ZoneName, title: string, faceDown?: boolean) => void;
    canPlayOnBoard?: boolean;
    clickBoardPlay: (event: MouseEvent) => void;
    allowBoardPlayDrop: (event: DragEvent) => void;
    dropToBoardPlay: (event: DragEvent) => void;
    boardTilt?: number;
    boardPerspective?: number;
    boardScaleY?: number;
    boardLift?: number;
    animationEvents?: ActionTimelineEvent[];
    animationScopeKey?: string | number;
    animationPlan?: ReplayAnimationPhasePlan;
    evolutionChromeEvents?: ActionTimelineEvent[];
    replayMode?: boolean;
  };

  let {
    topPlayer,
    bottomPlayer,
    topBenchSlots = [],
    bottomBenchSlots = [],
    topActiveSlot,
    bottomActiveSlot,
    canPlayToBenchArea,
    canPlaceSetupBench,
    playToBenchArea,
    placeSetupBench,
    allowBenchDrop,
    dropToBenchArea,
    isPlayableTarget,
    isBoardPromptSelectable,
    isBoardPromptSelected,
    boardSlotDelta,
    clickSlot,
    allowDrop,
    dropToSlot,
    canPlaceSetupActive,
    placeSetupActive,
    showZone,
    canPlayOnBoard = false,
    clickBoardPlay,
    allowBoardPlayDrop,
    dropToBoardPlay,
    boardTilt = 8,
    boardPerspective = 1250,
    boardScaleY = 98,
    boardLift = 0,
    animationEvents = [],
    animationScopeKey = '',
    animationPlan,
    evolutionChromeEvents = [],
    replayMode = false,
  }: Props = $props();

  let topLostPileElement = $state<HTMLButtonElement>();
  let topDiscardPileElement = $state<HTMLButtonElement>();
  let bottomLostPileElement = $state<HTMLButtonElement>();
  let bottomDiscardPileElement = $state<HTMLButtonElement>();
  let projectedHoverPile = $state('');

  type ProjectedPileKey = 'top-lost' | 'top-discard' | 'bottom-lost' | 'bottom-discard';

  function projectedPiles(): Array<[ProjectedPileKey, HTMLButtonElement | undefined, () => void]> {
    return [
      ['top-lost', topLostPileElement, () => showZone(topPlayer.index, 'lostZone', `${topPlayer.name} lost zone`)],
      ['top-discard', topDiscardPileElement, () => showZone(topPlayer.index, 'discard', `${topPlayer.name} discard`)],
      ['bottom-lost', bottomLostPileElement, () => showZone(bottomPlayer.index, 'lostZone', `${bottomPlayer.name} lost zone`)],
      ['bottom-discard', bottomDiscardPileElement, () => showZone(bottomPlayer.index, 'discard', `${bottomPlayer.name} discard`)],
    ];
  }

  function containsPoint(element: HTMLElement | undefined, event: MouseEvent) {
    if (!element) {
      return false;
    }
    const rect = element.getBoundingClientRect();
    return (
      event.clientX >= rect.left &&
      event.clientX <= rect.right &&
      event.clientY >= rect.top &&
      event.clientY <= rect.bottom
    );
  }

  function clickProjectedPile(event: MouseEvent) {
    const pile = projectedPiles().find(([, element]) => containsPoint(element, event));
    if (!pile) {
      return false;
    }
    event.preventDefault();
    event.stopPropagation();
    pile[2]();
    return true;
  }

  function updateProjectedPileHover(event: MouseEvent) {
    projectedHoverPile = projectedPiles().find(([, element]) => containsPoint(element, event))?.[0] ?? '';
  }

  let boardPerspectiveStyle = $derived([
    `--board-tilt: ${boardTilt}deg`,
    `--board-perspective: ${boardPerspective}px`,
    `--board-scale-y: ${boardScaleY / 100}`,
    `--board-lift: ${boardLift}px`,
  ].join('; '));

  function clickBoardSurface(event: MouseEvent) {
    if (clickProjectedPile(event)) {
      return;
    }
    if (!canPlayOnBoard) {
      return;
    }
    if (
      event.target instanceof Element &&
      event.target.closest('button, a, input, textarea, select, .board-slot, .card-tile, .bench-drop-surface, .stack-pile, .stadium-card')
    ) {
      return;
    }
    clickBoardPlay(event);
  }

  function showLostZone(player: PlayerView) {
    showZone(player.index, 'lostZone', `${player.name} lost zone`);
  }

  function showDiscard(player: PlayerView) {
    showZone(player.index, 'discard', `${player.name} discard`);
  }

  function slotHasCompletedEvolution(slot: PokemonSlotView) {
    return evolutionChromeEvents.some((event) => {
      const params = event.params as Record<string, unknown> | undefined;
      const serial = Number(params?.serial);
      const cardId = Number(params?.cardId);
      return (Number.isFinite(serial) && slot.pokemon?.serial === serial)
        || (Number.isFinite(cardId) && slot.pokemon?.id === cardId);
    });
  }
</script>

<section
  class="playmat"
  class:can-play-on-board={canPlayOnBoard}
  class:has-projected-pile-hover={projectedHoverPile !== ''}
  style={boardPerspectiveStyle}
  role="presentation"
  onclick={clickBoardSurface}
  onmousemove={updateProjectedPileHover}
  onmouseleave={() => (projectedHoverPile = '')}
  ondragover={allowBoardPlayDrop}
  ondrop={dropToBoardPlay}
>
  <div
    class="game-board-plane"
    class:can-play-on-board={canPlayOnBoard}
    role="presentation"
    ondragover={allowBoardPlayDrop}
    ondrop={dropToBoardPlay}
  >
    <BenchZone
      player={topPlayer}
      slots={topBenchSlots}
      opponent
      {canPlayToBenchArea}
      {canPlayOnBoard}
      {clickBoardPlay}
      {canPlaceSetupBench}
      {playToBenchArea}
      {placeSetupBench}
      {allowBenchDrop}
      {dropToBenchArea}
      {isPlayableTarget}
      {isBoardPromptSelectable}
      {isBoardPromptSelected}
      {boardSlotDelta}
      {clickSlot}
      {allowDrop}
      {dropToSlot}
      {slotHasCompletedEvolution}
    />

    <CenterPiles
      {topPlayer}
      {bottomPlayer}
      {boardTilt}
      {projectedHoverPile}
      {animationEvents}
      {animationScopeKey}
      {animationPlan}
      {replayMode}
      bind:topLostPileElement
      bind:topDiscardPileElement
      bind:bottomLostPileElement
      bind:bottomDiscardPileElement
      {showLostZone}
      {showDiscard}
    />

    <DeckPrizeAnimation
      events={animationEvents}
      scopeKey={animationScopeKey}
      {replayMode}
      animateTakes={false}
    />

    <ActiveDuel
      {topPlayer}
      {bottomPlayer}
      {topActiveSlot}
      {bottomActiveSlot}
      {isPlayableTarget}
      {isBoardPromptSelectable}
      {isBoardPromptSelected}
      {boardSlotDelta}
      {clickSlot}
      {allowDrop}
      {dropToSlot}
      {canPlaceSetupActive}
      {placeSetupActive}
      {showZone}
      {slotHasCompletedEvolution}
    />

    <BenchZone
      player={bottomPlayer}
      slots={bottomBenchSlots}
      {canPlayToBenchArea}
      {canPlayOnBoard}
      {clickBoardPlay}
      {canPlaceSetupBench}
      {playToBenchArea}
      {placeSetupBench}
      {allowBenchDrop}
      {dropToBenchArea}
      {isPlayableTarget}
      {isBoardPromptSelectable}
      {isBoardPromptSelected}
      {boardSlotDelta}
      {clickSlot}
      {allowDrop}
      {dropToSlot}
      {slotHasCompletedEvolution}
    />

    <BoardMoveAnimation
      events={animationEvents}
      scopeKey={animationScopeKey}
      {animationPlan}
      {replayMode}
    />
  </div>

</section>

<style>
  .playmat {
    --board-top-row-align: start;
    --board-bottom-row-align: end;
    --active-preferred-w: calc(var(--board-card-w) * 1.48);
    --active-fit-w: max(
      calc(var(--board-card-w) * var(--active-min-card-scale, 1.15)),
      calc((var(--board-grid-h) - (var(--bench-row-h) * 2) - (var(--board-row-gap) * 2) - var(--active-gap)) / (var(--card-aspect-h, 1.397) * 2))
    );
    --active-w: min(var(--active-preferred-w), var(--active-fit-w));
    --active-h: calc(var(--active-w) * var(--card-aspect-h, 1.397));
    --pile-w: calc(var(--board-card-w) * 1.28);
    --prize-card-w: calc(var(--board-card-w) * 0.96);
    --prize-grid-w: calc(var(--prize-card-w) * 1.98);
    --prize-grid-h: calc((var(--prize-card-w) * 1.397) + (var(--prize-card-w) * 1.42));
    --side-field-w: max(var(--prize-grid-w), var(--pile-w));
    --bench-gap: calc(var(--board-card-w) * 0.18);
    position: absolute;
    inset: var(--board-top-inset) var(--board-right-rail) var(--board-bottom-inset) 0;
    min-width: 0;
    perspective: var(--board-perspective, 1250px);
    perspective-origin: 50% 68%;
    transform-style: preserve-3d;
  }

  .playmat.has-projected-pile-hover {
    cursor: pointer;
  }

  :global(.debug-zones) .playmat {
    outline: 2px solid rgba(37, 99, 235, 0.9);
    outline-offset: -2px;
    background: rgba(37, 99, 235, 0.05);
  }

  .game-board-plane {
    position: absolute;
    inset: 0;
    display: grid;
    grid-template-areas:
      "top-left top-bench top-right"
      "battle-left battle battle-right"
      "bottom-left bottom-bench bottom-right";
    grid-template-columns:
      minmax(var(--side-field-w), calc(var(--side-field-w) + (var(--board-card-w) * 0.42)))
      minmax(0, 1fr)
      minmax(var(--side-field-w), calc(var(--side-field-w) + (var(--board-card-w) * 0.42)));
    grid-template-rows:
      var(--bench-row-h)
      minmax(calc((var(--active-h) * 2) + var(--active-gap)), 1fr)
      var(--bench-row-h);
    gap: var(--board-row-gap);
    align-items: stretch;
    justify-items: stretch;
    padding:
      var(--board-content-inset-y)
      var(--board-content-inset-x)
      var(--board-content-inset-bottom, var(--board-content-inset-y));
    background: var(--board-plane-bg);
    overflow: visible;
    transform: rotateX(var(--board-tilt, 8deg)) scaleY(var(--board-scale-y, 0.94)) translateY(var(--board-lift, 0px));
    transform-origin: 50% 58%;
    transform-style: preserve-3d;
    will-change: transform;
  }

  :global(.debug-zones) .game-board-plane {
    outline: 2px solid rgba(14, 165, 233, 0.9);
    outline-offset: -4px;
    background: var(--board-plane-debug-bg);
  }

  .game-board-plane::before {
    content: "";
    position: absolute;
    inset: var(--board-outline-pad-y) var(--board-edge-pad-x);
    z-index: 0;
    border: 2px solid var(--board-border);
    border-radius: 18px;
    box-shadow:
      inset 0 0 0 1px var(--board-inset-highlight),
      var(--board-shadow);
    pointer-events: none;
  }

  .game-board-plane::after {
    content: "";
    position: absolute;
    left: 50%;
    top: 50%;
    z-index: 0;
    width: clamp(180px, min(21vw, 32vh), 300px);
    aspect-ratio: 1;
    transform: translate(-50%, -50%);
    background: url("/assets/pokeball.svg") center / contain no-repeat;
    opacity: var(--board-center-opacity);
    pointer-events: none;
  }

  .game-board-plane.can-play-on-board {
    cursor: pointer;
  }

  .game-board-plane.can-play-on-board::before {
    border-color: var(--selection-border-strong);
    background: var(--board-play-bg);
    box-shadow: var(--board-play-shadow);
  }

  :global(.board-slot.empty[data-animation-visibility-hidden="true"]) {
    border-color: transparent !important;
    background: transparent !important;
  }

  :global(.board-slot[data-animation-visibility-hidden="true"]) {
    transition: none !important;
  }

  :global(.board-slot[data-animation-visibility-hidden="true"] > .card-tile),
  :global(.board-slot[data-animation-visibility-hidden="true"] > .pokemon-status),
  :global(.board-slot[data-animation-visibility-hidden="true"] > .energy-badges),
  :global(.board-slot[data-animation-visibility-hidden="true"] > .tool-card-preview),
  :global(.board-slot[data-animation-visibility-hidden="true"] > .slot-badges),
  :global(.board-slot[data-animation-visibility-hidden="true"] > .empty-zone),
  :global(.stadium-card[data-animation-visibility-hidden="true"]),
  :global(.discard-pile [data-animation-visibility-hidden="true"] .card-tile),
  :global(.discard-pile .card-tile[data-animation-visibility-hidden="true"]),
  :global([data-animation-anchor="attached-energy"][data-animation-visibility-hidden="true"]),
  :global([data-animation-anchor="attached-tool"][data-animation-visibility-hidden="true"]) {
    opacity: 0;
  }

  :global(.resolving-zone[data-animation-visibility-hidden="true"]) {
    visibility: hidden;
  }

</style>
