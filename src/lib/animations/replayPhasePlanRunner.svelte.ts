import { createPrefersReducedMotion } from './prefersReducedMotion.svelte';
import { ReplayAnimationRunState, type ReplayAnimationRunChange } from './replayAnimationRunState';
import {
  replayAnimationMotionsKey,
  type AnimationMotion,
  type ReplayAnimationPhasePlan,
} from './replayAnimationPlan';
import type { ActionTimelineEvent } from '../game/types';

export type ReplayPhasePlanRunnerContext<Motion extends AnimationMotion> = {
  motions: Motion[];
  plan?: ReplayAnimationPhasePlan;
  run: ReplayAnimationRunChange;
  reduceMotion: boolean;
};

export type ReplayPhasePlanRunnerResult<Motion extends AnimationMotion> = ReplayPhasePlanRunnerContext<Motion> & {
  handled: boolean;
  seenEventIds: ReadonlySet<number>;
  markEventsSeen(events: readonly ActionTimelineEvent[]): void;
};

export type ReplayPhasePlanRunnerOptions<Motion extends AnimationMotion> = {
  selectMotions(plan: ReplayAnimationPhasePlan | undefined): Motion[];
  planKey?: (motions: readonly Motion[], plan: ReplayAnimationPhasePlan | undefined) => string;
  reduceMotion?: () => boolean;
  lifecycle?: 'always' | 'replay';
  onScopeChange?: (context: ReplayPhasePlanRunnerContext<Motion>) => void;
  onPlanChange?: (context: ReplayPhasePlanRunnerContext<Motion>) => void;
  startPlanned?: (motions: Motion[], context: ReplayPhasePlanRunnerContext<Motion>) => void;
};

export function createReplayPhasePlanRunner<Motion extends AnimationMotion>(
  options: ReplayPhasePlanRunnerOptions<Motion>,
) {
  const runState = new ReplayAnimationRunState();
  const prefersReducedMotion = options.reduceMotion ? undefined : createPrefersReducedMotion();
  const motionPlanKey = options.planKey ?? selectedMotionPlanKey;
  const reduceMotion = () => options.reduceMotion?.() ?? Boolean(prefersReducedMotion?.current);

  function update(input: {
    events?: readonly ActionTimelineEvent[];
    scopeKey?: string | number;
    replayMode?: boolean;
    animationPlan?: ReplayAnimationPhasePlan;
  }): ReplayPhasePlanRunnerResult<Motion> {
    const events = input.events ?? [];
    const motions = options.selectMotions(input.animationPlan);
    const planKey = motionPlanKey(motions, input.animationPlan);
    const run = runState.update(input.scopeKey ?? '', planKey);
    const currentReduceMotion = reduceMotion();
    const context: ReplayPhasePlanRunnerContext<Motion> = {
      motions,
      plan: input.animationPlan,
      run,
      reduceMotion: currentReduceMotion,
    };

    const shouldRunLifecycleHook = options.lifecycle !== 'replay' || Boolean(input.replayMode);
    if (shouldRunLifecycleHook && !run.firstRun && run.scopeChanged) {
      options.onScopeChange?.(context);
    } else if (shouldRunLifecycleHook && !run.firstRun && run.planChanged) {
      options.onPlanChange?.(context);
    }

    if (input.replayMode && motions.length) {
      if (run.shouldStartPlan && !currentReduceMotion) {
        options.startPlanned?.(motions, context);
      }
      runState.markEventsSeen(events);
      return result(context, true);
    }

    if (run.firstRun || input.replayMode) {
      runState.markEventsSeen(events);
      return result(context, true);
    }

    return result(context, false);
  }

  function result(
    context: ReplayPhasePlanRunnerContext<Motion>,
    handled: boolean,
  ): ReplayPhasePlanRunnerResult<Motion> {
    return {
      ...context,
      handled,
      seenEventIds: runState.seenEventIds,
      markEventsSeen(events: readonly ActionTimelineEvent[]) {
        runState.markEventsSeen(events);
      },
    };
  }

  return {
    update,
    hasSeen(event: ActionTimelineEvent) {
      return runState.hasSeen(event);
    },
    get seenEventIds() {
      return runState.seenEventIds;
    },
    get reduceMotion() {
      return reduceMotion();
    },
  };
}

function selectedMotionPlanKey<Motion extends AnimationMotion>(
  motions: readonly Motion[],
  plan: ReplayAnimationPhasePlan | undefined,
): string {
  return plan ? `${plan.key}:${plan.durationMs}:${replayAnimationMotionsKey(motions)}` : '';
}
