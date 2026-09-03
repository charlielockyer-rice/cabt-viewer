// @vitest-environment happy-dom
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, expect, it, vi } from 'vitest';
import ImportScreen from './ImportScreen.svelte';

let app: Record<string, unknown> | undefined;

afterEach(() => {
  if (app) {
    unmount(app);
    app = undefined;
  }
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

function props(overrides: Record<string, unknown> = {}) {
  return {
    homeMode: 'watch',
    deck1Text: '',
    deck2Text: '',
    player1Control: 'self',
    player2Control: 'agent',
    player1AgentId: 'first-legal',
    player2AgentId: 'first-legal',
    player1DeckSource: 'import',
    player2DeckSource: 'import',
    setHomeMode: vi.fn(),
    startGame: vi.fn(),
    loadGameLog: vi.fn(),
    openReplayRef: vi.fn(),
    loadClip: vi.fn(),
    refreshCatalog: vi.fn(),
    ...overrides,
  };
}

it('opens the replay named in the Open replay box', () => {
  const openReplayRef = vi.fn();
  app = mount(ImportScreen, { target: document.body, props: props({ openReplayRef }) });

  const input = document.querySelector<HTMLInputElement>('#open-replay-input')!;
  const submit = document.querySelector<HTMLButtonElement>('.open-replay button')!;
  expect(submit.disabled).toBe(true);

  input.value = '/cabt-artifacts/viewer-inbox/game.json';
  input.dispatchEvent(new Event('input'));
  flushSync();

  expect(submit.disabled).toBe(false);
  submit.click();
  flushSync();
  expect(openReplayRef).toHaveBeenCalledWith('/cabt-artifacts/viewer-inbox/game.json');
});

it('lists saved local logs and opens the clicked one', () => {
  const loadGameLog = vi.fn();
  const log = { id: 'local-1', name: 'Local match', file: 'local-1.json', players: ['You', 'Agent'] };
  app = mount(ImportScreen, { target: document.body, props: props({ gameLogs: [log], loadGameLog }) });

  const buttons = document.querySelectorAll<HTMLButtonElement>('.log-list button');
  expect(buttons.length).toBe(1);
  expect(document.body.textContent).toContain('You vs Agent');

  buttons[0].click();
  expect(loadGameLog).toHaveBeenCalledWith(log);
});

it('offers exactly the two watch sources, local logs first', () => {
  app = mount(ImportScreen, { target: document.body, props: props() });

  const tabs = [...document.querySelectorAll('.source-tabs button')].map((tab) => tab.textContent);
  expect(tabs).toEqual(['Local logs', 'Clips']);
  expect(document.querySelector('.source-tabs button.active')?.textContent).toBe('Local logs');
});
