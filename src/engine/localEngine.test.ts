import { describe, expect, it } from 'vitest';
import { LocalEngineController } from './localEngine';
import { CabtAreaType, CabtLogType, CabtOptionType, CabtSelectContext, CabtSelectType } from '../lib/cabt/types';

describe('LocalEngineController', () => {
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

  it('projects the current decision with seats onto the interactive view', () => {
    const engine = new LocalEngineController() as any;
    engine.playerControls = ['self', 'agent'];
    engine.replayPlayerLabels = ['Charlie', 'Copycat'];
    engine.decisionSeq = 3;
    engine.dataMaps = { cardData: {}, attacks: {} };
    engine.observation = {
      select: yesNoSelect(),
      logs: [],
      current: currentState(),
    };

    const response = engine.viewResponse();

    expect(response.ok).toBe(true);
    if (!response.ok) return;
    expect(response.view.seats).toEqual([
      { control: 'self', name: 'Charlie' },
      { control: 'agent', name: 'Copycat' },
    ]);
    expect(response.view.decision).toEqual(expect.objectContaining({
      seq: 3,
      seat: 0,
      kind: 'choose-option',
      min: 1,
      max: 1,
    }));
    expect(response.view.turnSeat).toBe(1);
  });

  it('rejects selections for a stale decision seq before contacting the bridge', async () => {
    const engine = new LocalEngineController() as any;
    let bridgeCalled = false;
    engine.sessionId = 'test-session';
    engine.decisionSeq = 5;
    engine.dataMaps = { cardData: {}, attacks: {} };
    engine.observation = { select: yesNoSelect(), logs: [], current: currentState() };
    engine.bridge = {
      request: async () => {
        bridgeCalled = true;
        throw new Error('stale decision should not reach the bridge');
      },
    };

    const response = await engine.handle({
      type: 'select',
      payload: { sessionId: 'test-session', seq: 4, indexes: [0] },
    });

    expect(response.ok).toBe(false);
    if (response.ok) return;
    expect(response.error).toBe('That decision is no longer current.');
    expect(bridgeCalled).toBe(false);
  });

  it('validates selection bounds against the engine select', async () => {
    const engine = new LocalEngineController() as any;
    engine.sessionId = 'test-session';
    engine.decisionSeq = 1;
    engine.dataMaps = { cardData: {}, attacks: {} };
    engine.observation = { select: yesNoSelect(), logs: [], current: currentState() };
    engine.bridge = { request: async () => ({ ok: true, observation: null }) };

    const empty = await engine.handle({
      type: 'select',
      payload: { sessionId: 'test-session', seq: 1, indexes: [] },
    });
    expect(empty.ok).toBe(false);
    if (!empty.ok) {
      expect(empty.error).toBe('Selection must contain 1-1 option(s).');
    }

    const outOfRange = await engine.handle({
      type: 'select',
      payload: { sessionId: 'test-session', seq: 1, indexes: [7] },
    });
    expect(outOfRange.ok).toBe(false);
    if (!outOfRange.ok) {
      expect(outOfRange.error).toBe('Decision option indexes are required.');
    }
  });

  it('applies a valid selection and advances the decision seq', async () => {
    const engine = new LocalEngineController() as any;
    const selections: number[][] = [];
    engine.sessionId = 'test-session';
    engine.decisionSeq = 1;
    engine.dataMaps = { cardData: {}, attacks: {} };
    engine.observation = { select: yesNoSelect(), logs: [], current: currentState() };
    engine.bridge = {
      request: async ({ selection }: { selection: number[] }) => {
        selections.push(selection);
        return {
          ok: true,
          observation: { select: yesNoSelect(), logs: [], current: currentState() },
        };
      },
    };

    const response = await engine.handle({
      type: 'select',
      payload: { sessionId: 'test-session', seq: 1, indexes: [1] },
    });

    expect(selections).toEqual([[1]]);
    expect(response.ok).toBe(true);
    if (!response.ok) return;
    expect(response.view.decision?.seq).toBe(2);
  });

  it('emits one playback step per observation, each carrying exactly its own events', () => {
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
    // The interactive view keeps the cumulative timeline for the log panel.
    expect(response.view.actionTimeline).toEqual([
      expect.objectContaining({ id: 1, message: 'Player 2 turn started.' }),
      expect.objectContaining({ id: 2, message: 'Player 2 ended their turn.' }),
    ]);
    // Steps are replay-shaped: per-step events, never cumulative.
    expect(response.sequence).toEqual([
      expect.objectContaining({
        actionTimeline: [expect.objectContaining({ id: 1, message: 'Player 2 turn started.' })],
      }),
      expect.objectContaining({
        actionTimeline: [expect.objectContaining({ id: 2, message: 'Player 2 ended their turn.' })],
      }),
    ]);
  });

  it('drives a complete Phantom Dive damage placement through select indexes', async () => {
    // Select shapes captured verbatim from the engine: six sequential
    // single-pick CARD selects over the opponent bench, remainDamageCounter
    // counting down 6..1.
    const engine = new LocalEngineController() as any;
    const bench = [675, 676, 677].map((id, index) => ({
      id, serial: 30 + index, playerIndex: 1, hp: 90, maxHp: 90, appearThisTurn: false,
      energies: [], energyCards: [], tools: [], preEvolution: [],
    }));
    const placementSelect = (remaining: number) => ({
      type: CabtSelectType.CARD,
      context: CabtSelectContext.DAMAGE_COUNTER_ANY,
      minCount: 1,
      maxCount: 1,
      remainDamageCounter: remaining,
      remainEnergyCost: 0,
      option: [0, 1, 2].map((index) => ({ type: CabtOptionType.CARD, area: CabtAreaType.BENCH, index, playerIndex: 1 })),
      deck: null,
      contextCard: null,
      effect: null,
    });
    const placementState = () => currentState({
      yourIndex: 0,
      players: [
        playerState({ hand: [], handCount: 0 }),
        playerState({ hand: null, handCount: 0, bench }),
      ],
    });

    let remaining = 6;
    const selections: number[][] = [];
    engine.sessionId = 'test-session';
    engine.playerControls = ['self', 'agent'];
    engine.decisionSeq = 1;
    engine.dataMaps = { cardData: {}, attacks: {} };
    engine.observation = { select: placementSelect(remaining), logs: [], current: placementState() };
    engine.bridge = {
      request: async ({ selection }: { selection: number[] }) => {
        selections.push(selection);
        remaining -= 1;
        return {
          ok: true,
          observation: {
            select: remaining > 0 ? placementSelect(remaining) : null,
            logs: [{ type: CabtLogType.HP_CHANGE, playerIndex: 1, cardId: bench[selection[0]].id, serial: bench[selection[0]].serial, value: -10 }],
            current: placementState(),
          },
        };
      },
    };

    // The placement projects as a click-the-board decision with progress.
    let view = engine.viewResponse().view;
    for (let counter = 6; counter >= 1; counter -= 1) {
      const decision = view.decision!;
      expect(decision.remaining).toBe(counter);
      expect(decision.remainingKind).toBe('damage');
      expect(decision.message).toBe('Put damage counters');
      expect(decision.min).toBe(1);
      expect(decision.max).toBe(1);
      expect(decision.options.map((option) => option.board)).toEqual([
        { ownerIndex: 1, slot: 'bench', index: 0 },
        { ownerIndex: 1, slot: 'bench', index: 1 },
        { ownerIndex: 1, slot: 'bench', index: 2 },
      ]);
      const response = await engine.handle({
        type: 'select',
        payload: { sessionId: 'test-session', seq: decision.seq, indexes: [counter % 3] },
      });
      expect(response.ok).toBe(true);
      if (!response.ok) return;
      view = response.view;
    }
    expect(selections).toEqual([[0], [2], [1], [0], [2], [1]]);
    expect(view.decision).toBeUndefined();
  });

  it('animates a knock-out against a view where the dying Pokemon still exists', () => {
    const engine = new LocalEngineController() as any;
    const dyingHariyama = {
      id: 700, serial: 5, playerIndex: 1, hp: 0, maxHp: 150, appearThisTurn: false,
      energies: [6], energyCards: [{ id: 4, serial: 60, playerIndex: 1 }], tools: [],
      preEvolution: [{ id: 699, serial: 4, playerIndex: 1 }],
    };
    const benchedTwin = {
      id: 700, serial: 6, playerIndex: 1, hp: 150, maxHp: 150, appearThisTurn: false,
      energies: [], energyCards: [], tools: [], preEvolution: [],
    };
    // The observation BEFORE the attack still has the dying active in place.
    engine.applyBridgeResponse({
      ok: true,
      id: 1,
      observation: {
        select: null,
        logs: [],
        current: currentState({
          yourIndex: 0,
          players: [
            playerState({ hand: [], handCount: 0 }),
            playerState({ hand: null, handCount: 0, active: [dyingHariyama], bench: [benchedTwin] }),
          ],
        }),
      },
      autoSteps: [],
    });
    engine.viewResponse();

    // The KO observation: active gone, same-name twin still benched, and the
    // full cleanup + prize take in one log batch (real engine shape).
    engine.applyBridgeResponse({
      ok: true,
      id: 2,
      observation: {
        select: null,
        logs: [
          { type: CabtLogType.ATTACK, playerIndex: 0, cardId: 42, serial: 1, attackId: 9 },
          { type: CabtLogType.HP_CHANGE, playerIndex: 1, cardId: 700, serial: 5, value: -150 },
          { type: CabtLogType.MOVE_CARD, playerIndex: 1, cardId: 700, serial: 5, fromArea: CabtAreaType.ACTIVE, toArea: CabtAreaType.DISCARD },
          { type: CabtLogType.MOVE_CARD, playerIndex: 1, cardId: 699, serial: 4, fromArea: CabtAreaType.PRE_EVOLUTION, toArea: CabtAreaType.DISCARD },
          { type: CabtLogType.MOVE_CARD, playerIndex: 1, cardId: 4, serial: 60, fromArea: CabtAreaType.ENERGY, toArea: CabtAreaType.DISCARD },
          { type: CabtLogType.MOVE_CARD, playerIndex: 0, cardId: 55, serial: 70, fromArea: CabtAreaType.PRIZE, toArea: CabtAreaType.HAND },
        ],
        current: currentState({
          yourIndex: 0,
          players: [
            playerState({ hand: [{ id: 55, serial: 70, playerIndex: 0 }], handCount: 1 }),
            playerState({ hand: null, handCount: 0, active: [null], bench: [benchedTwin] }),
          ],
        }),
      },
      autoSteps: [],
    });

    const response = engine.viewResponse();
    expect(response.ok).toBe(true);
    if (!response.ok) return;
    expect(response.sequence).toHaveLength(2);
    const [departure, aftermath] = response.sequence!;
    // The departure beat carries the attack through the discard cleanup, and
    // its view restores the dying instance (serial 5) — the benched twin
    // (serial 6) is untouched, so the fall can never anchor to it.
    expect(departure.actionTimeline?.map((event) => event.kind)).toEqual([
      'Attack', 'HPChange', 'MoveCard', 'MoveCard', 'MoveCard',
    ]);
    expect(departure.players[1].active.pokemon?.serial).toBe(5);
    expect(departure.players[1].active.energy.map((card) => card.serial)).toEqual([60]);
    expect(departure.players[1].bench[0]?.pokemon?.serial).toBe(6);
    // The aftermath beat shows the true empty active while the prize lands.
    expect(aftermath.actionTimeline?.map((event) => event.kind)).toEqual(['MoveCard']);
    expect(aftermath.players[1].active.empty).toBe(true);
  });

  it('splits a play-that-draws into a pre-draw beat and the deal', () => {
    const engine = new LocalEngineController() as any;
    const hand = [
      { id: 5, serial: 40, playerIndex: 0 },
      { id: 6, serial: 41, playerIndex: 0 },
      { id: 7, serial: 42, playerIndex: 0 },
    ];
    const current = currentState({
      players: [
        playerState({ hand, handCount: 3, deckCount: 30 }),
        playerState({ hand: null, handCount: 0 }),
      ],
    });

    engine.applyBridgeResponse({
      ok: true,
      id: 1,
      observation: {
        select: null,
        logs: [
          { type: CabtLogType.PLAY, playerIndex: 0, cardId: 1227, serial: 25 },
          { type: CabtLogType.MOVE_CARD, playerIndex: 0, cardId: 8, serial: 9, fromArea: CabtAreaType.HAND, toArea: CabtAreaType.DECK },
          { type: CabtLogType.SHUFFLE, playerIndex: 0 },
          { type: CabtLogType.DRAW, playerIndex: 0, cardId: 5, serial: 40 },
          { type: CabtLogType.DRAW, playerIndex: 0, cardId: 6, serial: 41 },
          { type: CabtLogType.DRAW, playerIndex: 0, cardId: 7, serial: 42 },
        ],
        current,
      },
      autoSteps: [],
    });

    const response = engine.viewResponse();
    expect(response.ok).toBe(true);
    if (!response.ok) return;
    expect(response.sequence).toHaveLength(2);
    const [cause, deal] = response.sequence!;
    // The cause beat animates against a hand that does not yet contain the
    // incoming cards, with the deck still holding them.
    expect(cause.actionTimeline?.map((event) => event.kind)).toEqual(['Play', 'MoveCard', 'Shuffle']);
    expect(cause.players[0].hand).toHaveLength(0);
    expect(cause.players[0].deckCount).toBe(33);
    // The deal beat carries exactly the draws against the real hand.
    expect(deal.actionTimeline?.map((event) => event.kind)).toEqual(['Draw', 'Draw', 'Draw']);
    expect(deal.players[0].hand.map((card) => card.serial)).toEqual([40, 41, 42]);
    expect(deal.players[0].deckCount).toBe(30);
  });

  it('drops re-delivered logs when the actor switches, so nothing re-animates', () => {
    const engine = new LocalEngineController() as any;
    const turnLogs = [
      { type: CabtLogType.TURN_START, playerIndex: 0 },
      { type: CabtLogType.TURN_END, playerIndex: 0 },
    ];

    engine.applyBridgeResponse({
      ok: true,
      id: 1,
      observation: { select: null, logs: turnLogs, current: currentState({ yourIndex: 0 }) },
      autoSteps: [],
    });
    // The other seat's first observation re-delivers the whole turn.
    engine.applyBridgeResponse({
      ok: true,
      id: 2,
      observation: {
        select: null,
        logs: [...turnLogs, { type: CabtLogType.TURN_START, playerIndex: 1 }],
        current: currentState({ yourIndex: 1 }),
      },
      autoSteps: [],
    });

    const response = engine.viewResponse();
    expect(response.ok).toBe(true);
    if (!response.ok) return;
    expect(response.sequence).toHaveLength(2);
    expect(response.sequence?.[1]?.actionTimeline).toEqual([
      expect.objectContaining({ message: 'Player 2 turn started.' }),
    ]);
    expect(response.view.actionTimeline).toHaveLength(3);
  });

  it('emits decision-free playback steps and skips event-less decision frames', () => {
    const engine = new LocalEngineController() as any;

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
          // A decision point with fresh events: the step animates the events
          // but never renders the deciding seat's prompt.
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
          logs: [{ type: CabtLogType.TURN_START, playerIndex: 1 }],
          current: currentState({ yourIndex: 1 }),
        },
        {
          // No new events: nothing to show, no step.
          select: null,
          logs: [{ type: CabtLogType.TURN_START, playerIndex: 1 }],
          current: currentState({ yourIndex: 0 }),
        },
      ],
    });

    const response = engine.viewResponse();
    expect(response.ok).toBe(true);
    if (!response.ok) return;
    expect(response.sequence).toHaveLength(1);
    expect(response.sequence?.[0]?.decision).toBeUndefined();
    expect(response.sequence?.[0]?.actionTimeline).toEqual([
      expect.objectContaining({ message: 'Player 2 turn started.' }),
    ]);
  });

});

function yesNoSelect() {
  return {
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
  };
}

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
