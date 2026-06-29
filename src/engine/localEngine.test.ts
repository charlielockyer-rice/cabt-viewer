import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { LocalEngineController } from './localEngine';
import { promptIdForObservation } from '../lib/cabt/demoEngine';
import { SlotType, targetFor } from '../lib/game/types';
import { CabtAreaType, CabtLogType, CabtOptionType, CabtSelectContext, CabtSelectType } from '../lib/cabt/types';

describe('LocalEngineController', () => {
  process.env.CABT_ENGINE_MODE = 'demo';

  it('starts a CABT-shaped demo game and exposes a playable view', async () => {
    const engine = new LocalEngineController();
    const res = await engine.handle({
      type: 'startGame',
      payload: {
        player1: { deck: [] },
        player2: { deck: [] },
      },
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.view.players).toHaveLength(2);
    expect(res.view.phaseLabel).toBe('Player turn');
    expect(res.view.players[0]?.active.pokemon?.name).toBe('Charmander');
    expect(res.view.players[0]?.availableActions?.active?.attacks[0]?.name).toBe('Ember');
  });

  it('auto-enumerates game log files that are not listed in the manifest', () => {
    const logsDir = path.resolve('public/game-logs');
    const file = `local-vitest-${process.pid}.json`;
    const fullPath = path.join(logsDir, file);
    fs.writeFileSync(fullPath, '{}\n');
    try {
      const engine = new LocalEngineController();
      expect(engine.listReplays().replays).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: file.replace(/\.json$/, ''),
            file,
          }),
        ]),
      );
    } finally {
      fs.unlinkSync(fullPath);
    }
  });

  it('accepts existing UI commands through the CABT adapter scaffold', async () => {
    const engine = new LocalEngineController();
    let res = await engine.handle({ type: 'startGame' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    res = await engine.handle({
      type: 'playCard',
      payload: {
        playerIndex: 0,
        handIndex: 0,
        target: targetFor(0, 0, SlotType.ACTIVE),
      },
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.view.players[0]?.active.energy).toHaveLength(2);

    res = await engine.handle({ type: 'attack', payload: { playerIndex: 0, attack: 'Ember' } });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.view.activePlayerIndex).toBe(1);
      expect(res.view.logs.at(-2)?.message).toContain('Ember');
    }
  });

  it('starts self-vs-self without sending agent paths to the bridge', async () => {
    const engine = new LocalEngineController() as any;
    let bridgePayload: Record<string, unknown> | undefined;
    engine.bridge = {
      stop: () => {},
      request: async (payload: Record<string, unknown>) => {
        bridgePayload = payload;
        return { ok: true, observation: null, cards: [], attacks: [] };
      },
    };

    const res = await engine.start({
      player1: { deck: Array(60).fill(1), control: 'self' },
      player2: { deck: Array(60).fill(2), control: 'self', agentId: 'mega-lucario-ex' },
    });

    expect(res.ok).toBe(true);
    expect(bridgePayload?.agentControlled).toEqual([false, false]);
    expect(bridgePayload?.agentPaths).toEqual([undefined, undefined]);
  });

  it('wires agent-controlled players to their selected agent paths', async () => {
    const engine = new LocalEngineController() as any;
    let bridgePayload: Record<string, unknown> | undefined;
    engine.bridge = {
      stop: () => {},
      request: async (payload: Record<string, unknown>) => {
        bridgePayload = payload;
        return { ok: true, observation: null, cards: [], attacks: [] };
      },
    };

    const res = await engine.start({
      player1: { deck: Array(60).fill(1), control: 'agent', agentId: 'first-legal' },
      player2: { deck: Array(60).fill(2), control: 'agent', agentId: 'mega-lucario-ex' },
    });

    expect(res.ok).toBe(true);
    expect(bridgePayload?.agentControlled).toEqual([true, true]);
    expect(bridgePayload?.agentPaths).toEqual([undefined, 'public/agents/mega-lucario-ex/main.py']);
  });

  it('matches real CABT main-phase hand options with omitted source fields', () => {
    const engine = new LocalEngineController() as any;
    const payload = {
      playerIndex: 0,
      handIndex: 3,
      target: targetFor(0, 0, SlotType.ACTIVE),
    };

    expect(engine.matchesPlayCardOption({ type: CabtOptionType.PLAY, index: 3 }, payload)).toBe(true);
    expect(engine.matchesPlayCardOption({
      type: CabtOptionType.ATTACH,
      area: CabtAreaType.HAND,
      index: 3,
      inPlayArea: CabtAreaType.ACTIVE,
      inPlayIndex: 0,
    }, payload)).toBe(true);
    expect(engine.matchesPlayCardOption({
      type: CabtOptionType.ATTACH,
      area: CabtAreaType.HAND,
      index: 3,
      inPlayArea: CabtAreaType.BENCH,
      inPlayIndex: 0,
    }, payload)).toBe(false);
  });

  it('matches CABT ability options to the clicked board slot and ability name', () => {
    const engine = new LocalEngineController() as any;
    engine.observation = {
      current: {
        players: [
          {
            active: [null],
            bench: [{ id: 96 }],
            hand: [],
          },
        ],
      },
    };
    engine.dataMaps = {
      cardData: {
        96: { cardId: 96, name: 'Teal Mask Ogerpon ex', cardType: 0, skills: [{ name: 'Teal Dance' }] },
      },
      attacks: {},
    };

    expect(engine.matchesAbilityOption({
      type: CabtOptionType.ABILITY,
      area: CabtAreaType.BENCH,
      index: 0,
    }, {
      playerIndex: 0,
      ability: 'Teal Dance',
      target: targetFor(0, 0, SlotType.BENCH, 0),
    })).toBe(true);
    expect(engine.matchesAbilityOption({
      type: CabtOptionType.ABILITY,
      area: CabtAreaType.BENCH,
      index: 0,
    }, {
      playerIndex: 0,
      ability: 'Wrong Ability',
      target: targetFor(0, 0, SlotType.BENCH, 0),
    })).toBe(false);
  });

  it('keeps a selected retreat target across intermediate CABT prompts', () => {
    const engine = new LocalEngineController() as any;
    engine.pendingRetreatTarget = { playerIndex: 0, benchIndex: 1 };
    engine.observation = {
      select: {
        option: [
          { area: CabtAreaType.BENCH, index: 0 },
          { area: CabtAreaType.BENCH, index: 1 },
        ],
      },
    };

    expect(engine.findPendingRetreatTargetOption()).toBe(1);
  });

  it('appends bridge auto-step logs to the action timeline sequence', () => {
    const engine = new LocalEngineController() as any;
    const current = currentState();

    engine.applyBridgeResponse({
      ok: true,
      id: 1,
      observation: {
        select: null,
        logs: [{ type: CabtLogType.TURN_END, playerIndex: 1 }],
        current,
      },
      autoSteps: [
        {
          select: null,
          logs: [{ type: CabtLogType.TURN_START, playerIndex: 1 }],
          current,
        },
        {
          select: null,
          logs: [{ type: CabtLogType.TURN_END, playerIndex: 1 }],
          current,
        },
      ],
    });

    const response = engine.viewResponse();

    expect(response.ok).toBe(true);
    if (!response.ok) return;
    expect(response.view.actionTimeline).toEqual([
      expect.objectContaining({ id: 1, message: 'Player 2 turn started.' }),
      expect.objectContaining({ id: 2, message: 'Player 2 ended their turn.' }),
    ]);
    expect(response.sequence).toEqual([
      expect.objectContaining({
        actionTimeline: [expect.objectContaining({ message: 'Player 2 turn started.' })],
      }),
      expect.objectContaining({
        actionTimeline: [
          expect.objectContaining({ message: 'Player 2 turn started.' }),
          expect.objectContaining({ message: 'Player 2 ended their turn.' }),
        ],
      }),
    ]);
  });

  it('inserts a playback reveal prompt for known deck-to-discard batches', () => {
    const engine = new LocalEngineController() as any;
    engine.dataMaps = {
      cardData: {
        3: { cardId: 3, name: 'Basic {W} Energy', cardType: 5, energyType: 3, set: 'SVE', setNumber: '3' },
        723: { cardId: 723, name: 'Mega Abomasnow ex', cardType: 0, set: 'MEG', setNumber: '36' },
      },
      attacks: {},
    };

    engine.applyBridgeResponse({
      ok: true,
      id: 1,
      observation: {
        select: null,
        logs: [
          { type: CabtLogType.MOVE_CARD, playerIndex: 0, cardId: 3, serial: 10, fromArea: CabtAreaType.DECK, toArea: CabtAreaType.DISCARD },
          { type: CabtLogType.MOVE_CARD, playerIndex: 0, cardId: 723, serial: 11, fromArea: CabtAreaType.DECK, toArea: CabtAreaType.DISCARD },
        ],
        current: currentState(),
      },
      autoSteps: [],
    });

    const response = engine.viewResponse();
    expect(response.ok).toBe(true);
    if (!response.ok) return;
    const revealView = response.sequence?.[0];

    expect(revealView?.prompts[0]).toEqual(expect.objectContaining({
      className: 'ConfirmCardsPrompt',
      type: 'playback-reveal',
      message: 'Revealed and discarded cards',
    }));
    expect(revealView?.prompts[0]?.fields.cards).toEqual([
      expect.objectContaining({ name: 'Basic {W} Energy' }),
      expect.objectContaining({ name: 'Mega Abomasnow ex' }),
    ]);
    expect(response.sequence?.[1]?.prompts).toEqual([]);
  });

  it('skips agent decision frames according to manual player controls', () => {
    const engine = new LocalEngineController() as any;
    engine.playerControls = ['self', 'agent'];

    engine.applyBridgeResponse({
      ok: true,
      id: 1,
      observation: {
        select: null,
        logs: [],
        current: currentState(),
      },
      autoSteps: [
        {
          select: {
            type: 1,
            context: CabtSelectContext.TO_ACTIVE,
            minCount: 1,
            maxCount: 1,
            remainDamageCounter: 0,
            remainEnergyCost: 0,
            option: [{ type: CabtOptionType.CARD, area: CabtAreaType.BENCH, index: 0, playerIndex: 1 }],
            deck: null,
            contextCard: null,
            effect: null,
          },
          logs: [],
          current: currentState({ yourIndex: 1 }),
        },
        {
          select: null,
          logs: [],
          current: currentState({ yourIndex: 0 }),
        },
      ],
    });

    const response = engine.viewResponse();
    expect(response.ok).toBe(true);
    if (!response.ok) return;
    expect(response.sequence).toHaveLength(1);
    expect(response.sequence?.[0]?.prompts).toEqual([]);
  });

  it('batches repeated single-energy retreat payment prompts', async () => {
    const engine = new LocalEngineController() as any;
    const selections: number[][] = [];
    const activeWithFourEnergy = {
      id: 723,
      hp: 350,
      maxHp: 350,
      appearThisTurn: false,
      energies: [3, 3, 3, 3],
      energyCards: [10, 11, 12, 13].map((serial) => ({ id: 3, serial, playerIndex: 0 })),
      tools: [],
      preEvolution: [],
    };
    const current = {
      turn: 1,
      turnActionCount: 0,
      yourIndex: 0,
      firstPlayer: 0,
      supporterPlayed: false,
      stadiumPlayed: false,
      energyAttached: true,
      retreated: false,
      result: -1,
      stadium: [],
      looking: null,
      players: [
        {
          active: [activeWithFourEnergy],
          bench: [{ id: 722, hp: 90, maxHp: 90, appearThisTurn: false, energies: [], energyCards: [], tools: [], preEvolution: [] }],
          benchMax: 5,
          deckCount: 47,
          discard: [],
          prize: [],
          handCount: 0,
          hand: [],
          poisoned: false,
          burned: false,
          asleep: false,
          paralyzed: false,
          confused: false,
        },
        {
          active: [null],
          bench: [],
          benchMax: 5,
          deckCount: 47,
          discard: [],
          prize: [],
          handCount: 0,
          hand: [],
          poisoned: false,
          burned: false,
          asleep: false,
          paralyzed: false,
          confused: false,
        },
      ],
    };
    const energySelect = (energyCards: typeof activeWithFourEnergy.energyCards) => ({
      type: 1,
      context: CabtSelectContext.DISCARD_ENERGY_CARD,
      minCount: 1,
      maxCount: 1,
      remainDamageCounter: 0,
      remainEnergyCost: energyCards.length,
      option: energyCards.map((_card, energyIndex) => ({
        type: CabtOptionType.ENERGY_CARD,
        area: CabtAreaType.ACTIVE,
        index: 0,
        energyIndex,
        playerIndex: 0,
      })),
      deck: null,
      contextCard: null,
      effect: null,
    });

    engine.sessionId = 'test-session';
    engine.pendingRetreatTarget = { playerIndex: 0, benchIndex: 0 };
    engine.dataMaps = { cardData: {}, attacks: {} };
    engine.observation = {
      select: energySelect(activeWithFourEnergy.energyCards),
      logs: [],
      current,
    };
    engine.bridge = {
      request: async ({ selection }: { selection: number[] }) => {
        selections.push(selection);
        activeWithFourEnergy.energyCards.shift();
        activeWithFourEnergy.energies.shift();
        if (activeWithFourEnergy.energyCards.length) {
          return {
            ok: true,
            observation: { select: energySelect(activeWithFourEnergy.energyCards), logs: [], current },
          };
        }
        return {
          ok: true,
          observation: {
            select: {
              type: 1,
              context: CabtSelectContext.TO_ACTIVE,
              minCount: 1,
              maxCount: 1,
              remainDamageCounter: 0,
              remainEnergyCost: 0,
              option: [{ type: CabtOptionType.CARD, area: CabtAreaType.BENCH, index: 0, playerIndex: 0 }],
              deck: null,
              contextCard: null,
              effect: null,
            },
            logs: [],
            current,
          },
        };
      },
    };

    const response = await engine.applySelection([0, 1, 2, 3]);

    expect(selections).toEqual([[0], [0], [0], [0], [0]]);
    expect(response.ok).toBe(true);
    if (!response.ok) return;
    expect(response.sequence).toHaveLength(5);
  });

  it('rejects stale CABT prompt resolutions before contacting the bridge', async () => {
    const previousEngineMode = process.env.CABT_ENGINE_MODE;
    delete process.env.CABT_ENGINE_MODE;
    try {
      const engine = new LocalEngineController() as any;
      let bridgeCalled = false;
      const observation = {
        select: {
          type: CabtSelectType.YES_NO,
          context: CabtSelectContext.ACTIVATE,
          minCount: 1,
          maxCount: 1,
          remainDamageCounter: 0,
          remainEnergyCost: 0,
          option: [{ type: CabtOptionType.YES }, { type: CabtOptionType.NO }],
          deck: null,
          contextCard: null,
          effect: null,
        },
        logs: [],
        current: currentState(),
      };
      engine.sessionId = 'test-session';
      engine.dataMaps = { cardData: {}, attacks: {} };
      engine.observation = observation;
      engine.bridge = {
        request: async () => {
          bridgeCalled = true;
          throw new Error('stale prompt should not reach the bridge');
        },
      };

      const response = await engine.handle({
        type: 'resolvePrompt',
        payload: {
          sessionId: 'test-session',
          id: promptIdForObservation(observation) + 1,
          result: 0,
        },
      });

      expect(response.ok).toBe(false);
      if (response.ok) return;
      expect(response.error).toBe('That prompt is no longer current.');
      expect(bridgeCalled).toBe(false);
    } finally {
      if (previousEngineMode === undefined) {
        delete process.env.CABT_ENGINE_MODE;
      } else {
        process.env.CABT_ENGINE_MODE = previousEngineMode;
      }
    }
  });
});

function currentState(overrides: Record<string, unknown> = {}) {
  return {
    turn: 2,
    turnActionCount: 0,
    yourIndex: 0,
    firstPlayer: 0,
    supporterPlayed: false,
    stadiumPlayed: false,
    energyAttached: true,
    retreated: false,
    result: -1,
    stadium: [],
    looking: null,
    players: [
      playerState({ hand: [], handCount: 0 }),
      playerState({ hand: null, handCount: 0 }),
    ],
    ...overrides,
  };
}

function playerState(overrides: Record<string, unknown> = {}) {
  return {
    active: [null],
    bench: [],
    benchMax: 5,
    deckCount: 47,
    discard: [],
    prize: [],
    handCount: 0,
    hand: [],
    poisoned: false,
    burned: false,
    asleep: false,
    paralyzed: false,
    confused: false,
    ...overrides,
  };
}
