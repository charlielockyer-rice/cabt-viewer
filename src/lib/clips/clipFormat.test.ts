import { describe, expect, it, vi } from 'vitest';
import {
  clipManifestUrl,
  clipReplayCandidates,
  clipReplayViewerUrl,
  clipUrl,
  clipViewerUrl,
  loadClipManifest,
  parseClip,
  parseClipManifest,
  type ClipCompareItem,
  type ClipPositionItem,
} from './clipFormat';
import sampleClip from './__tests__/sample-clip.json';

describe('parseClip', () => {
  it('parses the fixture clip, keeping every documented field', () => {
    const clip = parseClip(sampleClip);

    expect(clip.title).toBe('Sample tour');
    expect(clip.created).toBe('2026-08-09T09:00:00Z');
    expect(clip.author).toBe('test fixture');
    expect(clip.summary).toBe('Two stops on one replay and one on another.');
    expect(clip.items.map((item) => item.kind)).toEqual([
      'note',
      'position',
      'compare',
      'position',
      'unsupported',
    ]);

    const position = clip.items[1] as ClipPositionItem;
    expect(position.replay).toBe('/local-replays/fixture-game.json');
    expect(position.state).toBe(4);
    expect(position.caption).toBe('The fork.');
    expect(position.focusOptions).toEqual([0, 2]);
    expect(position.exact).toBeUndefined();

    const compare = clip.items[2] as ClipCompareItem;
    expect(compare.exact).toBe(true);
    expect(compare.lines).toEqual([
      { label: 'Played line', note: 'What happened.', optionIndexes: [1], role: 'played' },
      { label: 'Other line', optionIndexes: [0, 2], role: 'alternative' },
      { label: 'Bare line' },
    ]);
  });

  it('keeps an unknown item kind as an inert row instead of failing the clip', () => {
    const clip = parseClip(sampleClip);
    expect(clip.items[4]).toEqual({ kind: 'unsupported', originalKind: 'diagram' });
  });

  it('drops a role this build does not know, so a newer writer still opens', () => {
    const clip = parseClip({
      schema: 'cabt-clip-v1',
      title: 'Roles',
      created: '2026-08-09',
      items: [{
        kind: 'compare',
        replay: 'game.json',
        state: 1,
        lines: [{ label: 'Line', role: 'oracle' }],
      }],
    });
    expect((clip.items[0] as ClipCompareItem).lines[0]).toEqual({ label: 'Line' });
  });

  it('accepts a minimal clip', () => {
    const clip = parseClip({
      schema: 'cabt-clip-v1',
      title: 'Minimal',
      created: '2026-08-09',
      items: [],
    });
    expect(clip).toEqual({
      schema: 'cabt-clip-v1',
      title: 'Minimal',
      created: '2026-08-09',
      items: [],
    });
  });

  it.each([
    [{}, 'clip.schema must be "cabt-clip-v1" (got undefined)'],
    [{ schema: 'cabt-clip-v2' }, 'clip.schema must be "cabt-clip-v1" (got "cabt-clip-v2")'],
    [
      { schema: 'cabt-clip-v1', title: 'T', created: 'C' },
      'clip.items must be an array (got undefined)',
    ],
    [
      { schema: 'cabt-clip-v1', created: 'C', items: [] },
      'clip.title must be a non-empty string (got undefined)',
    ],
    [
      { schema: 'cabt-clip-v1', title: 'T', items: [] },
      'clip.created must be a non-empty string (got undefined)',
    ],
    [
      { schema: 'cabt-clip-v1', title: 'T', created: 'C', author: 7, items: [] },
      'clip.author must be a string (got 7)',
    ],
    [
      { schema: 'cabt-clip-v1', title: 'T', created: 'C', items: [{ kind: 'note' }] },
      'clip.items[0].markdown must be a non-empty string (got undefined)',
    ],
    [
      { schema: 'cabt-clip-v1', title: 'T', created: 'C', items: [{ kind: 'position', state: 1 }] },
      'clip.items[0].replay must be a non-empty string (got undefined)',
    ],
    [
      { schema: 'cabt-clip-v1', title: 'T', created: 'C', items: [{ kind: 'position', replay: 'g.json' }] },
      'clip.items[0].state must be a non-negative integer (got undefined)',
    ],
    [
      { schema: 'cabt-clip-v1', title: 'T', created: 'C', items: [{ kind: 'position', replay: 'g.json', state: -1 }] },
      'clip.items[0].state must be a non-negative integer (got -1)',
    ],
    [
      { schema: 'cabt-clip-v1', title: 'T', created: 'C', items: [{ kind: 'position', replay: 'g.json', state: 1.5 }] },
      'clip.items[0].state must be a non-negative integer (got 1.5)',
    ],
    [
      {
        schema: 'cabt-clip-v1',
        title: 'T',
        created: 'C',
        items: [{ kind: 'position', replay: 'g.json', state: 1, focusOptions: [0, 'two'] }],
      },
      'clip.items[0].focusOptions[1] must be a non-negative integer (got "two")',
    ],
    [
      { schema: 'cabt-clip-v1', title: 'T', created: 'C', items: [{ kind: 'position', replay: 'g.json', state: 1, exact: 'yes' }] },
      'clip.items[0].exact must be a boolean (got "yes")',
    ],
    [
      { schema: 'cabt-clip-v1', title: 'T', created: 'C', items: [{ kind: 'compare', replay: 'g.json', state: 1 }] },
      'clip.items[0].lines must be an array (got undefined)',
    ],
    [
      { schema: 'cabt-clip-v1', title: 'T', created: 'C', items: [{ kind: 'compare', replay: 'g.json', state: 1, lines: [{}] }] },
      'clip.items[0].lines[0].label must be a non-empty string (got undefined)',
    ],
    [
      { schema: 'cabt-clip-v1', title: 'T', created: 'C', items: [{ kind: 5 }] },
      'clip.items[0].kind must be a non-empty string (got 5)',
    ],
    [
      { schema: 'cabt-clip-v1', title: 'T', created: 'C', items: ['note'] },
      'clip.items[0] must be an object (got "note")',
    ],
    [null, 'clip must be an object (got null)'],
  ])('rejects %j', (input, message) => {
    expect(() => parseClip(input)).toThrowError(message);
  });
});

describe('clipReplayCandidates', () => {
  it('uses absolute refs verbatim', () => {
    expect(clipReplayCandidates('/local-replays/game.json')).toEqual(['/local-replays/game.json']);
    expect(clipReplayCandidates('https://example.test/game.json')).toEqual(['https://example.test/game.json']);
    expect(clipReplayCandidates('http://example.test/game.json')).toEqual(['http://example.test/game.json']);
  });

  it('routes gamebank refs to the game-bank replay endpoint', () => {
    expect(clipReplayCandidates('gamebank:abc-123')).toEqual(['/game-bank/replays/abc-123']);
    expect(clipReplayCandidates('gamebank:abc 123')).toEqual(['/game-bank/replays/abc%20123']);
  });

  it('resolves a bare name as an artifact, encoding each path segment', () => {
    expect(clipReplayCandidates('run-7/game 1.json')).toEqual(['/cabt-artifacts/run-7/game%201.json']);
  });

  it('rejects an empty or id-less ref', () => {
    expect(() => clipReplayCandidates('  ')).toThrowError('clip replay ref is empty');
    expect(() => clipReplayCandidates('gamebank:')).toThrowError(/missing a game-bank id/);
  });
});

describe('clip URL helpers', () => {
  it('fetches absolute clip refs directly and manifest refs from artifacts', () => {
    expect(clipUrl('/clips-demo.json')).toBe('/clips-demo.json');
    expect(clipUrl('https://example.test/c.json')).toBe('https://example.test/c.json');
    expect(clipUrl('viewer-clips/opening tour.json')).toBe('/cabt-artifacts/viewer-clips/opening%20tour.json');
    expect(() => clipUrl('')).toThrowError('clip ref is empty');
  });

  it('builds a clip deep link that drops the previous mode', () => {
    expect(clipViewerUrl('https://viewer.test/?view=replay&state=12', 'viewer-clips/a.json'))
      .toBe('https://viewer.test/?view=clip&clip=viewer-clips%2Fa.json');
  });

  it('builds an "open full replay" link at the item state', () => {
    expect(clipReplayViewerUrl('https://viewer.test/?view=clip&clip=x.json', {
      kind: 'position',
      replay: 'gamebank:g-1',
      state: 87,
    })).toBe('https://viewer.test/?view=replay&replayUrl=%2Fgame-bank%2Freplays%2Fg-1&state=87');
  });

  it('carries the item exact-decision flag into the replay link', () => {
    expect(clipReplayViewerUrl('https://viewer.test/', {
      kind: 'position',
      replay: '/local-replays/game.json',
      state: 3,
      exact: true,
    })).toBe('https://viewer.test/?view=replay&replayUrl=%2Flocal-replays%2Fgame.json&detail=exact&state=3');
  });
});

describe('clip manifest', () => {
  it('normalizes entries and skips malformed rows', () => {
    expect(parseClipManifest({
      clips: [
        { file: 'viewer-clips/a.json', title: 'A', created: '2026-08-09', author: 'agent', items: 5, summary: 'S' },
        { file: 'viewer-clips/b.json' },
        { title: 'no file' },
        null,
      ],
    })).toEqual({
      clips: [
        { file: 'viewer-clips/a.json', title: 'A', created: '2026-08-09', author: 'agent', items: 5, summary: 'S' },
        { file: 'viewer-clips/b.json', title: 'viewer-clips/b.json' },
      ],
    });
  });

  it('treats a manifest without a clips array as empty', () => {
    expect(parseClipManifest({})).toEqual({ clips: [] });
    expect(parseClipManifest(null)).toEqual({ clips: [] });
  });

  it('loads the manifest from the artifact server', async () => {
    const fetcher = vi.fn(async () => new Response(
      JSON.stringify({ clips: [{ file: 'viewer-clips/a.json', title: 'A' }] }),
      { status: 200 },
    ));
    await expect(loadClipManifest(fetcher as unknown as typeof fetch)).resolves.toEqual({
      clips: [{ file: 'viewer-clips/a.json', title: 'A' }],
    });
    expect(fetcher).toHaveBeenCalledWith(clipManifestUrl);
  });

  it('reports a missing manifest as a status failure', async () => {
    const fetcher = vi.fn(async () => new Response('', { status: 404 }));
    await expect(loadClipManifest(fetcher as unknown as typeof fetch)).rejects.toThrowError(
      `${clipManifestUrl}: 404`,
    );
  });
});
