import { describe, expect, it } from 'vitest';
import { tick } from 'svelte';
import { createReplayPhasePlanRunner } from './replayPhasePlanRunner.svelte';
import type { AnimationMotion, ReplayAnimationPhaseKind, ReplayAnimationPhasePlan } from './replayAnimationPlan';
import type { ActionTimelineEvent, GameView } from '../game/types';

describe('createReplayPhasePlanRunner', () => {
  it('starts planned motions once per scope and plan key', async () => {
    const started: string[][] = [];
    const runner = createReplayPhasePlanRunner({
      reduceMotion: () => false,
      selectMotions: (plan) => plan?.motions ?? [],
      startPlanned: (motions) => {
        started.push(motions.map((motion) => motion.id));
      },
    });
    const event = timelineEvent(10);
    const plan = phasePlan('Draw:0', 'Draw', [motion('draw-a')]);

    expect(runner.update({ events: [event], scopeKey: 'step-a', replayMode: true, animationPlan: plan }).handled).toBe(true);
    expect(runner.update({ events: [event], scopeKey: 'step-a', replayMode: true, animationPlan: plan }).handled).toBe(true);
    await flushPlannedStart();

    expect(started).toEqual([['draw-a']]);
    expect(runner.seenEventIds.has(event.id)).toBe(true);
  });

  it('settles on scope change and clears on same-scope plan change', async () => {
    const lifecycle: string[] = [];
    const runner = createReplayPhasePlanRunner({
      reduceMotion: () => false,
      selectMotions: (plan) => plan?.motions ?? [],
      onScopeChange: () => lifecycle.push('scope'),
      onPlanChange: () => lifecycle.push('plan'),
      startPlanned: (motions) => lifecycle.push(`start:${motions[0]?.id}`),
    });

    runner.update({ scopeKey: 'step-a', replayMode: true, animationPlan: phasePlan('Draw:0', 'Draw', [motion('draw-a')]) });
    await flushPlannedStart();
    runner.update({ scopeKey: 'step-a', replayMode: true, animationPlan: phasePlan('Draw:0', 'Draw', [motion('draw-b')]) });
    await flushPlannedStart();
    runner.update({ scopeKey: 'step-b', replayMode: true, animationPlan: phasePlan('Draw:0', 'Draw', [motion('draw-b')]) });
    await flushPlannedStart();

    expect(lifecycle).toEqual(['start:draw-a', 'plan', 'start:draw-b', 'scope', 'start:draw-b']);
  });

  it('does not start stale planned motions after scope changes before render', async () => {
    const started: string[] = [];
    const runner = createReplayPhasePlanRunner({
      reduceMotion: () => false,
      selectMotions: (plan) => plan?.motions ?? [],
      startPlanned: (motions) => started.push(...motions.map((motion) => motion.id)),
    });

    runner.update({ scopeKey: 'step-a', replayMode: true, animationPlan: phasePlan('Draw:0', 'Draw', [motion('draw-a')]) });
    runner.update({ scopeKey: 'step-b', replayMode: true, animationPlan: phasePlan('Draw:0', 'Draw', [motion('draw-b')]) });
    await flushPlannedStart();

    expect(started).toEqual(['draw-b']);
  });

  it('can limit lifecycle hooks to replay mode', () => {
    const lifecycle: string[] = [];
    const runner = createReplayPhasePlanRunner({
      reduceMotion: () => false,
      lifecycle: 'replay',
      selectMotions: () => [],
      onScopeChange: () => lifecycle.push('scope'),
      onPlanChange: () => lifecycle.push('plan'),
    });

    runner.update({ scopeKey: 'live-a', replayMode: false });
    runner.update({ scopeKey: 'live-b', replayMode: false });
    runner.update({ scopeKey: 'replay-a', replayMode: true });
    runner.update({ scopeKey: 'replay-b', replayMode: true });

    expect(lifecycle).toEqual(['scope', 'scope']);
  });

  it('suppresses live animation paths in replay mode even when there is no plan', () => {
    const runner = createReplayPhasePlanRunner({
      reduceMotion: () => false,
      selectMotions: () => [],
    });
    const event = timelineEvent(12);

    const first = runner.update({ events: [event], scopeKey: 'step-a', replayMode: true });
    const second = runner.update({ events: [event], scopeKey: 'step-b', replayMode: true });

    expect(first.handled).toBe(true);
    expect(second.handled).toBe(true);
    expect(runner.seenEventIds.has(event.id)).toBe(true);
  });

  it('lets live non-replay paths run after the initial render', () => {
    const runner = createReplayPhasePlanRunner({
      reduceMotion: () => false,
      selectMotions: () => [],
    });

    expect(runner.update({ scopeKey: 'step-a', replayMode: false }).handled).toBe(true);
    expect(runner.update({ scopeKey: 'step-b', replayMode: false }).handled).toBe(false);
  });

  it('does not start planned motions outside replay mode', () => {
    const started: string[] = [];
    const runner = createReplayPhasePlanRunner({
      reduceMotion: () => false,
      selectMotions: (plan) => plan?.motions ?? [],
      startPlanned: (motions) => started.push(...motions.map((motion) => motion.id)),
    });
    const plan = phasePlan('Draw:0', 'Draw', [motion('draw-a')]);

    expect(runner.update({ scopeKey: 'step-a', replayMode: false, animationPlan: plan }).handled).toBe(true);
    expect(runner.update({ scopeKey: 'step-b', replayMode: false, animationPlan: plan }).handled).toBe(false);
    expect(started).toEqual([]);
  });

  it('marks events seen without starting planned motions when reduced motion is active', () => {
    const started: string[] = [];
    const runner = createReplayPhasePlanRunner({
      reduceMotion: () => true,
      selectMotions: (plan) => plan?.motions ?? [],
      startPlanned: (motions) => started.push(...motions.map((motion) => motion.id)),
    });
    const event = timelineEvent(14);

    const result = runner.update({
      events: [event],
      scopeKey: 'step-a',
      replayMode: true,
      animationPlan: phasePlan('Shuffle:0', 'Shuffle', [motion('shuffle-a')]),
    });

    expect(result.handled).toBe(true);
    expect(result.reduceMotion).toBe(true);
    expect(started).toEqual([]);
    expect(runner.seenEventIds.has(event.id)).toBe(true);
  });
});

function phasePlan(
  key: string,
  kind: ReplayAnimationPhaseKind,
  motions: AnimationMotion[],
): ReplayAnimationPhasePlan {
  return {
    key,
    kind,
    view: {} as GameView,
    durationMs: 500,
    motions,
    visibilityClaims: [],
  };
}

async function flushPlannedStart() {
  await tick();
  await Promise.resolve();
}

function motion(id: string): AnimationMotion {
  return {
    kind: 'shuffle',
    id,
    anchor: { kind: 'deck-top', playerIndex: 0 },
    coordinateSpace: 'board',
    startMs: 0,
    durationMs: 300,
  };
}

function timelineEvent(id: number): ActionTimelineEvent {
  return {
    id,
    kind: 'Draw',
    playerIndex: 0,
    message: 'Draw',
  };
}
