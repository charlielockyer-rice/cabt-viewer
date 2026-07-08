// @vitest-environment happy-dom
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocalEngineController } from './engine/localEngine';
import { CabtAreaType, CabtLogType, CabtOptionType, CabtSelectContext, CabtSelectType } from './lib/cabt/types';
import { localGameApi } from './lib/game/httpClient';
import { gameStore } from './state/game.svelte';
import { viewSettingsStore } from './state/viewSettings.svelte';

// The catalog fetches agent/log manifests on mount; the board under test
// does not need them.
vi.mock('./lib/home/catalog', () => ({
  loadAgentOptions: async () => [],
  loadGameLogs: async () => [],
}));

import App from './App.svelte';

// DOM-level guarantee for the damage counter placement path: index-level
// select tests cannot catch a dead click handler, a missing highlight, or a
// decision that never reaches the board components. This mounts the real App
// against the captured Phantom Dive engine shapes and clicks the actual
// bench slot buttons.
describe('App board click path (happy-dom)', () => {
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

  it('drives damage counter placement by clicking real bench slot buttons', async () => {
    // Select shapes captured verbatim from the engine (same fixture as the
    // localEngine placement test): six sequential single-pick CARD selects
    // over the opponent bench, remainDamageCounter counting down 6..1.
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
    const placementState = () => ({
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
        playerState({ hand: null, handCount: 0, bench }),
      ],
    });

    let remaining = 6;
    const bridgeSelections: number[][] = [];
    engine.sessionId = 'test-session';
    engine.playerControls = ['self', 'agent'];
    engine.decisionSeq = 1;
    engine.dataMaps = { cardData: {}, attacks: {} };
    engine.observation = { select: placementSelect(remaining), logs: [], current: placementState() };
    engine.bridge = {
      request: async ({ selection }: { selection: number[] }) => {
        bridgeSelections.push(selection);
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

    // The spy stands in for the HTTP hop only; every select still flows
    // through the real controller, projection, and decision seq machinery.
    const selectSpy = vi.spyOn(localGameApi, 'select').mockImplementation(
      (seq: number, indexes: number[]) => engine.handle({
        type: 'select',
        payload: { sessionId: 'test-session', seq, indexes },
      }),
    );

    const initial = engine.viewResponse();
    expect(initial.ok).toBe(true);
    gameStore.game = initial.view;
    gameStore.decision = initial.view.decision;
    const firstSeq = initial.view.decision!.seq;

    viewSettingsStore.animateActions = true;
    viewSettingsStore.actionStepDelayMs = 200;

    app = mount(App, { target: document.body });
    flushSync();

    // The opponent bench renders as clickable, highlighted targets and the
    // effect banner is up.
    const slotButton = (index: number) => {
      const element = document.querySelector<HTMLButtonElement>(`[data-testid="slot-1-bench-${index}"]`);
      expect(element, `bench slot ${index} should render`).toBeTruthy();
      return element!;
    };
    expect(slotButton(0).classList.contains('prompt-selectable')).toBe(true);
    expect(slotButton(1).classList.contains('prompt-selectable')).toBe(true);
    expect(slotButton(2).classList.contains('prompt-selectable')).toBe(true);
    expect(document.querySelector('.effect-selector-banner')).toBeTruthy();

    // Real click on bench slot 1 issues the select for the current seq with
    // the engine option index.
    slotButton(1).click();
    flushSync();
    await vi.waitFor(() => expect(selectSpy).toHaveBeenCalledTimes(1));
    expect(selectSpy.mock.calls[0]).toEqual([firstSeq, [1]]);

    // The next decision is live while the previous counter's step is still
    // playing back — targets stay highlighted and clickable.
    await vi.waitFor(() => {
      flushSync();
      expect(gameStore.decision?.remaining).toBe(5);
    });
    await vi.waitFor(() => {
      flushSync();
      expect(gameStore.playingSequence).toBe(true);
    });
    flushSync();
    expect(slotButton(2).classList.contains('prompt-selectable')).toBe(true);
    slotButton(2).click();
    flushSync();
    await vi.waitFor(() => expect(selectSpy).toHaveBeenCalledTimes(2));
    expect(selectSpy.mock.calls[1]).toEqual([firstSeq + 1, [2]]);
    expect(bridgeSelections).toEqual([[1], [2]]);

    // The picked slots wear their chips.
    await vi.waitFor(() => {
      flushSync();
      expect(document.querySelectorAll('[data-testid="slot-1-bench-1"] .pick-chip').length).toBe(1);
      expect(document.querySelectorAll('[data-testid="slot-1-bench-2"] .pick-chip').length).toBe(1);
    });

    // Finish the run with real clicks: 4 more counters. Each click waits for
    // its decision to be current (a click against a stale seq is dropped by
    // design), but never for playback to finish.
    let expectedRemaining = 4;
    for (const pick of [0, 0, 1, 2]) {
      await vi.waitFor(() => {
        flushSync();
        expect(gameStore.decision?.remaining).toBe(expectedRemaining);
        expect(gameStore.busy).toBe(false);
        expect(slotButton(pick).classList.contains('prompt-selectable')).toBe(true);
      }, { timeout: 5000 });
      slotButton(pick).click();
      flushSync();
      expectedRemaining -= 1;
    }
    await vi.waitFor(() => expect(selectSpy).toHaveBeenCalledTimes(6), { timeout: 5000 });
    expect(bridgeSelections).toEqual([[1], [2], [0], [0], [1], [2]]);
    await vi.waitFor(() => {
      flushSync();
      expect(gameStore.decision).toBeUndefined();
    }, { timeout: 5000 });
  });
});

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
