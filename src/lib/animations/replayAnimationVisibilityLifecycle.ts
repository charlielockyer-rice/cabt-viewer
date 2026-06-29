import { replayAnimationVisibility, type AnimationVisibilityToken } from './animationVisibility';
import { releaseAnimationVisibilityScope } from './animationVisibilityClaims';
import { replayAnimationClaimTiming, replayAnimationScopeExitSettleMs } from './replayAnimationHandoff';
import type { ReplayAnimationPhasePlan } from './replayAnimationPlan';

type AnimationVisibilityLifecycleManager = Pick<typeof replayAnimationVisibility, 'hide' | 'release'>;

export type ReplayAnimationVisibilityLifecycleUpdate = {
  active: boolean;
  scopeKey: string | number;
  animationPlan?: ReplayAnimationPhasePlan;
  reduceMotion: boolean;
};

export type ReplayAnimationVisibilityLifecycleOptions = {
  manager?: AnimationVisibilityLifecycleManager;
  releaseScope?: (scopeKey: string) => number;
  refresh?: () => void;
  scopeExitSettleMs?: number;
  staleScopeReleaseMs?: number;
};

const defaultStaleScopeReleaseMs = 220;

export class ReplayAnimationVisibilityLifecycle {
  #lastActive = false;
  #lastScopeKey: string | undefined;
  #lastPlan: ReplayAnimationPhasePlan | undefined;
  #lastReduceMotion = false;
  #planTokens: AnimationVisibilityToken[] = [];
  #planTokenStartTimers: ReturnType<typeof setTimeout>[] = [];
  #planTokenReleaseTimers: ReturnType<typeof setTimeout>[] = [];
  #delayedPlanTokenReleaseTimers: {
    timer: ReturnType<typeof setTimeout>;
    tokens: AnimationVisibilityToken[];
  }[] = [];
  #staleScopeReleaseTimers: ReturnType<typeof setTimeout>[] = [];
  readonly #manager: AnimationVisibilityLifecycleManager;
  readonly #releaseScope: (scopeKey: string) => number;
  readonly #refresh: () => void;
  readonly #scopeExitSettleMs: number;
  readonly #staleScopeReleaseMs: number;

  constructor(options: ReplayAnimationVisibilityLifecycleOptions = {}) {
    this.#manager = options.manager ?? replayAnimationVisibility;
    this.#releaseScope = options.releaseScope ?? releaseAnimationVisibilityScope;
    this.#refresh = options.refresh ?? (() => replayAnimationVisibility.refresh());
    this.#scopeExitSettleMs = options.scopeExitSettleMs ?? replayAnimationScopeExitSettleMs;
    this.#staleScopeReleaseMs = options.staleScopeReleaseMs ?? defaultStaleScopeReleaseMs;
  }

  update({
    active,
    scopeKey,
    animationPlan,
    reduceMotion,
  }: ReplayAnimationVisibilityLifecycleUpdate) {
    const currentScopeKey = String(scopeKey);
    const scopeChanged = this.#lastScopeKey !== undefined && this.#lastScopeKey !== currentScopeKey;
    const planChanged = this.#lastPlan !== animationPlan;
    const motionPreferenceChanged = this.#lastReduceMotion !== reduceMotion;
    const activated = active && !this.#lastActive;
    this.#lastReduceMotion = reduceMotion;

    if (!active) {
      this.releasePlanTokens();
      this.clearStaleScopeReleaseTimers();
      if (this.#lastScopeKey) {
        this.#releaseScope(this.#lastScopeKey);
        this.#lastScopeKey = undefined;
      }
      this.#lastPlan = undefined;
      this.#lastActive = false;
      this.#refresh();
      return;
    }

    if (scopeChanged && this.#lastScopeKey) {
      this.releasePlanTokens({ delayMs: this.#scopeExitSettleMs });
      this.scheduleStaleScopeRelease(this.#lastScopeKey);
    } else if (planChanged || motionPreferenceChanged || activated) {
      this.releasePlanTokens();
    } else {
      this.#refresh();
      return;
    }

    this.#lastActive = true;
    this.#lastScopeKey = currentScopeKey;
    this.#lastPlan = animationPlan;

    this.schedulePlanClaims(currentScopeKey, animationPlan, reduceMotion);
    this.#refresh();
  }

  destroy() {
    this.releasePlanTokens();
    this.clearStaleScopeReleaseTimers();
    if (this.#lastScopeKey) {
      this.#releaseScope(this.#lastScopeKey);
      this.#lastScopeKey = undefined;
    }
    this.#lastActive = false;
  }

  private schedulePlanClaims(
    currentScopeKey: string,
    currentPlan: ReplayAnimationPhasePlan | undefined,
    reduceMotion: boolean,
  ) {
    if (!currentPlan?.visibilityClaims.length || reduceMotion) {
      return;
    }
    for (const claim of currentPlan.visibilityClaims) {
      const timing = replayAnimationClaimTiming(currentPlan, claim);
      if (!timing) {
        continue;
      }
      const startMs = timing.startMs;
      const startClaim = () => {
        const token = this.#manager.hide({
          ...claim,
          scopeKey: currentScopeKey,
        });
        const releaseMs = timing.releaseMs;
        this.#planTokens = [...this.#planTokens, token];
        if (releaseMs === undefined) {
          return;
        }
        const releaseTimer = setTimeout(() => {
          this.#manager.release(token);
          this.#planTokens = this.#planTokens.filter((candidate) => candidate !== token);
          const timerIndex = this.#planTokenReleaseTimers.indexOf(releaseTimer);
          if (timerIndex >= 0) {
            this.#planTokenReleaseTimers.splice(timerIndex, 1);
          }
          this.#refresh();
        }, Math.max(0, releaseMs - startMs));
        this.#planTokenReleaseTimers.push(releaseTimer);
      };
      if (startMs <= 0) {
        startClaim();
        continue;
      }
      const startTimer = setTimeout(() => {
        const timerIndex = this.#planTokenStartTimers.indexOf(startTimer);
        if (timerIndex >= 0) {
          this.#planTokenStartTimers.splice(timerIndex, 1);
        }
        startClaim();
      }, startMs);
      this.#planTokenStartTimers.push(startTimer);
    }
  }

  private releasePlanTokens({ delayMs = 0 }: { delayMs?: number } = {}) {
    this.flushDelayedPlanTokenReleases();
    for (const timer of this.#planTokenStartTimers) {
      clearTimeout(timer);
    }
    this.#planTokenStartTimers.length = 0;
    for (const timer of this.#planTokenReleaseTimers) {
      clearTimeout(timer);
    }
    this.#planTokenReleaseTimers.length = 0;
    const tokens = this.#planTokens;
    this.#planTokens = [];
    if (delayMs > 0 && tokens.length) {
      this.scheduleDelayedPlanTokenRelease(tokens, delayMs);
      return;
    }
    for (const token of tokens) {
      this.#manager.release(token);
    }
  }

  private scheduleDelayedPlanTokenRelease(tokens: AnimationVisibilityToken[], delayMs: number) {
    const delayedRelease = {
      tokens,
      timer: setTimeout(() => {
        const timerIndex = this.#delayedPlanTokenReleaseTimers.indexOf(delayedRelease);
        if (timerIndex >= 0) {
          this.#delayedPlanTokenReleaseTimers.splice(timerIndex, 1);
        }
        this.releaseTokens(tokens);
      }, delayMs),
    };
    this.#delayedPlanTokenReleaseTimers.push(delayedRelease);
  }

  private flushDelayedPlanTokenReleases() {
    const delayedReleases = this.#delayedPlanTokenReleaseTimers.splice(0);
    for (const delayedRelease of delayedReleases) {
      clearTimeout(delayedRelease.timer);
      this.releaseTokens(delayedRelease.tokens);
    }
  }

  private releaseTokens(tokens: AnimationVisibilityToken[]) {
    for (const token of tokens) {
      this.#manager.release(token);
    }
    this.#refresh();
  }

  private scheduleStaleScopeRelease(scopeKey: string) {
    const timer = setTimeout(() => {
      const timerIndex = this.#staleScopeReleaseTimers.indexOf(timer);
      if (timerIndex >= 0) {
        this.#staleScopeReleaseTimers.splice(timerIndex, 1);
      }
      if (this.#lastScopeKey !== scopeKey) {
        this.#releaseScope(scopeKey);
        this.#refresh();
      }
    }, this.#staleScopeReleaseMs);
    this.#staleScopeReleaseTimers.push(timer);
  }

  private clearStaleScopeReleaseTimers() {
    for (const timer of this.#staleScopeReleaseTimers) {
      clearTimeout(timer);
    }
    this.#staleScopeReleaseTimers.length = 0;
  }
}
