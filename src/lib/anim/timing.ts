import { CabtAreaType } from '../cabt/types';
import type { ActionTimelineEvent } from '../game/types';

export const actionAnimationTiming = {
  handMoveMs: 360,
  handMoveStepMs: 60,
  deckDiscardMs: 300,
  deckDiscardStepMs: 300,
  deckDrawMs: 320,
  deckDrawStepMs: 35,
  deckShuffleMs: 980,
  deckRevealMs: 1180,
  deckRevealStepMs: 45,
  deckRevealReturnMs: 420,
  deckRevealReturnStepMs: 35,
  stadiumMoveMs: 520,
  prizeTakeMs: 1180,
  prizeTakeStepMs: 45,
  evolveMs: 680,
  attackAnnounceMs: 520,
  abilityAnnounceMs: 560,
  damageMs: 320,
  damageVisualMs: 560,
  coinFlipMs: 920,
  coinFlipStepMs: 140,
  knockOutMs: 620,
  boardMoveMs: 520,
} as const;

type AnimationPhase = {
  key: string;
  durationMs: number;
  stepMs: number;
};

export function actionAnimationStartMs(events: ActionTimelineEvent[], targetEvent: ActionTimelineEvent): number {
  let elapsedMs = 0;
  let group: { key: string; durationMs: number; stepMs: number; count: number } | null = null;

  for (const event of events) {
    const phase = animationPhaseForEvent(event);
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
    if (event.id === targetEvent.id) {
      return startMs;
    }
  }

  return elapsedMs;
}

function animationPhaseForEvent(event: ActionTimelineEvent): AnimationPhase | null {
  const playerKey = event.playerIndex ?? 'unknown';
  const params = event.params as Record<string, unknown> | undefined;
  const fromArea = Number(params?.fromArea);
  const toArea = Number(params?.toArea);

  if (event.kind === 'Play' || event.kind === 'Attach' || event.kind === 'Evolve') {
    return {
      key: `${event.kind}:${playerKey}`,
      durationMs: event.kind === 'Evolve' ? actionAnimationTiming.evolveMs : actionAnimationTiming.handMoveMs,
      stepMs: actionAnimationTiming.handMoveStepMs,
    };
  }

  if (event.kind === 'Attack') {
    return {
      key: `Attack:${playerKey}`,
      durationMs: actionAnimationTiming.attackAnnounceMs,
      stepMs: actionAnimationTiming.attackAnnounceMs,
    };
  }

  if (event.kind === 'Ability') {
    return {
      key: `Ability:${playerKey}`,
      durationMs: actionAnimationTiming.abilityAnnounceMs,
      stepMs: actionAnimationTiming.abilityAnnounceMs,
    };
  }

  if (event.kind === 'Switch') {
    return {
      key: `BoardMove:${playerKey}`,
      durationMs: actionAnimationTiming.boardMoveMs,
      stepMs: 0,
    };
  }

  if (event.kind === 'HPChange') {
    // Multi-target attacks land all their damage at once.
    return {
      key: `Damage:${playerKey}`,
      durationMs: actionAnimationTiming.damageMs,
      stepMs: 0,
    };
  }

  if (event.kind === 'Coin') {
    return {
      key: `Coin:${playerKey}`,
      durationMs: actionAnimationTiming.coinFlipMs,
      stepMs: actionAnimationTiming.coinFlipStepMs,
    };
  }

  if (event.kind === 'MoveCard' || event.kind === 'MoveCardReverse') {
    if (isBoardPositionMove(fromArea, toArea)) {
      return {
        key: `BoardMove:${playerKey}`,
        durationMs: actionAnimationTiming.boardMoveMs,
        stepMs: 0,
      };
    }
    if (isBoardToDeckMove(fromArea, toArea)) {
      return {
        key: `BoardToDeck:${playerKey}`,
        durationMs: actionAnimationTiming.boardMoveMs,
        stepMs: actionAnimationTiming.handMoveStepMs,
      };
    }
    if (isKnockOutMove(fromArea, toArea)) {
      return {
        key: `KnockOut:${playerKey}`,
        durationMs: actionAnimationTiming.knockOutMs,
        stepMs: actionAnimationTiming.knockOutMs,
      };
    }
    if (fromArea === CabtAreaType.HAND && isHandMoveDestination(toArea)) {
      return {
        key: `MoveCard:${playerKey}:${fromArea}->${toArea}`,
        durationMs: actionAnimationTiming.handMoveMs,
        stepMs: actionAnimationTiming.handMoveStepMs,
      };
    }
    if (fromArea === CabtAreaType.DECK && toArea === CabtAreaType.DISCARD) {
      return {
        key: `DeckDiscard:${playerKey}`,
        durationMs: actionAnimationTiming.deckDiscardMs,
        stepMs: actionAnimationTiming.deckDiscardStepMs,
      };
    }
    if (fromArea === CabtAreaType.DECK && toArea === CabtAreaType.LOOKING) {
      return {
        key: `DeckReveal:${playerKey}`,
        durationMs: actionAnimationTiming.deckRevealMs,
        stepMs: actionAnimationTiming.deckRevealStepMs,
      };
    }
    if (fromArea === CabtAreaType.DECK && toArea === CabtAreaType.HAND) {
      return {
        key: `DeckSearchReveal:${playerKey}`,
        durationMs: actionAnimationTiming.deckRevealMs,
        stepMs: actionAnimationTiming.deckRevealStepMs,
      };
    }
    if (fromArea === CabtAreaType.DECK && (toArea === CabtAreaType.ACTIVE || toArea === CabtAreaType.BENCH)) {
      return {
        key: `DeckBoardPlace:${playerKey}`,
        durationMs: actionAnimationTiming.boardMoveMs,
        stepMs: actionAnimationTiming.handMoveStepMs,
      };
    }
    if (fromArea === CabtAreaType.LOOKING && (toArea === CabtAreaType.DECK || toArea === CabtAreaType.DECK_BOTTOM)) {
      return {
        key: `DeckRevealReturn:${playerKey}`,
        durationMs: actionAnimationTiming.deckRevealReturnMs,
        stepMs: actionAnimationTiming.deckRevealReturnStepMs,
      };
    }
    if (fromArea === CabtAreaType.LOOKING && toArea === CabtAreaType.HAND) {
      return {
        key: `DeckRevealTake:${playerKey}`,
        durationMs: actionAnimationTiming.handMoveMs,
        stepMs: actionAnimationTiming.handMoveStepMs,
      };
    }
    if (isAttachedCardArea(fromArea) && isAttachedCardMoveDestination(toArea)) {
      return {
        key: `AttachedMove:${playerKey}:${fromArea}->${toArea}`,
        durationMs: actionAnimationTiming.handMoveMs,
        stepMs: actionAnimationTiming.handMoveStepMs,
      };
    }
    if (fromArea === CabtAreaType.STADIUM && toArea === CabtAreaType.DISCARD) {
      return {
        key: `StadiumMove:${playerKey}:${fromArea}->${toArea}`,
        durationMs: actionAnimationTiming.stadiumMoveMs,
        stepMs: actionAnimationTiming.handMoveStepMs,
      };
    }
    if (fromArea === CabtAreaType.PRIZE && toArea === CabtAreaType.HAND) {
      return {
        key: `PrizeTake:${playerKey}`,
        durationMs: actionAnimationTiming.prizeTakeMs,
        stepMs: actionAnimationTiming.prizeTakeStepMs,
      };
    }
  }

  if (event.kind === 'Shuffle') {
    return {
      key: `Shuffle:${playerKey}`,
      durationMs: actionAnimationTiming.deckShuffleMs,
      stepMs: actionAnimationTiming.deckShuffleMs,
    };
  }

  if (event.kind === 'Draw' || event.kind === 'DrawReverse') {
    return {
      key: `Draw:${playerKey}`,
      durationMs: actionAnimationTiming.deckDrawMs,
      stepMs: actionAnimationTiming.deckDrawStepMs,
    };
  }

  return null;
}

function phaseDurationMs(durationMs: number, stepMs: number, count: number): number {
  return count <= 0 ? 0 : durationMs + Math.max(0, count - 1) * stepMs;
}

function isHandMoveDestination(area: number): boolean {
  return area === CabtAreaType.DISCARD
    || area === CabtAreaType.ACTIVE
    || area === CabtAreaType.BENCH
    || area === CabtAreaType.DECK;
}

function isKnockOutMove(fromArea: number, toArea: number): boolean {
  return toArea === CabtAreaType.DISCARD
    && (fromArea === CabtAreaType.ACTIVE || fromArea === CabtAreaType.BENCH);
}

function isBoardPositionMove(fromArea: number, toArea: number): boolean {
  return (fromArea === CabtAreaType.ACTIVE && toArea === CabtAreaType.BENCH)
    || (fromArea === CabtAreaType.BENCH && toArea === CabtAreaType.ACTIVE);
}

function isBoardToDeckMove(fromArea: number, toArea: number): boolean {
  return toArea === CabtAreaType.DECK
    && (fromArea === CabtAreaType.ACTIVE || fromArea === CabtAreaType.BENCH);
}

function isAttachedCardArea(area: number): boolean {
  return area === CabtAreaType.ENERGY
    || area === CabtAreaType.TOOL;
}

function isAttachedCardMoveDestination(area: number): boolean {
  return area === CabtAreaType.DISCARD
    || area === CabtAreaType.DECK;
}
