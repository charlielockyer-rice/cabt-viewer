<script lang="ts">
  import type {
    ReplayDecisionAnalysis,
    ReplaySearchAction,
    ReplaySearchContinuationRow,
  } from '../game/replayAnalysis';

  type Props = {
    analysis: ReplayDecisionAnalysis;
    seat0Name?: string;
    seat1Name?: string;
  };

  let {
    analysis,
    seat0Name = 'Player 1',
    seat1Name = 'Player 2',
  }: Props = $props();

  let inspector = $derived(analysis.searchInspector ?? null);
  let actorSeat = $derived(inspector?.actorSeat === 1 ? 1 : 0);
  let actorName = $derived(actorSeat === 0 ? seat0Name : seat1Name);
  let actions = $derived(sortedActions(inspector?.actions ?? []));
  let maxVisits = $derived(Math.max(1, ...actions.map((action) => count(action.visits))));
  let chosen = $derived(actions.find((action) => action.selected) ?? null);
  let continuation = $derived(inspector?.continuationSupport?.rows?.at(-1) ?? null);
  let policyPath = $derived((analysis.policySelection ?? []).map(selectionLabel));

  function sortedActions(rows: ReplaySearchAction[]): ReplaySearchAction[] {
    return [...rows].sort((left, right) => (
      Number(right.selected) - Number(left.selected)
      || count(right.visits) - count(left.visits)
      || count(right.prior) - count(left.prior)
    ));
  }

  function count(value: number | undefined): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
  }

  function pct(value: number | null | undefined): string {
    return typeof value === 'number' && Number.isFinite(value)
      ? `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%`
      : '—';
  }

  function actorValue(value: number | null | undefined): number | undefined {
    return typeof value === 'number' && Number.isFinite(value)
      ? (actorSeat === 0 ? value : 1 - value)
      : undefined;
  }

  function actionLabel(action: ReplaySearchAction): string {
    const labels = (action.optionIndexes ?? [])
      .map((index) => analysis.legalActions?.[index]?.label)
      .filter((label): label is string => !!label);
    return [...new Set(labels.map(cleanActionLabel))].join(' / ')
      || cleanActionLabel(action.label || '')
      || 'Recorded move';
  }

  function lineStepLabel(label: string | undefined): string {
    if (!label) {
      return 'Recorded continuation';
    }
    if (chosen?.label === label) {
      return actionLabel(chosen);
    }
    if (label.startsWith('SubmitSelection')) {
      return 'Submit selection';
    }
    return cleanActionLabel(label);
  }

  function cleanActionLabel(label: string): string {
    return label
      .replace(/ #\d+(?= from| to|$)/g, '')
      .replace(/ from (hand|deck|looking)\b.*$/i, '')
      .replace(/^SubmitSelection\(\)$/, 'Submit selection')
      .replace(/^Play\(card=(\d+)\)$/, 'Play card $1')
      .trim();
  }

  function matches(selection: number[] | undefined, action: ReplaySearchAction): boolean {
    if (!selection?.length || !action.optionIndexes?.length) {
      return false;
    }
    return action.optionIndexes.includes(selection[0]);
  }

  function selectionLabel(index: number): string {
    return cleanActionLabel(analysis.legalActions?.[index]?.label || `Option ${index}`);
  }

  function stopTitle(row: ReplaySearchContinuationRow | null): string {
    if (!row) {
      return inspector?.stopReason ? `Stopped: ${plainReason(inspector.stopReason)}` : 'Search endpoint';
    }
    return row.supported === false
      ? `Stopped before the next decision: ${plainReason(row.reason)}`
      : 'Chosen line reached its recorded endpoint';
  }

  function stopDetail(row: ReplaySearchContinuationRow | null): string {
    if (!row) {
      return '';
    }
    const visits = count(row.decisionVisits ?? row.nodeVisits);
    const required = count(row.requiredVisits);
    return required > 0 ? `${visits} visits here · ${required} required to continue` : `${visits} visits here`;
  }

  function plainReason(value: string | undefined): string {
    return (value || 'boundary').replaceAll('-', ' ');
  }
</script>

{#if inspector && actions.length}
  <section class="search-tree" aria-label="Search action tree">
    <div class="start-node">
      <small>START · {actorName} to act</small>
      <strong>{inspector.completedTraversals ?? analysis.completedTraversals ?? 0} searched turns</strong>
      <span>
        judge {pct(actorValue(inspector.rootNetworkValueSeat0))}
        → {pct(actorValue(inspector.rootSearchValueSeat0))}
      </span>
    </div>

    <div class="fanout" aria-label="Candidate actions">
      {#each actions as action}
        <div class:chosen={action.selected} class:policy={matches(analysis.policySelection, action)} class="candidate-node">
          <div class="candidate-heading">
            <strong>{actionLabel(action)}</strong>
            <span>
              {#if matches(analysis.policySelection, action)}<b class="policy-tag">POLICY</b>{/if}
              {#if action.selected}<b class="chosen-tag">CHOSEN</b>{/if}
              {#if !action.expanded}<b class="muted-tag">NOT OPENED</b>{/if}
            </span>
          </div>
          <div class="visit-track" aria-label={`${count(action.visits)} visits`}>
            <i style={`width:${(count(action.visits) / maxVisits) * 100}%`}></i>
          </div>
          <div class="metrics">
            <span>policy {pct(action.prior)}</span>
            <strong>{count(action.visits)} visits</strong>
            <span>judge {pct(action.qForActor)}</span>
          </div>
        </div>
      {/each}
    </div>

    {#if analysis.changed && policyPath.length > 1}
      <div class="policy-path">
        <small>POLICY PATH</small>
        <strong>{policyPath.join(' → ')}</strong>
      </div>
    {/if}

    {#if chosen}
      <div class="chosen-path">
        <small>SELECTED PATH</small>
        <strong>{actionLabel(chosen)}</strong>
        {#each inspector.principalLine?.slice(1) ?? [] as step}
          <i aria-hidden="true">↓</i>
          <strong>{lineStepLabel(step.label)}</strong>
        {/each}
        <i aria-hidden="true">↓</i>
        <div class="stop-node">
          <strong>{stopTitle(continuation)}</strong>
          {#if stopDetail(continuation)}<span>{stopDetail(continuation)}</span>{/if}
        </div>
      </div>
    {/if}
  </section>
{/if}

<style>
  .search-tree {
    display: grid;
    gap: 8px;
    color: var(--text-primary);
    font-variant-numeric: tabular-nums;
  }

  .start-node,
  .stop-node {
    display: grid;
    gap: 3px;
    padding: 7px 10px;
    border: 1px solid var(--surface-inset-border);
    border-radius: 7px;
    background: var(--surface-inset-bg);
  }

  .start-node {
    justify-self: center;
    min-width: 210px;
    text-align: center;
  }

  .start-node small,
  .chosen-path > small {
    color: var(--text-muted);
    font-size: 9px;
    font-weight: 850;
    letter-spacing: 0.05em;
  }

  .start-node strong { font-size: 13px; }
  .start-node span,
  .stop-node span { color: var(--text-secondary); font-size: 10px; }

  .fanout {
    position: relative;
    display: grid;
    gap: 4px;
    padding-left: 18px;
  }

  .fanout::before {
    content: '';
    position: absolute;
    top: -8px;
    bottom: 18px;
    left: 7px;
    width: 1px;
    background: var(--surface-inset-border);
  }

  .candidate-node {
    position: relative;
    display: grid;
    gap: 3px;
    padding: 5px 8px;
    border: 1px solid var(--surface-inset-border);
    border-radius: 7px;
    background: var(--app-bg);
  }

  .candidate-node::before {
    content: '';
    position: absolute;
    top: 16px;
    right: 100%;
    width: 12px;
    height: 1px;
    background: var(--surface-inset-border);
  }

  .candidate-node.chosen {
    border-color: var(--accent-base);
    background: var(--accent-soft);
  }

  .candidate-node.policy:not(.chosen) { border-color: #d68143; }

  .candidate-heading,
  .candidate-heading span,
  .metrics {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 7px;
  }

  .candidate-heading strong {
    min-width: 0;
    font-size: 10px;
    overflow-wrap: anywhere;
  }

  .policy-tag,
  .chosen-tag,
  .muted-tag {
    padding: 1px 4px;
    border-radius: 4px;
    font-size: 8px;
    white-space: nowrap;
  }

  .policy-tag { background: rgba(217, 119, 46, 0.18); color: #dc8a4c; }
  .chosen-tag { background: var(--accent-base); color: var(--button-text); }
  .muted-tag { background: var(--surface-inset-bg); color: var(--text-muted); }

  .visit-track {
    height: 3px;
    overflow: hidden;
    border-radius: 2px;
    background: var(--surface-inset-bg);
  }

  .visit-track i {
    display: block;
    height: 100%;
    background: var(--text-muted);
  }

  .chosen .visit-track i { background: var(--accent-base); }

  .metrics { color: var(--text-muted); font-size: 9px; }
  .metrics strong { color: var(--text-primary); font-size: 10px; }

  .chosen-path {
    justify-self: center;
    width: min(100%, 360px);
    display: grid;
    justify-items: center;
    gap: 3px;
    text-align: center;
  }

  .policy-path {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    color: #dc8a4c;
    font-size: 10px;
  }

  .policy-path small {
    font-size: 8px;
    font-weight: 850;
    letter-spacing: 0.05em;
  }

  .chosen-path > strong { font-size: 11px; }
  .chosen-path > i { color: var(--accent-base); font-style: normal; }
  .stop-node { width: 100%; border-color: var(--accent-base); }
  .stop-node strong { font-size: 11px; }
</style>
