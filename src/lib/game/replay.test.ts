import { describe, expect, it } from 'vitest';
import { replayAnimationPhaseGapMs, replayStepPlaybackDelayMs, type ReplayStep } from './replay';

describe('replayStepPlaybackDelayMs', () => {
  it('uses the normal delay for ordinary replay steps', () => {
    expect(replayStepPlaybackDelayMs(step([]), 850)).toBe(850);
  });

  it('waits for all animation phases before autoplay advances', () => {
    expect(replayStepPlaybackDelayMs(step([360, 480, 980, 390]), 850)).toBe(
      360 + 480 + 980 + 390 + replayAnimationPhaseGapMs * 4,
    );
  });
});

function step(phaseDurations: number[]): ReplayStep {
  return {
    index: 0,
    label: 'Step',
    stateIndex: 0,
    actionIndex: null,
    turn: 1,
    phase: 0,
    activePlayerIndex: 0,
    type: 'Test',
    payload: {},
    animationPhases: phaseDurations.map((durationMs, index) => ({
      key: `phase-${index}`,
      kind: 'Draw',
      view: {
        players: [],
        activePlayerIndex: 0,
        turn: 1,
        phase: 0,
        logs: [],
        prompts: [],
      },
      actionTimeline: [],
      durationMs,
    })),
  };
}
