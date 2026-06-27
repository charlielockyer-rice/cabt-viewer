<script lang="ts">
  import { onMount } from 'svelte';
  import {
    inferredKaggleEpisodeRatingRange,
    loadKaggleEpisodeDays,
    loadKaggleEpisodesForDay,
    type KaggleEpisodeDay,
    type KaggleEpisodeSummary,
  } from '../kaggle/episodes';

  type Props = {
    busy?: boolean;
    initialSelectedEpisodeId?: string;
    initialSelectedSlug?: string;
    openEpisode: (day: KaggleEpisodeDay, episode: KaggleEpisodeSummary) => void;
  };

  const largeReplayWarningBytes = 50 * 1024 * 1024;
  const initialEpisodeRenderCount = 150;
  const episodeRenderBatchSize = 150;

  let {
    busy = false,
    initialSelectedEpisodeId = '',
    initialSelectedSlug = '',
    openEpisode,
  }: Props = $props();
  let days = $state<KaggleEpisodeDay[]>([]);
  let episodes = $state<KaggleEpisodeSummary[]>([]);
  let selectedSlug = $state('');
  let selectedEpisodeId = $state('');
  let selectedEpisodeSlug = $state('');
  let loadedSlug = $state('');
  let loadingDays = $state(false);
  let loadingEpisodes = $state(false);
  let error = $state('');
  let minAvgScore = $state('');
  let maxSizeMb = $state('');
  let sortKey = $state<'rank' | 'score' | 'time' | 'size'>('rank');
  let restoredInitialSelection = $state(false);
  let visibleEpisodeCount = $state(initialEpisodeRenderCount);
  let episodeRequestId = 0;
  let dayOptions = $derived(days.slice().sort((left, right) => right.date.localeCompare(left.date)));
  let selectedDay = $derived(dayOptions.find((day) => day.slug === selectedSlug));
  let filteredEpisodes = $derived(sortedEpisodes(episodes).filter(episodeVisible));
  let visibleEpisodes = $derived(filteredEpisodes.slice(0, visibleEpisodeCount));
  let hiddenEpisodeCount = $derived(Math.max(0, filteredEpisodes.length - visibleEpisodes.length));
  let episodeListKey = $derived(`${selectedSlug}|${minAvgScore}|${maxSizeMb}|${sortKey}`);
  let loading = $derived(loadingDays || loadingEpisodes);

  onMount(() => {
    void refreshDays();
  });

  $effect(() => {
    if (restoredInitialSelection) {
      return;
    }
    restoredInitialSelection = true;
    if (initialSelectedSlug) {
      selectedSlug = initialSelectedSlug;
    }
    if (initialSelectedEpisodeId) {
      selectedEpisodeId = initialSelectedEpisodeId;
      selectedEpisodeSlug = initialSelectedSlug;
    }
  });

  $effect(() => {
    if (!selectedSlug || selectedSlug === loadedSlug) {
      return;
    }
    void refreshEpisodes(selectedSlug);
  });

  $effect(() => {
    episodeListKey;
    visibleEpisodeCount = initialEpisodeRenderCount;
  });

  $effect(() => {
    if (selectedEpisodeId && selectedEpisodeSlug && selectedSlug !== selectedEpisodeSlug) {
      selectedEpisodeId = '';
      selectedEpisodeSlug = '';
    }
  });

  async function refreshDays() {
    loadingDays = true;
    error = '';
    try {
      const nextDays = await loadKaggleEpisodeDays();
      days = nextDays;
      const latest = nextDays.slice().sort((left, right) => right.date.localeCompare(left.date))[0];
      if (latest && !nextDays.some((day) => day.slug === selectedSlug)) {
        selectedSlug = latest.slug;
      }
    } catch (reason) {
      error = reason instanceof Error ? reason.message : String(reason);
    } finally {
      loadingDays = false;
    }
  }

  async function refreshEpisodes(slug: string) {
    const requestId = ++episodeRequestId;
    loadingEpisodes = true;
    error = '';
    episodes = [];
    loadedSlug = '';
    try {
      const nextEpisodes = await loadKaggleEpisodesForDay(slug);
      if (requestId !== episodeRequestId || selectedSlug !== slug) {
        return;
      }
      episodes = nextEpisodes;
      loadedSlug = slug;
    } catch (reason) {
      if (requestId !== episodeRequestId) {
        return;
      }
      error = reason instanceof Error ? reason.message : String(reason);
      episodes = [];
      loadedSlug = '';
    } finally {
      if (requestId === episodeRequestId) {
        loadingEpisodes = false;
      }
    }
  }

  function reloadSelectedDay() {
    loadedSlug = '';
  }

  function chooseEpisode(episode: KaggleEpisodeSummary) {
    if (!selectedDay || loadingEpisodes || selectedSlug !== loadedSlug) {
      return;
    }
    if (episode.sizeBytes >= largeReplayWarningBytes && !confirm(`Load ${formatBytes(episode.sizeBytes)} replay ${episode.episodeId}?`)) {
      return;
    }
    selectedEpisodeId = episode.episodeId;
    selectedEpisodeSlug = selectedDay.slug;
    openEpisode(selectedDay, episode);
  }

  function sortedEpisodes(source: KaggleEpisodeSummary[]): KaggleEpisodeSummary[] {
    const next = source.slice();
    if (sortKey === 'score') {
      return next.sort((left, right) => right.avgScore - left.avgScore);
    }
    if (sortKey === 'time') {
      return next.sort((left, right) => right.createTime.localeCompare(left.createTime));
    }
    if (sortKey === 'size') {
      return next.sort((left, right) => right.sizeBytes - left.sizeBytes);
    }
    return next.sort((left, right) => left.dailyRank - right.dailyRank);
  }

  function episodeVisible(episode: KaggleEpisodeSummary): boolean {
    const minScore = Number(minAvgScore);
    if (Number.isFinite(minScore) && minAvgScore.trim() && episode.avgScore < minScore) {
      return false;
    }
    const maxBytes = Number(maxSizeMb) * 1024 * 1024;
    if (Number.isFinite(maxBytes) && maxSizeMb.trim() && episode.sizeBytes > maxBytes) {
      return false;
    }
    return true;
  }

  function formatScore(score: number): string {
    return Number.isFinite(score) ? score.toFixed(1) : '0.0';
  }

  function formatBytes(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes <= 0) {
      return '0 MB';
    }
    const mb = bytes / 1024 / 1024;
    if (mb < 1024) {
      return `${mb.toFixed(mb >= 10 ? 0 : 1)} MB`;
    }
    return `${(mb / 1024).toFixed(1)} GB`;
  }

  function formatDateTime(value: string): string {
    return value.replace('T', ' ').replace(/\.\d+$/, '');
  }

  function formatDate(value: string): string {
    return formatDateTime(value).split(' ')[0] ?? '';
  }

  function formatTime(value: string): string {
    return (formatDateTime(value).split(' ')[1] ?? '').replace(/:\d+$/, '');
  }
</script>

<div class="kaggle-browser">
  <div class="kaggle-toolbar">
    <label>
      <span>Date</span>
      <select bind:value={selectedSlug} disabled={loadingDays || dayOptions.length === 0}>
        {#each dayOptions as day}
          <option value={day.slug}>{day.date}</option>
        {/each}
      </select>
    </label>

    <label>
      <span>Sort</span>
      <select bind:value={sortKey}>
        <option value="rank">Rank</option>
        <option value="score">Avg rating</option>
        <option value="time">Newest</option>
        <option value="size">Size</option>
      </select>
    </label>

    <label>
      <span>Min avg</span>
      <input bind:value={minAvgScore} inputmode="decimal" placeholder="Any" />
    </label>

    <label>
      <span>Max MB</span>
      <input bind:value={maxSizeMb} inputmode="numeric" placeholder="Any" />
    </label>

    <button type="button" disabled={loading} onclick={selectedSlug ? reloadSelectedDay : refreshDays}>
      {loading ? 'Loading...' : 'Refresh'}
    </button>
  </div>

  {#if selectedDay}
    <div class="day-summary">
      <strong>{selectedDay.episodeCount.toLocaleString()} episodes</strong>
      <span>{formatBytes(selectedDay.totalBytes)}</span>
      <span>Top {formatScore(selectedDay.topAvgScore)}</span>
      <span>Median {formatScore(selectedDay.medianAvgScore)}</span>
    </div>
  {/if}

  {#if error}
    <pre class="error">{error}</pre>
  {:else if loadingDays && days.length === 0}
    <p class="empty">Loading Kaggle dates...</p>
  {:else if loadingEpisodes && episodes.length === 0}
    <p class="empty">Loading episodes...</p>
  {:else if filteredEpisodes.length === 0}
    <p class="empty">No episodes match the current filters.</p>
  {:else}
    <div class="episode-list">
      <div class="episode-header" aria-hidden="true">
        <span>Rank</span>
        <span>Match ID</span>
        <span>Avg</span>
        <span>High</span>
        <span>Low</span>
        <span>Gap</span>
        <span>Date</span>
        <span>Time</span>
        <span>Size</span>
      </div>
      {#each visibleEpisodes as episode}
        {@const ratingRange = inferredKaggleEpisodeRatingRange(episode)}
        {@const ratingGap = Math.abs(ratingRange.higher - ratingRange.lower)}
        <button
          type="button"
          aria-current={episode.episodeId === selectedEpisodeId ? 'true' : undefined}
          class:selected={episode.episodeId === selectedEpisodeId}
          disabled={busy || loadingEpisodes || selectedSlug !== loadedSlug}
          onclick={() => chooseEpisode(episode)}
        >
          <span class="rank">#{episode.dailyRank}</span>
          <span class="episode-main">
            <strong>{episode.episodeId}</strong>
          </span>
          <span class="episode-avg metric">
            <small>Avg</small>
            <strong>{formatScore(episode.avgScore)}</strong>
          </span>
          <span class="episode-rating-high metric">
            <small>High</small>
            <strong>{formatScore(ratingRange.higher)}</strong>
          </span>
          <span class="episode-rating-low metric">
            <small>Low</small>
            <strong>{formatScore(ratingRange.lower)}</strong>
          </span>
          <span class="episode-gap metric">
            <small>Gap</small>
            <strong>{formatScore(ratingGap)}</strong>
          </span>
          <span class="episode-date">
            <small>Date</small>
            <strong>{formatDate(episode.createTime)}</strong>
          </span>
          <span class="episode-time">
            <small>Time</small>
            <strong>{formatTime(episode.createTime)}</strong>
          </span>
          <span class="episode-size">
            <small>Size</small>
            <strong>{formatBytes(episode.sizeBytes)}</strong>
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
</div>

<style>
  .kaggle-browser {
    display: grid;
    min-width: 0;
    gap: 12px;
  }

  .kaggle-toolbar {
    display: grid;
    grid-template-columns: minmax(150px, 1.15fr) minmax(120px, 0.8fr) minmax(96px, 0.65fr) minmax(96px, 0.65fr) auto;
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

  .episode-list {
    --episode-table-columns: 64px minmax(116px, 1.3fr) minmax(82px, 0.7fr) minmax(92px, 0.8fr) minmax(92px, 0.8fr) minmax(82px, 0.7fr) minmax(116px, 0.95fr) minmax(78px, 0.65fr) minmax(92px, 0.75fr);
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

  .metric small,
  .episode-date small,
  .episode-time small,
  .episode-size small {
    display: none;
  }

  .rank {
    color: var(--text-primary);
    font-weight: 900;
    font-variant-numeric: tabular-nums;
  }

  .metric,
  .episode-date,
  .episode-time,
  .episode-size {
    justify-items: start;
    text-align: left;
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
    .kaggle-toolbar {
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
      grid-template-columns: 52px minmax(0, 1fr);
      grid-template-areas:
        "rank main"
        "avg avg"
        "rating-low rating-high"
        "gap gap"
        "date date"
        "time time"
        "size size";
      align-items: start;
      gap: 6px 10px;
      min-height: 180px;
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

    .rank {
      grid-area: rank;
    }

    .episode-main {
      grid-area: main;
    }

    .episode-avg,
    .episode-rating-low,
    .episode-rating-high,
    .episode-gap,
    .episode-date,
    .episode-time,
    .episode-size {
      justify-items: start;
      text-align: left;
    }

    .metric small,
    .episode-date small,
    .episode-time small,
    .episode-size small {
      display: block;
    }

    .episode-avg {
      grid-area: avg;
    }

    .episode-rating-low {
      grid-area: rating-low;
    }

    .episode-rating-high {
      grid-area: rating-high;
    }

    .episode-gap {
      grid-area: gap;
    }

    .episode-date {
      grid-area: date;
    }

    .episode-time {
      grid-area: time;
    }

    .episode-size {
      grid-area: size;
    }
  }
</style>
