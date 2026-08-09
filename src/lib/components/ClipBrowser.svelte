<script lang="ts">
  import { onMount } from 'svelte';
  import { loadClipManifest, type ClipManifestEntry } from '../clips/clipFormat';

  type Props = {
    busy?: boolean;
    openClip: (entry: ClipManifestEntry) => void;
  };

  let { busy = false, openClip }: Props = $props();

  let clips = $state<ClipManifestEntry[]>([]);
  let loading = $state(false);
  let error = $state('');
  let loaded = $state(false);

  onMount(() => {
    void refresh();
  });

  async function refresh() {
    loading = true;
    error = '';
    try {
      clips = (await loadClipManifest()).clips;
    } catch (cause) {
      // A missing manifest is the normal state before any agent has written a
      // clip, so it reads as "none yet" rather than as a failure.
      clips = [];
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      loading = false;
      loaded = true;
    }
  }

  function metaLabel(entry: ClipManifestEntry): string {
    return [
      entry.author,
      entry.created,
      entry.items === undefined ? '' : `${entry.items} ${entry.items === 1 ? 'item' : 'items'}`,
    ].filter(Boolean).join(' · ');
  }
</script>

<div class="clip-toolbar">
  <span></span>
  <button type="button" disabled={loading} onclick={() => void refresh()}>
    {loading ? 'Refreshing...' : 'Refresh'}
  </button>
</div>

{#if loading && !clips.length}
  <p class="empty">Loading clips...</p>
{:else if clips.length}
  <div class="clip-list">
    {#each clips as entry}
      <button type="button" disabled={busy} onclick={() => openClip(entry)}>
        <span>
          <strong>{entry.title}</strong>
          {#if entry.summary}<small>{entry.summary}</small>{/if}
        </span>
        <span>
          <small>{metaLabel(entry)}</small>
          <small>{entry.file}</small>
        </span>
      </button>
    {/each}
  </div>
{:else if loaded}
  <div class="empty-state">
    <strong>No clips yet.</strong>
    <span>
      Clips are small guided tours agents write over replays. They land in
      <code>agent-lab/artifacts/viewer-clips/</code> next to a
      <code>manifest.json</code>, and show up here once the artifact server is
      serving them.
    </span>
    {#if error}
      <small>{error}</small>
    {/if}
  </div>
{/if}

<style>
  .clip-toolbar {
    display: flex;
    justify-content: space-between;
    gap: 12px;
  }

  .clip-list {
    display: grid;
    gap: 8px;
  }

  .clip-list button {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(140px, auto);
    gap: 12px;
    align-items: center;
    min-height: 58px;
    border-radius: 8px;
    text-align: left;
    background: var(--button-bg);
  }

  .clip-list span {
    display: grid;
    min-width: 0;
    gap: 2px;
  }

  .clip-list strong,
  .clip-list small {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .clip-list small {
    color: var(--text-secondary);
    font-size: 12px;
  }

  .empty {
    margin: 0;
    color: var(--text-muted);
    font-size: 13px;
  }

  .empty-state {
    display: grid;
    gap: 6px;
    padding: 14px;
    border: 1px solid var(--surface-inset-border);
    border-radius: 8px;
    background: var(--surface-inset-bg);
  }

  .empty-state strong {
    font-size: 13px;
  }

  .empty-state span {
    color: var(--text-secondary);
    font-size: 12px;
    line-height: 1.5;
  }

  .empty-state small {
    color: var(--text-muted);
    font-size: 11px;
    overflow-wrap: anywhere;
  }

  code {
    padding: 1px 4px;
    border-radius: 4px;
    background: var(--app-bg);
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.92em;
  }

  @media (max-width: 980px) {
    .clip-list button {
      grid-template-columns: 1fr;
    }
  }
</style>
