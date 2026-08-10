// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { clipStore } from './state/clip.svelte';
import { replayStore } from './state/replay.svelte';

// The catalog manifests are home-screen furniture; clip mode never shows them.
vi.mock('./lib/home/catalog', () => ({
  loadAgentOptions: async () => [],
  loadDeckOptions: async () => [],
  loadGameLogs: async () => [],
}));

import App from './App.svelte';

const publicDir = resolve(dirname(fileURLToPath(import.meta.url)), '../public');

let app: Record<string, unknown> | undefined;

// Serves the shipped demo clip and the local replay it points at, exactly as
// the dev server would.
beforeEach(() => {
  window.history.replaceState({}, '', '/?view=clip&clip=/clips-demo.json');
  vi.stubGlobal('fetch', vi.fn(async (input: unknown) => {
    const path = new URL(String(input), 'http://localhost/').pathname;
    if (path === '/clips-demo.json' || path.startsWith('/local-replays/')) {
      return new Response(readFileSync(resolve(publicDir, `.${path}`), 'utf8'), { status: 200 });
    }
    return new Response('', { status: 404 });
  }));
});

afterEach(() => {
  if (app) {
    unmount(app);
    app = undefined;
  }
  clipStore.clear();
  replayStore.clear();
  vi.unstubAllGlobals();
  window.history.replaceState({}, '', '/');
  document.body.innerHTML = '';
});

it('opens the demo clip from ?view=clip and drives it from the keyboard', async () => {
  app = mount(App, { target: document.body });
  flushSync();

  // The clip loads, seeks its first position, and the board comes up under it.
  await vi.waitFor(() => {
    flushSync();
    expect(clipStore.clip?.title).toBe('Reading a game in four stops');
    expect(replayStore.stateIndex).toBe(40);
  }, { timeout: 10_000 });
  flushSync();

  const text = () => document.body.textContent ?? '';
  expect(text()).toContain('Reading a game in four stops');
  expect(text()).toContain('1 / 3');
  expect(text()).toContain('Position · state 40');
  expect(document.querySelector('.clip-panel')).toBeTruthy();
  // This recording has no decision analysis, so focus options are named from
  // the frame's own select rather than left as bare indexes.
  expect(text()).toContain('Evolve → Bench 4');
  // The whole replay surface stays live underneath the tour.
  expect(document.querySelector('.table-shell.clip-mode')).toBeTruthy();
  expect(document.querySelector('[data-testid="slot-0-active-0"]')).toBeTruthy();
  expect(document.querySelector('.replay-dock')).toBeTruthy();

  // ArrowDown walks to the next stop, which seeks the same replay.
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  await vi.waitFor(() => {
    flushSync();
    expect(replayStore.stateIndex).toBe(87);
  });
  expect(clipStore.selectedIndex).toBe(2);

  // ArrowUp walks back.
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
  await vi.waitFor(() => {
    flushSync();
    expect(replayStore.stateIndex).toBe(40);
  });

  // ArrowRight steps the replay itself.
  const beforeStep = replayStore.stepIndex;
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  flushSync();
  expect(replayStore.stepIndex).toBe(beforeStep + 1);

  // Typing in a field is never a viewer command.
  const field = document.createElement('input');
  document.body.append(field);
  const afterStep = replayStore.stepIndex;
  field.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
  flushSync();
  expect(replayStore.stepIndex).toBe(afterStep);
  field.remove();
});
