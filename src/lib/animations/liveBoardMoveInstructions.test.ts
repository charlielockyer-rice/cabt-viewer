import { describe, expect, it } from 'vitest';
import {
  liveBoardMoveInstructionsForEvent,
  type LiveBoardMoveElementResolver,
} from './liveBoardMoveInstructions';
import { CabtAreaType } from '../cabt/types';
import type { ActionTimelineEvent } from '../game/types';

describe('liveBoardMoveInstructionsForEvent', () => {
  it('creates paired switch instructions between active and bench sources', () => {
    const active = element('active');
    const bench = element('bench');
    const resolver = resolverWith({
      pokemon: (_serial, cardId) => cardId === 10 ? active : cardId === 20 ? bench : null,
    });
    const switchEvent = event('Switch', {
      cardIdActive: 10,
      cardIdBench: 20,
      serialActive: 101,
      serialBench: 202,
    });

    expect(liveBoardMoveInstructionsForEvent(switchEvent, [switchEvent], resolver)).toMatchObject([
      {
        source: active,
        target: bench,
        cardId: 10,
        serial: 101,
        key: 'active-101',
        waitForDestinationCard: false,
      },
      {
        source: bench,
        target: active,
        cardId: 20,
        serial: 202,
        key: 'bench-202',
        waitForDestinationCard: false,
      },
    ]);
  });

  it('uses a bench anchor for deck placements before the destination card exists', () => {
    const deck = element('deck');
    const benchAnchor = element('bench-anchor');
    const resolver = resolverWith({
      deckTop: () => deck,
      pokemon: () => null,
      boardAnchor: (_playerIndex, slot, index) =>
        slot === 'bench' && index === 2 ? benchAnchor : null,
    });
    const moveEvent = event('MoveCard', {
      cardId: 30,
      serial: 303,
      fromArea: CabtAreaType.DECK,
      toArea: CabtAreaType.BENCH,
      toIndex: 2,
    });

    expect(liveBoardMoveInstructionsForEvent(moveEvent, [moveEvent], resolver)).toMatchObject([
      {
        source: deck,
        target: benchAnchor,
        cardId: 30,
        serial: 303,
        fromDeck: true,
        toDeck: false,
      },
    ]);
  });

  it('targets a paired bench source for active to bench swaps without an explicit index', () => {
    const active = element('active');
    const bench = element('bench');
    let activePokemonLookups = 0;
    const resolver = resolverWith({
      pokemon: (_serial, cardId) => {
        if (cardId === 40) {
          activePokemonLookups += 1;
          return activePokemonLookups === 1 ? active : null;
        }
        return cardId === 50 ? bench : null;
      },
    });
    const activeToBench = event('MoveCard', {
      cardId: 40,
      serial: 404,
      fromArea: CabtAreaType.ACTIVE,
      toArea: CabtAreaType.BENCH,
    }, 1);
    const benchToActive = event('MoveCard', {
      cardId: 50,
      serial: 505,
      fromArea: CabtAreaType.BENCH,
      toArea: CabtAreaType.ACTIVE,
    }, 2);

    expect(liveBoardMoveInstructionsForEvent(activeToBench, [activeToBench, benchToActive], resolver)).toMatchObject([
      {
        source: active,
        target: bench,
        cardId: 40,
        key: '404',
      },
    ]);
  });

  it('waits for a discard destination card before handing off', () => {
    const source = element('source');
    const discardPile = element('discard-pile');
    const resolver = resolverWith({
      pokemon: () => source,
      discardCard: () => null,
      discardPile: () => discardPile,
    });
    const moveEvent = event('MoveCard', {
      cardId: 60,
      fromArea: CabtAreaType.ACTIVE,
      toArea: CabtAreaType.DISCARD,
    });

    expect(liveBoardMoveInstructionsForEvent(moveEvent, [moveEvent], resolver)).toMatchObject([
      {
        source,
        target: discardPile,
        waitForDestinationCard: true,
        toDeck: false,
        fromDeck: false,
      },
    ]);
  });
});

function resolverWith(overrides: Partial<LiveBoardMoveElementResolver>): LiveBoardMoveElementResolver {
  return {
    stadiumCard: () => null,
    deckTop: () => null,
    pokemon: () => null,
    boardAnchor: () => null,
    discardCard: () => null,
    discardPile: () => null,
    ...overrides,
  };
}

function element(name: string): HTMLElement {
  return { name } as unknown as HTMLElement;
}

function event(kind: string, params: Record<string, unknown>, id = 1): ActionTimelineEvent {
  return {
    id,
    kind,
    playerIndex: 0,
    params,
    text: kind,
  };
}
