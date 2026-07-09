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

  it('splits an attack-ends-turn batch so the opponent start-of-turn draw is its own beat (Task 5)', () => {
    // Real shape from Kaggle ep84924975 frame 26 (Itchy Pollen): one observation
    // carries [Attack, HPChange, TurnEnd, TurnStart, Draw]. The new turn's draw
    // must NOT animate inside the attacker's step — it belongs to a beat after
    // the turn transition, with the pre-draw hand.
    const engine = new LocalEngineController() as any;
    const preState = currentState({
      turn: 3,
      yourIndex: 1,
      players: [
        playerState({ hand: [{ id: 50, serial: 100 }], handCount: 1, deckCount: 40, active: [{ id: 10, serial: 5, hp: 100, maxHp: 100 }] }),
        playerState({ hand: null, handCount: 4, active: [{ id: 20, serial: 6, hp: 70, maxHp: 70 }] }),
      ],
    });
    const endState = currentState({
      turn: 4,
      yourIndex: 0,
      players: [
        playerState({ hand: [{ id: 50, serial: 100 }, { id: 60, serial: 200 }], handCount: 2, deckCount: 39, active: [{ id: 10, serial: 5, hp: 80, maxHp: 100 }] }),
        playerState({ hand: null, handCount: 4, active: [{ id: 20, serial: 6, hp: 70, maxHp: 70 }] }),
      ],
    });
    engine.observation = { select: null, logs: [], current: preState };
    engine.dataMaps = { cardData: {}, attacks: {} };

    engine.applyBridgeResponse({
      ok: true,
      id: 1,
      observation: {
        select: null,
        logs: [
          { type: CabtLogType.ATTACK, playerIndex: 1, cardId: 20, serial: 6, attackId: 323 },
          { type: CabtLogType.HP_CHANGE, playerIndex: 0, cardId: 10, serial: 5, value: -20 },
          { type: CabtLogType.TURN_END, playerIndex: 1 },
          { type: CabtLogType.TURN_START, playerIndex: 0 },
          { type: CabtLogType.DRAW, playerIndex: 0, cardId: 60, serial: 200 },
        ],
        current: endState,
      },
    });

    const response = engine.viewResponse();
    expect(response.ok).toBe(true);
    if (!response.ok || !response.sequence) return;

    const handSerials = (view: any) => (view.players[0].hand ?? []).map((card: any) => card.serial);
    const isDrawBeat = (view: any) => (view.actionTimeline ?? []).some((event: any) => event.kind === 'Draw');
    const drawBeatIndex = response.sequence.findIndex(isDrawBeat);

    // The draw animates in its own beat, and that beat's hand holds the drawn card.
    expect(drawBeatIndex).toBeGreaterThan(0);
    expect(handSerials(response.sequence[drawBeatIndex])).toContain(200);
    // No earlier beat (the attack/damage) may carry the draw event or the drawn card.
    for (let index = 0; index < drawBeatIndex; index += 1) {
      const view = response.sequence[index];
      expect(isDrawBeat(view)).toBe(false);
      expect(handSerials(view)).not.toContain(200);
    }

    // The substantive fix: the pre-transition beats keep the ATTACKER's
    // perspective (player 2's turn), and the seat only flips to the drawing
    // player on the new turn's draw beat — the draw never renders in the
    // already-switched perspective inside the attacker's step.
    const attackBeatIndex = response.sequence.findIndex((view: any) =>
      (view.actionTimeline ?? []).some((event: any) => event.kind === 'Attack'));
    expect(attackBeatIndex).toBeGreaterThanOrEqual(0);
    expect(attackBeatIndex).toBeLessThan(drawBeatIndex);
    expect(response.sequence[attackBeatIndex].activePlayerIndex).toBe(1);
    expect(response.sequence[attackBeatIndex].turn).toBe(3);
    expect(response.sequence[drawBeatIndex].activePlayerIndex).toBe(0);
    expect(response.sequence[drawBeatIndex].turn).toBe(4);
  });

  it('splits a KO-promotion-plus-turn-boundary batch so promotion and draw are distinct beats (Task 7)', () => {
    // Real shape from ep84924975 frame 95: after a KO and prize take (earlier
    // frames), one observation carries [MoveCard BENCH->ACTIVE (promotion),
    // TurnEnd, TurnStart, Draw]. The promotion is its own beat in the acting
    // turn; the new turn's draw is a separate beat after the transition.
    const engine = new LocalEngineController() as any;
    const preState = currentState({
      turn: 3,
      yourIndex: 1,
      players: [
        playerState({ hand: [{ id: 50, serial: 100 }], handCount: 1, deckCount: 40, active: [null], bench: [{ id: 30, serial: 30, hp: 90, maxHp: 90 }] }),
        playerState({ hand: null, handCount: 4, active: [{ id: 20, serial: 6, hp: 70, maxHp: 70 }] }),
      ],
    });
    const endState = currentState({
      turn: 4,
      yourIndex: 0,
      players: [
        playerState({ hand: [{ id: 50, serial: 100 }, { id: 60, serial: 200 }], handCount: 2, deckCount: 39, active: [{ id: 30, serial: 30, hp: 90, maxHp: 90 }], bench: [] }),
        playerState({ hand: null, handCount: 4, active: [{ id: 20, serial: 6, hp: 70, maxHp: 70 }] }),
      ],
    });
    engine.observation = { select: null, logs: [], current: preState };
    engine.dataMaps = { cardData: {}, attacks: {} };

    engine.applyBridgeResponse({
      ok: true,
      id: 1,
      observation: {
        select: null,
        logs: [
          { type: CabtLogType.MOVE_CARD, playerIndex: 0, cardId: 30, serial: 30, fromArea: CabtAreaType.BENCH, toArea: CabtAreaType.ACTIVE },
          { type: CabtLogType.TURN_END, playerIndex: 1 },
          { type: CabtLogType.TURN_START, playerIndex: 0 },
          { type: CabtLogType.DRAW, playerIndex: 0, cardId: 60, serial: 200 },
        ],
        current: endState,
      },
    });

    const response = engine.viewResponse();
    expect(response.ok).toBe(true);
    if (!response.ok || !response.sequence) return;

    const drawBeatIndex = response.sequence.findIndex((view: any) =>
      (view.actionTimeline ?? []).some((event: any) => event.kind === 'Draw'));
    const promoBeatIndex = response.sequence.findIndex((view: any) =>
      (view.actionTimeline ?? []).some((event: any) =>
        event.kind === 'MoveCard' && Number((event.params ?? {}).toArea) === CabtAreaType.ACTIVE));

    expect(promoBeatIndex).toBeGreaterThanOrEqual(0);
    expect(drawBeatIndex).toBeGreaterThan(promoBeatIndex);
    // Promotion animates in the acting turn's perspective; the draw is the new turn.
    expect(response.sequence[promoBeatIndex].activePlayerIndex).toBe(1);
    expect(response.sequence[promoBeatIndex].turn).toBe(3);
    expect(response.sequence[drawBeatIndex].activePlayerIndex).toBe(0);
    expect(response.sequence[drawBeatIndex].turn).toBe(4);
    // The promotion beat does not carry the new turn's drawn card.
    expect((response.sequence[promoBeatIndex].players[0].hand ?? []).map((card: any) => card.serial)).not.toContain(200);
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
    const steps = response.sequence!;
    // The phases partition the batch: every event appears exactly once, in
    // order.
    const kinds = steps.flatMap((step) => step.actionTimeline?.map((event) => event.kind) ?? []);
    expect(kinds).toEqual(['Attack', 'HPChange', 'MoveCard', 'MoveCard', 'MoveCard', 'MoveCard']);
    // Every beat up to and including the knock-out still shows the dying
    // instance (serial 5) in its slot — the benched twin (serial 6) can
    // never stand in as the fall's anchor.
    const knockOutIndex = steps.findIndex((step) => step.actionTimeline?.some((event) => {
      const params = event.params as Record<string, unknown> | undefined;
      return event.kind === 'MoveCard' && Number(params?.serial) === 5;
    }));
    expect(knockOutIndex).toBeGreaterThanOrEqual(0);
    for (let index = 0; index <= knockOutIndex; index += 1) {
      expect(steps[index].players[1].active.pokemon?.serial, `beat ${index} keeps the dying active`).toBe(5);
      expect(steps[index].players[1].bench[0]?.pokemon?.serial).toBe(6);
    }
    // The knock-out beat still shows the attachments that fall with it.
    expect(steps[knockOutIndex].players[1].active.energy.map((card) => card.serial)).toEqual([60]);
    // After the departure, the active is truly empty while the prize lands.
    const last = steps.at(-1)!;
    expect(last.players[1].active.empty).toBe(true);
    expect(last.players[1].bench[0]?.pokemon?.serial).toBe(6);
  });

  it('plays a draw effect as phase beats: cause, shuffle-in, then the deal', () => {
    const engine = new LocalEngineController() as any;
    // Before the play: Lillie's (serial 25) and one other card in hand.
    engine.applyBridgeResponse({
      ok: true,
      id: 1,
      observation: {
        select: null,
        logs: [],
        current: currentState({
          players: [
            playerState({
              hand: [
                { id: 1227, serial: 25, playerIndex: 0 },
                { id: 8, serial: 9, playerIndex: 0 },
              ],
              handCount: 2,
              deckCount: 32,
            }),
            playerState({ hand: null, handCount: 0 }),
          ],
        }),
      },
      autoSteps: [],
    });
    engine.viewResponse();

    const hand = [
      { id: 5, serial: 40, playerIndex: 0 },
      { id: 6, serial: 41, playerIndex: 0 },
      { id: 7, serial: 42, playerIndex: 0 },
    ];
    engine.applyBridgeResponse({
      ok: true,
      id: 2,
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
        current: currentState({
          players: [
            playerState({ hand, handCount: 3, deckCount: 30 }),
            playerState({ hand: null, handCount: 0 }),
          ],
        }),
      },
      autoSteps: [],
    });

    const response = engine.viewResponse();
    expect(response.ok).toBe(true);
    if (!response.ok) return;
    const steps = response.sequence!;
    const kinds = steps.flatMap((step) => step.actionTimeline?.map((event) => event.kind) ?? []);
    expect(kinds).toEqual(['Play', 'MoveCard', 'Shuffle', 'Draw', 'Draw', 'Draw']);
    // No beat before the deal may show a drawn card in hand.
    const dealIndex = steps.findIndex((step) => step.actionTimeline?.some((event) => event.kind === 'Draw'));
    expect(dealIndex).toBeGreaterThan(0);
    for (let index = 0; index < dealIndex; index += 1) {
      const serials = steps[index].players[0].hand.map((card) => card.serial);
      expect(serials, `beat ${index} must not contain drawn cards`).not.toContain(40);
      expect(serials).not.toContain(41);
      expect(serials).not.toContain(42);
    }
    // The deal beat carries exactly the draws against the real hand.
    const deal = steps[dealIndex];
    expect(deal.players[0].hand.map((card) => card.serial)).toEqual([40, 41, 42]);
    expect(deal.players[0].deckCount).toBe(30);
  });

  it('deals the OPPONENT of a concealed draw effect as beats, never an instant hand', () => {
    const engine = new LocalEngineController() as any;
    // Viewer is seat 0; the opponent (seat 1) plays Unfair Stamp-style:
    // their 5 concealed cards shuffle into the deck, then they draw 2. The
    // viewer's stream carries only reversed (count) events.
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
            playerState({ hand: null, handCount: 5, deckCount: 30 }),
          ],
        }),
      },
      autoSteps: [],
    });
    engine.viewResponse();

    engine.applyBridgeResponse({
      ok: true,
      id: 2,
      observation: {
        select: null,
        logs: [
          { type: CabtLogType.PLAY, playerIndex: 1, cardId: 900 },
          ...Array.from({ length: 5 }, () => (
            { type: CabtLogType.MOVE_CARD_REVERSE, playerIndex: 1, fromArea: CabtAreaType.HAND, toArea: CabtAreaType.DECK }
          )),
          { type: CabtLogType.SHUFFLE, playerIndex: 1 },
          { type: CabtLogType.DRAW_REVERSE, playerIndex: 1 },
          { type: CabtLogType.DRAW_REVERSE, playerIndex: 1 },
        ],
        current: currentState({
          yourIndex: 0,
          players: [
            playerState({ hand: [], handCount: 0 }),
            playerState({ hand: null, handCount: 2, deckCount: 33 }),
          ],
        }),
      },
      autoSteps: [],
    });

    const response = engine.viewResponse();
    expect(response.ok).toBe(true);
    if (!response.ok) return;
    const steps = response.sequence!;
    expect(steps.length).toBeGreaterThan(1);
    // No beat before the deal may already show the post-draw hand of 2 —
    // the "instant hand" symptom. The shuffle-in beats walk the count down.
    const dealIndex = steps.findIndex((step) => step.actionTimeline?.some((event) => event.kind === 'Draw' || event.kind === 'DrawReverse'));
    expect(dealIndex).toBeGreaterThan(0);
    // The play beat shows the post-play hand (4 concealed cards — the leaving
    // card animates via claims); the shuffle-in walks it down to 0.
    expect(steps[0].players[1].hand.length).toBe(4);
    let previousCount = 4;
    for (let index = 1; index < dealIndex; index += 1) {
      const count = steps[index].players[1].hand.length;
      expect(count, `beat ${index} hand size never grows before the deal`).toBeLessThanOrEqual(previousCount);
      previousCount = count;
    }
    expect(steps[dealIndex - 1].players[1].hand.length).toBe(0);
    // The deal beat lands the 2 concealed cards.
    expect(steps[dealIndex].players[1].hand.length).toBe(2);
  });

  it('animates a retreat against the pre-swap board, never the post-swap one', () => {
    const engine = new LocalEngineController() as any;
    const activeA = {
      id: 700, serial: 1, playerIndex: 0, hp: 120, maxHp: 120, appearThisTurn: false,
      energies: [], energyCards: [], tools: [], preEvolution: [],
    };
    const benchB = {
      id: 701, serial: 2, playerIndex: 0, hp: 90, maxHp: 90, appearThisTurn: false,
      energies: [], energyCards: [], tools: [], preEvolution: [],
    };
    engine.applyBridgeResponse({
      ok: true,
      id: 1,
      observation: {
        select: null,
        logs: [],
        current: currentState({
          players: [
            playerState({ hand: [], handCount: 0, active: [activeA], bench: [benchB] }),
            playerState({ hand: null, handCount: 0 }),
          ],
        }),
      },
      autoSteps: [],
    });
    engine.viewResponse();

    engine.applyBridgeResponse({
      ok: true,
      id: 2,
      observation: {
        select: null,
        logs: [
          { type: CabtLogType.MOVE_CARD, playerIndex: 0, cardId: 700, serial: 1, fromArea: CabtAreaType.ACTIVE, toArea: CabtAreaType.BENCH },
          { type: CabtLogType.MOVE_CARD, playerIndex: 0, cardId: 701, serial: 2, fromArea: CabtAreaType.BENCH, toArea: CabtAreaType.ACTIVE },
        ],
        current: currentState({
          players: [
            playerState({ hand: [], handCount: 0, active: [benchB], bench: [activeA] }),
            playerState({ hand: null, handCount: 0 }),
          ],
        }),
      },
      autoSteps: [],
    });

    const response = engine.viewResponse();
    expect(response.ok).toBe(true);
    if (!response.ok) return;
    const steps = response.sequence!;
    // The swap beat's view still shows the PRE-swap board: the retreating
    // Pokemon at active, the incoming one on the bench — so the crossing
    // motion reads forward, not reversed.
    const swapBeat = steps.find((step) => step.actionTimeline?.some((event) => event.kind === 'MoveCard'));
    expect(swapBeat).toBeTruthy();
    expect(swapBeat!.players[0].active.pokemon?.serial).toBe(1);
    expect(swapBeat!.players[0].bench[0]?.pokemon?.serial).toBe(2);
    // The final view lands the true post-swap board.
    expect(response.view.players[0].active.pokemon?.serial).toBe(2);
    expect(response.view.players[0].bench[0]?.pokemon?.serial).toBe(1);
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
