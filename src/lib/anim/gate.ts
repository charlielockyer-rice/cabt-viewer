import { actionAnimationBatchEvents } from './timing';
import type { ActionTimelineEvent } from '../game/types';

export type GateResult = {
  scopeChanged: boolean;
  batch: ActionTimelineEvent[];
};

// The one implementation of "which events should animate this run": in
// replay, a scope change replays the whole phase; in live play, only the
// unseen tail animates. The first run after mount marks everything seen
// without animating.
//
// The unseen-tail tracking is the single live-mode adapter: live engine
// frames carry cumulative timelines against an already-updated view, unlike
// replay phases, which carry exactly their own events against a projected
// view. Everything downstream (choreograph, anchors, visibility, renderers)
// is shared between the two modes.
export class AnimationEventGate {
  private seenEventIds = new Set<number>();
  private initialized = false;
  private lastScopeKey: string | number = '';

  update(events: ActionTimelineEvent[], scopeKey: string | number, replayMode: boolean): GateResult {
    const scopeChanged = this.initialized && scopeKey !== this.lastScopeKey;
    this.lastScopeKey = scopeKey;

    if (!this.initialized) {
      for (const event of events) {
        this.seenEventIds.add(event.id);
      }
      this.initialized = true;
      return { scopeChanged: false, batch: [] };
    }

    const batch = actionAnimationBatchEvents(events, this.seenEventIds, replayMode, scopeChanged);
    for (const event of events) {
      this.seenEventIds.add(event.id);
    }
    return { scopeChanged, batch };
  }
}
