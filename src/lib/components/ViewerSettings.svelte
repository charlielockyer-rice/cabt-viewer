<script lang="ts">
  import { viewSettingsStore, type ThemePreference } from '../../state/viewSettings.svelte';

  type Props = {
    boardTilt: number;
    boardPerspective: number;
    boardScaleY: number;
    boardLift: number;
    followActive: boolean;
    debugZones: boolean;
    showLogs: boolean;
    animateActions: boolean;
    showCardImages: boolean;
    actionStepDelayMs: number;
    themePreference: ThemePreference;
    analysisMode?: boolean;
    analysisAnimationsEnabled?: boolean;
    setAnalysisAnimationsEnabled?: (enabled: boolean) => void;
    resetPerspective: () => void;
  };

  let {
    boardTilt = $bindable(),
    boardPerspective = $bindable(),
    boardScaleY = $bindable(),
    boardLift = $bindable(),
    followActive = $bindable(),
    debugZones = $bindable(),
    showLogs = $bindable(),
    animateActions = $bindable(),
    showCardImages = $bindable(),
    actionStepDelayMs = $bindable(),
    themePreference = $bindable(),
    analysisMode = false,
    analysisAnimationsEnabled = true,
    setAnalysisAnimationsEnabled = () => {},
    resetPerspective,
  }: Props = $props();
</script>

<details class="viewer-settings">
  <summary aria-label="Viewer settings" title="Viewer settings">⚙</summary>
  <div class="settings-menu">
    <header>
      <strong>Viewer settings</strong>
      <small>Display and replay preferences</small>
    </header>

    <section>
      <strong>Display</strong>
      <label class="toggle-row">
        <span>Card images</span>
        <input type="checkbox" bind:checked={showCardImages} />
      </label>
      <label class="select-row">
        <span>Theme</span>
        <select bind:value={themePreference} aria-label="Theme preference">
          <option value="system">System</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </select>
      </label>
    </section>

    <section>
      <strong>Playback</strong>
      {#if analysisMode}
        <label class="toggle-row">
          <span>Animations</span>
          <input
            type="checkbox"
            checked={analysisAnimationsEnabled}
            onchange={(event) => setAnalysisAnimationsEnabled((event.currentTarget as HTMLInputElement).checked)}
          />
        </label>
      {:else}
        <label class="toggle-row">
          <span>Step playback</span>
          <input type="checkbox" bind:checked={animateActions} />
        </label>
        <label class="number-row">
          <span>Step delay</span>
          <input
            type="number"
            min="50"
            max="2500"
            step="50"
            bind:value={actionStepDelayMs}
            disabled={!animateActions}
          />
          <small>ms</small>
        </label>
        <label class="toggle-row">
          <span>Follow active player</span>
          <input type="checkbox" bind:checked={followActive} />
        </label>
        <div class="choice-row">
          <span>Side switch</span>
          <div role="group" aria-label="Side switch transition">
            <button
              type="button"
              class:active={viewSettingsStore.seatTransition === 'auto'}
              aria-pressed={viewSettingsStore.seatTransition === 'auto'}
              title="Flip normally; fade while scrubbing"
              onclick={() => (viewSettingsStore.seatTransition = 'auto')}
            >Auto</button>
            <button
              type="button"
              class:active={viewSettingsStore.seatTransition === 'flip'}
              aria-pressed={viewSettingsStore.seatTransition === 'flip'}
              onclick={() => (viewSettingsStore.seatTransition = 'flip')}
            >Flip</button>
            <button
              type="button"
              class:active={viewSettingsStore.seatTransition === 'fade'}
              aria-pressed={viewSettingsStore.seatTransition === 'fade'}
              onclick={() => (viewSettingsStore.seatTransition = 'fade')}
            >Fade</button>
          </div>
        </div>
      {/if}
    </section>

    <section>
      <div class="section-heading">
        <strong>Board</strong>
        <button type="button" onclick={() => resetPerspective()}>Reset</button>
      </div>
      <label class="range-row">
        <span>Tilt</span>
        <input type="range" min="0" max="18" step="1" bind:value={boardTilt} />
        <small>{boardTilt}°</small>
      </label>
      <label class="range-row">
        <span>Depth</span>
        <input type="range" min="700" max="2200" step="50" bind:value={boardPerspective} />
        <small>{boardPerspective}px</small>
      </label>
      <label class="range-row">
        <span>Height</span>
        <input type="range" min="86" max="100" step="1" bind:value={boardScaleY} />
        <small>{boardScaleY}%</small>
      </label>
      <label class="range-row">
        <span>Lift</span>
        <input type="range" min="-48" max="48" step="2" bind:value={boardLift} />
        <small>{boardLift}px</small>
      </label>
    </section>

    <section>
      <strong>Diagnostics</strong>
      <label class="toggle-row">
        <span>Show logs</span>
        <input type="checkbox" bind:checked={showLogs} />
      </label>
      <label class="toggle-row">
        <span>Debug zones</span>
        <input type="checkbox" bind:checked={debugZones} />
      </label>
    </section>
  </div>
</details>

<style>
  .viewer-settings {
    position: relative;
    color: var(--text-primary);
  }

  summary {
    display: grid;
    place-items: center;
    width: 34px;
    height: 34px;
    border: 1px solid var(--button-border);
    border-radius: 6px;
    background: var(--button-bg);
    color: var(--button-text);
    cursor: pointer;
    font-size: 17px;
    line-height: 1;
    list-style: none;
    user-select: none;
  }

  summary::-webkit-details-marker {
    display: none;
  }

  .viewer-settings[open] summary {
    background: var(--surface-inset-bg);
  }

  .settings-menu {
    position: absolute;
    top: 0;
    right: var(--viewer-settings-menu-offset, 0px);
    z-index: 30;
    width: 286px;
    max-height: calc(100vh - 112px);
    overflow-y: auto;
    display: grid;
    gap: 12px;
    padding: 12px;
    border: 1px solid var(--surface-toolbar-border);
    border-radius: 8px;
    background: var(--app-bg);
    box-shadow: var(--surface-toolbar-shadow);
    backdrop-filter: blur(var(--backdrop-blur));
  }

  header {
    display: grid;
    gap: 2px;
  }

  header strong {
    font-size: 13px;
  }

  header small,
  label,
  .choice-row {
    color: var(--text-secondary);
    font-size: 11px;
  }

  section {
    display: grid;
    gap: 8px;
    padding-top: 10px;
    border-top: 1px solid var(--surface-inset-border);
  }

  section > strong,
  .section-heading strong {
    color: var(--text-primary);
    font-size: 11px;
  }

  .toggle-row,
  .select-row,
  .number-row,
  .choice-row,
  .section-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }

  .toggle-row {
    min-height: 22px;
  }

  select,
  .number-row input {
    min-width: 0;
    border: 1px solid var(--input-border);
    border-radius: var(--radius-sm);
    background: var(--input-bg);
    color: var(--input-text);
    font: inherit;
    font-weight: 700;
  }

  select {
    width: 112px;
  }

  .number-row input {
    width: 64px;
    margin-left: auto;
    padding: 3px 5px;
  }

  .number-row small {
    width: 18px;
    color: var(--text-muted);
  }

  .choice-row > div {
    display: flex;
    gap: 4px;
  }

  button {
    width: auto;
    padding: 3px 8px;
    border: 1px solid var(--button-border);
    border-radius: 5px;
    background: var(--button-bg);
    color: var(--button-text);
    font-size: 10px;
    font-weight: 750;
  }

  button.active {
    border-color: var(--accent-base, #52bca8);
    background: var(--selection-bg, rgba(82, 188, 168, 0.18));
    color: var(--text-primary);
  }

  .range-row {
    display: grid;
    grid-template-columns: 40px minmax(0, 1fr) 52px;
    align-items: center;
    gap: 8px;
  }

  .range-row input {
    width: 100%;
  }

  .range-row small {
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
    text-align: right;
  }

  @media (max-width: 520px) {
    .settings-menu {
      top: calc(100% + 8px);
      right: 0;
      width: min(286px, calc(100vw - 28px));
    }
  }
</style>
