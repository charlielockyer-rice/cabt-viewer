import type { ReplayStep } from './replay';

export type ReplayPosition = {
  stepIndex: number;
  stateIndex: number;
};

export function replayPositionFromSearch(
  search: string,
  steps: ReplayStep[],
  stateCount: number,
): ReplayPosition {
  const params = new URLSearchParams(search);
  const requestedStep = nonnegativeInteger(params.get('step'));
  const requestedState = nonnegativeInteger(params.get('state'));
  const stepIndex = requestedStep === null
    ? replayStepForState(steps, requestedState ?? 0)
    : clamp(requestedStep, Math.max(0, steps.length - 1));
  const stateIndex = requestedState === null
    ? (steps[stepIndex]?.stateIndex ?? 0)
    : clamp(requestedState, Math.max(0, stateCount - 1));
  return { stepIndex, stateIndex };
}

export function replayStepFromSearch(search: string, steps: ReplayStep[]): number {
  const lastState = steps.reduce((highest, step) => Math.max(highest, step.stateIndex), 0);
  return replayPositionFromSearch(search, steps, lastState + 1).stepIndex;
}

export function replayStepForState(steps: ReplayStep[], stateIndex: number): number {
  if (!steps.length) {
    return 0;
  }
  const requested = Math.max(0, Math.round(stateIndex));
  const exact = steps.findIndex((step) => step.stateIndex === requested);
  if (exact !== -1) {
    return exact;
  }
  let best = 0;
  for (let index = 0; index < steps.length; index += 1) {
    if (steps[index].stateIndex <= requested) {
      best = index;
    }
  }
  return best;
}

export function replayUrlAtState(url: string, stateIndex: number, stepIndex?: number): string {
  const next = new URL(url);
  next.searchParams.set('state', String(Math.max(0, Math.round(stateIndex))));
  if (stepIndex === undefined) {
    next.searchParams.delete('step');
  } else {
    next.searchParams.set('step', String(Math.max(0, Math.round(stepIndex))));
  }
  return next.toString();
}

function nonnegativeInteger(value: string | null): number | null {
  if (value === null || !/^\d+$/.test(value)) {
    return null;
  }
  return Number(value);
}

function clamp(value: number, max: number): number {
  return Math.min(max, Math.max(0, value));
}
