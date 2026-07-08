// @vitest-environment happy-dom
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocalEngineController } from './engine/localEngine';
import { CabtAreaType, CabtLogType, CabtOptionType, CabtSelectContext, CabtSelectType } from './lib/cabt/types';
import { localGameApi } from './lib/game/httpClient';
import { gameStore } from './state/game.svelte';
import { viewSettingsStore } from './state/viewSettings.svelte';

vi.mock('./lib/home/catalog', () => ({
  loadAgentOptions: async () => [],
  loadGameLogs: async () => [],
}));

import App from './App.svelte';

// Clickability of a decision-target slot must be STABLE: while a decision is
// live and animations are idle, nothing may mutate a slot's classes,
// visibility attributes, or DOM node identity — any churn there presents to
// the player as cursor/highlight flicker (found during the 2026-07-08
// flicker investigation; this pins the reactive layer down permanently).
describe('board slot clickability stability (happy-dom)', () => {
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

  it('keeps decision-target slots untouched at idle and during playback of another pick', async () => {
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
    engine.sessionId = 'test-session';
    engine.playerControls = ['self', 'agent'];
    engine.decisionSeq = 1;
    engine.dataMaps = { cardData: {}, attacks: {} };
    engine.observation = { select: placementSelect(remaining), logs: [], current: placementState() };
    engine.bridge = {
      request: async ({ selection }: { selection: number[] }) => {
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
    viewSettingsStore.actionStepDelayMs = 150;

    app = mount(App, { target: document.body });
    flushSync();

    const playmat = document.querySelector('.playmat')!;
    const slot = (index: number) => document.querySelector<HTMLButtonElement>(`[data-testid="slot-1-bench-${index}"]`)!;
    const watchedIdentity = [slot(0), slot(1), slot(2)];

    const mutations: Array<{ target: string; detail: string }> = [];
    const describeNode = (node: Node) => node instanceof HTMLElement
      ? node.getAttribute('data-testid') ?? `${node.tagName.toLowerCase()}.${String(node.className).split(' ').slice(0, 2).join('.')}`
      : node.nodeName;
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        mutations.push({
          target: describeNode(record.target),
          detail: record.type === 'attributes'
            ? `${record.attributeName}: ${record.oldValue} -> ${(record.target as HTMLElement).getAttribute(record.attributeName!)}`
            : `children +${[...record.addedNodes].map(describeNode).join(',')} -${[...record.removedNodes].map(describeNode).join(',')}`,
        });
      }
    });
    observer.observe(playmat, { subtree: true, attributes: true, attributeOldValue: true, childList: true });

    // Idle with a live decision: nothing may mutate anywhere on the board.
    await new Promise((resolve) => setTimeout(resolve, 500));
    flushSync();
    expect(mutations, `idle board must be inert, saw: ${JSON.stringify(mutations)}`).toEqual([]);

    // Answer with slot 0; while its step plays back, the OTHER decision
    // targets must stay untouched: same nodes, selectable, never claimed.
    slot(0).click();
    flushSync();
    await new Promise((resolve) => setTimeout(resolve, 700));
    flushSync();
    observer.disconnect();

    const foreignMutations = mutations.filter((entry) => entry.target !== 'slot-1-bench-0');
    expect(foreignMutations, `playback may only touch the clicked slot, saw: ${JSON.stringify(foreignMutations)}`).toEqual([]);
    for (const index of [1, 2]) {
      expect(slot(index)).toBe(watchedIdentity[index]);
      expect(slot(index).classList.contains('prompt-selectable')).toBe(true);
      expect(slot(index).hasAttribute('data-anim-hidden')).toBe(false);
    }
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
