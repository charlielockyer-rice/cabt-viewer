import { describe, expect, it } from 'vitest';
import {
  inferredKaggleEpisodeRatingRange,
  kaggleEpisodeReplayUrl,
  parseKaggleEpisodeDays,
  parseKaggleEpisodeManifest,
} from './episodes';

describe('Kaggle episode archive helpers', () => {
  it('parses the public episode index manifest', () => {
    const days = parseKaggleEpisodeDays([
      'date,daily_dataset_slug,daily_dataset_url,episode_count,total_bytes,top_avg_score,median_avg_score',
      '2026-06-24,pokemon-tcg-ai-battle-episodes-2026-06-24,https://www.kaggle.com/datasets/kaggle/pokemon-tcg-ai-battle-episodes-2026-06-24,5516,21471061743,1343.560242,1004.755931',
    ].join('\n'));

    expect(days).toEqual([{
      date: '2026-06-24',
      slug: 'pokemon-tcg-ai-battle-episodes-2026-06-24',
      url: 'https://www.kaggle.com/datasets/kaggle/pokemon-tcg-ai-battle-episodes-2026-06-24',
      episodeCount: 5516,
      totalBytes: 21471061743,
      topAvgScore: 1343.560242,
      medianAvgScore: 1004.755931,
    }]);
  });

  it('parses daily episode manifests with stable daily ranks', () => {
    const episodes = parseKaggleEpisodeManifest([
      'episode_id,create_time,avg_score,min_score,sum_score,agent_count,size_bytes',
      '81726640,2026-06-24T23:37:00.5148426,1343.560242,1329.273042,2687.120484,2,1856896',
      '81711777,2026-06-24T21:45:00.5760699,1343.369018,1333.061086,2686.738035,2,3323626',
    ].join('\n'));

    expect(episodes).toEqual([{
      episodeId: '81726640',
      createTime: '2026-06-24T23:37:00.5148426',
      avgScore: 1343.560242,
      minScore: 1329.273042,
      sumScore: 2687.120484,
      agentCount: 2,
      sizeBytes: 1856896,
      dailyRank: 1,
    }, {
      episodeId: '81711777',
      createTime: '2026-06-24T21:45:00.5760699',
      avgScore: 1343.369018,
      minScore: 1333.061086,
      sumScore: 2686.738035,
      agentCount: 2,
      sizeBytes: 3323626,
      dailyRank: 2,
    }]);
  });

  it('builds a lazy replay URL for an individual episode file', () => {
    expect(kaggleEpisodeReplayUrl('pokemon-tcg-ai-battle-episodes-2026-06-24', '81726640'))
      .toBe('https://www.kaggle.com/api/v1/datasets/download/kaggle/pokemon-tcg-ai-battle-episodes-2026-06-24/81726640.json');
  });

  it('infers the two agent rating range from daily aggregate scores', () => {
    expect(inferredKaggleEpisodeRatingRange({
      episodeId: '81726640',
      createTime: '2026-06-24T23:37:00.5148426',
      avgScore: 1343.560242,
      minScore: 1329.273042,
      sumScore: 2687.120484,
      agentCount: 2,
      sizeBytes: 1856896,
      dailyRank: 1,
    })).toEqual({
      lower: 1329.273042,
      higher: 1357.847442,
    });
  });
});
