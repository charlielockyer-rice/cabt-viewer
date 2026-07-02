<script lang="ts">
  import type { MctsStepView } from '../game/replay';

  type Props = {
    mcts: MctsStepView;
    /** When provided, the played move becomes a button that jumps the board to its result. */
    onPlayResult?: () => void;
  };

  let { mcts, onPlayResult }: Props = $props();

  const MAX_ROWS = 14;
  let rows = $derived(mcts.candidates.slice(0, MAX_ROWS));
  let hiddenCount = $derived(Math.max(0, mcts.candidates.length - rows.length));

  function percent(share: number): string {
    return `${Math.round(share * 100)}%`;
  }

  function signed(value: number): string {
    return `${value >= 0 ? '+' : ''}${value.toFixed(2)}`;
  }

  function simCount(total: number): string {
    if (total >= 10000) {
      return `${Math.round(total / 1000)}k`;
    }
    if (total >= 1000) {
      return `${(total / 1000).toFixed(1)}k`;
    }
    return String(total);
  }
</script>

<section class="mcts" aria-label="Search statistics">
  <div class="mcts-head">
    <strong>Search</strong>
    <span>{simCount(mcts.totalVisits)} sims · {mcts.optionCount} options</span>
  </div>
  <ol class="mcts-list">
    {#each rows as row}
      <li class:chosen={row.chosen}>
        <div class="bar" style="--share: {row.visitShare}">
          <span class="label" title={row.label}>{row.label}</span>
          <span class="visits">{row.visits}</span>
        </div>
        <div class="stats">
          <span>{percent(row.visitShare)}</span>
          <span>q {signed(row.q)}</span>
          <span>p {row.prior.toFixed(2)}</span>
          {#if row.chosen}
            {#if onPlayResult}
              <button class="pick" type="button" onclick={onPlayResult} title="Jump to the state this move produced">
                ● played → result
              </button>
            {:else}
              <span class="pick">● played</span>
            {/if}
          {/if}
        </div>
      </li>
    {/each}
  </ol>
  {#if hiddenCount}
    <div class="mcts-more">+{hiddenCount} more</div>
  {/if}
</section>

<style>
  .mcts {
    display: grid;
    gap: 8px;
    padding-top: 8px;
    border-top: 1px solid var(--surface-toolbar-border);
  }

  .mcts-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 6px;
    font-size: 13px;
  }

  .mcts-head strong {
    font-size: 15px;
  }

  .mcts-head span {
    min-width: 0;
    overflow: hidden;
    color: var(--text-secondary);
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 10px;
  }

  .mcts-list {
    display: grid;
    gap: 4px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .mcts-list li {
    display: grid;
    gap: 2px;
    padding: 3px 5px;
    border: 1px solid transparent;
    border-radius: 5px;
  }

  .mcts-list li.chosen {
    border-color: var(--accent-base);
    background: var(--accent-soft);
  }

  .bar {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    padding: 2px 5px;
    border-radius: 4px;
    background: var(--accent-tint);
    overflow: hidden;
    isolation: isolate;
  }

  .bar::before {
    content: '';
    position: absolute;
    inset: 0;
    z-index: -1;
    width: calc(var(--share, 0) * 100%);
    background: var(--accent-soft);
  }

  .label {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 13px;
    font-weight: 700;
  }

  .visits {
    flex: none;
    color: var(--text-secondary);
    font-size: 10px;
    font-weight: 800;
    font-variant-numeric: tabular-nums;
  }

  .stats {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    color: var(--text-secondary);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
  }

  .stats .pick {
    color: var(--accent-base);
    font-weight: 800;
  }

  button.pick {
    padding: 0;
    border: 0;
    background: none;
    font: inherit;
    font-weight: 800;
    line-height: inherit;
    cursor: pointer;
  }

  button.pick:hover {
    text-decoration: underline;
  }

  .mcts-more {
    color: var(--text-secondary);
    font-size: 10px;
  }
</style>
