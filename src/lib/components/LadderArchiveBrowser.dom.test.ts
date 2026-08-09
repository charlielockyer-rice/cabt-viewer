// @vitest-environment happy-dom
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, expect, it, vi } from 'vitest';
import LadderArchiveBrowser from './LadderArchiveBrowser.svelte';

let app: Record<string, unknown> | undefined;

afterEach(() => {
  if (app) {
    unmount(app);
    app = undefined;
  }
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

function stubLibrary(payloads: { days: unknown; episodes: unknown }) {
  const fetcher = vi.fn(async (url: string) => new Response(
    JSON.stringify(url.startsWith('/game-bank/ladder/days') ? payloads.days : payloads.episodes),
    { status: 200 },
  ));
  vi.stubGlobal('fetch', fetcher);
  return fetcher;
}

it('lists the newest mirrored day and opens the clicked episode', async () => {
  const fetcher = stubLibrary({
    days: {
      days: [{ day: '2026-07-19', episodes: 12 }, { day: '2026-07-20', episodes: 2 }],
      library: '/Users/lab/cabt-library',
      available: true,
      reason: '',
    },
    episodes: {
      day: '2026-07-20',
      available: true,
      reason: '',
      episodes: [
        {
          id: '87170108',
          team0: 'Luca',
          team1: 'Benarg',
          reward0: -1,
          reward1: 1,
          steps: 215,
          gz_bytes: 183095,
          raw_bytes: 6434491,
        },
        {
          id: '87170023',
          team0: 'Rmy',
          team1: 'palsystem',
          reward0: 1,
          reward1: -1,
          steps: 220,
          gz_bytes: 192497,
          raw_bytes: 6749596,
        },
      ],
    },
  });

  const openEpisode = vi.fn();
  app = mount(LadderArchiveBrowser, { target: document.body, props: { openEpisode } });

  await vi.waitFor(() => {
    flushSync();
    expect(document.querySelectorAll('.episode-list button').length).toBe(2);
  });

  expect(fetcher).toHaveBeenCalledWith('/game-bank/ladder/days');
  expect(fetcher).toHaveBeenCalledWith('/game-bank/ladder/episodes?day=2026-07-20');

  const text = document.body.textContent ?? '';
  expect(text).toContain('2 episodes');
  expect(text).toContain('87170108');
  expect(text).toContain('Benarg');
  expect(text).toContain('6.1 MB');

  document.querySelector<HTMLButtonElement>('.episode-list button')?.click();
  expect(openEpisode).toHaveBeenCalledWith('2026-07-20', expect.objectContaining({ id: '87170108' }));
});

it('filters the day by team name', async () => {
  stubLibrary({
    days: { days: [{ day: '2026-07-20', episodes: 2 }], library: '/lib', available: true, reason: '' },
    episodes: {
      day: '2026-07-20',
      available: true,
      reason: '',
      episodes: [
        { id: '2', team0: 'Luca', team1: 'Benarg', reward0: 1, reward1: -1, steps: 10, gz_bytes: 1, raw_bytes: 2 },
        { id: '1', team0: 'Rmy', team1: 'palsystem', reward0: 1, reward1: -1, steps: 10, gz_bytes: 1, raw_bytes: 2 },
      ],
    },
  });

  app = mount(LadderArchiveBrowser, { target: document.body, props: { openEpisode: vi.fn() } });

  await vi.waitFor(() => {
    flushSync();
    expect(document.querySelectorAll('.episode-list button').length).toBe(2);
  });

  const filter = document.querySelector<HTMLInputElement>('.ladder-toolbar input');
  filter!.value = 'palsystem';
  filter!.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();

  const rows = document.querySelectorAll('.episode-list button');
  expect(rows.length).toBe(1);
  expect(rows[0].textContent).toContain('Rmy');
});

it('explains an unmirrored library instead of showing an empty list', async () => {
  stubLibrary({
    days: {
      days: [],
      library: '/Users/lab/cabt-library',
      available: false,
      reason: 'ladder library /Users/lab/cabt-library is not mirrored on this machine',
    },
    episodes: { day: '', episodes: [], available: false, reason: '' },
  });

  app = mount(LadderArchiveBrowser, { target: document.body, props: { openEpisode: vi.fn() } });

  await vi.waitFor(() => {
    flushSync();
    expect(document.querySelector('.notice')).toBeTruthy();
  });

  const text = document.body.textContent ?? '';
  expect(text).toContain('not mirrored on this machine');
  expect(text).toContain('CABT_LADDER_LIBRARY');
  expect(document.querySelector('.episode-list')).toBeNull();
});
