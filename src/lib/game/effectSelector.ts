import { sameBoardRef } from './decisions';
import type { BoardSlotRef, DecisionView } from './types';

// A board effect run: the consecutive decisions one resolving effect emits as
// a countdown of repeated picks (damage counter placement, energy payment).
// Recognized purely by structural signature — the select carries `remaining`
// — never by card or attack names. Tracking the run lets the board wear
// counter chips on targets and show running progress while it plays.

export type EffectRun = {
  // Structural identity: the countdown kind plus the select's message. A new
  // effect with the same message starts a fresh run because its countdown
  // restarts above the last observed value.
  message: string;
  remainingKind: 'damage' | 'energy';
  // The countdown's starting size — `remaining` when the run began.
  total: number;
  // `remaining` on the decision last observed.
  lastRemaining: number;
  // Board refs of committed picks, in pick order.
  picks: BoardSlotRef[];
};

// Fold the next decision into the run state. Call once per decision seq;
// returns null when no countdown select is active.
export function observeDecision(run: EffectRun | null, decision: DecisionView | undefined): EffectRun | null {
  if (!decision || decision.remaining === undefined || decision.remainingKind === undefined || decision.kind === 'main') {
    return null;
  }
  if (run
    && run.message === decision.message
    && run.remainingKind === decision.remainingKind
    && decision.remaining <= run.lastRemaining) {
    return { ...run, lastRemaining: decision.remaining };
  }
  return {
    message: decision.message,
    remainingKind: decision.remainingKind,
    total: decision.remaining,
    lastRemaining: decision.remaining,
    picks: [],
  };
}

// Record the picks a select answer names, keyed to the decision it answers.
// Only board-ref options leave chips; other options still advance `remaining`
// via the next observation.
export function commitPick(run: EffectRun | null, decision: DecisionView, indexes: number[]): EffectRun | null {
  if (!run || decision.remaining === undefined || decision.message !== run.message) {
    return run;
  }
  const picked = indexes
    .map((index) => decision.options.find((option) => option.index === index)?.board)
    .filter((ref): ref is BoardSlotRef => !!ref);
  return picked.length ? { ...run, picks: [...run.picks, ...picked] } : run;
}

export function pickTally(run: EffectRun | null, slot: BoardSlotRef): number {
  if (!run) {
    return 0;
  }
  return run.picks.filter((ref) => sameBoardRef(ref, slot)).length;
}

// Progress counted from committed picks so the banner and chips move on the
// click, not a round-trip later.
export function runProgress(run: EffectRun | null): { placed: number; total: number } | undefined {
  if (!run || run.total <= 1) {
    return undefined;
  }
  return { placed: Math.min(run.picks.length, run.total), total: run.total };
}
