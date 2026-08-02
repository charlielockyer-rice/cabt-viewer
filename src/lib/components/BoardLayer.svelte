<script lang="ts">
  import type { Snippet } from 'svelte';
  import { viewSettingsStore } from '../../state/viewSettings.svelte';

  type Props = {
    children: Snippet;
    motionDisabled?: boolean;
  };

  let { children, motionDisabled = false }: Props = $props();
</script>

<div
  class="board"
  class:seat-fade-active={viewSettingsStore.seatFadeActive}
  class:motion-disabled={motionDisabled}
>
  {@render children()}
</div>

<style>
  .board {
    position: relative;
    min-height: 0;
    height: 100vh;
    display: block;
  }

  /* Fade-mode side switch: while the gate is armed (viewSettingsStore
     .seatFadeActive), snap EVERY CSS transition in the whole board area — the
     board plane AND the hand panels (both live in here) — to 0 so the side
     switch lands instantly with zero flip/rotation; only the opacity dim moves.
     The class is bound to a flag set at the source of the flip, so it is present
     on the same flush that repositions the seats (no one-frame smear). The
     Web-Animations flips on the hands/bench are gated separately by the same
     flag in Hand/BenchZone (CSS can't reach those). */
  .board.seat-fade-active :global(*) {
    transition-duration: 0s !important;
  }

  .board.motion-disabled :global(*) {
    animation-duration: 0s !important;
    transition-duration: 0s !important;
  }

  @media (max-width: 980px) {
    .board {
      grid-template-columns: 1fr;
    }
  }
</style>
