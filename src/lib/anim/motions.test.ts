import { describe, expect, it } from 'vitest';
import { CabtAreaType } from '../cabt/types';
import type { ActionTimelineEvent, CardView, PlayerView, PokemonSlotView } from '../game/types';
import { choreograph } from './motions';
import { actionAnimationTiming } from './timing';

function choreographBoardMotions(events: ActionTimelineEvent[], players: PlayerView[]) {
  return choreograph(events, players).motions.filter((motion) => motion.space === 'board');
}

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
    const placed: CardView = card(300, 5);
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
      expect(motion.sprite.slot.pokemon?.serial).toBe(5);
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

  it('keeps non-board events out of the board space', () => {
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

describe('choreograph viewport family', () => {
  it('emits staggered coin flip motions with per-player group metadata', () => {
    const players = [player(0), player(1)];
    const { motions } = choreograph([
      event('Coin', 0, { head: true }),
      event('Coin', 0, { head: false }),
    ], players);

    expect(motions).toHaveLength(2);
    expect(motions.map((motion) => motion.style)).toEqual(['coin-flip', 'coin-flip']);
    expect(motions.every((motion) => motion.space === 'viewport')).toBe(true);
    expect(motions.map((motion) => motion.sprite.kind)).toEqual(['none', 'none']);
    expect(motions.map((motion) => motion.coinHead)).toEqual([true, false]);
    expect(motions.map((motion) => motion.coinIndex)).toEqual([0, 1]);
    expect(motions.map((motion) => motion.coinCount)).toEqual([2, 2]);
    expect(motions.map((motion) => motion.from)).toEqual([{ kind: 'deck', player: 0 }, { kind: 'deck', player: 0 }]);
    expect(motions.map((motion) => motion.to)).toEqual([{ kind: 'deck', player: 0 }, { kind: 'deck', player: 0 }]);
    expect(motions[1].startMs - motions[0].startMs).toBe(actionAnimationTiming.coinFlipStepMs);
  });

  it('classifies hand plays with destination fallbacks and staggered evolutions', () => {
    const players = [player(0, card(100, 1)), player(1)];
    const events = [
      event('Play', 0, { cardId: 300, serial: 5 }),
      event('Evolve', 0, { cardId: 301, serial: 6, cardIdTarget: 100, serialTarget: 1 }),
    ];

    const { motions } = choreograph(events, players);
    expect(motions).toHaveLength(2);
    const [play, evolve] = motions;
    expect(play.style).toBe('hand-play');
    expect(play.space).toBe('viewport');
    expect(play.from).toEqual({ kind: 'hand-slot', player: 0, serial: 5 });
    expect(play.to).toEqual({ kind: 'pokemon', player: 0, serial: 5, cardId: 300 });
    expect(play.toFallbacks?.map((anchor) => anchor.kind)).toEqual(['discard', 'playZone', 'discard']);
    expect(play.hideResolvedTarget).toBe(true);
    expect(evolve.evolve).toBe(true);
    expect(evolve.to).toEqual({ kind: 'pokemon', player: 0, serial: 1, cardId: 100 });
    expect(evolve.hideResolvedTarget).toBe(false);
    expect(evolve.startMs).toBeGreaterThan(play.startMs);
  });

  it('anchors stadium ability announces to the stadium card', () => {
    const players = [player(0), player(1)];
    const { effects } = choreograph([
      event('Ability', 0, { cardId: 1259, serial: 62, area: CabtAreaType.STADIUM, abilityName: 'Spikemuth Gym' }),
    ], players);
    expect(effects).toHaveLength(1);
    expect(effects[0].kind).toBe('announce-ability');
    expect(effects[0].anchor).toEqual({ kind: 'stadium', player: 0, serial: 62 });
  });

  it('presents ability deck-attaches as a reveal followed by the attach handoff', () => {
    const players = [player(0, card(100, 1)), player(1)];
    const batch = [event('Attach', 0, { cardId: 500, serial: 11, cardIdTarget: 100, serialTarget: 1 })];
    const context = [event('Ability', 0, { cardId: 648, serial: 2, abilityName: 'Punk Up' }), ...batch];

    const { motions, effects } = choreograph(batch, players, context);
    expect(motions.map((motion) => [motion.style, motion.revealSerial])).toEqual([['reveal', 11]]);
    expect(effects).toHaveLength(1);
    expect(effects[0].kind).toBe('attach-under');
    expect(effects[0].startMs).toBe(motions[0].durationMs);
  });

  it('emits attach-under target effects for Attach events', () => {
    const players = [player(0, card(100, 1)), player(1)];
    const events = [event('Attach', 0, { cardId: 500, serial: 11, cardIdTarget: 100, serialTarget: 1 })];

    const { motions, effects } = choreograph(events, players);
    expect(motions).toHaveLength(0);
    expect(effects).toHaveLength(1);
    expect(effects[0].kind).toBe('attach-under');
    expect(effects[0].anchor).toEqual({ kind: 'pokemon', player: 0, serial: 1, cardId: 100 });
    expect(effects[0].sourceSerial).toBe(11);
  });

  it('targets draw motions at the end of the hand, or by serial during a mulligan', () => {
    const players = [player(0), player(1)];
    const plainDraws = choreograph([
      event('Draw', 0, { cardId: 700, serial: 20 }),
      event('Draw', 0, { cardId: 701, serial: 21 }),
    ], players);
    expect(plainDraws.motions.map((motion) => motion.to)).toEqual([
      { kind: 'hand-slot', player: 0, serial: undefined, fromEnd: 2 },
      { kind: 'hand-slot', player: 0, serial: undefined, fromEnd: 1 },
    ]);
    expect(plainDraws.motions[0].mulligan).toBe(false);

    const mulligan = choreograph([
      moveCard(0, CabtAreaType.HAND, CabtAreaType.DECK, 600, 15),
      event('Draw', 0, { cardId: 700, serial: 20 }),
    ], players);
    const draw = mulligan.motions.find((motion) => motion.style === 'deck-draw');
    expect(draw?.mulligan).toBe(true);
    expect(draw?.to).toEqual({ kind: 'hand-slot', player: 0, serial: 20, index: 0 });
    const reset = mulligan.motions.find((motion) => motion.style === 'hand-reset');
    expect(reset?.from).toEqual({ kind: 'hand-slot', player: 0, serial: 15 });
    expect(reset?.to).toEqual({ kind: 'deck', player: 0 });
  });

  it('classifies reveal-session motions keyed by the looking-zone serial', () => {
    const players = [player(0), player(1)];
    const { motions } = choreograph([
      moveCard(0, CabtAreaType.DECK, CabtAreaType.LOOKING, 900, 40),
      moveCard(0, CabtAreaType.DECK, CabtAreaType.HAND, 901, 41),
      moveCard(0, CabtAreaType.LOOKING, CabtAreaType.HAND, 900, 40),
      moveCard(0, CabtAreaType.LOOKING, CabtAreaType.DECK, 902, 42),
    ], players);

    expect(motions.map((motion) => motion.style)).toEqual(['reveal', 'search-reveal', 'reveal-take', 'reveal-return']);
    expect(motions.every((motion) => motion.space === 'viewport')).toBe(true);
    expect(motions.map((motion) => motion.revealSerial)).toEqual([40, 41, 40, 42]);
    expect(motions[1].to).toEqual({ kind: 'hand-slot', player: 0, serial: 41 });
    expect(motions[2].to).toEqual({ kind: 'hand-slot', player: 0, serial: 40 });
    expect(motions[3].toDeck).toBe(true);
  });

  it('classifies prize placement effects and prize takes, including facedown moves', () => {
    const players = [player(0), player(1)];
    const placement = choreograph([
      event('MoveCardReverse', 0, { fromArea: CabtAreaType.DECK, toArea: CabtAreaType.PRIZE }),
      event('MoveCardReverse', 0, { fromArea: CabtAreaType.DECK, toArea: CabtAreaType.PRIZE }),
    ], players);
    expect(placement.effects).toHaveLength(2);
    expect(placement.effects[0].kind).toBe('prize-place');
    expect(placement.effects[0].anchor).toEqual({ kind: 'prize', player: 0, index: 4 });
    expect(placement.effects[1].anchor).toEqual({ kind: 'prize', player: 0, index: 5 });

    const take = choreograph([
      event('MoveCard', 0, { fromArea: CabtAreaType.PRIZE, toArea: CabtAreaType.HAND, cardId: 800, serial: 30 }),
    ], players);
    expect(take.motions).toHaveLength(1);
    expect(take.motions[0].style).toBe('prize-take');
    expect(take.motions[0].takeIndex).toBe(0);
    expect(take.motions[0].takeCount).toBe(1);
    expect(take.motions[0].to).toEqual({ kind: 'hand-slot', player: 0, serial: 30, fromEnd: 1 });
  });
});
