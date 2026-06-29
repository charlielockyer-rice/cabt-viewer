import { finiteNumber } from './replayEventParams';
import type { ActionTimelineEvent } from '../game/types';

export type ReplayEventMoveAreas = {
  fromArea: number;
  toArea: number;
};

export function replayEventSerial(event: ActionTimelineEvent): number | undefined {
  const params = event.params as Record<string, unknown> | undefined;
  return finiteNumber(params?.serial);
}

export function isMoveCardKind(kind: string | undefined): boolean {
  return kind === 'MoveCard' || kind === 'MoveCardReverse';
}

export function replayEventMoveAreas(event: ActionTimelineEvent): ReplayEventMoveAreas | undefined {
  if (!isMoveCardKind(event.kind)) {
    return undefined;
  }
  const params = event.params as Record<string, unknown> | undefined;
  const fromArea = finiteNumber(params?.fromArea);
  const toArea = finiteNumber(params?.toArea);
  return fromArea === undefined || toArea === undefined ? undefined : { fromArea, toArea };
}

export function isReplayMoveBetween(event: ActionTimelineEvent, fromArea: number, toArea: number): boolean {
  const areas = replayEventMoveAreas(event);
  return areas?.fromArea === fromArea && areas.toArea === toArea;
}

export function isReplayMoveFromToAny(event: ActionTimelineEvent, fromArea: number, toAreas: readonly number[]): boolean {
  const areas = replayEventMoveAreas(event);
  return areas?.fromArea === fromArea && toAreas.includes(areas.toArea);
}
