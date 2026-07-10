// @vitest-environment happy-dom
//
// Guards the fade-only side-switch (#46 / #58): when "Side switch: Fade" is
// selected, a follow-active seat flip must select the FADE path — the board
// plane gets data-seat-fading, under which every transition is frozen so the
// reposition snaps with zero flip/rotation and only the opacity dim moves. In
// Flip mode the same flip must NOT set the attribute (the rotate/reposition
// transitions run normally). happy-dom runs no CSS transitions, so this asserts
// the PATH SELECTION (the attribute the CSS gate keys off), not pixels.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cabtReplayToSnapshot } from '../lib/cabt/cabtReplay';
import type { GameView } from '../lib/game/types';
import { gameStore } from '../state/game.svelte';
import { viewSettingsStore } from '../state/viewSettings.svelte';

vi.mock('../lib/home/catalog', () => ({
  loadAgentOptions: async () => [],
  loadGameLogs: async () => [],
}));

import App from '../App.svelte';

const here = dirname(fileURLToPath(import.meta.url));
// Committed real-game fixture, so this runs in CI (unlike the gitignored pasted-* logs).
const logPath = resolve(here, '../../public/game-logs/cabt-match.json');

function settledViews(snapshot: ReturnType<typeof cabtReplayToSnapshot>): GameView[] {
  const views: GameView[] = [];
  for (const step of snapshot.steps) {
    const settled = step.displayView ?? snapshot.views[step.stateIndex];
    if (settled) views.push(settled);
  }
  return views;
}

function boardLayer(): HTMLElement | null {
  return document.querySelector('.board');
}
// A hand panel covered by the fade gate (proves the freeze reaches the hands,
// which live OUTSIDE the board plane as siblings in .board).
function gatedHandPanel(): Element | null {
  return document.querySelector('.board[data-seat-fading] .player-panel');
}

describe('fade side-switch selects the fade path', () => {
  let app: Record<string, unknown> | undefined;

  afterEach(() => {
    if (app) {
      unmount(app);
      app = undefined;
    }
    gameStore.reset();
    viewSettingsStore.seatTransition = 'flip';
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  function mountAtFrame0(views: GameView[]) {
    viewSettingsStore.animateActions = false;
    viewSettingsStore.followActive = true;
    viewSettingsStore.viewIndex = 0;
    gameStore.game = views[0];
    app = mount(App, { target: document.body });
    flushSync();
  }

  // Walk to the first frame that flips the seat (viewIndex changes because the
  // acting player changed under follow-active), returning that frame index.
  function firstFlipFrame(views: GameView[]): number {
    let prev = viewSettingsStore.viewIndex;
    for (let i = 1; i < views.length; i += 1) {
      gameStore.game = views[i];
      flushSync();
      if (viewSettingsStore.viewIndex !== prev) {
        return i;
      }
      prev = viewSettingsStore.viewIndex;
    }
    return -1;
  }

  it('sets data-seat-fading on a seat flip in Fade mode, but not in Flip mode', () => {
    const snapshot = cabtReplayToSnapshot(JSON.parse(readFileSync(logPath, 'utf8')));
    const views = settledViews(snapshot);
    expect(views.length).toBeGreaterThan(4);

    // ---- Flip mode control: a seat flip must NOT arm the fade gate. ----
    viewSettingsStore.seatTransition = 'flip';
    mountAtFrame0(views);
    const flipFrame = firstFlipFrame(views);
    expect(flipFrame, 'fixture must contain at least one follow-active seat flip').toBeGreaterThan(0);
    // Asserted synchronously after the flip's flushSync: the WAAPI stub resolves
    // .finished on a microtask, so the lift hasn't run yet either way — in Flip
    // mode the attribute is never set to begin with.
    expect(boardLayer()?.hasAttribute('data-seat-fading')).toBe(false);

    unmount(app!);
    app = undefined;
    gameStore.reset();

    // ---- Fade mode: the same seat flip must arm the fade gate. ----
    viewSettingsStore.seatTransition = 'fade';
    mountAtFrame0(views);
    let armed = false;
    let handCovered = false;
    let prev = viewSettingsStore.viewIndex;
    for (let i = 1; i <= flipFrame; i += 1) {
      gameStore.game = views[i];
      flushSync();
      const flipped = viewSettingsStore.viewIndex !== prev;
      prev = viewSettingsStore.viewIndex;
      if (flipped) {
        // Must be armed at the instant of the flip, before any microtask lifts it.
        armed = boardLayer()?.hasAttribute('data-seat-fading') ?? false;
        // And the gate must reach the hand panels, not just the board plane.
        handCovered = gatedHandPanel() !== null;
        break;
      }
    }
    expect(armed, 'fade mode must set data-seat-fading on the board layer at the seat flip').toBe(true);
    expect(handCovered, 'the fade gate must cover the hand panels (outside the board plane)').toBe(true);
  });
});
