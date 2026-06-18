<script lang="ts">
  import type { AgentOption, GameLogEntry } from '../home/catalog';

  type HomeMode = 'play' | 'logs';

  type Props = {
    homeMode: HomeMode;
    deck1Text: string;
    deck2Text: string;
    selectedAgentId: string;
    agents?: AgentOption[];
    gameLogs?: GameLogEntry[];
    busy?: boolean;
    catalogBusy?: boolean;
    error?: string;
    catalogError?: string;
    setHomeMode: (mode: HomeMode) => void;
    startGame: () => void;
    loadGameLog: (log: GameLogEntry) => void;
    refreshCatalog: () => void;
  };

  let {
    homeMode,
    deck1Text = $bindable(),
    deck2Text = $bindable(),
    selectedAgentId = $bindable(),
    agents = [],
    gameLogs = [],
    busy = false,
    catalogBusy = false,
    error = '',
    catalogError = '',
    setHomeMode,
    startGame,
    loadGameLog,
    refreshCatalog,
  }: Props = $props();

  let selectedAgent = $derived(agents.find((agent) => agent.id === selectedAgentId) ?? agents[0]);

  function logPlayerLabel(log: GameLogEntry): string {
    return log.players?.length ? log.players.join(' vs ') : 'AI vs AI';
  }
</script>

<section class="import-screen">
  <div class="home-tabs" role="tablist" aria-label="Home mode">
    <button class:active={homeMode === 'play'} type="button" onclick={() => setHomeMode('play')}>Play</button>
    <button class:active={homeMode === 'logs'} type="button" onclick={() => setHomeMode('logs')}>Game logs</button>
  </div>

  {#if homeMode === 'play'}
    <div class="play-controls">
      <label>
        AI opponent
        <select bind:value={selectedAgentId} disabled={busy || agents.length === 0}>
          {#each agents as agent}
            <option value={agent.id}>{agent.name}</option>
          {/each}
        </select>
      </label>
      {#if selectedAgent?.description}
        <span class="agent-detail">{selectedAgent.description}</span>
      {/if}
    </div>

    <div class="deck-import two-column">
      <label>
        Your deck
        <textarea bind:value={deck1Text} spellcheck="false"></textarea>
      </label>
      <label>
        AI opponent deck
        <textarea bind:value={deck2Text} spellcheck="false"></textarea>
      </label>
    </div>
    <button class="primary" disabled={busy || !selectedAgentId} onclick={startGame}>
      {busy ? 'Starting...' : 'Start game'}
    </button>
    {#if error}
      <pre class="error">{error}</pre>
    {/if}
  {:else}
    <div class="log-toolbar">
      <strong>Game logs</strong>
      <button type="button" disabled={catalogBusy} onclick={refreshCatalog}>
        {catalogBusy ? 'Refreshing...' : 'Refresh'}
      </button>
    </div>

    {#if catalogError || error}
      <pre class="error">{catalogError || error}</pre>
    {/if}

    {#if catalogBusy && gameLogs.length === 0}
      <p class="empty">Loading game logs...</p>
    {:else if gameLogs.length === 0}
      <p class="empty">No game logs found in <code>public/game-logs</code>.</p>
    {:else}
      <div class="log-list">
        {#each gameLogs as log}
          <button type="button" disabled={busy} onclick={() => loadGameLog(log)}>
            <span>
              <strong>{log.name}</strong>
              <small>{logPlayerLabel(log)}</small>
            </span>
            <span>
              {#if log.createdAt}
                <small>{log.createdAt}</small>
              {/if}
              <small>{log.file}</small>
            </span>
          </button>
        {/each}
      </div>
    {/if}
  {/if}
</section>

<style>
  .import-screen {
    min-height: 100vh;
    display: grid;
    gap: 14px;
    align-content: start;
    padding: 92px 24px 24px;
  }

  .home-tabs {
    justify-self: center;
    display: inline-grid;
    grid-template-columns: repeat(2, minmax(96px, 1fr));
    gap: 4px;
    padding: 4px;
    border-radius: 8px;
    border: 1px solid var(--surface-inset-border);
    background: var(--surface-inset-bg);
  }

  .home-tabs button {
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--text-secondary);
  }

  .home-tabs button.active {
    background: var(--button-bg);
    color: var(--button-text);
    box-shadow: var(--surface-toolbar-shadow);
  }

  .play-controls,
  .log-toolbar {
    display: flex;
    align-items: end;
    justify-content: space-between;
    gap: 12px;
  }

  .play-controls label {
    display: grid;
    gap: 8px;
    min-width: min(360px, 100%);
    color: var(--text-primary);
    font-weight: 800;
  }

  .agent-detail {
    max-width: 560px;
    color: var(--text-secondary);
    font-size: 13px;
    text-align: right;
  }

  .deck-import {
    display: grid;
    gap: 16px;
  }

  .deck-import.two-column {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .deck-import label {
    display: grid;
    gap: 8px;
    color: var(--text-primary);
    font-weight: 800;
  }

  textarea {
    width: 100%;
    min-height: 54vh;
    resize: vertical;
    border-radius: 8px;
    border: 1px solid var(--input-border);
    background: var(--input-bg);
    color: var(--input-text);
    padding: 12px;
  }

  select {
    min-height: 40px;
    border-radius: 8px;
    border: 1px solid var(--input-border);
    background: var(--input-bg);
    color: var(--input-text);
    padding: 0 12px;
  }

  .log-toolbar strong {
    font-size: 16px;
  }

  .log-list {
    display: grid;
    gap: 8px;
    max-height: min(72vh, 820px);
    overflow: auto;
  }

  .log-list button {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(140px, auto);
    gap: 12px;
    align-items: center;
    min-height: 58px;
    border-radius: 8px;
    text-align: left;
    background: var(--button-bg);
  }

  .log-list span {
    display: grid;
    min-width: 0;
    gap: 2px;
  }

  .log-list strong,
  .log-list small {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .log-list small {
    color: var(--text-secondary);
    font-size: 12px;
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
    .deck-import.two-column,
    .log-list button {
      grid-template-columns: 1fr;
    }

    .play-controls,
    .log-toolbar {
      align-items: stretch;
      flex-direction: column;
    }

    .agent-detail {
      text-align: left;
    }
  }
</style>
