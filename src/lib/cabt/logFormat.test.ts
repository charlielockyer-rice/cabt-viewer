import { describe, expect, it } from 'vitest';
import { CabtAreaType, CabtLogType } from './types';
import { cabtLogsToTimeline, formatCabtLog } from './logFormat';

describe('CABT log formatting', () => {
  it('describes attack, deterministic discard, damage, and prize events', () => {
    expect(formatCabtLog({
      type: CabtLogType.ATTACK,
      playerIndex: 0,
      cardId: 723,
      attackId: 1046,
    })).toBe('Player 1 used Hammer-lanche with Mega Abomasnow ex.');

    expect(formatCabtLog({
      type: CabtLogType.MOVE_CARD,
      playerIndex: 0,
      cardId: 3,
      fromArea: CabtAreaType.DECK,
      toArea: CabtAreaType.DISCARD,
    })).toBe('Player 1 discarded Basic Water Energy from the deck.');

    expect(formatCabtLog({
      type: CabtLogType.MOVE_CARD,
      playerIndex: 0,
      cardId: 3,
      fromArea: CabtAreaType.DECK,
      toArea: CabtAreaType.PRIZE,
    })).toBe('Player 1 set a Prize card.');

    expect(formatCabtLog({
      type: CabtLogType.MOVE_CARD,
      playerIndex: 1,
      cardId: 1158,
      fromArea: CabtAreaType.HAND,
      toArea: CabtAreaType.DECK,
    })).toBe('Player 2 moved a card from hand to deck.');

    expect(formatCabtLog({
      type: CabtLogType.HP_CHANGE,
      playerIndex: 1,
      cardId: 722,
      value: -200,
    })).toBe("Player 2's Snover took 200 damage.");

    expect(formatCabtLog({
      type: CabtLogType.MOVE_CARD_REVERSE,
      playerIndex: 0,
      fromArea: CabtAreaType.PRIZE,
      toArea: CabtAreaType.HAND,
    })).toBe('Player 1 moved a facedown card from prize to hand.');
  });

  it('assigns stable ids when converting log batches to timeline events', () => {
    const result = cabtLogsToTimeline([
      { type: CabtLogType.TURN_START, playerIndex: 1 },
      { type: CabtLogType.TURN_END, playerIndex: 1 },
    ], { nextId: 7 });

    expect(result.nextId).toBe(9);
    expect(result.events).toEqual([
      expect.objectContaining({ id: 7, message: 'Player 2 turn started.', kind: 'TurnStart' }),
      expect.objectContaining({ id: 8, message: 'Player 2 ended their turn.', kind: 'TurnEnd' }),
    ]);
  });
});
