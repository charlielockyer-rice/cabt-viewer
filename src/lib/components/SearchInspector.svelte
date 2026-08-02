<script lang="ts">
  import type {
    ReplayDecisionAnalysis,
    ReplaySearchAction,
    ReplaySearchInspector,
  } from '../game/replayAnalysis';

  type Props = {
    analysis: ReplayDecisionAnalysis;
    seat0Name?: string;
    seat1Name?: string;
    viewerEvalSeat0?: number | null;
    close: () => void;
  };

  let {
    analysis,
    seat0Name = 'Player 1',
    seat1Name = 'Player 2',
    viewerEvalSeat0 = null,
    close,
  }: Props = $props();

  let inspector = $derived(analysis.searchInspector ?? null);
  let rootActions = $derived(sortedActions(inspector));
  let totalVisits = $derived(rootActions.reduce((total, action) => total + finite(action.visits), 0));
  let judgeSeat0 = $derived(numberOrNull(inspector?.rootSearchValueSeat0) ?? viewerEvalSeat0);
  let networkSeat0 = $derived(numberOrNull(inspector?.rootNetworkValueSeat0));
  let actorSeat = $derived(inspector?.actorSeat === 1 ? 1 : 0);
  let actorName = $derived(actorSeat === 0 ? seat0Name : seat1Name);
  let beliefs = $derived(inspector?.beliefs?.filter((belief) => typeof belief.weight === 'number') ?? []);

  function sortedActions(value: ReplaySearchInspector | null): ReplaySearchAction[] {
    return [...(value?.actions ?? [])].sort((left, right) => (
      finite(right.visits) - finite(left.visits)
      || Number(right.selected) - Number(left.selected)
      || finite(right.prior) - finite(left.prior)
    ));
  }

  function finite(value: number | undefined): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
  }

  function numberOrNull(value: number | null | undefined): number | null {
    return typeof value === 'number' && Number.isFinite(value)
      ? Math.min(1, Math.max(0, value))
      : null;
  }

  function pct(value: number | null | undefined): string {
    const normalized = numberOrNull(value);
    return normalized === null ? '—' : `${Math.round(normalized * 100)}%`;
  }

  function actionSearchShare(action: ReplaySearchAction): number | null {
    return totalVisits > 0 ? finite(action.visits) / totalVisits : null;
  }

  function actionSeat0Value(action: ReplaySearchAction): number | null {
    const absolute = numberOrNull(action.valueSeat0);
    if (absolute !== null) {
      return absolute;
    }
    const actorValue = numberOrNull(action.qForActor);
    if (actorValue === null) {
      return null;
    }
    return actorSeat === 0 ? actorValue : 1 - actorValue;
  }

  function actionLabel(action: ReplaySearchAction): string {
    const labels = (action.optionIndexes ?? [])
      .map((index) => analysis.legalActions?.[index]?.label)
      .filter((label): label is string => !!label);
    return [...new Set(labels)].join(' / ') || action.label || 'Recorded move';
  }

  function selectionLabel(selection: number[] | undefined): string {
    if (!selection?.length) {
      return 'No selection';
    }
    return selection.map((index) => analysis.legalActions?.[index]?.label ?? `Option ${index}`).join(' + ');
  }

  function matchesSelection(action: ReplaySearchAction, selection: number[] | undefined): boolean {
    return !!selection?.some((index) => action.optionIndexes?.includes(index));
  }
</script>

<aside class="search-inspector" aria-label="Search inspector">
  <header>
    <div>
      <strong>Search inspector</strong>
      <span>{actorName} · {analysis.changed ? 'search changed the move' : 'search agreed with policy'}</span>
    </div>
    <button class="close" aria-label="Close search inspector" onclick={close}>×</button>
  </header>

  <section class="judge-section">
    <div class="section-heading">
      <strong>Judge</strong>
      {#if judgeSeat0 !== null}
        <span>{seat0Name} {pct(judgeSeat0)} · {seat1Name} {pct(1 - judgeSeat0)}</span>
      {:else}
        <span>Not recorded</span>
      {/if}
    </div>
    {#if judgeSeat0 !== null}
      <div class="eval-bar" aria-label={`${seat0Name} win probability ${pct(judgeSeat0)}`}>
        <div class="seat0-fill" style={`width: ${judgeSeat0 * 100}%`}></div>
        <i class="midpoint"></i>
        {#if networkSeat0 !== null}
          <i
            class="network-marker"
            style={`left: ${networkSeat0 * 100}%`}
            title={`Network before search: ${pct(networkSeat0)} for ${seat0Name}`}
          ></i>
        {/if}
      </div>
      <div class="bar-labels">
        <span>{seat0Name}</span>
        {#if networkSeat0 !== null}<span>Network before search {pct(networkSeat0)}</span>{/if}
        <span>{seat1Name}</span>
      </div>
    {/if}
  </section>

  {#if inspector && rootActions.length}
    <section>
      <div class="section-heading">
        <strong>Root moves</strong>
        <span>{totalVisits} visits</span>
      </div>
      <div class="move-table" role="table" aria-label="Root move comparison">
        <div class="move-row table-head" role="row">
          <span>Move</span><span>Policy</span><span>Visits</span><span>Search</span><span>Judge</span>
        </div>
        {#each rootActions as action}
          {@const searchShare = actionSearchShare(action)}
          {@const seat0Value = actionSeat0Value(action)}
          <div class:chosen={action.selected} class="move-row" role="row">
            <div class="move-name">
              <span>{actionLabel(action)}</span>
              <small>
                {#if matchesSelection(action, analysis.policySelection)}<b class="policy-tag">Policy</b>{/if}
                {#if action.selected}<b class="search-tag">Chosen</b>{/if}
                {#if !action.expanded}<b class="muted-tag">Unexpanded</b>{/if}
              </small>
            </div>
            <span>{pct(action.prior)}</span>
            <span>{finite(action.visits)}</span>
            <span>{pct(searchShare)}</span>
            <span>{pct(seat0Value)}</span>
          </div>
        {/each}
      </div>
      <small class="perspective-note">Judge values are always shown as P({seat0Name} wins).</small>
    </section>

    {#if inspector.principalLine?.length}
      <section>
        <div class="section-heading">
          <strong>Chosen line</strong>
          <span>stopped at {inspector.stopReason ?? analysis.stopReason ?? 'boundary'}</span>
        </div>
        <div class="chosen-line">
          {#each inspector.principalLine as step, index}
            <div class="line-step">
              <small>{index + 1} · {step.actorSeat === 1 ? seat1Name : seat0Name}</small>
              <strong>{index === 0 && rootActions.find((action) => action.selected) ? actionLabel(rootActions.find((action) => action.selected)!) : step.label ?? 'Recorded action'}</strong>
              <span>{finite(step.visits)} visits · judge {pct(step.valueSeat0)}</span>
            </div>
          {/each}
        </div>
      </section>
    {/if}

    {#if beliefs.length}
      <section>
        <div class="section-heading">
          <strong>Opponent-list beliefs</strong>
          <span>{beliefs.length} {beliefs.length === 1 ? 'hypothesis' : 'hypotheses'}</span>
        </div>
        <div class="beliefs">
          {#each beliefs as belief, index}
            <div>
              <span>Hypothesis {index + 1}</span>
              <i><b style={`width: ${numberOrNull(belief.weight)! * 100}%`}></b></i>
              <strong>{pct(belief.weight)}</strong>
            </div>
          {/each}
        </div>
      </section>
    {/if}

    <footer>
      {inspector.completedTraversals ?? analysis.completedTraversals ?? 0} simulations
      · {inspector.distinctEvaluations ?? analysis.distinctEvaluations ?? 0} judge evaluations
      {#if (inspector.depthCutoffs ?? analysis.depthCutoffs ?? 0) > 0}
        · {inspector.depthCutoffs ?? analysis.depthCutoffs} depth cutoffs
      {/if}
    </footer>
  {:else}
    <section class="legacy-summary">
      <strong>This game saved the search result, but not its branches.</strong>
      <span>Policy: {selectionLabel(analysis.policySelection)}</span>
      <span>Search: {selectionLabel(analysis.searchSelection)}</span>
      <small>
        {analysis.completedTraversals ?? 0} simulations
        {#if analysis.distinctEvaluations !== undefined} · {analysis.distinctEvaluations} judge evaluations{/if}
        {#if analysis.stopReason} · stopped at {analysis.stopReason}{/if}
      </small>
      <p>Newly recorded games will include move weights, values, the chosen line, and belief weights here.</p>
    </section>
  {/if}
</aside>

<style>
  .search-inspector {
    position: absolute;
    top: 54px;
    right: calc(var(--board-right-rail) + 10px);
    bottom: calc(var(--replay-dock-h, 48px) + var(--replay-eval-h, 64px) + 10px);
    z-index: 35;
    width: min(560px, calc(100% - var(--board-right-rail) - 34px));
    overflow-y: auto;
    display: grid;
    align-content: start;
    gap: 14px;
    padding: 14px;
    border: 1px solid var(--surface-toolbar-border);
    border-radius: 9px;
    background: var(--app-bg);
    color: var(--text-primary);
    box-shadow: 0 18px 48px rgba(0, 0, 0, 0.28);
  }

  header,
  .section-heading,
  .bar-labels,
  .beliefs > div {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }

  header > div {
    display: grid;
    gap: 3px;
  }

  header strong { font-size: 16px; }
  header span,
  .section-heading span,
  .bar-labels,
  footer { color: var(--text-muted); font-size: 10px; }

  button.close {
    width: 32px;
    height: 32px;
    padding: 0;
    border: 1px solid var(--button-border);
    border-radius: 6px;
    background: var(--button-bg);
    color: var(--button-text);
    font-size: 21px;
    line-height: 1;
  }

  section {
    display: grid;
    gap: 9px;
    padding-top: 12px;
    border-top: 1px solid var(--surface-inset-border);
  }

  .section-heading strong { font-size: 12px; }

  .eval-bar {
    position: relative;
    height: 18px;
    overflow: hidden;
    border: 1px solid var(--surface-inset-border);
    border-radius: 999px;
    background: #c46a52;
  }

  .seat0-fill {
    height: 100%;
    background: var(--accent-base);
  }

  .eval-bar i { position: absolute; top: -2px; bottom: -2px; width: 2px; }
  .midpoint { left: 50%; background: rgba(255, 255, 255, 0.72); }
  .network-marker { background: #fff; box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.45); }

  .move-table {
    display: grid;
    overflow: hidden;
    border: 1px solid var(--surface-inset-border);
    border-radius: 7px;
  }

  .move-row {
    display: grid;
    grid-template-columns: minmax(150px, 1fr) 52px 48px 54px 54px;
    align-items: center;
    min-height: 42px;
    border-top: 1px solid var(--surface-inset-border);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
  }

  .move-row:first-child { border-top: 0; }
  .move-row > * { padding: 7px; }
  .move-row > span { color: var(--text-secondary); text-align: right; }
  .move-row.chosen { background: var(--selection-bg, rgba(82, 188, 168, 0.14)); }

  .table-head {
    min-height: 28px;
    background: var(--surface-inset-bg);
    color: var(--text-muted);
    font-size: 9px;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .table-head span:first-child { text-align: left; }

  .move-name {
    min-width: 0;
    display: grid;
    gap: 5px;
  }

  .move-name > span {
    overflow-wrap: anywhere;
    font-weight: 700;
  }

  .move-name small { display: flex; flex-wrap: wrap; gap: 4px; }
  .move-name b {
    padding: 2px 5px;
    border-radius: 999px;
    font-size: 8px;
    text-transform: uppercase;
  }
  .policy-tag { background: rgba(217, 119, 46, 0.18); color: #dc8a4c; }
  .search-tag { background: var(--accent-soft); color: var(--accent-strong); }
  .muted-tag { background: var(--surface-inset-bg); color: var(--text-muted); }

  .perspective-note { color: var(--text-muted); font-size: 9px; }

  .chosen-line {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 7px;
  }

  .line-step {
    display: grid;
    gap: 4px;
    padding: 9px;
    border: 1px solid var(--surface-inset-border);
    border-radius: 6px;
    background: var(--surface-inset-bg);
  }
  .line-step small,
  .line-step span { color: var(--text-muted); font-size: 9px; }
  .line-step strong { font-size: 10px; overflow-wrap: anywhere; }

  .beliefs { display: grid; gap: 7px; }
  .beliefs > div { display: grid; grid-template-columns: 92px 1fr 38px; font-size: 10px; }
  .beliefs i { height: 7px; overflow: hidden; border-radius: 999px; background: var(--surface-inset-bg); }
  .beliefs i b { display: block; height: 100%; background: var(--accent-base); }
  .beliefs strong { text-align: right; }

  .legacy-summary {
    padding: 12px;
    border: 1px solid var(--warning-border, var(--surface-inset-border));
    border-radius: 7px;
    background: var(--surface-inset-bg);
  }
  .legacy-summary strong { font-size: 12px; }
  .legacy-summary span { color: var(--text-secondary); font-size: 11px; overflow-wrap: anywhere; }
  .legacy-summary small,
  .legacy-summary p { margin: 0; color: var(--text-muted); font-size: 10px; line-height: 1.4; }

  footer { padding-top: 3px; }

  @media (max-width: 760px) {
    .search-inspector {
      left: 10px;
      right: 10px;
      width: auto;
    }
    .move-table { overflow-x: auto; }
    .move-row { min-width: 480px; }
  }
</style>
