import { actionAnimationTiming } from './actionAnimationPhases';
import { actionAnimationStartMs } from './actionAnimationSchedule';
import {
  handDestinationAnchorForEvent,
  revealAttachTargetAnchorForEvent,
} from './replayAnimationAnchors';
import { cardViewFromEvent } from './replayCardIdentity';
import {
  isReplayMoveBetween,
  isReplayMoveFromToAny,
  replayEventSerial,
} from './replayEventAreas';
import { finiteNumber, stringValue } from './replayEventParams';
import type { AnimationEventPhase } from './replayAnimationPhases';
import { CabtAreaType } from './types';
import type { AnimationAnchorRef, AnimationMotion, RevealSessionStep } from '../animations/replayAnimationPlan';
import type { ActionTimelineEvent, GameView } from '../game/types';

export function revealSessionMotions(
  phase: AnimationEventPhase,
  view: GameView,
  stepEvents: ActionTimelineEvent[],
): AnimationMotion[] {
  const playerIndex = phase.events.find((event) => event.playerIndex !== undefined)?.playerIndex;
  if (playerIndex === undefined) {
    return [];
  }

  const revealEvents = stepEvents.filter((event) => isRevealSourceEvent(event, playerIndex));
  const revealIndexes = revealIndexBySerial(revealEvents);
  const steps = revealSessionStepsForPhase(phase, view, playerIndex, stepEvents, revealIndexes);
  if (!steps.length) {
    return [];
  }

  return [{
    id: `${phase.key}:reveal-session:${playerIndex}`,
    kind: 'reveal-session',
    playerIndex,
    coordinateSpace: 'viewport',
    revealCount: revealEvents.length || undefined,
    startMs: 0,
    durationMs: phase.durationMs,
    steps,
    handoffPolicy: {
      hideSourceUntil: 'none',
      hideDestinationUntil: 'prepaint',
      removeSprite: 'prepaint',
      prepaintFrames: 2,
    },
  }];
}

function revealSessionStepsForPhase(
  phase: AnimationEventPhase,
  view: GameView,
  playerIndex: number,
  stepEvents: ActionTimelineEvent[],
  revealIndexes: ReadonlyMap<number, number>,
): RevealSessionStep[] {
  if (phase.kind === 'DeckReveal') {
    return phase.events
      .filter((event) => isRevealSourceEvent(event, playerIndex))
      .map((event) => revealSessionStep(event, phase, 'reveal', {
        sourceAnchor: { kind: 'deck-top', playerIndex },
        targetAnchor: revealCardAnchor(playerIndex, event, revealIndexes),
        durationMs: actionAnimationTiming.deckRevealMs,
      }));
  }

  if (phase.kind === 'DeckSearchReveal') {
    return phase.events
      .filter((event) => isDeckToHandSearchEvent(event, playerIndex))
      .map((event) => revealSessionStep(event, phase, 'take', {
        sourceAnchor: { kind: 'deck-top', playerIndex },
        targetAnchor: handDestinationAnchorForEvent(view, event),
        durationMs: actionAnimationTiming.deckRevealMs,
      }));
  }

  if (phase.kind === 'DeckRevealReturn') {
    const returningSerials = new Set(
      phase.events
        .filter((event) => isRevealReturnEvent(event, playerIndex))
        .map(replayEventSerial)
        .filter((serial): serial is number => serial !== undefined),
    );
    const selectSteps = stepEvents
      .filter((event) => isRevealTakeEvent(event, playerIndex))
      .filter((event) => {
        const serial = replayEventSerial(event);
        return serial !== undefined && !returningSerials.has(serial);
      })
      .map((event) => revealSessionStep(event, phase, 'select', {
        sourceAnchor: revealCardAnchor(playerIndex, event, revealIndexes),
        targetAnchor: revealCardAnchor(playerIndex, event, revealIndexes),
        startMs: 0,
        durationMs: actionAnimationTiming.deckRevealReturnMs,
      }));
    const returnSteps = phase.events
      .filter((event) => isRevealReturnEvent(event, playerIndex))
      .map((event) => revealSessionStep(event, phase, 'return', {
        sourceAnchor: revealCardAnchor(playerIndex, event, revealIndexes),
        targetAnchor: { kind: 'deck-top', playerIndex },
        durationMs: actionAnimationTiming.deckRevealReturnMs,
      }));
    return [...selectSteps, ...returnSteps];
  }

  if (phase.kind === 'DeckRevealTake') {
    return phase.events
      .filter((event) => isRevealTakeEvent(event, playerIndex))
      .map((event) => revealSessionStep(event, phase, 'take', {
        sourceAnchor: revealCardAnchor(playerIndex, event, revealIndexes),
        targetAnchor: handDestinationAnchorForEvent(view, event),
        durationMs: actionAnimationTiming.handMoveMs,
      }));
  }

  if (phase.kind === 'Attach') {
    return phase.events
      .filter((event) => isRevealAttachEvent(event, playerIndex, revealIndexes))
      .map((event) => revealSessionStep(event, phase, 'attach', {
        sourceAnchor: revealCardAnchor(playerIndex, event, revealIndexes),
        targetAnchor: revealAttachTargetAnchorForEvent(view, event),
        durationMs: actionAnimationTiming.handMoveMs,
      }));
  }

  return [];
}

function revealSessionStep(
  event: ActionTimelineEvent,
  phase: AnimationEventPhase,
  kind: RevealSessionStep['kind'],
  options: {
    sourceAnchor?: AnimationAnchorRef;
    targetAnchor?: AnimationAnchorRef;
    startMs?: number;
    durationMs: number;
  },
): RevealSessionStep {
  const params = event.params as Record<string, unknown> | undefined;
  const serial = replayEventSerial(event);
  const cardId = finiteNumber(params?.cardId);
  const resolvesToVisibleDestination = kind === 'take' || kind === 'attach';
  const handoffPolicy = revealSessionStepHandoffPolicy(kind, options.sourceAnchor, resolvesToVisibleDestination);
  return {
    id: `${phase.key}:${kind}:${event.id}:${serial ?? cardId ?? 'unknown'}`,
    kind,
    identity: {
      kind: 'card',
      serial,
      cardId,
      name: stringValue(params?.cardName),
    },
    sourceAnchor: options.sourceAnchor,
    targetAnchor: options.targetAnchor,
    spriteVisual: {
      kind: 'card',
      card: cardViewFromEvent(event),
    },
    startMs: options.startMs ?? actionAnimationStartMs(phase.events, event),
    durationMs: options.durationMs,
    handoffPolicy,
  };
}

function revealSessionStepHandoffPolicy(
  kind: RevealSessionStep['kind'],
  sourceAnchor: AnimationAnchorRef | undefined,
  resolvesToVisibleDestination: boolean,
): RevealSessionStep['handoffPolicy'] {
  if (!resolvesToVisibleDestination) {
    return {
      hideSourceUntil: 'none',
      hideDestinationUntil: 'none',
      removeSprite: 'phase-end',
      prepaintFrames: 2,
    };
  }

  const directDeckSearchTake = kind === 'take' && sourceAnchor?.kind === 'deck-top';
  return {
    hideSourceUntil: 'none',
    hideDestinationUntil: directDeckSearchTake ? 'arrival' : 'prepaint',
    removeSprite: directDeckSearchTake ? 'arrival' : 'prepaint',
    prepaintFrames: 2,
  };
}

function revealIndexBySerial(revealEvents: ActionTimelineEvent[]): Map<number, number> {
  const indexes = new Map<number, number>();
  for (const [index, event] of revealEvents.entries()) {
    const serial = replayEventSerial(event);
    if (serial !== undefined) {
      indexes.set(serial, index);
    }
  }
  return indexes;
}

function revealCardAnchor(
  playerIndex: number,
  event: ActionTimelineEvent,
  revealIndexes: ReadonlyMap<number, number>,
): AnimationAnchorRef | undefined {
  const serial = replayEventSerial(event);
  if (serial === undefined) {
    return undefined;
  }
  const revealIndex = revealIndexes.get(serial);
  return revealIndex === undefined
    ? undefined
    : { kind: 'reveal-card', playerIndex, revealIndex, serial };
}

function isRevealSourceEvent(event: ActionTimelineEvent, playerIndex: number): boolean {
  return event.playerIndex === playerIndex
    && isReplayMoveFromToAny(event, CabtAreaType.DECK, [CabtAreaType.LOOKING, CabtAreaType.HAND]);
}

function isDeckToHandSearchEvent(event: ActionTimelineEvent, playerIndex: number): boolean {
  return event.playerIndex === playerIndex
    && isReplayMoveBetween(event, CabtAreaType.DECK, CabtAreaType.HAND);
}

function isRevealReturnEvent(event: ActionTimelineEvent, playerIndex: number): boolean {
  return event.playerIndex === playerIndex
    && isReplayMoveBetween(event, CabtAreaType.LOOKING, CabtAreaType.DECK);
}

function isRevealTakeEvent(event: ActionTimelineEvent, playerIndex: number): boolean {
  return event.playerIndex === playerIndex
    && isReplayMoveBetween(event, CabtAreaType.LOOKING, CabtAreaType.HAND);
}

function isRevealAttachEvent(
  event: ActionTimelineEvent,
  playerIndex: number,
  revealIndexes: ReadonlyMap<number, number>,
): boolean {
  const serial = replayEventSerial(event);
  return event.playerIndex === playerIndex
    && event.kind === 'Attach'
    && serial !== undefined
    && revealIndexes.has(serial);
}
