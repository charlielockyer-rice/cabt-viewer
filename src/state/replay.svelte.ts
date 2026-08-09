import type { GameView } from '../lib/game/types';
import { replayAnimationPhaseGapMs, replayStepPlaybackDelayMs, type ReplaySnapshot, type ReplayStep } from '../lib/game/replay';
import {
  nextReplayDisagreement,
  replayDecisionAnalyses,
  type ReplayDecisionAnalysis,
} from '../lib/game/replayAnalysis';
import {
  replayPositionFromSearch,
  replayStepForState,
  replayUrlAtState,
} from '../lib/game/replayLocation';
import { cabtReplayToSnapshot } from '../lib/cabt/cabtReplay';
import { exactDecisionResultView } from '../lib/game/exactReplay';

// The raw per-state observation ({current, select}) the value head needs, kept
// alongside the projected snapshot (which drops it). Frame index === stateIndex
// because the snapshot's stateCount is exactly visualize.length.
export type ReplayObservationFrame = {
  current: unknown;
  select: unknown;
  stateIndex: number;
  // The engine's opaque search seed. Present on raw agent-vs-agent frames;
  // REQUIRED by the near-omniscient analysis line (cg.api.search_begin rejects an
  // observation without it). Absent on legacy/Kaggle frames -> that line is
  // unavailable, same as the honesty gate.
  searchBeginInput: string | null;
};

export type ReplayAnalysisVisibility = {
  mode: 'analysis' | 'perspective';
  hands: 'full' | 'per-actor' | 'counts';
  prizes: 'full' | 'counts';
  warning?: string;
};

export type ReplayGameContext = {
  id: string;
  game_uid: string;
  search_depth: number;
  search_depths: number[];
  model_name: string;
  model_dtype: string;
  source: string;
  decks: Array<{ family_name: string; family_id: string; deck_id: string }>;
};

// An explicit "open here" for loadFrom: the caller already knows the state it
// wants and whether that position should open in exact-decision mode.
export type ReplayLoadPosition = {
  stateIndex: number;
  exact?: boolean;
};

const perspectiveVisibility: ReplayAnalysisVisibility = {
  mode: 'perspective',
  hands: 'per-actor',
  prizes: 'counts',
};

class ReplayStore {
  replay = $state<ReplaySnapshot | null>(null);
  stepIndex = $state(0);
  stateIndex = $state(0);
  animationPhaseIndex = $state(0);
  animationsEnabled = $state(true);
  loading = $state(false);
  error = $state('');
  copiedForkPoint = $state(false);
  isPlaying = $state(false);
  // Raw observation frames + both seats' decks, for the eval graph. Empty when
  // the replay JSON predates deck persistence (legacy/Kaggle) — the graph then
  // degrades rather than lying (see evalStore).
  observationFrames = $state<ReplayObservationFrame[]>([]);
  decks = $state<number[][]>([]);
  // Which seats this replay can honestly score (index = seat): a seat is honest
  // when ITS OWN decision frames carry its hand. True for both when the replay
  // has raw (pre-conceal) frames (`rawVisualize`, saved games from now on) or is
  // an already-omniscient spectator/Kaggle record; a legacy save that concealed
  // the opponent's hand leaves that seat false, so the graph shows the honest
  // seat only with an explicit "perspective unavailable" label, never a lie.
  honestSeats = $state<[boolean, boolean]>([false, false]);
  analysisVisibility = $state<ReplayAnalysisVisibility>(perspectiveVisibility);
  gameContext = $state<ReplayGameContext | null>(null);
  decisionAnalyses = $state<ReplayDecisionAnalysis[]>([]);
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
    if (!this.animationsEnabled) {
      return exactDecisionLabel(this.currentDecisionAnalysis);
    }
    const step = this.currentStep;
    if (!step) {
      return '';
    }
    if (this.stateIndex !== step.stateIndex) {
      return `State ${this.stateIndex}`;
    }
    return step.animationPhases?.[this.animationPhaseIndex]?.label ?? step.label;
  }

  get currentView(): GameView | null {
    const replay = this.replay;
    const step = this.currentStep;
    if (!replay || !step) {
      return null;
    }
    if (!this.animationsEnabled) {
      // A recorded selection on state N produces state N+1. Exact-decision
      // mode keeps the decision metadata at N but renders its resulting board,
      // so the named action and visible card movement share one timeline step.
      const resultView = replay.views[Math.min(this.stateIndex + 1, replay.stateCount - 1)] ?? null;
      return exactDecisionResultView(
        resultView,
        replay.views,
        this.stateIndex,
        this.observationFrames[this.stateIndex]?.select,
        this.currentDecisionAnalysis,
      );
    }
    if (this.stateIndex !== step.stateIndex) {
      return replay.views[this.stateIndex] ?? null;
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

  get maxDecisionStateIndex(): number {
    return Math.max(0, ...this.decisionAnalyses.map((analysis) => analysis.stateIndex));
  }

  get currentDecisionAnalysis(): ReplayDecisionAnalysis | null {
    return this.decisionAnalyses.find((analysis) =>
      analysis.stateIndex === this.stateIndex
    ) ?? null;
  }

  get nextDisagreementStateIndex(): number | null {
    return nextReplayDisagreement(
      this.decisionAnalyses,
      this.stateIndex,
    )?.stateIndex ?? null;
  }

  get isTimelinePosition(): boolean {
    return this.currentStep?.stateIndex === this.stateIndex;
  }

  async loadSaved(id = 'kaggle-context.json'): Promise<void> {
    await this.loadCandidates(replayCandidates(id));
  }

  async loadUrl(url: string): Promise<void> {
    await this.loadCandidates([url]);
  }

  // Load an explicitly resolved replay at an explicit position, for callers
  // that own the resolution themselves (clips). Everything after the fetch is
  // the same path as the URL-driven loads.
  async loadFrom(candidates: string[], position: ReplayLoadPosition): Promise<void> {
    await this.loadCandidates(candidates, position);
  }

  private async loadCandidates(
    candidates: string[],
    requested: ReplayLoadPosition | null = null,
  ): Promise<void> {
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
      this.honestSeats = loaded.honestSeats;
      this.analysisVisibility = loaded.analysisVisibility;
      this.gameContext = loaded.gameContext;
      this.decisionAnalyses = loaded.decisionAnalyses;
      const search = typeof window === 'undefined' ? '' : window.location.search;
      if (loaded.analysisVisibility.mode !== 'analysis') {
        this.animationsEnabled = true;
      } else if (requested) {
        this.animationsEnabled = !requested.exact;
      } else if (new URLSearchParams(search).get('detail') === 'exact') {
        this.animationsEnabled = false;
      }
      const position = requested
        ? {
          stateIndex: clampIndex(requested.stateIndex, Math.max(0, loaded.snapshot.stateCount - 1)),
          stepIndex: replayStepForState(loaded.snapshot.steps, requested.stateIndex),
        }
        : replayPositionFromSearch(
          search,
          loaded.snapshot.steps,
          loaded.snapshot.stateCount,
        );
      this.stepIndex = position.stepIndex;
      this.stateIndex = this.animationsEnabled
        ? position.stateIndex
        : Math.min(position.stateIndex, this.maxDecisionStateIndex);
      this.animationPhaseIndex = 0;
      this.syncPositionUrl();
      this.scheduleAnimationPhase();
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
      this.replay = null;
      this.observationFrames = [];
      this.decks = [];
      this.honestSeats = [false, false];
      this.analysisVisibility = perspectiveVisibility;
      this.gameContext = null;
      this.decisionAnalyses = [];
      this.stepIndex = 0;
      this.stateIndex = 0;
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
    this.honestSeats = [false, false];
    this.analysisVisibility = perspectiveVisibility;
    this.gameContext = null;
    this.decisionAnalyses = [];
    this.stepIndex = 0;
    this.stateIndex = 0;
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
    this.stateIndex = this.currentStep?.stateIndex ?? 0;
    this.animationPhaseIndex = 0;
    this.copiedForkPoint = false;
    this.syncPositionUrl();
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
    if (!this.animationsEnabled) {
      this.setStateIndex(this.stateIndex + 1);
      return;
    }
    this.setStep(this.stepIndex + 1);
  }

  previousStep(): void {
    if (!this.animationsEnabled) {
      this.setStateIndex(this.stateIndex - 1);
      return;
    }
    this.setStep(this.stepIndex - 1);
  }

  firstStep(): void {
    if (!this.animationsEnabled) {
      this.setStateIndex(0);
      return;
    }
    this.setStep(0);
  }

  lastStep(): void {
    if (!this.animationsEnabled) {
      this.setStateIndex(this.maxDecisionStateIndex);
      return;
    }
    this.setStep(this.maxStepIndex);
  }

  play(): void {
    if (!this.replay || this.maxNavigationIndex <= 0) {
      return;
    }
    if (this.atEnd) {
      if (this.animationsEnabled) {
        this.stepIndex = 0;
        this.stateIndex = this.currentStep?.stateIndex ?? 0;
      } else {
        this.stateIndex = 0;
        this.stepIndex = replayStepForState(this.replay.steps, 0);
      }
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
    const clampedState = clampIndex(
      stateIndex,
      this.animationsEnabled ? Math.max(0, replay.stateCount - 1) : this.maxDecisionStateIndex,
    );
    if (!this.animationsEnabled) {
      this.markNavigation();
      this.stateIndex = clampedState;
      this.stepIndex = replayStepForState(replay.steps, clampedState);
      this.animationPhaseIndex = 0;
      this.copiedForkPoint = false;
      this.clearAnimationPhaseTimer();
      this.syncPositionUrl();
      if (this.atEnd) {
        this.pause();
      } else if (this.isPlaying) {
        this.schedulePlaybackStep();
      }
      return;
    }
    this.setStep(replayStepForState(replay.steps, clampedState));
    this.stateIndex = clampedState;
    this.animationPhaseIndex = 0;
    this.clearAnimationPhaseTimer();
    this.syncPositionUrl();
  }

  nextDisagreement(): void {
    const stateIndex = this.nextDisagreementStateIndex;
    if (stateIndex !== null) {
      this.setStateIndex(stateIndex);
    }
  }

  setAnimationsEnabled(enabled: boolean): void {
    if (this.animationsEnabled === enabled) {
      return;
    }
    this.pause();
    this.clearAnimationPhaseTimer();
    this.animationsEnabled = enabled;
    this.animationPhaseIndex = 0;
    if (this.replay) {
      if (!enabled) {
        this.stateIndex = Math.min(this.stateIndex, this.maxDecisionStateIndex);
      }
      this.stepIndex = replayStepForState(this.replay.steps, this.stateIndex);
      if (enabled) {
        this.stateIndex = this.currentStep?.stateIndex ?? this.stateIndex;
        this.scheduleAnimationPhase();
      }
      this.syncPositionUrl();
    }
  }

  async copyForkPoint(): Promise<void> {
    const replay = this.replay;
    if (!replay || typeof navigator === 'undefined' || !navigator.clipboard) {
      return;
    }

    const url = this.positionUrl();
    const step = this.currentStep;
    const context = this.gameContext;
    const analysis = this.currentDecisionAnalysis;
    const position = this.animationsEnabled
      ? `state ${this.stateIndex}`
      : `decision state ${this.stateIndex} → result state ${Math.min(this.stateIndex + 1, replay.stateCount - 1)}`;
    const lines = [
      'CABT game checkpoint',
      `Game: ${context?.game_uid ?? replay.name}`,
      `Position: ${position}, step ${this.stepIndex}${this.currentView ? `, turn ${this.currentView.turn}` : ''}`,
      `Event: ${this.currentDisplayLabel || step?.label || 'Recorded position'}`,
    ];
    if (context) {
      lines.push(
        `Search: depth ${context.search_depth} · ${context.model_name}${context.model_dtype ? ` · ${context.model_dtype}` : ''}`,
        `Decks: ${context.decks.map((deck) => deck.family_name).join(' vs ')}`,
        `Bank ID: ${context.id} · ${context.source}`,
      );
    }
    if (analysis) {
      const verdict = analysis.searched
        ? (analysis.changed ? 'search changed the move' : 'search agreed with policy')
        : (analysis.mode || 'recorded decision');
      lines.push(`Decision: ${verdict}${analysis.completedTraversals !== undefined ? ` · ${analysis.completedTraversals} sims` : ''}`);
    }
    lines.push(`Link: ${url}`);
    await navigator.clipboard.writeText(lines.join('\n'));
    this.copiedForkPoint = true;
  }

  private syncPositionUrl(): void {
    if (typeof window === 'undefined' || !this.replay) {
      return;
    }
    window.history.replaceState(
      {},
      '',
      this.positionUrl(),
    );
  }

  private positionUrl(): string {
    const next = new URL(replayUrlAtState(window.location.href, this.stateIndex, this.stepIndex));
    if (this.animationsEnabled) {
      next.searchParams.delete('detail');
    } else {
      next.searchParams.set('detail', 'exact');
    }
    return next.toString();
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
      if (this.atEnd) {
        this.pause();
        return;
      }
      this.nextStep();
    }, this.animationsEnabled
      ? replayStepPlaybackDelayMs(this.currentStep, this.playbackDelayMs)
      : this.playbackDelayMs);
  }

  private scheduleAnimationPhase(): void {
    this.clearAnimationPhaseTimer();
    if (!this.animationsEnabled || !this.isTimelinePosition) {
      return;
    }
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

  private get maxNavigationIndex(): number {
    return this.animationsEnabled
      ? this.maxStepIndex
      : this.maxDecisionStateIndex;
  }

  private get atEnd(): boolean {
    return this.animationsEnabled
      ? this.stepIndex >= this.maxStepIndex
      : this.stateIndex >= this.maxNavigationIndex;
  }

  private clearAnimationPhaseTimer(): void {
    if (this.animationPhaseTimer) {
      clearTimeout(this.animationPhaseTimer);
      this.animationPhaseTimer = null;
    }
  }
}

function exactDecisionLabel(analysis: ReplayDecisionAnalysis | null): string {
  if (!analysis) {
    return 'Final position';
  }
  const actor = analysis.playerIndex === undefined ? 'Model' : `Player ${analysis.playerIndex + 1}`;
  const selection = analysis.playedSelection ?? [];
  if (!selection.length) {
    return `${actor} submitted no selection.`;
  }
  const choices = selection.map((index) =>
    analysis.legalActions?.[index]?.label ?? `Option ${index}`
  );
  return `${actor} chose ${choices.join(' + ')}.`;
}

type LoadedReplay = {
  snapshot: ReplaySnapshot;
  frames: ReplayObservationFrame[];
  decks: number[][];
  honestSeats: [boolean, boolean];
  analysisVisibility: ReplayAnalysisVisibility;
  gameContext: ReplayGameContext | null;
  decisionAnalyses: ReplayDecisionAnalysis[];
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
        honestSeats: honestSeatsFrom(json),
        analysisVisibility: analysisVisibilityFrom(json),
        gameContext: gameContextFrom(json),
        decisionAnalyses: replayDecisionAnalyses(json),
      };
    } catch (error) {
      failures.push(`${url}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(`Unable to load CABT replay. Tried ${failures.join('; ')}`);
}

function analysisVisibilityFrom(json: unknown): ReplayAnalysisVisibility {
  const value = (json as { analysisVisibility?: Partial<ReplayAnalysisVisibility> })?.analysisVisibility;
  if (value?.mode !== 'analysis') {
    return perspectiveVisibility;
  }
  return {
    mode: 'analysis',
    hands: value.hands === 'full' || value.hands === 'counts' ? value.hands : 'per-actor',
    prizes: value.prizes === 'full' ? 'full' : 'counts',
    ...(typeof value.warning === 'string' ? { warning: value.warning } : {}),
  };
}

function gameContextFrom(json: unknown): ReplayGameContext | null {
  const value = (json as { gameBank?: Partial<ReplayGameContext> })?.gameBank;
  if (!value || typeof value.id !== 'string' || typeof value.game_uid !== 'string') {
    return null;
  }
  const decks = Array.isArray(value.decks)
    ? value.decks.filter((deck): deck is ReplayGameContext['decks'][number] => (
      !!deck
      && typeof deck.family_name === 'string'
      && typeof deck.family_id === 'string'
      && typeof deck.deck_id === 'string'
    ))
    : [];
  return {
    id: value.id,
    game_uid: value.game_uid,
    search_depth: Number(value.search_depth) || 0,
    search_depths: Array.isArray(value.search_depths) ? value.search_depths.map(Number) : [],
    model_name: typeof value.model_name === 'string' ? value.model_name : 'unknown',
    model_dtype: typeof value.model_dtype === 'string' ? value.model_dtype : '',
    source: typeof value.source === 'string' ? value.source : '',
    decks,
  };
}

// Per-seat honesty: a seat is scorable when ITS OWN hand is present. Raw
// pre-conceal frames carry every acting seat's hand, so both seats are honest.
// Otherwise inspect the concealed frames: for each seat, its own decision frames
// (yourIndex === seat) must show that seat's hand (omniscient records show both
// on every frame; a legacy save hid the opponent's).
function honestSeatsFrom(json: unknown): [boolean, boolean] {
  const source = json as { rawVisualize?: unknown; visualize?: unknown };
  if (Array.isArray(source?.rawVisualize) && source.rawVisualize.length > 0) {
    return [true, true];
  }
  const visualize = source?.visualize;
  if (!Array.isArray(visualize) || !visualize.length) {
    return [false, false];
  }
  const handVisibleForOwnDecisions = (seat: number): boolean => {
    const own = visualize.filter((frame) => (frame as { current?: { yourIndex?: number } })?.current?.yourIndex === seat);
    if (!own.length) {
      return false;
    }
    return own.every((frame) => {
      const players = (frame as { current?: { players?: unknown[] } })?.current?.players;
      return Array.isArray(players) && (players[seat] as { hand?: unknown })?.hand != null;
    });
  };
  return [handVisibleForOwnDecisions(0), handVisibleForOwnDecisions(1)];
}

function observationFramesFrom(json: unknown): ReplayObservationFrame[] {
  // Prefer the raw (pre-conceal) frames when present: they carry each acting
  // seat's own hand, so BOTH seats' value lines are honest. Fall back to the
  // concealed playback frames (legacy saves) or an already-omniscient
  // spectator/Kaggle replay. Indexed identically to `visualize` (stateIndex).
  const source = (json as { rawVisualize?: unknown; visualize?: unknown });
  const visualize = Array.isArray(source?.rawVisualize) ? source.rawVisualize : source?.visualize;
  if (!Array.isArray(visualize)) {
    return [];
  }
  return visualize.map((frame, stateIndex) => {
    const sbi = (frame as { search_begin_input?: unknown })?.search_begin_input;
    return {
      current: (frame as { current?: unknown })?.current ?? null,
      select: (frame as { select?: unknown })?.select ?? null,
      stateIndex,
      searchBeginInput: typeof sbi === 'string' ? sbi : null,
    };
  });
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
