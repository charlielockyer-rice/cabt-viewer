// @vitest-environment happy-dom
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, expect, it, vi } from 'vitest';
import ClipBrowser from './ClipBrowser.svelte';

let app: Record<string, unknown> | undefined;

afterEach(() => {
  if (app) {
    unmount(app);
    app = undefined;
  }
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

it('lists the manifest and opens the clicked clip', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
    clips: [
      { file: 'viewer-clips/opening.json', title: 'Opening tour', created: '2026-08-09', author: 'lab agent', items: 4, summary: 'Four stops.' },
      { file: 'viewer-clips/endgame.json', title: 'Endgame tour' },
    ],
  }), { status: 200 })));

  const openClip = vi.fn();
  app = mount(ClipBrowser, { target: document.body, props: { openClip } });

  await vi.waitFor(() => {
    flushSync();
    expect(document.querySelectorAll('.clip-list button').length).toBe(2);
  });

  const text = document.body.textContent ?? '';
  expect(text).toContain('Opening tour');
  expect(text).toContain('lab agent · 2026-08-09 · 4 items');
  expect(text).toContain('Endgame tour');

  document.querySelector<HTMLButtonElement>('.clip-list button')?.click();
  expect(openClip).toHaveBeenCalledWith(expect.objectContaining({ file: 'viewer-clips/opening.json' }));
});

it('explains where clips come from when the manifest is not there yet', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })));

  app = mount(ClipBrowser, { target: document.body, props: { openClip: vi.fn() } });

  await vi.waitFor(() => {
    flushSync();
    expect(document.querySelector('.empty-state')).toBeTruthy();
  });
  expect(document.body.textContent).toContain('agent-lab/artifacts/viewer-clips/');
});
