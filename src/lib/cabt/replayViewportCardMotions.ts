import { actionAnimationTiming } from './actionAnimationPhases';
import { actionAnimationStartMs } from './actionAnimationSchedule';
import {
  handDestinationAnchorForEvent,
  handPlayTargetAnchorForEvent,
  prizeSourceAnchorForEvent,
} from './replayAnimationAnchors';
import { isMoveCardKind } from './replayActionGroups';
import {
  isCabtPokemonCard,
  isCabtStadiumCard,
  isCabtToolCard,
} from './replayCardData';
import { cardViewFromEvent } from './replayCardIdentity';
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
  const serial = finiteNumber(params?.serial);
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
  if (!isMoveCardKind(event.kind)) {
    return undefined;
  }
  const playerIndex = event.playerIndex;
  const params = event.params as Record<string, unknown> | undefined;
  if (
    playerIndex === undefined
    || Number(params?.fromArea) !== CabtAreaType.PRIZE
    || Number(params?.toArea) !== CabtAreaType.HAND
  ) {
    return undefined;
  }

  const sourceAnchor = prizeSourceAnchorForEvent(view, event, phase.events);
  const targetAnchor = handDestinationAnchorForEvent(view, event);
  if (!sourceAnchor || !targetAnchor) {
    return null;
  }
  const targetCard = view.players[playerIndex]?.hand[targetAnchor.kind === 'hand-card' ? targetAnchor.handIndex ?? -1 : -1];
  const serial = finiteNumber(params?.serial) ?? targetCard?.serial;
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
  const serial = finiteNumber(params?.serial) ?? sourceCard?.serial;
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
  const serial = finiteNumber(params?.serial) ?? sourceCard?.serial;
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
  const toArea = Number(params?.toArea);
  if (toArea === CabtAreaType.ACTIVE || toArea === CabtAreaType.BENCH) {
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
  return isMoveCardKind(event.kind)
    && event.playerIndex !== undefined
    && Number(params?.fromArea) === CabtAreaType.HAND
    && Number(params?.toArea) === CabtAreaType.DECK
    && finiteNumber(params?.serial) !== undefined
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
    return finiteNumber(params?.serial) !== undefined
      && finiteNumber(params?.cardId) !== undefined;
  }
  if (event.kind === 'Evolve') {
    const params = event.params as Record<string, unknown> | undefined;
    return finiteNumber(params?.serial) !== undefined
      && finiteNumber(params?.cardId) !== undefined
      && finiteNumber(params?.serialTarget) !== undefined
      && finiteNumber(params?.cardIdTarget) !== undefined;
  }
  if (!isMoveCardKind(event.kind)) {
    return false;
  }
  const params = event.params as Record<string, unknown> | undefined;
  const fromArea = Number(params?.fromArea);
  const toArea = Number(params?.toArea);
  return fromArea === CabtAreaType.HAND
    && (
      toArea === CabtAreaType.DISCARD
      || toArea === CabtAreaType.ACTIVE
      || toArea === CabtAreaType.BENCH
    )
    && finiteNumber(params?.serial) !== undefined
    && finiteNumber(params?.cardId) !== undefined;
}

export function isPrizeToHandMoveEvent(event: ActionTimelineEvent): boolean {
  const params = event.params as Record<string, unknown> | undefined;
  return isMoveCardKind(event.kind)
    && Number(params?.fromArea) === CabtAreaType.PRIZE
    && Number(params?.toArea) === CabtAreaType.HAND;
}

type MaybeAnimationMotionGroup = AnimationMotion | AnimationMotion[] | null | undefined;

function compactAnimationMotions(groups: MaybeAnimationMotionGroup[]): AnimationMotion[] {
  return groups.flatMap((group) => group ?? []);
}
