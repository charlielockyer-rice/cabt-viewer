// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clipStore } from './clip.svelte';
import { replayStore } from './replay.svelte';

const replayA = '/local-replays/game-a.json';
const replayB = 'gamebank:game-b';
const replayBUrl = '/game-bank/replays/game-b';

function player() {
  return {
    active: [],
    bench: [],
    benchMax: 5,
    hand: [],
    handCount: 0,
    deckCount: 50,
    discard: [],
    prize: [],
  };
}

// The smallest replay the snapshot projector accepts, with enough frames that
// a clip can name distinct states in it.
function fakeReplay(frameCount: number, extra: Record<string, unknown> = {}) {
  return {
    visualize: Array.from({ length: frameCount }, (_unused, index) => ({
      select: null,
      logs: [],
      current: {
        turn: 1 + Math.floor(index / 2),
        yourIndex: index % 2,
        result: -1,
        players: [player(), player()],
      },
    })),
    ...extra,
  };
}

const tourClip = {
  schema: 'cabt-clip-v1',
  title: 'Tour',
  created: '2026-08-09',
  items: [
    { kind: 'note', markdown: 'Read me first.' },
    { kind: 'position', replay: replayA, state: 3 },
    { kind: 'position', replay: replayA, state: 5 },
    { kind: 'compare', replay: replayB, state: 2, lines: [{ label: 'Line' }] },
  ],
};

let fetchMock: ReturnType<typeof vi.fn>;
let replayFetches: string[];

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function serve(routes: Record<string, unknown>) {
  replayFetches = [];
  fetchMock = vi.fn(async (input: unknown) => {
    const url = String(input);
    if (url === replayA || url === replayBUrl) {
      replayFetches.push(url);
    }
    if (!(url in routes)) {
      return new Response('', { status: 404 });
    }
    return jsonResponse(routes[url]);
  });
  vi.stubGlobal('fetch', fetchMock);
}

beforeEach(() => {
  serve({
    '/clips-demo.json': tourClip,
    [replayA]: fakeReplay(8),
    [replayBUrl]: fakeReplay(8),
  });
});

afterEach(() => {
  clipStore.clear();
  replayStore.clear();
  vi.unstubAllGlobals();
});

describe('clipStore.load', () => {
  it('parses the clip and opens on its first position', async () => {
    await clipStore.load('/clips-demo.json');

    expect(clipStore.active).toBe(true);
    expect(clipStore.error).toBe('');
    expect(clipStore.clip?.title).toBe('Tour');
    expect(clipStore.selectedIndex).toBe(1);
    expect(replayStore.replay).not.toBeNull();
    expect(replayStore.stateIndex).toBe(3);
    expect(replayFetches).toEqual([replayA]);
  });

  it('keeps clip mode with a message when the clip is missing', async () => {
    await clipStore.load('/no-such-clip.json');

    expect(clipStore.active).toBe(true);
    expect(clipStore.clip).toBeNull();
    expect(clipStore.error).toContain('404');
    expect(replayStore.replay).toBeNull();
  });

  it('reports a schema violation with the offending path', async () => {
    serve({ '/bad.json': { schema: 'cabt-clip-v1', title: 'T', created: 'C', items: [{ kind: 'position' }] } });
    await clipStore.load('/bad.json');

    expect(clipStore.clip).toBeNull();
    expect(clipStore.error).toBe('clip.items[0].replay must be a non-empty string (got undefined)');
  });
});

describe('clipStore.selectItem', () => {
  it('seeks without refetching while consecutive items share a replay', async () => {
    await clipStore.load('/clips-demo.json');
    expect(replayFetches).toEqual([replayA]);

    await clipStore.selectItem(2);

    expect(clipStore.selectedIndex).toBe(2);
    expect(replayStore.stateIndex).toBe(5);
    expect(replayFetches).toEqual([replayA]);
  });

  it('loads the other replay when the item changes replays', async () => {
    await clipStore.load('/clips-demo.json');

    await clipStore.selectItem(3);

    expect(replayStore.stateIndex).toBe(2);
    expect(replayFetches).toEqual([replayA, replayBUrl]);
  });

  it('reloads the first replay when the tour comes back to it', async () => {
    await clipStore.load('/clips-demo.json');
    await clipStore.selectItem(3);
    await clipStore.selectItem(2);

    expect(replayStore.stateIndex).toBe(5);
    expect(replayFetches).toEqual([replayA, replayBUrl, replayA]);
  });

  it('leaves the board alone on a note', async () => {
    await clipStore.load('/clips-demo.json');
    await clipStore.selectItem(2);

    await clipStore.selectItem(0);

    expect(clipStore.selectedIndex).toBe(0);
    expect(replayStore.stateIndex).toBe(5);
    expect(replayFetches).toEqual([replayA]);
  });

  it('clamps out-of-range indexes', async () => {
    await clipStore.load('/clips-demo.json');

    await clipStore.selectItem(99);
    expect(clipStore.selectedIndex).toBe(3);

    await clipStore.selectItem(-4);
    expect(clipStore.selectedIndex).toBe(0);
  });

  it('clamps a state past the end of the replay', async () => {
    serve({
      '/clip.json': {
        schema: 'cabt-clip-v1',
        title: 'T',
        created: 'C',
        items: [{ kind: 'position', replay: replayA, state: 900 }],
      },
      [replayA]: fakeReplay(8),
    });
    await clipStore.load('/clip.json');

    expect(replayStore.stateIndex).toBe(7);
  });
});

describe('clipStore item navigation', () => {
  it('walks the tour with next and previous, stopping at the ends', async () => {
    await clipStore.load('/clips-demo.json');
    expect(clipStore.selectedIndex).toBe(1);

    await clipStore.nextItem();
    expect(clipStore.selectedIndex).toBe(2);
    expect(replayStore.stateIndex).toBe(5);

    await clipStore.previousItem();
    expect(clipStore.selectedIndex).toBe(1);
    expect(replayStore.stateIndex).toBe(3);

    await clipStore.previousItem();
    await clipStore.previousItem();
    expect(clipStore.selectedIndex).toBe(1);

    await clipStore.nextItem();
    await clipStore.nextItem();
    await clipStore.nextItem();
    await clipStore.nextItem();
    expect(clipStore.selectedIndex).toBe(3);
  });
});

describe('clip exact-decision mode', () => {
  it('opens an analysis recording in exact mode when the item asks for it', async () => {
    serve({
      '/clip.json': {
        schema: 'cabt-clip-v1',
        title: 'T',
        created: 'C',
        items: [{ kind: 'position', replay: replayA, state: 0, exact: true }],
      },
      [replayA]: fakeReplay(8, { analysisVisibility: { mode: 'analysis', hands: 'full', prizes: 'full' } }),
    });

    await clipStore.load('/clip.json');

    expect(replayStore.animationsEnabled).toBe(false);
  });

  it('ignores the exact flag on a recording with no decision metadata', async () => {
    serve({
      '/clip.json': {
        schema: 'cabt-clip-v1',
        title: 'T',
        created: 'C',
        items: [{ kind: 'position', replay: replayA, state: 2, exact: true }],
      },
      [replayA]: fakeReplay(8),
    });

    await clipStore.load('/clip.json');

    expect(replayStore.animationsEnabled).toBe(true);
    expect(replayStore.stateIndex).toBe(2);
  });
});

describe('clipStore.clear', () => {
  it('leaves clip mode', async () => {
    await clipStore.load('/clips-demo.json');

    clipStore.clear();

    expect(clipStore.active).toBe(false);
    expect(clipStore.clip).toBeNull();
    expect(clipStore.selectedIndex).toBe(-1);
  });
});
