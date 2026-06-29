import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadGameLogs } from './catalog';

describe('home catalog', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('loads local engine replays when directory enumeration is available', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      expect(url).toBe('/local-engine/replays');
      return response({
        ok: true,
        replays: [{ id: 'local-1', name: 'Local 1', file: 'local-1.json' }],
      });
    }));

    await expect(loadGameLogs()).resolves.toEqual([
      { id: 'local-1', name: 'Local 1', file: 'local-1.json' },
    ]);
  });

  it('falls back to the static manifest when the local engine is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === '/local-engine/replays') {
        throw new Error('offline');
      }
      expect(url).toBe('/game-logs/logs.json');
      return response({
        logs: [{ id: 'fixture', name: 'Fixture', file: 'fixture.json' }],
      });
    }));

    await expect(loadGameLogs()).resolves.toEqual([
      { id: 'fixture', name: 'Fixture', file: 'fixture.json' },
    ]);
  });
});

function response(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as Response;
}
