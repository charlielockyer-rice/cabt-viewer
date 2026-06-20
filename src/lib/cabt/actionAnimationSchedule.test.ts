import { describe, expect, it } from 'vitest';
import { actionAnimationBatchEvents, actionAnimationStartMs, actionAnimationTiming } from './actionAnimationSchedule';
import { CabtAreaType } from './types';
import type { ActionTimelineEvent } from '../game/types';

describe('actionAnimationStartMs', () => {
  it('sequences Lillie-style play, hand return, shuffle, and draw phases', () => {
    const events: ActionTimelineEvent[] = [
      event(1, 'Play', { cardId: 1227, serial: 80 }),
      event(2, 'MoveCard', { cardId: 3, serial: 102, fromArea: CabtAreaType.HAND, toArea: CabtAreaType.DECK }),
      event(3, 'MoveCard', { cardId: 3, serial: 100, fromArea: CabtAreaType.HAND, toArea: CabtAreaType.DECK }),
      event(4, 'Shuffle', {}),
      event(5, 'Draw', { cardId: 3, serial: 122 }),
      event(6, 'Draw', { cardId: 1145, serial: 77 }),
    ];

    expect(actionAnimationStartMs(events, events[0])).toBe(0);
    expect(actionAnimationStartMs(events, events[1])).toBe(actionAnimationTiming.handMoveMs);
    expect(actionAnimationStartMs(events, events[2])).toBe(actionAnimationTiming.handMoveMs + actionAnimationTiming.handMoveStepMs);
    expect(actionAnimationStartMs(events, events[3])).toBe(
      actionAnimationTiming.handMoveMs
        + actionAnimationTiming.handMoveMs
        + actionAnimationTiming.handMoveStepMs,
    );
    expect(actionAnimationStartMs(events, events[4])).toBe(
      actionAnimationTiming.handMoveMs
        + actionAnimationTiming.handMoveMs
        + actionAnimationTiming.handMoveStepMs
        + actionAnimationTiming.deckShuffleMs,
    );
    expect(actionAnimationStartMs(events, events[5])).toBe(
      actionAnimationTiming.handMoveMs
        + actionAnimationTiming.handMoveMs
        + actionAnimationTiming.handMoveStepMs
        + actionAnimationTiming.deckShuffleMs
        + actionAnimationTiming.deckDrawStepMs,
    );
  });

  it('does not let non-animated events add delay', () => {
    const events: ActionTimelineEvent[] = [
      event(1, 'Attack', { cardId: 721 }),
      event(2, 'HpChange', { value: -30 }),
      event(3, 'Draw', { cardId: 3, serial: 12 }),
    ];

    expect(actionAnimationStartMs(events, events[2])).toBe(0);
  });

  it('sequences deck reveal cards after a played supporter', () => {
    const events: ActionTimelineEvent[] = [
      event(1, 'Play', { cardId: 1235, serial: 26 }),
      event(2, 'MoveCard', { cardId: 3, serial: 32, fromArea: CabtAreaType.DECK, toArea: CabtAreaType.LOOKING }),
      event(3, 'MoveCard', { cardId: 3, serial: 58, fromArea: CabtAreaType.DECK, toArea: CabtAreaType.LOOKING }),
    ];

    expect(actionAnimationStartMs(events, events[1])).toBe(actionAnimationTiming.handMoveMs);
    expect(actionAnimationStartMs(events, events[2])).toBe(actionAnimationTiming.handMoveMs + actionAnimationTiming.deckRevealStepMs);
  });

  it('sequences revealed cards returning before the follow-up shuffle', () => {
    const events: ActionTimelineEvent[] = [
      event(1, 'MoveCard', { cardId: 3, serial: 58, fromArea: CabtAreaType.LOOKING, toArea: CabtAreaType.DECK }),
      event(2, 'MoveCard', { cardId: 1227, serial: 22, fromArea: CabtAreaType.LOOKING, toArea: CabtAreaType.DECK }),
      event(3, 'Shuffle', {}),
    ];

    expect(actionAnimationStartMs(events, events[1])).toBe(actionAnimationTiming.deckRevealReturnStepMs);
    expect(actionAnimationStartMs(events, events[2])).toBe(
      actionAnimationTiming.deckRevealReturnMs + actionAnimationTiming.deckRevealReturnStepMs,
    );
  });
});

describe('actionAnimationBatchEvents', () => {
  it('scopes live animation scheduling to newly appended timeline events', () => {
    const events: ActionTimelineEvent[] = [
      event(1, 'Play', { cardId: 1, serial: 10 }),
      event(2, 'Shuffle', {}),
      event(3, 'Play', { cardId: 2, serial: 11 }),
      event(4, 'Draw', { cardId: 3, serial: 12 }),
    ];

    expect(actionAnimationBatchEvents(events, new Set([1, 2]), false, true)).toEqual([
      events[2],
      events[3],
    ]);
    expect(actionAnimationStartMs(actionAnimationBatchEvents(events, new Set([1, 2]), false, true), events[3])).toBe(
      actionAnimationTiming.handMoveMs,
    );
  });

  it('replays the full phase event set when a replay scope changes', () => {
    const events: ActionTimelineEvent[] = [
      event(1, 'Draw', { cardId: 3, serial: 12 }),
      event(2, 'Draw', { cardId: 4, serial: 13 }),
    ];

    expect(actionAnimationBatchEvents(events, new Set([1, 2]), true, true)).toEqual(events);
  });
});

function event(id: number, kind: string, params: Record<string, unknown>): ActionTimelineEvent {
  return {
    id,
    kind,
    playerIndex: 1,
    message: kind,
    params: {
      type: kind,
      playerIndex: 1,
      ...params,
    },
  };
}
