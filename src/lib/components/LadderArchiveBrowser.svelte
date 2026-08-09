<script lang="ts">
  import { onMount } from 'svelte';
  import {
    loadLadderDays,
    loadLadderEpisodes,
    type LadderDay,
    type LadderEpisode,
  } from '../gameBank/ladderLibrary';

  type Props = {
    busy?: boolean;
    initialSelectedDay?: string;
    initialSelectedEpisodeId?: string;
    openEpisode: (day: string, episode: LadderEpisode) => void;
  };

  const largeReplayWarningBytes = 50 * 1024 * 1024;
  const initialEpisodeRenderCount = 150;
  const episodeRenderBatchSize = 150;

  let {
    busy = false,
    initialSelectedDay = '',
    initialSelectedEpisodeId = '',
    openEpisode,
  }: Props = $props();

  let days = $state<LadderDay[]>([]);
  let episodes = $state<LadderEpisode[]>([]);
  let library = $state('');
  let unavailableReason = $state('');
  let selectedDay = $state('');
  let selectedEpisodeId = $state('');
  let selectedEpisodeDay = $state('');
  let loadedDay = $state('');
  let loadingDays = $state(false);
  let loadingEpisodes = $state(false);
  let error = $state('');
  let teamFilter = $state('');
  let sortKey = $state<'newest' | 'longest' | 'size'>('newest');
  let restoredInitialSelection = $state(false);
  let visibleEpisodeCount = $state(initialEpisodeRenderCount);
  let episodeRequestId = 0;

  let dayOptions = $derived(days.slice().sort((left, right) => right.day.localeCompare(left.day)));
  let selectedDayRow = $derived(dayOptions.find((day) => day.day === selectedDay));
  let filteredEpisodes = $derived(sortedEpisodes(episodes).filter(episodeVisible));
  let visibleEpisodes = $derived(filteredEpisodes.slice(0, visibleEpisodeCount));
  let hiddenEpisodeCount = $derived(Math.max(0, filteredEpisodes.length - visibleEpisodes.length));
  let episodeListKey = $derived(`${selectedDay}|${teamFilter}|${sortKey}`);
  let loading = $derived(loadingDays || loadingEpisodes);

  onMount(() => {
    void refreshDays();
  });

  $effect(() => {
    if (restoredInitialSelection) {
      return;
    }
    restoredInitialSelection = true;
    if (initialSelectedDay) {
      selectedDay = initialSelectedDay;
    }
    if (initialSelectedEpisodeId) {
      selectedEpisodeId = initialSelectedEpisodeId;
      selectedEpisodeDay = initialSelectedDay;
    }
  });

  $effect(() => {
    if (!selectedDay || selectedDay === loadedDay || unavailableReason) {
      return;
    }
    void refreshEpisodes(selectedDay);
  });

  $effect(() => {
    episodeListKey;
    visibleEpisodeCount = initialEpisodeRenderCount;
  });

  $effect(() => {
    if (selectedEpisodeId && selectedEpisodeDay && selectedDay !== selectedEpisodeDay) {
      selectedEpisodeId = '';
      selectedEpisodeDay = '';
    }
  });

  async function refreshDays() {
    loadingDays = true;
    error = '';
    try {
      const response = await loadLadderDays();
      days = response.days;
      library = response.library;
      unavailableReason = response.available ? '' : response.reason || 'The ladder archive is not available.';
      if (!response.available) {
        episodes = [];
        loadedDay = '';
      }
      const latest = response.days.slice().sort((left, right) => right.day.localeCompare(left.day))[0];
      if (latest && !response.days.some((day) => day.day === selectedDay)) {
        selectedDay = latest.day;
      }
    } catch (reason) {
      error = reason instanceof Error ? reason.message : String(reason);
    } finally {
      loadingDays = false;
    }
  }

  async function refreshEpisodes(day: string) {
    const requestId = ++episodeRequestId;
    loadingEpisodes = true;
    error = '';
    episodes = [];
    loadedDay = '';
    try {
      const response = await loadLadderEpisodes(day);
      if (requestId !== episodeRequestId || selectedDay !== day) {
        return;
      }
      if (!response.available) {
        unavailableReason = response.reason || 'The ladder archive is not available.';
        return;
      }
      episodes = response.episodes;
      loadedDay = day;
    } catch (reason) {
      if (requestId !== episodeRequestId) {
        return;
      }
      error = reason instanceof Error ? reason.message : String(reason);
      episodes = [];
      loadedDay = '';
    } finally {
      if (requestId === episodeRequestId) {
        loadingEpisodes = false;
      }
    }
  }

  function reload() {
    loadedDay = '';
    void refreshDays();
  }

  function chooseEpisode(episode: LadderEpisode) {
    if (!selectedDay || loadingEpisodes || selectedDay !== loadedDay) {
      return;
    }
    const bytes = episode.rawBytes ?? 0;
    if (bytes >= largeReplayWarningBytes && !confirm(`Load ${formatBytes(bytes)} replay ${episode.id}?`)) {
      return;
    }
    selectedEpisodeId = episode.id;
    selectedEpisodeDay = selectedDay;
    openEpisode(selectedDay, episode);
  }

  function sortedEpisodes(source: LadderEpisode[]): LadderEpisode[] {
    const next = source.slice();
    if (sortKey === 'longest') {
      return next.sort((left, right) => (right.steps ?? 0) - (left.steps ?? 0));
    }
    if (sortKey === 'size') {
      return next.sort((left, right) => (right.rawBytes ?? 0) - (left.rawBytes ?? 0));
    }
    return next.sort((left, right) => right.id.localeCompare(left.id, undefined, { numeric: true }));
  }

  function episodeVisible(episode: LadderEpisode): boolean {
    const needle = teamFilter.trim().toLowerCase();
    if (!needle) {
      return true;
    }
    return [episode.team0, episode.team1, episode.id]
      .some((value) => (value ?? '').toLowerCase().includes(needle));
  }

  function teamLabel(team: string | null): string {
    return team ?? 'Unknown';
  }

  function resultLabel(episode: LadderEpisode): string {
    const { reward0, reward1 } = episode;
    if (reward0 === null || reward1 === null) {
      return '-';
    }
    if (reward0 === reward1) {
      return 'Draw';
    }
    return reward0 > reward1 ? teamLabel(episode.team0) : teamLabel(episode.team1);
  }

  function formatSteps(steps: number | null): string {
    return steps === null ? '-' : steps.toLocaleString();
  }

  function formatBytes(bytes: number | null): string {
    if (bytes === null || !Number.isFinite(bytes) || bytes <= 0) {
      return '-';
    }
    const mb = bytes / 1024 / 1024;
    if (mb < 1) {
      return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    }
    if (mb < 1024) {
      return `${mb.toFixed(mb >= 10 ? 0 : 1)} MB`;
    }
    return `${(mb / 1024).toFixed(1)} GB`;
  }
</script>

<div class="ladder-browser">
  <div class="ladder-toolbar">
    <label>
      <span>Date</span>
      <select bind:value={selectedDay} disabled={loadingDays || dayOptions.length === 0}>
        {#each dayOptions as day}
          <option value={day.day}>{day.day}</option>
        {/each}
      </select>
    </label>

    <label>
      <span>Sort</span>
      <select bind:value={sortKey}>
        <option value="newest">Newest</option>
        <option value="longest">Longest</option>
        <option value="size">Size</option>
      </select>
    </label>

    <label>
      <span>Team</span>
      <input bind:value={teamFilter} placeholder="Any team or id" />
    </label>

    <button type="button" disabled={loading} onclick={reload}>
      {loading ? 'Loading...' : 'Refresh'}
    </button>
  </div>

  {#if unavailableReason}
    <div class="notice">
      <strong>No local ladder archive.</strong>
      <span>{unavailableReason}</span>
      <small>
        The beelink archiver mirrors ladder episodes to <code>{library || '~/cabt-library'}</code>.
        Point <code>CABT_LADDER_LIBRARY</code> at the mirror, or use the Kaggle archive tab instead.
      </small>
    </div>
  {:else}
    {#if selectedDayRow}
      <div class="day-summary">
        <strong>{selectedDayRow.episodes.toLocaleString()} episodes</strong>
        <span>{selectedDayRow.day}</span>
        {#if library}<span>{library}</span>{/if}
      </div>
    {/if}

    {#if error}
      <pre class="error">{error}</pre>
    {:else if loadingDays && days.length === 0}
      <p class="empty">Loading archived dates...</p>
    {:else if loadingEpisodes && episodes.length === 0}
      <p class="empty">Loading episodes...</p>
    {:else if filteredEpisodes.length === 0}
      <p class="empty">No archived episodes match the current filters.</p>
    {:else}
      <div class="episode-list">
        <div class="episode-header" aria-hidden="true">
          <span>Match ID</span>
          <span>Player 1</span>
          <span>Player 2</span>
          <span>Winner</span>
          <span>Steps</span>
          <span>Size</span>
        </div>
        {#each visibleEpisodes as episode}
          <button
            type="button"
            aria-current={episode.id === selectedEpisodeId ? 'true' : undefined}
            class:selected={episode.id === selectedEpisodeId}
            disabled={busy || loadingEpisodes || selectedDay !== loadedDay}
            onclick={() => chooseEpisode(episode)}
          >
            <span class="episode-main">
              <strong>{episode.id}</strong>
            </span>
            <span class="episode-team">
              <small>Player 1</small>
              <strong>{teamLabel(episode.team0)}</strong>
            </span>
            <span class="episode-team">
              <small>Player 2</small>
              <strong>{teamLabel(episode.team1)}</strong>
            </span>
            <span class="episode-result">
              <small>Winner</small>
              <strong>{resultLabel(episode)}</strong>
            </span>
            <span class="episode-steps">
              <small>Steps</small>
              <strong>{formatSteps(episode.steps)}</strong>
            </span>
            <span class="episode-size">
              <small>Size</small>
              <strong>{formatBytes(episode.rawBytes)}</strong>
            </span>
          </button>
        {/each}
      </div>
      {#if hiddenEpisodeCount > 0}
        <button
          class="show-more"
          type="button"
          onclick={() => {
            visibleEpisodeCount += episodeRenderBatchSize;
          }}
        >
          Show {Math.min(episodeRenderBatchSize, hiddenEpisodeCount).toLocaleString()} more of {filteredEpisodes.length.toLocaleString()}
        </button>
      {/if}
    {/if}
  {/if}
</div>

<style>
  .ladder-browser {
    display: grid;
    min-width: 0;
    gap: 12px;
  }

  .ladder-toolbar {
    display: grid;
    grid-template-columns: minmax(150px, 1.15fr) minmax(120px, 0.8fr) minmax(140px, 1fr) auto;
    gap: 10px;
    align-items: end;
  }

  label {
    display: grid;
    gap: 5px;
    color: var(--text-secondary);
    font-size: 12px;
    font-weight: 900;
  }

  select,
  input {
    min-width: 0;
    min-height: 38px;
    border: 1px solid var(--input-border);
    border-radius: 8px;
    background: var(--input-bg);
    color: var(--input-text);
    padding: 0 10px;
    font: inherit;
  }

  button {
    min-height: 38px;
  }

  .day-summary {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 14px;
    color: var(--text-secondary);
    font-size: 12px;
    font-weight: 800;
  }

  .day-summary strong {
    color: var(--text-primary);
  }

  .notice {
    display: grid;
    gap: 6px;
    padding: 14px;
    border: 1px solid var(--surface-inset-border);
    border-radius: 8px;
    background: var(--surface-inset-bg);
  }

  .notice strong {
    font-size: 13px;
  }

  .notice span {
    color: var(--text-secondary);
    font-size: 12px;
    line-height: 1.5;
  }

  .notice small {
    color: var(--text-muted);
    font-size: 11px;
    line-height: 1.5;
    overflow-wrap: anywhere;
  }

  code {
    padding: 1px 4px;
    border-radius: 4px;
    background: var(--app-bg);
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.92em;
  }

  .episode-list {
    --episode-table-columns: minmax(116px, 1fr) minmax(120px, 1.2fr) minmax(120px, 1.2fr) minmax(120px, 1.2fr) minmax(78px, 0.6fr) minmax(88px, 0.65fr);
    display: grid;
    justify-self: center;
    width: min(100%, 1120px);
    min-width: 0;
    align-content: start;
    gap: 0;
  }

  .episode-header,
  .episode-list button {
    display: grid;
    grid-template-columns: var(--episode-table-columns);
    gap: 0;
    align-items: center;
  }

  .episode-header {
    position: sticky;
    top: 0;
    z-index: 1;
    min-height: 30px;
    border: 1px solid var(--surface-toolbar-border);
    border-radius: 8px 8px 0 0;
    background: var(--app-bg);
    color: var(--text-secondary);
    font-size: 11px;
    font-weight: 900;
    text-transform: uppercase;
  }

  .episode-list button {
    position: relative;
    padding: 0;
    min-height: 54px;
    border-color: var(--surface-inset-border);
    border-top: 0;
    border-radius: 0;
    text-align: left;
    background: var(--button-bg);
  }

  .episode-list button:last-child {
    border-radius: 0 0 8px 8px;
  }

  .episode-list button.selected {
    z-index: 2;
  }

  .episode-list button:hover:not(:disabled) {
    z-index: 3;
    border-color: var(--surface-inset-border);
  }

  .episode-list button::after {
    content: '';
    position: absolute;
    inset: -1px;
    pointer-events: none;
    border: 2px solid transparent;
    border-radius: inherit;
  }

  .episode-list button.selected::after {
    border-color: var(--accent-base);
  }

  .episode-list button:hover:not(:disabled)::after {
    border-color: var(--button-hover-border);
  }

  .episode-list span {
    display: grid;
    align-content: center;
    align-self: stretch;
    min-width: 0;
    gap: 2px;
    padding: 0 10px;
  }

  .episode-header span + span,
  .episode-list button span + span {
    border-left: 1px solid var(--surface-inset-border);
  }

  .episode-list strong,
  .episode-list small {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .episode-list strong {
    font-size: 13px;
  }

  .episode-list small {
    color: var(--text-secondary);
    font-size: 11px;
  }

  .episode-team small,
  .episode-result small,
  .episode-steps small,
  .episode-size small {
    display: none;
  }

  .episode-main strong {
    font-weight: 900;
    font-variant-numeric: tabular-nums;
  }

  .episode-steps,
  .episode-size {
    font-variant-numeric: tabular-nums;
  }

  .show-more {
    justify-self: center;
    min-width: min(260px, 100%);
    font-weight: 900;
  }

  .empty {
    margin: 0;
    color: var(--text-muted);
    font-size: 13px;
  }

  .error {
    margin: 0;
    padding: 12px;
    border-radius: 8px;
    background: var(--danger-bg);
    border: 1px solid var(--danger-border);
    color: var(--danger-strong);
    white-space: pre-wrap;
  }

  @media (max-width: 980px) {
    .ladder-toolbar {
      grid-template-columns: 1fr;
    }

    .episode-header {
      display: none;
    }

    .episode-list {
      width: 100%;
      gap: 6px;
    }

    .episode-list button {
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      grid-template-areas:
        "main main"
        "team0 team1"
        "result result"
        "steps size";
      align-items: start;
      gap: 6px 10px;
      min-height: 140px;
      padding: 10px;
      border: 1px solid var(--button-border);
      border-radius: 7px;
    }

    .episode-list span {
      align-self: auto;
      padding: 0;
    }

    .episode-list button span + span {
      border-left: 0;
    }

    .episode-team small,
    .episode-result small,
    .episode-steps small,
    .episode-size small {
      display: block;
    }

    .episode-main {
      grid-area: main;
    }

    .episode-team:nth-of-type(2) {
      grid-area: team0;
    }

    .episode-team:nth-of-type(3) {
      grid-area: team1;
    }

    .episode-result {
      grid-area: result;
    }

    .episode-steps {
      grid-area: steps;
    }

    .episode-size {
      grid-area: size;
    }
  }
</style>
