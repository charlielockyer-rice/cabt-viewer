<script lang="ts">
  import ActiveDuel from './ActiveDuel.svelte';
  import BenchZone from './BenchZone.svelte';
  import BoardAnimationLayer from './BoardAnimationLayer.svelte';
  import CenterPiles from './CenterPiles.svelte';
  import EvalBar from './EvalBar.svelte';
  import { replayStore } from '../../state/replay.svelte';
  import { viewSettingsStore } from '../../state/viewSettings.svelte';
  import type { ActionTimelineEvent, PlayerView, PokemonSlotView } from '../game/types';

  type ZoneName = 'discard' | 'lostZone' | 'stadium' | 'playZone';

  type Props = {
    topPlayer: PlayerView;
    bottomPlayer: PlayerView;
    canPlayToBenchArea: (player: PlayerView) => boolean;
    canPlaceSetupBench: (player: PlayerView) => boolean;
    playToBenchArea: (player: PlayerView) => void;
    placeSetupBench: () => void;
    allowBenchDrop: (event: DragEvent, player: PlayerView) => void;
    dropToBenchArea: (player: PlayerView, event: DragEvent) => void;
    isPlayableTarget: (slot: PokemonSlotView) => boolean;
    isBoardPromptSelectable: (slot: PokemonSlotView) => boolean;
    isBoardPromptSelected: (slot: PokemonSlotView) => boolean;
    boardPickTally: (slot: PokemonSlotView) => number;
    boardPickKind?: 'damage' | 'energy';
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
    animationTurnKey?: string | number;
    animationApplySignal?: number;
    evolutionChromeEvents?: ActionTimelineEvent[];
    replayMode?: boolean;
    showEvalBar?: boolean;
    evalPWin?: number | null;
    evalOppPWin?: number | null;
    evalMyName?: string;
    evalOpponentName?: string;
  };

  let {
    topPlayer,
    bottomPlayer,
    canPlayToBenchArea,
    canPlaceSetupBench,
    playToBenchArea,
    placeSetupBench,
    allowBenchDrop,
    dropToBenchArea,
    isPlayableTarget,
    isBoardPromptSelectable,
    isBoardPromptSelected,
    boardPickTally,
    boardPickKind = 'damage',
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
    animationTurnKey = '',
    animationApplySignal = 0,
    evolutionChromeEvents = [],
    replayMode = false,
    showEvalBar = false,
    evalPWin = null,
    evalOppPWin = null,
    evalMyName = 'You',
    evalOpponentName = 'Opponent',
  }: Props = $props();

  // Scrub mode (replay only): the follow-active seat flip is a CSS transition on
  // card/pile transforms (rotate 180 + reposition). Under a fast back-and-forth
  // scrub those transitions stack and interrupt mid-rotation — the smear. Gate
  // them off so the flip snaps instantly, matching scrub mode's settled views.
  let scrubbing = $derived(replayMode && replayStore.scrubbing);

  // Seat-transition style (Charlie's compare-both preference): 'flip' rotates the
  // cards into the new perspective; 'fade' snaps the reposition instantly and
  // dims the board out/in instead. The fade is a one-shot animation restarted on
  // each seat flip (detected via which player is on top) — not a scrub concern,
  // so it plays during normal stepping/playback, and scrub-gating still wins.
  let seatFadeMode = $derived(viewSettingsStore.seatTransition === 'fade');
  let planeElement = $state<HTMLElement>();
  let lastTopIndex = topPlayer?.index;
  $effect(() => {
    const topIndex = topPlayer?.index;
    if (topIndex === lastTopIndex) {
      return;
    }
    lastTopIndex = topIndex;
    // Drive the fade imperatively via the Web Animations API: element.animate
    // restarts cleanly on every flip (a reactive class toggled off→on gets
    // batched by Svelte and never restarts the CSS animation). The reposition
    // itself is instant (card transitions zeroed in fade mode below), so the dim
    // masks it.
    if (seatFadeMode && !scrubbing && planeElement && typeof planeElement.animate === 'function') {
      planeElement.animate(
        [{ opacity: 1 }, { opacity: 0.06, offset: 0.42 }, { opacity: 0.06, offset: 0.58 }, { opacity: 1 }],
        { duration: 300, easing: 'ease' },
      );
    }
  });

  let topLostPileElement = $state<HTMLButtonElement>();
  let topDiscardPileElement = $state<HTMLButtonElement>();
  let bottomLostPileElement = $state<HTMLButtonElement>();
  let bottomDiscardPileElement = $state<HTMLButtonElement>();
  let projectedHoverPile = $state('');

  // Bench zones are rendered per-player in a stable order (keyed by
  // player.index) so the follow-active seat flip only flips each zone's
  // top/bottom placement (a CSS reposition) instead of swapping which player it
  // renders — the bench Pokemon keep their DOM nodes through the flip (M2). The
  // board anchors are already player-index based, so nothing downstream changes.
  let orderedPlayers = $derived([topPlayer, bottomPlayer].slice().sort((a, b) => a.index - b.index));

  function benchSlotsFor(player: PlayerView): PokemonSlotView[] {
    return player.bench.filter((slot) => !slot.empty);
  }

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
    bind:this={planeElement}
    class="game-board-plane"
    class:can-play-on-board={canPlayOnBoard}
    class:has-eval-bar={showEvalBar}
    class:seat-fade-mode={seatFadeMode}
    data-scrubbing={scrubbing ? '' : undefined}
    role="presentation"
    ondragover={allowBoardPlayDrop}
    ondrop={dropToBoardPlay}
  >
    {#if showEvalBar}
      <!-- A child of the board plane, so the rail inherits the plane's
           rotateX tilt and hugs the tilted left edge as part of the table.
           The plane is transform-style: flat, so this adds no preserve-3d
           context and cannot reintroduce the Chromium hit-test breakage. -->
      <div class="board-eval-rail">
        <EvalBar pWin={evalPWin} oppPWin={evalOppPWin} myName={evalMyName} opponentName={evalOpponentName} />
      </div>
    {/if}

    {#each orderedPlayers as benchPlayer (benchPlayer.index)}
      <BenchZone
        player={benchPlayer}
        slots={benchSlotsFor(benchPlayer)}
        opponent={benchPlayer.index === topPlayer.index}
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
        {boardPickTally}
        {boardPickKind}
        {clickSlot}
        {allowDrop}
        {dropToSlot}
        {slotHasCompletedEvolution}
      />
    {/each}

    <CenterPiles
      {topPlayer}
      {bottomPlayer}
      {boardTilt}
      {projectedHoverPile}
      bind:topLostPileElement
      bind:topDiscardPileElement
      bind:bottomLostPileElement
      bind:bottomDiscardPileElement
      {showLostZone}
      {showDiscard}
    />

    <ActiveDuel
      {topPlayer}
      {bottomPlayer}
      {isPlayableTarget}
      {isBoardPromptSelectable}
      {isBoardPromptSelected}
      {boardPickTally}
      {boardPickKind}
      {clickSlot}
      {allowDrop}
      {dropToSlot}
      {canPlaceSetupActive}
      {placeSetupActive}
      {showZone}
      {slotHasCompletedEvolution}
    />

    <BoardAnimationLayer
      events={animationEvents}
      scopeKey={animationScopeKey}
      turnKey={animationTurnKey}
      applySignal={animationApplySignal}
      {replayMode}
      players={[topPlayer, bottomPlayer]}
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
    /* flat, NOT preserve-3d: Chromium hit-testing breaks inside the tilted
       3D rendering context — slots' clickable regions detach from where
       they paint (whole opponent side unclickable, cursor flicker on own
       slots). All board children are coplanar, so flat renders identically
       (measured pixel-identical) while hit regions match the paint. */
    transform-style: flat;
  }

  .playmat.has-projected-pile-hover {
    cursor: pointer;
  }

  :global(.debug-zones) .playmat {
    outline: 2px solid rgba(37, 99, 235, 0.9);
    outline-offset: -2px;
    background: rgba(37, 99, 235, 0.05);
  }

  /* Scrub mode: snap every board transition instantly so the follow-active seat
     flip (card rotate + pile reposition, CardTile/CenterPiles transform
     transitions) can't stack/smear under a fast back-and-forth scrub. Matches
     scrub mode's instant settled views; transitions resume the moment nav
     settles and the attribute drops. */
  .game-board-plane[data-scrubbing],
  .game-board-plane[data-scrubbing] :global(*) {
    transition-duration: 0s !important;
  }

  /* Fade seat-transition (opt-in): the flip's card rotations + pile repositions
     snap instantly (no rotate transition), and the whole board dims out then
     fades back in the new perspective instead — the reposition hides under the
     dim. The fade is restarted per seat flip from the script (reflow trick). */
  .game-board-plane.seat-fade-mode :global(.card-tile) {
    transition-duration: 0s;
  }

  .game-board-plane {
    position: absolute;
    inset: 0;
    /* Left lane for the eval bar OUTSIDE the board outline. 0 unless the bar is
       shown, in which case the outline + content shift right by this much and
       the rail rides the freed tilted lane (Charlie: bar outside the board,
       board padded away from the left edge to make room). */
    --board-eval-gutter: 0px;
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
      var(--board-content-inset-bottom, var(--board-content-inset-y))
      calc(var(--board-content-inset-x) + var(--board-eval-gutter));
    background: var(--board-plane-bg);
    overflow: visible;
    transform: rotateX(var(--board-tilt, 8deg)) scaleY(var(--board-scale-y, 0.94)) translateY(var(--board-lift, 0px));
    transform-origin: 50% 58%;
    /* flat for reliable hit-testing — see .playmat above. */
    transform-style: flat;
    will-change: transform;
  }

  :global(.debug-zones) .game-board-plane {
    outline: 2px solid rgba(14, 165, 233, 0.9);
    outline-offset: -4px;
    background: var(--board-plane-debug-bg);
  }

  /* Win-probability rail riding the tilted plane in the gutter OUTSIDE the
     board's left outline (the outline + content are shifted right by
     --board-eval-gutter to make room). Being a plane child, it foreshortens
     with the board tilt; sitting outside the outline, it can't cover a slot.
     Height matches the outline (outline-pad-y insets). */
  .board-eval-rail {
    position: absolute;
    top: var(--board-outline-pad-y);
    bottom: var(--board-outline-pad-y);
    /* Centered in the gutter: [edge-pad-x .. edge-pad-x + gutter], which is left
       of the shifted outline (at edge-pad-x + gutter). */
    left: calc(var(--board-edge-pad-x) + (var(--board-eval-gutter) - 26px) / 2);
    width: 26px;
    z-index: 2;
    display: flex;
    justify-content: center;
  }

  .game-board-plane.has-eval-bar {
    /* The eval bar's lane. Wide enough for the 26px rail plus a small gap to the
       outline; the board content compresses to fit. */
    --board-eval-gutter: 42px;
  }

  .game-board-plane::before {
    content: "";
    position: absolute;
    inset:
      var(--board-outline-pad-y)
      var(--board-edge-pad-x)
      var(--board-outline-pad-y)
      calc(var(--board-edge-pad-x) + var(--board-eval-gutter));
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

</style>
