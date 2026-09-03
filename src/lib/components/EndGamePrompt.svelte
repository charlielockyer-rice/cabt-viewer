<script lang="ts">
  type Props = {
    resultLabel: string;
    turn: number;
    onconfirm: () => void;
    confirmLabel?: string;
    onsave?: () => void;
    saveDisabled?: boolean;
    saveMessage?: string;
    saveError?: string;
    saving?: boolean;
  };

  let {
    resultLabel,
    turn,
    onconfirm,
    confirmLabel = 'Back to main screen',
    onsave,
    saveDisabled = false,
    saveMessage = '',
    saveError = '',
    saving = false,
  }: Props = $props();
</script>

<div class="end-game-overlay" role="dialog" aria-modal="true" aria-labelledby="end-game-title">
  <section class="end-game-panel">
    <div>
      <span>Game over</span>
      <h2 id="end-game-title">{resultLabel}</h2>
      <p>Finished on turn {turn}</p>
    </div>
    <div class="actions">
      {#if onsave}
        <button class="secondary" type="button" onclick={onsave} disabled={saveDisabled || saving}>
          {saving ? 'Saving...' : saveMessage ? 'Saved' : 'Save match'}
        </button>
      {/if}
      <button type="button" onclick={onconfirm}>{confirmLabel}</button>
    </div>
    {#if saveMessage}
      <p class="save-status" role="status">{saveMessage}</p>
    {:else if saveError}
      <p class="save-status error" role="alert">{saveError}</p>
    {/if}
  </section>
</div>

<style>
  .end-game-overlay {
    position: absolute;
    inset: 0;
    z-index: 18;
    display: grid;
    place-items: center;
    padding: 24px;
    background: var(--overlay-backdrop-bg);
    backdrop-filter: blur(5px);
  }

  .end-game-panel {
    width: min(420px, calc(100vw - 48px));
    display: grid;
    gap: 18px;
    padding: 20px;
    border-radius: 6px;
    border: 1px solid var(--surface-glass-border);
    background: var(--surface-glass-bg);
    color: var(--text-primary);
    box-shadow: var(--surface-glass-shadow);
  }

  .end-game-panel span {
    display: block;
    margin-bottom: 6px;
    color: var(--accent-strong);
    font-size: 12px;
    font-weight: 900;
    text-transform: uppercase;
  }

  .end-game-panel h2 {
    margin: 0;
    color: var(--text-primary);
    font-size: 28px;
    line-height: 1.05;
  }

  .end-game-panel p {
    margin: 8px 0 0;
    color: var(--text-muted);
    font-size: 14px;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
  }

  .end-game-panel button {
    justify-self: start;
    border-radius: 5px;
    border: 1px solid var(--selection-border-strong);
    background: var(--accent-soft);
    color: var(--text-primary);
    padding: 9px 12px;
    font-weight: 900;
  }

  .end-game-panel button.secondary {
    border-color: var(--surface-glass-border);
    background: var(--surface-panel-bg);
  }

  .end-game-panel button:disabled {
    cursor: wait;
    opacity: 0.6;
  }

  .end-game-panel button:hover,
  .end-game-panel button:focus-visible {
    border-color: var(--accent-strong);
    background: var(--accent-tint);
  }

  .end-game-panel button:disabled:hover,
  .end-game-panel button:disabled:focus-visible {
    border-color: var(--surface-glass-border);
    background: var(--surface-panel-bg);
  }

  .save-status {
    margin: -6px 0 0;
    color: var(--text-muted);
    font-size: 13px;
  }

  .save-status.error {
    color: var(--danger-text);
  }
</style>
