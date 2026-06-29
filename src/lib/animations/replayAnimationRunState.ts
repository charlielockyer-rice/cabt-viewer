import type { ActionTimelineEvent } from '../game/types';

export type ReplayAnimationRunChange = {
  firstRun: boolean;
  scopeChanged: boolean;
  planChanged: boolean;
  shouldStartPlan: boolean;
};

export class ReplayAnimationRunState {
  readonly seenEventIds = new Set<number>();
  private initialized = false;
  private lastScopeKey: string | number = '';
  private lastPlanKey = '';

  update(scopeKey: string | number, planKey: string): ReplayAnimationRunChange {
    const firstRun = !this.initialized;
    const scopeChanged = this.initialized && scopeKey !== this.lastScopeKey;
    const planChanged = planKey !== this.lastPlanKey;
    this.initialized = true;
    this.lastScopeKey = scopeKey;
    this.lastPlanKey = planKey;
    return {
      firstRun,
      scopeChanged,
      planChanged,
      shouldStartPlan: firstRun || planChanged || scopeChanged,
    };
  }

  hasSeen(event: ActionTimelineEvent): boolean {
    return this.seenEventIds.has(event.id);
  }

  markEventsSeen(events: ActionTimelineEvent[]) {
    for (const event of events) {
      this.seenEventIds.add(event.id);
    }
  }
}
