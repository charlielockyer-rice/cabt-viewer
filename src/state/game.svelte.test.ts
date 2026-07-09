import { afterEach, describe, expect, it } from 'vitest';
import { gameStore } from './game.svelte';
import { viewSettingsStore } from './viewSettings.svelte';
import type { EngineResponse, GameView } from '../lib/game/types';

// applyNow only assigns the view; the shape is opaque here, so a marker object
// is enough to exercise the apply-generation boundary.
function view(turn: number): GameView {
  return { turn } as GameView;
}

afterEach(() => {
  gameStore.reset();
  viewSettingsStore.animateActions = true;
});

describe('gameStore.liveApplyGeneration (the animation scope-end boundary)', () => {
  it('bumps once per applied view across a sequence and the settled view', async () => {
    viewSettingsStore.animateActions = true;
    viewSettingsStore.actionStepDelayMs = 0; // clamps to the 50ms floor
    const before = gameStore.liveApplyGeneration;

    await gameStore.apply({
      ok: true,
      view: view(3),
      sequence: [view(1), view(2)],
    } as EngineResponse);

    // Two playback steps + the settled interactive view = three applications.
    expect(gameStore.liveApplyGeneration).toBe(before + 3);
  });

  it('bumps on the error/cancellation view path', async () => {
    const before = gameStore.liveApplyGeneration;
    await gameStore.apply({ ok: false, error: 'boom', view: view(9) } as EngineResponse);
    expect(gameStore.liveApplyGeneration).toBe(before + 1);
  });

  it('bumps on reset (releases any in-flight scope)', () => {
    const before = gameStore.liveApplyGeneration;
    gameStore.reset();
    expect(gameStore.liveApplyGeneration).toBe(before + 1);
  });

  it('advances monotonically as successive responses are applied, so a new response releases the prior scope', async () => {
    viewSettingsStore.animateActions = false; // settle directly, no playback
    const start = gameStore.liveApplyGeneration;

    await gameStore.apply({ ok: true, view: view(1) } as EngineResponse);
    const afterFirst = gameStore.liveApplyGeneration;
    expect(afterFirst).toBeGreaterThan(start);

    // A second response's first (and only) applied view bumps again — the signal
    // the animation layers watch to end the previous scope. It never regresses.
    await gameStore.apply({ ok: true, view: view(2) } as EngineResponse);
    expect(gameStore.liveApplyGeneration).toBeGreaterThan(afterFirst);
  });
});
