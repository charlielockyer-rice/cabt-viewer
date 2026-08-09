// Browses the ladder episode archive the beelink archiver mirrors onto this
// machine, through the same /game-bank sidecar the searched-game bank uses.
// The archived files are Kaggle envelopes served verbatim, so opening one is an
// ordinary replay URL load with no Kaggle network dependency.

export type LadderDay = {
  day: string;
  episodes: number;
};

export type LadderEpisode = {
  id: string;
  team0: string | null;
  team1: string | null;
  reward0: number | null;
  reward1: number | null;
  steps: number | null;
  gzBytes: number | null;
  rawBytes: number | null;
};

export type LadderDaysResponse = {
  days: LadderDay[];
  library: string;
  available: boolean;
  reason: string;
};

export type LadderEpisodesResponse = {
  day: string;
  episodes: LadderEpisode[];
  available: boolean;
  reason: string;
};

export async function loadLadderDays(fetcher: typeof fetch = fetch): Promise<LadderDaysResponse> {
  return parseLadderDays(await fetchJson('/game-bank/ladder/days', fetcher));
}

export async function loadLadderEpisodes(
  day: string,
  fetcher: typeof fetch = fetch,
): Promise<LadderEpisodesResponse> {
  const url = `/game-bank/ladder/episodes?${new URLSearchParams({ day }).toString()}`;
  return parseLadderEpisodes(await fetchJson(url, fetcher));
}

export function ladderReplayUrl(day: string, episodeId: string): string {
  return `/game-bank/ladder/replays/${encodeURIComponent(day)}/${encodeURIComponent(episodeId)}`;
}

export function parseLadderDays(payload: unknown): LadderDaysResponse {
  const source = payload as Partial<LadderDaysResponse> | null;
  const days = Array.isArray(source?.days) ? source.days : [];
  return {
    days: days
      .map((day) => ({ day: text(day?.day), episodes: count(day?.episodes) }))
      .filter((day) => day.day.length > 0),
    library: text(source?.library),
    available: source?.available === true,
    reason: text(source?.reason),
  };
}

export function parseLadderEpisodes(payload: unknown): LadderEpisodesResponse {
  const source = payload as { day?: unknown; episodes?: unknown; available?: unknown; reason?: unknown } | null;
  const episodes = Array.isArray(source?.episodes) ? source.episodes : [];
  return {
    day: text(source?.day),
    episodes: episodes.map(toEpisode).filter((episode) => episode.id.length > 0),
    available: source?.available === true,
    reason: text(source?.reason),
  };
}

function toEpisode(row: unknown): LadderEpisode {
  const source = row as Record<string, unknown> | null;
  return {
    id: text(source?.id),
    team0: optionalText(source?.team0),
    team1: optionalText(source?.team1),
    reward0: optionalNumber(source?.reward0),
    reward1: optionalNumber(source?.reward1),
    steps: optionalNumber(source?.steps),
    gzBytes: optionalNumber(source?.gz_bytes),
    rawBytes: optionalNumber(source?.raw_bytes),
  };
}

async function fetchJson(url: string, fetcher: typeof fetch): Promise<unknown> {
  const response = await fetcher(url);
  if (!response.ok) {
    throw new Error(`${url}: ${response.status}`);
  }
  return response.json();
}

function text(value: unknown): string {
  return value === undefined || value === null ? '' : String(value);
}

function optionalText(value: unknown): string | null {
  const resolved = text(value);
  return resolved.length > 0 ? resolved : null;
}

function optionalNumber(value: unknown): number | null {
  const resolved = Number(value);
  return value === null || value === undefined || !Number.isFinite(resolved) ? null : resolved;
}

function count(value: unknown): number {
  const resolved = Number(value);
  return Number.isFinite(resolved) ? resolved : 0;
}
