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

describe('formatCabtLog branch coverage', () => {
  describe('simple actor-only cases', () => {
    it('Shuffle', () => {
      expect(formatCabtLog({ type: CabtLogType.SHUFFLE, playerIndex: 0 }))
        .toBe('Player 1 shuffled their deck.');
    });

    it('TurnStart', () => {
      expect(formatCabtLog({ type: CabtLogType.TURN_START, playerIndex: 0 }))
        .toBe('Player 1 turn started.');
    });

    it('TurnEnd', () => {
      expect(formatCabtLog({ type: CabtLogType.TURN_END, playerIndex: 0 }))
        .toBe('Player 1 ended their turn.');
    });

    it('Draw (with cardName fallback for an unknown cardId)', () => {
      expect(formatCabtLog({ type: CabtLogType.DRAW, playerIndex: 0, cardId: 999999 }))
        .toBe('Player 1 drew Card 999999.');
    });

    it('DrawReverse', () => {
      expect(formatCabtLog({ type: CabtLogType.DRAW_REVERSE, playerIndex: 0 }))
        .toBe('Player 1 drew a card.');
    });

    it('Play', () => {
      expect(formatCabtLog({ type: CabtLogType.PLAY, playerIndex: 0, cardId: 999999 }))
        .toBe('Player 1 played Card 999999.');
    });

    it('Evolve', () => {
      expect(formatCabtLog({ type: CabtLogType.EVOLVE, playerIndex: 0, cardId: 999999 }))
        .toBe('Player 1 evolved into Card 999999.');
    });

    it('Devolve', () => {
      expect(formatCabtLog({ type: CabtLogType.DEVOLVE, playerIndex: 0, cardId: 999999 }))
        .toBe('Player 1 devolved Card 999999.');
    });

    it('MoveAttached', () => {
      expect(formatCabtLog({ type: CabtLogType.MOVE_ATTACHED, playerIndex: 0, cardId: 999999 }))
        .toBe('Player 1 moved Card 999999.');
    });

    it('Result', () => {
      expect(formatCabtLog({ type: CabtLogType.RESULT, playerIndex: 0 }))
        .toBe('The battle finished.');
    });
  });

  describe('HasBasicPokemon', () => {
    it('hasBasicPokemon true', () => {
      expect(formatCabtLog({ type: CabtLogType.HAS_BASIC_POKEMON, playerIndex: 0, hasBasicPokemon: true }))
        .toBe('Player 1 has a Basic Pokemon.');
    });

    it('hasBasicPokemon false', () => {
      expect(formatCabtLog({ type: CabtLogType.HAS_BASIC_POKEMON, playerIndex: 0, hasBasicPokemon: false }))
        .toBe('Player 1 does not have a Basic Pokemon.');
    });
  });

  describe('Attach ternary', () => {
    it('with a cardIdTarget', () => {
      expect(formatCabtLog({
        type: CabtLogType.ATTACH,
        playerIndex: 0,
        cardId: 999999,
        cardIdTarget: 999998,
      })).toBe('Player 1 attached Card 999999 to Card 999998.');
    });

    it('without a cardIdTarget', () => {
      expect(formatCabtLog({
        type: CabtLogType.ATTACH,
        playerIndex: 0,
        cardId: 999999,
      })).toBe('Player 1 attached Card 999999.');
    });
  });

  describe('Attack (attackName fallback for an unknown attackId)', () => {
    it('unknown attack and card ids', () => {
      expect(formatCabtLog({
        type: CabtLogType.ATTACK,
        playerIndex: 0,
        cardId: 999999,
        attackId: 999999,
      })).toBe('Player 1 used attack 999999 with Card 999999.');
    });
  });

  describe('Ability sub-branches (log.type is the synthesized "Ability" string)', () => {
    it('ability === "Retreat" produces a retreat message', () => {
      expect(formatCabtLog({
        type: 'Ability',
        playerIndex: 0,
        cardId: 999999,
        abilityName: 'Retreat',
      })).toBe('Player 1 retreated Card 999999.');
    });

    it('ability === card (Stadium effect) drops the "with <card>" clause', () => {
      expect(formatCabtLog({
        type: 'Ability',
        playerIndex: 0,
        cardId: 999999,
        abilityName: 'Card 999999',
      })).toBe('Player 1 used Card 999999.');
    });

    it('ability !== card includes the "with <card>" clause, falling back to the card\'s skill name', () => {
      expect(formatCabtLog({
        type: 'Ability',
        playerIndex: 0,
        cardId: 28, // Poltchageist, skill "Storehouse Hideaway"
      })).toBe('Player 1 used Storehouse Hideaway with Poltchageist.');
    });

    it('abilityName falls back to "an Ability" when there is no explicit name or card skill', () => {
      expect(formatCabtLog({
        type: 'Ability',
        playerIndex: 0,
        cardId: 999999,
      })).toBe('Player 1 used an Ability with Card 999999.');
    });

    it('displayName resolves an energy code like {R} to its element name', () => {
      expect(formatCabtLog({
        type: 'Ability',
        playerIndex: 0,
        cardId: 999999,
        abilityName: '{R}',
      })).toBe('Player 1 used Fire with Card 999999.');
    });
  });

  describe('MoveCard branches (moveCardMessage)', () => {
    it('PRIZE -> HAND', () => {
      expect(formatCabtLog({
        type: CabtLogType.MOVE_CARD,
        playerIndex: 0,
        cardId: 999999,
        fromArea: CabtAreaType.PRIZE,
        toArea: CabtAreaType.HAND,
      })).toBe('Player 1 took Card 999999 as a Prize card.');
    });

    it('DECK -> PRIZE', () => {
      expect(formatCabtLog({
        type: CabtLogType.MOVE_CARD,
        playerIndex: 0,
        cardId: 999999,
        fromArea: CabtAreaType.DECK,
        toArea: CabtAreaType.PRIZE,
      })).toBe('Player 1 set a Prize card.');
    });

    it('HAND -> DECK', () => {
      expect(formatCabtLog({
        type: CabtLogType.MOVE_CARD,
        playerIndex: 0,
        cardId: 999999,
        fromArea: CabtAreaType.HAND,
        toArea: CabtAreaType.DECK,
      })).toBe('Player 1 moved a card from hand to deck.');
    });

    it('DECK -> DISCARD', () => {
      expect(formatCabtLog({
        type: CabtLogType.MOVE_CARD,
        playerIndex: 0,
        cardId: 999999,
        fromArea: CabtAreaType.DECK,
        toArea: CabtAreaType.DISCARD,
      })).toBe('Player 1 discarded Card 999999 from the deck.');
    });

    it('toArea === DECK_BOTTOM', () => {
      expect(formatCabtLog({
        type: CabtLogType.MOVE_CARD,
        playerIndex: 0,
        cardId: 999999,
        fromArea: CabtAreaType.HAND,
        toArea: CabtAreaType.DECK_BOTTOM,
      })).toBe('Player 1 put Card 999999 on the bottom of the deck.');
    });

    it('generic fallback names both areas (areaName known-area branch)', () => {
      expect(formatCabtLog({
        type: CabtLogType.MOVE_CARD,
        playerIndex: 0,
        cardId: 999999,
        fromArea: CabtAreaType.BENCH,
        toArea: CabtAreaType.ACTIVE,
      })).toBe('Player 1 moved Card 999999 from bench to active.');
    });

    it('uses the engine name for the looking area', () => {
      expect(formatCabtLog({
        type: CabtLogType.MOVE_CARD,
        playerIndex: 0,
        cardId: 999999,
        fromArea: CabtAreaType.DECK,
        toArea: CabtAreaType.LOOKING,
      })).toBe('Player 1 moved Card 999999 from deck to looking.');
    });
  });

  describe('MoveCardReverse / areaName unknown fallback', () => {
    it('names known areas', () => {
      expect(formatCabtLog({
        type: CabtLogType.MOVE_CARD_REVERSE,
        playerIndex: 0,
        fromArea: CabtAreaType.BENCH,
        toArea: CabtAreaType.DISCARD,
      })).toBe('Player 1 moved a facedown card from bench to discard.');
    });

    it('falls back to "zone" for an unrecognized area code', () => {
      expect(formatCabtLog({
        type: CabtLogType.MOVE_CARD_REVERSE,
        playerIndex: 0,
        fromArea: 9999,
        toArea: 9999,
      })).toBe('Player 1 moved a facedown card from zone to zone.');
    });
  });

  describe('Switch / Change', () => {
    it('Switch', () => {
      expect(formatCabtLog({
        type: CabtLogType.SWITCH,
        playerIndex: 0,
        cardIdActive: 999999,
        cardIdBench: 999998,
      })).toBe('Player 1 switched Card 999999 with Card 999998.');
    });

    it('Change', () => {
      expect(formatCabtLog({
        type: CabtLogType.CHANGE,
        playerIndex: 0,
        cardIdBefore: 999999,
        cardIdAfter: 999998,
      })).toBe('Player 1 changed Card 999999 into Card 999998.');
    });
  });

  describe('HPChange branches (hpChangeMessage)', () => {
    it('value is NaN (missing) -> generic "HP changed"', () => {
      expect(formatCabtLog({
        type: CabtLogType.HP_CHANGE,
        playerIndex: 0,
        cardId: 999999,
      })).toBe("Player 1's Card 999999 HP changed.");
    });

    it('value is 0 -> generic "HP changed"', () => {
      expect(formatCabtLog({
        type: CabtLogType.HP_CHANGE,
        playerIndex: 0,
        cardId: 999999,
        value: 0,
      })).toBe("Player 1's Card 999999 HP changed.");
    });

    it('value < 0 -> took N damage', () => {
      expect(formatCabtLog({
        type: CabtLogType.HP_CHANGE,
        playerIndex: 0,
        cardId: 999999,
        value: -5,
      })).toBe("Player 1's Card 999999 took 5 damage.");
    });

    it('value > 0 -> recovered N HP', () => {
      expect(formatCabtLog({
        type: CabtLogType.HP_CHANGE,
        playerIndex: 0,
        cardId: 999999,
        value: 50,
      })).toBe("Player 1's Card 999999 recovered 50 HP.");
    });
  });

  describe('Status conditions (isRecover true/false)', () => {
    it('Poisoned: onset and recovery', () => {
      expect(formatCabtLog({ type: CabtLogType.POISONED, playerIndex: 0, cardId: 999999, isRecover: false }))
        .toBe("Player 1's Card 999999 was poisoned.");
      expect(formatCabtLog({ type: CabtLogType.POISONED, playerIndex: 0, cardId: 999999, isRecover: true }))
        .toBe("Player 1's Card 999999 recovered from poison.");
    });

    it('Burned: onset and recovery', () => {
      expect(formatCabtLog({ type: CabtLogType.BURNED, playerIndex: 0, cardId: 999999, isRecover: false }))
        .toBe("Player 1's Card 999999 was burned.");
      expect(formatCabtLog({ type: CabtLogType.BURNED, playerIndex: 0, cardId: 999999, isRecover: true }))
        .toBe("Player 1's Card 999999 recovered from burn.");
    });

    it('Asleep: onset and recovery', () => {
      expect(formatCabtLog({ type: CabtLogType.ASLEEP, playerIndex: 0, cardId: 999999, isRecover: false }))
        .toBe("Player 1's Card 999999 fell asleep.");
      expect(formatCabtLog({ type: CabtLogType.ASLEEP, playerIndex: 0, cardId: 999999, isRecover: true }))
        .toBe("Player 1's Card 999999 woke up.");
    });

    it('Paralyzed: onset and recovery', () => {
      expect(formatCabtLog({ type: CabtLogType.PARALYZED, playerIndex: 0, cardId: 999999, isRecover: false }))
        .toBe("Player 1's Card 999999 was paralyzed.");
      expect(formatCabtLog({ type: CabtLogType.PARALYZED, playerIndex: 0, cardId: 999999, isRecover: true }))
        .toBe("Player 1's Card 999999 recovered from paralysis.");
    });

    it('Confused: onset and recovery', () => {
      expect(formatCabtLog({ type: CabtLogType.CONFUSED, playerIndex: 0, cardId: 999999, isRecover: false }))
        .toBe("Player 1's Card 999999 was confused.");
      expect(formatCabtLog({ type: CabtLogType.CONFUSED, playerIndex: 0, cardId: 999999, isRecover: true }))
        .toBe("Player 1's Card 999999 recovered from confusion.");
    });
  });

  describe('Coin', () => {
    it('heads', () => {
      expect(formatCabtLog({ type: CabtLogType.COIN, playerIndex: 0, head: true }))
        .toBe('Player 1 flipped heads.');
    });

    it('tails', () => {
      expect(formatCabtLog({ type: CabtLogType.COIN, playerIndex: 0, head: false }))
        .toBe('Player 1 flipped tails.');
    });
  });

  describe('default branch / normalizedLogType', () => {
    it('unknown numeric type without a finite cardId -> "Log N"', () => {
      expect(formatCabtLog({ type: 9999, playerIndex: 0 }))
        .toBe('Player 1: Log 9999.');
    });

    it('unknown numeric type with a finite cardId appends the card name', () => {
      expect(formatCabtLog({ type: 9999, playerIndex: 0, cardId: 999999 }))
        .toBe('Player 1: Log 9999 Card 999999.');
    });

    it('unknown non-numeric/string type passes the string through', () => {
      expect(formatCabtLog({ type: 'MysteryEvent', playerIndex: 0 }))
        .toBe('Player 1: MysteryEvent.');
    });

    it('undefined type normalizes to "Event"', () => {
      expect(formatCabtLog({ playerIndex: 0 }))
        .toBe('Player 1: Event.');
    });
  });

  describe('actor', () => {
    it('uses "Game" when there is no playerIndex', () => {
      expect(formatCabtLog({ type: CabtLogType.SHUFFLE }))
        .toBe('Game shuffled their deck.');
    });
  });

  // Boundary canonicalization: the engine emits HP changes as either the numeric
  // CabtLogType.HP_CHANGE or the string 'HpChange'; both must normalize to the
  // single canonical timeline kind 'HPChange' at ingestion so downstream code
  // handles one spelling.
  describe('HpChange casing is canonicalized at ingestion', () => {
    it('both the string and numeric encodings produce kind "HPChange"', () => {
      const stringForm = cabtLogsToTimeline([{ type: 'HpChange', playerIndex: 0, cardId: 999999, value: -30 }]);
      const numericForm = cabtLogsToTimeline([{ type: CabtLogType.HP_CHANGE, playerIndex: 0, cardId: 999999, value: -30 }]);

      expect(stringForm.events[0].kind).toBe('HPChange');
      expect(numericForm.events[0].kind).toBe('HPChange');
    });

    it('both encodings render the same damage message', () => {
      const string = formatCabtLog({ type: 'HpChange', playerIndex: 0, cardId: 999999, value: -30 });
      const numeric = formatCabtLog({ type: CabtLogType.HP_CHANGE, playerIndex: 0, cardId: 999999, value: -30 });

      expect(string).toBe("Player 1's Card 999999 took 30 damage.");
      expect(numeric).toBe(string);
    });
  });
});
