import {
  actionAnimationTimelinePhaseForEvent,
  actionAnimationTiming,
} from './actionAnimationPhases';
import type { ActionTimelineEvent } from '../game/types';

export { actionAnimationTiming };

export function actionAnimationBatchEvents(
  events: ActionTimelineEvent[],
  seenEventIds: ReadonlySet<number>,
): ActionTimelineEvent[] {
  const firstUnseenIndex = events.findIndex((event) => !seenEventIds.has(event.id));
  return firstUnseenIndex === -1 ? [] : events.slice(firstUnseenIndex);
}

export function actionAnimationStartMs(events: ActionTimelineEvent[], targetEvent: ActionTimelineEvent): number {
  let elapsedMs = 0;
  let group: { key: string; durationMs: number; stepMs: number; count: number } | null = null;
  const phaseKeys: string[] = [];

  for (const event of events) {
    const phase = actionAnimationTimelinePhaseForEvent(event, phaseKeys);
    if (!phase) {
      if (event.id === targetEvent.id) {
        return elapsedMs;
      }
      continue;
    }

    if (!group || group.key !== phase.key) {
      if (group) {
        elapsedMs += phaseDurationMs(group.durationMs, group.stepMs, group.count);
      }
      group = {
        key: phase.key,
        durationMs: phase.durationMs,
        stepMs: phase.stepMs,
        count: 0,
      };
    }

    const startMs = elapsedMs + group.count * group.stepMs;
    group.count += 1;
    phaseKeys.push(phase.key);
    if (event.id === targetEvent.id) {
      return startMs;
    }
  }

  return elapsedMs;
}

function phaseDurationMs(durationMs: number, stepMs: number, count: number): number {
  return count <= 0 ? 0 : durationMs + Math.max(0, count - 1) * stepMs;
}
