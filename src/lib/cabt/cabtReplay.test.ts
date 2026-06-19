import { describe, expect, it } from 'vitest';
import { cabtReplayToSnapshot } from './cabtReplay';
import { CabtAreaType } from './types';

describe('cabtReplayToSnapshot', () => {
  it('renders physical attached energy cards instead of provided energy units', () => {
    const snapshot = cabtReplayToSnapshot({
      visualize: [{
        current: {
          turn: 1,
          yourIndex: 0,
          result: -1,
          players: [{
            active: [{
              id: 710,
              serial: 10,
              hp: 180,
              maxHp: 180,
              energies: [1, 1],
              energyCards: [{ id: 1, serial: 20, playerIndex: 0, name: 'Basic {G} Energy' }],
            }],
            bench: [],
            benchMax: 5,
            handCount: 0,
            deckCount: 0,
            prize: [],
          }, {
            active: [],
            bench: [],
            benchMax: 5,
            handCount: 0,
            deckCount: 0,
            prize: [],
          }],
        },
      }],
    });

    expect(snapshot.views[0].players[0].active.energy).toHaveLength(1);
    expect(snapshot.views[0].players[0].active.energy[0].name).toBe('Basic Grass Energy');
  });

  it('does not render provided energy units as attached cards', () => {
    const snapshot = cabtReplayToSnapshot({
      visualize: [{
        current: {
          turn: 1,
          yourIndex: 0,
          result: -1,
          players: [{
            active: [{
              id: 710,
              serial: 10,
              hp: 180,
              maxHp: 180,
              energies: [1, 1],
            }],
            bench: [],
            benchMax: 5,
            handCount: 0,
            deckCount: 0,
            prize: [],
          }, {
            active: [],
            bench: [],
            benchMax: 5,
            handCount: 0,
            deckCount: 0,
            prize: [],
          }],
        },
      }],
    });

    expect(snapshot.views[0].players[0].active.energy).toHaveLength(0);
  });

  it('groups deterministic multi-prize frames into one replay step', () => {
    const snapshot = cabtReplayToSnapshot({
      visualize: [{
        logs: [
          { type: 'MoveCard', playerIndex: 0, cardId: 96, fromArea: 6, toArea: 2 },
          { type: 'MoveCard', playerIndex: 0, cardId: 1261, fromArea: 6, toArea: 2 },
        ],
        current: {
          turn: 8,
          yourIndex: 0,
          result: -1,
          players: [{
            active: [],
            bench: [],
            benchMax: 5,
            handCount: 0,
            deckCount: 0,
            prize: [],
          }, {
            active: [],
            bench: [],
            benchMax: 5,
            handCount: 0,
            deckCount: 0,
            prize: [],
          }],
        },
      }],
    });

    expect(snapshot.steps.map((step) => step.label)).toEqual(['Player 1 took 2 Prize cards.']);
    expect(snapshot.steps[0].actionTimeline).toHaveLength(2);
  });

  it('labels setup prize placement without revealing card names', () => {
    const snapshot = cabtReplayToSnapshot({
      visualize: [{
        logs: Array.from({ length: 6 }, (_unused, index) => ({
          type: 'MoveCard',
          playerIndex: 0,
          cardId: index === 0 ? 3 : 96,
          fromArea: CabtAreaType.DECK,
          toArea: CabtAreaType.PRIZE,
        })),
        current: {
          turn: 0,
          yourIndex: 0,
          result: -1,
          players: [{
            active: [],
            bench: [],
            benchMax: 5,
            handCount: 0,
            deckCount: 47,
            prize: Array.from({ length: 6 }, () => null),
          }, {
            active: [],
            bench: [],
            benchMax: 5,
            handCount: 0,
            deckCount: 53,
            prize: [],
          }],
        },
      }],
    });

    expect(snapshot.steps[0].label).toBe('Player 1 set 6 Prize cards.');
    expect(snapshot.steps[0].label).not.toContain('Basic Water Energy');
    expect(snapshot.steps[0].actionTimeline?.[0].message).toBe('Player 1 set a Prize card.');
  });

  it('does not show setup Prize cards before the setup-prize replay step', () => {
    const snapshot = cabtReplayToSnapshot({
      visualize: [{
        current: {
          turn: 0,
          yourIndex: 0,
          result: -1,
          players: [{
            active: [],
            bench: [],
            benchMax: 5,
            handCount: 7,
            deckCount: 53,
            prize: [],
          }, {
            active: [],
            bench: [],
            benchMax: 5,
            handCount: 7,
            deckCount: 53,
            prize: [],
          }],
        },
      }, {
        logs: [
          { type: 'MoveCard', playerIndex: 0, cardId: 722, fromArea: CabtAreaType.HAND, toArea: CabtAreaType.ACTIVE },
          ...Array.from({ length: 6 }, () => ({
            type: 'MoveCardReverse',
            playerIndex: 0,
            fromArea: CabtAreaType.DECK,
            toArea: CabtAreaType.PRIZE,
          })),
        ],
        current: {
          turn: 0,
          yourIndex: 0,
          result: -1,
          players: [{
            active: [{ id: 722, serial: 10, hp: 70, maxHp: 70 }],
            bench: [],
            benchMax: 5,
            handCount: 6,
            deckCount: 47,
            prize: Array.from({ length: 6 }, () => null),
          }, {
            active: [],
            bench: [],
            benchMax: 5,
            handCount: 7,
            deckCount: 53,
            prize: [],
          }],
        },
      }],
    });

    expect(snapshot.steps[1].label).toBe('Player 1 moved Snover from hand to active.');
    expect(snapshot.steps[1].displayView?.players[0].active.empty).toBe(false);
    expect(snapshot.steps[1].displayView?.players[0].prizesLeft).toBe(0);
    expect(snapshot.steps[1].displayView?.players[0].deckCount).toBe(53);
    expect(snapshot.steps[2].label).toBe('Player 1 set 6 Prize cards.');
    expect(snapshot.steps[2].displayView?.players[0].prizesLeft).toBe(6);
    expect(snapshot.steps[2].displayView?.players[0].deckCount).toBe(47);
  });

  it('labels mulligan hand returns without revealing returned card names', () => {
    const snapshot = cabtReplayToSnapshot({
      visualize: [{
        logs: [
          ...Array.from({ length: 7 }, (_unused, index) => ({
            type: 'MoveCard',
            playerIndex: 1,
            cardId: index === 0 ? 1158 : 3,
            fromArea: CabtAreaType.HAND,
            toArea: CabtAreaType.DECK,
          })),
          { type: 'Shuffle', playerIndex: 1 },
        ],
        current: {
          turn: 0,
          yourIndex: 0,
          result: -1,
          players: [{
            active: [],
            bench: [],
            benchMax: 5,
            handCount: 7,
            deckCount: 53,
            prize: [],
          }, {
            active: [],
            bench: [],
            benchMax: 5,
            handCount: 0,
            deckCount: 60,
            prize: [],
          }],
        },
      }],
    });

    expect(snapshot.steps[0].label).toBe('Player 2 shuffled their opening hand into their deck.');
    expect(snapshot.steps[0].label).not.toContain('Maximum Belt');
    expect(snapshot.steps[0].actionTimeline?.[0].message).toBe('Player 2 moved a card from hand to deck.');
  });

  it('labels later hand-to-deck shuffles without calling them opening hands', () => {
    const snapshot = cabtReplayToSnapshot({
      visualize: [{
        logs: [
          ...Array.from({ length: 3 }, (_unused, index) => ({
            type: 'MoveCard',
            playerIndex: 0,
            cardId: index === 0 ? 1158 : 3,
            fromArea: CabtAreaType.HAND,
            toArea: CabtAreaType.DECK,
          })),
          { type: 'Shuffle', playerIndex: 0 },
        ],
        current: {
          turn: 6,
          yourIndex: 0,
          result: -1,
          players: [{
            active: [],
            bench: [],
            benchMax: 5,
            handCount: 2,
            deckCount: 45,
            prize: [],
          }, {
            active: [],
            bench: [],
            benchMax: 5,
            handCount: 4,
            deckCount: 44,
            prize: [],
          }],
        },
      }],
    });

    expect(snapshot.steps[0].label).toBe('Player 1 shuffled 3 cards from hand into their deck.');
    expect(snapshot.steps[0].label).not.toContain('opening hand');
    expect(snapshot.steps[0].label).not.toContain('Maximum Belt');
  });

  it('exposes per-frame action timeline events for replay animations', () => {
    const snapshot = cabtReplayToSnapshot({
      visualize: [{
        logs: [
          { type: 'Shuffle', playerIndex: 1 },
        ],
        current: {
          turn: 2,
          yourIndex: 1,
          result: -1,
          players: [{
            active: [],
            bench: [],
            benchMax: 5,
            handCount: 0,
            deckCount: 12,
            prize: [],
          }, {
            active: [],
            bench: [],
            benchMax: 5,
            handCount: 0,
            deckCount: 14,
            prize: [],
          }],
        },
      }],
    });

    expect(snapshot.views[0].actionTimeline).toEqual([
      expect.objectContaining({
        kind: 'Shuffle',
        playerIndex: 1,
        message: 'Player 2 shuffled their deck.',
      }),
    ]);
  });

  it('keeps turn-end as a breakpoint while grouping deterministic turn-start draw', () => {
    const snapshot = cabtReplayToSnapshot({
      visualize: [{
        logs: [
          { type: 'TurnEnd', playerIndex: 0 },
          { type: 'TurnStart', playerIndex: 1 },
          { type: 'Draw', playerIndex: 1, cardId: 3, serial: 12 },
        ],
        current: {
          turn: 3,
          yourIndex: 1,
          result: -1,
          players: [{
            active: [],
            bench: [],
            benchMax: 5,
            handCount: 0,
            deckCount: 10,
            prize: [],
          }, {
            active: [],
            bench: [],
            benchMax: 5,
            handCount: 1,
            deckCount: 9,
            prize: [],
          }],
        },
      }],
    });

    expect(snapshot.steps.map((step) => step.label)).toEqual([
      'Player 1 ended their turn.',
      'Player 2 turn started.',
    ]);
    expect(snapshot.steps.map((step) => step.type)).toEqual(['TurnEnd', 'TurnStart']);
    expect(snapshot.steps[0].actionTimeline?.[0]).toEqual(expect.objectContaining({ kind: 'TurnEnd' }));
    expect(snapshot.steps[1].actionTimeline?.map((event) => event.kind)).toEqual(['TurnStart', 'Draw']);
  });

  it('does not show a later turn-start draw on an earlier attack step from the same frame', () => {
    const snapshot = cabtReplayToSnapshot({
      visualize: [{
        current: {
          turn: 2,
          yourIndex: 1,
          result: -1,
          players: [{
            active: [{ id: 722, serial: 10, hp: 70, maxHp: 70 }],
            bench: [],
            benchMax: 5,
            handCount: 6,
            deckCount: 45,
            prize: [],
          }, {
            active: [{ id: 721, serial: 20, hp: 150, maxHp: 150 }],
            bench: [],
            benchMax: 5,
            handCount: 6,
            deckCount: 43,
            prize: [],
          }],
        },
      }, {
        logs: [
          { type: 'Attack', playerIndex: 1, cardId: 721, serial: 20, attackId: 1042 },
          { type: 'HpChange', playerIndex: 0, cardId: 722, serial: 10, value: -30 },
          { type: 'TurnEnd', playerIndex: 1 },
          { type: 'TurnStart', playerIndex: 0 },
          { type: 'Draw', playerIndex: 0, cardId: 723, serial: 30 },
        ],
        current: {
          turn: 3,
          yourIndex: 0,
          result: -1,
          players: [{
            active: [{ id: 722, serial: 10, hp: 40, maxHp: 70 }],
            bench: [],
            benchMax: 5,
            hand: [
              { id: 1 },
              { id: 1 },
              { id: 1 },
              { id: 1 },
              { id: 1 },
              { id: 1 },
              { id: 723 },
            ],
            handCount: 7,
            deckCount: 44,
            prize: [],
          }, {
            active: [{ id: 721, serial: 20, hp: 150, maxHp: 150 }],
            bench: [],
            benchMax: 5,
            handCount: 6,
            deckCount: 43,
            prize: [],
          }],
        },
      }],
    });

    expect(snapshot.steps[1].label).toBe('Player 2 used Riptide with Kyogre.');
    expect(snapshot.steps[1].displayView?.players[0].hand).toHaveLength(6);
    expect(snapshot.steps[1].displayView?.players[0].deckCount).toBe(45);
    expect(snapshot.steps[1].displayView?.players[0].active.damage).toBe(30);

    expect(snapshot.steps[2].label).toBe('Player 2 ended their turn.');
    expect(snapshot.steps[2].displayView?.players[0].hand).toHaveLength(6);
    expect(snapshot.steps[2].displayView?.players[0].deckCount).toBe(45);

    expect(snapshot.steps[3].label).toBe('Player 1 turn started.');
    expect(snapshot.steps[3].displayView?.players[0].hand).toHaveLength(7);
    expect(snapshot.steps[3].displayView?.players[0].deckCount).toBe(44);
  });

  it('labels opening-hand draw checks without counting basic checks as cards', () => {
    const openingHandLogs = [
      ...Array.from({ length: 7 }, (_unused, index) => ({ type: 'Draw', playerIndex: 0, cardId: index + 1 })),
      { type: 'HasBasicPokemon', playerIndex: 0, hasBasicPokemon: true },
      ...Array.from({ length: 7 }, (_unused, index) => ({ type: 'Draw', playerIndex: 1, cardId: index + 11 })),
      { type: 'HasBasicPokemon', playerIndex: 1, hasBasicPokemon: true },
    ];
    const snapshot = cabtReplayToSnapshot({
      visualize: [{
        logs: openingHandLogs,
        current: {
          turn: 0,
          yourIndex: 0,
          result: -1,
          players: [{
            active: [],
            bench: [],
            benchMax: 5,
            handCount: 7,
            deckCount: 53,
            prize: [],
          }, {
            active: [],
            bench: [],
            benchMax: 5,
            handCount: 7,
            deckCount: 53,
            prize: [],
          }],
        },
      }],
    });

    expect(snapshot.steps[0].label).toBe('Players drew opening hands.');
    expect(snapshot.steps[0].actionTimeline).toHaveLength(16);
  });

  it('labels mulligan redraw groups without counting returned cards and shuffle as draws', () => {
    const firstHandDraws = Array.from({ length: 7 }, (_unused, index) => ({
      type: 'Draw',
      playerIndex: 1,
      cardId: index + 1,
      serial: index + 1,
    }));
    const returnedHand = Array.from({ length: 7 }, (_unused, index) => ({
      type: 'MoveCard',
      playerIndex: 1,
      cardId: index + 1,
      serial: index + 1,
      fromArea: CabtAreaType.HAND,
      toArea: CabtAreaType.DECK,
    }));
    const secondHandDraws = Array.from({ length: 7 }, (_unused, index) => ({
      type: 'Draw',
      playerIndex: 1,
      cardId: index + 11,
      serial: index + 11,
    }));
    const snapshot = cabtReplayToSnapshot({
      visualize: [{
        logs: [
          ...firstHandDraws,
          { type: 'HasBasicPokemon', playerIndex: 1, hasBasicPokemon: false },
          ...returnedHand,
          { type: 'Shuffle', playerIndex: 1 },
          ...secondHandDraws,
          { type: 'HasBasicPokemon', playerIndex: 1, hasBasicPokemon: true },
        ],
        current: {
          turn: 0,
          yourIndex: 0,
          result: -1,
          players: [{
            active: [],
            bench: [],
            benchMax: 5,
            handCount: 7,
            deckCount: 53,
            prize: [],
          }, {
            active: [],
            bench: [],
            benchMax: 5,
            handCount: 7,
            deckCount: 53,
            prize: [],
          }],
        },
      }],
    });

    expect(snapshot.steps[0].label).toBe('Player 2 redrew their opening hand.');
    expect(snapshot.steps[0].actionTimeline).toHaveLength(24);
  });

  it('uses attack names in replay step labels when card metadata has them', () => {
    const snapshot = cabtReplayToSnapshot({
      visualize: [{
        logs: [
          { type: 'Attack', playerIndex: 0, cardId: 96, serial: 3, attackId: 120 },
          { type: 'HpChange', playerIndex: 1, cardId: 150, serial: 72, value: -270, putDamageCounter: false },
          { type: 'MoveCard', playerIndex: 1, cardId: 1, serial: 111, fromArea: 8, toArea: 3 },
        ],
        current: {
          turn: 7,
          yourIndex: 0,
          result: -1,
          players: [{
            active: [{ id: 96, serial: 3, hp: 210, maxHp: 210 }],
            bench: [],
            benchMax: 5,
            handCount: 0,
            deckCount: 0,
            prize: [],
          }, {
            active: [],
            bench: [],
            benchMax: 5,
            handCount: 0,
            deckCount: 0,
            prize: [],
          }],
        },
      }],
    });

    expect(snapshot.steps[0].label).toBe('Player 1 used Myriad Leaf Shower with Teal Mask Ogerpon ex.');
    expect(snapshot.steps[0].actionTimeline?.map((event) => event.kind)).toEqual(['Attack', 'HpChange', 'MoveCard']);
  });
});
