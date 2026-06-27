<script lang="ts">
  import KaggleEpisodeBrowser from './KaggleEpisodeBrowser.svelte';
  import type { AgentOption, GameLogEntry } from '../home/catalog';
  import type { PlayerControl } from '../game/httpClient';
  import type { KaggleEpisodeDay, KaggleEpisodeSummary } from '../kaggle/episodes';

  type HomeMode = 'play' | 'logs';
  type LogSource = 'local' | 'kaggle';

  type Props = {
    homeMode: HomeMode;
    deck1Text: string;
    deck2Text: string;
    player1Control: PlayerControl;
    player2Control: PlayerControl;
    player1AgentId: string;
    player2AgentId: string;
    player1DeckSource: string;
    player2DeckSource: string;
    agents?: AgentOption[];
    gameLogs?: GameLogEntry[];
    player1DeckLocked?: boolean;
    player2DeckLocked?: boolean;
    player1AgentHasPairedDeck?: boolean;
    player2AgentHasPairedDeck?: boolean;
    busy?: boolean;
    catalogBusy?: boolean;
    error?: string;
    catalogError?: string;
    kaggleSelectedEpisodeId?: string;
    kaggleSelectedSlug?: string;
    setHomeMode: (mode: HomeMode) => void;
    startGame: () => void;
    loadGameLog: (log: GameLogEntry) => void;
    loadKaggleEpisode: (day: KaggleEpisodeDay, episode: KaggleEpisodeSummary) => void;
    refreshCatalog: () => void;
  };

  let {
    homeMode,
    deck1Text = $bindable(),
    deck2Text = $bindable(),
    player1Control = $bindable(),
    player2Control = $bindable(),
    player1AgentId = $bindable(),
    player2AgentId = $bindable(),
    player1DeckSource = $bindable(),
    player2DeckSource = $bindable(),
    agents = [],
    gameLogs = [],
    player1DeckLocked = false,
    player2DeckLocked = false,
    player1AgentHasPairedDeck = false,
    player2AgentHasPairedDeck = false,
    busy = false,
    catalogBusy = false,
    error = '',
    catalogError = '',
    kaggleSelectedEpisodeId = '',
    kaggleSelectedSlug = '',
    setHomeMode,
    startGame,
    loadGameLog,
    loadKaggleEpisode,
    refreshCatalog,
  }: Props = $props();

  let logSource = $state<LogSource>('kaggle');
  let deckOptions = $derived(agents.filter((agent) => !!agent.deckUrl));
  let startDisabled = $derived(
    busy
      || (player1Control === 'agent' && !player1AgentId)
      || (player2Control === 'agent' && !player2AgentId),
  );

  function logPlayerLabel(log: GameLogEntry): string {
    return log.players?.length ? log.players.join(' vs ') : 'AI vs AI';
  }

  function setPlayerControl(playerIndex: 0 | 1, control: PlayerControl) {
    if (playerIndex === 0) {
      player1Control = control;
    } else {
      player2Control = control;
    }
  }
</script>

<section class="import-screen" class:logs-mode={homeMode === 'logs'}>
  <div class="home-tabs" role="tablist" aria-label="Home mode">
    <button class:active={homeMode === 'play'} type="button" onclick={() => setHomeMode('play')}>Play</button>
    <button class:active={homeMode === 'logs'} type="button" onclick={() => setHomeMode('logs')}>Game logs</button>
  </div>

  {#if homeMode === 'play'}
    <div class="deck-import two-column">
      <div class="player-config">
        <span class="deck-label-row">
          Player 1
        </span>
        <span class="control-tabs" role="tablist" aria-label="Player 1 control">
          <button
            type="button"
            role="tab"
            aria-selected={player1Control === 'self'}
            class:active={player1Control === 'self'}
            disabled={busy}
            onclick={() => setPlayerControl(0, 'self')}
          >Self</button>
          <button
            type="button"
            role="tab"
            aria-selected={player1Control === 'agent'}
            class:active={player1Control === 'agent'}
            disabled={busy}
            onclick={() => setPlayerControl(0, 'agent')}
          >Agent</button>
        </span>
        <span class:self-only={player1Control === 'self'} class="setup-fields">
          {#if player1Control === 'agent'}
            <span class="field-row">
              <span>Agent</span>
              <select
                bind:value={player1AgentId}
                disabled={busy || agents.length === 0}
                aria-label="Player 1 agent"
              >
                {#each agents as agent}
                  <option value={agent.id}>{agent.name}</option>
                {/each}
              </select>
            </span>
          {/if}
          <span class="field-row">
            <span>Deck</span>
            <select
              bind:value={player1DeckSource}
              disabled={busy || player1AgentHasPairedDeck}
              aria-label="Player 1 deck"
            >
              <option value="import">Import deck</option>
              {#each deckOptions as agent}
                <option value={agent.id}>{agent.name}</option>
              {/each}
            </select>
          </span>
        </span>
        <textarea
          bind:value={deck1Text}
          aria-label="Player 1 deck list"
          readonly={player1DeckLocked}
          class:locked={player1DeckLocked}
          spellcheck="false"
        ></textarea>
      </div>
      <div class="player-config">
        <span class="deck-label-row">
          Player 2
        </span>
        <span class="control-tabs" role="tablist" aria-label="Player 2 control">
          <button
            type="button"
            role="tab"
            aria-selected={player2Control === 'self'}
            class:active={player2Control === 'self'}
            disabled={busy}
            onclick={() => setPlayerControl(1, 'self')}
          >Self</button>
          <button
            type="button"
            role="tab"
            aria-selected={player2Control === 'agent'}
            class:active={player2Control === 'agent'}
            disabled={busy}
            onclick={() => setPlayerControl(1, 'agent')}
          >Agent</button>
        </span>
        <span class:self-only={player2Control === 'self'} class="setup-fields">
          {#if player2Control === 'agent'}
            <span class="field-row">
              <span>Agent</span>
              <select
                bind:value={player2AgentId}
                disabled={busy || agents.length === 0}
                aria-label="Player 2 agent"
              >
                {#each agents as agent}
                  <option value={agent.id}>{agent.name}</option>
                {/each}
              </select>
            </span>
          {/if}
          <span class="field-row">
            <span>Deck</span>
            <select
              bind:value={player2DeckSource}
              disabled={busy || player2AgentHasPairedDeck}
              aria-label="Player 2 deck"
            >
              <option value="import">Import deck</option>
              {#each deckOptions as agent}
                <option value={agent.id}>{agent.name}</option>
              {/each}
            </select>
          </span>
        </span>
        <textarea
          bind:value={deck2Text}
          aria-label="Player 2 deck list"
          readonly={player2DeckLocked}
          class:locked={player2DeckLocked}
          spellcheck="false"
        ></textarea>
      </div>
    </div>
    <button class="primary" disabled={startDisabled} onclick={startGame}>
      {busy ? 'Starting...' : 'Start game'}
    </button>
    {#if error}
      <pre class="error">{error}</pre>
    {/if}
  {:else}
    <div class="log-toolbar">
      <strong>Game logs</strong>
      <span class="source-tabs" role="tablist" aria-label="Replay source">
        <button
          type="button"
          role="tab"
          aria-selected={logSource === 'kaggle'}
          class:active={logSource === 'kaggle'}
          onclick={() => {
            logSource = 'kaggle';
          }}
        >Kaggle archive</button>
        <button
          type="button"
          role="tab"
          aria-selected={logSource === 'local'}
          class:active={logSource === 'local'}
          onclick={() => {
            logSource = 'local';
          }}
        >Local logs</button>
      </span>
    </div>

    {#if logSource === 'kaggle'}
      <KaggleEpisodeBrowser
        busy={busy}
        initialSelectedEpisodeId={kaggleSelectedEpisodeId}
        initialSelectedSlug={kaggleSelectedSlug}
        openEpisode={loadKaggleEpisode}
      />
    {:else}
      <div class="local-log-toolbar">
        <span></span>
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
    justify-self: stretch;
    display: inline-grid;
    grid-template-columns: repeat(2, minmax(96px, 1fr));
    gap: 4px;
    padding: 4px;
    border-radius: 8px;
    border: 1px solid var(--surface-inset-border);
    background: var(--surface-inset-bg);
    box-shadow: var(--surface-toolbar-shadow);
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

  .log-toolbar {
    display: flex;
    align-items: end;
    justify-content: space-between;
    gap: 12px;
  }

  .source-tabs {
    display: inline-grid;
    grid-template-columns: repeat(2, minmax(112px, 1fr));
    gap: 4px;
    padding: 4px;
    border-radius: 8px;
    border: 1px solid var(--surface-inset-border);
    background: var(--surface-inset-bg);
  }

  .source-tabs button {
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--text-secondary);
    font-weight: 900;
  }

  .source-tabs button.active {
    background: var(--button-bg);
    color: var(--button-text);
    box-shadow: var(--surface-toolbar-shadow);
  }

  .local-log-toolbar {
    display: flex;
    justify-content: space-between;
    gap: 12px;
  }

  .deck-import {
    display: grid;
    gap: 16px;
  }

  .deck-import.two-column {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .player-config {
    display: grid;
    gap: 8px;
    color: var(--text-primary);
    font-weight: 800;
  }

  .deck-label-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .control-tabs {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 4px;
    padding: 4px;
    border-radius: 8px;
    border: 1px solid var(--surface-inset-border);
    background: var(--surface-inset-bg);
  }

  .control-tabs button {
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--text-secondary);
    font-weight: 900;
  }

  .control-tabs button.active {
    background: var(--button-bg);
    color: var(--button-text);
    box-shadow: var(--surface-toolbar-shadow);
  }

  .setup-fields {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 10px;
    min-height: 40px;
  }

  .setup-fields.self-only {
    grid-template-columns: 1fr;
  }

  .field-row {
    display: grid;
    grid-template-columns: 52px minmax(0, 1fr);
    align-items: center;
    gap: 8px;
    color: var(--text-secondary);
    font-size: 12px;
    font-weight: 900;
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

  textarea.locked {
    background: var(--surface-inset-bg);
    color: var(--text-secondary);
    cursor: default;
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

    .log-toolbar {
      align-items: stretch;
      flex-direction: column;
    }

    .source-tabs {
      width: 100%;
    }
  }
</style>
