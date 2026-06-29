import { describe, expect, it } from 'vitest';
import { ReplayAnimationRunState } from './replayAnimationRunState';
import type { ActionTimelineEvent } from '../game/types';

describe('ReplayAnimationRunState', () => {
  it('tracks first run, plan changes, and scope changes', () => {
    const state = new ReplayAnimationRunState();

    expect(state.update('scope-a', 'plan-a')).toEqual({
      firstRun: true,
      scopeChanged: false,
      planChanged: true,
      shouldStartPlan: true,
    });

    expect(state.update('scope-a', 'plan-a')).toEqual({
      firstRun: false,
      scopeChanged: false,
      planChanged: false,
      shouldStartPlan: false,
    });

    expect(state.update('scope-a', 'plan-b')).toEqual({
      firstRun: false,
      scopeChanged: false,
      planChanged: true,
      shouldStartPlan: true,
    });

    expect(state.update('scope-b', 'plan-b')).toEqual({
      firstRun: false,
      scopeChanged: true,
      planChanged: false,
      shouldStartPlan: true,
    });
  });

  it('records seen event ids once for all animation components', () => {
    const state = new ReplayAnimationRunState();
    const event = { id: 42 } as ActionTimelineEvent;

    expect(state.hasSeen(event)).toBe(false);

    state.markEventsSeen([event]);

    expect(state.hasSeen(event)).toBe(true);
    expect(state.seenEventIds.has(42)).toBe(true);
  });

  it('clears seen event ids when the animation scope changes', () => {
    const state = new ReplayAnimationRunState();
    const event = { id: 1 } as ActionTimelineEvent;

    state.update('scope-a', 'plan-a');
    state.markEventsSeen([event]);
    expect(state.hasSeen(event)).toBe(true);

    state.update('scope-b', 'plan-a');

    expect(state.hasSeen(event)).toBe(false);
    expect(state.seenEventIds.size).toBe(0);
  });
});
