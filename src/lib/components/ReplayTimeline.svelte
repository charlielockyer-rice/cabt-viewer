<script lang="ts">
  import type { ReplaySnapshot, ReplayStep } from '../game/replay';

  type Props = {
    replay: ReplaySnapshot;
    step: ReplayStep;
    displayLabel?: string;
    stepIndex: number;
    copiedForkPoint?: boolean;
    isPlaying?: boolean;
    setStep: (index: number) => void;
    setStateIndex: (index: number) => void;
    previousStep: () => void;
    nextStep: () => void;
    firstStep: () => void;
    lastStep: () => void;
    togglePlayback: () => void;
    backToReplayHome: () => void;
    copyForkPoint: () => void;
  };

  let {
    replay,
    step,
    displayLabel,
    stepIndex,
    copiedForkPoint = false,
    isPlaying = false,
    setStep,
    setStateIndex,
    previousStep,
    nextStep,
    firstStep,
    lastStep,
    togglePlayback,
    backToReplayHome,
    copyForkPoint,
  }: Props = $props();

  let maxStepIndex = $derived(Math.max(0, replay.steps.length - 1));
  let maxStateIndex = $derived(Math.max(0, replay.stateCount - 1));
  let actionValue = $derived(step.actionIndex === null ? 'Initial' : `${step.actionIndex + 1} / ${replay.actionCount}`);
  let stateValue = $derived(`${step.stateIndex} / ${maxStateIndex}`);
  let timelineLabel = $derived(displayLabel || step.label);
  let payloadPreview = $derived(formatPayload(step.payload));
  let createdLabel = $derived(Number.isFinite(replay.created) ? new Date(replay.created).toLocaleString() : '');
  let playerLabel = $derived(replay.players.map((player) => player.name).join(' vs '));

  function onStepInput(event: Event) {
    setStep(Number((event.currentTarget as HTMLInputElement).value));
  }

  function onStateInput(event: Event) {
    setStateIndex(Number((event.currentTarget as HTMLInputElement).value));
  }

  function formatPayload(payload: unknown): string {
    if (payload === null || payload === undefined) {
      return '';
    }
    const json = JSON.stringify(payload);
    return json.length > 180 ? `${json.slice(0, 177)}...` : json;
  }
</script>

<button class="replay-back-button" aria-label="Back to replay list" onclick={backToReplayHome}>Back</button>

<section class="replay-dock" aria-label="Replay timeline">
  <div class="replay-caption" title={timelineLabel}>
    <span>{timelineLabel}</span>
  </div>
  <div class="replay-controls" aria-label="Replay playback controls">
    <button aria-label="First action" onclick={firstStep} disabled={stepIndex === 0}>|&lt;</button>
    <button aria-label="Previous action" onclick={previousStep} disabled={stepIndex === 0}>&lt;</button>
    <button
      class="playback-toggle"
      aria-label={isPlaying ? 'Pause replay' : 'Play replay'}
      aria-pressed={isPlaying}
      onclick={togglePlayback}
      disabled={maxStepIndex === 0}
    >
      {#if isPlaying}
        <span class="pause-icon" aria-hidden="true"><span></span><span></span></span>
      {:else}
        <span class="play-icon" aria-hidden="true"></span>
      {/if}
    </button>
    <input
      aria-label="Action step"
      type="range"
      min="0"
      max={maxStepIndex}
      value={stepIndex}
      oninput={onStepInput}
    />
    <button aria-label="Next action" onclick={nextStep} disabled={stepIndex >= maxStepIndex}>&gt;</button>
    <button aria-label="Last action" onclick={lastStep} disabled={stepIndex >= maxStepIndex}>&gt;|</button>
  </div>
</section>

<aside class="replay-details" aria-label="Replay details">
  <div class="replay-meta">
    <strong>{replay.name}</strong>
    <span>{playerLabel}</span>
    <span>{createdLabel}</span>
  </div>

  <div class="replay-readout">
    <span>Action <b>{actionValue}</b></span>
    <span>State <b>{stateValue}</b></span>
    <span>Turn <b>{step.turn}</b></span>
    <span>{timelineLabel}</span>
  </div>

  <div class="state-controls">
    <label>
      State
      <input
        aria-label="State index"
        type="number"
        min="0"
        max={maxStateIndex}
        value={step.stateIndex}
        oninput={onStateInput}
      />
    </label>
    <button onclick={copyForkPoint}>{copiedForkPoint ? 'Fork point copied' : 'Copy fork point'}</button>
  </div>

  {#if payloadPreview}
    <pre>{payloadPreview}</pre>
  {/if}
</aside>

<style>
  .replay-dock {
    position: absolute;
    left: 0;
    right: var(--board-right-rail);
    bottom: 0;
    z-index: 12;
    height: var(--replay-dock-h, 48px);
    display: flex;
    align-items: center;
    padding: 7px 16px;
    border-top: 1px solid var(--surface-toolbar-border);
    background: var(--surface-toolbar-bg);
    color: var(--text-primary);
    box-shadow: var(--surface-toolbar-shadow);
    backdrop-filter: blur(var(--backdrop-blur));
  }

  .replay-back-button {
    position: absolute;
    top: 14px;
    left: 14px;
    z-index: 16;
    height: 34px;
    min-width: 64px;
    padding: 0 14px;
    border: 1px solid var(--button-border);
    border-radius: 5px;
    background: var(--button-bg);
    color: var(--button-text);
    box-shadow: var(--surface-toolbar-shadow);
    backdrop-filter: blur(var(--backdrop-blur));
    font-size: 12px;
    font-weight: 850;
  }

  .replay-caption {
    position: absolute;
    left: 50%;
    bottom: calc(100% + 7px);
    width: min(520px, calc(100% - 44px));
    transform: translateX(-50%);
    display: flex;
    justify-content: center;
    pointer-events: none;
  }

  .replay-caption span {
    max-width: 100%;
    min-width: 0;
    overflow: hidden;
    padding: 7px 13px;
    border: 1px solid var(--surface-toolbar-border);
    border-radius: 999px;
    background: var(--surface-toolbar-bg);
    color: var(--text-primary);
    box-shadow: var(--surface-toolbar-shadow);
    backdrop-filter: blur(var(--backdrop-blur));
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 13px;
    font-weight: 850;
    line-height: 1;
  }

  .replay-details {
    position: absolute;
    top: 414px;
    right: 14px;
    z-index: 9;
    width: 148px;
    display: grid;
    gap: 8px;
    padding: 7px;
    border: 1px solid var(--surface-toolbar-border);
    border-radius: 6px;
    background: var(--surface-toolbar-bg);
    color: var(--text-primary);
    box-shadow: var(--surface-toolbar-shadow);
    backdrop-filter: blur(var(--backdrop-blur));
  }

  .replay-meta,
  .replay-readout,
  .state-controls {
    display: grid;
    gap: 5px;
    min-width: 0;
    font-size: 11px;
    line-height: 1.2;
  }

  .replay-meta span,
  .replay-readout span {
    min-width: 0;
    overflow: hidden;
    color: var(--text-secondary);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .replay-meta strong {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12px;
  }

  .replay-controls {
    width: 100%;
    display: grid;
    grid-template-columns: 32px 32px 36px minmax(0, 1fr) 32px 32px;
    align-items: center;
    gap: 8px;
  }

  .replay-controls button,
  .state-controls button {
    min-width: 0;
    border-radius: 5px;
    border: 1px solid var(--button-border);
    background: var(--button-bg);
    color: var(--button-text);
    font-size: 11px;
    font-weight: 800;
  }

  .replay-controls button {
    width: 32px;
    height: 30px;
    padding: 0;
  }

  .replay-controls .playback-toggle {
    width: 36px;
  }

  .play-icon {
    display: block;
    width: 0;
    height: 0;
    margin: 0 auto;
    border-top: 7px solid transparent;
    border-bottom: 7px solid transparent;
    border-left: 11px solid currentColor;
    transform: translateX(1px);
  }

  .pause-icon {
    display: flex;
    justify-content: center;
    gap: 4px;
  }

  .pause-icon span {
    width: 4px;
    height: 14px;
    border-radius: 1px;
    background: currentColor;
  }

  .state-controls {
    align-items: stretch;
  }

  .state-controls label {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--text-secondary);
  }

  .state-controls input {
    width: 100%;
    height: 26px;
    border: 1px solid var(--input-border);
    border-radius: var(--radius-sm);
    background: var(--input-bg);
    color: var(--input-text);
    font: inherit;
    font-weight: 800;
  }

  .state-controls button {
    height: 26px;
    padding: 0 9px;
  }

  input[type='range'] {
    width: 100%;
  }

  pre {
    margin: 0;
    max-height: 66px;
    overflow: auto;
    color: var(--text-secondary);
    white-space: pre-wrap;
    word-break: break-word;
    font-size: 10px;
  }

  @media (max-width: 860px) {
    .replay-dock {
      right: 0;
      padding: 7px 10px;
    }

    .replay-caption {
      width: min(420px, calc(100% - 20px));
      bottom: calc(100% + 5px);
    }

    .replay-caption span {
      padding: 6px 10px;
      font-size: 12px;
    }

    .replay-details {
      display: none;
    }

    .replay-back-button {
      top: 10px;
      left: 10px;
      height: 32px;
      min-width: 60px;
      padding: 0 12px;
    }
  }
</style>
