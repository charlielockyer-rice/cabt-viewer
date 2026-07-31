import { describe, expect, it } from 'vitest';
import type { ReplayStep } from './replay';
import {
  replayPositionFromSearch,
  replayStepFromSearch,
  replayStepForState,
  replayUrlAtState,
} from './replayLocation';

describe('replay position links', () => {
  const steps = [step(0), step(2), step(5), step(5), step(9)];

  it('opens an exact requested state and falls back to the nearest earlier state', () => {
    expect(replayStepFromSearch('?state=5', steps)).toBe(2);
    expect(replayStepFromSearch('?state=7', steps)).toBe(3);
    expect(replayStepForState(steps, 99)).toBe(4);
  });

  it('lets an explicit replay step disambiguate multiple steps at one state', () => {
    expect(replayStepFromSearch('?state=5&step=3', steps)).toBe(3);
    expect(replayStepFromSearch('?step=99', steps)).toBe(4);
  });

  it('keeps a raw state that the action timeline collapsed', () => {
    expect(replayPositionFromSearch('?state=7', steps, 10)).toEqual({
      stepIndex: 3,
      stateIndex: 7,
    });
  });

  it('writes a shareable URL with the exact step when supplied', () => {
    expect(replayUrlAtState(
      'http://localhost:5173/?view=replay&replay=game.json&step=8',
      12,
      3,
    )).toBe('http://localhost:5173/?view=replay&replay=game.json&step=3&state=12');
  });
});

function step(stateIndex: number): ReplayStep {
  return {
    index: 0,
    label: 'Step',
    stateIndex,
    actionIndex: null,
    turn: 1,
    phase: 0,
    activePlayerIndex: 0,
    type: 'test',
    payload: {},
  };
}
