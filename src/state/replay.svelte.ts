import type { GameView } from '../lib/game/types';
import { replayAnimationPhaseGapMs, replayStepPlaybackDelayMs, type ReplayAnimationPhase, type ReplaySnapshot, type ReplayStep } from '../lib/game/replay';
import { actionAnimationTiming } from '../lib/cabt/actionAnimationSchedule';
import { cabtReplayToSnapshot } from '../lib/cabt/cabtReplay';

class ReplayStore {
  replay = $state<ReplaySnapshot | null>(null);
  stepIndex = $state(0);
  animationPhaseIndex = $state(0);
  loading = $state(false);
  error = $state('');
  copiedForkPoint = $state(false);
  isPlaying = $state(false);

  private playbackTimer: ReturnType<typeof setTimeout> | null = null;
  private animationPhaseTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly playbackDelayMs = 850;

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
      this.replay = await loadCabtReplay(candidates);
      this.stepIndex = 0;
      this.animationPhaseIndex = 0;
      this.scheduleAnimationPhase();
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
      this.replay = null;
      this.stepIndex = 0;
      this.animationPhaseIndex = 0;
    } finally {
      this.loading = false;
    }
  }

  clear(): void {
    this.pause();
    this.clearAnimationPhaseTimer();
    this.replay = null;
    this.stepIndex = 0;
    this.animationPhaseIndex = 0;
    this.loading = false;
    this.error = '';
    this.copiedForkPoint = false;
  }

  setStep(index: number): void {
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
    const phaseDurationMs = replayPhaseDurationMs(phase);
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

async function loadCabtReplay(candidates: string[]): Promise<ReplaySnapshot> {
  const failures: string[] = [];
  for (const url of candidates) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        failures.push(`${url}: ${response.status}`);
        continue;
      }
      return cabtReplayToSnapshot(await response.json());
    } catch (error) {
      failures.push(`${url}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(`Unable to load CABT replay. Tried ${failures.join('; ')}`);
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

function replayPhaseDurationMs(phase: ReplayAnimationPhase): number {
  if (Number.isFinite(phase.durationMs) && phase.durationMs > 0) {
    return phase.durationMs;
  }
  const key = phase.key;
  if (key.startsWith('Shuffle:')) {
    return actionAnimationTiming.deckShuffleMs;
  }
  if (key.startsWith('Draw:')) {
    return actionAnimationTiming.deckDrawMs;
  }
  if (key.startsWith('DeckDiscard:')) {
    return actionAnimationTiming.deckDiscardMs;
  }
  if (key.startsWith('DeckReveal:') || key.startsWith('DeckSearchReveal:')) {
    return actionAnimationTiming.deckRevealMs;
  }
  if (key.startsWith('DeckRevealReturn:')) {
    return actionAnimationTiming.deckRevealReturnMs;
  }
  if (key.startsWith('DeckRevealTake:')
    || key.startsWith('HandMove:')
    || key.startsWith('HandToDeck:')
    || key.startsWith('AttachedMove:')
    || key.startsWith('Play:')
    || key.startsWith('Attach:')) {
    return actionAnimationTiming.handMoveMs;
  }
  if (key.startsWith('DeckBoardPlace:')
    || key.startsWith('BoardToDeck:')
    || key.startsWith('BoardMove:')) {
    return actionAnimationTiming.boardMoveMs;
  }
  if (key.startsWith('StadiumMove:')) {
    return actionAnimationTiming.stadiumMoveMs;
  }
  if (key.startsWith('Evolve:')) {
    return actionAnimationTiming.evolveMs;
  }
  if (key.startsWith('Attack:')) {
    return actionAnimationTiming.attackAnnounceMs;
  }
  if (key.startsWith('Ability:')) {
    return actionAnimationTiming.abilityAnnounceMs;
  }
  if (key.startsWith('Damage:')) {
    return actionAnimationTiming.damageVisualMs;
  }
  if (key.startsWith('KnockOut:')) {
    return actionAnimationTiming.knockOutMs;
  }
  return actionAnimationTiming.handMoveMs;
}
