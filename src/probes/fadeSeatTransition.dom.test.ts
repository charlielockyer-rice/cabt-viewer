// @vitest-environment happy-dom
//
// Guards the fade-only side-switch (#46 / #58): when "Side switch: Fade" is
// selected, a follow-active seat flip must arm the no-motion gate —
// viewSettingsStore.seatFadeActive goes true and the board layer carries
// .seat-fade-active, which freezes every CSS transition across the board plane
// AND the hand panels, while Hand/BenchZone read the same flag to zero their
// Svelte animate:flip/in/out (the "hands flying across the screen"). In Flip
// mode the same flip must NOT arm it (motion runs normally). happy-dom runs no
// CSS transitions, so this asserts the PATH/FLAG the gate keys off, not pixels.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cabtReplayToSnapshot } from '../lib/cabt/cabtReplay';
import type { GameView } from '../lib/game/types';
import { gameStore } from '../state/game.svelte';
import { viewSettingsStore } from '../state/viewSettings.svelte';
import { replayStore } from '../state/replay.svelte';

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
// A hand panel under the armed fade gate. The freeze anchors on the board layer,
// which contains BOTH the board plane and the hand panels — so this proves the
// gate reaches the hands (which slide via Svelte animate:flip, read off the same
// seatFadeActive flag in Hand/BenchZone).
function gatedHandPanel(): Element | null {
  return document.querySelector('.board.seat-fade-active .player-panel');
}

describe('fade side-switch arms the no-motion gate', () => {
  let app: Record<string, unknown> | undefined;

  afterEach(() => {
    if (app) {
      unmount(app);
      app = undefined;
    }
    gameStore.reset();
    viewSettingsStore.seatTransition = 'flip';
    if (viewSettingsStore.seatFadeTimer !== undefined) {
      clearTimeout(viewSettingsStore.seatFadeTimer);
      viewSettingsStore.seatFadeTimer = undefined;
    }
    viewSettingsStore.seatFadeActive = false;
    replayStore.scrubbing = false;
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

  it('arms seatFadeActive (board + hands) on a seat flip in Fade mode, but not in Flip mode', () => {
    const snapshot = cabtReplayToSnapshot(JSON.parse(readFileSync(logPath, 'utf8')));
    const views = settledViews(snapshot);
    expect(views.length).toBeGreaterThan(4);

    // ---- Flip mode control: a seat flip must NOT arm the fade gate. ----
    viewSettingsStore.seatTransition = 'flip';
    mountAtFrame0(views);
    const flipFrame = firstFlipFrame(views);
    expect(flipFrame, 'fixture must contain at least one follow-active seat flip').toBeGreaterThan(0);
    expect(viewSettingsStore.seatFadeActive, 'flip mode must not arm the fade gate').toBe(false);
    expect(boardLayer()?.classList.contains('seat-fade-active')).toBe(false);

    unmount(app!);
    app = undefined;
    gameStore.reset();
    viewSettingsStore.seatFadeActive = false;

    // ---- Fade mode: the same seat flip must arm the gate for the whole board. ----
    viewSettingsStore.seatTransition = 'fade';
    mountAtFrame0(views);
    let armed = false;
    let classArmed = false;
    let handCovered = false;
    let prev = viewSettingsStore.viewIndex;
    for (let i = 1; i <= flipFrame; i += 1) {
      gameStore.game = views[i];
      flushSync();
      const flipped = viewSettingsStore.viewIndex !== prev;
      prev = viewSettingsStore.viewIndex;
      if (flipped) {
        // Armed at the instant of the flip — the ~320ms auto-clear timer has not
        // fired synchronously, and (critically) it was set at the SOURCE so it is
        // live on the same flush that repositions the seats.
        armed = viewSettingsStore.seatFadeActive;
        classArmed = boardLayer()?.classList.contains('seat-fade-active') ?? false;
        handCovered = gatedHandPanel() !== null;
        break;
      }
    }
    expect(armed, 'fade mode must arm seatFadeActive at the seat flip').toBe(true);
    expect(classArmed, 'the board layer must carry .seat-fade-active (freezes all board CSS transitions)').toBe(true);
    expect(handCovered, 'the gate must reach the hand panels (Hand/BenchZone read the same flag)').toBe(true);
  });

  it('AUTO mode fades a side switch only while scrubbing (incl. the debounced settle), else flips', () => {
    // Decision matrix — auto tracks replayStore.scrubbing; flip/fade are absolute.
    viewSettingsStore.seatTransition = 'auto';
    replayStore.scrubbing = false;
    expect(viewSettingsStore.shouldFadeSeatSwitch(), 'auto + not scrubbing = flip path').toBe(false);
    replayStore.scrubbing = true;
    expect(viewSettingsStore.shouldFadeSeatSwitch(), 'auto + scrubbing = fade path').toBe(true);

    viewSettingsStore.seatTransition = 'flip';
    expect(viewSettingsStore.shouldFadeSeatSwitch(), 'flip never fades, even while scrubbing').toBe(false);

    viewSettingsStore.seatTransition = 'fade';
    replayStore.scrubbing = false;
    expect(viewSettingsStore.shouldFadeSeatSwitch(), 'fade always fades, even when not scrubbing').toBe(true);

    // Arming at the source: followPlayer must arm the gate for an auto seat change
    // ONLY while scrubbing. (replayStore.scrubbing stays true through the debounced
    // drag-release, so the settle flip onto the final seat also fades.)
    viewSettingsStore.seatTransition = 'auto';
    replayStore.scrubbing = true;
    viewSettingsStore.viewIndex = 0;
    viewSettingsStore.seatFadeActive = false;
    viewSettingsStore.followPlayer(1);
    expect(viewSettingsStore.seatFadeActive, 'auto + scrubbing seat change arms the gate').toBe(true);

    replayStore.scrubbing = false;
    viewSettingsStore.viewIndex = 0;
    viewSettingsStore.seatFadeActive = false;
    viewSettingsStore.followPlayer(1);
    expect(viewSettingsStore.seatFadeActive, 'auto + not scrubbing seat change flips (no gate)').toBe(false);
  });
});
