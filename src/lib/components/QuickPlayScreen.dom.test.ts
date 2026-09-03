// @vitest-environment happy-dom
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, expect, it, vi } from 'vitest';
import QuickPlayScreen from './QuickPlayScreen.svelte';

let app: Record<string, unknown> | undefined;

afterEach(() => {
  if (app) {
    unmount(app);
    app = undefined;
  }
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

const matchup = {
  ok: true,
  agent: { id: 'copycat-v1-20m', name: 'Copycat v1 (20M)', description: 'Imitation policy trained on ladder games.' },
  playerDeck: { id: 'dragapult-dusknoir', name: 'Dragapult Dusknoir', deckUrl: '/local-engine/deck-csv/dragapult-dusknoir' },
  botDeck: { id: 'raging-bolt-ogerpon', name: 'Raging Bolt Ogerpon', deckUrl: '/local-engine/deck-csv/raging-bolt-ogerpon' },
};

function stubFetch(response: { ok: boolean; status?: number; json: unknown }) {
  const fetchMock = vi.fn(async () => ({
    ok: response.ok,
    status: response.status ?? (response.ok ? 200 : 404),
    json: async () => response.json,
  }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function mountScreen(props: Record<string, unknown> = {}) {
  app = mount(QuickPlayScreen, { target: document.body, props: { startQuickGame: vi.fn(), ...props } });
  await vi.waitFor(() => {
    flushSync();
    expect(document.querySelector('.empty')).toBeNull();
  });
  return app;
}

it('shows the bot and both deck names once the matchup loads', async () => {
  const fetchMock = stubFetch({ ok: true, json: matchup });
  await mountScreen();

  expect(fetchMock).toHaveBeenCalledWith('/local-engine/quickplay');
  expect(document.querySelector('h1')?.textContent).toBe('Play vs Copycat v1 (20M)');
  expect(document.body.textContent).toContain('Imitation policy trained on ladder games.');
  expect(document.querySelector('.decks')?.textContent).toBe('You: Dragapult Dusknoir · Bot: Raging Bolt Ogerpon');
  expect(document.querySelector('.start')?.textContent?.trim()).toBe('Start game');
});

it('shows the server error and never falls through to a picker', async () => {
  stubFetch({ ok: false, status: 404, json: { ok: false, error: 'Quick play deck gholdengo-typo is not in the deck catalog.' } });
  await mountScreen();

  expect(document.querySelector('.error')?.textContent)
    .toBe('Quick play deck gholdengo-typo is not in the deck catalog.');
  expect(document.querySelector('.start')).toBeNull();
  expect([...document.querySelectorAll('button')].map((button) => button.textContent?.trim())).toEqual(['Retry']);
});

it('retries the load after a failure', async () => {
  const failing = stubFetch({ ok: false, status: 503, json: { ok: false, error: 'engine down' } });
  await mountScreen();
  expect(document.querySelector('.error')?.textContent).toBe('engine down');

  failing.mockImplementation(async () => ({ ok: true, status: 200, json: async () => matchup }));
  document.querySelector<HTMLButtonElement>('button')!.click();
  await vi.waitFor(() => {
    flushSync();
    expect(document.querySelector('h1')?.textContent).toBe('Play vs Copycat v1 (20M)');
  });
});

it('hands the loaded matchup to startQuickGame when Start is clicked', async () => {
  stubFetch({ ok: true, json: matchup });
  const startQuickGame = vi.fn();
  await mountScreen({ startQuickGame });

  document.querySelector<HTMLButtonElement>('.start')!.click();
  flushSync();
  expect(startQuickGame).toHaveBeenCalledTimes(1);
  expect(startQuickGame.mock.calls[0][0]).toEqual({
    agent: matchup.agent,
    playerDeck: matchup.playerDeck,
    botDeck: matchup.botDeck,
  });
});

it('disables Start and shows a start failure while busy', async () => {
  stubFetch({ ok: true, json: matchup });
  await mountScreen({ busy: true, startError: 'Local engine is not running.' });

  const start = document.querySelector<HTMLButtonElement>('.start')!;
  expect(start.disabled).toBe(true);
  expect(start.textContent?.trim()).toBe('Starting...');
  expect(document.querySelector('.error')?.textContent).toBe('Local engine is not running.');
});
