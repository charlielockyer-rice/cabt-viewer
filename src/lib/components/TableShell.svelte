<script lang="ts">
  import type { Snippet } from 'svelte';

  type Props = {
    debugZones?: boolean;
    replayMode?: boolean;
    children: Snippet;
  };

  let { debugZones = false, replayMode = false, children }: Props = $props();
</script>

<section class="table-shell" class:debug-zones={debugZones} class:replay-mode={replayMode}>
  {@render children()}
</section>

<style>
  .table-shell {
    --card-aspect-h: 1.397;
    --hand-card-board-scale: 1.55;
    --hand-hover-pad-scale: 0.065;
    --hand-hover-clearance-scale: 2.5;
    --board-row-gap-scale: 0.16;
    --active-gap-scale: 0.24;
    --active-min-card-scale: 1.15;
    --bench-card-scale: 1.24;
    --bench-row-h-scale: 1.42;
    --board-outline-pad-y-scale: 0.06;
    --board-content-pad-scale: 0.18;
    --opponent-hand-height: clamp(58px, 7.2vh, 84px);
    --replay-dock-h: 0px;
    --hand-board-gap: 0px;
    --board-bottom-hand-clearance: 14px;
    --board-fit-safety-y: 10px;
    --board-fit-hand-units: calc((var(--hand-card-board-scale) * var(--card-aspect-h)) + (var(--hand-hover-pad-scale) * var(--hand-hover-clearance-scale)));
    --board-fit-padding-units: calc((var(--board-outline-pad-y-scale) + var(--board-content-pad-scale)) * 2);
    --board-fit-bench-units: calc(var(--bench-card-scale) * var(--bench-row-h-scale) * 2);
    --board-fit-gap-units: calc((var(--board-row-gap-scale) * 2) + var(--active-gap-scale));
    --board-fit-active-units: calc(var(--active-min-card-scale) * var(--card-aspect-h) * 2);
    --board-fit-units: calc(var(--board-fit-hand-units) + var(--board-fit-padding-units) + var(--board-fit-bench-units) + var(--board-fit-gap-units) + var(--board-fit-active-units));
    --board-fit-card-w: calc((100vh - var(--opponent-hand-height) - var(--hand-board-gap) - var(--board-bottom-hand-clearance) - var(--replay-dock-h) - var(--board-fit-safety-y)) / var(--board-fit-units));
    --board-card-w: clamp(44px, min(8vw, 8.1vh, var(--board-fit-card-w)), 104px);
    --card-w: var(--board-card-w);
    --hand-card-w: min(clamp(96px, min(7.8vw, 14.5vh), 150px), calc(var(--board-card-w) * var(--hand-card-board-scale)));
    --min-table-width: 760px;
    --board-row-gap: calc(var(--board-card-w) * var(--board-row-gap-scale));
    --active-gap: calc(var(--board-card-w) * var(--active-gap-scale));
    --bench-card-w: calc(var(--board-card-w) * var(--bench-card-scale));
    --bench-row-h: calc(var(--bench-card-w) * var(--bench-row-h-scale));
    --board-top-inset: calc(var(--opponent-hand-height) + var(--hand-board-gap));
    --hand-hover-pad: calc(var(--board-card-w) * var(--hand-hover-pad-scale));
    --hand-hover-clearance: calc(var(--hand-hover-pad) + 12px);
    --hand-shadow-clearance: calc(var(--hand-hover-pad) + 14px);
    --board-bottom-inset: calc((var(--hand-card-w) * var(--card-aspect-h)) + (var(--hand-hover-pad) * var(--hand-hover-clearance-scale)) + var(--board-bottom-hand-clearance) + var(--replay-dock-h));
    --board-right-rail: 150px;
    --table-side-gap: 14px;
    --player-panel-right: calc(var(--board-right-rail) + 8px);
    --board-h: calc(100vh - var(--board-top-inset) - var(--board-bottom-inset));
    --board-edge-pad: calc(var(--board-card-w) * 0.32);
    --board-outline-pad-y: calc(var(--board-card-w) * var(--board-outline-pad-y-scale));
    --board-content-pad: calc(var(--board-card-w) * var(--board-content-pad-scale));
    --board-edge-pad-x: var(--board-edge-pad);
    --board-content-inset-y: calc(var(--board-outline-pad-y) + var(--board-content-pad));
    --board-content-inset-bottom: var(--board-content-inset-y);
    --board-content-inset-x: calc(var(--board-edge-pad-x) + var(--board-content-pad));
    --board-grid-h: calc(var(--board-h) - var(--board-content-inset-y) - var(--board-content-inset-bottom));
    width: max(100vw, var(--min-table-width));
    min-width: var(--min-table-width);
    min-height: 100vh;
    position: relative;
    overflow: hidden;
    padding: 0;
    background: var(--app-backdrop-bg);
    -webkit-user-select: none;
    user-select: none;
  }

  .table-shell.replay-mode {
    --replay-dock-h: 48px;
  }

  .table-shell :global(*) {
    -webkit-user-select: none;
    user-select: none;
  }

  .table-shell :global(img) {
    -webkit-user-drag: none;
  }
</style>
