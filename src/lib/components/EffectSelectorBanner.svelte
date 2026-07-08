<script lang="ts">
  // Banner for board-answered selects. For countdown runs (damage counter
  // placement, energy payment) it shows running progress as coin pips; every
  // shape keeps a "pick from a list" escape hatch into the generic dialog,
  // which can complete any select the engine emits.
  type Props = {
    message: string;
    placed?: number;
    total?: number;
    kind?: 'damage' | 'energy';
    onShowList: () => void;
  };

  let { message, placed, total, kind = 'damage', onShowList }: Props = $props();

  let pips = $derived(total && placed !== undefined
    ? Array.from({ length: total }, (_, pip) => pip < placed)
    : []);
  let left = $derived(total !== undefined && placed !== undefined ? total - placed : undefined);
</script>

<div class="effect-selector-banner" role="status">
  <strong>{message}</strong>
  {#if pips.length}
    <div class="effect-progress" data-kind={kind} aria-label={`${placed} of ${total} placed, ${left} left`}>
      {#each pips as filled, pip (pip)}
        <span class="effect-pip" class:filled>{filled && kind === 'damage' ? '10' : ''}</span>
      {/each}
      <span class="effect-progress-count">{left} left</span>
    </div>
  {/if}
  <span class="effect-hint">
    Click a highlighted Pokemon on the board, or
    <button type="button" class="effect-list-link" onclick={onShowList}>pick from a list</button>.
  </span>
</div>

<style>
  .effect-selector-banner {
    position: absolute;
    left: calc((100vw - var(--board-right-rail)) / 2);
    top: calc(var(--board-top-inset) + 48px);
    z-index: 14;
    transform: translate(-50%, -50%);
    display: grid;
    justify-items: center;
    gap: 4px;
    padding: 10px 18px;
    border-radius: 8px;
    border: 1px solid var(--surface-glass-border);
    background: var(--surface-glass-bg);
    color: var(--text-secondary);
    box-shadow: var(--surface-glass-shadow);
    backdrop-filter: blur(var(--backdrop-blur));
    text-align: center;
  }

  .effect-selector-banner strong {
    color: var(--text-primary);
    font-size: 14px;
  }

  .effect-progress {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 2px 0;
  }

  .effect-pip {
    display: inline-grid;
    place-items: center;
    width: 18px;
    height: 18px;
    border-radius: 999px;
    border: 1px dashed var(--surface-glass-border);
    background: transparent;
    color: transparent;
    font-size: 8px;
    font-weight: 950;
    line-height: 1;
    transition: background var(--transition-fast), border-color var(--transition-fast);
  }

  .effect-pip.filled {
    border: 1px solid rgba(128, 76, 18, 0.46);
    background:
      radial-gradient(circle at 34% 24%, rgba(255, 232, 121, 0.9), transparent 34%),
      linear-gradient(180deg, #ffb03d 0%, #f39023 54%, #c97018 100%);
    box-shadow:
      0 2px 5px rgba(95, 48, 13, 0.3),
      inset 0 1px 1px rgba(255, 236, 155, 0.7);
    color: #fff8df;
    -webkit-text-stroke: 0.6px #1f1f1f;
    paint-order: stroke fill;
  }

  .effect-progress[data-kind='energy'] .effect-pip.filled {
    border-color: rgba(30, 64, 96, 0.5);
    background:
      radial-gradient(circle at 34% 24%, rgba(196, 228, 255, 0.9), transparent 34%),
      linear-gradient(180deg, #6db3e8 0%, #3d86c4 54%, #235d92 100%);
    box-shadow:
      0 2px 5px rgba(17, 44, 68, 0.3),
      inset 0 1px 1px rgba(214, 236, 255, 0.7);
    color: #eef7ff;
  }

  .effect-progress-count {
    margin-left: 4px;
    color: var(--text-muted);
    font-size: 11px;
    font-weight: 700;
  }

  .effect-hint {
    font-size: 11px;
    color: var(--text-muted);
  }

  .effect-list-link {
    display: inline;
    min-height: 0;
    margin: 0;
    padding: 0;
    border: 0;
    border-radius: 0;
    background: none;
    box-shadow: none;
    color: var(--text-secondary);
    font-size: 11px;
    font-weight: 700;
    text-decoration: underline;
    cursor: pointer;
  }

  .effect-list-link:hover {
    color: var(--text-primary);
  }
</style>
