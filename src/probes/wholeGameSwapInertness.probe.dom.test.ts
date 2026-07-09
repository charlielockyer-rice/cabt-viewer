// @vitest-environment happy-dom
//
// AUDIT PROBE (additive, no production code touched) for
// docs/audit-2026-07-09-animation-architecture.md.
//
// Reproduces — or refutes — two of the reported live-play symptom CLASSES by
// driving a WHOLE real game's state sequence through the reactive DOM and
// checking, at every view swap, that:
//
//   (A) discard-top identity is stable: when the logical top-of-pile card is
//       unchanged between two consecutive views, its DOM node (and its loaded
//       <img>) must be the SAME element — a recreated node blanks/flickers the
//       pile. (Charlie: "the discard pile's top card sometimes flickering or
//       changing when it shouldn't".)
//
//   (B) persistent cards keep their DOM node across swaps: a hand/board card
//       present with the same serial before and after a swap must not be
//       destroyed and recreated (identity loss → img refetch → flicker).
//
// It renders the LIVE board (gameStore.game) so the animation layers see 0-size
// rects and no-op — isolating the pure reactive-DOM keying behaviour, which is
// exactly where the flicker/identity class lives. Animation-layer timing
// classes (bounce-back, real-mouse hit-testing) are NOT covered here; see the
// audit doc's evidence table.
//
// Data: public/game-logs/pasted-507c3b0f.json — one of Charlie's real games.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cabtReplayToSnapshot } from '../lib/cabt/cabtReplay';
import type { GameView, PlayerView } from '../lib/game/types';
import { gameStore } from '../state/game.svelte';
import { viewSettingsStore } from '../state/viewSettings.svelte';

vi.mock('../lib/home/catalog', () => ({
  loadAgentOptions: async () => [],
  loadGameLogs: async () => [],
}));

import App from '../App.svelte';

const here = dirname(fileURLToPath(import.meta.url));
const logPath = resolve(here, '../../public/game-logs/pasted-507c3b0f.json');

function cardKey(card: { serial?: number; id?: number; name?: string } | undefined): string {
  if (!card) {
    return '';
  }
  return `${card.serial ?? ''}-${card.id ?? ''}-${card.name ?? ''}`;
}

// Data-level scan: any view whose hand has two cards sharing a serial collides
// Hand.svelte's keyed each-block (key = card.serial). This is the pure-data
// signature of the "hand flicker" collision class and needs no DOM.
function duplicateHandSerialFrames(views: GameView[]): Array<{ frame: number; player: number; serials: number[]; dup: number[] }> {
  const hits: Array<{ frame: number; player: number; serials: number[]; dup: number[] }> = [];
  views.forEach((view, frame) => {
    for (const p of [0, 1]) {
      const hand = (view.players?.[p] as PlayerView | undefined)?.hand ?? [];
      const serials = hand.map((c) => c.serial).filter((s): s is number => s !== undefined);
      const seen = new Set<number>();
      const dup = new Set<number>();
      for (const s of serials) {
        if (seen.has(s)) {
          dup.add(s);
        }
        seen.add(s);
      }
      if (dup.size) {
        hits.push({ frame, player: p, serials, dup: [...dup] });
      }
    }
  });
  return hits;
}

// The full frame sequence the replay walker shows: every animation phase's
// pre-state view, then the settled view, for every step.
function viewSequence(snapshot: ReturnType<typeof cabtReplayToSnapshot>): GameView[] {
  const views: GameView[] = [];
  for (const step of snapshot.steps) {
    for (const phase of step.animationPhases ?? []) {
      views.push(phase.view);
    }
    const settled = step.displayView ?? snapshot.views[step.stateIndex];
    if (settled) {
      views.push(settled);
    }
  }
  return views;
}

// The real-game fixture is gitignored (lives only on Charlie's disk), so the
// committed probe skips cleanly when it is absent rather than failing CI.
const hasLog = existsSync(logPath);

describe.skipIf(!hasLog)('whole-game swap inertness (happy-dom, real game log)', () => {
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

  it('keeps the discard top and persistent cards node-stable across every swap', () => {
    const snapshot = cabtReplayToSnapshot(JSON.parse(readFileSync(logPath, 'utf8')));
    const views = viewSequence(snapshot);
    expect(views.length).toBeGreaterThan(10);

    // HARD GUARD (was an open finding): the pre-state hand builder used to mint
    // duplicate serials when the settled hand reordered its known cards (serial
    // 99 doubled at step 9 of this game). Fixed at source in
    // cabtReplay.ts nextHandCardToAdd; assert the whole game is now clean so a
    // regression re-throws the keyed-each collision here.
    const dupFrames = duplicateHandSerialFrames(views);
    expect(dupFrames, JSON.stringify(dupFrames, null, 2)).toEqual([]);

    // happy-dom has no Web Animations API; the Hand's FLIP animate()/getAnimations()
    // calls are stubbed globally by the shared setup (src/test-setup/dom-web-animations.ts)
    // and are irrelevant to the keying under test.

    // Render animations OFF-path: 0-size rects make the layers no-op, so this
    // isolates reactive-DOM keying (the class under test).
    viewSettingsStore.animateActions = false;
    // Pin the seat: follow-active would flip top/bottom when the acting player
    // changes, remounting both panels — a real behaviour, but a different one
    // from the fixed-seat swap flicker under test here.
    viewSettingsStore.followActive = false;
    viewSettingsStore.viewIndex = 0;

    gameStore.game = views[0];
    app = mount(App, { target: document.body });
    flushSync();

    type Finding = { swap: number; kind: string; detail: string };
    const findings: Finding[] = [];

    const discardTopEl = (playerIndex: number): HTMLElement | null => {
      const pile = document.querySelector(`[data-card-anchor="player:${playerIndex}:discard"]`);
      const top = pile?.querySelector('.discard-card-top .card-tile');
      return top instanceof HTMLElement ? top : null;
    };
    const handCardEls = (playerIndex: number): Map<number, HTMLElement> => {
      const map = new Map<number, HTMLElement>();
      const hand = document.querySelector(`[data-card-anchor="player:${playerIndex}:hand"]`);
      for (const frame of hand?.querySelectorAll('.hand-card-frame[data-card-serial]') ?? []) {
        if (frame instanceof HTMLElement) {
          const serial = Number(frame.dataset.cardSerial);
          if (Number.isFinite(serial)) {
            map.set(serial, frame);
          }
        }
      }
      return map;
    };

    let prev = views[0];
    let prevDiscardTop: Record<number, HTMLElement | null> = { 0: discardTopEl(0), 1: discardTopEl(1) };
    let prevHand: Record<number, Map<number, HTMLElement>> = { 0: handCardEls(0), 1: handCardEls(1) };

    let swaps = 0;
    let discardTopComparable = 0;
    let handCardComparable = 0;

    for (let i = 1; i < views.length; i += 1) {
      const view = views[i];
      gameStore.game = view;
      flushSync();
      swaps += 1;

      for (const p of [0, 1] as const) {
        const prevPlayer = prev.players?.[p] as PlayerView | undefined;
        const curPlayer = view.players?.[p] as PlayerView | undefined;
        // (A) discard-top identity
        const prevTopKey = cardKey(prevPlayer?.discard?.at(-1));
        const curTopKey = cardKey(curPlayer?.discard?.at(-1));
        const curTopEl = discardTopEl(p);
        if (prevTopKey && curTopKey && prevTopKey === curTopKey) {
          discardTopComparable += 1;
          const prevEl = prevDiscardTop[p];
          if (prevEl && curTopEl && prevEl !== curTopEl) {
            findings.push({
              swap: i,
              kind: 'discard-top-node-churn',
              detail: `player ${p} top ${curTopKey} unchanged but DOM node recreated`,
            });
          }
        }
        prevDiscardTop[p] = curTopEl;

        // (B) persistent hand-card identity
        const curHand = handCardEls(p);
        const prevHandMap = prevHand[p];
        const prevSerials = new Set((prevPlayer?.hand ?? []).map((c) => c.serial).filter((s): s is number => s !== undefined));
        const curSerials = new Set((curPlayer?.hand ?? []).map((c) => c.serial).filter((s): s is number => s !== undefined));
        for (const serial of prevSerials) {
          if (!curSerials.has(serial)) {
            continue;
          }
          handCardComparable += 1;
          const before = prevHandMap.get(serial);
          const after = curHand.get(serial);
          if (before && after && before !== after) {
            findings.push({
              swap: i,
              kind: 'hand-card-node-churn',
              detail: `player ${p} hand serial ${serial} persisted but DOM frame recreated`,
            });
          }
        }
        prevHand[p] = curHand;
      }

      prev = view;
    }

    const report = {
      log: 'pasted-507c3b0f.json',
      views: views.length,
      swaps,
      discardTopStableChecks: discardTopComparable,
      handCardStableChecks: handCardComparable,
      domNodeChurnFindings: findings.slice(0, 40),
      // OPEN (reproduced) collision-class finding:
      duplicateHandSerialFrames: dupFrames,
    };
    // eslint-disable-next-line no-console
    console.log('[swap-inertness probe]', JSON.stringify(report, null, 2));

    // HARD GUARD for the already-fixed classes (discard-top identity +
    // persistent-card node identity): a recreated node while the card is
    // logically unchanged is the flicker signature. Trace above names the
    // exact swap + card if this ever regresses.
    expect(findings, JSON.stringify(findings.slice(0, 20), null, 2)).toEqual([]);
    // Enough real swaps actually exercised the invariant to make it meaningful.
    expect(discardTopComparable).toBeGreaterThan(20);
  });
});
