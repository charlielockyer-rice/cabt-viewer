import { describe, expect, it } from 'vitest';
import { actionAnimationPhaseKind } from './actionAnimationPhases';
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
    expect(step.animationPhases?.every((phase) => phase.kind === actionAnimationPhaseKind(phase.key))).toBe(true);
    expect(step.animationPhases?.[0].view.players[0].active.pokemon?.serial).toBe(14);
    expect(step.animationPhases?.[0].animationPlan?.motions).toMatchObject([
      {
        kind: 'pulse',
        coordinateSpace: 'board',
        anchor: { kind: 'board-slot', playerIndex: 0, slot: 'active', slotIndex: 0 },
        spriteVisual: { kind: 'pulse', tone: 'ability' },
        label: 'Run Away Draw',
        durationMs: 560,
      },
    ]);
    expect(step.animationPhases?.[1].animationPlan?.motions).toMatchObject([
      {
        kind: 'card-move',
        coordinateSpace: 'viewport',
        sourceAnchor: { kind: 'deck-top', playerIndex: 0 },
        targetAnchor: { kind: 'hand-card', playerIndex: 0, handIndex: 0, serial: 101 },
        identity: { kind: 'card', serial: 101, cardId: 3 },
        durationMs: 320,
        handoffPolicy: {
          hideDestinationUntil: 'prepaint',
          removeSprite: 'prepaint',
        },
      },
      {
        kind: 'card-move',
        coordinateSpace: 'viewport',
        sourceAnchor: { kind: 'deck-top', playerIndex: 0 },
        targetAnchor: { kind: 'hand-card', playerIndex: 0, handIndex: 1, serial: 102 },
        identity: { kind: 'card', serial: 102, cardId: 4 },
        startMs: 35,
      },
    ]);
    expect(step.animationPhases?.[1].animationPlan?.visibilityClaims).toMatchObject([
      {
        anchor: { kind: 'hand-card', playerIndex: 0, handIndex: 0, serial: 101 },
        identity: { kind: 'card', serial: 101, cardId: 3 },
        role: 'destination',
      },
      {
        anchor: { kind: 'hand-card', playerIndex: 0, handIndex: 1, serial: 102 },
        identity: { kind: 'card', serial: 102, cardId: 4 },
        role: 'destination',
      },
    ]);
    expect(step.animationPhases?.[2].view.players[0].active.pokemon?.serial).toBe(14);
    expect(step.animationPhases?.[2].view.players[0].deckCount).toBe(38);
    expect(step.animationPhases?.[3].animationPlan?.motions).toMatchObject([
      {
        kind: 'shuffle',
        coordinateSpace: 'board',
        anchor: { kind: 'deck-top', playerIndex: 0 },
        durationMs: 980,
      },
    ]);
    expect(snapshot.views[step.stateIndex].players[0].active.empty).toBe(true);
    expect(snapshot.views[step.stateIndex].players[0].deckCount).toBe(39);
  });

  it('uses explicit ability area and index when duplicate Pokemon share a card id', () => {
    const snapshot = cabtReplayToSnapshot({
      visualize: [{
        select: {
          type: 'Main',
          option: [
            { type: 'Ability', area: CabtAreaType.BENCH, index: 1 },
            { type: 'End' },
          ],
        },
        current: {
          turn: 1,
          yourIndex: 0,
          result: -1,
          players: [{
            active: [],
            bench: [
              { id: 66, serial: 14, hp: 140, maxHp: 140 },
              { id: 66, serial: 15, hp: 140, maxHp: 140 },
            ],
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
        ],
        current: {
          turn: 1,
          yourIndex: 0,
          result: -1,
          players: [{
            active: [],
            bench: [
              { id: 66, serial: 14, hp: 140, maxHp: 140 },
              { id: 66, serial: 15, hp: 140, maxHp: 140 },
            ],
            benchMax: 5,
            hand: [
              { id: 3, serial: 101 },
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

    const abilityPhase = snapshot.steps[1].animationPhases?.find((phase) => phase.key === 'Ability:0');
    expect(abilityPhase?.animationPlan?.motions).toMatchObject([
      {
        kind: 'pulse',
        coordinateSpace: 'board',
        anchor: { kind: 'board-slot', playerIndex: 0, slot: 'bench', slotIndex: 1 },
        spriteVisual: { kind: 'pulse', tone: 'ability' },
        label: 'Run Away Draw',
      },
    ]);
  });

  it('plans coin flips as neutral deck-anchored pulses', () => {
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
        logs: [
          { type: 'Coin', playerIndex: 0, head: true },
          { type: 'Draw', playerIndex: 0, cardId: 3, serial: 101 },
        ],
        current: {
          turn: 1,
          yourIndex: 0,
          result: -1,
          players: [{
            active: [],
            bench: [],
            benchMax: 5,
            hand: [{ id: 3, serial: 101 }],
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
    expect(step.animationPhases?.map((phase) => phase.key)).toEqual(['Coin:0']);
    expect(step.animationPhases?.[0].animationPlan?.motions).toMatchObject([
      {
        kind: 'pulse',
        coordinateSpace: 'board',
        anchor: { kind: 'deck-top', playerIndex: 0 },
        spriteVisual: { kind: 'pulse', tone: 'neutral' },
        label: 'Heads',
      },
    ]);
  });

  it('plans board Pokemon changes as neutral source-slot pulses', () => {
    const snapshot = cabtReplayToSnapshot({
      visualize: [{
        current: {
          turn: 1,
          yourIndex: 0,
          result: -1,
          players: [{
            active: [{ id: 721, serial: 14, hp: 140, maxHp: 140 }],
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
        logs: [
          { type: 'Change', playerIndex: 0, cardIdBefore: 721, cardIdAfter: 722, serial: 14 },
        ],
        current: {
          turn: 1,
          yourIndex: 0,
          result: -1,
          players: [{
            active: [{ id: 722, serial: 14, hp: 120, maxHp: 120 }],
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
      }],
    });

    const step = snapshot.steps[1];
    expect(step.animationPhases?.map((phase) => phase.key)).toEqual(['Change:0']);
    expect(step.animationPhases?.[0].view.players[0].active.pokemon?.id).toBe(721);
    expect(snapshot.views[step.stateIndex].players[0].active.pokemon?.id).toBe(722);
    expect(step.animationPhases?.[0].animationPlan?.motions).toMatchObject([
      {
        kind: 'pulse',
        coordinateSpace: 'board',
        anchor: { kind: 'board-slot', playerIndex: 0, slot: 'active', slotIndex: 0 },
        spriteVisual: { kind: 'pulse', tone: 'neutral' },
        label: 'Changed to Snover',
      },
    ]);
  });

  it('plans devolutions as neutral source-slot pulses', () => {
    const snapshot = cabtReplayToSnapshot({
      visualize: [{
        current: {
          turn: 1,
          yourIndex: 0,
          result: -1,
          players: [{
            active: [{ id: 723, serial: 14, hp: 130, maxHp: 130 }],
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
        logs: [
          { type: 'Devolve', playerIndex: 0, cardId: 723, serial: 14 },
        ],
        current: {
          turn: 1,
          yourIndex: 0,
          result: -1,
          players: [{
            active: [{ id: 722, serial: 14, hp: 120, maxHp: 120 }],
            bench: [],
            benchMax: 5,
            hand: [],
            deckCount: 40,
            discard: [{ id: 723, serial: 44 }],
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
    expect(step.animationPhases?.map((phase) => phase.key)).toEqual(['Devolve:0']);
    expect(step.animationPhases?.[0].view.players[0].active.pokemon?.id).toBe(723);
    expect(snapshot.views[step.stateIndex].players[0].active.pokemon?.id).toBe(722);
    expect(step.animationPhases?.[0].animationPlan?.motions).toMatchObject([
      {
        kind: 'pulse',
        coordinateSpace: 'board',
        anchor: { kind: 'board-slot', playerIndex: 0, slot: 'active', slotIndex: 0 },
        spriteVisual: { kind: 'pulse', tone: 'neutral' },
        label: 'Devolved',
      },
    ]);
  });

  it('plans attached-card board mutations as neutral pulses on the affected Pokemon', () => {
    const snapshot = cabtReplayToSnapshot({
      visualize: [{
        current: {
          turn: 1,
          yourIndex: 0,
          result: -1,
          players: [{
            active: [{ id: 721, serial: 14, hp: 140, maxHp: 140 }],
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
        logs: [
          { type: 'MoveAttached', playerIndex: 0, cardIdTarget: 721, serialTarget: 14, cardId: 88, serial: 50 },
        ],
        current: {
          turn: 1,
          yourIndex: 0,
          result: -1,
          players: [{
            active: [{ id: 721, serial: 14, hp: 140, maxHp: 140, energy: [{ id: 88, serial: 50 }] }],
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
      }],
    });

    const step = snapshot.steps[1];
    expect(step.animationPhases?.map((phase) => phase.key)).toEqual(['MoveAttached:0']);
    expect(step.animationPhases?.[0].animationPlan?.motions).toMatchObject([
      {
        kind: 'pulse',
        coordinateSpace: 'board',
        anchor: { kind: 'board-slot', playerIndex: 0, slot: 'active', slotIndex: 0 },
        spriteVisual: { kind: 'pulse', tone: 'neutral' },
        label: 'Moved attached card',
      },
    ]);
  });

  it('plans special-condition changes as neutral active-slot pulses using the source board state', () => {
    const snapshot = cabtReplayToSnapshot({
      visualize: [{
        current: {
          turn: 1,
          yourIndex: 0,
          result: -1,
          players: [{
            active: [{ id: 721, serial: 14, hp: 140, maxHp: 140 }],
            bench: [{ id: 66, serial: 15, hp: 140, maxHp: 140 }],
            benchMax: 5,
            hand: [],
            deckCount: 40,
            discard: [],
            prize: [],
            poisoned: false,
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
          { type: 'Poisoned', playerIndex: 0, cardId: 721, serial: 14, isRecover: false },
        ],
        current: {
          turn: 1,
          yourIndex: 0,
          result: -1,
          players: [{
            active: [{ id: 721, serial: 14, hp: 140, maxHp: 140 }],
            bench: [{ id: 66, serial: 15, hp: 140, maxHp: 140 }],
            benchMax: 5,
            hand: [],
            deckCount: 40,
            discard: [],
            prize: [],
            poisoned: true,
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
    expect(step.animationPhases?.map((phase) => phase.key)).toEqual(['Condition:0']);
    expect(step.animationPhases?.[0].view.players[0].active.specialConditions).toEqual([]);
    expect(snapshot.views[step.stateIndex].players[0].active.specialConditions).toEqual(['Poisoned']);
    expect(snapshot.views[step.stateIndex].players[0].bench[0]?.specialConditions).toEqual([]);
    expect(step.animationPhases?.[0].animationPlan?.motions).toMatchObject([
      {
        kind: 'pulse',
        coordinateSpace: 'board',
        anchor: { kind: 'board-slot', playerIndex: 0, slot: 'active', slotIndex: 0 },
        spriteVisual: { kind: 'pulse', tone: 'neutral' },
        label: 'Poisoned',
      },
    ]);
  });

  it('does not leak final special-condition badges into earlier attack phases', () => {
    const snapshot = cabtReplayToSnapshot({
      visualize: [{
        current: {
          turn: 1,
          yourIndex: 0,
          result: -1,
          players: [{
            active: [{ id: 721, serial: 14, hp: 140, maxHp: 140 }],
            bench: [],
            benchMax: 5,
            hand: [],
            deckCount: 40,
            discard: [],
            prize: [],
            poisoned: false,
          }, {
            active: [{ id: 722, serial: 21, hp: 120, maxHp: 120 }],
            bench: [],
            benchMax: 5,
            handCount: 0,
            deckCount: 60,
            prize: [],
            poisoned: false,
          }],
        },
      }, {
        logs: [
          { type: 'Attack', playerIndex: 0, cardId: 721, serial: 14, attackId: 1408 },
          { type: 'Poisoned', playerIndex: 1, cardId: 722, serial: 21, isRecover: false },
        ],
        current: {
          turn: 1,
          yourIndex: 0,
          result: -1,
          players: [{
            active: [{ id: 721, serial: 14, hp: 140, maxHp: 140 }],
            bench: [],
            benchMax: 5,
            hand: [],
            deckCount: 40,
            discard: [],
            prize: [],
            poisoned: false,
          }, {
            active: [{ id: 722, serial: 21, hp: 120, maxHp: 120 }],
            bench: [],
            benchMax: 5,
            handCount: 0,
            deckCount: 60,
            prize: [],
            poisoned: true,
          }],
        },
      }],
    });

    const step = snapshot.steps[1];
    expect(step.animationPhases?.map((phase) => phase.key)).toEqual(['Attack:0', 'Condition:1']);
    expect(step.animationPhases?.[0].view.players[1].active.specialConditions).toEqual([]);
    expect(step.animationPhases?.[1].view.players[1].active.specialConditions).toEqual([]);
    expect(snapshot.views[step.stateIndex].players[1].active.specialConditions).toEqual(['Poisoned']);
  });

  it('keeps recovered special conditions visible until the recovery pulse resolves', () => {
    const snapshot = cabtReplayToSnapshot({
      visualize: [{
        current: {
          turn: 1,
          yourIndex: 0,
          result: -1,
          players: [{
            active: [{ id: 721, serial: 14, hp: 140, maxHp: 140 }],
            bench: [],
            benchMax: 5,
            hand: [],
            deckCount: 40,
            discard: [],
            prize: [],
            poisoned: true,
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
          { type: 'Poisoned', playerIndex: 0, cardId: 721, serial: 14, isRecover: true },
        ],
        current: {
          turn: 1,
          yourIndex: 0,
          result: -1,
          players: [{
            active: [{ id: 721, serial: 14, hp: 140, maxHp: 140 }],
            bench: [],
            benchMax: 5,
            hand: [],
            deckCount: 40,
            discard: [],
            prize: [],
            poisoned: false,
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
    expect(step.animationPhases?.[0].view.players[0].active.specialConditions).toEqual(['Poisoned']);
    expect(snapshot.views[step.stateIndex].players[0].active.specialConditions).toEqual([]);
    expect(step.animationPhases?.[0].animationPlan?.motions).toMatchObject([
      {
        label: 'Recovered',
      },
    ]);
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
    expect(step.animationPhases?.map((phase) => phase.key)).toEqual(['Play:0']);
    expect(step.animationPhases?.[0].view.players[0].hand.map((card) => card.serial)).toEqual([62]);
    expect(step.animationPhases?.[0].view.players[0].stadium.map((card) => card.serial)).toEqual([62]);
    expect(step.animationPhases?.[0].animationPlan?.motions).toMatchObject([
      {
        kind: 'card-move',
        coordinateSpace: 'viewport',
        sourceAnchor: { kind: 'hand-card', playerIndex: 0, handIndex: 0, serial: 62 },
        targetAnchor: { kind: 'stadium-card', playerIndex: 0, serial: 62 },
        identity: { kind: 'stadium', serial: 62, cardId: 1264 },
        handoffPolicy: {
          hideSourceUntil: 'scope-exit',
          hideDestinationUntil: 'arrival',
          removeSprite: 'arrival',
        },
      },
    ]);
    expect(step.animationPhases?.[0].animationPlan?.visibilityClaims).toMatchObject([
      {
        anchor: { kind: 'hand-card', playerIndex: 0, handIndex: 0, serial: 62 },
        identity: { kind: 'stadium', serial: 62, cardId: 1264 },
        role: 'source',
      },
      {
        anchor: { kind: 'stadium-card', playerIndex: 0, serial: 62 },
        identity: { kind: 'stadium', serial: 62, cardId: 1264 },
        role: 'destination',
      },
    ]);
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

  it('plans replay Prize-take card moves from prize anchors to final hand anchors', () => {
    const snapshot = cabtReplayToSnapshot({
      visualize: [{
        current: {
          turn: 8,
          yourIndex: 0,
          result: -1,
          players: [{
            active: [],
            bench: [],
            benchMax: 5,
            hand: [],
            deckCount: 0,
            prize: Array.from({ length: 6 }, () => null),
          }, {
            active: [],
            bench: [],
            benchMax: 5,
            handCount: 0,
            deckCount: 0,
            prize: [],
          }],
        },
      }, {
        logs: [
          { type: 'MoveCard', playerIndex: 0, cardId: 96, serial: 120, fromArea: CabtAreaType.PRIZE, toArea: CabtAreaType.HAND },
          { type: 'MoveCard', playerIndex: 0, cardId: 1261, serial: 121, fromArea: CabtAreaType.PRIZE, toArea: CabtAreaType.HAND },
        ],
        current: {
          turn: 8,
          yourIndex: 0,
          result: -1,
          players: [{
            active: [],
            bench: [],
            benchMax: 5,
            hand: [
              { id: 96, serial: 120 },
              { id: 1261, serial: 121 },
            ],
            deckCount: 0,
            prize: Array.from({ length: 4 }, () => null),
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

    const step = snapshot.steps[1];
    expect(step.animationPhases?.map((phase) => phase.key)).toEqual(['PrizeTake:0']);
    expect(step.animationPhases?.[0].view.players[0].prizesLeft).toBe(6);
    expect(step.animationPhases?.[0].view.players[0].hand.map((card) => card.serial)).toEqual([120, 121]);
    expect(step.animationPhases?.[0].animationPlan?.motions).toMatchObject([
      {
        kind: 'card-move',
        coordinateSpace: 'viewport',
        sourceAnchor: { kind: 'prize-card', playerIndex: 0, prizeIndex: 4 },
        targetAnchor: { kind: 'hand-card', playerIndex: 0, handIndex: 0, serial: 120 },
        identity: { kind: 'card', serial: 120, cardId: 96 },
        startMs: 0,
        durationMs: 1180,
        handoffPolicy: {
          hideDestinationUntil: 'arrival',
          removeSprite: 'arrival',
        },
      },
      {
        kind: 'card-move',
        coordinateSpace: 'viewport',
        sourceAnchor: { kind: 'prize-card', playerIndex: 0, prizeIndex: 5 },
        targetAnchor: { kind: 'hand-card', playerIndex: 0, handIndex: 1, serial: 121 },
        identity: { kind: 'card', serial: 121, cardId: 1261 },
        startMs: 45,
      },
    ]);
    expect(step.animationPhases?.[0].animationPlan?.visibilityClaims).toMatchObject([
      {
        anchor: { kind: 'hand-card', playerIndex: 0, handIndex: 0, serial: 120 },
        identity: { kind: 'card', serial: 120, cardId: 96 },
        role: 'destination',
      },
      {
        anchor: { kind: 'hand-card', playerIndex: 0, handIndex: 1, serial: 121 },
        identity: { kind: 'card', serial: 121, cardId: 1261 },
        role: 'destination',
      },
    ]);
  });

  it('keeps valid planned motions when one event in the phase cannot resolve', () => {
    const snapshot = cabtReplayToSnapshot({
      visualize: [{
        current: {
          turn: 8,
          yourIndex: 0,
          result: -1,
          players: [{
            active: [],
            bench: [],
            benchMax: 5,
            hand: [],
            deckCount: 0,
            prize: Array.from({ length: 6 }, () => null),
          }, {
            active: [],
            bench: [],
            benchMax: 5,
            handCount: 0,
            deckCount: 0,
            prize: [],
          }],
        },
      }, {
        logs: [
          { type: 'MoveCard', playerIndex: 0, cardId: 96, serial: 120, fromArea: CabtAreaType.PRIZE, toArea: CabtAreaType.HAND },
          { type: 'MoveCard', playerIndex: 0, cardId: 1261, serial: 121, fromArea: CabtAreaType.PRIZE, toArea: CabtAreaType.HAND },
        ],
        current: {
          turn: 8,
          yourIndex: 0,
          result: -1,
          players: [{
            active: [],
            bench: [],
            benchMax: 5,
            hand: [
              { id: 1261, serial: 121 },
            ],
            deckCount: 0,
            prize: Array.from({ length: 5 }, () => null),
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

    const motions = snapshot.steps[1].animationPhases?.[0].animationPlan?.motions ?? [];

    expect(motions).toHaveLength(1);
    expect(motions[0]).toMatchObject({
      kind: 'card-move',
      targetAnchor: { kind: 'hand-card', playerIndex: 0, handIndex: 0, serial: 121 },
      identity: { kind: 'card', serial: 121, cardId: 1261 },
    });
  });

  it('plans MoveCardReverse Prize-take motions as face-down sprites', () => {
    const snapshot = cabtReplayToSnapshot({
      visualize: [{
        current: {
          turn: 8,
          yourIndex: 1,
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
            hand: [],
            deckCount: 0,
            prize: Array.from({ length: 1 }, () => null),
          }],
        },
      }, {
        logs: [
          { type: 'MoveCardReverse', playerIndex: 1, cardId: 96, serial: 220, fromArea: CabtAreaType.PRIZE, toArea: CabtAreaType.HAND },
        ],
        current: {
          turn: 8,
          yourIndex: 1,
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
            hand: [{ id: 96, serial: 220 }],
            deckCount: 0,
            prize: [],
          }],
        },
      }],
    });

    const step = snapshot.steps[1];
    expect(step.animationPhases?.map((phase) => phase.key)).toEqual(['PrizeTake:1']);
    expect(step.animationPhases?.[0].animationPlan?.motions).toMatchObject([
      {
        kind: 'card-move',
        coordinateSpace: 'viewport',
        sourceAnchor: { kind: 'prize-card', playerIndex: 1, prizeIndex: 0 },
        targetAnchor: { kind: 'hand-card', playerIndex: 1, handIndex: 0, serial: 220 },
        identity: { kind: 'card', serial: 220, cardId: 96 },
        spriteVisual: {
          kind: 'card',
          faceDown: true,
        },
        handoffPolicy: {
          hideDestinationUntil: 'arrival',
          removeSprite: 'arrival',
        },
      },
    ]);
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
    expect(snapshot.steps[2].animationPhases?.map((phase) => phase.key)).toEqual(['DeckPrizePlace:0']);
    const setupPrizePlan = snapshot.steps[2].animationPhases?.[0].animationPlan;
    expect(setupPrizePlan?.motions).toHaveLength(6);
    expect(setupPrizePlan?.motions[0]).toMatchObject({
      kind: 'card-move',
      coordinateSpace: 'board',
      sourceAnchor: { kind: 'deck-top', playerIndex: 0 },
      targetAnchor: { kind: 'prize-card', playerIndex: 0, prizeIndex: 0 },
      spriteVisual: { kind: 'card', faceDown: true },
      handoffPolicy: {
        hideSourceUntil: 'snapshot',
        hideDestinationUntil: 'prepaint',
        removeSprite: 'prepaint',
      },
    });
    expect(setupPrizePlan?.motions[5]).toMatchObject({
      kind: 'card-move',
      sourceAnchor: { kind: 'deck-top', playerIndex: 0 },
      targetAnchor: { kind: 'prize-card', playerIndex: 0, prizeIndex: 5 },
      startMs: 300,
    });
    expect(setupPrizePlan?.visibilityClaims).toEqual(
      Array.from({ length: 6 }, (_item, index) => ({
        scopeKey: 'DeckPrizePlace:0',
        motionId: setupPrizePlan?.motions[index]?.id,
        anchor: { kind: 'prize-card', playerIndex: 0, prizeIndex: index },
        identity: { kind: 'card', serial: undefined, cardId: undefined, name: undefined },
        role: 'destination',
      })),
    );
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
    expect(step.animationPhases?.[0].view.players[0].hand.map((card) => card.serial)).toEqual([46, 14]);
    expect(step.animationPhases?.[0].view.players[0].playZone.map((card) => card.serial)).toEqual([14]);
    expect(step.animationPhases?.[0].view.players[0].discard).toHaveLength(0);
    expect(step.animationPhases?.[1].view.players[0].hand.map((card) => card.serial)).toEqual([46, 13]);
    expect(step.animationPhases?.[1].view.players[0].playZone.map((card) => card.serial)).toEqual([14]);
    expect(step.animationPhases?.[1].view.players[0].discard.map((card) => card.serial)).toEqual([14]);
    expect(step.animationPhases?.[1].animationPlan?.motions).toEqual([
      expect.objectContaining({
        kind: 'reveal-session',
        playerIndex: 0,
        coordinateSpace: 'viewport',
        revealCount: 1,
        steps: [
          expect.objectContaining({
            kind: 'take',
            sourceAnchor: { kind: 'deck-top', playerIndex: 0 },
            targetAnchor: { kind: 'hand-card', playerIndex: 0, handIndex: 1, serial: 13 },
            identity: expect.objectContaining({ kind: 'card', serial: 13, cardId: 723 }),
            handoffPolicy: expect.objectContaining({
              hideDestinationUntil: 'arrival',
              removeSprite: 'arrival',
            }),
          }),
        ],
      }),
      expect.objectContaining({
        kind: 'card-move',
        coordinateSpace: 'board',
        sourceAnchor: { kind: 'play-zone-card', playerIndex: 0, serial: 14 },
        targetAnchor: { kind: 'discard-card', playerIndex: 0, serial: 14 },
        identity: expect.objectContaining({ kind: 'card', serial: 14, cardId: 1145 }),
        handoffPolicy: expect.objectContaining({
          hideSourceUntil: 'scope-exit',
          hideDestinationUntil: 'prepaint',
          removeSprite: 'prepaint',
        }),
      }),
    ]);
    expect(step.animationPhases?.[1].animationPlan?.visibilityClaims).toEqual([
      expect.objectContaining({
        scopeKey: 'DeckSearchReveal:0',
        role: 'destination',
        anchor: { kind: 'hand-card', playerIndex: 0, handIndex: 1, serial: 13 },
        identity: expect.objectContaining({ kind: 'card', serial: 13, cardId: 723 }),
      }),
      expect.objectContaining({
        scopeKey: 'DeckSearchReveal:0',
        role: 'source',
        anchor: { kind: 'play-zone-card', playerIndex: 0, serial: 14 },
        identity: expect.objectContaining({ kind: 'card', serial: 14, cardId: 1145 }),
      }),
      expect.objectContaining({
        scopeKey: 'DeckSearchReveal:0',
        role: 'destination',
        anchor: { kind: 'discard-card', playerIndex: 0, serial: 14 },
        identity: expect.objectContaining({ kind: 'card', serial: 14, cardId: 1145 }),
      }),
    ]);
    expect(step.displayView?.players[0].hand.map((card) => card.serial)).toEqual([46, 13]);
    expect(step.displayView?.players[0].playZone).toHaveLength(0);
    expect(step.displayView?.players[0].discard.map((card) => card.serial)).toEqual([14]);
    expect(snapshot.views[step.stateIndex].players[0].discard.map((card) => card.serial)).toEqual([14]);
  });

  it('emits a reveal-session plan for a standalone deck-to-hand search phase', () => {
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
            hand: [{ id: 3, serial: 46 }],
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
            active: [],
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
      }],
    });

    const step = snapshot.steps[1];
    expect(step.animationPhases?.map((phase) => phase.key)).toEqual(['DeckSearchReveal:0']);
    expect(step.animationPhases?.[0].animationPlan?.motions).toEqual([
      expect.objectContaining({
        kind: 'reveal-session',
        playerIndex: 0,
        steps: [
          expect.objectContaining({
            kind: 'take',
            sourceAnchor: { kind: 'deck-top', playerIndex: 0 },
            targetAnchor: { kind: 'hand-card', playerIndex: 0, handIndex: 1, serial: 13 },
            identity: expect.objectContaining({ kind: 'card', serial: 13, cardId: 723 }),
            handoffPolicy: expect.objectContaining({
              hideDestinationUntil: 'arrival',
              removeSprite: 'arrival',
            }),
          }),
        ],
      }),
    ]);
    expect(step.animationPhases?.[0].animationPlan?.visibilityClaims).toEqual([
      expect.objectContaining({
        scopeKey: 'DeckSearchReveal:0',
        role: 'destination',
        anchor: { kind: 'hand-card', playerIndex: 0, handIndex: 1, serial: 13 },
        identity: expect.objectContaining({ kind: 'card', serial: 13, cardId: 723 }),
      }),
    ]);
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
    expect(step.animationPhases?.[1].view.players[0].discard.map((card) => card.serial)).toEqual([14]);
    expect(step.animationPhases?.[1].view.players[0].active.pokemon?.serial).toBe(79);
    expect(step.animationPhases?.[1].animationPlan?.motions).toMatchObject([
      {
        kind: 'card-move',
        coordinateSpace: 'board',
        sourceAnchor: { kind: 'board-slot', playerIndex: 0, slot: 'active', slotIndex: 0 },
        targetAnchor: { kind: 'board-slot', playerIndex: 0, slot: 'bench', slotIndex: 0 },
        identity: { kind: 'pokemon', serial: 79, cardId: 304 },
        handoffPolicy: { removeSprite: 'scope-exit' },
      },
      {
        kind: 'card-move',
        coordinateSpace: 'board',
        sourceAnchor: { kind: 'board-slot', playerIndex: 0, slot: 'bench', slotIndex: 0 },
        targetAnchor: { kind: 'board-slot', playerIndex: 0, slot: 'active', slotIndex: 0 },
        identity: { kind: 'pokemon', serial: 81, cardId: 878 },
        handoffPolicy: { removeSprite: 'scope-exit' },
      },
      {
        kind: 'card-move',
        coordinateSpace: 'board',
        sourceAnchor: { kind: 'play-zone-card', playerIndex: 0, serial: 14 },
        targetAnchor: { kind: 'discard-card', playerIndex: 0, serial: 14 },
        identity: { kind: 'card', serial: 14, cardId: 1182 },
        handoffPolicy: {
          hideSourceUntil: 'scope-exit',
          hideDestinationUntil: 'prepaint',
          removeSprite: 'prepaint',
        },
      },
    ]);
    expect(step.displayView?.players[0].playZone).toHaveLength(0);
    expect(step.displayView?.players[0].discard.map((card) => card.serial)).toEqual([14]);
    expect(step.displayView?.players[0].active.pokemon?.serial).toBe(81);
    expect(snapshot.views[step.stateIndex].players[0].discard.map((card) => card.serial)).toEqual([14]);
    expect(snapshot.views[step.stateIndex].players[0].active.pokemon?.serial).toBe(81);
  });

  it('keeps a played trainer in the resolving zone during a follow-up attached-card move', () => {
    const snapshot = cabtReplayToSnapshot({
      visualize: [{
        current: {
          turn: 1,
          yourIndex: 0,
          result: -1,
          players: [{
            active: [{ id: 721, serial: 20, hp: 140, maxHp: 140, energy: [{ id: 88, serial: 50 }] }],
            bench: [{ id: 722, serial: 21, hp: 70, maxHp: 70 }],
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
            active: [{ id: 721, serial: 20, hp: 140, maxHp: 140, energy: [{ id: 88, serial: 50 }] }],
            bench: [{ id: 722, serial: 21, hp: 70, maxHp: 70 }],
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
            type: 'MoveAttached',
            playerIndex: 0,
            cardIdSource: 721,
            serialSource: 20,
            cardIdTarget: 722,
            serialTarget: 21,
            cardId: 88,
            serial: 50,
          },
        ],
        current: {
          turn: 1,
          yourIndex: 0,
          result: -1,
          players: [{
            active: [{ id: 721, serial: 20, hp: 140, maxHp: 140 }],
            bench: [{ id: 722, serial: 21, hp: 70, maxHp: 70, energy: [{ id: 88, serial: 50 }] }],
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
    expect(step.actionTimeline?.map((event) => event.kind)).toEqual(['Play', 'MoveAttached']);
    expect(step.animationPhases?.map((phase) => phase.key)).toEqual(['Play:0', 'MoveAttached:0']);
    expect(step.animationPhases?.[0].view.players[0].playZone.map((card) => card.serial)).toEqual([14]);
    expect(step.animationPhases?.[1].view.players[0].playZone.map((card) => card.serial)).toEqual([14]);
    expect(step.animationPhases?.[1].view.players[0].discard.map((card) => card.serial)).toEqual([14]);
    expect(step.animationPhases?.[1].animationPlan?.motions).toMatchObject([
      {
        kind: 'pulse',
        coordinateSpace: 'board',
        anchor: { kind: 'board-slot', playerIndex: 0, slot: 'bench', slotIndex: 0 },
        label: 'Moved attached card',
      },
      {
        kind: 'card-move',
        coordinateSpace: 'board',
        sourceAnchor: { kind: 'play-zone-card', playerIndex: 0, serial: 14 },
        targetAnchor: { kind: 'discard-card', playerIndex: 0, serial: 14 },
        identity: { kind: 'card', serial: 14, cardId: 1182 },
        handoffPolicy: {
          hideSourceUntil: 'scope-exit',
          hideDestinationUntil: 'prepaint',
          removeSprite: 'prepaint',
        },
      },
    ]);
    expect(step.displayView?.players[0].playZone).toHaveLength(0);
    expect(step.displayView?.players[0].discard.map((card) => card.serial)).toEqual([14]);
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
    expect(step.animationPhases?.[1].view.players[0].discard.map((card) => card.serial)).toEqual([32]);
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
    expect(step.animationPhases?.[2].animationPlan?.motions).toMatchObject([
      {
        kind: 'pulse',
        coordinateSpace: 'board',
        anchor: { kind: 'board-slot', playerIndex: 0, slot: 'active', slotIndex: 0 },
        spriteVisual: { kind: 'pulse', tone: 'ability' },
        label: 'Psychic Draw',
      },
    ]);
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
    expect(step.animationPhases?.[1].view.players[0].discard.map((card) => card.serial)).toEqual([35]);
    expect(step.animationPhases?.[1].view.players[1].active.energy.map((card) => card.serial)).toEqual([70]);
    expect(step.animationPhases?.[1].animationPlan?.motions).toMatchObject([
      {
        kind: 'card-move',
        coordinateSpace: 'board',
        sourceAnchor: { kind: 'attached-energy', playerIndex: 1, slot: 'active', slotIndex: 0, serial: 70 },
        targetAnchor: { kind: 'discard-pile', playerIndex: 1 },
        identity: { kind: 'energy', serial: 70, cardId: 3 },
        durationMs: 360,
      },
      {
        kind: 'card-move',
        coordinateSpace: 'board',
        sourceAnchor: { kind: 'play-zone-card', playerIndex: 0, serial: 35 },
        targetAnchor: { kind: 'discard-card', playerIndex: 0, serial: 35 },
        identity: { kind: 'card', serial: 35, cardId: 1081 },
        handoffPolicy: {
          hideSourceUntil: 'scope-exit',
          hideDestinationUntil: 'prepaint',
          removeSprite: 'prepaint',
        },
      },
    ]);
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
    const evolvePhase = evolveStep.animationPhases?.[0];
    expect(evolveStep.label).toBe('Player 1 evolved into Mega Abomasnow ex.');
    expect(evolveStep.animationPhases?.map((phase) => phase.key)).toEqual(['Evolve:0']);
    expect(evolvePhase?.view.players[0].active.pokemon?.id).toBe(722);
    expect(evolvePhase?.view.players[0].active.damage).toBe(0);
    expect(evolvePhase?.view.players[0].hand.map((card) => card.serial)).toEqual([13, 46]);
    expect(evolvePhase?.animationPlan?.motions).toMatchObject([
      {
        kind: 'card-move',
        coordinateSpace: 'viewport',
        sourceAnchor: { kind: 'hand-card', playerIndex: 0, handIndex: 0, serial: 13 },
        targetAnchor: { kind: 'board-slot', playerIndex: 0, slot: 'active', slotIndex: 0 },
        identity: { kind: 'pokemon', serial: 13, cardId: 723 },
        handoffPolicy: {
          hideSourceUntil: 'scope-exit',
          hideDestinationUntil: 'none',
          removeSprite: 'scope-exit',
        },
      },
    ]);
    expect(evolvePhase?.animationPlan?.visibilityClaims).toMatchObject([
      {
        anchor: { kind: 'hand-card', playerIndex: 0, handIndex: 0, serial: 13 },
        identity: { kind: 'pokemon', serial: 13, cardId: 723 },
        role: 'source',
      },
    ]);
    expect(evolvePhase?.animationPlan?.visibilityClaims).toHaveLength(1);
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
    const evolvePhase = evolveStep.animationPhases?.[0];
    expect(evolvePhase?.view.players[0].bench[0].pokemon?.id).toBe(722);
    expect(evolvePhase?.view.players[0].hand.map((card) => card.serial)).toEqual([13, 46]);
    expect(evolvePhase?.animationPlan?.motions).toMatchObject([
      {
        kind: 'card-move',
        coordinateSpace: 'viewport',
        sourceAnchor: { kind: 'hand-card', playerIndex: 0, handIndex: 0, serial: 13 },
        targetAnchor: { kind: 'board-slot', playerIndex: 0, slot: 'bench', slotIndex: 0 },
        identity: { kind: 'pokemon', serial: 13, cardId: 723 },
      },
    ]);
    expect(evolvePhase?.animationPlan?.visibilityClaims).toHaveLength(1);
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
    expect(playStep?.animationPhases?.some((phase) => phase.kind === 'DeckSearchReveal') ?? false).toBe(false);
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

    const step = snapshot.steps[1];
    expect(step.animationPhases?.map((phase) => phase.key)).toEqual(['Play:0']);
    expect(step.animationPhases?.[0].view.players[0].hand.map((card) => card.serial)).toEqual([7]);
    expect(step.animationPhases?.[0].view.players[0].bench[0].pokemon?.serial).toBe(7);
    expect(step.animationPhases?.[0].animationPlan?.motions).toMatchObject([
      {
        kind: 'card-move',
        coordinateSpace: 'viewport',
        sourceAnchor: { kind: 'hand-card', playerIndex: 0, handIndex: 0, serial: 7 },
        targetAnchor: { kind: 'pokemon-card', playerIndex: 0, slot: 'bench', slotIndex: 0, serial: 7 },
        identity: { kind: 'pokemon', serial: 7, cardId: 722 },
        handoffPolicy: {
          hideSourceUntil: 'scope-exit',
          hideDestinationUntil: 'arrival',
          removeSprite: 'arrival',
        },
      },
    ]);
    expect(step.animationPhases?.[0].animationPlan?.visibilityClaims).toMatchObject([
      {
        anchor: { kind: 'hand-card', playerIndex: 0, handIndex: 0, serial: 7 },
        identity: { kind: 'pokemon', serial: 7, cardId: 722 },
        role: 'source',
      },
      {
        anchor: { kind: 'pokemon-card', playerIndex: 0, slot: 'bench', slotIndex: 0, serial: 7 },
        identity: { kind: 'pokemon', serial: 7, cardId: 722 },
        role: 'destination',
      },
    ]);
    expect(snapshot.views[step.stateIndex].players[0].discard).toHaveLength(0);
    expect(snapshot.views[step.stateIndex].players[0].bench[0].pokemon?.serial).toBe(7);
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
    expect(step.animationPhases?.[0].view.players[0].hand.map((card) => card.serial)).toEqual([120, 83, 101, 81, 109, 100]);
    expect(step.animationPhases?.[1].view.players[0].hand.map((card) => card.serial)).toEqual([120, 101, 81, 109, 100]);
    expect(step.animationPhases?.[2].animationPlan?.motions).toMatchObject([
      {
        kind: 'shuffle',
        coordinateSpace: 'board',
        anchor: { kind: 'deck-top', playerIndex: 0 },
        durationMs: 980,
      },
    ]);
    expect(step.animationPhases?.[1].animationPlan?.motions).toMatchObject([
      {
        kind: 'card-move',
        coordinateSpace: 'viewport',
        sourceAnchor: { kind: 'hand-card', playerIndex: 0, handIndex: 0, serial: 120 },
        targetAnchor: { kind: 'deck-top', playerIndex: 0 },
        identity: { kind: 'card', serial: 120, cardId: 3 },
        startMs: 0,
        durationMs: 360,
        handoffPolicy: {
          hideSourceUntil: 'scope-exit',
          hideDestinationUntil: 'none',
          removeSprite: 'phase-end',
        },
      },
      {
        kind: 'card-move',
        coordinateSpace: 'viewport',
        sourceAnchor: { kind: 'hand-card', playerIndex: 0, handIndex: 1, serial: 101 },
        targetAnchor: { kind: 'deck-top', playerIndex: 0 },
        identity: { kind: 'card', serial: 101, cardId: 3 },
        startMs: 60,
      },
      {
        kind: 'card-move',
        coordinateSpace: 'viewport',
        sourceAnchor: { kind: 'hand-card', playerIndex: 0, handIndex: 2, serial: 81 },
        targetAnchor: { kind: 'deck-top', playerIndex: 0 },
        identity: { kind: 'card', serial: 81, cardId: 1227 },
        startMs: 120,
      },
      {
        kind: 'card-move',
        coordinateSpace: 'viewport',
        sourceAnchor: { kind: 'hand-card', playerIndex: 0, handIndex: 3, serial: 109 },
        targetAnchor: { kind: 'deck-top', playerIndex: 0 },
        identity: { kind: 'card', serial: 109, cardId: 3 },
        startMs: 180,
      },
      {
        kind: 'card-move',
        coordinateSpace: 'viewport',
        sourceAnchor: { kind: 'hand-card', playerIndex: 0, handIndex: 4, serial: 100 },
        targetAnchor: { kind: 'deck-top', playerIndex: 0 },
        identity: { kind: 'card', serial: 100, cardId: 3 },
        startMs: 240,
      },
    ]);
    expect(step.animationPhases?.[1].animationPlan?.visibilityClaims).toMatchObject([
      {
        role: 'source',
        anchor: { kind: 'hand-card', playerIndex: 0, handIndex: 0, serial: 120 },
        identity: { kind: 'card', serial: 120, cardId: 3 },
      },
      {
        role: 'source',
        anchor: { kind: 'hand-card', playerIndex: 0, handIndex: 1, serial: 101 },
        identity: { kind: 'card', serial: 101, cardId: 3 },
      },
      {
        role: 'source',
        anchor: { kind: 'hand-card', playerIndex: 0, handIndex: 2, serial: 81 },
        identity: { kind: 'card', serial: 81, cardId: 1227 },
      },
      {
        role: 'source',
        anchor: { kind: 'hand-card', playerIndex: 0, handIndex: 3, serial: 109 },
        identity: { kind: 'card', serial: 109, cardId: 3 },
      },
      {
        role: 'source',
        anchor: { kind: 'hand-card', playerIndex: 0, handIndex: 4, serial: 100 },
        identity: { kind: 'card', serial: 100, cardId: 3 },
      },
    ]);
    expect(step.animationPhases?.[2].view.players[0].hand).toHaveLength(0);
    expect(step.animationPhases?.[3].view.players[0].hand.map((card) => card.serial)).toEqual([94, 102, 80, 100]);
    expect(step.animationPhases?.map((phase) => phase.view.players[0].playZone.map((card) => card.serial))).toEqual([
      [83],
      [83],
      [83],
      [83],
    ]);
    expect(step.animationPhases?.slice(0, -1).every((phase) => !phase.view.players[0].discard.some((card) => card.serial === 83))).toBe(true);
    expect(step.animationPhases?.at(-1)?.view.players[0].discard.map((card) => card.serial)).toContain(83);
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
    expect(step.animationPhases?.[0].view.players[0].hand.map((card) => card.serial)).toEqual([26, 31]);
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
    expect(step.animationPhases?.[0].view.players[0].bench[0].pokemon).not.toHaveProperty('animationHidden');
    expect(step.animationPhases?.[0].animationPlan?.visibilityClaims).toEqual([
      expect.objectContaining({
        role: 'destination',
        anchor: {
          kind: 'board-slot',
          playerIndex: 0,
          slot: 'bench',
          slotIndex: 0,
        },
        identity: expect.objectContaining({
          kind: 'pokemon',
          serial: 6,
          cardId: 722,
        }),
      }),
    ]);
    expect(step.animationPhases?.[0].view.players[0].deckCount).toBe(49);
    expect(step.animationPhases?.[1].view.players[0].bench[0].pokemon?.serial).toBe(6);
    expect(step.animationPhases?.[1].view.players[0].bench[0].pokemon).not.toHaveProperty('animationHidden');
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
    expect(step.animationPhases?.[2].animationPlan?.motions).toEqual([
      expect.objectContaining({
        kind: 'reveal-session',
        playerIndex: 0,
        coordinateSpace: 'viewport',
        revealCount: 3,
        steps: [
          expect.objectContaining({
            kind: 'attach',
            sourceAnchor: { kind: 'reveal-card', playerIndex: 0, revealIndex: 0, serial: 32 },
            targetAnchor: { kind: 'attached-energy', playerIndex: 0, slot: 'active', slotIndex: 0, serial: 32 },
            identity: expect.objectContaining({ kind: 'card', serial: 32, cardId: 3 }),
            handoffPolicy: expect.objectContaining({
              hideDestinationUntil: 'prepaint',
              removeSprite: 'prepaint',
            }),
          }),
        ],
      }),
    ]);
    expect(step.animationPhases?.[2].animationPlan?.visibilityClaims).toEqual([
      expect.objectContaining({
        scopeKey: 'Attach:0',
        role: 'destination',
        anchor: { kind: 'attached-energy', playerIndex: 0, slot: 'active', slotIndex: 0, serial: 32 },
        identity: expect.objectContaining({ kind: 'card', serial: 32, cardId: 3 }),
      }),
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
    expect(step.animationPhases?.map((phase) => phase.label)).toEqual([
      expect.stringMatching(/^Player 2 played Pok.gear 3\.0\.$/),
      'Player 2 revealed the top 7 cards of their deck.',
      'Player 2 returned 6 revealed cards to their deck.',
      'Player 2 put a revealed card into their hand.',
      'Player 2 shuffled their deck.',
    ]);
    expect(step.animationPhases?.[1].actionTimeline.map((event) => {
      const params = event.params as Record<string, unknown>;
      return [params?.serial, params?.toArea];
    })).toEqual([
      [71, CabtAreaType.LOOKING],
      [102, CabtAreaType.LOOKING],
      [90, CabtAreaType.LOOKING],
      [76, CabtAreaType.LOOKING],
      [117, CabtAreaType.LOOKING],
      [121, CabtAreaType.LOOKING],
      [82, CabtAreaType.LOOKING],
    ]);
    expect(step.animationPhases?.[2].actionTimeline.map((event) => {
      const params = event.params as Record<string, unknown>;
      return [params?.serial, params?.toArea];
    })).toEqual([
      [71, CabtAreaType.DECK],
      [102, CabtAreaType.DECK],
      [90, CabtAreaType.DECK],
      [76, CabtAreaType.DECK],
      [121, CabtAreaType.DECK],
      [82, CabtAreaType.DECK],
    ]);
    expect(step.animationPhases?.[3].actionTimeline.map((event) => {
      const params = event.params as Record<string, unknown>;
      return [params?.serial, params?.toArea];
    })).toEqual([
      [117, CabtAreaType.HAND],
    ]);
    expect(step.animationPhases?.[2].view.players[1].hand.map((card) => card.serial)).toEqual([]);
    expect(step.animationPhases?.[3].view.players[1].hand.map((card) => card.serial)).toEqual([117]);
    expect(step.animationPhases?.[3].view.players[1].hand[0]).not.toHaveProperty('animationHidden');
    expect(step.animationPhases?.[3].animationPlan?.visibilityClaims).toEqual([
      expect.objectContaining({
        role: 'destination',
        anchor: {
          kind: 'hand-card',
          playerIndex: 1,
          handIndex: 0,
          serial: 117,
        },
        identity: expect.objectContaining({
          kind: 'card',
          serial: 117,
        }),
      }),
    ]);
    expect(step.animationPhases?.[1].animationPlan?.motions).toEqual([
      expect.objectContaining({
        kind: 'reveal-session',
        playerIndex: 1,
        coordinateSpace: 'viewport',
        revealCount: 7,
        steps: [
          expect.objectContaining({
            kind: 'reveal',
            startMs: 0,
            sourceAnchor: { kind: 'deck-top', playerIndex: 1 },
            targetAnchor: { kind: 'reveal-card', playerIndex: 1, revealIndex: 0, serial: 71 },
            identity: expect.objectContaining({ kind: 'card', serial: 71, cardId: 19 }),
          }),
          expect.objectContaining({
            kind: 'reveal',
            startMs: 45,
            sourceAnchor: { kind: 'deck-top', playerIndex: 1 },
            targetAnchor: { kind: 'reveal-card', playerIndex: 1, revealIndex: 1, serial: 102 },
            identity: expect.objectContaining({ kind: 'card', serial: 102, cardId: 1152 }),
          }),
          expect.objectContaining({ kind: 'reveal', identity: expect.objectContaining({ kind: 'card', serial: 90, cardId: 1086 }) }),
          expect.objectContaining({ kind: 'reveal', identity: expect.objectContaining({ kind: 'card', serial: 76, cardId: 66 }) }),
          expect.objectContaining({ kind: 'reveal', identity: expect.objectContaining({ kind: 'card', serial: 117, cardId: 1227 }) }),
          expect.objectContaining({ kind: 'reveal', identity: expect.objectContaining({ kind: 'card', serial: 121, cardId: 1255 }) }),
          expect.objectContaining({ kind: 'reveal', identity: expect.objectContaining({ kind: 'card', serial: 82, cardId: 878 }) }),
        ],
      }),
    ]);
    expect(step.animationPhases?.[2].animationPlan?.motions).toEqual([
      expect.objectContaining({
        kind: 'reveal-session',
        playerIndex: 1,
        coordinateSpace: 'viewport',
        steps: [
          expect.objectContaining({ kind: 'select', identity: expect.objectContaining({ kind: 'card', serial: 117, cardId: 1227 }) }),
          expect.objectContaining({
            kind: 'return',
            sourceAnchor: { kind: 'reveal-card', playerIndex: 1, revealIndex: 0, serial: 71 },
            targetAnchor: { kind: 'deck-top', playerIndex: 1 },
            identity: expect.objectContaining({ kind: 'card', serial: 71, cardId: 19 }),
          }),
          expect.objectContaining({ kind: 'return', identity: expect.objectContaining({ kind: 'card', serial: 102, cardId: 1152 }) }),
          expect.objectContaining({ kind: 'return', identity: expect.objectContaining({ kind: 'card', serial: 90, cardId: 1086 }) }),
          expect.objectContaining({ kind: 'return', identity: expect.objectContaining({ kind: 'card', serial: 76, cardId: 66 }) }),
          expect.objectContaining({ kind: 'return', identity: expect.objectContaining({ kind: 'card', serial: 121, cardId: 1255 }) }),
          expect.objectContaining({ kind: 'return', identity: expect.objectContaining({ kind: 'card', serial: 82, cardId: 878 }) }),
        ],
      }),
    ]);
    expect(step.animationPhases?.[3].animationPlan?.motions).toEqual([
      expect.objectContaining({
        kind: 'reveal-session',
        playerIndex: 1,
        coordinateSpace: 'viewport',
        steps: [
          expect.objectContaining({
            kind: 'take',
            identity: expect.objectContaining({ kind: 'card', serial: 117, cardId: 1227 }),
            targetAnchor: { kind: 'hand-card', playerIndex: 1, handIndex: 0, serial: 117 },
            handoffPolicy: expect.objectContaining({
              hideDestinationUntil: 'prepaint',
              removeSprite: 'prepaint',
            }),
          }),
        ],
      }),
    ]);
    expect(step.animationPhases?.map((phase) => phase.view.players[1].playZone.map((card) => card.serial))).toEqual([
      [99],
      [99],
      [99],
      [99],
      [99],
    ]);
    expect(step.animationPhases?.map((phase) => phase.view.players[1].discard.map((card) => card.serial))).toEqual([
      [],
      [],
      [],
      [],
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

  it('plans DrawReverse deck-to-hand motion to the final hand-card anchor', () => {
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
            hand: [],
            deckCount: 45,
            prize: [],
          }, {
            active: [],
            bench: [],
            benchMax: 5,
            hand: [],
            deckCount: 46,
            prize: [],
          }],
        },
      }, {
        logs: [
          { type: 'DrawReverse', playerIndex: 1, cardId: 4, serial: 92 },
        ],
        current: {
          turn: 2,
          yourIndex: 0,
          result: -1,
          players: [{
            active: [],
            bench: [],
            benchMax: 5,
            hand: [],
            deckCount: 45,
            prize: [],
          }, {
            active: [],
            bench: [],
            benchMax: 5,
            hand: [{ id: 4, serial: 92 }],
            deckCount: 45,
            prize: [],
          }],
        },
      }],
    });

    const step = snapshot.steps[1];
    expect(step.animationPhases?.map((phase) => phase.key)).toEqual(['Draw:1']);
    expect(step.animationPhases?.[0].animationPlan?.motions).toMatchObject([
      {
        kind: 'card-move',
        coordinateSpace: 'viewport',
        sourceAnchor: { kind: 'deck-top', playerIndex: 1 },
        targetAnchor: { kind: 'hand-card', playerIndex: 1, handIndex: 0, serial: 92 },
        identity: { kind: 'card', serial: 92, cardId: 4 },
        spriteVisual: {
          kind: 'card',
          faceDown: true,
        },
        handoffPolicy: {
          hideDestinationUntil: 'prepaint',
          removeSprite: 'prepaint',
        },
      },
    ]);
    expect(step.animationPhases?.[0].animationPlan?.visibilityClaims).toMatchObject([
      {
        anchor: { kind: 'hand-card', playerIndex: 1, handIndex: 0, serial: 92 },
        identity: { kind: 'card', serial: 92, cardId: 4 },
        role: 'destination',
      },
    ]);
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
          { type: 'MoveCard', playerIndex: 0, cardId: 955, serial: 44, fromArea: CabtAreaType.DECK, toArea: CabtAreaType.DISCARD },
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
            deckCount: 42,
            discard: [{ id: 3, serial: 56 }, { id: 1235, serial: 27 }, { id: 955, serial: 44 }],
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
    expect(step.animationPhases?.[0].animationPlan?.motions).toMatchObject([
      {
        kind: 'pulse',
        coordinateSpace: 'board',
        anchor: { kind: 'board-slot', playerIndex: 0, slot: 'active', slotIndex: 0 },
        identity: { kind: 'pokemon', serial: 13, cardId: 723 },
        spriteVisual: { kind: 'pulse', tone: 'attack' },
        label: 'Hammer-lanche',
        durationMs: 520,
      },
    ]);
    expect(step.animationPhases?.[2].animationPlan?.motions).toMatchObject([
      {
        kind: 'pulse',
        coordinateSpace: 'board',
        anchor: { kind: 'board-slot', playerIndex: 1, slot: 'active', slotIndex: 0 },
        sourceAnchor: { kind: 'board-slot', playerIndex: 0, slot: 'active', slotIndex: 0 },
        identity: { kind: 'pokemon', serial: 64, cardId: 721 },
        spriteVisual: { kind: 'pulse', tone: 'damage' },
        value: 400,
        durationMs: 560,
      },
    ]);
    expect(step.animationPhases?.[1].animationPlan?.motions).toMatchObject([
      {
        kind: 'card-move',
        coordinateSpace: 'board',
        sourceAnchor: { kind: 'deck-top', playerIndex: 0 },
        targetAnchor: { kind: 'discard-card', playerIndex: 0, serial: 56 },
        identity: { kind: 'card', serial: 56, cardId: 3 },
        durationMs: 300,
        startMs: 0,
        spriteVisual: {
          kind: 'card',
          card: { id: 3, serial: 56 },
        },
        handoffPolicy: {
          hideSourceUntil: 'snapshot',
          hideDestinationUntil: 'prepaint',
          removeSprite: 'prepaint',
          prepaintFrames: 2,
        },
      },
      {
        kind: 'card-move',
        coordinateSpace: 'board',
        sourceAnchor: { kind: 'deck-top', playerIndex: 0 },
        targetAnchor: { kind: 'discard-card', playerIndex: 0, serial: 27 },
        identity: { kind: 'card', serial: 27, cardId: 1235 },
        durationMs: 300,
        startMs: 300,
        spriteVisual: {
          kind: 'card',
          card: { id: 1235, serial: 27 },
        },
        handoffPolicy: {
          hideSourceUntil: 'snapshot',
          hideDestinationUntil: 'prepaint',
          removeSprite: 'prepaint',
          prepaintFrames: 2,
        },
      },
      {
        kind: 'card-move',
        coordinateSpace: 'board',
        sourceAnchor: { kind: 'deck-top', playerIndex: 0 },
        targetAnchor: { kind: 'discard-card', playerIndex: 0, serial: 44 },
        identity: { kind: 'card', serial: 44, cardId: 955 },
        durationMs: 300,
        startMs: 600,
        spriteVisual: {
          kind: 'card',
          card: { id: 955, serial: 44 },
        },
        handoffPolicy: {
          hideSourceUntil: 'snapshot',
          hideDestinationUntil: 'prepaint',
          removeSprite: 'prepaint',
          prepaintFrames: 2,
        },
      },
    ]);
    expect(step.animationPhases?.[1].animationPlan?.visibilityClaims).toMatchObject([
      {
        anchor: { kind: 'discard-card', playerIndex: 0, serial: 56 },
        identity: { kind: 'card', serial: 56, cardId: 3 },
        role: 'destination',
      },
      {
        anchor: { kind: 'discard-card', playerIndex: 0, serial: 27 },
        identity: { kind: 'card', serial: 27, cardId: 1235 },
        role: 'destination',
      },
      {
        anchor: { kind: 'discard-card', playerIndex: 0, serial: 44 },
        identity: { kind: 'card', serial: 44, cardId: 955 },
        role: 'destination',
      },
    ]);
    expect(step.animationPhases?.[1].animationPlan?.visibilityClaims).toHaveLength(3);
    expect(step.animationPhases?.[3].animationPlan?.motions).toMatchObject([
      {
        kind: 'card-move',
        coordinateSpace: 'board',
        sourceAnchor: { kind: 'board-slot', playerIndex: 1, slot: 'active', slotIndex: 0 },
        targetAnchor: { kind: 'discard-pile', playerIndex: 1 },
        identity: { kind: 'pokemon', serial: 64, cardId: 721 },
        durationMs: 620,
        handoffPolicy: {
          hideSourceUntil: 'scope-exit',
          hideDestinationUntil: 'prepaint',
          removeSprite: 'scope-exit',
          prepaintFrames: 2,
        },
      },
    ]);
    expect(step.animationPhases?.[3].animationPlan?.visibilityClaims).toMatchObject([
      {
        anchor: { kind: 'board-slot', playerIndex: 1, slot: 'active', slotIndex: 0 },
        identity: { kind: 'pokemon', serial: 64, cardId: 721 },
        role: 'source',
      },
      {
        anchor: { kind: 'discard-pile', playerIndex: 1 },
        identity: { kind: 'pokemon', serial: 64, cardId: 721 },
        role: 'destination',
      },
    ]);
    expect(step.animationPhases?.[3].animationPlan?.visibilityClaims).toHaveLength(2);
    expect(step.animationPhases?.[3].view.players[1].discard.map((card) => card.serial)).toEqual([]);
    expect(snapshot.views[step.stateIndex].players[1].active.empty).toBe(true);
    expect(snapshot.views[step.stateIndex].players[1].discard.map((card) => card.serial)).toEqual([64, 96]);
    expect(snapshot.views[step.stateIndex].players[1].discard.at(-1)?.serial).toBe(96);
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
    expect(step.animationPhases?.[0].animationPlan?.motions).toMatchObject([
      {
        kind: 'card-move',
        coordinateSpace: 'board',
        sourceAnchor: { kind: 'attached-energy', playerIndex: 0, slot: 'active', slotIndex: 0, serial: 91 },
        targetAnchor: { kind: 'discard-pile', playerIndex: 0 },
        identity: { kind: 'energy', serial: 91, cardId: 3 },
        durationMs: 360,
      },
    ]);
    expect(step.animationPhases?.[0].animationPlan?.visibilityClaims).toMatchObject([
      {
        anchor: { kind: 'attached-energy', playerIndex: 0, slot: 'active', slotIndex: 0, serial: 91 },
        identity: { kind: 'energy', serial: 91, cardId: 3 },
        role: 'source',
      },
      {
        anchor: { kind: 'discard-pile', playerIndex: 0 },
        identity: { kind: 'energy', serial: 91, cardId: 3 },
        role: 'destination',
      },
    ]);
    expect(snapshot.views[step.stateIndex].players[0].active.energy).toHaveLength(0);
    expect(snapshot.views[step.stateIndex].players[0].discard.map((card) => card.serial)).toEqual([91]);
  });

  it('plans attached energy returning to hand as a cross-plane motion', () => {
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
            hand: [],
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
          { type: 'MoveCard', playerIndex: 0, cardId: 3, serial: 91, fromArea: CabtAreaType.ENERGY, toArea: CabtAreaType.HAND },
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
            hand: [{ id: 3, serial: 91 }],
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
      }],
    });

    const step = snapshot.steps[1];
    expect(step.animationPhases?.map((phase) => phase.key.replace(/:\d+:.+$/, ''))).toEqual(['AttachedMove']);
    expect(step.animationPhases?.[0].view.players[0].active.energy.map((card) => card.serial)).toEqual([91]);
    expect(step.animationPhases?.[0].view.players[0].hand.map((card) => card.serial)).toEqual([91]);
    expect(step.animationPhases?.[0].animationPlan?.motions).toMatchObject([
      {
        kind: 'card-move',
        coordinateSpace: 'cross-plane',
        sourceAnchor: { kind: 'attached-energy', playerIndex: 0, slot: 'active', slotIndex: 0, serial: 91 },
        targetAnchor: { kind: 'hand-card', playerIndex: 0, handIndex: 0, serial: 91 },
        identity: { kind: 'energy', serial: 91, cardId: 3 },
        durationMs: 360,
        handoffPolicy: {
          hideSourceUntil: 'scope-exit',
          hideDestinationUntil: 'arrival',
          removeSprite: 'arrival',
        },
      },
    ]);
    expect(step.animationPhases?.[0].animationPlan?.visibilityClaims).toMatchObject([
      {
        anchor: { kind: 'attached-energy', playerIndex: 0, slot: 'active', slotIndex: 0, serial: 91 },
        identity: { kind: 'energy', serial: 91, cardId: 3 },
        role: 'source',
      },
      {
        anchor: { kind: 'hand-card', playerIndex: 0, handIndex: 0, serial: 91 },
        identity: { kind: 'energy', serial: 91, cardId: 3 },
        role: 'destination',
      },
    ]);
    expect(snapshot.views[step.stateIndex].players[0].active.energy).toHaveLength(0);
    expect(snapshot.views[step.stateIndex].players[0].hand.map((card) => card.serial)).toEqual([91]);
  });

  it('plans opponent attached tool returning to hand as a cross-plane motion', () => {
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
            hand: [],
            deckCount: 45,
            prize: [],
          }, {
            active: [{
              id: 722,
              serial: 67,
              hp: 90,
              maxHp: 90,
              tools: [{ id: 99, serial: 92 }],
            }],
            bench: [],
            benchMax: 5,
            hand: [],
            deckCount: 46,
            prize: [],
          }],
        },
      }, {
        logs: [
          { type: 'MoveCard', playerIndex: 1, cardId: 99, serial: 92, fromArea: CabtAreaType.TOOL, toArea: CabtAreaType.HAND },
        ],
        current: {
          turn: 4,
          yourIndex: 0,
          result: -1,
          players: [{
            active: [],
            bench: [],
            benchMax: 5,
            hand: [],
            deckCount: 45,
            prize: [],
          }, {
            active: [{
              id: 722,
              serial: 67,
              hp: 90,
              maxHp: 90,
              tools: [],
            }],
            bench: [],
            benchMax: 5,
            hand: [{ id: 99, serial: 92 }],
            deckCount: 46,
            prize: [],
          }],
        },
      }],
    });

    const step = snapshot.steps[1];
    expect(step.animationPhases?.map((phase) => phase.key.replace(/:\d+:.+$/, ''))).toEqual(['AttachedMove']);
    expect(step.animationPhases?.[0].view.players[1].active.tools.map((card) => card.serial)).toEqual([92]);
    expect(step.animationPhases?.[0].view.players[1].hand.map((card) => card.serial)).toEqual([92]);
    expect(step.animationPhases?.[0].animationPlan?.motions).toMatchObject([
      {
        kind: 'card-move',
        coordinateSpace: 'cross-plane',
        sourceAnchor: { kind: 'attached-tool', playerIndex: 1, slot: 'active', slotIndex: 0, serial: 92 },
        targetAnchor: { kind: 'hand-card', playerIndex: 1, handIndex: 0, serial: 92 },
        identity: { kind: 'tool', serial: 92, cardId: 99 },
        handoffPolicy: {
          hideSourceUntil: 'scope-exit',
          hideDestinationUntil: 'arrival',
          removeSprite: 'arrival',
        },
      },
    ]);
    expect(step.animationPhases?.[0].animationPlan?.visibilityClaims).toMatchObject([
      {
        anchor: { kind: 'attached-tool', playerIndex: 1, slot: 'active', slotIndex: 0, serial: 92 },
        identity: { kind: 'tool', serial: 92, cardId: 99 },
        role: 'source',
      },
      {
        anchor: { kind: 'hand-card', playerIndex: 1, handIndex: 0, serial: 92 },
        identity: { kind: 'tool', serial: 92, cardId: 99 },
        role: 'destination',
      },
    ]);
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
    expect(step.animationPhases?.[0].animationPlan?.motions).toMatchObject([
      {
        kind: 'card-move',
        coordinateSpace: 'board',
        sourceAnchor: { kind: 'board-slot', playerIndex: 1, slot: 'bench', slotIndex: 0 },
        targetAnchor: { kind: 'board-slot', playerIndex: 1, slot: 'active', slotIndex: 0 },
        identity: { kind: 'pokemon', serial: 67, cardId: 722 },
        handoffPolicy: { removeSprite: 'scope-exit' },
      },
    ]);
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
    expect(step.animationPhases?.[0].animationPlan?.motions).toMatchObject([
      {
        kind: 'card-move',
        coordinateSpace: 'board',
        sourceAnchor: { kind: 'board-slot', playerIndex: 0, slot: 'active', slotIndex: 0 },
        targetAnchor: { kind: 'board-slot', playerIndex: 0, slot: 'bench', slotIndex: 0 },
        spriteVisual: { kind: 'card', card: { id: 721, serial: 64 } },
        handoffPolicy: { removeSprite: 'scope-exit' },
      },
      {
        kind: 'card-move',
        coordinateSpace: 'board',
        sourceAnchor: { kind: 'board-slot', playerIndex: 0, slot: 'bench', slotIndex: 0 },
        targetAnchor: { kind: 'board-slot', playerIndex: 0, slot: 'active', slotIndex: 0 },
        spriteVisual: { kind: 'card', card: { id: 722, serial: 67 } },
        handoffPolicy: { removeSprite: 'scope-exit' },
      },
    ]);
    expect(step.animationPhases?.[0].animationPlan?.visibilityClaims).toMatchObject([
      {
        anchor: { kind: 'board-slot', playerIndex: 0, slot: 'active', slotIndex: 0 },
        identity: { kind: 'pokemon', serial: 64, cardId: 721 },
        role: 'source',
      },
      {
        anchor: { kind: 'board-slot', playerIndex: 0, slot: 'bench', slotIndex: 0 },
        identity: { kind: 'pokemon', serial: 64, cardId: 721 },
        role: 'destination',
      },
      {
        anchor: { kind: 'board-slot', playerIndex: 0, slot: 'bench', slotIndex: 0 },
        identity: { kind: 'pokemon', serial: 67, cardId: 722 },
        role: 'source',
      },
      {
        anchor: { kind: 'board-slot', playerIndex: 0, slot: 'active', slotIndex: 0 },
        identity: { kind: 'pokemon', serial: 67, cardId: 722 },
        role: 'destination',
      },
    ]);
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

  it('plans a played trainer from hand into the resolving play zone', () => {
    const snapshot = cabtReplayToSnapshot({
      visualize: [{
        current: {
          turn: 3,
          yourIndex: 0,
          result: -1,
          players: [{
            active: [{ id: 721, serial: 4, hp: 150, maxHp: 150 }],
            bench: [],
            benchMax: 5,
            hand: [{ id: 1227, serial: 83 }],
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
          { type: 'Play', playerIndex: 0, cardId: 1227, serial: 83 },
        ],
        current: {
          turn: 3,
          yourIndex: 0,
          result: -1,
          players: [{
            active: [{ id: 721, serial: 4, hp: 150, maxHp: 150 }],
            bench: [],
            benchMax: 5,
            hand: [],
            deckCount: 50,
            discard: [{ id: 1227, serial: 83 }],
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
    expect(step.animationPhases?.map((phase) => phase.key)).toEqual(['Play:0']);
    expect(step.animationPhases?.[0].view.players[0].hand.map((card) => card.serial)).toEqual([83]);
    expect(step.animationPhases?.[0].view.players[0].playZone.map((card) => card.serial)).toEqual([83]);
    expect(step.animationPhases?.[0].animationPlan?.motions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'card-move',
        coordinateSpace: 'viewport',
        sourceAnchor: { kind: 'hand-card', playerIndex: 0, handIndex: 0, serial: 83 },
        targetAnchor: { kind: 'play-zone-card', playerIndex: 0, serial: 83 },
        identity: expect.objectContaining({ kind: 'card', serial: 83, cardId: 1227 }),
        handoffPolicy: expect.objectContaining({
          hideSourceUntil: 'scope-exit',
          hideDestinationUntil: 'arrival',
          removeSprite: 'arrival',
        }),
      }),
      expect.objectContaining({
        kind: 'card-move',
        coordinateSpace: 'board',
        sourceAnchor: { kind: 'play-zone-card', playerIndex: 0, serial: 83 },
        targetAnchor: { kind: 'discard-card', playerIndex: 0, serial: 83 },
        identity: { kind: 'card', serial: 83, cardId: 1227, name: "Lillie's Determination" },
        startMs: 384,
        handoffPolicy: expect.objectContaining({
          hideSourceUntil: 'scope-exit',
          hideDestinationUntil: 'prepaint',
          removeSprite: 'prepaint',
        }),
      }),
    ]));
    expect(step.animationPhases?.[0].animationPlan?.visibilityClaims).toEqual(expect.arrayContaining([
      expect.objectContaining({
        anchor: { kind: 'hand-card', playerIndex: 0, handIndex: 0, serial: 83 },
        identity: expect.objectContaining({ kind: 'card', serial: 83, cardId: 1227 }),
        role: 'source',
      }),
      expect.objectContaining({
        anchor: { kind: 'play-zone-card', playerIndex: 0, serial: 83 },
        identity: expect.objectContaining({ kind: 'card', serial: 83, cardId: 1227 }),
        role: 'destination',
      }),
      expect.objectContaining({
        anchor: { kind: 'play-zone-card', playerIndex: 0, serial: 83 },
        identity: expect.objectContaining({ kind: 'card', serial: 83, cardId: 1227 }),
        role: 'source',
      }),
      expect.objectContaining({
        anchor: { kind: 'discard-card', playerIndex: 0, serial: 83 },
        identity: expect.objectContaining({ kind: 'card', serial: 83, cardId: 1227 }),
        role: 'destination',
      }),
    ]));
    expect(step.displayView?.players[0].playZone).toHaveLength(0);
    expect(step.displayView?.players[0].discard.map((card) => card.serial)).toEqual([83]);
  });

  it('plans a hand Pokemon moving to the bench without combining it with hand-to-deck', () => {
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
            hand: [{ id: 722, serial: 6 }],
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
          { type: 'MoveCard', playerIndex: 0, cardId: 722, serial: 6, fromArea: CabtAreaType.HAND, toArea: CabtAreaType.BENCH },
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
      }],
    });

    const step = snapshot.steps[1];
    expect(step.animationPhases?.map((phase) => phase.key)).toEqual([`HandMove:0:${CabtAreaType.BENCH}`]);
    expect(step.animationPhases?.[0].view.players[0].hand.map((card) => card.serial)).toEqual([6]);
    expect(step.animationPhases?.[0].view.players[0].bench[0].pokemon?.serial).toBe(6);
    expect(step.animationPhases?.[0].animationPlan?.motions).toMatchObject([
      {
        kind: 'card-move',
        coordinateSpace: 'viewport',
        sourceAnchor: { kind: 'hand-card', playerIndex: 0, handIndex: 0, serial: 6 },
        targetAnchor: { kind: 'pokemon-card', playerIndex: 0, slot: 'bench', slotIndex: 0, serial: 6 },
        identity: { kind: 'pokemon', serial: 6, cardId: 722 },
      },
    ]);
    expect(step.animationPhases?.[0].animationPlan?.visibilityClaims).toMatchObject([
      {
        anchor: { kind: 'hand-card', playerIndex: 0, handIndex: 0, serial: 6 },
        identity: { kind: 'pokemon', serial: 6, cardId: 722 },
        role: 'source',
      },
      {
        anchor: { kind: 'pokemon-card', playerIndex: 0, slot: 'bench', slotIndex: 0, serial: 6 },
        identity: { kind: 'pokemon', serial: 6, cardId: 722 },
        role: 'destination',
      },
    ]);
  });

  it('plans an ordinary hand energy attach to the attached-card anchor', () => {
    const snapshot = cabtReplayToSnapshot({
      visualize: [{
        current: {
          turn: 2,
          yourIndex: 0,
          result: -1,
          players: [{
            active: [{ id: 722, serial: 6, hp: 70, maxHp: 70 }],
            bench: [],
            benchMax: 5,
            hand: [{ id: 3, serial: 70 }],
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
          { type: 'Attach', playerIndex: 0, cardId: 3, serial: 70, cardIdTarget: 722, serialTarget: 6 },
        ],
        current: {
          turn: 2,
          yourIndex: 0,
          result: -1,
          players: [{
            active: [{ id: 722, serial: 6, hp: 70, maxHp: 70, energyCards: [{ id: 3, serial: 70 }] }],
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
      }],
    });

    const step = snapshot.steps[1];
    expect(step.animationPhases?.map((phase) => phase.key)).toEqual(['Attach:0']);
    expect(step.animationPhases?.[0].view.players[0].hand.map((card) => card.serial)).toEqual([70]);
    expect(step.animationPhases?.[0].view.players[0].active.energy.map((card) => card.serial)).toEqual([70]);
    expect(step.animationPhases?.[0].animationPlan?.motions).toMatchObject([
      {
        kind: 'card-move',
        coordinateSpace: 'viewport',
        sourceAnchor: { kind: 'hand-card', playerIndex: 0, handIndex: 0, serial: 70 },
        targetAnchor: { kind: 'attached-energy', playerIndex: 0, slot: 'active', slotIndex: 0, serial: 70 },
        identity: { kind: 'energy', serial: 70, cardId: 3 },
        handoffPolicy: {
          hideSourceUntil: 'scope-exit',
          hideDestinationUntil: 'arrival',
          removeSprite: 'arrival',
        },
      },
    ]);
    expect(step.animationPhases?.[0].animationPlan?.visibilityClaims).toMatchObject([
      {
        anchor: { kind: 'hand-card', playerIndex: 0, handIndex: 0, serial: 70 },
        identity: { kind: 'energy', serial: 70, cardId: 3 },
        role: 'source',
      },
      {
        anchor: { kind: 'attached-energy', playerIndex: 0, slot: 'active', slotIndex: 0, serial: 70 },
        identity: { kind: 'energy', serial: 70, cardId: 3 },
        role: 'destination',
      },
    ]);
  });

  it('plans discard recovery to hand as a cross-plane motion', () => {
    const snapshot = cabtReplayToSnapshot({
      visualize: [{
        current: {
          turn: 3,
          yourIndex: 0,
          result: -1,
          players: [{
            active: [],
            bench: [],
            benchMax: 5,
            hand: [],
            deckCount: 45,
            discard: [{ id: 66, serial: 11 }],
            prize: [],
          }, {
            active: [],
            bench: [],
            benchMax: 5,
            handCount: 0,
            deckCount: 45,
            prize: [],
          }],
        },
      }, {
        logs: [
          { type: 'MoveCard', playerIndex: 0, cardId: 66, serial: 11, fromArea: CabtAreaType.DISCARD, toArea: CabtAreaType.HAND },
        ],
        current: {
          turn: 3,
          yourIndex: 0,
          result: -1,
          players: [{
            active: [],
            bench: [],
            benchMax: 5,
            hand: [{ id: 66, serial: 11 }],
            deckCount: 45,
            discard: [],
            prize: [],
          }, {
            active: [],
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
    expect(step.animationPhases?.map((phase) => phase.key)).toEqual([`DiscardRecover:0:${CabtAreaType.HAND}`]);
    expect(step.animationPhases?.[0].view.players[0].discard.map((card) => card.serial)).toEqual([11]);
    expect(step.animationPhases?.[0].animationPlan?.motions).toMatchObject([
      {
        kind: 'card-move',
        coordinateSpace: 'cross-plane',
        sourceAnchor: { kind: 'discard-card', playerIndex: 0, serial: 11 },
        targetAnchor: { kind: 'hand', playerIndex: 0 },
        identity: { kind: 'card', serial: 11, cardId: 66 },
        handoffPolicy: {
          hideSourceUntil: 'scope-exit',
          hideDestinationUntil: 'none',
          removeSprite: 'arrival',
        },
      },
    ]);
    expect(step.animationPhases?.[0].animationPlan?.visibilityClaims).toMatchObject([
      {
        anchor: { kind: 'discard-card', playerIndex: 0, serial: 11 },
        identity: { kind: 'card', serial: 11, cardId: 66 },
        role: 'source',
      },
    ]);
  });

  it('plans discard recovery to deck as a board motion', () => {
    const snapshot = cabtReplayToSnapshot({
      visualize: [{
        current: {
          turn: 3,
          yourIndex: 0,
          result: -1,
          players: [{
            active: [],
            bench: [],
            benchMax: 5,
            hand: [],
            deckCount: 45,
            discard: [{ id: 305, serial: 17 }],
            prize: [],
          }, {
            active: [],
            bench: [],
            benchMax: 5,
            handCount: 0,
            deckCount: 45,
            prize: [],
          }],
        },
      }, {
        logs: [
          { type: 'MoveCard', playerIndex: 0, cardId: 305, serial: 17, fromArea: CabtAreaType.DISCARD, toArea: CabtAreaType.DECK },
        ],
        current: {
          turn: 3,
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
            active: [],
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
    expect(step.animationPhases?.map((phase) => phase.key)).toEqual([`DiscardRecover:0:${CabtAreaType.DECK}`]);
    expect(step.animationPhases?.[0].view.players[0].discard.map((card) => card.serial)).toEqual([17]);
    expect(step.animationPhases?.[0].animationPlan?.motions).toMatchObject([
      {
        kind: 'card-move',
        coordinateSpace: 'board',
        sourceAnchor: { kind: 'discard-card', playerIndex: 0, serial: 17 },
        targetAnchor: { kind: 'deck-top', playerIndex: 0 },
        identity: { kind: 'card', serial: 17, cardId: 305 },
        handoffPolicy: {
          hideSourceUntil: 'scope-exit',
          hideDestinationUntil: 'prepaint',
          removeSprite: 'prepaint',
        },
      },
    ]);
  });
});
