import { describe, expect, it } from 'vitest';
import { cabtReplayStepLabel } from './replayStepLabels';
import { CabtAreaType, CabtLogType } from './types';

describe('cabtReplayStepLabel', () => {
  it('summarizes grouped prize takes before falling back to the latest log', () => {
    expect(cabtReplayStepLabel({
      logs: [
        {
          type: 'MoveCard',
          playerIndex: 0,
          cardId: 3,
          fromArea: CabtAreaType.PRIZE,
          toArea: CabtAreaType.HAND,
        },
        {
          type: 'MoveCard',
          playerIndex: 0,
          cardId: 4,
          fromArea: CabtAreaType.PRIZE,
          toArea: CabtAreaType.HAND,
        },
      ],
    }, 7)).toBe('Player 1 took 2 Prize cards.');
  });

  it('uses the attack log when a frame contains an attack', () => {
    expect(cabtReplayStepLabel({
      logs: [
        { type: CabtLogType.TURN_START, playerIndex: 0 },
        { type: CabtLogType.ATTACK, playerIndex: 0, cardId: 723, attackId: 1046 },
      ],
    }, 3)).toBe('Player 1 used Hammer-lanche with Mega Abomasnow ex.');
  });

  it('labels prompt-only and empty frames', () => {
    expect(cabtReplayStepLabel({ select: { type: 'Choose', context: 'ATTACK' } }, 4)).toBe('Choose · ATTACK');
    expect(cabtReplayStepLabel({}, 0)).toBe('Initial state');
    expect(cabtReplayStepLabel({}, 5)).toBe('Frame 5');
  });
});
