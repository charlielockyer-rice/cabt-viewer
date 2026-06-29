import { describe, expect, it } from 'vitest';
import { persistentActionLabel, replayActionGroups } from './replayActionGroups';
import { CabtAreaType } from './types';
import type { ActionTimelineEvent } from '../game/types';

describe('replayActionGroups', () => {
  it('summarizes batched prize setup moves', () => {
    const groups = replayActionGroups([
      event(1, 'MoveCard', 'Player 1 set a Prize card.', {
        fromArea: CabtAreaType.DECK,
        toArea: CabtAreaType.PRIZE,
        cardId: 1,
      }),
      event(2, 'MoveCard', 'Player 1 set a Prize card.', {
        fromArea: CabtAreaType.DECK,
        toArea: CabtAreaType.PRIZE,
        cardId: 2,
      }),
    ], 0);

    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe('Player 1 set 2 Prize cards.');
  });

  it('starts Pokemon Checkup after turn end', () => {
    const groups = replayActionGroups([
      event(1, 'TurnEnd', 'Player 1 ended their turn.'),
      event(2, 'HPChange', "Player 1's Pokemon took 10 damage."),
    ], 2);

    expect(groups.map((group) => group.type)).toEqual(['TurnEnd', 'PokemonCheckup']);
    expect(groups[1].label).toBe('Pokemon Checkup.');
  });
});

describe('persistentActionLabel', () => {
  it('keeps the played card in labels for multi-phase card effects', () => {
    expect(persistentActionLabel('Player 1 drew Basic Water Energy.', [
      event(1, 'Play', 'Player 1 played Basic Water Energy.', { cardId: 3 }),
      event(2, 'Draw', 'Player 1 drew Basic Water Energy.', { cardId: 4 }),
      event(3, 'Draw', 'Player 1 drew Pikachu.', { cardId: 5 }),
    ])).toBe('Player 1 played Basic Water Energy and drew 2 cards.');
  });
});

function event(
  id: number,
  kind: string,
  message: string,
  params: Record<string, unknown> = {},
): ActionTimelineEvent {
  return {
    id,
    kind,
    message,
    playerIndex: 0,
    params,
  };
}
