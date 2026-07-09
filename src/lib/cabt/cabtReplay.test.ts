import { describe, expect, it } from 'vitest';
import { cabtReplayToSnapshot } from './cabtReplay';
import { CabtAreaType } from './types';

describe('cabtReplayToSnapshot', () => {
  it('loads top-level Kaggle episode JSON from the public archive datasets', () => {
    const snapshot = cabtReplayToSnapshot({
      id: 'episode-env-id',
      title: 'Card Battle',
      info: {
        EpisodeId: 81726640,
        TeamNames: ['Archive player 1', 'Archive player 2'],
      },
      steps: [[{
        action: [],
        reward: 0,
        status: 'ACTIVE',
        observation: { step: 0 },
        visualize: [{
          current: {
            turn: 1,
            yourIndex: 0,
            result: -1,
            players: [{
              active: [],
              bench: [],
              benchMax: 5,
              handCount: 0,
              deckCount: 60,
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
      }]],
    });

    expect(snapshot.id).toBe('episode-env-id');
    expect(snapshot.name).toBe('Card Battle replay');
    expect(snapshot.players.map((player) => player.name)).toEqual(['Archive player 1', 'Archive player 2']);
    expect(snapshot.views).toHaveLength(1);
  });

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

  it('assigns replay stadium cards only to their owning player', () => {
    const snapshot = cabtReplayToSnapshot({
      visualize: [{
        current: {
          turn: 1,
          yourIndex: 0,
          result: -1,
          stadium: [{ id: 1264, serial: 62, playerIndex: 1 }],
          players: [{
            active: [],
            bench: [],
            benchMax: 5,
            handCount: 0,
            deckCount: 60,
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

    expect(snapshot.views[0].players[0].stadium).toHaveLength(0);
    expect(snapshot.views[0].players[1].stadium.map((card) => card.serial)).toEqual([62]);
  });

  it('announces a YesNo-confirmed triggered ability and merges its prompt-chained effect', () => {
    const opponent = { active: [], bench: [], benchMax: 5, handCount: 0, deckCount: 60, prize: [] };
    const me = { active: [{ id: 648, serial: 71, hp: 300, maxHp: 300 }], bench: [], benchMax: 5, hand: [], deckCount: 40, discard: [], prize: [] };
    const current = { turn: 2, yourIndex: 1, result: -1, players: [opponent, me] };
    const snapshot = cabtReplayToSnapshot({
      visualize: [{
        select: { type: 'YesNo', contextCard: { id: 648, playerIndex: 1, serial: 71 }, option: [{ type: 'Yes' }, { type: 'No' }] },
        current,
      }, {
        action: [[], [0]],
        logs: [],
        select: { type: 'Card', option: [{ type: 'Card', area: 1, index: 3 }] },
        current,
      }, {
        action: [[], [0]],
        logs: [
          { type: 'Attach', playerIndex: 1, cardId: 7, serial: 116, cardIdTarget: 648, serialTarget: 71 },
          { type: 'Shuffle', playerIndex: 1 },
        ],
        select: { type: 'Main', option: [{ type: 'End' }] },
        current,
      }],
    });

    const step = snapshot.steps.find((candidate) => candidate.actionTimeline?.some((event) => event.kind === 'Ability'));
    expect(step?.label).toBe("Player 2 used Punk Up with Marnie's Grimmsnarl ex.");
    expect(step?.actionTimeline?.map((event) => event.kind)).toEqual(['Ability', 'Attach', 'Shuffle']);
  });

  it('merges a used stadium search into one announced step', () => {
    const players = (deckCount: number, hand: Array<{ id: number; serial: number }>) => [{
      active: [{ id: 66, serial: 14, hp: 140, maxHp: 140 }],
      bench: [],
      benchMax: 5,
      hand,
      deckCount,
      discard: [],
      prize: [],
    }, {
      active: [],
      bench: [],
      benchMax: 5,
      handCount: 0,
      deckCount: 60,
      prize: [],
    }];
    const snapshot = cabtReplayToSnapshot({
      visualize: [{
        select: {
          type: 'Main',
          option: [
            { type: 'Ability', area: CabtAreaType.STADIUM, index: 0 },
            { type: 'End' },
          ],
        },
        current: {
          turn: 1,
          yourIndex: 0,
          result: -1,
          stadium: [{ id: 1259, serial: 62 }],
          players: players(40, []),
        },
      }, {
        action: [[0], []],
        logs: [
          { type: 'MoveCard', playerIndex: 0, cardId: 900, serial: 90, fromArea: CabtAreaType.DECK, toArea: CabtAreaType.HAND, openType: 1 },
        ],
        current: {
          turn: 1,
          yourIndex: 0,
          result: -1,
          stadium: [{ id: 1259, serial: 62 }],
          players: players(39, [{ id: 900, serial: 90 }]),
        },
      }, {
        logs: [
          { type: 'Shuffle', playerIndex: 0 },
        ],
        current: {
          turn: 1,
          yourIndex: 0,
          result: -1,
          stadium: [{ id: 1259, serial: 62 }],
          players: players(39, [{ id: 900, serial: 90 }]),
        },
      }],
    });

    const step = snapshot.steps[1];
    expect(snapshot.steps).toHaveLength(2);
    expect(step.label).toBe('Player 1 used Spikemuth Gym.');
    expect(step.actionTimeline?.map((event) => event.kind)).toEqual(['Ability', 'MoveCard', 'Shuffle']);
    expect(step.actionTimeline?.[0].params).toMatchObject({
      type: 'Ability',
      area: CabtAreaType.STADIUM,
      cardId: 1259,
      serial: 62,
      abilityName: 'Spikemuth Gym',
    });
  });

  it('gives an instantly resolved trainer a play-zone hold and a discard resolve phase', () => {
    const opponent = {
      active: [], bench: [], benchMax: 5, handCount: 0, deckCount: 60, prize: [],
    };
    const me = (hand: Array<{ id: number; serial: number }>, discard: Array<{ id: number; serial: number }>) => ({
      active: [{ id: 66, serial: 14, hp: 140, maxHp: 140 }],
      bench: [], benchMax: 5, hand, deckCount: 40, discard, prize: [],
    });
    const snapshot = cabtReplayToSnapshot({
      visualize: [{
        current: { turn: 1, yourIndex: 0, result: -1, players: [me([{ id: 1141, serial: 80 }], []), opponent] },
      }, {
        logs: [{ type: 'Play', playerIndex: 0, cardId: 1141, serial: 80 }],
        current: { turn: 1, yourIndex: 0, result: -1, players: [me([], [{ id: 1141, serial: 80 }]), opponent] },
      }],
    });

    const step = snapshot.steps[1];
    expect(step.animationPhases?.map((phase) => phase.key)).toEqual(['Play:0', 'PlayResolve:0']);
    expect(step.animationPhases?.[0].view.players[0].playZone.map((card) => card.serial)).toEqual([80]);
    expect(step.animationPhases?.[0].view.players[0].discard).toHaveLength(0);
    expect(step.animationPhases?.[1].view.players[0].playZone).toHaveLength(0);
    expect(step.animationPhases?.[1].view.players[0].discard.map((card) => card.serial)).toEqual([80]);
    expect(step.displayView?.players[0].discard.map((card) => card.serial)).toEqual([80]);
  });

  it('keeps the previous discard top visible while hand cards fly onto the pile', () => {
    const opponent = {
      active: [], bench: [], benchMax: 5, handCount: 0, deckCount: 60, prize: [],
    };
    const me = (hand: Array<{ id: number; serial: number }>, discard: Array<{ id: number; serial: number }>) => ({
      active: [{ id: 66, serial: 14, hp: 140, maxHp: 140 }],
      bench: [], benchMax: 5, hand, deckCount: 40, discard, prize: [],
    });
    const snapshot = cabtReplayToSnapshot({
      visualize: [{
        current: {
          turn: 1, yourIndex: 0, result: -1,
          players: [me([{ id: 1181, serial: 70 }, { id: 3, serial: 71 }, { id: 4, serial: 72 }], [{ id: 5, serial: 60 }]), opponent],
        },
      }, {
        logs: [
          { type: 'Play', playerIndex: 0, cardId: 1181, serial: 70 },
          { type: 'MoveCard', playerIndex: 0, cardId: 3, serial: 71, fromArea: CabtAreaType.HAND, toArea: CabtAreaType.DISCARD },
          { type: 'MoveCard', playerIndex: 0, cardId: 4, serial: 72, fromArea: CabtAreaType.HAND, toArea: CabtAreaType.DISCARD },
          { type: 'Draw', playerIndex: 0, cardId: 6, serial: 101 },
        ],
        current: {
          turn: 1, yourIndex: 0, result: -1,
          players: [me(
            [{ id: 6, serial: 101 }],
            [{ id: 5, serial: 60 }, { id: 3, serial: 71 }, { id: 4, serial: 72 }, { id: 1181, serial: 70 }],
          ), opponent],
        },
      }],
    });

    const step = snapshot.steps[1];
    const handMovePhase = step.animationPhases?.find((phase) => phase.key.startsWith('HandMove:0:'));
    expect(handMovePhase).toBeDefined();
    // Only the pre-existing top card shows while the dumped cards are in
    // flight; the played supporter is held in the play zone.
    expect(handMovePhase?.view.players[0].discard.map((card) => card.serial)).toEqual([60]);
    expect(handMovePhase?.view.players[0].playZone.map((card) => card.serial)).toEqual([70]);
  });

  it('keeps a turn-long trainer in the play zone until it reaches the discard', () => {
    const opponent = {
      active: [],
      bench: [],
      benchMax: 5,
      handCount: 0,
      deckCount: 60,
      prize: [],
    };
    const me = (hand: Array<{ id: number; serial: number }>, discard: Array<{ id: number; serial: number }>) => ({
      active: [{ id: 66, serial: 14, hp: 140, maxHp: 140 }],
      bench: [],
      benchMax: 5,
      hand,
      deckCount: 40,
      discard,
      prize: [],
    });
    const snapshot = cabtReplayToSnapshot({
      visualize: [{
        current: { turn: 1, yourIndex: 0, result: -1, players: [me([{ id: 1141, serial: 80 }], []), opponent] },
      }, {
        select: { type: 'Main', option: [{ type: 'End' }], effect: { id: 1141, serial: 80 } },
        logs: [
          { type: 'Play', playerIndex: 0, cardId: 1141, serial: 80 },
          { type: 'MoveCard', playerIndex: 0, cardId: 1141, serial: 80, fromArea: CabtAreaType.HAND, toArea: CabtAreaType.PLAYING },
        ],
        current: { turn: 1, yourIndex: 0, result: -1, players: [me([], []), opponent] },
      }, {
        select: { type: 'Main', option: [{ type: 'End' }], effect: { id: 1141, serial: 80 } },
        logs: [
          { type: 'Draw', playerIndex: 0, cardId: 3, serial: 101 },
        ],
        current: { turn: 1, yourIndex: 0, result: -1, players: [me([{ id: 3, serial: 101 }], []), opponent] },
      }, {
        logs: [
          { type: 'TurnEnd', playerIndex: 0 },
          { type: 'MoveCard', playerIndex: 0, cardId: 1141, serial: 80, fromArea: CabtAreaType.PLAYING, toArea: CabtAreaType.DISCARD },
        ],
        current: { turn: 1, yourIndex: 0, result: -1, players: [me([{ id: 3, serial: 101 }], [{ id: 1141, serial: 80 }]), opponent] },
      }],
    });

    const playStep = snapshot.steps.find((step) =>
      step.actionTimeline?.some((event) => event.kind === 'Play'));
    expect(playStep?.displayView?.players[0].playZone.map((card) => card.serial)).toEqual([80]);

    const drawStep = snapshot.steps.find((step) =>
      step.actionTimeline?.some((event) => event.kind === 'Draw'));
    expect(drawStep?.displayView?.players[0].playZone.map((card) => card.serial)).toEqual([80]);

    const endStep = snapshot.steps.find((step) =>
      step.actionTimeline?.some((event) => event.kind === 'TurnEnd'));
    expect(endStep).toBeDefined();
    expect(snapshot.views[endStep!.stateIndex].players[0].discard.map((card) => card.serial)).toEqual([80]);
    expect(endStep?.displayView?.players[0].playZone ?? []).toHaveLength(0);
  });

  it('synthesizes selected ability usage before its logged effects', () => {
    const snapshot = cabtReplayToSnapshot({
      visualize: [{
        select: {
          type: 'Main',
          option: [
            { type: 'Ability', area: CabtAreaType.ACTIVE, index: 0 },
            { type: 'End' },
          ],
        },
        current: {
          turn: 1,
          yourIndex: 0,
          result: -1,
          players: [{
            active: [{ id: 66, serial: 14, hp: 140, maxHp: 140 }],
            bench: [],
            benchMax: 5,
            hand: [],
            deckCount: 40,
            discard: [],
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
      }, {
        action: [[0], []],
        logs: [
          { type: 'Draw', playerIndex: 0, cardId: 3, serial: 101 },
          { type: 'Draw', playerIndex: 0, cardId: 4, serial: 102 },
          { type: 'MoveCard', playerIndex: 0, cardId: 66, serial: 14, fromArea: CabtAreaType.ACTIVE, toArea: CabtAreaType.DECK },
          { type: 'Shuffle', playerIndex: 0 },
        ],
        current: {
          turn: 1,
          yourIndex: 0,
          result: -1,
          players: [{
            active: [],
            bench: [],
            benchMax: 5,
            hand: [
              { id: 3, serial: 101 },
              { id: 4, serial: 102 },
            ],
            deckCount: 39,
            discard: [],
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

    const step = snapshot.steps[1];
    expect(snapshot.views[0].players[0].active.cards[0].powers?.[0].name).toBe('Run Away Draw');
    expect(step.label).toBe('Player 1 used Run Away Draw with Dudunsparce.');
    expect(step.actionTimeline?.map((event) => event.kind)).toEqual(['Ability', 'Draw', 'Draw', 'MoveCard', 'Shuffle']);
    expect(step.actionTimeline?.[0].params).toMatchObject({
      type: 'Ability',
      playerIndex: 0,
      cardId: 66,
      serial: 14,
      abilityName: 'Run Away Draw',
      area: CabtAreaType.ACTIVE,
      index: 0,
    });
    expect(step.animationPhases?.map((phase) => phase.key)).toEqual(['Ability:0', 'Draw:0', 'BoardToDeck:0', 'Shuffle:0']);
    expect(step.animationPhases?.[0].view.players[0].active.pokemon?.serial).toBe(14);
    expect(step.animationPhases?.[2].view.players[0].active.pokemon?.serial).toBe(14);
    expect(step.animationPhases?.[2].view.players[0].deckCount).toBe(38);
    expect(snapshot.views[step.stateIndex].players[0].active.empty).toBe(true);
    expect(snapshot.views[step.stateIndex].players[0].deckCount).toBe(39);
  });

  it('announces an on-attach-effect energy by name, inserted right after the attach', () => {
    const target = { id: 722, serial: 6, hp: 90, maxHp: 90 };
    const opponent = { active: [], bench: [], benchMax: 5, handCount: 0, deckCount: 60, prize: [] };
    const snapshot = cabtReplayToSnapshot({
      visualize: [{
        select: {
          type: 'Main',
          option: [
            { type: 'Attach', area: CabtAreaType.HAND, index: 0, playerIndex: 0 },
            { type: 'End' },
          ],
        },
        current: {
          turn: 1,
          yourIndex: 0,
          result: -1,
          players: [{
            active: [target],
            bench: [],
            benchMax: 5,
            hand: [{ id: 19, serial: 32 }],
            deckCount: 40,
            discard: [],
            prize: [],
          }, opponent],
        },
      }, {
        action: [[0], []],
        logs: [
          { type: 'Attach', playerIndex: 0, cardId: 19, serial: 32, cardIdTarget: 722, serialTarget: 6 },
          { type: 'Draw', playerIndex: 0, cardId: 4, serial: 101 },
          { type: 'Draw', playerIndex: 0, cardId: 5, serial: 102 },
          { type: 'Draw', playerIndex: 0, cardId: 6, serial: 103 },
          { type: 'Draw', playerIndex: 0, cardId: 7, serial: 104 },
        ],
        select: { type: 'Main', option: [{ type: 'End' }] },
        current: {
          turn: 1,
          yourIndex: 0,
          result: -1,
          players: [{
            active: [{
              ...target,
              energyCards: [{ id: 19, serial: 32 }],
            }],
            bench: [],
            benchMax: 5,
            hand: [
              { id: 4, serial: 101 },
              { id: 5, serial: 102 },
              { id: 6, serial: 103 },
              { id: 7, serial: 104 },
            ],
            deckCount: 36,
            discard: [],
            prize: [],
          }, opponent],
        },
      }],
    });

    const step = snapshot.steps[1];
    expect(step.label).toBe('Player 1 attached Telepath Psychic Energy to Snover.');
    expect(step.actionTimeline?.map((event) => event.kind)).toEqual(['Attach', 'Ability', 'Draw', 'Draw', 'Draw', 'Draw']);
    expect(step.actionTimeline?.[1].params).toMatchObject({
      type: 'Ability',
      cardId: 19,
      serial: 32,
      cardIdTarget: 722,
      serialTarget: 6,
      abilityName: 'Telepath Psychic Energy',
      trigger: 'Attach',
    });
    expect(step.animationPhases?.map((phase) => phase.key)).toEqual(['Attach:0', 'Ability:0', 'Draw:0']);
    expect(step.animationPhases?.[0].view.players[0].hand).toHaveLength(0);
    expect(step.animationPhases?.[1].actionTimeline.map((event) => event.kind)).toEqual(['Ability']);
    expect(step.animationPhases?.[2].actionTimeline.map((event) => event.kind)).toEqual(['Draw', 'Draw', 'Draw', 'Draw']);
  });

  it('keeps played Stadium cards in the stadium zone instead of the resolving discard path', () => {
    const snapshot = cabtReplayToSnapshot({
      visualize: [{
        current: {
          turn: 1,
          yourIndex: 0,
          result: -1,
          players: [{
            active: [],
            bench: [],
            benchMax: 5,
            hand: [{ id: 1264, serial: 62 }],
            deckCount: 59,
            discard: [],
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
      }, {
        logs: [
          { type: 'Play', playerIndex: 0, cardId: 1264, serial: 62 },
        ],
        current: {
          turn: 1,
          yourIndex: 0,
          result: -1,
          stadium: [{ id: 1264, serial: 62, playerIndex: 0 }],
          players: [{
            active: [],
            bench: [],
            benchMax: 5,
            hand: [],
            deckCount: 59,
            discard: [],
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

    const step = snapshot.steps[1];
    expect(step.actionTimeline?.map((event) => event.kind)).toEqual(['Play']);
    expect(step.animationPhases).toBeUndefined();
    expect(step.displayView).toBeUndefined();
    expect(snapshot.views[step.stateIndex].players[0].stadium.map((card) => card.serial)).toEqual([62]);
    expect(snapshot.views[step.stateIndex].players[0].playZone).toHaveLength(0);
    expect(snapshot.views[step.stateIndex].players[0].discard).toHaveLength(0);
  });

  it('keeps a countered Stadium visible until its discard animation phase', () => {
    const snapshot = cabtReplayToSnapshot({
      visualize: [{
        current: {
          turn: 1,
          yourIndex: 0,
          result: -1,
          stadium: [{ id: 1255, serial: 120, playerIndex: 1 }],
          players: [{
            active: [],
            bench: [],
            benchMax: 5,
            hand: [{ id: 1264, serial: 62 }],
            deckCount: 59,
            discard: [],
            prize: [],
          }, {
            active: [],
            bench: [],
            benchMax: 5,
            handCount: 0,
            deckCount: 60,
            discard: [],
            prize: [],
          }],
        },
      }, {
        logs: [
          { type: 'Play', playerIndex: 0, cardId: 1264, serial: 62 },
          { type: 'MoveCard', playerIndex: 1, cardId: 1255, serial: 120, fromArea: CabtAreaType.STADIUM, toArea: CabtAreaType.DISCARD },
        ],
        current: {
          turn: 1,
          yourIndex: 0,
          result: -1,
          stadium: [{ id: 1264, serial: 62, playerIndex: 0 }],
          players: [{
            active: [],
            bench: [],
            benchMax: 5,
            hand: [],
            deckCount: 59,
            discard: [],
            prize: [],
          }, {
            active: [],
            bench: [],
            benchMax: 5,
            handCount: 0,
            deckCount: 60,
            discard: [{ id: 1255, serial: 120 }],
            prize: [],
          }],
        },
      }],
    });

    const step = snapshot.steps[1];
    expect(step.actionTimeline?.map((event) => event.kind)).toEqual(['Play', 'MoveCard']);
    expect(step.animationPhases?.map((phase) => phase.key)).toEqual(['Play:0', 'StadiumMove:1:7->3']);
    expect(step.animationPhases?.[0].view.players[0].stadium.map((card) => card.serial)).toEqual([62]);
    expect(step.animationPhases?.[0].view.players[1].stadium.map((card) => card.serial)).toEqual([120]);
    expect(step.animationPhases?.[0].view.players[1].discard).toHaveLength(0);
    expect(step.animationPhases?.[1].view.players[0].stadium.map((card) => card.serial)).toEqual([62]);
    expect(step.animationPhases?.[1].view.players[1].stadium.map((card) => card.serial)).toEqual([120]);
    expect(step.animationPhases?.[1].view.players[1].discard).toHaveLength(0);
    expect(snapshot.views[step.stateIndex].players[0].stadium.map((card) => card.serial)).toEqual([62]);
    expect(snapshot.views[step.stateIndex].players[1].stadium).toHaveLength(0);
    expect(snapshot.views[step.stateIndex].players[1].discard.map((card) => card.serial)).toEqual([120]);
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

    const step = snapshot.steps[1];
    expect(step.label).toBe('Player 1 played Mega Signal and revealed a card from their deck and put it into their hand.');
    expect(step.stateIndex).toBe(3);
    expect(step.actionTimeline?.map((event) => event.kind)).toEqual(['Play', 'MoveCard']);
    expect(step.animationPhases?.map((phase) => phase.key)).toEqual(['Play:0', 'DeckSearchReveal:0']);
    expect(step.animationPhases?.[0].view.players[0].hand.map((card) => card.serial)).toEqual([46]);
    expect(step.animationPhases?.[0].view.players[0].playZone.map((card) => card.serial)).toEqual([14]);
    expect(step.animationPhases?.[0].view.players[0].discard).toHaveLength(0);
    expect(step.animationPhases?.[1].view.players[0].hand.map((card) => card.serial)).toEqual([46, 13]);
    expect(step.animationPhases?.[1].view.players[0].playZone.map((card) => card.serial)).toEqual([14]);
    expect(step.animationPhases?.[1].view.players[0].discard).toHaveLength(0);
    expect(step.displayView?.players[0].hand.map((card) => card.serial)).toEqual([46, 13]);
    expect(step.displayView?.players[0].playZone).toHaveLength(0);
    expect(step.displayView?.players[0].discard.map((card) => card.serial)).toEqual([14]);
    expect(snapshot.views[step.stateIndex].players[0].discard.map((card) => card.serial)).toEqual([14]);
  });

  it('keeps a played trainer in the resolving zone during the follow-up board move animation', () => {
    const snapshot = cabtReplayToSnapshot({
      visualize: [{
        current: {
          turn: 1,
          yourIndex: 0,
          result: -1,
          players: [{
            active: [{ id: 304, serial: 79, hp: 150, maxHp: 150 }],
            bench: [{ id: 878, serial: 81, hp: 90, maxHp: 90 }],
            benchMax: 5,
            hand: [
              { id: 1182, serial: 14 },
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
          { type: 'Play', playerIndex: 0, cardId: 1182, serial: 14 },
        ],
        current: {
          turn: 1,
          yourIndex: 0,
          result: -1,
          players: [{
            active: [{ id: 304, serial: 79, hp: 150, maxHp: 150 }],
            bench: [{ id: 878, serial: 81, hp: 90, maxHp: 90 }],
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
      }, {
        logs: [
          {
            type: 'Switch',
            playerIndex: 0,
            cardIdActive: 304,
            serialActive: 79,
            cardIdBench: 878,
            serialBench: 81,
          },
        ],
        current: {
          turn: 1,
          yourIndex: 0,
          result: -1,
          players: [{
            active: [{ id: 878, serial: 81, hp: 90, maxHp: 90 }],
            bench: [{ id: 304, serial: 79, hp: 150, maxHp: 150 }],
            benchMax: 5,
            hand: [],
            deckCount: 46,
            discard: [{ id: 1182, serial: 14 }],
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

    const step = snapshot.steps[1];
    expect(step.actionTimeline?.map((event) => event.kind)).toEqual(['Play', 'Switch']);
    expect(step.animationPhases?.map((phase) => phase.key)).toEqual(['Play:0', 'BoardMove:0']);
    expect(step.animationPhases?.[0].view.players[0].playZone.map((card) => card.serial)).toEqual([14]);
    expect(step.animationPhases?.[0].view.players[0].discard).toHaveLength(0);
    expect(step.animationPhases?.[0].view.players[0].active.pokemon?.serial).toBe(79);
    expect(step.animationPhases?.[1].view.players[0].playZone.map((card) => card.serial)).toEqual([14]);
    expect(step.animationPhases?.[1].view.players[0].discard).toHaveLength(0);
    expect(step.animationPhases?.[1].view.players[0].active.pokemon?.serial).toBe(79);
    expect(step.displayView?.players[0].playZone).toHaveLength(0);
    expect(step.displayView?.players[0].discard.map((card) => card.serial)).toEqual([14]);
    expect(step.displayView?.players[0].active.pokemon?.serial).toBe(81);
    expect(snapshot.views[step.stateIndex].players[0].discard.map((card) => card.serial)).toEqual([14]);
    expect(snapshot.views[step.stateIndex].players[0].active.pokemon?.serial).toBe(81);
  });

  it('coalesces a played evolution helper with its evolution animation', () => {
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
              { id: 1079, serial: 32 },
              { id: 723, serial: 13 },
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
          { type: 'Play', playerIndex: 0, cardId: 1079, serial: 32 },
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
              { id: 723, serial: 13 },
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
            active: [{
              id: 723,
              serial: 13,
              hp: 350,
              maxHp: 350,
              preEvolution: [{ id: 722, serial: 6 }],
            }],
            bench: [],
            benchMax: 5,
            hand: [],
            deckCount: 46,
            discard: [{ id: 1079, serial: 32 }],
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

    const step = snapshot.steps[1];
    expect(step.actionTimeline?.map((event) => event.kind)).toEqual(['Play', 'Evolve']);
    expect(step.animationPhases?.map((phase) => phase.key)).toEqual(['Play:0', 'Evolve:0']);
    expect(step.animationPhases?.[1].view.players[0].playZone.map((card) => card.serial)).toEqual([32]);
    expect(step.animationPhases?.[1].view.players[0].discard).toHaveLength(0);
    expect(step.animationPhases?.[1].view.players[0].active.pokemon?.serial).toBe(6);
    expect(step.displayView?.players[0].playZone).toHaveLength(0);
    expect(step.displayView?.players[0].discard.map((card) => card.serial)).toEqual([32]);
    expect(snapshot.views[step.stateIndex].players[0].active.pokemon?.serial).toBe(13);
  });

  it('coalesces evolution-triggered abilities with the evolution action', () => {
    const snapshot = cabtReplayToSnapshot({
      visualize: [{
        current: {
          turn: 1,
          yourIndex: 0,
          result: -1,
          players: [{
            active: [{ id: 741, serial: 20, hp: 50, maxHp: 50 }],
            bench: [],
            benchMax: 5,
            hand: [
              { id: 1079, serial: 32 },
              { id: 743, serial: 28 },
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
          { type: 'Play', playerIndex: 0, cardId: 1079, serial: 32 },
        ],
        current: {
          turn: 1,
          yourIndex: 0,
          result: -1,
          players: [{
            active: [{ id: 741, serial: 20, hp: 50, maxHp: 50 }],
            bench: [],
            benchMax: 5,
            hand: [
              { id: 743, serial: 28 },
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
          { type: 'Evolve', playerIndex: 0, cardId: 743, serial: 28, cardIdTarget: 741, serialTarget: 20 },
        ],
        current: {
          turn: 1,
          yourIndex: 0,
          result: -1,
          players: [{
            active: [{ id: 743, serial: 28, hp: 140, maxHp: 140, preEvolution: [{ id: 741, serial: 20 }] }],
            bench: [],
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
      }, {
        logs: [
          { type: 'Draw', playerIndex: 0, cardId: 66, serial: 12 },
          { type: 'Draw', playerIndex: 0, cardId: 743, serial: 27 },
          { type: 'Draw', playerIndex: 0, cardId: 1225, serial: 54 },
        ],
        current: {
          turn: 1,
          yourIndex: 0,
          result: -1,
          players: [{
            active: [{ id: 743, serial: 28, hp: 140, maxHp: 140, preEvolution: [{ id: 741, serial: 20 }] }],
            bench: [],
            benchMax: 5,
            hand: [
              { id: 66, serial: 12 },
              { id: 743, serial: 27 },
              { id: 1225, serial: 54 },
            ],
            deckCount: 43,
            discard: [{ id: 1079, serial: 32 }],
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

    const step = snapshot.steps[1];
    expect(step.stateIndex).toBe(3);
    expect(step.actionTimeline?.map((event) => event.kind)).toEqual(['Play', 'Evolve', 'Ability', 'Draw', 'Draw', 'Draw']);
    expect(step.actionTimeline?.[2].message).toBe('Player 1 used Psychic Draw with Alakazam.');
    expect(step.actionTimeline?.[2].params).toMatchObject({
      type: 'Ability',
      playerIndex: 0,
      cardId: 743,
      serial: 28,
      abilityName: 'Psychic Draw',
      trigger: 'Evolve',
      area: CabtAreaType.ACTIVE,
      index: 0,
    });
    expect(step.animationPhases?.map((phase) => phase.key)).toEqual(['Play:0', 'Evolve:0', 'Ability:0', 'Draw:0']);
    expect(step.animationPhases?.[2].view.players[0].active.pokemon?.serial).toBe(28);
    expect(step.animationPhases?.[2].view.players[0].hand).toHaveLength(0);
    expect(step.displayView?.players[0].hand.map((card) => card.serial)).toEqual([12, 27, 54]);
  });

  it('coalesces a played trainer with an attached-card discard animation', () => {
    const snapshot = cabtReplayToSnapshot({
      visualize: [{
        current: {
          turn: 1,
          yourIndex: 0,
          result: -1,
          players: [{
            active: [],
            bench: [],
            benchMax: 5,
            hand: [
              { id: 1081, serial: 35 },
            ],
            deckCount: 46,
            discard: [],
            prize: [],
          }, {
            active: [{
              id: 722,
              serial: 6,
              hp: 70,
              maxHp: 70,
              energyCards: [{ id: 3, serial: 70 }],
            }],
            bench: [],
            benchMax: 5,
            handCount: 0,
            deckCount: 53,
            discard: [],
            prize: [],
          }],
        },
      }, {
        logs: [
          { type: 'Play', playerIndex: 0, cardId: 1081, serial: 35 },
        ],
        current: {
          turn: 1,
          yourIndex: 0,
          result: -1,
          players: [{
            active: [],
            bench: [],
            benchMax: 5,
            hand: [],
            deckCount: 46,
            discard: [],
            prize: [],
          }, {
            active: [{
              id: 722,
              serial: 6,
              hp: 70,
              maxHp: 70,
              energyCards: [{ id: 3, serial: 70 }],
            }],
            bench: [],
            benchMax: 5,
            handCount: 0,
            deckCount: 53,
            discard: [],
            prize: [],
          }],
        },
      }, {
        logs: [
          { type: 'MoveCard', playerIndex: 1, cardId: 3, serial: 70, fromArea: CabtAreaType.ENERGY, toArea: CabtAreaType.DISCARD },
        ],
        current: {
          turn: 1,
          yourIndex: 0,
          result: -1,
          players: [{
            active: [],
            bench: [],
            benchMax: 5,
            hand: [],
            deckCount: 46,
            discard: [{ id: 1081, serial: 35 }],
            prize: [],
          }, {
            active: [{
              id: 722,
              serial: 6,
              hp: 70,
              maxHp: 70,
              energyCards: [],
            }],
            bench: [],
            benchMax: 5,
            handCount: 0,
            deckCount: 53,
            discard: [{ id: 3, serial: 70 }],
            prize: [],
          }],
        },
      }],
    });

    const step = snapshot.steps[1];
    expect(step.actionTimeline?.map((event) => event.kind)).toEqual(['Play', 'MoveCard']);
    expect(step.animationPhases?.map((phase) => phase.key)).toEqual(['Play:0', 'AttachedMove:1:8->3']);
    expect(step.animationPhases?.[1].view.players[0].playZone.map((card) => card.serial)).toEqual([35]);
    expect(step.animationPhases?.[1].view.players[0].discard).toHaveLength(0);
    expect(step.animationPhases?.[1].view.players[1].active.energy.map((card) => card.serial)).toEqual([70]);
    expect(step.displayView?.players[0].playZone).toHaveLength(0);
    expect(step.displayView?.players[0].discard.map((card) => card.serial)).toEqual([35]);
    expect(snapshot.views[step.stateIndex].players[1].discard.map((card) => card.serial)).toEqual([70]);
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

  it('does not coalesce a played card with actions taken after the main menu returned', () => {
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
        // The played card resolves within its own frame: the select is already
        // back at the main menu, so the next answered frame is a new decision.
        select: { type: 'Main', option: [{ type: 'End' }] },
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

  it('coalesces a coin-flip trainer with its cross-player discard consequence', () => {
    const me = (hand: Array<{ id: number; serial: number }>, discard: Array<{ id: number; serial: number }>) => ({
      active: [{ id: 66, serial: 14, hp: 140, maxHp: 140 }],
      bench: [],
      benchMax: 5,
      hand,
      deckCount: 40,
      discard,
      prize: [],
    });
    const opponent = (energyCards: Array<{ id: number; serial: number }>, discard: Array<{ id: number; serial: number }>) => ({
      active: [{ id: 722, serial: 6, hp: 70, maxHp: 70, energyCards }],
      bench: [],
      benchMax: 5,
      handCount: 0,
      deckCount: 60,
      discard,
      prize: [],
    });
    const snapshot = cabtReplayToSnapshot({
      visualize: [{
        current: { turn: 1, yourIndex: 0, result: -1, players: [me([{ id: 1120, serial: 80 }], []), opponent([{ id: 3, serial: 70 }], [])] },
      }, {
        logs: [
          { type: 'Play', playerIndex: 0, cardId: 1120, serial: 80 },
        ],
        select: { type: 'YesNo', context: 'CoinHead', option: [{ type: 'Yes' }, { type: 'No' }] },
        current: { turn: 1, yourIndex: 0, result: -1, players: [me([], []), opponent([{ id: 3, serial: 70 }], [])] },
      }, {
        action: [[0], []],
        logs: [
          { type: 'Coin', playerIndex: 0, head: true },
        ],
        select: { type: 'Card', context: 'DiscardEnergy' },
        current: { turn: 1, yourIndex: 0, result: -1, players: [me([], []), opponent([{ id: 3, serial: 70 }], [])] },
      }, {
        action: [[0], []],
        logs: [
          { type: 'MoveCard', playerIndex: 1, cardId: 3, serial: 70, fromArea: CabtAreaType.ENERGY, toArea: CabtAreaType.DISCARD },
        ],
        select: { type: 'Main', option: [{ type: 'End' }] },
        current: { turn: 1, yourIndex: 0, result: -1, players: [me([], [{ id: 1120, serial: 80 }]), opponent([], [{ id: 3, serial: 70 }])] },
      }],
    });

    expect(snapshot.steps).toHaveLength(2);
    const step = snapshot.steps[1];
    expect(step.label).toBe('Player 1 played Crushing Hammer.');
    expect(step.stateIndex).toBe(3);
    expect(step.actionTimeline?.map((event) => event.kind)).toEqual(['Play', 'Coin', 'MoveCard']);
    expect(step.animationPhases?.map((phase) => phase.key)).toEqual(['Play:0', 'Coin:0', 'AttachedMove:1:8->3']);
    expect(step.animationPhases?.[0].view.players[0].playZone.map((card) => card.serial)).toEqual([80]);
    expect(step.animationPhases?.[2].view.players[1].active.energy.map((card) => card.serial)).toEqual([70]);
    expect(step.displayView?.players[0].discard.map((card) => card.serial)).toEqual([80]);
    expect(snapshot.views[step.stateIndex].players[1].discard.map((card) => card.serial)).toEqual([70]);
  });

  it('merges a prompt-chained ability and cuts its shared frame at the turn boundary', () => {
    const me = {
      active: [{ id: 66, serial: 14, hp: 140, maxHp: 140 }],
      bench: [],
      benchMax: 5,
      hand: [],
      deckCount: 40,
      discard: [],
      prize: [],
    };
    const opponent = (hp: number, handCount: number) => ({
      active: [{ id: 722, serial: 6, hp, maxHp: 70 }],
      bench: [],
      benchMax: 5,
      handCount,
      deckCount: 60,
      discard: [],
      prize: [],
    });
    const snapshot = cabtReplayToSnapshot({
      visualize: [{
        select: {
          type: 'Main',
          option: [
            { type: 'Ability', area: CabtAreaType.ACTIVE, index: 0 },
            { type: 'End' },
          ],
        },
        current: { turn: 2, yourIndex: 0, result: -1, players: [me, opponent(70, 6)] },
      }, {
        action: [[0], []],
        logs: [],
        select: { type: 'Card', context: 'Damage' },
        current: { turn: 2, yourIndex: 0, result: -1, players: [me, opponent(70, 6)] },
      }, {
        action: [[0], []],
        logs: [
          { type: 'HpChange', playerIndex: 1, cardId: 722, serial: 6, value: -30 },
          { type: 'TurnEnd', playerIndex: 0 },
          { type: 'TurnStart', playerIndex: 1 },
          { type: 'Draw', playerIndex: 1, cardId: 3, serial: 101 },
        ],
        current: { turn: 3, yourIndex: 1, result: -1, players: [me, opponent(40, 7)] },
      }],
    });

    expect(snapshot.steps.map((step) => step.type)).toEqual(['Main', 'Ability', 'TurnEnd', 'TurnStart']);
    const abilityStep = snapshot.steps[1];
    expect(abilityStep.label).toBe('Player 1 used Run Away Draw with Dudunsparce.');
    // The effect tail shares its frame with the turn transition; the step keeps
    // the tail but leaves the turn boundary to step on its own.
    expect(abilityStep.stateIndex).toBe(1);
    expect(abilityStep.actionTimeline?.map((event) => event.kind)).toEqual(['Ability', 'HPChange']);
    expect(snapshot.steps[2].actionTimeline?.map((event) => event.kind)).toEqual(['TurnEnd']);
    expect(snapshot.steps[3].label).toBe('Player 2 turn started.');
    expect(snapshot.steps[3].actionTimeline?.map((event) => event.kind)).toEqual(['TurnStart', 'Draw']);
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

  it('keeps repeated hand-to-bench placements as distinct replay steps', () => {
    const snapshot = cabtReplayToSnapshot({
      visualize: [{
        current: {
          turn: 1,
          yourIndex: 0,
          result: -1,
          players: [{
            active: [],
            bench: [],
            benchMax: 5,
            handCount: 0,
            deckCount: 53,
            prize: [],
          }, {
            active: [{ id: 304, serial: 79, hp: 180, maxHp: 180 }],
            bench: [],
            benchMax: 5,
            hand: [
              { id: 65, serial: 75 },
              { id: 65, serial: 73 },
            ],
            deckCount: 47,
            prize: [],
          }],
        },
      }, {
        logs: [
          { type: 'MoveCard', playerIndex: 1, cardId: 65, serial: 75, fromArea: CabtAreaType.HAND, toArea: CabtAreaType.BENCH },
          { type: 'MoveCard', playerIndex: 1, cardId: 65, serial: 73, fromArea: CabtAreaType.HAND, toArea: CabtAreaType.BENCH },
        ],
        current: {
          turn: 1,
          yourIndex: 0,
          result: -1,
          players: [{
            active: [],
            bench: [],
            benchMax: 5,
            handCount: 0,
            deckCount: 53,
            prize: [],
          }, {
            active: [{ id: 304, serial: 79, hp: 180, maxHp: 180 }],
            bench: [
              { id: 65, serial: 75, hp: 60, maxHp: 60 },
              { id: 65, serial: 73, hp: 60, maxHp: 60 },
            ],
            benchMax: 5,
            hand: [],
            deckCount: 47,
            prize: [],
          }],
        },
      }],
    });

    const benchSteps = snapshot.steps.filter((step) => {
      const params = step.actionTimeline?.[0]?.params as Record<string, unknown> | undefined;
      return step.actionTimeline?.length === 1
        && Number(params?.fromArea) === CabtAreaType.HAND
        && Number(params?.toArea) === CabtAreaType.BENCH;
    });
    expect(benchSteps.map((step) => {
      const params = step.actionTimeline?.[0]?.params as Record<string, unknown>;
      return params.serial;
    })).toEqual([75, 73]);
    expect(benchSteps[0].displayView?.players[1].bench
      .filter((slot) => !slot.empty)
      .map((slot) => slot.pokemon?.serial)).toEqual([75]);
    expect(benchSteps[1].displayView?.players[1].bench
      .filter((slot) => !slot.empty)
      .map((slot) => slot.pokemon?.serial)).toEqual([75, 73]);
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
    expect(step.animationPhases?.map((phase) => phase.view.players[0].playZone.map((card) => card.serial))).toEqual([
      [83],
      [83],
      [83],
      [83],
    ]);
    expect(step.animationPhases?.every((phase) => !phase.view.players[0].discard.some((card) => card.serial === 83))).toBe(true);
    expect(snapshot.views[step.stateIndex].players[0].discard.map((card) => card.serial)).toContain(83);
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

  it('builds a deck-to-board placement phase for searched Pokemon put onto the bench', () => {
    const snapshot = cabtReplayToSnapshot({
      visualize: [{
        current: {
          turn: 2,
          yourIndex: 0,
          result: -1,
          players: [{
            active: [{ id: 721, serial: 4, hp: 150, maxHp: 150 }],
            bench: [],
            benchMax: 5,
            hand: [],
            deckCount: 50,
            prize: [],
          }, {
            active: [],
            bench: [],
            benchMax: 5,
            handCount: 0,
            deckCount: 50,
            prize: [],
          }],
        },
      }, {
        logs: [
          { type: 'MoveCard', playerIndex: 0, cardId: 722, serial: 6, fromArea: CabtAreaType.DECK, toArea: CabtAreaType.BENCH },
          { type: 'Shuffle', playerIndex: 0 },
        ],
        current: {
          turn: 2,
          yourIndex: 0,
          result: -1,
          players: [{
            active: [{ id: 721, serial: 4, hp: 150, maxHp: 150 }],
            bench: [{ id: 722, serial: 6, hp: 90, maxHp: 90 }],
            benchMax: 5,
            hand: [],
            deckCount: 49,
            prize: [],
          }, {
            active: [],
            bench: [],
            benchMax: 5,
            handCount: 0,
            deckCount: 50,
            prize: [],
          }],
        },
      }],
    });

    const step = snapshot.steps[1];
    expect(step.animationPhases?.map((phase) => phase.key.replace(/:\d+$/, ''))).toEqual([
      'DeckBoardPlace',
      'Shuffle',
    ]);
    expect(step.animationPhases?.[0].view.players[0].bench[0].pokemon?.serial).toBe(6);
    expect(step.animationPhases?.[0].view.players[0].deckCount).toBe(49);
    expect(step.animationPhases?.[1].view.players[0].bench[0].pokemon?.serial).toBe(6);
  });

  it('coalesces multiple deck-to-bench placements from one resolving card effect', () => {
    const snapshot = cabtReplayToSnapshot({
      visualize: [{
        current: {
          turn: 2,
          yourIndex: 0,
          result: -1,
          players: [{
            active: [{ id: 721, serial: 4, hp: 150, maxHp: 150 }],
            bench: [],
            benchMax: 5,
            hand: [{ id: 1086, serial: 39 }],
            deckCount: 50,
            discard: [],
            prize: [],
          }, {
            active: [],
            bench: [],
            benchMax: 5,
            handCount: 0,
            deckCount: 50,
            prize: [],
          }],
        },
      }, {
        logs: [
          { type: 'Play', playerIndex: 0, cardId: 1086, serial: 39 },
        ],
        current: {
          turn: 2,
          yourIndex: 0,
          result: -1,
          players: [{
            active: [{ id: 721, serial: 4, hp: 150, maxHp: 150 }],
            bench: [],
            benchMax: 5,
            hand: [],
            deckCount: 50,
            discard: [],
            prize: [],
          }, {
            active: [],
            bench: [],
            benchMax: 5,
            handCount: 0,
            deckCount: 50,
            prize: [],
          }],
        },
      }, {
        logs: [
          { type: 'MoveCard', playerIndex: 0, cardId: 722, serial: 6, fromArea: CabtAreaType.DECK, toArea: CabtAreaType.BENCH },
          { type: 'MoveCard', playerIndex: 0, cardId: 723, serial: 13, fromArea: CabtAreaType.DECK, toArea: CabtAreaType.BENCH },
          { type: 'Shuffle', playerIndex: 0 },
        ],
        current: {
          turn: 2,
          yourIndex: 0,
          result: -1,
          players: [{
            active: [{ id: 721, serial: 4, hp: 150, maxHp: 150 }],
            bench: [
              { id: 722, serial: 6, hp: 90, maxHp: 90 },
              { id: 723, serial: 13, hp: 90, maxHp: 90 },
            ],
            benchMax: 5,
            hand: [],
            deckCount: 48,
            discard: [{ id: 1086, serial: 39 }],
            prize: [],
          }, {
            active: [],
            bench: [],
            benchMax: 5,
            handCount: 0,
            deckCount: 50,
            prize: [],
          }],
        },
      }],
    });

    expect(snapshot.steps).toHaveLength(2);
    const step = snapshot.steps[1];
    expect(step.label).toBe('Player 1 played Buddy-Buddy Poffin, put 2 Pokemon from their deck onto the board, and shuffled their deck.');
    expect(step.actionTimeline?.map((event) => event.kind)).toEqual(['Play', 'MoveCard', 'MoveCard', 'Shuffle']);
    expect(step.animationPhases?.map((phase) => phase.key.replace(/:\d+$/, ''))).toEqual([
      'Play',
      'DeckBoardPlace',
      'Shuffle',
    ]);
    expect(step.animationPhases?.[1].view.players[0].bench
      .filter((slot) => !slot.empty)
      .map((slot) => slot.pokemon?.serial)).toEqual([6, 13]);
  });

  // Real shape from Kaggle episode 84924975 (Charlie's reported repro), frames
  // 3->4->5. Telepath Psychic Energy (card 19) attaches to a {P} Pokemon and its
  // effect searches the deck for up to 2 Basic {P} Pokemon and benches them. The
  // engine emits the Attach and the two DECK->BENCH placements in SEPARATE frames
  // (attach alone, then placements + shuffle); the step builder coalesces them
  // into one step whose Attach phase board-syncs the end-state bench. Without a
  // pre-state beat the two incoming Abra flash onto the bench during the attach
  // phase before the deck-placement phase animates them in.
  it('holds deck-benched Pokemon off the board until the placement phase (real card-19 Telepath Psychic Energy shape)', () => {
    const snapshot = cabtReplayToSnapshot({
      visualize: [{
        current: {
          turn: 1,
          yourIndex: 0,
          result: -1,
          players: [{
            active: [{ id: 741, serial: 20, hp: 50, maxHp: 50, energyCards: [] }],
            bench: [],
            benchMax: 5,
            hand: [{ id: 19, serial: 8 }, { id: 743, serial: 29 }],
            deckCount: 46,
            prize: [],
          }, {
            active: [{ id: 646, serial: 85, hp: 70, maxHp: 70 }],
            bench: [],
            benchMax: 5,
            handCount: 6,
            deckCount: 47,
            prize: [],
          }],
        },
      }, {
        logs: [
          { type: 'Attach', playerIndex: 0, cardId: 19, serial: 8, cardIdTarget: 741, serialTarget: 20 },
        ],
        current: {
          turn: 1,
          yourIndex: 0,
          result: -1,
          players: [{
            active: [{ id: 741, serial: 20, hp: 50, maxHp: 50, energyCards: [{ id: 19, serial: 8 }] }],
            bench: [],
            benchMax: 5,
            hand: [{ id: 743, serial: 29 }],
            deckCount: 46,
            prize: [],
          }, {
            active: [{ id: 646, serial: 85, hp: 70, maxHp: 70 }],
            bench: [],
            benchMax: 5,
            handCount: 6,
            deckCount: 47,
            prize: [],
          }],
        },
      }, {
        logs: [
          { type: 'MoveCard', playerIndex: 0, cardId: 741, serial: 21, fromArea: CabtAreaType.DECK, toArea: CabtAreaType.BENCH },
          { type: 'MoveCard', playerIndex: 0, cardId: 741, serial: 18, fromArea: CabtAreaType.DECK, toArea: CabtAreaType.BENCH },
          { type: 'Shuffle', playerIndex: 0 },
        ],
        current: {
          turn: 1,
          yourIndex: 0,
          result: -1,
          players: [{
            active: [{ id: 741, serial: 20, hp: 50, maxHp: 50, energyCards: [{ id: 19, serial: 8 }] }],
            bench: [
              { id: 741, serial: 21, hp: 50, maxHp: 50 },
              { id: 741, serial: 18, hp: 50, maxHp: 50 },
            ],
            benchMax: 5,
            hand: [{ id: 743, serial: 29 }],
            deckCount: 44,
            prize: [],
          }, {
            active: [{ id: 646, serial: 85, hp: 70, maxHp: 70 }],
            bench: [],
            benchMax: 5,
            handCount: 6,
            deckCount: 47,
            prize: [],
          }],
        },
      }],
    });

    const benchSerials = (view: { players: Array<{ bench: Array<{ empty: boolean; pokemon?: { serial?: number } }> }> } | undefined) =>
      (view?.players[0].bench ?? []).filter((slot) => !slot.empty).map((slot) => slot.pokemon?.serial);

    // The placement animates the two Abra in.
    const placementStepIndex = snapshot.steps.findIndex((candidate) =>
      candidate.animationPhases?.some((phase) => phase.key.startsWith('DeckBoardPlace:')));
    expect(placementStepIndex).toBeGreaterThanOrEqual(0);
    const placementStep = snapshot.steps[placementStepIndex];
    expect(benchSerials(placementStep.animationPhases?.find((phase) => phase.key.startsWith('DeckBoardPlace:'))?.view))
      .toEqual([21, 18]);

    // THE GUARD: no beat BEFORE the placement — the attach and its on-attach
    // announce — may show the two Abra on its settled board or in any of its
    // phase views. Otherwise they flash in early.
    for (let index = 0; index < placementStepIndex; index += 1) {
      const step = snapshot.steps[index];
      expect(benchSerials(step.displayView ?? step.view)).toEqual([]);
      for (const phase of step.animationPhases ?? []) {
        expect(benchSerials(phase.view)).toEqual([]);
      }
    }

    // Task 10: the on-attach effect announces "Telepath Psychic Energy" — an
    // Ability beat appears between the attach and the placement.
    const attachStepIndex = snapshot.steps.findIndex((candidate) =>
      candidate.actionTimeline?.some((event) => event.kind === 'Attach'));
    const abilityStepIndex = snapshot.steps.findIndex((candidate) =>
      candidate.actionTimeline?.some((event) => event.kind === 'Ability'));
    expect(attachStepIndex).toBeGreaterThanOrEqual(0);
    expect(abilityStepIndex).toBeGreaterThan(attachStepIndex);
    expect(abilityStepIndex).toBeLessThanOrEqual(placementStepIndex);
  });

  // Whiff variant (real frames 34/107): the search finds no eligible Basic {P}
  // Pokemon, so the Attach and Shuffle arrive together with ZERO placements. The
  // deferral must tolerate this — no placement phase, existing bench untouched.
  it('leaves the bench untouched when a Special Energy search whiffs (no deck placements)', () => {
    const snapshot = cabtReplayToSnapshot({
      visualize: [{
        current: {
          turn: 3,
          yourIndex: 0,
          result: -1,
          players: [{
            active: [{ id: 742, serial: 24, hp: 80, maxHp: 80, energyCards: [] }],
            bench: [{ id: 741, serial: 18, hp: 50, maxHp: 50 }],
            benchMax: 5,
            hand: [{ id: 19, serial: 9 }],
            deckCount: 40,
            prize: [],
          }, {
            active: [{ id: 646, serial: 85, hp: 70, maxHp: 70 }],
            bench: [],
            benchMax: 5,
            handCount: 6,
            deckCount: 47,
            prize: [],
          }],
        },
      }, {
        logs: [
          { type: 'Attach', playerIndex: 0, cardId: 19, serial: 9, cardIdTarget: 742, serialTarget: 24 },
          { type: 'Shuffle', playerIndex: 0 },
        ],
        current: {
          turn: 3,
          yourIndex: 0,
          result: -1,
          players: [{
            active: [{ id: 742, serial: 24, hp: 80, maxHp: 80, energyCards: [{ id: 19, serial: 9 }] }],
            bench: [{ id: 741, serial: 18, hp: 50, maxHp: 50 }],
            benchMax: 5,
            hand: [],
            deckCount: 40,
            prize: [],
          }, {
            active: [{ id: 646, serial: 85, hp: 70, maxHp: 70 }],
            bench: [],
            benchMax: 5,
            handCount: 6,
            deckCount: 47,
            prize: [],
          }],
        },
      }],
    });

    const step = snapshot.steps.find((candidate) =>
      candidate.actionTimeline?.some((event) => event.kind === 'Attach'));
    expect(step).toBeDefined();
    // No placement phase, and the pre-existing bench Pokemon stays put throughout.
    expect(step?.animationPhases?.some((phase) => phase.key.startsWith('DeckBoardPlace:'))).toBeFalsy();
    for (const phase of step?.animationPhases ?? []) {
      expect(phase.view.players[0].bench.filter((slot) => !slot.empty).map((slot) => slot.pokemon?.serial)).toEqual([18]);
    }
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

  it('coalesces reveal selection, return, take, and shuffle into one replay step', () => {
    const snapshot = cabtReplayToSnapshot({
      visualize: [{
        current: {
          turn: 2,
          yourIndex: 1,
          result: -1,
          players: [{
            active: [],
            bench: [],
            benchMax: 5,
            handCount: 0,
            deckCount: 46,
            prize: [],
          }, {
            active: [{ id: 304, serial: 79 }],
            bench: [],
            benchMax: 5,
            hand: [{ id: 1122, serial: 99 }],
            deckCount: 46,
            discard: [],
            prize: [],
          }],
        },
      }, {
        logs: [
          { type: 'Play', playerIndex: 1, cardId: 1122, serial: 99 },
          { type: 'MoveCard', playerIndex: 1, cardId: 19, serial: 71, fromArea: CabtAreaType.DECK, toArea: CabtAreaType.LOOKING },
          { type: 'MoveCard', playerIndex: 1, cardId: 1152, serial: 102, fromArea: CabtAreaType.DECK, toArea: CabtAreaType.LOOKING },
          { type: 'MoveCard', playerIndex: 1, cardId: 1086, serial: 90, fromArea: CabtAreaType.DECK, toArea: CabtAreaType.LOOKING },
          { type: 'MoveCard', playerIndex: 1, cardId: 66, serial: 76, fromArea: CabtAreaType.DECK, toArea: CabtAreaType.LOOKING },
          { type: 'MoveCard', playerIndex: 1, cardId: 1227, serial: 117, fromArea: CabtAreaType.DECK, toArea: CabtAreaType.LOOKING },
          { type: 'MoveCard', playerIndex: 1, cardId: 1255, serial: 121, fromArea: CabtAreaType.DECK, toArea: CabtAreaType.LOOKING },
          { type: 'MoveCard', playerIndex: 1, cardId: 878, serial: 82, fromArea: CabtAreaType.DECK, toArea: CabtAreaType.LOOKING },
        ],
        select: {
          type: 'Card',
          context: CabtAreaType.LOOKING,
        },
        current: {
          turn: 2,
          yourIndex: 1,
          result: -1,
          players: [{
            active: [],
            bench: [],
            benchMax: 5,
            handCount: 0,
            deckCount: 46,
            prize: [],
          }, {
            active: [{ id: 304, serial: 79 }],
            bench: [],
            benchMax: 5,
            hand: [],
            deckCount: 39,
            discard: [],
            prize: [],
          }],
        },
      }, {
        logs: [
          { type: 'MoveCard', playerIndex: 1, cardId: 1227, serial: 117, fromArea: CabtAreaType.LOOKING, toArea: CabtAreaType.HAND },
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
            deckCount: 46,
            prize: [],
          }, {
            active: [{ id: 304, serial: 79 }],
            bench: [],
            benchMax: 5,
            hand: [{ id: 1227, serial: 117 }],
            deckCount: 39,
            discard: [],
            prize: [],
          }],
        },
      }, {
        logs: [
          { type: 'MoveCard', playerIndex: 1, cardId: 19, serial: 71, fromArea: CabtAreaType.LOOKING, toArea: CabtAreaType.DECK },
          { type: 'MoveCard', playerIndex: 1, cardId: 1152, serial: 102, fromArea: CabtAreaType.LOOKING, toArea: CabtAreaType.DECK },
          { type: 'MoveCard', playerIndex: 1, cardId: 1086, serial: 90, fromArea: CabtAreaType.LOOKING, toArea: CabtAreaType.DECK },
          { type: 'MoveCard', playerIndex: 1, cardId: 66, serial: 76, fromArea: CabtAreaType.LOOKING, toArea: CabtAreaType.DECK },
          { type: 'MoveCard', playerIndex: 1, cardId: 1255, serial: 121, fromArea: CabtAreaType.LOOKING, toArea: CabtAreaType.DECK },
          { type: 'MoveCard', playerIndex: 1, cardId: 878, serial: 82, fromArea: CabtAreaType.LOOKING, toArea: CabtAreaType.DECK },
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
            deckCount: 46,
            prize: [],
          }, {
            active: [{ id: 304, serial: 79 }],
            bench: [],
            benchMax: 5,
            hand: [{ id: 1227, serial: 117 }],
            deckCount: 45,
            discard: [{ id: 1122, serial: 99 }],
            prize: [],
          }],
        },
      }],
    });

    expect(snapshot.steps).toHaveLength(2);
    const step = snapshot.steps[1];
    expect(step.stateIndex).toBe(3);
    expect(step.actionTimeline?.map((event) => event.kind)).toEqual([
      'Play',
      'MoveCard',
      'MoveCard',
      'MoveCard',
      'MoveCard',
      'MoveCard',
      'MoveCard',
      'MoveCard',
      'MoveCard',
      'MoveCard',
      'MoveCard',
      'MoveCard',
      'MoveCard',
      'MoveCard',
      'MoveCard',
      'Shuffle',
    ]);
    expect(step.actionTimeline?.slice(8, 15).map((event) => {
      const params = event.params as Record<string, unknown>;
      return [event.kind, params?.serial, params?.toArea];
    })).toEqual([
      ['MoveCard', 71, CabtAreaType.DECK],
      ['MoveCard', 102, CabtAreaType.DECK],
      ['MoveCard', 90, CabtAreaType.DECK],
      ['MoveCard', 76, CabtAreaType.DECK],
      ['MoveCard', 121, CabtAreaType.DECK],
      ['MoveCard', 82, CabtAreaType.DECK],
      ['MoveCard', 117, CabtAreaType.HAND],
    ]);
    expect(step.animationPhases?.map((phase) => phase.key.replace(/:\d+$/, ''))).toEqual([
      'Play',
      'DeckReveal',
      'DeckRevealReturn',
      'DeckRevealTake',
      'Shuffle',
    ]);
    expect(step.animationPhases?.[2].view.players[1].hand.map((card) => card.serial)).toEqual([]);
    expect(step.animationPhases?.[3].view.players[1].hand.map((card) => card.serial)).toEqual([117]);
    expect(step.animationPhases?.map((phase) => phase.view.players[1].playZone.map((card) => card.serial))).toEqual([
      [99],
      [99],
      [99],
      [99],
      [99],
    ]);
    expect(step.displayView?.players[1].discard.map((card) => card.serial)).toEqual([99]);
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

  it('merges a mulligan shuffle-back and redraw arriving in separate frames into one step', () => {
    const setupState = {
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
    };
    const snapshot = cabtReplayToSnapshot({
      visualize: [{
        logs: [
          ...Array.from({ length: 7 }, (_unused, index) => ({ type: 'Draw', playerIndex: 0, cardId: index + 21, serial: index + 21 })),
          { type: 'HasBasicPokemon', playerIndex: 0, hasBasicPokemon: true },
          ...Array.from({ length: 7 }, (_unused, index) => ({ type: 'Draw', playerIndex: 1, cardId: index + 1, serial: index + 1 })),
          { type: 'HasBasicPokemon', playerIndex: 1, hasBasicPokemon: false },
        ],
        current: setupState,
      }, {
        logs: [
          ...Array.from({ length: 7 }, (_unused, index) => ({
            type: 'MoveCard',
            playerIndex: 1,
            cardId: index + 1,
            serial: index + 1,
            fromArea: CabtAreaType.HAND,
            toArea: CabtAreaType.DECK,
          })),
          { type: 'Shuffle', playerIndex: 1 },
        ],
        current: setupState,
      }, {
        logs: [
          ...Array.from({ length: 7 }, (_unused, index) => ({ type: 'Draw', playerIndex: 1, cardId: index + 11, serial: index + 11 })),
          { type: 'HasBasicPokemon', playerIndex: 1, hasBasicPokemon: true },
        ],
        current: setupState,
      }],
    });

    expect(snapshot.steps.map((step) => step.label)).toEqual([
      'Players drew opening hands.',
      'Player 2 redrew their opening hand.',
    ]);
    expect(snapshot.steps[1].actionTimeline).toHaveLength(16);
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
    expect(snapshot.steps[0].actionTimeline?.map((event) => event.kind)).toEqual(['Attack', 'HPChange', 'MoveCard']);
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
      'HPChange',
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
    expect(snapshot.views[step.stateIndex].players[1].discard.map((card) => card.serial)).toEqual([64, 96]);
    expect(snapshot.views[step.stateIndex].players[1].discard.at(-1)?.serial).toBe(96);
  });

  it('keeps KO prize and promotion consequences sequential inside the attack step', () => {
    const attacker = { id: 723, serial: 13, hp: 350, maxHp: 350 };
    const knockedOut = { id: 721, serial: 64, hp: 150, maxHp: 150 };
    const promoted = { id: 722, serial: 67, hp: 90, maxHp: 90 };
    const prize = { id: 3, serial: 120 };
    const p1Base = {
      active: [attacker],
      bench: [],
      benchMax: 5,
      hand: [],
      deckCount: 45,
      discard: [],
      prize: [prize],
    };
    const snapshot = cabtReplayToSnapshot({
      visualize: [{
        select: { type: 'Main', option: [{ type: 'Attack', attackId: 1046 }, { type: 'End' }] },
        current: {
          turn: 3,
          yourIndex: 0,
          result: -1,
          players: [{
            active: [knockedOut],
            bench: [promoted],
            benchMax: 5,
            hand: [],
            deckCount: 46,
            discard: [],
            prize: [],
          }, p1Base],
        },
      }, {
        action: [[], [0]],
        logs: [
          { type: 'Attack', playerIndex: 1, cardId: 723, serial: 13, attackId: 1046 },
          { type: 'HpChange', playerIndex: 0, cardId: 721, serial: 64, value: -120, putDamageCounter: false },
        ],
        select: { type: 'Card', option: [{ type: 'Card', area: CabtAreaType.PRIZE, index: 0 }] },
        current: {
          turn: 3,
          yourIndex: 0,
          result: -1,
          players: [{
            active: [{ ...knockedOut, hp: 30 }],
            bench: [promoted],
            benchMax: 5,
            hand: [],
            deckCount: 46,
            discard: [],
            prize: [],
          }, p1Base],
        },
      }, {
        action: [[], [0]],
        logs: [
          { type: 'HpChange', playerIndex: 0, cardId: 721, serial: 64, value: -30, putDamageCounter: false },
          { type: 'MoveCard', playerIndex: 0, cardId: 721, serial: 64, fromArea: CabtAreaType.ACTIVE, toArea: CabtAreaType.DISCARD },
        ],
        select: { type: 'Card', option: Array.from({ length: 6 }, (_unused, index) => ({ type: 'Card', area: CabtAreaType.PRIZE, index })) },
        current: {
          turn: 3,
          yourIndex: 0,
          result: -1,
          players: [{
            active: [],
            bench: [promoted],
            benchMax: 5,
            hand: [],
            deckCount: 46,
            discard: [{ id: 721, serial: 64 }],
            prize: [],
          }, p1Base],
        },
      }, {
        action: [[], [0]],
        logs: [
          { type: 'MoveCard', playerIndex: 1, cardId: 3, serial: 120, fromArea: CabtAreaType.PRIZE, toArea: CabtAreaType.HAND },
        ],
        select: { type: 'Card', option: [{ type: 'Card', area: CabtAreaType.BENCH, index: 0 }, { type: 'Card', area: CabtAreaType.BENCH, index: 1 }] },
        current: {
          turn: 3,
          yourIndex: 0,
          result: -1,
          players: [{
            active: [],
            bench: [promoted],
            benchMax: 5,
            hand: [],
            deckCount: 46,
            discard: [{ id: 721, serial: 64 }],
            prize: [],
          }, {
            ...p1Base,
            hand: [prize],
            prize: [],
          }],
        },
      }, {
        action: [[0], []],
        logs: [
          { type: 'MoveCard', playerIndex: 0, cardId: 722, serial: 67, fromArea: CabtAreaType.BENCH, toArea: CabtAreaType.ACTIVE },
          { type: 'TurnEnd', playerIndex: 1 },
          { type: 'TurnStart', playerIndex: 0 },
          { type: 'Draw', playerIndex: 0, cardId: 4, serial: 121 },
        ],
        select: { type: 'Main', option: [{ type: 'End' }] },
        current: {
          turn: 4,
          yourIndex: 0,
          result: -1,
          players: [{
            active: [promoted],
            bench: [],
            benchMax: 5,
            hand: [{ id: 4, serial: 121 }],
            deckCount: 45,
            discard: [{ id: 721, serial: 64 }],
            prize: [],
          }, {
            ...p1Base,
            hand: [prize],
            prize: [],
          }],
        },
      }],
    });

    const attackStep = snapshot.steps.find((step) => step.type === 'Attack');
    expect(attackStep).toBeDefined();
    expect(attackStep?.actionTimeline?.map((event) => event.kind)).toEqual([
      'Attack',
      'HPChange',
      'HPChange',
      'MoveCard',
      'MoveCard',
      'MoveCard',
    ]);
    expect(attackStep?.displayView?.players[0].active.pokemon?.serial).toBe(67);
    expect(attackStep?.displayView?.players[0].hand).toHaveLength(0);
    expect(attackStep?.animationPhases?.map((phase) => phase.key)).toEqual([
      'Attack:1',
      'Damage:0',
      'KnockOut:0',
      'PrizeTake:1',
      'BoardMove:0',
    ]);
    expect(attackStep?.animationPhases?.[2].actionTimeline.map((event) => event.kind)).toEqual(['MoveCard']);
    expect(attackStep?.animationPhases?.[3].actionTimeline.map((event) => event.kind)).toEqual(['MoveCard']);
    expect(attackStep?.animationPhases?.[4].actionTimeline.map((event) => event.kind)).toEqual(['MoveCard']);
    expect(snapshot.views[attackStep!.stateIndex].players[0].active.empty).toBe(true);

    const turnSteps = snapshot.steps.filter((step) => step.type === 'TurnEnd' || step.type === 'TurnStart');
    expect(turnSteps.map((step) => step.actionTimeline?.map((event) => event.kind))).toEqual([
      ['TurnEnd'],
      ['TurnStart', 'Draw'],
    ]);
  });

  it('does not let knockout discard presentation rewrite later discard piles', () => {
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
            bench: [],
            benchMax: 5,
            hand: [{ id: 1210, serial: 113 }],
            deckCount: 46,
            discard: [],
            prize: [],
          }],
        },
      }, {
        // The attack fully resolved: the defender's next play answers the
        // main menu, so it is a new root decision rather than a consequence.
        select: { type: 'Main', option: [{ type: 'End' }] },
        logs: [
          { type: 'Attack', playerIndex: 0, cardId: 723, serial: 13, attackId: 1046 },
          { type: 'HpChange', playerIndex: 1, cardId: 721, serial: 64, value: -400, putDamageCounter: false },
          { type: 'MoveCard', playerIndex: 1, cardId: 721, serial: 64, fromArea: CabtAreaType.ACTIVE, toArea: CabtAreaType.DISCARD },
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
            deckCount: 45,
            discard: [],
            prize: [],
          }, {
            active: [],
            bench: [],
            benchMax: 5,
            hand: [{ id: 1210, serial: 113 }],
            deckCount: 46,
            discard: [{ id: 721, serial: 64 }],
            prize: [],
          }],
        },
      }, {
        logs: [
          { type: 'Play', playerIndex: 1, cardId: 1210, serial: 113 },
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
            deckCount: 45,
            discard: [],
            prize: [],
          }, {
            active: [],
            bench: [],
            benchMax: 5,
            hand: [],
            deckCount: 46,
            discard: [{ id: 721, serial: 64 }, { id: 1210, serial: 113 }],
            prize: [],
          }],
        },
      }],
    });

    const playStep = snapshot.steps.find((step) => step.label === 'Player 2 played Brock’s Scouting.');
    expect(playStep).toBeDefined();
    expect(snapshot.views[playStep!.stateIndex].players[1].discard.map((card) => card.serial)).toEqual([64, 113]);
    expect(snapshot.views[playStep!.stateIndex].players[1].discard.at(-1)?.serial).toBe(113);
  });

  it('holds attached energy in the source view while it moves to discard', () => {
    const snapshot = cabtReplayToSnapshot({
      visualize: [{
        current: {
          turn: 4,
          yourIndex: 0,
          result: -1,
          players: [{
            active: [{
              id: 721,
              serial: 64,
              hp: 150,
              maxHp: 150,
              energyCards: [{ id: 3, serial: 91 }],
            }],
            bench: [],
            benchMax: 5,
            handCount: 0,
            deckCount: 45,
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
          { type: 'MoveCard', playerIndex: 0, cardId: 3, serial: 91, fromArea: CabtAreaType.ENERGY, toArea: CabtAreaType.DISCARD },
        ],
        current: {
          turn: 4,
          yourIndex: 0,
          result: -1,
          players: [{
            active: [{
              id: 721,
              serial: 64,
              hp: 150,
              maxHp: 150,
              energyCards: [],
            }],
            bench: [],
            benchMax: 5,
            handCount: 0,
            deckCount: 45,
            discard: [{ id: 3, serial: 91 }],
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
    expect(step.animationPhases?.map((phase) => phase.key.replace(/:\d+:.+$/, ''))).toEqual(['AttachedMove']);
    expect(step.animationPhases?.[0].view.players[0].active.energy.map((card) => card.serial)).toEqual([91]);
    expect(snapshot.views[step.stateIndex].players[0].active.energy).toHaveLength(0);
    expect(snapshot.views[step.stateIndex].players[0].discard.map((card) => card.serial)).toEqual([91]);
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

  it('holds the source board while a Switch log swaps active and benched Pokemon', () => {
    const snapshot = cabtReplayToSnapshot({
      visualize: [{
        current: {
          turn: 4,
          yourIndex: 0,
          result: -1,
          players: [{
            active: [{ id: 304, serial: 79, hp: 150, maxHp: 150 }],
            bench: [{ id: 878, serial: 81, hp: 90, maxHp: 90 }],
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
          {
            type: 'Switch',
            playerIndex: 0,
            cardIdActive: 304,
            serialActive: 79,
            cardIdBench: 878,
            serialBench: 81,
          },
        ],
        current: {
          turn: 4,
          yourIndex: 0,
          result: -1,
          players: [{
            active: [{ id: 878, serial: 81, hp: 90, maxHp: 90 }],
            bench: [{ id: 304, serial: 79, hp: 150, maxHp: 150 }],
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
    expect(step.animationPhases?.[0].actionTimeline).toHaveLength(1);
    expect(step.animationPhases?.[0].view.players[0].active.pokemon?.serial).toBe(79);
    expect(step.animationPhases?.[0].view.players[0].bench[0].pokemon?.serial).toBe(81);
    expect(snapshot.views[step.stateIndex].players[0].active.pokemon?.serial).toBe(81);
    expect(snapshot.views[step.stateIndex].players[0].bench[0].pokemon?.serial).toBe(79);
  });

  // Real retreat shape from Kaggle episode 84924975 (frames 22->23->24): a
  // retreat discards the active's energy (ENERGY->DISCARD), THEN swaps the
  // active with a bench Pokemon (Switch), coalesced into one step. The energy
  // discard must not import the post-swap board positions, or the swap phase
  // animates the crossing backwards (the incoming Pokemon appears to leave
  // active). Regression for the retreat-specific reversal — Boss's Orders (no
  // preceding energy discard) never hit it. Asserts the swap phase view is
  // PRE-swap for the retreat event shape specifically.
  it('holds the pre-swap board for a retreat swap that follows an energy discard', () => {
    const snapshot = cabtReplayToSnapshot({
      visualize: [{
        current: {
          turn: 4,
          yourIndex: 0,
          result: -1,
          players: [{
            active: [{ id: 646, serial: 85, hp: 70, maxHp: 70, energyCards: [{ id: 7, serial: 68 }] }],
            bench: [{ id: 235, serial: 80, hp: 60, maxHp: 60 }],
            benchMax: 5,
            handCount: 0,
            deckCount: 40,
            discard: [],
            prize: [],
          }, {
            active: [{ id: 304, serial: 79, hp: 150, maxHp: 150 }],
            bench: [],
            benchMax: 5,
            handCount: 0,
            deckCount: 45,
            prize: [],
          }],
        },
      }, {
        logs: [
          { type: 'MoveCard', playerIndex: 0, cardId: 7, serial: 68, fromArea: CabtAreaType.ENERGY, toArea: CabtAreaType.DISCARD },
          { type: 'Switch', playerIndex: 0, cardIdActive: 646, serialActive: 85, cardIdBench: 235, serialBench: 80 },
        ],
        current: {
          turn: 4,
          yourIndex: 0,
          result: -1,
          players: [{
            active: [{ id: 235, serial: 80, hp: 60, maxHp: 60 }],
            bench: [{ id: 646, serial: 85, hp: 70, maxHp: 70, energyCards: [] }],
            benchMax: 5,
            handCount: 0,
            deckCount: 40,
            discard: [{ id: 7, serial: 68 }],
            prize: [],
          }, {
            active: [{ id: 304, serial: 79, hp: 150, maxHp: 150 }],
            bench: [],
            benchMax: 5,
            handCount: 0,
            deckCount: 45,
            prize: [],
          }],
        },
      }],
    });

    const step = snapshot.steps[1];
    const phaseKeys = step.animationPhases?.map((phase) => phase.key.replace(/:.*$/, ''));
    // The energy discard animates in its own beat before the swap.
    expect(phaseKeys).toContain('AttachedMove');
    expect(phaseKeys).toContain('BoardMove');
    const boardMove = step.animationPhases?.find((phase) => phase.key.startsWith('BoardMove:'));
    // THE GUARD: the swap phase renders the PRE-swap board — outgoing active 85
    // still active, incoming 80 still benched — so the crossing reads forward.
    expect(boardMove?.view.players[0].active.pokemon?.serial).toBe(85);
    expect(boardMove?.view.players[0].bench[0].pokemon?.serial).toBe(80);
    // The settled board is the post-swap state.
    expect(snapshot.views[step.stateIndex].players[0].active.pokemon?.serial).toBe(80);
  });
});
