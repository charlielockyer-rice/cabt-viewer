const KAGGLE_DATASET_DOWNLOAD_BASE = 'https://www.kaggle.com/api/v1/datasets/download';
const EPISODE_INDEX_REF = 'kaggle/pokemon-tcg-ai-battle-episodes-index';

export type KaggleEpisodeDay = {
  date: string;
  slug: string;
  url: string;
  episodeCount: number;
  totalBytes: number;
  topAvgScore: number;
  medianAvgScore: number;
};

export type KaggleEpisodeSummary = {
  episodeId: string;
  createTime: string;
  avgScore: number;
  minScore: number;
  sumScore: number;
  agentCount: number;
  sizeBytes: number;
  dailyRank: number;
};

export type KaggleEpisodeRatingRange = {
  lower: number;
  higher: number;
};

export async function loadKaggleEpisodeDays(fetcher: typeof fetch = fetch): Promise<KaggleEpisodeDay[]> {
  const csv = await fetchText(datasetFileUrl(EPISODE_INDEX_REF, 'manifest.csv'), fetcher);
  return parseKaggleEpisodeDays(csv);
}

export async function loadKaggleEpisodesForDay(slug: string, fetcher: typeof fetch = fetch): Promise<KaggleEpisodeSummary[]> {
  const csv = await fetchText(datasetFileUrl(kaggleDatasetRef(slug), 'manifest.csv'), fetcher);
  return parseKaggleEpisodeManifest(csv);
}

export function kaggleEpisodeReplayUrl(slug: string, episodeId: string): string {
  return datasetFileUrl(kaggleDatasetRef(slug), `${encodeURIComponent(episodeId)}.json`);
}

export function inferredKaggleEpisodeRatingRange(episode: KaggleEpisodeSummary): KaggleEpisodeRatingRange {
  const lower = episode.minScore;
  const higher = episode.sumScore - episode.minScore;
  if (episode.agentCount !== 2 || !Number.isFinite(lower) || !Number.isFinite(higher)) {
    return {
      lower: episode.avgScore,
      higher: episode.avgScore,
    };
  }
  return { lower, higher };
}

export function parseKaggleEpisodeDays(csv: string): KaggleEpisodeDay[] {
  return parseCsv(csv).map((row) => ({
    date: stringField(row, 'date'),
    slug: stringField(row, 'daily_dataset_slug'),
    url: stringField(row, 'daily_dataset_url'),
    episodeCount: numberField(row, 'episode_count'),
    totalBytes: numberField(row, 'total_bytes'),
    topAvgScore: numberField(row, 'top_avg_score'),
    medianAvgScore: numberField(row, 'median_avg_score'),
  })).filter((day) => day.date && day.slug);
}

export function parseKaggleEpisodeManifest(csv: string): KaggleEpisodeSummary[] {
  return parseCsv(csv).map((row, index) => ({
    episodeId: stringField(row, 'episode_id'),
    createTime: stringField(row, 'create_time'),
    avgScore: numberField(row, 'avg_score'),
    minScore: numberField(row, 'min_score'),
    sumScore: numberField(row, 'sum_score'),
    agentCount: numberField(row, 'agent_count'),
    sizeBytes: numberField(row, 'size_bytes'),
    dailyRank: index + 1,
  })).filter((episode) => episode.episodeId);
}

function kaggleDatasetRef(slugOrRef: string): string {
  return slugOrRef.includes('/') ? slugOrRef : `kaggle/${slugOrRef}`;
}

function datasetFileUrl(datasetRef: string, fileName: string): string {
  const encodedRef = datasetRef.split('/').map(encodeURIComponent).join('/');
  return `${KAGGLE_DATASET_DOWNLOAD_BASE}/${encodedRef}/${fileName}`;
}

async function fetchText(url: string, fetcher: typeof fetch): Promise<string> {
  const response = await fetcher(url);
  if (!response.ok) {
    throw new Error(`${url}: ${response.status}`);
  }
  return response.text();
}

function parseCsv(csv: string): Array<Record<string, string>> {
  const rows = csvRows(csv.trim());
  const header = rows[0] ?? [];
  return rows.slice(1)
    .filter((row) => row.some((value) => value.length))
    .map((row) => Object.fromEntries(header.map((field, index) => [field, row[index] ?? ''])));
}

function csvRows(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < csv.length; index += 1) {
    const char = csv[index];
    const next = csv[index + 1];
    if (quoted) {
      if (char === '"' && next === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') {
      field += char;
    }
  }

  row.push(field);
  rows.push(row);
  return rows;
}

function stringField(row: Record<string, string>, field: string): string {
  return row[field]?.trim() ?? '';
}

function numberField(row: Record<string, string>, field: string): number {
  const value = Number(row[field]);
  return Number.isFinite(value) ? value : 0;
}
