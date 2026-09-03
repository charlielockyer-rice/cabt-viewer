<script lang="ts">
  import { onMount } from 'svelte';
  import { loadQuickPlayConfig, type QuickPlayConfig } from '../home/catalog';

  // The hosted landing screen: a friend sees who they are about to play and
  // presses one button. Everything else (bot, decks) is preconfigured by the
  // engine server, and the decks re-roll on every load.
  type Props = {
    busy?: boolean;
    startError?: string;
    startQuickGame: (config: QuickPlayConfig) => void;
  };

  let { busy = false, startError = '', startQuickGame }: Props = $props();

  let config = $state<QuickPlayConfig | null>(null);
  let loading = $state(true);
  let error = $state('');

  onMount(() => {
    void load();
  });

  async function load() {
    loading = true;
    error = '';
    try {
      config = await loadQuickPlayConfig();
    } catch (failure) {
      config = null;
      error = failure instanceof Error ? failure.message : String(failure);
    } finally {
      loading = false;
    }
  }
</script>

<section class="import-screen">
  <div class="quick-play">
    {#if loading}
      <p class="empty">Loading the matchup...</p>
    {:else if error || !config}
      <h1>Quick play unavailable</h1>
      <pre class="error">{error || 'The quick play matchup is not configured.'}</pre>
      <button class="primary" type="button" onclick={() => void load()}>Retry</button>
    {:else}
      <h1>Play vs {config.agent.name}</h1>
      {#if config.agent.description}
        <p class="description">{config.agent.description}</p>
      {/if}
      <p class="decks">You: {config.playerDeck.name} &middot; Bot: {config.botDeck.name}</p>
      <button class="primary start" type="button" disabled={busy} onclick={() => startQuickGame(config)}>
        {busy ? 'Starting...' : 'Start game'}
      </button>
      {#if startError}
        <pre class="error">{startError}</pre>
      {/if}
    {/if}
  </div>
</section>

<style>
  .import-screen {
    min-height: 100vh;
    display: grid;
    align-content: center;
    justify-content: center;
    padding: 92px 24px 24px;
  }

  .quick-play {
    display: grid;
    gap: 14px;
    justify-items: start;
    width: min(520px, calc(100vw - 48px));
    padding: 24px;
    border-radius: 8px;
    border: 1px solid var(--surface-inset-border);
    background: var(--surface-inset-bg);
    box-shadow: var(--surface-toolbar-shadow);
  }

  h1 {
    margin: 0;
    color: var(--text-primary);
    font-size: 28px;
    line-height: 1.1;
  }

  .description {
    margin: 0;
    color: var(--text-secondary);
    font-size: 14px;
  }

  .decks {
    margin: 0;
    color: var(--text-muted);
    font-size: 13px;
    font-weight: 900;
  }

  .start {
    min-height: 48px;
    padding: 0 28px;
    font-size: 16px;
  }

  .empty {
    margin: 0;
    color: var(--text-muted);
    font-size: 13px;
  }

  .error {
    justify-self: stretch;
    margin: 0;
    padding: 12px;
    border-radius: 8px;
    background: var(--danger-bg);
    border: 1px solid var(--danger-border);
    color: var(--danger-strong);
    white-space: pre-wrap;
  }
</style>
