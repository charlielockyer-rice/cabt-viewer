import { describe, expect, it } from 'vitest';
import {
  isDeckBoardPlacementEvent,
  isLiveBoardMoveEvent,
} from './replayBoardMoveEvents';
import { CabtAreaType } from './types';
import type { ActionTimelineEvent } from '../game/types';

describe('isLiveBoardMoveEvent', () => {
  it('recognizes live board movement shapes', () => {
    expect(isLiveBoardMoveEvent(event('Switch', {}))).toBe(true);
    expect(isLiveBoardMoveEvent(move(CabtAreaType.ACTIVE, CabtAreaType.BENCH))).toBe(true);
    expect(isLiveBoardMoveEvent(move(CabtAreaType.BENCH, CabtAreaType.ACTIVE))).toBe(true);
    expect(isLiveBoardMoveEvent(move(CabtAreaType.DECK, CabtAreaType.ACTIVE))).toBe(true);
    expect(isLiveBoardMoveEvent(move(CabtAreaType.DECK, CabtAreaType.BENCH))).toBe(true);
    expect(isLiveBoardMoveEvent(move(CabtAreaType.ACTIVE, CabtAreaType.DECK))).toBe(true);
    expect(isLiveBoardMoveEvent(move(CabtAreaType.BENCH, CabtAreaType.DECK))).toBe(true);
    expect(isLiveBoardMoveEvent(move(CabtAreaType.ACTIVE, CabtAreaType.DISCARD))).toBe(true);
    expect(isLiveBoardMoveEvent(move(CabtAreaType.BENCH, CabtAreaType.DISCARD))).toBe(true);
    expect(isLiveBoardMoveEvent(move(CabtAreaType.STADIUM, CabtAreaType.DISCARD))).toBe(true);
  });

  it('excludes non-board or malformed moves', () => {
    expect(isLiveBoardMoveEvent(move(CabtAreaType.HAND, CabtAreaType.BENCH))).toBe(false);
    expect(isLiveBoardMoveEvent(move(CabtAreaType.DECK, CabtAreaType.PRIZE))).toBe(false);
    expect(isLiveBoardMoveEvent(event('MoveCardReverse', {
      fromArea: CabtAreaType.DECK,
      toArea: CabtAreaType.ACTIVE,
    }))).toBe(false);
    expect(isLiveBoardMoveEvent(event('MoveCard', {
      fromArea: CabtAreaType.DECK,
    }))).toBe(false);
  });
});

describe('isDeckBoardPlacementEvent', () => {
  it('recognizes deck-to-board placements only', () => {
    expect(isDeckBoardPlacementEvent(move(CabtAreaType.DECK, CabtAreaType.ACTIVE))).toBe(true);
    expect(isDeckBoardPlacementEvent(move(CabtAreaType.DECK, CabtAreaType.BENCH))).toBe(true);
    expect(isDeckBoardPlacementEvent(move(CabtAreaType.DECK, CabtAreaType.HAND))).toBe(false);
    expect(isDeckBoardPlacementEvent(move(CabtAreaType.HAND, CabtAreaType.BENCH))).toBe(false);
  });
});

function move(fromArea: CabtAreaType, toArea: CabtAreaType): ActionTimelineEvent {
  return event('MoveCard', { fromArea, toArea });
}

function event(kind: string, params: Record<string, unknown>): ActionTimelineEvent {
  return {
    id: 1,
    kind,
    playerIndex: 0,
    params,
  };
}
