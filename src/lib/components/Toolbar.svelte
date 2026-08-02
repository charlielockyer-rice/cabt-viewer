<script lang="ts">
  import ViewerSettings from './ViewerSettings.svelte';
  import { labelFor } from '../game/labels';
  import type { ThemePreference } from '../../state/viewSettings.svelte';

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
    replayMode?: boolean;
    analysisMode?: boolean;
    analysisAnimationsEnabled?: boolean;
    setAnalysisAnimationsEnabled?: (enabled: boolean) => void;
    busy?: boolean;
    promptActive?: boolean;
    gameFinished?: boolean;
    error?: string;
    resetPerspective: () => void;
    passTurn: () => void;
    switchSides: () => void;
    switchDisabled?: boolean;
    resetGame: () => void;
    resetLabel?: string;
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
    replayMode = false,
    analysisMode = false,
    analysisAnimationsEnabled = true,
    setAnalysisAnimationsEnabled = () => {},
    busy = false,
    promptActive = false,
    gameFinished = false,
    error = '',
    resetPerspective,
    passTurn,
    switchSides,
    switchDisabled = false,
    resetGame,
    resetLabel = 'Change decks',
  }: Props = $props();
</script>

<div class="table-toolbar">
  <div class="toolbar-heading" class:settings-only={!analysisMode}>
    {#if analysisMode}
      <span class="analysis-badge">Fixed seats</span>
    {/if}
    <ViewerSettings
      bind:boardTilt
      bind:boardPerspective
      bind:boardScaleY
      bind:boardLift
      bind:followActive
      bind:debugZones
      bind:showLogs
      bind:animateActions
      bind:showCardImages
      bind:actionStepDelayMs
      bind:themePreference
      {analysisMode}
      {analysisAnimationsEnabled}
      {setAnalysisAnimationsEnabled}
      {resetPerspective}
    />
  </div>

  {#if !replayMode}
    <button disabled={busy || promptActive || gameFinished} onclick={passTurn}>Pass turn</button>
  {/if}
  {#if !analysisMode}
    <button disabled={switchDisabled} onclick={switchSides}>Switch sides</button>
  {/if}
  <button onclick={resetGame}>{resetLabel}</button>
  {#if error}
    <span class="inline-error">{labelFor(error)}</span>
  {/if}
</div>

<style>
  .table-toolbar {
    --viewer-settings-menu-offset: 148px;
    position: absolute;
    top: 54px;
    right: 14px;
    z-index: 18;
    width: 148px;
    min-height: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    padding: 7px;
    border: 1px solid var(--surface-toolbar-border);
    background: var(--surface-toolbar-bg);
    border-radius: 6px;
    box-shadow: var(--surface-toolbar-shadow);
    backdrop-filter: blur(var(--backdrop-blur));
    flex-direction: column;
    align-items: stretch;
  }

  .toolbar-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
  }

  .toolbar-heading.settings-only {
    justify-content: flex-end;
  }

  .analysis-badge {
    flex: 1;
    display: grid;
    place-items: center;
    min-height: 34px;
    padding: 5px 7px;
    border: 1px solid var(--surface-toolbar-border);
    border-radius: 5px;
    color: var(--text-primary);
    font-size: 10px;
    font-weight: 800;
    text-align: center;
  }

  .table-toolbar button {
    width: 100%;
    border-radius: 5px;
    padding: 6px 7px;
    border-color: var(--button-border);
    background: var(--button-bg);
    color: var(--button-text);
    font-size: 10px;
    font-weight: 700;
  }

  .inline-error {
    padding: 6px 8px;
    max-width: 100%;
    border-radius: 8px;
    border: 1px solid var(--danger-border);
    background: var(--danger-bg);
    color: var(--danger-strong);
    font-size: 11px;
  }
</style>
