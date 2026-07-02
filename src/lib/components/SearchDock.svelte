<script lang="ts">
  import MctsPanel from './MctsPanel.svelte';
  import type { MctsStepView } from '../game/replay';

  type Props = {
    /** Search readout for the decision currently governing the board (carried forward). */
    mcts: MctsStepView | null;
    decisionOrdinal: number; // 0-based; -1 before the first decision
    decisionCount: number;
    decisionTurn?: number;
    decisionLabel?: string;
    hasPrev: boolean;
    hasNext: boolean;
    currentTurn: number;
    stateValue: string;
    copiedForkPoint?: boolean;
    onPrev: () => void;
    onNext: () => void;
    onPlayResult: () => void;
    copyForkPoint: () => void;
    replayName: string;
    playerLabel: string;
  };

  let {
    mcts,
    decisionOrdinal,
    decisionCount,
    decisionTurn,
    decisionLabel,
    hasPrev,
    hasNext,
    currentTurn,
    stateValue,
    copiedForkPoint = false,
    onPrev,
    onNext,
    onPlayResult,
    copyForkPoint,
    replayName,
    playerLabel,
  }: Props = $props();
</script>

<aside class="search-dock" aria-label="Search analysis">
  <header class="search-dock-head">
    <strong title={replayName}>{replayName}</strong>
    <span title={playerLabel}>{playerLabel}</span>
  </header>

  {#if decisionCount > 0}
    <nav class="decision-nav" aria-label="Decision navigation">
      <button onclick={onPrev} disabled={!hasPrev} aria-label="Previous decision" title="Previous decision">◀</button>
      <span class="decision-count">
        decision {decisionOrdinal < 0 ? '—' : decisionOrdinal + 1} / {decisionCount}
        {#if decisionTurn !== undefined}<small>· turn {decisionTurn}</small>{/if}
      </span>
      <button onclick={onNext} disabled={!hasNext} aria-label="Next decision" title="Next decision">▶</button>
    </nav>

    {#if mcts}
      {#if decisionLabel}
        <div class="decision-label" title={decisionLabel}>{decisionLabel}</div>
      {/if}
      <MctsPanel {mcts} {onPlayResult} />
    {:else}
      <p class="search-dock-empty">Step forward to the agent's first decision to see its search.</p>
    {/if}
  {:else}
    <p class="search-dock-empty">This replay has no recorded search analysis.</p>
  {/if}

  <footer class="search-dock-foot">
    <span>Turn <b>{currentTurn}</b> · State <b>{stateValue}</b></span>
    <button class="fork" type="button" onclick={copyForkPoint}>
      {copiedForkPoint ? 'Fork point copied' : 'Copy fork point'}
    </button>
  </footer>
</aside>

<style>
  .search-dock {
    width: var(--analysis-dock-w, 300px);
    height: 100vh;
    flex: none;
    z-index: 11;
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 14px 12px;
    overflow-y: auto;
    border-left: 1px solid var(--surface-toolbar-border);
    background: var(--surface-toolbar-bg);
    color: var(--text-primary);
    backdrop-filter: blur(var(--backdrop-blur));
  }

  .search-dock-head {
    display: grid;
    gap: 3px;
    min-width: 0;
  }

  .search-dock-head strong {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 13px;
  }

  .search-dock-head span {
    min-width: 0;
    overflow: hidden;
    color: var(--text-secondary);
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 11px;
  }

  .decision-nav {
    display: grid;
    grid-template-columns: 36px minmax(0, 1fr) 36px;
    align-items: center;
    gap: 8px;
    padding: 6px;
    border: 1px solid var(--surface-inset-border);
    border-radius: 8px;
    background: var(--surface-inset-bg);
  }

  .decision-nav button {
    height: 30px;
    border-radius: 6px;
    border: 1px solid var(--button-border);
    background: var(--button-bg);
    color: var(--button-text);
    font-size: 12px;
    font-weight: 800;
  }

  .decision-count {
    text-align: center;
    font-size: 12px;
    font-weight: 800;
    font-variant-numeric: tabular-nums;
  }

  .decision-count small {
    color: var(--text-secondary);
    font-weight: 700;
  }

  .decision-label {
    overflow: hidden;
    color: var(--text-secondary);
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12px;
    font-weight: 700;
  }

  .search-dock-empty {
    margin: 0;
    color: var(--text-secondary);
    font-size: 12px;
    line-height: 1.4;
  }

  .search-dock-foot {
    margin-top: auto;
    display: grid;
    gap: 7px;
    padding-top: 10px;
    border-top: 1px solid var(--surface-toolbar-border);
    color: var(--text-secondary);
    font-size: 11px;
  }

  .search-dock-foot b {
    color: var(--text-primary);
    font-variant-numeric: tabular-nums;
  }

  .search-dock-foot .fork {
    height: 28px;
    border-radius: 6px;
    border: 1px solid var(--button-border);
    background: var(--button-bg);
    color: var(--button-text);
    font-size: 11px;
    font-weight: 800;
  }
</style>
