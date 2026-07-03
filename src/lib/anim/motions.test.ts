import { describe, expect, it } from 'vitest';
import { CabtAreaType } from '../cabt/types';
import type { ActionTimelineEvent, CardView, PlayerView, PokemonSlotView } from '../game/types';
import { choreographBoardMotions } from './motions';

let nextEventId = 1;

function event(kind: string, playerIndex: number, params: Record<string, unknown>): ActionTimelineEvent {
  return {
    id: nextEventId++,
    message: kind,
    playerIndex,
    kind,
    params,
  };
}

function moveCard(playerIndex: number, fromArea: number, toArea: number, cardId: number, serial: number): ActionTimelineEvent {
  return event('MoveCard', playerIndex, { cardId, serial, fromArea, toArea, openType: 1 });
}

function card(cardId: number, serial: number, name = `Card ${cardId}`): CardView {
  return { id: cardId, serial, name, fullName: name };
}

function slot(ownerIndex: number, kind: 'active' | 'bench', index: number, pokemon?: CardView): PokemonSlotView {
  return {
    ownerIndex,
    slot: kind,
    index,
    target: { player: 0, slot: 0, index },
    empty: !pokemon,
    pokemon,
    cards: pokemon ? [pokemon] : [],
    damage: pokemon ? 30 : 0,
    hp: pokemon?.hp ?? 0,
    retreat: [],
    energy: [],
    tools: [],
    specialConditions: [],
  };
}

function player(index: number, active?: CardView, bench: Array<CardView | undefined> = []): PlayerView {
  return {
    index,
    id: index,
    name: `Player ${index + 1}`,
    hand: [],
    deckCount: 30,
    discard: [],
    lostZone: [],
    stadium: [],
    playZone: [],
    prizesLeft: 6,
    active: slot(index, 'active', 0, active),
    bench: bench.map((pokemon, benchIndex) => slot(index, 'bench', benchIndex, pokemon)),
    playableCardIds: [],
  };
}

describe('choreographBoardMotions', () => {
  it('emits two crossing slot motions for a Switch', () => {
    const active = card(100, 1);
    const bench = card(200, 2);
    const players = [player(0, active, [bench]), player(1)];
    const events = [event('Switch', 0, {
      cardIdActive: 100,
      serialActive: 1,
      cardIdBench: 200,
      serialBench: 2,
    })];

    const motions = choreographBoardMotions(events, players);
    expect(motions).toHaveLength(2);
    const [outgoing, incoming] = motions;
    expect(outgoing.style).toBe('board-move');
    expect(outgoing.from).toEqual({ kind: 'pokemon', player: 0, serial: 1, cardId: 100 });
    expect(outgoing.to).toEqual({ kind: 'pokemon', player: 0, serial: 2, cardId: 200 });
    expect(incoming.from).toEqual({ kind: 'pokemon', player: 0, serial: 2, cardId: 200 });
    expect(incoming.to).toEqual({ kind: 'pokemon', player: 0, serial: 1, cardId: 100 });
    expect(outgoing.startMs).toBe(incoming.startMs);
    expect(outgoing.hide).toHaveLength(2);
    expect(outgoing.hide.every((claim) => claim.mode === 'contents')).toBe(true);
    expect(outgoing.sprite.kind).toBe('slot');
    if (outgoing.sprite.kind === 'slot') {
      expect(outgoing.sprite.slot.pokemon?.serial).toBe(1);
      expect(outgoing.sprite.activeSize).toBe(false);
    }
    if (incoming.sprite.kind === 'slot') {
      expect(incoming.sprite.activeSize).toBe(true);
    }
  });

  it('routes a paired active/bench swap through the counterpart positions', () => {
    const active = card(100, 1);
    const bench = card(200, 2);
    const players = [player(0, active, [bench]), player(1)];
    const events = [
      moveCard(0, CabtAreaType.ACTIVE, CabtAreaType.BENCH, 100, 1),
      moveCard(0, CabtAreaType.BENCH, CabtAreaType.ACTIVE, 200, 2),
    ];

    const motions = choreographBoardMotions(events, players);
    expect(motions).toHaveLength(2);
    const [toBench, toActive] = motions;
    expect(toBench.to).toEqual({ kind: 'pokemon', player: 0, serial: 2, cardId: 200 });
    expect(toActive.to).toEqual({ kind: 'slot', player: 0, slot: 'active', index: 0 });
  });

  it('promotes a lone bench Pokemon into the active slot anchor', () => {
    const bench = card(200, 2);
    const players = [player(0, undefined, [bench]), player(1)];
    const events = [moveCard(0, CabtAreaType.BENCH, CabtAreaType.ACTIVE, 200, 2)];

    const motions = choreographBoardMotions(events, players);
    expect(motions).toHaveLength(1);
    expect(motions[0].to).toEqual({ kind: 'slot', player: 0, slot: 'active', index: 0 });
    expect(motions[0].hide).toContainEqual({ anchor: { kind: 'slot', player: 0, slot: 'active', index: 0 }, mode: 'contents' });
  });

  it('skips an unpaired active-to-bench move without a bench index', () => {
    const players = [player(0, card(100, 1)), player(1)];
    const events = [moveCard(0, CabtAreaType.ACTIVE, CabtAreaType.BENCH, 100, 1)];
    expect(choreographBoardMotions(events, players)).toHaveLength(0);
  });

  it('builds deck-to-board placements with the destination stack and hidden landing slot', () => {
    const placed: CardView = { ...card(300, 5), animationHidden: true };
    const players = [player(0, card(100, 1), [placed]), player(1)];
    const events = [moveCard(0, CabtAreaType.DECK, CabtAreaType.BENCH, 300, 5)];

    const motions = choreographBoardMotions(events, players);
    expect(motions).toHaveLength(1);
    const motion = motions[0];
    expect(motion.fromDeck).toBe(true);
    expect(motion.from).toEqual({ kind: 'deck', player: 0 });
    expect(motion.to).toEqual({ kind: 'pokemon', player: 0, serial: 5, cardId: 300 });
    expect(motion.hide).toEqual([{ anchor: { kind: 'pokemon', player: 0, serial: 5, cardId: 300 }, mode: 'contents' }]);
    if (motion.sprite.kind === 'slot') {
      expect(motion.sprite.slot.pokemon?.animationHidden).toBeUndefined();
    } else {
      throw new Error('expected slot sprite');
    }
  });

  it('flips board Pokemon returning to the deck', () => {
    const players = [player(0, card(100, 1)), player(1)];
    const events = [moveCard(0, CabtAreaType.ACTIVE, CabtAreaType.DECK, 100, 1)];

    const motions = choreographBoardMotions(events, players);
    expect(motions).toHaveLength(1);
    expect(motions[0].toDeck).toBe(true);
    expect(motions[0].to).toEqual({ kind: 'deck', player: 0 });
  });

  it('sends a displaced stadium to its owner discard and waits for the landed card', () => {
    const players = [player(0), player(1)];
    const events = [moveCard(1, CabtAreaType.STADIUM, CabtAreaType.DISCARD, 400, 9)];

    const motions = choreographBoardMotions(events, players);
    expect(motions).toHaveLength(1);
    const motion = motions[0];
    expect(motion.waitForDestinationCard).toBe(true);
    expect(motion.from).toEqual({ kind: 'stadium', player: 1, serial: 9 });
    expect(motion.hide).toContainEqual({
      anchor: { kind: 'discard', player: 1, serial: 9, cardId: 400, exact: true },
      mode: 'element',
    });
  });

  it('classifies attached energy and tool removals', () => {
    const players = [player(0, card(100, 1)), player(1)];
    const toDiscard = choreographBoardMotions(
      [moveCard(0, CabtAreaType.ENERGY, CabtAreaType.DISCARD, 500, 11)],
      players,
    );
    expect(toDiscard).toHaveLength(1);
    expect(toDiscard[0].style).toBe('attached-move');
    expect(toDiscard[0].from).toEqual({ kind: 'attached', attached: 'energy', serial: 11 });
    expect(toDiscard[0].hide).toContainEqual({
      anchor: { kind: 'discard', player: 0, serial: 11, cardId: 500, exact: true },
      mode: 'element',
    });

    const toolToDeck = choreographBoardMotions(
      [moveCard(0, CabtAreaType.TOOL, CabtAreaType.DECK, 600, 12)],
      players,
    );
    expect(toolToDeck).toHaveLength(1);
    expect(toolToDeck[0].from).toEqual({ kind: 'attached', attached: 'tool', serial: 12 });
    expect(toolToDeck[0].to).toEqual({ kind: 'deck', player: 0 });
    expect(toolToDeck[0].hide).toHaveLength(1);
  });

  it('skips attached moves without a serial', () => {
    const players = [player(0), player(1)];
    const events = [event('MoveCard', 0, { cardId: 500, fromArea: CabtAreaType.ENERGY, toArea: CabtAreaType.DISCARD })];
    expect(choreographBoardMotions(events, players)).toHaveLength(0);
  });

  it('staggers deck mill cards and targets the discard surface', () => {
    const players = [player(0), player(1)];
    const events = [
      moveCard(0, CabtAreaType.DECK, CabtAreaType.DISCARD, 700, 20),
      moveCard(0, CabtAreaType.DECK, CabtAreaType.DISCARD, 701, 21),
    ];

    const motions = choreographBoardMotions(events, players);
    expect(motions).toHaveLength(2);
    expect(motions[0].style).toBe('deck-discard');
    expect(motions[0].to).toEqual({ kind: 'discard', player: 0, surface: true });
    expect(motions[0].hide).toHaveLength(0);
    expect(motions[1].startMs).toBeGreaterThan(motions[0].startMs);
  });

  it('ignores events outside the board-plane family', () => {
    const players = [player(0, card(100, 1)), player(1)];
    const events = [
      event('Draw', 0, { cardId: 1, serial: 2 }),
      moveCard(0, CabtAreaType.HAND, CabtAreaType.BENCH, 300, 5),
      moveCard(0, CabtAreaType.DECK, CabtAreaType.LOOKING, 301, 6),
      event('Attack', 0, { cardId: 100, serial: 1 }),
    ];
    expect(choreographBoardMotions(events, players)).toHaveLength(0);
  });
});
