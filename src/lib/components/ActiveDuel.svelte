<script lang="ts">
  import BoardSlot from './BoardSlot.svelte';
  import StadiumCard from './StadiumCard.svelte';
  import type { PlayerView, PokemonSlotView } from '../game/types';

  type ZoneName = 'discard' | 'lostZone' | 'stadium' | 'playZone';

  type Props = {
    topPlayer: PlayerView;
    bottomPlayer: PlayerView;
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
    slotHasCompletedEvolution?: (slot: PokemonSlotView) => boolean;
  };

  let {
    topPlayer,
    bottomPlayer,
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
    slotHasCompletedEvolution = () => false,
  }: Props = $props();

  function clickActive(slot: PokemonSlotView) {
    if (canPlaceSetupActive(slot)) {
      placeSetupActive();
      return;
    }
    clickSlot(slot);
  }

  // Actives are rendered per-player in a stable order (keyed by player.index),
  // so the follow-active seat flip only flips each active's placement class (a
  // CSS reposition + rotation) instead of swapping which player each slot
  // renders — the active Pokemon keeps its DOM node through the flip (M2). The
  // board anchors are already player-index based, so nothing downstream changes.
  let orderedPlayers = $derived([topPlayer, bottomPlayer].slice().sort((a, b) => a.index - b.index));
</script>

<div class="active-duel">
  {#each orderedPlayers as player (player.index)}
    {@const top = player.index === topPlayer.index}
    {@const stadium = player.stadium.at(-1)}
    <BoardSlot
      slot={player.active}
      active
      placement={top ? 'top-active-slot' : 'bottom-active-slot'}
      canDrop={isPlayableTarget(player.active) || canPlaceSetupActive(player.active)}
      promptSelectable={isBoardPromptSelectable(player.active)}
      promptSelected={isBoardPromptSelected(player.active)}
      pickTally={boardPickTally(player.active)}
      pickKind={boardPickKind}
      onclick={() => clickActive(player.active)}
      ondragover={(event) => allowDrop(event, player.active)}
      ondrop={(event) => dropToSlot(player.active, event)}
      evolutionChromeIn={slotHasCompletedEvolution(player.active)}
    />

    {#if stadium}
      <StadiumCard card={stadium} owner={player} placement={top ? 'top' : 'bottom'} {showZone} />
    {/if}
  {/each}
</div>

<style>
  .active-duel {
    position: relative;
    grid-area: battle;
    align-self: stretch;
    justify-self: stretch;
    z-index: 3;
    /* flat for reliable hit-testing — see .playmat in GameBoard. */
    transform-style: flat;
    pointer-events: none;
    display: grid;
    grid-template-rows: var(--active-h) minmax(calc(var(--card-w) * 0.24), 1fr) var(--active-h);
    grid-template-columns: minmax(0, 1fr) var(--active-w) minmax(0, 1fr);
    align-items: center;
    justify-items: center;
    row-gap: 0;
    column-gap: 0;
    min-height: 0;
  }

  :global(.debug-zones) .active-duel {
    outline: 2px solid rgba(245, 158, 11, 0.86);
    outline-offset: 4px;
    background: rgba(245, 158, 11, 0.06);
  }

  .active-duel :global(.top-active-slot) {
    grid-row: 1;
    grid-column: 2;
  }

  .active-duel :global(.bottom-active-slot) {
    grid-row: 3;
    grid-column: 2;
  }

  .active-duel :global(.top-active-slot),
  .active-duel :global(.bottom-active-slot) {
    position: relative;
    z-index: 4;
    pointer-events: auto;
  }

  .active-duel :global(.top-active-slot .card-tile) {
    transform: rotate(180deg);
  }

  .active-duel :global(.top-active-slot .energy-badges) {
    inset: calc(var(--slot-card-w) * -0.095) 0 auto auto;
    justify-content: flex-end;
    transform: rotate(180deg);
  }

  .active-duel :global(.top-active-slot .energy-badges .attached-energy-symbol) {
    transform: rotate(180deg);
  }

  .active-duel :global(.top-active-slot .tool-card-preview) {
    inset: auto auto var(--tool-preview-top) 0;
    transform: rotate(180deg);
  }

  .active-duel :global(.top-active-slot .pokemon-status) {
    inset: auto auto 0 0;
    align-items: start;
    justify-items: start;
  }

  .active-duel :global(.top-active-slot .damage-counter-value) {
    transform: rotate(180deg);
  }
</style>
