import { describe, expect, it } from 'vitest';
import {
  isLiveHandPlayEvent,
  liveHandPlayTargetForEvent,
  type LiveHandPlayTargetResolver,
} from './liveHandPlayTargets';
import { CabtAreaType } from '../cabt/types';
import type { ActionTimelineEvent } from '../game/types';

describe('isLiveHandPlayEvent', () => {
  it('accepts hand plays and supported hand MoveCard events', () => {
    expect(isLiveHandPlayEvent(event('Play', { cardId: 1 }))).toBe(true);
    expect(isLiveHandPlayEvent(event('Attach', { cardId: 2 }))).toBe(true);
    expect(isLiveHandPlayEvent(event('Evolve', { cardId: 3 }))).toBe(true);
    expect(isLiveHandPlayEvent(event('MoveCard', {
      cardId: 4,
      fromArea: CabtAreaType.HAND,
      toArea: CabtAreaType.BENCH,
    }))).toBe(true);
  });

  it('rejects unsupported or cardless events', () => {
    expect(isLiveHandPlayEvent(event('Play', {}))).toBe(false);
    expect(isLiveHandPlayEvent(event('MoveCard', {
      cardId: 4,
      fromArea: CabtAreaType.DECK,
      toArea: CabtAreaType.BENCH,
    }))).toBe(false);
    expect(isLiveHandPlayEvent(event('MoveCard', {
      cardId: 4,
      fromArea: CabtAreaType.HAND,
      toArea: CabtAreaType.DECK,
    }))).toBe(false);
  });
});

describe('liveHandPlayTargetForEvent', () => {
  it('targets attach and evolve recipients by target identity', () => {
    const attachTarget = element('attach-target');
    const evolveTarget = element('evolve-target');
    const resolver = resolverWith({
      pokemon: (serial) => serial === 10 ? attachTarget : serial === 20 ? evolveTarget : null,
    });

    expect(liveHandPlayTargetForEvent(event('Attach', {
      cardId: 1,
      serialTarget: 10,
    }), resolver)).toBe(attachTarget);
    expect(liveHandPlayTargetForEvent(event('Evolve', {
      cardId: 2,
      serialTarget: 20,
    }), resolver)).toBe(evolveTarget);
  });

  it('prefers already materialized serial targets before area fallbacks', () => {
    const boardSlot = element('board-slot');
    const resolver = resolverWith({
      pokemonBySerial: (serial) => serial === 30 ? boardSlot : null,
      active: () => element('active-anchor'),
    });

    expect(liveHandPlayTargetForEvent(event('MoveCard', {
      cardId: 3,
      serial: 30,
      fromArea: CabtAreaType.HAND,
      toArea: CabtAreaType.ACTIVE,
    }), resolver)).toBe(boardSlot);
  });

  it('uses area targets for hand MoveCard fallbacks', () => {
    const discard = element('discard');
    const active = element('active');
    const bench = element('bench');
    const resolver = resolverWith({
      discard: () => discard,
      active: () => active,
      firstBench: () => bench,
    });

    expect(liveHandPlayTargetForEvent(event('MoveCard', {
      cardId: 4,
      fromArea: CabtAreaType.HAND,
      toArea: CabtAreaType.DISCARD,
    }), resolver)).toBe(discard);
    expect(liveHandPlayTargetForEvent(event('MoveCard', {
      cardId: 4,
      fromArea: CabtAreaType.HAND,
      toArea: CabtAreaType.ACTIVE,
    }), resolver)).toBe(active);
    expect(liveHandPlayTargetForEvent(event('MoveCard', {
      cardId: 4,
      fromArea: CabtAreaType.HAND,
      toArea: CabtAreaType.BENCH,
    }), resolver)).toBe(bench);
  });

  it('routes stadium plays to stadium targets and other plays through play zone fallback order', () => {
    const stadium = element('stadium');
    const playZone = element('play-zone');
    const discard = element('discard');
    const resolver = resolverWith({
      isStadium: (cardId) => cardId === 99,
      stadium: () => stadium,
      playZone: (_playerIndex, serial) => serial === 50 ? playZone : null,
      discard: () => discard,
    });

    expect(liveHandPlayTargetForEvent(event('Play', {
      cardId: 99,
      serial: 1,
    }), resolver)).toBe(stadium);
    expect(liveHandPlayTargetForEvent(event('Play', {
      cardId: 7,
      serial: 50,
    }), resolver)).toBe(playZone);
    expect(liveHandPlayTargetForEvent(event('Play', {
      cardId: 7,
      serial: 51,
    }), resolver)).toBe(discard);
  });
});

function resolverWith(overrides: Partial<LiveHandPlayTargetResolver>): LiveHandPlayTargetResolver {
  return {
    pokemon: () => null,
    pokemonBySerial: () => null,
    playZone: () => null,
    stadium: () => null,
    discard: () => null,
    discardCard: () => null,
    active: () => null,
    firstBench: () => null,
    isStadium: () => false,
    ...overrides,
  };
}

function element(name: string): HTMLElement {
  return { name } as unknown as HTMLElement;
}

function event(kind: string, params: Record<string, unknown>): ActionTimelineEvent {
  return {
    id: 1,
    kind,
    playerIndex: 0,
    params,
    text: kind,
  };
}
