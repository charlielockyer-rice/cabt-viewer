// @vitest-environment happy-dom
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import ClipPanel from './ClipPanel.svelte';
import { clipStore } from '../../state/clip.svelte';
import { replayStore } from '../../state/replay.svelte';

const replayUrl = '/local-replays/game-a.json';

function player() {
  return { active: [], bench: [], benchMax: 5, hand: [], handCount: 0, deckCount: 50, discard: [], prize: [] };
}

const fakeReplay = {
  visualize: Array.from({ length: 8 }, () => ({
    select: null,
    logs: [],
    current: { turn: 1, yourIndex: 0, result: -1, players: [player(), player()] },
  })),
};

const clip = {
  schema: 'cabt-clip-v1',
  title: 'Guided tour',
  created: '2026-08-09',
  author: 'lab agent',
  summary: 'A **short** tour.',
  items: [
    { kind: 'note', markdown: 'Read the `note` first.' },
    { kind: 'position', replay: replayUrl, state: 3, caption: 'The fork.', focusOptions: [1] },
    {
      kind: 'compare',
      replay: replayUrl,
      state: 4,
      caption: 'Two ways out.',
      lines: [
        { label: 'Played line', role: 'played', optionIndexes: [0], note: 'What happened.' },
        { label: 'Alternative line', role: 'alternative', optionIndexes: [1] },
      ],
    },
    { kind: 'diagram', svg: '<circle />' },
  ],
};

let app: Record<string, unknown> | undefined;

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (input: unknown) => {
    const url = String(input);
    const body = url === '/clip.json' ? clip : url === replayUrl ? fakeReplay : null;
    return body
      ? new Response(JSON.stringify(body), { status: 200 })
      : new Response('', { status: 404 });
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
  document.body.innerHTML = '';
});

it('renders the tour, the selected item, and an unsupported row that does not break it', async () => {
  await clipStore.load('/clip.json');
  // Recorded search weights for the compared state, so the author's lines can
  // pick up the numbers the recording already holds.
  replayStore.decisionAnalyses = [{
    stateIndex: 4,
    legalActions: [{ label: 'Promote Bench 1' }, { label: 'Promote Bench 2' }],
    searchInspector: {
      actions: [
        { optionIndexes: [0], prior: 0.7, visits: 24, qForActor: 0.61 },
        { optionIndexes: [1], prior: 0.3, visits: 8, qForActor: 0.44 },
      ],
    },
  }];

  app = mount(ClipPanel, { target: document.body });
  flushSync();

  const text = () => document.body.textContent ?? '';
  expect(text()).toContain('Guided tour');
  expect(text()).toContain('lab agent');
  expect(text()).toContain('A short tour.');
  expect(text()).toContain('Read the note first.');
  expect(text()).toContain('Position · state 3');
  expect(text()).toContain('Compare · state 4');
  expect(text()).toContain('Unsupported item');

  // Load opened on the first position, and its caption is in the detail pane.
  expect(clipStore.selectedIndex).toBe(1);
  expect(text()).toContain('The fork.');

  // Selecting the compare item joins each author line to the recorded action
  // that carries the same option indexes.
  const compareButton = [...document.querySelectorAll<HTMLButtonElement>('.clip-items button')]
    .find((button) => button.textContent?.includes('Compare'));
  expect(compareButton).toBeTruthy();
  compareButton!.click();
  await vi.waitFor(() => {
    flushSync();
    expect(clipStore.selectedIndex).toBe(2);
  });
  flushSync();

  expect(text()).toContain('Played line');
  expect(text()).toContain('What happened.');
  expect(text()).toContain('Alternative line');
  expect(text()).toContain('70%');
  expect(text()).toContain('24');
  expect(text()).toContain('61%');
  // Option indexes are shown as the recorded action labels.
  expect(text()).toContain('Promote Bench 1');
  expect(text()).toContain('Promote Bench 2');

  const link = document.querySelector<HTMLAnchorElement>('.detail-actions a');
  expect(link?.getAttribute('href')).toContain('view=replay');
  expect(link?.getAttribute('href')).toContain('state=4');
});

it('shows the clip failure in the panel rather than an empty rail', async () => {
  await clipStore.load('/missing.json');

  app = mount(ClipPanel, { target: document.body });
  flushSync();

  expect(document.body.textContent).toContain('Clip unavailable');
  expect(document.body.textContent).toContain('404');
});
