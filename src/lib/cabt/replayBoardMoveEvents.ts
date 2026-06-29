import {
  actionAnimationPhaseKind,
  actionAnimationTimelinePhaseKeyForEvent,
  isBoardPositionMove,
  isBoardToDeckMove,
  isKnockOutMove,
} from './actionAnimationPhases';
import { actionAnimationStartMs, actionAnimationTiming } from './actionAnimationSchedule';
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

export function ownsLiveBoardMovePhase(animationEvents: readonly ActionTimelineEvent[], event: ActionTimelineEvent): boolean {
  const key = actionAnimationTimelinePhaseKeyForEvent(animationEvents, event);
  const kind = key ? actionAnimationPhaseKind(key) : null;
  return kind === 'BoardMove'
    || kind === 'BoardToDeck'
    || kind === 'DeckBoardPlace'
    || kind === 'StadiumMove'
    || kind === 'KnockOut';
}

export function liveBoardMoveHandoffDelayMs(
  animationEvents: readonly ActionTimelineEvent[],
  input: {
    fromDeck: boolean;
    delayMs: number;
  },
): number {
  if (!input.fromDeck) {
    return actionAnimationTiming.boardMoveMs;
  }
  const latestDeckPlacementStartMs = Math.max(
    0,
    ...animationEvents
      .filter(isDeckBoardPlacementEvent)
      .map((event) => actionAnimationStartMs(animationEvents, event)),
  );
  return actionAnimationTiming.boardMoveMs
    + Math.max(0, latestDeckPlacementStartMs - input.delayMs);
}

function isLiveBoardMoveAreaPair(fromArea: number, toArea: number): boolean {
  return isBoardPositionMove(fromArea, toArea)
    || isDeckBoardPlacementAreaPair(fromArea, toArea)
    || isBoardToDeckMove(fromArea, toArea)
    || isKnockOutMove(fromArea, toArea)
    || (fromArea === CabtAreaType.STADIUM && toArea === CabtAreaType.DISCARD);
}
