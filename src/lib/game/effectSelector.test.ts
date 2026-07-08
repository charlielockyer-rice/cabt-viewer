import { describe, expect, it } from 'vitest';
import { commitPick, observeDecision, pickTally, runProgress, type EffectRun } from './effectSelector';
import type { BoardSlotRef, DecisionView } from './types';

// Shapes captured from the real engine's Phantom Dive probe: six sequential
// single-pick CARD selects over bench refs, remainDamageCounter 6..1.
function placementDecision(seq: number, remaining: number): DecisionView {
  return {
    seq,
    seat: 0,
    kind: 'choose-cards',
    message: 'Put damage counters',
    min: 1,
    max: 1,
    remaining,
    remainingKind: 'damage',
    options: [0, 1, 2].map((index) => ({
      index,
      type: 3,
      label: `Bench ${index + 1}`,
      board: { ownerIndex: 1, slot: 'bench', index } satisfies BoardSlotRef,
    })),
  };
}

const bench = (index: number): BoardSlotRef => ({ ownerIndex: 1, slot: 'bench', index });

describe('effectSelector', () => {
  it('starts a run on the first countdown decision', () => {
    const run = observeDecision(null, placementDecision(4, 6));
    expect(run).toMatchObject({ message: 'Put damage counters', remainingKind: 'damage', total: 6, lastRemaining: 6, picks: [] });
  });

  it('continues while the countdown does not increase and keeps committed picks', () => {
    let run = observeDecision(null, placementDecision(4, 6));
    run = commitPick(run, placementDecision(4, 6), [0]);
    run = observeDecision(run, placementDecision(5, 5));
    run = commitPick(run, placementDecision(5, 5), [0]);
    run = observeDecision(run, placementDecision(6, 4));
    run = commitPick(run, placementDecision(6, 4), [2]);
    expect(run?.total).toBe(6);
    expect(pickTally(run, bench(0))).toBe(2);
    expect(pickTally(run, bench(2))).toBe(1);
    expect(pickTally(run, bench(1))).toBe(0);
    expect(runProgress(run)).toEqual({ placed: 3, total: 6 });
  });

  it('drives a complete six-counter placement', () => {
    let run: EffectRun | null = null;
    const picks = [[0], [2], [1], [0], [2], [1]];
    for (let step = 0; step < 6; step += 1) {
      const decision = placementDecision(step, 6 - step);
      run = observeDecision(run, decision);
      run = commitPick(run, decision, picks[step]);
    }
    expect(runProgress(run)).toEqual({ placed: 6, total: 6 });
    expect(pickTally(run, bench(0))).toBe(2);
    expect(pickTally(run, bench(1))).toBe(2);
    expect(pickTally(run, bench(2))).toBe(2);
    expect(observeDecision(run, { ...placementDecision(10, 1), remaining: undefined, remainingKind: undefined, kind: 'main' })).toBeNull();
  });

  it('resets when the decision carries no countdown', () => {
    const run = observeDecision(null, placementDecision(4, 6));
    expect(observeDecision(run, undefined)).toBeNull();
    expect(observeDecision(run, { ...placementDecision(5, 5), remaining: undefined, remainingKind: undefined })).toBeNull();
  });

  it('starts a fresh run when the countdown restarts (second effect, same message)', () => {
    let run = observeDecision(null, placementDecision(4, 2));
    run = commitPick(run, placementDecision(4, 2), [1]);
    run = observeDecision(run, placementDecision(5, 1));
    run = commitPick(run, placementDecision(5, 1), [1]);
    const fresh = observeDecision(run, placementDecision(9, 6));
    expect(fresh?.total).toBe(6);
    expect(fresh?.picks).toEqual([]);
  });

  it('starts a fresh run when the message changes', () => {
    const run = observeDecision(null, placementDecision(4, 6));
    const other = observeDecision(run, { ...placementDecision(5, 5), message: 'Choose Energy to discard', remainingKind: 'energy' });
    expect(other?.total).toBe(5);
    expect(other?.remainingKind).toBe('energy');
    expect(other?.picks).toEqual([]);
  });

  it('ignores picks whose options carry no board ref, and stale commits', () => {
    let run = observeDecision(null, placementDecision(4, 6));
    const noBoard = placementDecision(4, 6);
    noBoard.options = noBoard.options.map((option) => ({ ...option, board: undefined }));
    run = commitPick(run, noBoard, [0]);
    expect(run?.picks).toEqual([]);
    const stale = { ...placementDecision(3, 6), message: 'Something else' };
    run = commitPick(run, stale, [0]);
    expect(run?.picks).toEqual([]);
  });

  it('reports no progress for single-pick countdowns', () => {
    const run = observeDecision(null, placementDecision(4, 1));
    expect(runProgress(run)).toBeUndefined();
  });
});
