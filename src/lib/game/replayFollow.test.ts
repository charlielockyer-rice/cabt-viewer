import { describe, expect, it } from 'vitest';
import { replayFollowPlayerForPosition, replayFollowPlayerForStep } from './replayFollow';

describe('replayFollowPlayerForStep', () => {
  it('switches to the next player on a turn-end step', () => {
    expect(replayFollowPlayerForStep({
      actionTimeline: [
        { id: 1, kind: 'TurnEnd', playerIndex: 1, message: 'Player 2 ended their turn.' },
      ],
    })).toBe(0);
  });

  it('follows the starting player before deterministic turn-start draw events resolve', () => {
    expect(replayFollowPlayerForStep({
      actionTimeline: [
        { id: 1, kind: 'TurnStart', playerIndex: 0, message: 'Player 1 turn started.' },
        { id: 2, kind: 'Draw', playerIndex: 0, message: 'Player 1 drew a card.' },
      ],
    })).toBe(0);
  });

  it('does not switch early on non-turn-boundary action steps', () => {
    expect(replayFollowPlayerForStep({
      actionTimeline: [
        { id: 1, kind: 'Attack', playerIndex: 1, message: 'Player 2 attacked.' },
        { id: 2, kind: 'HpChange', playerIndex: 0, message: 'Player 1 took damage.' },
      ],
    })).toBeUndefined();
  });

  it('ignores missing or unsupported player indexes', () => {
    expect(replayFollowPlayerForStep(null)).toBeUndefined();
    expect(replayFollowPlayerForStep({
      actionTimeline: [
        { id: 1, kind: 'TurnEnd', playerIndex: 2, message: 'Invalid player ended their turn.' },
      ],
    })).toBeUndefined();
  });
});

describe('replayFollowPlayerForPosition', () => {
  const steps = [
    {
      actionTimeline: [
        { id: 1, kind: 'TurnStart', playerIndex: 1, message: 'Player 2 turn started.' },
        { id: 2, kind: 'Draw', playerIndex: 1, message: 'Player 2 drew a card.' },
      ],
    },
    {
      actionTimeline: [
        { id: 3, kind: 'Attack', playerIndex: 1, message: 'Player 2 attacked.' },
      ],
    },
    {
      actionTimeline: [
        { id: 4, kind: 'TurnEnd', playerIndex: 1, message: 'Player 2 ended their turn.' },
      ],
    },
    {
      actionTimeline: [
        { id: 5, kind: 'TurnStart', playerIndex: 0, message: 'Player 1 turn started.' },
        { id: 6, kind: 'Draw', playerIndex: 0, message: 'Player 1 drew a card.' },
      ],
    },
  ];

  it('carries the current player through non-boundary steps', () => {
    expect(replayFollowPlayerForPosition(steps, 1)).toBe(1);
  });

  it('switches at turn end before the next draw', () => {
    expect(replayFollowPlayerForPosition(steps, 2)).toBe(0);
    expect(replayFollowPlayerForPosition(steps, 3)).toBe(0);
  });

  it('reverts when stepping backward before the turn-end boundary', () => {
    expect(replayFollowPlayerForPosition(steps, 3)).toBe(0);
    expect(replayFollowPlayerForPosition(steps, 2)).toBe(0);
    expect(replayFollowPlayerForPosition(steps, 1)).toBe(1);
  });

  it('returns undefined when no prior turn boundary exists', () => {
    expect(replayFollowPlayerForPosition([{ actionTimeline: [{ id: 1, kind: 'Attack', playerIndex: 0, message: 'Attack.' }] }], 0)).toBeUndefined();
  });
});
