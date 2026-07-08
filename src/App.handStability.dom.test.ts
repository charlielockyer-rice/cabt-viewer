// @vitest-environment happy-dom
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocalEngineController } from './engine/localEngine';
import { CabtAreaType, CabtLogType, CabtSelectContext, CabtSelectType, CabtOptionType } from './lib/cabt/types';
import { localGameApi } from './lib/game/httpClient';
import { gameStore } from './state/game.svelte';
import { viewSettingsStore } from './state/viewSettings.svelte';

vi.mock('./lib/home/catalog', () => ({
  loadAgentOptions: async () => [],
  loadGameLogs: async () => [],
}));

import App from './App.svelte';

// Render stability of hands and piles across playback view swaps: a card
// whose DOM node survives keeps its <img> (no refetch, no white flash). A
// remount of an unchanged card is a bug.
describe('hand and pile render stability (happy-dom)', () => {
  let app: Record<string, unknown> | undefined;

  afterEach(() => {
    if (app) {
      unmount(app);
      app = undefined;
    }
    gameStore.reset();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('keeps untouched hand cards and the covered discard top mounted through a play', async () => {
    const engine = new LocalEngineController() as any;
    const hand = [
      { id: 5, serial: 40, playerIndex: 0 },
      { id: 6, serial: 41, playerIndex: 0 },
      { id: 7, serial: 42, playerIndex: 0 },
    ];
    const baseState = (extra: Record<string, unknown>, discard: unknown[] = [{ id: 30, serial: 90, playerIndex: 0 }]) => ({
      turn: 2,
      turnActionCount: 0,
      yourIndex: 0,
      firstPlayer: 0,
      supporterPlayed: false,
      stadiumPlayed: false,
      energyAttached: false,
      retreated: false,
      result: -1,
      stadium: [],
      looking: null,
      players: [
        {
          active: [null], bench: [], benchMax: 5, deckCount: 30, discard, prize: [],
          poisoned: false, burned: false, asleep: false, paralyzed: false, confused: false,
          ...extra,
        },
        {
          active: [null], bench: [], benchMax: 5, deckCount: 30, discard: [], prize: [],
          handCount: 0, hand: null,
          poisoned: false, burned: false, asleep: false, paralyzed: false, confused: false,
        },
      ],
    });

    engine.sessionId = 'test-session';
    engine.playerControls = ['self', 'agent'];
    engine.decisionSeq = 1;
    engine.dataMaps = { cardData: {}, attacks: {} };
    engine.observation = {
      select: {
        type: CabtSelectType.MAIN,
        context: 0,
        minCount: 1,
        maxCount: 1,
        remainDamageCounter: 0,
        remainEnergyCost: 0,
        option: [{ type: CabtOptionType.PLAY, area: CabtAreaType.HAND, index: 0 }, { type: CabtOptionType.END }],
        deck: null,
        contextCard: null,
        effect: null,
      },
      logs: [],
      current: baseState({ hand, handCount: 3 }),
    };
    // The play: hand card serial 40 goes to the discard (trainer resolve).
    engine.bridge = {
      request: async () => ({
        ok: true,
        observation: {
          select: null,
          logs: [
            { type: CabtLogType.PLAY, playerIndex: 0, cardId: 5, serial: 40 },
            { type: CabtLogType.MOVE_CARD, playerIndex: 0, cardId: 5, serial: 40, fromArea: CabtAreaType.HAND, toArea: CabtAreaType.DISCARD },
          ],
          current: baseState(
            { hand: hand.slice(1), handCount: 2 },
            [{ id: 30, serial: 90, playerIndex: 0 }, { id: 5, serial: 40, playerIndex: 0 }],
          ),
        },
      }),
    };
    vi.spyOn(localGameApi, 'select').mockImplementation(
      (seq: number, indexes: number[]) => engine.handle({
        type: 'select',
        payload: { sessionId: 'test-session', seq, indexes },
      }),
    );

    const initial = engine.viewResponse();
    gameStore.game = initial.view;
    gameStore.decision = initial.view.decision;
    viewSettingsStore.animateActions = true;
    viewSettingsStore.actionStepDelayMs = 120;

    app = mount(App, { target: document.body });
    flushSync();

    const handElement = document.querySelector('[data-card-anchor="player:0:hand"]')!;
    expect(handElement).toBeTruthy();
    const untouchedBefore = [41, 42].map((serial) =>
      handElement.querySelector(`[data-card-serial="${serial}"]`));
    expect(untouchedBefore.every(Boolean)).toBe(true);
    const discardAnchor = document.querySelector('[data-card-anchor="player:0:discard"]')!;
    const coveredTopBefore = discardAnchor.querySelector('[data-card-id="30"], [data-card-serial="90"]');
    expect(coveredTopBefore).toBeTruthy();

    // Play the trainer via the engine and let every playback step land.
    const response = await (localGameApi.select as any)(initial.view.decision!.seq, [0]);
    await gameStore.apply(response);
    flushSync();

    // Untouched hand cards kept their DOM nodes: no remount, no img refetch.
    for (const [position, serial] of [[0, 41], [1, 42]] as const) {
      const after = handElement.querySelector(`[data-card-serial="${serial}"]`);
      expect(after, `card ${serial} still mounted`).toBeTruthy();
      expect(after, `card ${serial} kept its node identity`).toBe(untouchedBefore[position]);
    }
    // The covered discard top (serial 90) is still mounted UNDER the new top.
    const coveredTopAfter = discardAnchor.querySelector('[data-card-id="30"], [data-card-serial="90"]');
    expect(coveredTopAfter, 'covered discard top stays visible').toBeTruthy();
    expect(coveredTopAfter, 'covered discard top kept its node').toBe(coveredTopBefore);
    expect(discardAnchor.querySelector('[data-card-serial="40"]'), 'new top mounted').toBeTruthy();
  });
});
