import { describe, expect, it, vi } from 'vitest';
import {
  loadSearchedGames,
  searchedGameParams,
  searchedGameReplayUrl,
} from './searchedGames';

describe('searched game bank client', () => {
  it('builds compact server-side filter queries', () => {
    expect(searchedGameParams({ depth: '128', deck: 'dragapult', status: 'complete', offset: 150 }).toString())
      .toBe('depth=128&deck=dragapult&status=complete&offset=150');
  });

  it('encodes stable replay ids', () => {
    expect(searchedGameReplayUrl({ id: 'spark8:game/1' }))
      .toBe('/game-bank/replays/spark8%3Agame%2F1');
  });

  it('loads the response from the local sidecar', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ games: [], total: 0 }), { status: 200 }));
    const response = await loadSearchedGames({ depth: '256' }, fetcher as typeof fetch);
    expect(fetcher).toHaveBeenCalledWith('/game-bank/games?depth=256');
    expect(response.total).toBe(0);
  });
});
