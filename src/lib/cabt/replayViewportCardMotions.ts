import { actionAnimationTiming } from './actionAnimationPhases';
import { actionAnimationStartMs } from './actionAnimationSchedule';
import {
  handDestinationAnchorForEvent,
  handPlayTargetAnchorForEvent,
  prizeSourceAnchorForEvent,
} from './replayAnimationAnchors';
import { compactAnimationMotions } from './replayAnimationMotionUtils';
import {
  isCabtPokemonCard,
  isCabtStadiumCard,
  isCabtToolCard,
} from './replayCardData';
import { cardViewFromEvent } from './replayCardIdentity';
import {
  isReplayMoveBetween,
  replayEventMoveAreas,
  replayEventSerial,
} from './replayEventAreas';
import { finiteNumber, stringValue } from './replayEventParams';
import type { AnimationEventPhase } from './replayAnimationPhases';
import { CabtAreaType } from './types';
import type { AnimationIdentity, AnimationMotion } from '../animations/replayAnimationPlan';
import type { ActionTimelineEvent, GameView } from '../game/types';

export function drawCardMoveMotions(phase: AnimationEventPhase, view: GameView): AnimationMotion[] {
  const motionGroups = phase.events.map((event) => drawCardMoveMotionForEvent(phase, view, event));
  return compactAnimationMotions(motionGroups);
}

function drawCardMoveMotionForEvent(
  phase: AnimationEventPhase,
  view: GameView,
  event: ActionTimelineEvent,
): AnimationMotion | null | undefined {
  if (event.kind !== 'Draw' && event.kind !== 'DrawReverse') {
    return undefined;
  }
  const playerIndex = event.playerIndex;
  const params = event.params as Record<string, unknown> | undefined;
  const serial = replayEventSerial(event);
  const cardId = finiteNumber(params?.cardId);
  const targetAnchor = handDestinationAnchorForEvent(view, event);
  if (playerIndex === undefined || cardId === undefined || !targetAnchor) {
    return null;
  }

  return {
    id: `${phase.key}:draw:${event.id}:${serial ?? cardId}`,
    kind: 'card-move',
    identity: {
      kind: 'card',
      serial,
      cardId,
      name: stringValue(params?.cardName),
    },
    sourceAnchor: { kind: 'deck-top', playerIndex },
    targetAnchor,
    coordinateSpace: 'viewport',
    startMs: actionAnimationStartMs(phase.events, event),
    durationMs: actionAnimationTiming.deckDrawMs,
    spriteVisual: {
      kind: 'card',
      card: cardViewFromEvent(event),
      faceDown: event.kind === 'DrawReverse',
    },
    handoffPolicy: {
      hideSourceUntil: 'none',
      hideDestinationUntil: 'prepaint',
      removeSprite: 'prepaint',
      prepaintFrames: 2,
    },
  };
}

export function prizeTakeCardMoveMotions(phase: AnimationEventPhase, view: GameView): AnimationMotion[] {
  const motionGroups = phase.events.map((event) => prizeTakeCardMoveMotionForEvent(phase, view, event));
  return compactAnimationMotions(motionGroups);
}

function prizeTakeCardMoveMotionForEvent(
  phase: AnimationEventPhase,
  view: GameView,
  event: ActionTimelineEvent,
): AnimationMotion | null | undefined {
  if (!isPrizeToHandMoveEvent(event)) {
    return undefined;
  }
  const playerIndex = event.playerIndex;
  const params = event.params as Record<string, unknown> | undefined;
  if (playerIndex === undefined) {
    return undefined;
  }

  const sourceAnchor = prizeSourceAnchorForEvent(view, event, phase.events);
  const targetAnchor = handDestinationAnchorForEvent(view, event);
  if (!sourceAnchor || !targetAnchor) {
    return null;
  }
  const targetCard = view.players[playerIndex]?.hand[targetAnchor.kind === 'hand-card' ? targetAnchor.handIndex ?? -1 : -1];
  const serial = replayEventSerial(event) ?? targetCard?.serial;
  const cardId = finiteNumber(params?.cardId) ?? targetCard?.id;

  return {
    id: `${phase.key}:prize-take:${event.id}:${serial ?? cardId ?? 'unknown'}`,
    kind: 'card-move',
    identity: {
      kind: 'card',
      serial,
      cardId,
      name: stringValue(params?.cardName) ?? targetCard?.name,
    },
    sourceAnchor,
    targetAnchor,
    coordinateSpace: 'viewport',
    startMs: actionAnimationStartMs(phase.events, event),
    durationMs: actionAnimationTiming.prizeTakeMs,
    spriteVisual: {
      kind: 'card',
      card: cardViewFromEvent(event) ?? targetCard,
      faceDown: event.kind === 'MoveCardReverse',
    },
    handoffPolicy: {
      hideSourceUntil: 'none',
      hideDestinationUntil: 'arrival',
      removeSprite: 'arrival',
      prepaintFrames: 2,
    },
  };
}

export function handToDeckCardMoveMotions(phase: AnimationEventPhase, view: GameView): AnimationMotion[] {
  const motionGroups = phase.events.map((event) => handToDeckCardMoveMotionForEvent(phase, view, event));
  return compactAnimationMotions(motionGroups);
}

function handToDeckCardMoveMotionForEvent(
  phase: AnimationEventPhase,
  view: GameView,
  event: ActionTimelineEvent,
): AnimationMotion | null | undefined {
  if (!isHandToDeckMoveEvent(event)) {
    return undefined;
  }
  const playerIndex = event.playerIndex;
  const sourceAnchor = handDestinationAnchorForEvent(view, event);
  if (playerIndex === undefined || !sourceAnchor) {
    return undefined;
  }
  const params = event.params as Record<string, unknown> | undefined;
  const sourceCard = view.players[playerIndex]?.hand[sourceAnchor.kind === 'hand-card' ? sourceAnchor.handIndex ?? -1 : -1];
  const serial = replayEventSerial(event) ?? sourceCard?.serial;
  const cardId = finiteNumber(params?.cardId) ?? sourceCard?.id;
  if (cardId === undefined) {
    return null;
  }

  return {
    id: `${phase.key}:hand-to-deck:${event.id}:${serial ?? cardId}`,
    kind: 'card-move',
    identity: {
      kind: 'card',
      serial,
      cardId,
      name: sourceCard?.name ?? stringValue(params?.cardName),
    },
    sourceAnchor,
    targetAnchor: { kind: 'deck-top', playerIndex },
    coordinateSpace: 'viewport',
    startMs: actionAnimationStartMs(phase.events, event),
    durationMs: actionAnimationTiming.handMoveMs,
    spriteVisual: {
      kind: 'card',
      card: sourceCard ?? cardViewFromEvent(event),
      faceDown: event.kind === 'MoveCardReverse',
    },
    handoffPolicy: {
      hideSourceUntil: 'scope-exit',
      hideDestinationUntil: 'none',
      removeSprite: 'phase-end',
      prepaintFrames: 2,
    },
  };
}

export function handPlayCardMoveMotions(phase: AnimationEventPhase, view: GameView): AnimationMotion[] {
  const motionGroups = phase.events.map((event) => handPlayCardMoveMotionForEvent(phase, view, event));
  return compactAnimationMotions(motionGroups);
}

function handPlayCardMoveMotionForEvent(
  phase: AnimationEventPhase,
  view: GameView,
  event: ActionTimelineEvent,
): AnimationMotion | null | undefined {
  if (!isPlannedHandPlayMoveEvent(event)) {
    return undefined;
  }
  const playerIndex = event.playerIndex;
  const sourceAnchor = handDestinationAnchorForEvent(view, event);
  if (playerIndex === undefined || !sourceAnchor) {
    return null;
  }
  const targetAnchor = handPlayTargetAnchorForEvent(view, event);
  if (!targetAnchor) {
    return undefined;
  }
  const params = event.params as Record<string, unknown> | undefined;
  const sourceCard = view.players[playerIndex]?.hand[sourceAnchor.kind === 'hand-card' ? sourceAnchor.handIndex ?? -1 : -1];
  const serial = replayEventSerial(event) ?? sourceCard?.serial;
  const cardId = finiteNumber(params?.cardId) ?? sourceCard?.id;
  const isEvolution = event.kind === 'Evolve';
  if (cardId === undefined) {
    return null;
  }

  return {
    id: `${phase.key}:hand-play:${event.id}:${serial ?? cardId}`,
    kind: 'card-move',
    identity: {
      kind: handPlayIdentityKind(event),
      serial,
      cardId,
      name: sourceCard?.name ?? stringValue(params?.cardName),
    },
    sourceAnchor,
    targetAnchor,
    coordinateSpace: 'viewport',
    startMs: actionAnimationStartMs(phase.events, event),
    durationMs: actionAnimationTiming.handMoveMs,
    spriteVisual: {
      kind: 'card',
      card: sourceCard ?? cardViewFromEvent(event),
      faceDown: event.kind === 'MoveCardReverse',
    },
    handoffPolicy: {
      hideSourceUntil: 'scope-exit',
      hideDestinationUntil: isEvolution ? 'none' : 'arrival',
      removeSprite: isEvolution ? 'scope-exit' : 'arrival',
      prepaintFrames: 2,
    },
  };
}

function handPlayIdentityKind(event: ActionTimelineEvent): AnimationIdentity['kind'] {
  const params = event.params as Record<string, unknown> | undefined;
  const cardId = finiteNumber(params?.cardId);
  if (event.kind === 'Play' && cardId !== undefined && isCabtStadiumCard(cardId)) {
    return 'stadium';
  }
  if (event.kind === 'Play' && cardId !== undefined && isCabtPokemonCard(cardId)) {
    return 'pokemon';
  }
  const areas = replayEventMoveAreas(event);
  if (areas?.toArea === CabtAreaType.ACTIVE || areas?.toArea === CabtAreaType.BENCH) {
    return 'pokemon';
  }
  if (event.kind === 'Play' && cardId !== undefined && isCabtToolCard(cardId)) {
    return 'tool';
  }
  if (event.kind === 'Attach' && cardId !== undefined) {
    return isCabtToolCard(cardId) ? 'tool' : 'energy';
  }
  if (event.kind === 'Evolve') {
    return 'pokemon';
  }
  return 'card';
}

function isHandToDeckMoveEvent(event: ActionTimelineEvent): boolean {
  const params = event.params as Record<string, unknown> | undefined;
  return event.playerIndex !== undefined
    && isReplayMoveBetween(event, CabtAreaType.HAND, CabtAreaType.DECK)
    && replayEventSerial(event) !== undefined
    && finiteNumber(params?.cardId) !== undefined;
}

export function isPlannedHandPlayMoveEvent(event: ActionTimelineEvent): boolean {
  if (event.playerIndex === undefined) {
    return false;
  }
  if (event.kind === 'Play') {
    return finiteNumber((event.params as Record<string, unknown> | undefined)?.cardId) !== undefined;
  }
  if (event.kind === 'Attach') {
    const params = event.params as Record<string, unknown> | undefined;
    return replayEventSerial(event) !== undefined
      && finiteNumber(params?.cardId) !== undefined;
  }
  if (event.kind === 'Evolve') {
    const params = event.params as Record<string, unknown> | undefined;
    return replayEventSerial(event) !== undefined
      && finiteNumber(params?.cardId) !== undefined
      && finiteNumber(params?.serialTarget) !== undefined
      && finiteNumber(params?.cardIdTarget) !== undefined;
  }
  const areas = replayEventMoveAreas(event);
  if (!areas) {
    return false;
  }
  const params = event.params as Record<string, unknown> | undefined;
  return areas.fromArea === CabtAreaType.HAND
    && (
      areas.toArea === CabtAreaType.DISCARD
      || areas.toArea === CabtAreaType.ACTIVE
      || areas.toArea === CabtAreaType.BENCH
    )
    && replayEventSerial(event) !== undefined
    && finiteNumber(params?.cardId) !== undefined;
}

export function isPrizeToHandMoveEvent(event: ActionTimelineEvent): boolean {
  return isReplayMoveBetween(event, CabtAreaType.PRIZE, CabtAreaType.HAND);
}
