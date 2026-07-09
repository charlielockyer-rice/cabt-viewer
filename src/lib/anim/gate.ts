import type { ActionTimelineEvent } from '../game/types';

export type GateResult = {
  scopeChanged: boolean;
  batch: ActionTimelineEvent[];
};

// The one implementation of "which events should animate this run". A scope
// is one animation step — a replay phase or a live playback step — and both
// carry exactly their own events, so a scope change animates the whole list
// and an unchanged scope animates nothing. The first run after mount only
// records the scope, so pre-existing state never animates.
export class AnimationEventGate {
  private initialized = false;
  private lastScopeKey: string | number = '';

  update(events: ActionTimelineEvent[], scopeKey: string | number): GateResult {
    const scopeChanged = this.initialized && scopeKey !== this.lastScopeKey;
    this.lastScopeKey = scopeKey;

    if (!this.initialized) {
      this.initialized = true;
      return { scopeChanged: false, batch: [] };
    }

    return { scopeChanged, batch: scopeChanged ? events : [] };
  }
}

// The one definition of "the current scope has ended; release its held sprites
// and visibility claims". Replay ends a scope when the phase key changes; live
// ends it when the next authoritative view is applied (a monotonic apply
// signal), which also covers the settled interactive view at the end of a
// sequence — the poll-free hold-to-boundary handoff. The three animation layers
// share this instead of each hand-rolling the predicate.
export function scopeEnded(
  replayMode: boolean,
  { scopeChanged, applyChanged }: { scopeChanged: boolean; applyChanged: boolean },
): boolean {
  return replayMode ? scopeChanged : applyChanged;
}
