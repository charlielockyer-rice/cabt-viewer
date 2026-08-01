<script lang="ts">
  import { onMount } from 'svelte';
  import {
    loadSearchedGames,
    refreshSearchedGameBank,
    type SearchedGame,
    type SearchedGameFacets,
    type SearchedGameResponse,
  } from '../gameBank/searchedGames';

  type Props = {
    busy?: boolean;
    initialSelectedGameId?: string;
    openGame: (game: SearchedGame) => void;
  };

  const pageSize = 150;
  const emptyFacets: SearchedGameFacets = {
    depths: [], models: [], decks: [], statuses: [], sources: [],
  };

  let { busy = false, initialSelectedGameId = '', openGame }: Props = $props();
  let games = $state<SearchedGame[]>([]);
  let facets = $state<SearchedGameFacets>(emptyFacets);
  let response = $state<SearchedGameResponse | null>(null);
  let selectedGameId = $state('');
  let queryInput = $state('');
  let query = $state('');
  let depth = $state('');
  let model = $state('');
  let deck = $state('');
  let status = $state('complete');
  let source = $state('');
  let sort = $state('newest');
  let randomNonce = $state('');
  let loading = $state(false);
  let refreshing = $state(false);
  let error = $state('');
  let requestId = 0;
  let hiddenCount = $derived(Math.max(0, (response?.total ?? 0) - games.length));
  let failedSources = $derived(
    Object.entries(response?.sources ?? {}).filter(([, value]) => !value.ok),
  );

  $effect(() => {
    selectedGameId = initialSelectedGameId;
  });

  onMount(() => {
    void loadPage(0);
  });

  async function loadPage(offset: number, append = false) {
    const id = ++requestId;
    loading = true;
    error = '';
    try {
      const next = await loadSearchedGames({
        q: query,
        depth,
        model,
        deck,
        status,
        source,
        sort,
        nonce: randomNonce,
        offset,
        limit: pageSize,
      });
      if (id !== requestId) {
        return;
      }
      response = next;
      facets = next.facets;
      games = append ? [...games, ...next.games] : next.games;
      if (next.refreshing && next.games.length === 0) {
        window.setTimeout(() => {
          if (id === requestId) {
            void loadPage(0);
          }
        }, 900);
      }
    } catch (reason) {
      if (id === requestId) {
        error = reason instanceof Error ? reason.message : String(reason);
      }
    } finally {
      if (id === requestId) {
        loading = false;
      }
    }
  }

  function applySearch(event: SubmitEvent) {
    event.preventDefault();
    query = queryInput.trim();
    void loadPage(0);
  }

  function filtersChanged() {
    if (sort === 'random') {
      randomNonce = String(Date.now());
    }
    void loadPage(0);
  }

  function shuffle() {
    sort = 'random';
    randomNonce = String(Date.now());
    void loadPage(0);
  }

  async function refreshBank() {
    refreshing = true;
    error = '';
    try {
      await refreshSearchedGameBank();
      const deadline = Date.now() + 120_000;
      while (Date.now() < deadline) {
        await new Promise((resolve) => window.setTimeout(resolve, 900));
        const next = await loadSearchedGames({
          q: query, depth, model, deck, status, source, sort,
          nonce: randomNonce, limit: pageSize,
        });
        response = next;
        facets = next.facets;
        games = next.games;
        if (!next.refreshing) {
          return;
        }
      }
      throw new Error('Game-bank refresh did not finish within two minutes.');
    } catch (reason) {
      error = reason instanceof Error ? reason.message : String(reason);
    } finally {
      refreshing = false;
    }
  }

  function chooseGame(game: SearchedGame) {
    selectedGameId = game.id;
    openGame(game);
  }

  function matchup(game: SearchedGame): string {
    return game.decks.map((entry) => entry.family_name).join(' vs ');
  }

  function winner(game: SearchedGame): string {
    if (game.winner_seat === 0 || game.winner_seat === 1) {
      return game.decks[game.winner_seat]?.family_name ?? `Seat ${game.winner_seat + 1}`;
    }
    return 'Draw';
  }

  function formatDuration(seconds: number): string {
    if (!Number.isFinite(seconds) || seconds <= 0) {
      return '—';
    }
    if (seconds < 60) {
      return `${seconds.toFixed(0)}s`;
    }
    return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
  }

  function formatBytes(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes <= 0) {
      return '—';
    }
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }

  function shortId(value: string): string {
    return value.split(':').at(-1) ?? value;
  }
</script>

<div class="game-bank-browser">
  <div class="bank-summary">
    <span>
      <strong>{(response?.total ?? 0).toLocaleString()}</strong>
      matching games
    </span>
    <span>
      {(response?.availableSources ?? 0)}/{response?.configuredSources ?? 0} sources available
    </span>
    {#if response?.refreshedAt}
      <span>Indexed {new Date(response.refreshedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
    {/if}
    <button type="button" disabled={refreshing} onclick={refreshBank}>
      {refreshing || response?.refreshing ? 'Indexing...' : 'Refresh bank'}
    </button>
  </div>

  <form class="bank-toolbar" onsubmit={applySearch}>
    <label class="search-field">
      <span>Search</span>
      <input bind:value={queryInput} placeholder="Matchup, game, model..." />
    </label>

    <label>
      <span>Search level</span>
      <select bind:value={depth} onchange={filtersChanged}>
        <option value="">Any depth</option>
        {#each facets.depths as value}
          <option value={String(value)}>{value}</option>
        {/each}
      </select>
    </label>

    <label>
      <span>Deck</span>
      <select bind:value={deck} onchange={filtersChanged}>
        <option value="">Any deck</option>
        {#each facets.decks as value}
          <option value={value.id}>{value.name}</option>
        {/each}
      </select>
    </label>

    <label>
      <span>Model</span>
      <select bind:value={model} onchange={filtersChanged}>
        <option value="">Any model</option>
        {#each facets.models as value}
          <option value={value}>{value}</option>
        {/each}
      </select>
    </label>

    <label>
      <span>Quality</span>
      <select bind:value={status} onchange={filtersChanged}>
        <option value="">Any status</option>
        {#each facets.statuses as value}
          <option value={value}>{value === 'complete' ? 'Healthy' : value}</option>
        {/each}
      </select>
    </label>

    <label>
      <span>Source</span>
      <select bind:value={source} onchange={filtersChanged}>
        <option value="">Any box</option>
        {#each facets.sources as value}
          <option value={value}>{value}</option>
        {/each}
      </select>
    </label>

    <label>
      <span>Sort</span>
      <select bind:value={sort} onchange={filtersChanged}>
        <option value="newest">Newest</option>
        <option value="depth">Deepest</option>
        <option value="longest">Longest games</option>
        <option value="changes">Most plan mismatches</option>
        <option value="random">Random</option>
      </select>
    </label>

    <button type="submit" disabled={loading}>Search</button>
    <button type="button" disabled={loading} onclick={shuffle}>Random game</button>
  </form>

  {#if failedSources.length > 0}
    <details class="source-warning">
      <summary>{failedSources.length} source{failedSources.length === 1 ? '' : 's'} unavailable; cached games remain listed when possible</summary>
      {#each failedSources as [name, value]}
        <span><strong>{name}</strong>: {value.error}</span>
      {/each}
    </details>
  {/if}

  {#if error}
    <pre class="error">{error}</pre>
  {:else if loading && games.length === 0}
    <p class="empty">{response?.refreshing ? 'Indexing the searched-game bank...' : 'Loading searched games...'}</p>
  {:else if games.length === 0}
    <p class="empty">No searched games match these filters.</p>
  {:else}
    <div class="game-list">
      <div class="game-header" aria-hidden="true">
        <span>Search</span>
        <span>Matchup</span>
        <span>Winner</span>
        <span>Steps</span>
        <span>Plan mismatch</span>
        <span>Time</span>
        <span>Source</span>
        <span>Game</span>
      </div>
      {#each games as game}
        <button
          type="button"
          aria-current={selectedGameId === game.id ? 'true' : undefined}
          class:selected={selectedGameId === game.id}
          disabled={busy}
          onclick={() => chooseGame(game)}
        >
          <span class="depth"><strong>{game.search_depth}</strong><small>{game.model_dtype.toUpperCase()}</small></span>
          <span class="matchup"><strong>{matchup(game)}</strong><small>{game.model_name}</small></span>
          <span><strong>{winner(game)}</strong><small>{game.is_mirror ? 'Mirror' : game.status === 'complete' ? 'Healthy' : game.status}</small></span>
          <span><strong>{game.steps.toLocaleString()}</strong><small>engine steps</small></span>
          <span><strong>{game.changed_decisions}</strong><small>actual ≠ planned</small></span>
          <span><strong>{formatDuration(game.wall_s)}</strong><small>{formatBytes(game.episode_bytes)}</small></span>
          <span><strong>{game.source}</strong><small>{game.created_utc.slice(0, 10)}</small></span>
          <span><strong>{shortId(game.game_uid)}</strong><small>Open replay</small></span>
        </button>
      {/each}
    </div>
    {#if hiddenCount > 0}
      <button
        class="show-more"
        type="button"
        disabled={loading}
        onclick={() => void loadPage(games.length, true)}
      >
        {loading ? 'Loading...' : `Show ${Math.min(pageSize, hiddenCount).toLocaleString()} more of ${(response?.total ?? 0).toLocaleString()}`}
      </button>
    {/if}
  {/if}
</div>

<style>
  .game-bank-browser {
    display: grid;
    min-width: 0;
    gap: 12px;
  }

  .bank-summary {
    display: flex;
    align-items: center;
    gap: 14px;
    min-height: 38px;
    color: var(--text-secondary);
    font-size: 13px;
  }

  .bank-summary strong {
    color: var(--text-primary);
  }

  .bank-summary button {
    margin-left: auto;
  }

  .bank-toolbar {
    display: grid;
    grid-template-columns: minmax(180px, 1.4fr) repeat(6, minmax(105px, 0.7fr)) auto auto;
    gap: 9px;
    align-items: end;
  }

  label {
    display: grid;
    gap: 5px;
    color: var(--text-secondary);
    font-size: 12px;
    font-weight: 900;
  }

  input,
  select {
    min-width: 0;
    min-height: 38px;
    border: 1px solid var(--input-border);
    border-radius: 8px;
    background: var(--input-bg);
    color: var(--input-text);
    padding: 0 10px;
    font: inherit;
  }

  .source-warning {
    border: 1px solid color-mix(in srgb, var(--warning, #d69e2e) 46%, transparent);
    border-radius: 8px;
    padding: 9px 11px;
    color: var(--text-secondary);
    font-size: 12px;
  }

  .source-warning summary {
    cursor: pointer;
    font-weight: 800;
  }

  .source-warning span {
    display: block;
    margin-top: 5px;
  }

  .game-list {
    display: grid;
    min-width: 0;
    overflow: hidden;
    border: 1px solid var(--surface-inset-border);
    border-radius: 10px;
    background: var(--surface-inset-bg);
  }

  .game-header,
  .game-list > button {
    display: grid;
    grid-template-columns: 72px minmax(260px, 1.8fr) minmax(145px, 1fr) 76px 84px 92px 94px minmax(112px, 0.7fr);
    gap: 10px;
    align-items: center;
    text-align: left;
  }

  .game-header {
    padding: 9px 12px;
    color: var(--text-muted);
    font-size: 10px;
    font-weight: 900;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .game-list > button {
    width: 100%;
    min-height: 58px;
    padding: 8px 12px;
    border: 0;
    border-top: 1px solid var(--surface-inset-border);
    border-radius: 0;
    background: transparent;
    color: var(--text-primary);
  }

  .game-list > button:hover,
  .game-list > button.selected {
    background: var(--button-bg);
  }

  .game-list span {
    display: grid;
    min-width: 0;
    gap: 2px;
  }

  .game-list strong,
  .game-list small {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .game-list strong {
    font-size: 12px;
  }

  .game-list small {
    color: var(--text-muted);
    font-size: 10px;
  }

  .depth strong {
    color: var(--accent-text, var(--text-primary));
    font-size: 18px;
  }

  .show-more {
    justify-self: center;
  }

  .empty {
    color: var(--text-secondary);
    text-align: center;
    padding: 36px 12px;
  }

  .error {
    margin: 0;
    white-space: pre-wrap;
  }

  @media (max-width: 1250px) {
    .bank-toolbar {
      grid-template-columns: repeat(4, minmax(120px, 1fr));
    }

    .search-field {
      grid-column: span 2;
    }

    .game-list {
      overflow-x: auto;
    }

    .game-header,
    .game-list > button {
      min-width: 1050px;
    }
  }
</style>
