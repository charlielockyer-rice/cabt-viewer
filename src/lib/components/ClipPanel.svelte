<script lang="ts">
  import ClipMarkdown from './ClipMarkdown.svelte';
  import { clipMarkdownPreview } from '../clips/clipMarkdown';
  import { clipReplayViewerUrl, type ClipCompareLine, type ClipItem } from '../clips/clipFormat';
  import { clipOptionLabel } from '../clips/clipOptions';
  import type { ReplayDecisionAnalysis, ReplaySearchAction } from '../game/replayAnalysis';
  import { clipStore, isClipSeekable } from '../../state/clip.svelte';
  import { replayStore } from '../../state/replay.svelte';

  // The panel reads the clip and replay stores directly: it is a view of the
  // one clip selection, and threading a dozen props through App for it would
  // put the tour's logic in the app shell instead of here.
  let clip = $derived(clipStore.clip);
  let items = $derived(clipStore.items);
  let selectedIndex = $derived(clipStore.selectedIndex);
  let selected = $derived(clipStore.selectedItem);
  let selectedSeekable = $derived(clipStore.selectedSeekableItem);
  // Numbers only count the positions; notes are prose between them.
  let itemNumbers = $derived(numberItems(items));
  let analysis = $derived(analysisAt(selectedSeekable?.state));
  let focusLabels = $derived((selectedSeekable?.focusOptions ?? []).map((index) => ({
    index,
    label: optionLabel(selectedSeekable?.state, index),
  })));
  let copied = $state(false);

  // The copy confirmation belongs to one item's link, not to the panel.
  $effect(() => {
    selectedIndex;
    copied = false;
  });

  function numberItems(list: ClipItem[]): Array<number | null> {
    let position = 0;
    return list.map((item) => {
      if (!isClipSeekable(item)) {
        return null;
      }
      position += 1;
      return position;
    });
  }

  function analysisAt(stateIndex: number | undefined): ReplayDecisionAnalysis | null {
    if (stateIndex === undefined) {
      return null;
    }
    return replayStore.decisionAnalyses.find((entry) => entry.stateIndex === stateIndex) ?? null;
  }

  // Named by the recording's own action labels when it has them, otherwise by
  // what the frame's raw select points at.
  function optionLabel(stateIndex: number | undefined, optionIndex: number): string {
    if (stateIndex === undefined) {
      return `Option ${optionIndex}`;
    }
    return analysisAt(stateIndex)?.legalActions?.[optionIndex]?.label
      || clipOptionLabel(replayStore.observationFrames[stateIndex]?.select, optionIndex)
      || `Option ${optionIndex}`;
  }

  // The author names a line by its option indexes; the recording names the
  // same move by the option indexes the searcher expanded. Same set, same
  // move — that is the whole join.
  function searchActionFor(line: ClipCompareLine): ReplaySearchAction | null {
    const wanted = line.optionIndexes;
    if (!wanted?.length) {
      return null;
    }
    return analysis?.searchInspector?.actions?.find((action) =>
      sameIndexSet(action.optionIndexes, wanted)
    ) ?? null;
  }

  function sameIndexSet(left: number[] | undefined, right: number[]): boolean {
    if (!left || left.length !== right.length) {
      return false;
    }
    return right.every((index) => left.includes(index));
  }

  function lineOptionLabels(line: ClipCompareLine): string {
    return (line.optionIndexes ?? [])
      .map((index) => optionLabel(selectedSeekable?.state, index))
      .join(' + ');
  }

  function pct(value: number | null | undefined): string {
    return typeof value === 'number' && Number.isFinite(value)
      ? `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%`
      : '—';
  }

  function itemPreview(item: ClipItem): string {
    if (item.kind === 'position' || item.kind === 'compare') {
      return clipMarkdownPreview(item.caption);
    }
    return '';
  }

  function itemHeading(item: ClipItem): string {
    if (item.kind === 'compare') {
      return `Compare · state ${item.state}`;
    }
    if (item.kind === 'position') {
      return `Position · state ${item.state}`;
    }
    return 'Unsupported item';
  }

  function replayLink(): string {
    if (!selectedSeekable || typeof window === 'undefined') {
      return '';
    }
    return clipReplayViewerUrl(window.location.href, selectedSeekable);
  }

  async function copyClipLink() {
    if (typeof navigator === 'undefined' || !navigator.clipboard || typeof window === 'undefined') {
      return;
    }
    await navigator.clipboard.writeText(window.location.href);
    copied = true;
  }
</script>

<aside class="clip-panel" aria-label="Clip">
  {#if clipStore.loading}
    <p class="clip-status">Loading clip…</p>
  {:else if clipStore.error}
    <div class="clip-status error">
      <strong>Clip unavailable</strong>
      <span>{clipStore.error}</span>
    </div>
  {:else if clip}
    <header>
      <strong>{clip.title}</strong>
      <span>
        {[clip.author, clip.created].filter(Boolean).join(' · ')}
        · {items.length} {items.length === 1 ? 'item' : 'items'}
      </span>
    </header>

    {#if clip.summary}
      <div class="clip-summary"><ClipMarkdown markdown={clip.summary} /></div>
    {/if}

    <ol class="clip-items">
      {#each items as item, index}
        <li>
          {#if item.kind === 'note'}
            <div class:selected={index === selectedIndex} class="clip-note">
              <ClipMarkdown markdown={item.markdown} />
            </div>
          {:else}
            <button
              type="button"
              class:selected={index === selectedIndex}
              aria-current={index === selectedIndex}
              onclick={() => void clipStore.selectItem(index)}
            >
              <b>{itemNumbers[index]}</b>
              <span>
                <strong>{itemHeading(item)}</strong>
                {#if itemPreview(item)}
                  <small>{itemPreview(item)}</small>
                {/if}
              </span>
            </button>
          {/if}
        </li>
      {/each}
    </ol>

    <!-- Notes are already the list's own prose; only the stops get a detail
         section under it. -->
    {#if selected && selected.kind !== 'note'}
      <section class="clip-detail" aria-label="Clip item detail">
        {#if selected.kind === 'unsupported'}
          <p class="clip-status">
            This item uses <code>{selected.originalKind}</code>, which this viewer build does not render.
          </p>
        {:else}
          <div class="detail-heading">
            <strong>{itemHeading(selected)}</strong>
            {#if selected.exact}<i class="mode-tag">Exact decisions</i>{/if}
          </div>

          {#if selected.caption}
            <ClipMarkdown markdown={selected.caption} />
          {/if}

          {#if focusLabels.length}
            <div class="focus-options">
              <small>Focus</small>
              <div>
                {#each focusLabels as focus}
                  <span title={`Option ${focus.index}`}>{focus.label}</span>
                {/each}
              </div>
            </div>
          {/if}

          {#if selected.kind === 'compare'}
            <div class="line-table" role="table" aria-label="Compared lines">
              <div class="line-row table-head" role="row">
                <span>Line</span><span>Policy</span><span>Visits</span><span>Q</span>
              </div>
              {#each selected.lines as line}
                {@const action = searchActionFor(line)}
                <div class="line-row" role="row">
                  <div class="line-name">
                    <span>{line.label}</span>
                    {#if line.role}<i class={`role-tag role-${line.role}`}>{line.role}</i>{/if}
                    {#if line.optionIndexes?.length}
                      <small class="line-options">{lineOptionLabels(line)}</small>
                    {/if}
                    {#if line.note}
                      <div class="line-note"><ClipMarkdown markdown={line.note} /></div>
                    {/if}
                  </div>
                  <span>{pct(action?.prior)}</span>
                  <span>{action?.visits ?? '—'}</span>
                  <span>{pct(action?.qForActor)}</span>
                </div>
              {/each}
            </div>
            {#if !analysis?.searchInspector?.actions?.length}
              <small class="clip-hint">This recording has no search weights at state {selected.state}; the author's lines are shown on their own.</small>
            {/if}
          {/if}

          <div class="detail-actions">
            <a href={replayLink()} target="_blank" rel="noreferrer noopener">Open full replay</a>
            <button type="button" onclick={() => void copyClipLink()}>
              {copied ? 'Link copied' : 'Copy link'}
            </button>
          </div>
        {/if}
      </section>
    {/if}

    <footer class="clip-hint">↑ ↓ item · ← → step · space play</footer>
  {:else}
    <p class="clip-status">No clip loaded.</p>
  {/if}
</aside>

<style>
  .clip-panel {
    position: absolute;
    top: 54px;
    right: calc(var(--board-right-rail) - var(--clip-panel-w, 340px) - 8px);
    bottom: calc(var(--replay-dock-h, 48px) + var(--replay-eval-h, 64px) + 10px);
    z-index: 30;
    width: var(--clip-panel-w, 340px);
    overflow-y: auto;
    display: grid;
    align-content: start;
    gap: 12px;
    padding: 12px;
    border: 1px solid var(--surface-toolbar-border);
    border-radius: 9px;
    background: var(--app-bg);
    color: var(--text-primary);
    box-shadow: 0 18px 48px rgba(0, 0, 0, 0.28);
    font-size: 12px;
  }

  header {
    display: grid;
    gap: 3px;
  }

  header strong {
    font-size: 15px;
    overflow-wrap: anywhere;
  }

  header span {
    color: var(--text-muted);
    font-size: 10px;
  }

  .clip-summary {
    color: var(--text-secondary);
    font-size: 11px;
  }

  .clip-note {
    padding-left: 8px;
    border-left: 2px solid var(--surface-inset-border);
    color: var(--text-secondary);
    font-size: 11px;
  }

  .clip-note.selected {
    border-left-color: var(--accent-base);
    color: var(--text-primary);
  }

  .clip-status {
    margin: 0;
    color: var(--text-muted);
    font-size: 11px;
  }

  .clip-status.error {
    display: grid;
    gap: 4px;
    padding: 10px;
    border: 1px solid var(--danger-border);
    border-radius: 7px;
    background: var(--danger-bg);
    color: var(--danger-strong);
    overflow-wrap: anywhere;
  }

  .clip-items {
    display: grid;
    gap: 6px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .clip-items button {
    width: 100%;
    display: grid;
    grid-template-columns: 22px minmax(0, 1fr);
    gap: 8px;
    align-items: start;
    padding: 8px;
    border: 1px solid var(--surface-inset-border);
    border-radius: 7px;
    background: var(--surface-inset-bg);
    color: var(--text-primary);
    text-align: left;
  }

  .clip-items button.selected {
    border-color: var(--accent-base);
    background: var(--accent-soft);
  }

  .clip-items b {
    display: grid;
    place-items: center;
    min-height: 18px;
    border-radius: 999px;
    background: var(--button-bg);
    color: var(--button-text);
    font-size: 9px;
  }

  .clip-items span {
    display: grid;
    gap: 3px;
    min-width: 0;
  }

  .clip-items strong {
    font-size: 11px;
  }

  .clip-items small {
    color: var(--text-muted);
    font-size: 10px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .clip-detail {
    display: grid;
    gap: 9px;
    padding-top: 11px;
    border-top: 1px solid var(--surface-inset-border);
  }

  .detail-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .detail-heading strong {
    font-size: 12px;
  }

  .mode-tag,
  .role-tag {
    padding: 2px 5px;
    border-radius: 999px;
    background: var(--surface-inset-bg);
    color: var(--text-muted);
    font-size: 8px;
    font-style: normal;
    text-transform: uppercase;
  }

  .role-played { background: var(--accent-soft); color: var(--accent-strong); }
  .role-policy { background: rgba(217, 119, 46, 0.18); color: #dc8a4c; }
  .role-search { background: rgba(82, 133, 188, 0.18); color: #6ba0d8; }

  .focus-options {
    display: grid;
    gap: 4px;
  }

  .focus-options small {
    color: var(--text-muted);
    font-size: 9px;
    text-transform: uppercase;
  }

  .focus-options div {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }

  .focus-options span {
    padding: 3px 7px;
    border: 1px solid var(--surface-inset-border);
    border-radius: 999px;
    background: var(--surface-inset-bg);
    font-size: 10px;
  }

  .line-table {
    display: grid;
    overflow: hidden;
    border: 1px solid var(--surface-inset-border);
    border-radius: 7px;
  }

  .line-row {
    display: grid;
    grid-template-columns: minmax(110px, 1fr) 42px 40px 42px;
    align-items: start;
    border-top: 1px solid var(--surface-inset-border);
    font-size: 10px;
    font-variant-numeric: tabular-nums;
  }

  .line-row:first-child { border-top: 0; }
  .line-row > * { padding: 6px; }
  .line-row > span { color: var(--text-secondary); text-align: right; }

  .table-head {
    background: var(--surface-inset-bg);
    color: var(--text-muted);
    font-size: 9px;
    font-weight: 800;
    text-transform: uppercase;
  }

  .table-head span:first-child { text-align: left; }

  .line-name {
    min-width: 0;
    display: grid;
    gap: 4px;
    justify-items: start;
  }

  .line-name > span {
    font-weight: 700;
    overflow-wrap: anywhere;
  }

  .line-options,
  .line-note {
    color: var(--text-muted);
    font-size: 9px;
    overflow-wrap: anywhere;
  }

  .detail-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .detail-actions a,
  .detail-actions button {
    min-height: 28px;
    display: inline-flex;
    align-items: center;
    padding: 0 10px;
    border: 1px solid var(--button-border);
    border-radius: 6px;
    background: var(--button-bg);
    color: var(--button-text);
    font-size: 11px;
    font-weight: 800;
    text-decoration: none;
  }

  .clip-hint {
    color: var(--text-muted);
    font-size: 9px;
  }

  /* Below the breakpoint the rail is back to its normal width, so the panel
     floats over the board while still clearing the replay details rail. */
  @media (max-width: 1180px) {
    .clip-panel {
      right: calc(var(--board-right-rail) + 10px);
      width: min(340px, calc(100% - var(--board-right-rail) - 34px));
    }
  }
</style>
