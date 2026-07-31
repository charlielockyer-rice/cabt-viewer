import { describe, expect, it } from 'vitest';
import { nextReplayDisagreement, replayDecisionAnalyses } from './replayAnalysis';

describe('replay decision analysis', () => {
  it('keeps annotations aligned to viewer state indexes', () => {
    expect(replayDecisionAnalyses({
      visualize: [
        { current: {}, analysis: { mode: 'search', changed: true } },
        { current: {} },
        { current: {}, analysis: { mode: 'policy', playedSelection: [2] } },
      ],
    })).toEqual([
      { stateIndex: 0, mode: 'search', changed: true },
      { stateIndex: 2, mode: 'policy', playedSelection: [2] },
    ]);
  });

  it('finds the next decision where search changed the policy move', () => {
    const analyses = replayDecisionAnalyses({
      visualize: [
        { analysis: { changed: true } },
        { analysis: { changed: false } },
        { analysis: { changed: true } },
      ],
    });

    expect(nextReplayDisagreement(analyses, 0)?.stateIndex).toBe(2);
    expect(nextReplayDisagreement(analyses, 2)).toBeNull();
  });
});
