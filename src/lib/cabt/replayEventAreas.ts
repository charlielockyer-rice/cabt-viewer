import { isMoveCardKind } from './replayActionGroups';
import type { ActionTimelineEvent } from '../game/types';

export function replayEventSerial(event: ActionTimelineEvent): number | undefined {
  const params = event.params as Record<string, unknown> | undefined;
  const serial = Number(params?.serial);
  return Number.isFinite(serial) ? serial : undefined;
}

export function isReplayMoveBetween(event: ActionTimelineEvent, fromArea: number, toArea: number): boolean {
  const params = event.params as Record<string, unknown> | undefined;
  return isMoveCardKind(event.kind)
    && Number(params?.fromArea) === fromArea
    && Number(params?.toArea) === toArea;
}
