export type SearchedGameDeck = {
  deck_id: string;
  family_id: string;
  family_name: string;
};

export type SearchedGame = {
  id: string;
  game_uid: string;
  campaign_id: string;
  created_utc: string;
  source: string;
  episode_bytes: number;
  status: string;
  winner_seat: number | null;
  steps: number;
  wall_s: number;
  seed: number;
  is_mirror: boolean;
  matchup_id: string;
  search_regime: string;
  search_depth: number;
  search_depths: number[];
  search_id: string;
  model_name: string;
  model_dtype: string;
  model_id: string;
  decks: SearchedGameDeck[];
  decision_count: number;
  searched_decisions: number;
  changed_decisions: number;
  trainable_decisions: number;
};

export type SearchedGameFacets = {
  depths: number[];
  models: string[];
  decks: Array<{ id: string; name: string }>;
  statuses: string[];
  sources: string[];
};

export type GameBankSourceStatus = {
  ok: boolean;
  games: number;
  error: string;
  stale: boolean;
  scan_s: number;
};

export type SearchedGameResponse = {
  ok: boolean;
  refreshing: boolean;
  refreshedAt: string;
  availableSources: number;
  configuredSources: number;
  sources: Record<string, GameBankSourceStatus>;
  total: number;
  offset: number;
  limit: number;
  games: SearchedGame[];
  facets: SearchedGameFacets;
};

export type SearchedGameFilters = {
  q?: string;
  depth?: string;
  model?: string;
  deck?: string;
  status?: string;
  source?: string;
  sort?: string;
  nonce?: string;
  offset?: number;
  limit?: number;
};

export async function loadSearchedGames(
  filters: SearchedGameFilters = {},
  fetcher: typeof fetch = fetch,
): Promise<SearchedGameResponse> {
  const params = searchedGameParams(filters);
  const response = await fetcher(`/game-bank/games?${params.toString()}`);
  if (!response.ok) {
    throw new Error(`/game-bank/games: ${response.status}`);
  }
  return response.json() as Promise<SearchedGameResponse>;
}

export async function refreshSearchedGameBank(fetcher: typeof fetch = fetch): Promise<void> {
  const response = await fetcher('/game-bank/refresh', { method: 'POST' });
  if (!response.ok) {
    throw new Error(`/game-bank/refresh: ${response.status}`);
  }
}

export function searchedGameReplayUrl(game: Pick<SearchedGame, 'id'>): string {
  return `/game-bank/replays/${encodeURIComponent(game.id)}`;
}

export function searchedGameParams(filters: SearchedGameFilters): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null || value === '') {
      continue;
    }
    params.set(key, String(value));
  }
  return params;
}
