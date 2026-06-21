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
            hand: [
              { id: 3, serial: 46 },
              { id: 1235, serial: 26 },
              { id: 722, serial: 6 },
              { id: 3, serial: 31 },
              { id: 3, serial: 50 },
              { id: 3, serial: 29 },
              { id: 1145, serial: 14 },
            ],
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
          { type: 'MoveCard', playerIndex: 0, cardId: 722, serial: 6, fromArea: CabtAreaType.HAND, toArea: CabtAreaType.ACTIVE },
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
            active: [{ id: 722, serial: 6, hp: 70, maxHp: 70 }],
            bench: [],
            benchMax: 5,
            hand: [
              { id: 3, serial: 46 },
              { id: 1235, serial: 26 },
              { id: 3, serial: 31 },
              { id: 3, serial: 50 },
              { id: 3, serial: 29 },
              { id: 1145, serial: 14 },
            ],
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
    expect(snapshot.steps[1].displayView?.players[0].hand.map((card) => card.serial)).toEqual([46, 26, 31, 50, 29, 14]);
    expect(snapshot.steps[2].label).toBe('Player 1 set 6 Prize cards.');
    expect(snapshot.steps[2].displayView?.players[0].prizesLeft).toBe(6);
    expect(snapshot.steps[2].displayView?.players[0].deckCount).toBe(47);
  });

  it('shows played hand cards in discard on the play step', () => {
    const snapshot = cabtReplayToSnapshot({
      visualize: [{
        current: {
          turn: 1,
          yourIndex: 0,
          result: -1,
          players: [{
            active: [{ id: 722, serial: 6, hp: 70, maxHp: 70 }],
            bench: [],
            benchMax: 5,
            hand: [
              { id: 3, serial: 46 },
              { id: 1145, serial: 14 },
            ],
            deckCount: 46,
            discard: [],
            prize: [],
          }, {
            active: [],
            bench: [],
            benchMax: 5,
            handCount: 0,
            deckCount: 53,
            prize: [],
          }],
        },
      }, {
        logs: [
          { type: 'Play', playerIndex: 0, cardId: 1145, serial: 14 },
        ],
        current: {
          turn: 1,
          yourIndex: 0,
          result: -1,
          players: [{
            active: [{ id: 722, serial: 6, hp: 70, maxHp: 70 }],
            bench: [],
            benchMax: 5,
            hand: [
              { id: 3, serial: 46 },
            ],
            deckCount: 46,
            discard: [{ id: 1145, serial: 14 }],
            prize: [],
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

    expect(snapshot.steps[1].label).toBe('Player 1 played Mega Signal.');
    expect(snapshot.views[snapshot.steps[1].stateIndex].players[0].hand.map((card) => card.serial)).toEqual([46]);
    expect(snapshot.views[snapshot.steps[1].stateIndex].players[0].discard.map((card) => card.serial)).toEqual([14]);
  });

  it('projects played trainer cards into discard when the engine frame is still resolving their effect', () => {
    const snapshot = cabtReplayToSnapshot({
      visualize: [{
        current: {
          turn: 1,
          yourIndex: 0,
          result: -1,
          players: [{
            active: [{ id: 722, serial: 6, hp: 70, maxHp: 70 }],
            bench: [],
            benchMax: 5,
            hand: [
              { id: 3, serial: 46 },
              { id: 1145, serial: 14 },
            ],
            deckCount: 46,
            discard: [],
            prize: [],
          }, {
            active: [],
            bench: [],
            benchMax: 5,
            handCount: 0,
            deckCount: 53,
            prize: [],
          }],
        },
      }, {
        logs: [
          { type: 'Play', playerIndex: 0, cardId: 1145, serial: 14 },
        ],
        current: {
          turn: 1,
          yourIndex: 0,
          result: -1,
          players: [{
            active: [{ id: 722, serial: 6, hp: 70, maxHp: 70 }],
            bench: [],
            benchMax: 5,
            hand: [
              { id: 3, serial: 46 },
            ],
            deckCount: 46,
            discard: [],
            prize: [],
          }, {
            active: [],
            bench: [],
            benchMax: 5,
            handCount: 0,
            deckCount: 53,
            prize: [],
          }],
        },
      }, {
        select: {
          type: 'Card',
          context: 'AttachFrom',
        },
        current: {
          turn: 1,
          yourIndex: 0,
          result: -1,
          players: [{
            active: [{ id: 722, serial: 6, hp: 70, maxHp: 70 }],
            bench: [],
            benchMax: 5,
            hand: [
              { id: 3, serial: 46 },
            ],
            deckCount: 46,
            discard: [],
            prize: [],
          }, {
            active: [],
            bench: [],
            benchMax: 5,
            handCount: 0,
            deckCount: 53,
            prize: [],
          }],
        },
      }, {
        logs: [
          { type: 'MoveCard', playerIndex: 0, cardId: 723, serial: 13, fromArea: CabtAreaType.DECK, toArea: CabtAreaType.HAND },
        ],
        current: {
          turn: 1,
          yourIndex: 0,
          result: -1,
          players: [{
            active: [{ id: 722, serial: 6, hp: 70, maxHp: 70 }],
            bench: [],
            benchMax: 5,
            hand: [
              { id: 3, serial: 46 },
              { id: 723, serial: 13 },
            ],
            deckCount: 45,
            discard: [{ id: 1145, serial: 14 }],
            prize: [],
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

    expect(snapshot.steps[1].label).toBe('Player 1 played Mega Signal.');
    expect(snapshot.steps[1].displayView?.players[0].hand.map((card) => card.serial)).toEqual([46]);
    expect(snapshot.steps[1].displayView?.players[0].discard.map((card) => card.serial)).toEqual([14]);
    expect(snapshot.views[snapshot.steps[1].stateIndex].players[0].discard).toHaveLength(0);
    expect(snapshot.steps[2].displayView?.players[0].discard.map((card) => card.serial)).toEqual([14]);
    expect(snapshot.views[snapshot.steps[2].stateIndex].players[0].discard).toHaveLength(0);
    expect(snapshot.views[snapshot.steps[3].stateIndex].players[0].discard.map((card) => card.serial)).toEqual([14]);
  });

  it('holds the pre-evolution board state while an evolution animation resolves', () => {
    const snapshot = cabtReplayToSnapshot({
      visualize: [{
        current: {
          turn: 1,
          yourIndex: 0,
          result: -1,
          players: [{
            active: [{ id: 722, serial: 6, hp: 90, maxHp: 90 }],
            bench: [],
            benchMax: 5,
            hand: [
              { id: 723, serial: 13 },
              { id: 3, serial: 46 },
            ],
            deckCount: 46,
            discard: [],
            prize: [],
          }, {
            active: [],
            bench: [],
            benchMax: 5,
            handCount: 0,
            deckCount: 53,
            prize: [],
          }],
        },
      }, {
        logs: [
          { type: 'Evolve', playerIndex: 0, cardId: 723, serial: 13, cardIdTarget: 722, serialTarget: 6 },
          { type: 'HpChange', playerIndex: 0, cardId: 723, serial: 13, value: -30 },
        ],
        current: {
          turn: 1,
          yourIndex: 0,
          result: -1,
          players: [{
            active: [{
              id: 723,
              serial: 13,
              hp: 320,
              maxHp: 350,
              preEvolution: [{ id: 722, serial: 6 }],
            }],
            bench: [],
            benchMax: 5,
            hand: [
              { id: 3, serial: 46 },
            ],
            deckCount: 46,
            discard: [],
            prize: [],
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

    const evolveStep = snapshot.steps[1];
    expect(evolveStep.label).toBe('Player 1 evolved into Mega Abomasnow ex.');
    expect(evolveStep.animationPhases?.map((phase) => phase.key)).toEqual(['Evolve:0']);
    expect(evolveStep.animationPhases?.[0].view.players[0].active.pokemon?.id).toBe(722);
    expect(evolveStep.animationPhases?.[0].view.players[0].active.damage).toBe(0);
    expect(evolveStep.animationPhases?.[0].view.players[0].hand.map((card) => card.serial)).toEqual([46]);
    expect(snapshot.views[evolveStep.stateIndex].players[0].active.pokemon?.id).toBe(723);
    expect(snapshot.views[evolveStep.stateIndex].players[0].active.damage).toBe(30);
  });

  it('holds a pre-evolution bench slot while a bench evolution animation resolves', () => {
    const snapshot = cabtReplayToSnapshot({
      visualize: [{
        current: {
          turn: 1,
          yourIndex: 0,
          result: -1,
          players: [{
            active: [],
            bench: [{ id: 722, serial: 6, hp: 90, maxHp: 90 }],
            benchMax: 5,
            hand: [
              { id: 723, serial: 13 },
              { id: 3, serial: 46 },
            ],
            deckCount: 46,
            discard: [],
            prize: [],
          }, {
            active: [],
            bench: [],
            benchMax: 5,
            handCount: 0,
            deckCount: 53,
            prize: [],
          }],
        },
      }, {
        logs: [
          { type: 'Evolve', playerIndex: 0, cardId: 723, serial: 13, cardIdTarget: 722, serialTarget: 6 },
        ],
        current: {
          turn: 1,
          yourIndex: 0,
          result: -1,
          players: [{
            active: [],
            bench: [{
              id: 723,
              serial: 13,
              hp: 350,
              maxHp: 350,
              preEvolution: [{ id: 722, serial: 6 }],
            }],
            benchMax: 5,
            hand: [
              { id: 3, serial: 46 },
            ],
            deckCount: 46,
            discard: [],
            prize: [],
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

    const evolveStep = snapshot.steps[1];
    expect(evolveStep.animationPhases?.[0].view.players[0].bench[0].pokemon?.id).toBe(722);
    expect(evolveStep.animationPhases?.[0].view.players[0].hand.map((card) => card.serial)).toEqual([46]);
    expect(snapshot.views[evolveStep.stateIndex].players[0].bench[0].pokemon?.id).toBe(723);
    expect(snapshot.views[evolveStep.stateIndex].players[0].bench[0].cards.map((card) => card.serial)).toEqual([13, 6]);
  });

  it('coalesces searched deck cards and shuffle into the played card step', () => {
    const snapshot = cabtReplayToSnapshot({
      visualize: [{
        current: {
          turn: 1,
          yourIndex: 0,
          result: -1,
          players: [{
            active: [{ id: 722, serial: 6, hp: 70, maxHp: 70 }],
            bench: [],
            benchMax: 5,
            hand: [
              { id: 3, serial: 46 },
              { id: 1145, serial: 14 },
            ],
            deckCount: 46,
            discard: [],
            prize: [],
          }, {
            active: [],
            bench: [],
            benchMax: 5,
            handCount: 0,
            deckCount: 53,
            prize: [],
          }],
        },
      }, {
        logs: [
          { type: 'Play', playerIndex: 0, cardId: 1145, serial: 14 },
        ],
        select: {
          type: 'Card',
          context: 'ToHand',
          deck: Array.from({ length: 46 }, (_unused, index) => index),
        },
        current: {
          turn: 1,
          yourIndex: 0,
          result: -1,
          players: [{
            active: [{ id: 722, serial: 6, hp: 70, maxHp: 70 }],
            bench: [],
            benchMax: 5,
            hand: [
              { id: 3, serial: 46 },
            ],
            deckCount: 46,
            discard: [],
            prize: [],
          }, {
            active: [],
            bench: [],
            benchMax: 5,
            handCount: 0,
            deckCount: 53,
            prize: [],
          }],
        },
      }, {
        logs: [
          { type: 'MoveCard', playerIndex: 0, cardId: 723, serial: 13, fromArea: CabtAreaType.DECK, toArea: CabtAreaType.HAND },
        ],
        current: {
          turn: 1,
          yourIndex: 0,
          result: -1,
          players: [{
            active: [{ id: 722, serial: 6, hp: 70, maxHp: 70 }],
            bench: [],
            benchMax: 5,
            hand: [
              { id: 3, serial: 46 },
              { id: 723, serial: 13 },
            ],
            deckCount: 45,
            discard: [],
            prize: [],
          }, {
            active: [],
            bench: [],
            benchMax: 5,
            handCount: 0,
            deckCount: 53,
            prize: [],
          }],
        },
      }, {
        logs: [
          { type: 'Shuffle', playerIndex: 0 },
        ],
        current: {
          turn: 1,
          yourIndex: 0,
          result: -1,
          players: [{
            active: [{ id: 722, serial: 6, hp: 70, maxHp: 70 }],
            bench: [],
            benchMax: 5,
            hand: [
              { id: 3, serial: 46 },
              { id: 723, serial: 13 },
            ],
            deckCount: 45,
            discard: [{ id: 1145, serial: 14 }],
            prize: [],
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

    expect(snapshot.steps).toHaveLength(2);
    const step = snapshot.steps[1];
    expect(step.label).toBe('Player 1 played Mega Signal, revealed a card from their deck and put it into their hand, and shuffled their deck.');
    expect(step.stateIndex).toBe(3);
    expect(step.actionTimeline?.map((event) => event.kind)).toEqual([
      'Play',
      'MoveCard',
      'Shuffle',
    ]);
    expect(step.animationPhases?.map((phase) => phase.key.replace(/:\d+$/, ''))).toEqual([
      'Play',
      'DeckSearchReveal',
      'Shuffle',
    ]);
    expect(step.animationPhases?.map((phase) => phase.label)).toEqual([
      'Player 1 played Mega Signal.',
      'Player 1 revealed a card from their deck and put it into their hand.',
      'Player 1 shuffled their deck.',
    ]);
    // The search-reveal phase includes the destination hand card so the animation can
    // measure and hide the real slot while the reveal sprite lands on it.
    expect(step.animationPhases?.[1].view.players[0].hand.map((card) => card.serial)).toEqual([46, 13]);
    expect(step.animationPhases?.[2].view.players[0].hand.map((card) => card.serial)).toEqual([46, 13]);
  });

  it('does not coalesce unrelated played cards with later deck-to-hand movement', () => {
    const snapshot = cabtReplayToSnapshot({
      visualize: [{
        current: {
          turn: 1,
          yourIndex: 0,
          result: -1,
          players: [{
            active: [{ id: 722, serial: 6, hp: 70, maxHp: 70 }],
            bench: [],
            benchMax: 5,
            hand: [
              { id: 3, serial: 46 },
              { id: 1145, serial: 14 },
            ],
            deckCount: 46,
            discard: [],
            prize: [],
          }, {
            active: [],
            bench: [],
            benchMax: 5,
            handCount: 0,
            deckCount: 53,
            prize: [],
          }],
        },
      }, {
        logs: [
          { type: 'Play', playerIndex: 0, cardId: 1145, serial: 14 },
        ],
        current: {
          turn: 1,
          yourIndex: 0,
          result: -1,
          players: [{
            active: [{ id: 722, serial: 6, hp: 70, maxHp: 70 }],
            bench: [],
            benchMax: 5,
            hand: [
              { id: 3, serial: 46 },
            ],
            deckCount: 46,
            discard: [],
            prize: [],
          }, {
            active: [],
            bench: [],
            benchMax: 5,
            handCount: 0,
            deckCount: 53,
            prize: [],
          }],
        },
      }, {
        select: {
          type: 'Card',
          context: 'AttachTo',
        },
        current: {
          turn: 1,
          yourIndex: 0,
          result: -1,
          players: [{
            active: [{ id: 722, serial: 6, hp: 70, maxHp: 70 }],
            bench: [],
            benchMax: 5,
            hand: [
              { id: 3, serial: 46 },
            ],
            deckCount: 46,
            discard: [],
            prize: [],
          }, {
            active: [],
            bench: [],
            benchMax: 5,
            handCount: 0,
            deckCount: 53,
            prize: [],
          }],
        },
      }, {
        logs: [
          { type: 'MoveCard', playerIndex: 0, cardId: 723, serial: 13, fromArea: CabtAreaType.DECK, toArea: CabtAreaType.HAND },
        ],
        current: {
          turn: 1,
          yourIndex: 0,
          result: -1,
          players: [{
            active: [{ id: 722, serial: 6, hp: 70, maxHp: 70 }],
            bench: [],
            benchMax: 5,
            hand: [
              { id: 3, serial: 46 },
              { id: 723, serial: 13 },
            ],
            deckCount: 45,
            discard: [],
            prize: [],
          }, {
            active: [],
            bench: [],
            benchMax: 5,
            handCount: 0,
            deckCount: 53,
            prize: [],
          }],
        },
      }, {
        logs: [
          { type: 'Shuffle', playerIndex: 0 },
        ],
        current: {
          turn: 1,
          yourIndex: 0,
          result: -1,
          players: [{
            active: [{ id: 722, serial: 6, hp: 70, maxHp: 70 }],
            bench: [],
            benchMax: 5,
            hand: [
              { id: 3, serial: 46 },
              { id: 723, serial: 13 },
            ],
            deckCount: 45,
            discard: [{ id: 1145, serial: 14 }],
            prize: [],
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

    const playStep = snapshot.steps.find((step) => step.label === 'Player 1 played Mega Signal.');
    expect(playStep?.stateIndex).toBe(1);
    expect(playStep?.actionTimeline?.map((event) => event.kind)).toEqual(['Play']);
    expect(playStep?.animationPhases?.some((phase) => phase.key.startsWith('DeckSearchReveal:')) ?? false).toBe(false);
    expect(snapshot.steps.some((step) => step.actionTimeline?.some((event) => event.kind === 'MoveCard'))).toBe(true);
  });

  it('does not project played Pokemon cards into discard when they enter play', () => {
    const snapshot = cabtReplayToSnapshot({
      visualize: [{
        current: {
          turn: 1,
          yourIndex: 0,
          result: -1,
          players: [{
            active: [{ id: 722, serial: 6, hp: 70, maxHp: 70 }],
            bench: [],
            benchMax: 5,
            hand: [
              { id: 722, serial: 7 },
            ],
            deckCount: 46,
            discard: [],
            prize: [],
          }, {
            active: [],
            bench: [],
            benchMax: 5,
            handCount: 0,
            deckCount: 53,
            prize: [],
          }],
        },
      }, {
        logs: [
          { type: 'Play', playerIndex: 0, cardId: 722, serial: 7 },
        ],
        current: {
          turn: 1,
          yourIndex: 0,
          result: -1,
          players: [{
            active: [{ id: 722, serial: 6, hp: 70, maxHp: 70 }],
            bench: [{ id: 722, serial: 7, hp: 70, maxHp: 70 }],
            benchMax: 5,
            hand: [],
            deckCount: 46,
            discard: [],
            prize: [],
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

    expect(snapshot.steps[1].displayView).toBeUndefined();
    expect(snapshot.views[snapshot.steps[1].stateIndex].players[0].discard).toHaveLength(0);
    expect(snapshot.views[snapshot.steps[1].stateIndex].players[0].bench[0].pokemon?.serial).toBe(7);
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

  it('builds phased animation views for play, hand reset, shuffle, and draw actions', () => {
    const snapshot = cabtReplayToSnapshot({
      visualize: [{
        current: {
          turn: 2,
          yourIndex: 0,
          result: -1,
          players: [{
            active: [],
            bench: [],
            benchMax: 5,
            hand: [
              { id: 3, serial: 120 },
              { id: 1227, serial: 83 },
              { id: 3, serial: 101 },
              { id: 1227, serial: 81 },
              { id: 3, serial: 109 },
              { id: 3, serial: 100 },
            ],
            deckCount: 43,
            discard: [],
            prize: [],
          }, {
            active: [],
            bench: [],
            benchMax: 5,
            handCount: 0,
            deckCount: 43,
            prize: [],
          }],
        },
      }, {
        logs: [
          { type: 'Play', playerIndex: 0, cardId: 1227, serial: 83 },
          { type: 'MoveCard', playerIndex: 0, cardId: 3, serial: 120, fromArea: CabtAreaType.HAND, toArea: CabtAreaType.DECK },
          { type: 'MoveCard', playerIndex: 0, cardId: 3, serial: 101, fromArea: CabtAreaType.HAND, toArea: CabtAreaType.DECK },
          { type: 'MoveCard', playerIndex: 0, cardId: 1227, serial: 81, fromArea: CabtAreaType.HAND, toArea: CabtAreaType.DECK },
          { type: 'MoveCard', playerIndex: 0, cardId: 3, serial: 109, fromArea: CabtAreaType.HAND, toArea: CabtAreaType.DECK },
          { type: 'MoveCard', playerIndex: 0, cardId: 3, serial: 100, fromArea: CabtAreaType.HAND, toArea: CabtAreaType.DECK },
          { type: 'Shuffle', playerIndex: 0 },
          { type: 'Draw', playerIndex: 0, cardId: 3, serial: 94 },
          { type: 'Draw', playerIndex: 0, cardId: 3, serial: 102 },
          { type: 'Draw', playerIndex: 0, cardId: 1227, serial: 80 },
          { type: 'Draw', playerIndex: 0, cardId: 3, serial: 100 },
        ],
        current: {
          turn: 2,
          yourIndex: 0,
          result: -1,
          players: [{
            active: [],
            bench: [],
            benchMax: 5,
            hand: [
              { id: 3, serial: 94 },
              { id: 3, serial: 102 },
              { id: 1227, serial: 80 },
              { id: 3, serial: 100 },
            ],
            deckCount: 44,
            discard: [{ id: 1227, serial: 83 }],
            prize: [],
          }, {
            active: [],
            bench: [],
            benchMax: 5,
            handCount: 0,
            deckCount: 43,
            prize: [],
          }],
        },
      }],
    });

    const step = snapshot.steps[1];
    expect(step.label).toBe("Player 1 played Lillie's Determination, shuffled 5 cards from hand into their deck, and drew 4 cards.");
    expect(step.animationPhases?.map((phase) => phase.key.replace(/:\d+$/, ''))).toEqual([
      'Play',
      'HandToDeck',
      'Shuffle',
      'Draw',
    ]);
    expect(step.animationPhases?.map((phase) => phase.label)).toEqual([
      "Player 1 played Lillie's Determination.",
      'Player 1 put 5 cards from hand into their deck.',
      'Player 1 shuffled their deck.',
      'Player 1 drew 4 cards.',
    ]);
    expect(step.animationPhases?.[0].view.players[0].hand.map((card) => card.serial)).toEqual([120, 101, 81, 109, 100]);
    expect(step.animationPhases?.[1].view.players[0].hand.map((card) => card.serial)).toEqual([120, 101, 81, 109, 100]);
    expect(step.animationPhases?.[2].view.players[0].hand).toHaveLength(0);
    expect(step.animationPhases?.[3].view.players[0].hand.map((card) => card.serial)).toEqual([94, 102, 80, 100]);
  });

  it('builds a separate deck reveal phase for Waitress-style topdeck looks', () => {
    const snapshot = cabtReplayToSnapshot({
      visualize: [{
        current: {
          turn: 2,
          yourIndex: 0,
          result: -1,
          players: [{
            active: [{ id: 722, serial: 6 }],
            bench: [],
            benchMax: 5,
            hand: [
              { id: 1235, serial: 26 },
              { id: 3, serial: 31 },
            ],
            deckCount: 46,
            discard: [],
            prize: [],
          }, {
            active: [],
            bench: [],
            benchMax: 5,
            handCount: 0,
            deckCount: 46,
            prize: [],
          }],
        },
      }, {
        logs: [
          { type: 'Play', playerIndex: 0, cardId: 1235, serial: 26 },
          { type: 'MoveCard', playerIndex: 0, cardId: 3, serial: 32, fromArea: CabtAreaType.DECK, toArea: CabtAreaType.LOOKING },
          { type: 'MoveCard', playerIndex: 0, cardId: 3, serial: 58, fromArea: CabtAreaType.DECK, toArea: CabtAreaType.LOOKING },
          { type: 'MoveCard', playerIndex: 0, cardId: 1227, serial: 22, fromArea: CabtAreaType.DECK, toArea: CabtAreaType.LOOKING },
        ],
        current: {
          turn: 2,
          yourIndex: 0,
          result: -1,
          looking: [
            { id: 3, serial: 32 },
            { id: 3, serial: 58 },
            { id: 1227, serial: 22 },
          ],
          players: [{
            active: [{ id: 722, serial: 6 }],
            bench: [],
            benchMax: 5,
            hand: [
              { id: 3, serial: 31 },
            ],
            deckCount: 43,
            discard: [],
            prize: [],
          }, {
            active: [],
            bench: [],
            benchMax: 5,
            handCount: 0,
            deckCount: 46,
            prize: [],
          }],
        },
      }],
    });

    const step = snapshot.steps[1];
    expect(step.animationPhases?.map((phase) => phase.key.replace(/:\d+$/, ''))).toEqual([
      'Play',
      'DeckReveal',
    ]);
    expect(step.animationPhases?.map((phase) => phase.label)).toEqual([
      'Player 1 played Waitress.',
      'Player 1 revealed the top 3 cards of their deck.',
    ]);
    expect(step.animationPhases?.[0].view.players[0].hand.map((card) => card.serial)).toEqual([31]);
    expect(step.animationPhases?.[1].view.players[0].deckCount).toBe(43);
  });

  it('coalesces Waitress-style reveal, attach, return, and shuffle into one replay step', () => {
    const snapshot = cabtReplayToSnapshot({
      visualize: [{
        current: {
          turn: 2,
          yourIndex: 0,
          result: -1,
          players: [{
            active: [{ id: 722, serial: 6 }],
            bench: [],
            benchMax: 5,
            hand: [
              { id: 1235, serial: 26 },
              { id: 3, serial: 31 },
            ],
            deckCount: 46,
            discard: [],
            prize: [],
          }, {
            active: [],
            bench: [],
            benchMax: 5,
            handCount: 0,
            deckCount: 46,
            prize: [],
          }],
        },
      }, {
        logs: [
          { type: 'Play', playerIndex: 0, cardId: 1235, serial: 26 },
          { type: 'MoveCard', playerIndex: 0, cardId: 3, serial: 32, fromArea: CabtAreaType.DECK, toArea: CabtAreaType.LOOKING },
          { type: 'MoveCard', playerIndex: 0, cardId: 3, serial: 58, fromArea: CabtAreaType.DECK, toArea: CabtAreaType.LOOKING },
          { type: 'MoveCard', playerIndex: 0, cardId: 1227, serial: 22, fromArea: CabtAreaType.DECK, toArea: CabtAreaType.LOOKING },
        ],
        select: {
          type: 'Card',
          context: 'AttachTo',
        },
        current: {
          turn: 2,
          yourIndex: 0,
          result: -1,
          looking: [
            { id: 3, serial: 32 },
            { id: 3, serial: 58 },
            { id: 1227, serial: 22 },
          ],
          players: [{
            active: [{ id: 722, serial: 6 }],
            bench: [],
            benchMax: 5,
            hand: [
              { id: 3, serial: 31 },
            ],
            deckCount: 43,
            discard: [],
            prize: [],
          }, {
            active: [],
            bench: [],
            benchMax: 5,
            handCount: 0,
            deckCount: 46,
            prize: [],
          }],
        },
      }, {
        select: {
          type: 'Card',
          context: 'AttachFrom',
          contextCard: { id: 3, serial: 32 },
        },
        current: {
          turn: 2,
          yourIndex: 0,
          result: -1,
          looking: [
            { id: 3, serial: 32 },
            { id: 3, serial: 58 },
            { id: 1227, serial: 22 },
          ],
          players: [{
            active: [{ id: 722, serial: 6 }],
            bench: [],
            benchMax: 5,
            hand: [
              { id: 3, serial: 31 },
            ],
            deckCount: 43,
            discard: [],
            prize: [],
          }, {
            active: [],
            bench: [],
            benchMax: 5,
            handCount: 0,
            deckCount: 46,
            prize: [],
          }],
        },
      }, {
        logs: [
          { type: 'Attach', playerIndex: 0, cardId: 3, serial: 32, cardIdTarget: 722, serialTarget: 6 },
          { type: 'MoveCard', playerIndex: 0, cardId: 3, serial: 58, fromArea: CabtAreaType.LOOKING, toArea: CabtAreaType.DECK },
          { type: 'MoveCard', playerIndex: 0, cardId: 1227, serial: 22, fromArea: CabtAreaType.LOOKING, toArea: CabtAreaType.DECK },
          { type: 'Shuffle', playerIndex: 0 },
        ],
        current: {
          turn: 2,
          yourIndex: 0,
          result: -1,
          players: [{
            active: [{
              id: 722,
              serial: 6,
              energyCards: [{ id: 3, serial: 32 }],
            }],
            bench: [],
            benchMax: 5,
            hand: [
              { id: 3, serial: 31 },
            ],
            deckCount: 45,
            discard: [{ id: 1235, serial: 26 }],
            prize: [],
          }, {
            active: [],
            bench: [],
            benchMax: 5,
            handCount: 0,
            deckCount: 46,
            prize: [],
          }],
        },
      }],
    });

    expect(snapshot.steps).toHaveLength(2);
    const step = snapshot.steps[1];
    expect(step.label).toBe('Player 1 played Waitress, revealed the top 3 cards of their deck, attached Basic Water Energy to Snover, returned 2 revealed cards to their deck, and shuffled their deck.');
    expect(step.stateIndex).toBe(3);
    expect(step.actionTimeline?.map((event) => event.kind)).toEqual([
      'Play',
      'MoveCard',
      'MoveCard',
      'MoveCard',
      'Attach',
      'MoveCard',
      'MoveCard',
      'Shuffle',
    ]);
    expect(step.animationPhases?.map((phase) => phase.key.replace(/:\d+$/, ''))).toEqual([
      'Play',
      'DeckReveal',
      'Attach',
      'DeckRevealReturn',
      'Shuffle',
    ]);
    expect(step.animationPhases?.map((phase) => phase.label)).toEqual([
      'Player 1 played Waitress.',
      'Player 1 revealed the top 3 cards of their deck.',
      'Player 1 attached Basic Water Energy to Snover.',
      'Player 1 returned 2 revealed cards to their deck.',
      'Player 1 shuffled their deck.',
    ]);
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

  it('splits attacks into announce, discard, damage, and knockout animation phases', () => {
    const snapshot = cabtReplayToSnapshot({
      visualize: [{
        current: {
          turn: 3,
          yourIndex: 0,
          result: -1,
          players: [{
            active: [{ id: 723, serial: 13, hp: 350, maxHp: 350 }],
            bench: [],
            benchMax: 5,
            handCount: 0,
            deckCount: 45,
            discard: [],
            prize: [],
          }, {
            active: [{ id: 721, serial: 64, hp: 150, maxHp: 150 }],
            bench: [{ id: 721, serial: 99, hp: 150, maxHp: 150 }],
            benchMax: 5,
            handCount: 0,
            deckCount: 46,
            discard: [],
            prize: [],
          }],
        },
      }, {
        logs: [
          { type: 'Attack', playerIndex: 0, cardId: 723, serial: 13, attackId: 1046 },
          { type: 'MoveCard', playerIndex: 0, cardId: 3, serial: 56, fromArea: CabtAreaType.DECK, toArea: CabtAreaType.DISCARD },
          { type: 'MoveCard', playerIndex: 0, cardId: 1235, serial: 27, fromArea: CabtAreaType.DECK, toArea: CabtAreaType.DISCARD },
          { type: 'HpChange', playerIndex: 1, cardId: 721, serial: 64, value: -400, putDamageCounter: false },
          { type: 'MoveCard', playerIndex: 1, cardId: 721, serial: 64, fromArea: CabtAreaType.ACTIVE, toArea: CabtAreaType.DISCARD },
          { type: 'MoveCard', playerIndex: 1, cardId: 3, serial: 96, fromArea: CabtAreaType.ENERGY, toArea: CabtAreaType.DISCARD },
        ],
        current: {
          turn: 3,
          yourIndex: 0,
          result: -1,
          players: [{
            active: [{ id: 723, serial: 13, hp: 350, maxHp: 350 }],
            bench: [],
            benchMax: 5,
            handCount: 0,
            deckCount: 43,
            discard: [{ id: 3, serial: 56 }, { id: 1235, serial: 27 }],
            prize: [],
          }, {
            active: [],
            bench: [{ id: 721, serial: 99, hp: 150, maxHp: 150 }],
            benchMax: 5,
            handCount: 0,
            deckCount: 46,
            discard: [{ id: 721, serial: 64 }, { id: 3, serial: 96 }],
            prize: [],
          }],
        },
      }],
    });

    const step = snapshot.steps[1];
    expect(step.actionTimeline?.map((event) => event.kind)).toEqual([
      'Attack',
      'MoveCard',
      'MoveCard',
      'HpChange',
      'MoveCard',
      'MoveCard',
    ]);
    expect(step.animationPhases?.map((phase) => phase.key.replace(/:\d+$/, ''))).toEqual([
      'Attack',
      'DeckDiscard',
      'Damage',
      'KnockOut',
    ]);
    expect(step.animationPhases?.[0].view.players[1].active.pokemon?.serial).toBe(64);
    expect(step.animationPhases?.[2].view.players[1].active.pokemon?.serial).toBe(64);
    expect(step.animationPhases?.[2].view.players[1].active.damage).toBe(0);
    expect(step.animationPhases?.[3].view.players[1].active.pokemon?.serial).toBe(64);
    expect(step.animationPhases?.[3].view.players[1].active.damage).toBe(400);
    expect(step.animationPhases?.[3].view.players[1].bench[0].pokemon?.serial).toBe(99);
    expect(step.animationPhases?.[3].view.players[1].bench[0].damage).toBe(0);
    expect(snapshot.views[step.stateIndex].players[1].active.empty).toBe(true);
    expect(snapshot.views[step.stateIndex].players[1].discard.map((card) => card.serial)).toEqual([96, 64]);
    expect(snapshot.views[step.stateIndex].players[1].discard.at(-1)?.serial).toBe(64);
  });

  it('holds the source board while a benched Pokemon is promoted active', () => {
    const snapshot = cabtReplayToSnapshot({
      visualize: [{
        current: {
          turn: 4,
          yourIndex: 0,
          result: -1,
          players: [{
            active: [],
            bench: [],
            benchMax: 5,
            handCount: 0,
            deckCount: 45,
            prize: [],
          }, {
            active: [],
            bench: [{ id: 722, serial: 67, hp: 90, maxHp: 90 }],
            benchMax: 5,
            handCount: 0,
            deckCount: 46,
            prize: [],
          }],
        },
      }, {
        logs: [
          { type: 'MoveCard', playerIndex: 1, cardId: 722, serial: 67, fromArea: CabtAreaType.BENCH, toArea: CabtAreaType.ACTIVE },
        ],
        current: {
          turn: 4,
          yourIndex: 0,
          result: -1,
          players: [{
            active: [],
            bench: [],
            benchMax: 5,
            handCount: 0,
            deckCount: 45,
            prize: [],
          }, {
            active: [{ id: 722, serial: 67, hp: 90, maxHp: 90 }],
            bench: [],
            benchMax: 5,
            handCount: 0,
            deckCount: 46,
            prize: [],
          }],
        },
      }],
    });

    const step = snapshot.steps[1];
    expect(step.animationPhases?.map((phase) => phase.key)).toEqual(['BoardMove:1']);
    expect(step.animationPhases?.[0].view.players[1].bench[0].pokemon?.serial).toBe(67);
    expect(step.animationPhases?.[0].view.players[1].active.empty).toBe(true);
    expect(snapshot.views[step.stateIndex].players[1].active.pokemon?.serial).toBe(67);
    expect(snapshot.views[step.stateIndex].players[1].bench.some((slot) => slot.pokemon?.serial === 67)).toBe(false);
  });

  it('holds the source board while active and benched Pokemon switch places', () => {
    const snapshot = cabtReplayToSnapshot({
      visualize: [{
        current: {
          turn: 4,
          yourIndex: 0,
          result: -1,
          players: [{
            active: [{ id: 721, serial: 64, hp: 150, maxHp: 150 }],
            bench: [{ id: 722, serial: 67, hp: 90, maxHp: 90 }],
            benchMax: 5,
            handCount: 0,
            deckCount: 45,
            prize: [],
          }, {
            active: [],
            bench: [],
            benchMax: 5,
            handCount: 0,
            deckCount: 46,
            prize: [],
          }],
        },
      }, {
        logs: [
          { type: 'MoveCard', playerIndex: 0, cardId: 721, serial: 64, fromArea: CabtAreaType.ACTIVE, toArea: CabtAreaType.BENCH },
          { type: 'MoveCard', playerIndex: 0, cardId: 722, serial: 67, fromArea: CabtAreaType.BENCH, toArea: CabtAreaType.ACTIVE },
        ],
        current: {
          turn: 4,
          yourIndex: 0,
          result: -1,
          players: [{
            active: [{ id: 722, serial: 67, hp: 90, maxHp: 90 }],
            bench: [{ id: 721, serial: 64, hp: 150, maxHp: 150 }],
            benchMax: 5,
            handCount: 0,
            deckCount: 45,
            prize: [],
          }, {
            active: [],
            bench: [],
            benchMax: 5,
            handCount: 0,
            deckCount: 46,
            prize: [],
          }],
        },
      }],
    });

    const step = snapshot.steps[1];
    expect(step.animationPhases?.map((phase) => phase.key)).toEqual(['BoardMove:0']);
    expect(step.animationPhases?.[0].actionTimeline).toHaveLength(2);
    expect(step.animationPhases?.[0].view.players[0].active.pokemon?.serial).toBe(64);
    expect(step.animationPhases?.[0].view.players[0].bench[0].pokemon?.serial).toBe(67);
    expect(snapshot.views[step.stateIndex].players[0].active.pokemon?.serial).toBe(67);
    expect(snapshot.views[step.stateIndex].players[0].bench[0].pokemon?.serial).toBe(64);
  });
});
