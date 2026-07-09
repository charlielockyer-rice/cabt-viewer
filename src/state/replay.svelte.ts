import type { GameView } from '../lib/game/types';
import { replayAnimationPhaseGapMs, replayStepPlaybackDelayMs, type ReplaySnapshot, type ReplayStep } from '../lib/game/replay';
import { cabtReplayToSnapshot } from '../lib/cabt/cabtReplay';

// The raw per-state observation ({current, select}) the value head needs, kept
// alongside the projected snapshot (which drops it). Frame index === stateIndex
// because the snapshot's stateCount is exactly visualize.length.
export type ReplayObservationFrame = { current: unknown; select: unknown; stateIndex: number };

class ReplayStore {
  replay = $state<ReplaySnapshot | null>(null);
  stepIndex = $state(0);
  animationPhaseIndex = $state(0);
  loading = $state(false);
  error = $state('');
  copiedForkPoint = $state(false);
  isPlaying = $state(false);
  // Raw observation frames + both seats' decks, for the eval graph. Empty when
  // the replay JSON predates deck persistence (legacy/Kaggle) — the graph then
  // degrades rather than lying (see evalStore).
  observationFrames = $state<ReplayObservationFrame[]>([]);
  decks = $state<number[][]>([]);
  // True while the timeline is being navigated faster than animations can play
  // (scrub-bar drag, key-repeat stepping). The animation layers suppress all
  // choreography and render settled views directly while this is set; otherwise
  // dozens of orphaned viewport sprites pile up (Svelte coalesces the intermediate
  // scopes so their teardown never runs, and each sprite then drains only on its
  // own fixed cleanup timer). See docs/audit-2026-07-09-cluster-rules.md.
  scrubbing = $state(false);

  private playbackTimer: ReturnType<typeof setTimeout> | null = null;
  private animationPhaseTimer: ReturnType<typeof setTimeout> | null = null;
  private scrubTimer: ReturnType<typeof setTimeout> | null = null;
  private lastNavAt = 0;
  private readonly playbackDelayMs = 850;
  // Steps arriving closer together than this are a scrub, not a deliberate single
  // step. Paced playback advances one step per phase duration (>> this), so it
  // never trips scrub mode and stays fully animated.
  private static readonly SCRUB_DETECT_MS = 120;
  // Resume normal choreography this long after the last navigation settles.
  private static readonly SCRUB_DEBOUNCE_MS = 150;

  get currentStep(): ReplayStep | null {
    return this.replay?.steps[this.stepIndex] ?? null;
  }

  get currentDisplayLabel(): string {
    const step = this.currentStep;
    if (!step) {
      return '';
    }
    return step.animationPhases?.[this.animationPhaseIndex]?.label ?? step.label;
  }

  get currentView(): GameView | null {
    const replay = this.replay;
    const step = this.currentStep;
    if (!replay || !step) {
      return null;
    }
    const phase = step.animationPhases?.[this.animationPhaseIndex];
    if (phase) {
      return phase.view;
    }
    const view = step.displayView ?? replay.views[step.stateIndex] ?? null;
    if (!view || !step.actionTimeline) {
      return view;
    }
    if (step.animationPhases?.length) {
      return {
        ...view,
        actionTimeline: [],
      };
    }
    return {
      ...view,
      actionTimeline: step.actionTimeline,
    };
  }

  get maxStepIndex(): number {
    return Math.max(0, (this.replay?.steps.length ?? 1) - 1);
  }

  async loadSaved(id = 'kaggle-context.json'): Promise<void> {
    await this.loadCandidates(replayCandidates(id));
  }

  async loadUrl(url: string): Promise<void> {
    await this.loadCandidates([url]);
  }

  private async loadCandidates(candidates: string[]): Promise<void> {
    if (this.loading) {
      return;
    }
    this.pause();
    this.clearAnimationPhaseTimer();
    this.loading = true;
    this.error = '';
    this.copiedForkPoint = false;
    try {
      const loaded = await loadCabtReplay(candidates);
      this.replay = loaded.snapshot;
      this.observationFrames = loaded.frames;
      this.decks = loaded.decks;
      this.stepIndex = 0;
      this.animationPhaseIndex = 0;
      this.scheduleAnimationPhase();
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
      this.replay = null;
      this.observationFrames = [];
      this.decks = [];
      this.stepIndex = 0;
      this.animationPhaseIndex = 0;
    } finally {
      this.loading = false;
    }
  }

  clear(): void {
    this.pause();
    this.clearAnimationPhaseTimer();
    this.clearScrubTimer();
    this.scrubbing = false;
    this.replay = null;
    this.observationFrames = [];
    this.decks = [];
    this.stepIndex = 0;
    this.animationPhaseIndex = 0;
    this.loading = false;
    this.error = '';
    this.copiedForkPoint = false;
  }

  // Arm scrub mode when navigation outpaces animation. Called on every setStep —
  // which every navigation path (range inputs, next/prev/first/last, setStateIndex,
  // and paced playback) funnels through. Playback's inter-step delay is far larger
  // than SCRUB_DETECT_MS, so it never arms scrub; only a rapid manual sweep does.
  private markNavigation(): void {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const delta = now - this.lastNavAt;
    this.lastNavAt = now;
    if (delta < ReplayStore.SCRUB_DETECT_MS) {
      this.scrubbing = true;
    }
    this.clearScrubTimer();
    this.scrubTimer = setTimeout(() => {
      this.scrubbing = false;
      this.scrubTimer = null;
    }, ReplayStore.SCRUB_DEBOUNCE_MS);
  }

  private clearScrubTimer(): void {
    if (this.scrubTimer) {
      clearTimeout(this.scrubTimer);
      this.scrubTimer = null;
    }
  }

  setStep(index: number): void {
    this.markNavigation();
    this.stepIndex = clampIndex(index, this.maxStepIndex);
    this.animationPhaseIndex = 0;
    this.copiedForkPoint = false;
    this.scheduleAnimationPhase();
    if (this.stepIndex >= this.maxStepIndex) {
      this.pause();
      return;
    }
    if (this.isPlaying) {
      this.schedulePlaybackStep();
    }
  }

  nextStep(): void {
    this.setStep(this.stepIndex + 1);
  }

  previousStep(): void {
    this.setStep(this.stepIndex - 1);
  }

  firstStep(): void {
    this.setStep(0);
  }

  lastStep(): void {
    this.setStep(this.maxStepIndex);
  }

  play(): void {
    if (!this.replay || this.maxStepIndex <= 0) {
      return;
    }
    if (this.stepIndex >= this.maxStepIndex) {
      this.stepIndex = 0;
      this.animationPhaseIndex = 0;
      this.scheduleAnimationPhase();
    }
    this.clearPlaybackTimer();
    this.isPlaying = true;
    this.schedulePlaybackStep();
  }

  pause(): void {
    this.clearPlaybackTimer();
    this.isPlaying = false;
  }

  togglePlayback(): void {
    if (this.isPlaying) {
      this.pause();
      return;
    }
    this.play();
  }

  setStateIndex(stateIndex: number): void {
    const replay = this.replay;
    if (!replay) {
      return;
    }
    const clampedState = clampIndex(stateIndex, Math.max(0, replay.stateCount - 1));
    const exact = replay.steps.findIndex((step) => step.stateIndex === clampedState);
    if (exact !== -1) {
      this.setStep(exact);
      return;
    }

    let bestIndex = 0;
    for (let index = 0; index < replay.steps.length; index += 1) {
      if (replay.steps[index].stateIndex <= clampedState) {
        bestIndex = index;
      }
    }
    this.setStep(bestIndex);
  }

  async copyForkPoint(): Promise<void> {
    const replay = this.replay;
    const step = this.currentStep;
    if (!replay || !step || typeof navigator === 'undefined' || !navigator.clipboard) {
      return;
    }

    await navigator.clipboard.writeText(JSON.stringify({
      replayId: replay.id,
      replayName: replay.name,
      stepIndex: step.index,
      stateIndex: step.stateIndex,
      actionIndex: step.actionIndex,
      actionType: step.type,
      turn: step.turn,
    }));
    this.copiedForkPoint = true;
  }

  private clearPlaybackTimer(): void {
    if (this.playbackTimer) {
      clearTimeout(this.playbackTimer);
      this.playbackTimer = null;
    }
  }

  private schedulePlaybackStep(): void {
    this.clearPlaybackTimer();
    if (!this.isPlaying) {
      return;
    }
    this.playbackTimer = setTimeout(() => {
      if (this.stepIndex >= this.maxStepIndex) {
        this.pause();
        return;
      }
      this.nextStep();
    }, replayStepPlaybackDelayMs(this.currentStep, this.playbackDelayMs));
  }

  private scheduleAnimationPhase(): void {
    this.clearAnimationPhaseTimer();
    const phase = this.currentStep?.animationPhases?.[this.animationPhaseIndex];
    if (!phase) {
      return;
    }
    const scheduledStepIndex = this.stepIndex;
    const scheduledPhaseIndex = this.animationPhaseIndex;
    const phaseDurationMs = phase.durationMs;
    this.animationPhaseTimer = setTimeout(() => {
      this.animationPhaseTimer = null;
      if (this.stepIndex !== scheduledStepIndex || this.animationPhaseIndex !== scheduledPhaseIndex) {
        return;
      }
      this.animationPhaseIndex += 1;
      this.scheduleAnimationPhase();
    }, phaseDurationMs + replayAnimationPhaseGapMs);
  }

  private clearAnimationPhaseTimer(): void {
    if (this.animationPhaseTimer) {
      clearTimeout(this.animationPhaseTimer);
      this.animationPhaseTimer = null;
    }
  }
}

type LoadedReplay = {
  snapshot: ReplaySnapshot;
  frames: ReplayObservationFrame[];
  decks: number[][];
};

async function loadCabtReplay(candidates: string[]): Promise<LoadedReplay> {
  const failures: string[] = [];
  for (const url of candidates) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        failures.push(`${url}: ${response.status}`);
        continue;
      }
      const json = await response.json();
      return {
        snapshot: cabtReplayToSnapshot(json),
        frames: observationFramesFrom(json),
        decks: Array.isArray(json?.decks) ? json.decks : [],
      };
    } catch (error) {
      failures.push(`${url}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(`Unable to load CABT replay. Tried ${failures.join('; ')}`);
}

function observationFramesFrom(json: unknown): ReplayObservationFrame[] {
  const visualize = (json as { visualize?: unknown })?.visualize;
  if (!Array.isArray(visualize)) {
    return [];
  }
  return visualize.map((frame, stateIndex) => ({
    current: (frame as { current?: unknown })?.current ?? null,
    select: (frame as { select?: unknown })?.select ?? null,
    stateIndex,
  }));
}

function replayCandidates(id: string): string[] {
  const params = typeof window === 'undefined' ? new URLSearchParams() : new URLSearchParams(window.location.search);
  const replayUrl = params.get('replayUrl');
  if (replayUrl) {
    return [replayUrl];
  }
  const file = params.get('replay') || id;
  if (/^https?:\/\//.test(file) || file.startsWith('/')) {
    return [file];
  }
  return [
    `/game-logs/${encodePath(file)}`,
    `/cabt-artifacts/${encodePath(file)}`,
    '/cabt-artifacts/kaggle-context.json',
    '/cabt-artifacts/cabt-match.json',
  ];
}

function encodePath(path: string): string {
  return path.split('/').map((part) => encodeURIComponent(part)).join('/');
}

function clampIndex(value: number, max: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(max, Math.max(0, Math.round(value)));
}

export const replayStore = new ReplayStore();
