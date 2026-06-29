import {
  isBoardPositionMove,
  isBoardToDeckMove,
  isKnockOutMove,
} from './actionAnimationPhases';
import { replayEventMoveAreas } from './replayEventAreas';
import { CabtAreaType } from './types';
import type { ActionTimelineEvent } from '../game/types';

export function isLiveBoardMoveEvent(event: ActionTimelineEvent): boolean {
  if (event.kind === 'Switch') {
    return true;
  }
  const areas = replayEventMoveAreas(event);
  return event.kind === 'MoveCard'
    && areas !== undefined
    && isLiveBoardMoveAreaPair(areas.fromArea, areas.toArea);
}

export function isDeckBoardPlacementEvent(event: ActionTimelineEvent): boolean {
  const areas = replayEventMoveAreas(event);
  return event.kind === 'MoveCard'
    && areas !== undefined
    && isDeckBoardPlacementAreaPair(areas.fromArea, areas.toArea);
}

export function isDeckBoardPlacementAreaPair(fromArea: number, toArea: number): boolean {
  return fromArea === CabtAreaType.DECK
    && (toArea === CabtAreaType.ACTIVE || toArea === CabtAreaType.BENCH);
}

function isLiveBoardMoveAreaPair(fromArea: number, toArea: number): boolean {
  return isBoardPositionMove(fromArea, toArea)
    || isDeckBoardPlacementAreaPair(fromArea, toArea)
    || isBoardToDeckMove(fromArea, toArea)
    || isKnockOutMove(fromArea, toArea)
    || (fromArea === CabtAreaType.STADIUM && toArea === CabtAreaType.DISCARD);
}
