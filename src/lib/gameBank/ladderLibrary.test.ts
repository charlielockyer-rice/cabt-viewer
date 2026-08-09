import { describe, expect, it, vi } from 'vitest';
import {
  ladderReplayUrl,
  loadLadderDays,
  loadLadderEpisodes,
  parseLadderDays,
  parseLadderEpisodes,
} from './ladderLibrary';

describe('ladder library client', () => {
  it('builds replay urls the sidecar can validate', () => {
    expect(ladderReplayUrl('2026-07-20', '87170108'))
      .toBe('/game-bank/ladder/replays/2026-07-20/87170108');
    expect(ladderReplayUrl('2026-07-20/..', '../etc'))
      .toBe('/game-bank/ladder/replays/2026-07-20%2F../..%2Fetc');
  });

  it('reads days newest first and drops blank rows', () => {
    expect(parseLadderDays({
      days: [
        { day: '2026-07-21', episodes: 3 },
        { day: '', episodes: 9 },
        { day: '2026-07-20', episodes: '4545' },
      ],
      library: '/Users/lab/cabt-library',
      available: true,
      reason: '',
    })).toEqual({
      days: [
        { day: '2026-07-21', episodes: 3 },
        { day: '2026-07-20', episodes: 4545 },
      ],
      library: '/Users/lab/cabt-library',
      available: true,
      reason: '',
    });
  });

  it('keeps the unavailable reason when the mirror is missing', () => {
    const parsed = parseLadderDays({
      days: [],
      library: '/Users/lab/cabt-library',
      available: false,
      reason: 'ladder library /Users/lab/cabt-library is not mirrored on this machine',
    });
    expect(parsed.available).toBe(false);
    expect(parsed.reason).toContain('not mirrored');
  });

  it('normalises catalog rows and the metadata-free directory fallback', () => {
    const parsed = parseLadderEpisodes({
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
          team0: null,
          team1: null,
          reward0: null,
          reward1: null,
          steps: null,
          gz_bytes: null,
          raw_bytes: null,
        },
        { id: '' },
      ],
    });

    expect(parsed.day).toBe('2026-07-20');
    expect(parsed.episodes).toEqual([
      {
        id: '87170108',
        team0: 'Luca',
        team1: 'Benarg',
        reward0: -1,
        reward1: 1,
        steps: 215,
        gzBytes: 183095,
        rawBytes: 6434491,
      },
      {
        id: '87170023',
        team0: null,
        team1: null,
        reward0: null,
        reward1: null,
        steps: null,
        gzBytes: null,
        rawBytes: null,
      },
    ]);
  });

  it('loads days and one day of episodes from the local sidecar', async () => {
    const fetcher = vi.fn(async (url: string) => new Response(
      JSON.stringify(url.startsWith('/game-bank/ladder/days')
        ? { days: [{ day: '2026-07-20', episodes: 2 }], library: '/lib', available: true, reason: '' }
        : { day: '2026-07-20', episodes: [{ id: '1' }], available: true, reason: '' }),
      { status: 200 },
    ));

    const days = await loadLadderDays(fetcher as unknown as typeof fetch);
    expect(fetcher).toHaveBeenCalledWith('/game-bank/ladder/days');
    expect(days.days).toEqual([{ day: '2026-07-20', episodes: 2 }]);

    const episodes = await loadLadderEpisodes('2026-07-20', fetcher as unknown as typeof fetch);
    expect(fetcher).toHaveBeenCalledWith('/game-bank/ladder/episodes?day=2026-07-20');
    expect(episodes.episodes[0].id).toBe('1');
  });

  it('reports the failing endpoint when the sidecar is not running', async () => {
    const fetcher = vi.fn(async () => new Response('', { status: 502 }));
    await expect(loadLadderDays(fetcher as unknown as typeof fetch))
      .rejects.toThrow('/game-bank/ladder/days: 502');
  });
});
