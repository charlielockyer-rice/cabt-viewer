import {
  actionAnimationTiming,
  isAttachedCardArea,
  isKnockOutMove,
} from './actionAnimationPhases';
import { actionAnimationStartMs } from './actionAnimationSchedule';
import {
  boardMoveSourceAnchor,
  boardMoveTargetAnchor,
  boardSlotAnchorForPokemon,
} from './replayAnimationAnchors';
import { compactAnimationMotions } from './replayAnimationMotionUtils';
import { isMoveCardKind } from './replayActionGroups';
import { cabtCardToView } from './replayCardData';
import { cardViewFromEvent } from './replayCardIdentity';
import { finiteNumber, stringValue } from './replayEventParams';
import type { AnimationEventPhase } from './replayAnimationPhases';
import { CabtAreaType } from './types';
import type {
  AnimationAnchorRef,
  AnimationHandoffPolicy,
  AnimationIdentity,
  AnimationMotion,
  AnimationSpriteVisual,
} from '../animations/replayAnimationPlan';
import type { ActionTimelineEvent, GameView } from '../game/types';

export function boardCardMoveMotions(phase: AnimationEventPhase, view: GameView): AnimationMotion[] {
  const motionGroups = phase.events.map((event) => boardCardMoveMotionsForEvent(phase, view, event));
  return compactAnimationMotions(motionGroups);
}

function boardCardMoveMotionsForEvent(
  phase: AnimationEventPhase,
  view: GameView,
  event: ActionTimelineEvent,
): AnimationMotion[] | null {
  if (event.kind === 'Switch') {
    return switchBoardCardMoveMotions(phase, view, event);
  }
  if (!isMoveCardKind(event.kind)) {
    return [];
  }

  const params = event.params as Record<string, unknown> | undefined;
  const playerIndex = event.playerIndex;
  const fromArea = Number(params?.fromArea);
  const toArea = Number(params?.toArea);
  const serial = finiteNumber(params?.serial);
  const cardId = finiteNumber(params?.cardId);
  if (phase.kind === 'KnockOut' && !isKnockOutMove(fromArea, toArea)) {
    return [];
  }
  const isHiddenPrizePlacement = fromArea === CabtAreaType.DECK && toArea === CabtAreaType.PRIZE;
  if (playerIndex === undefined || (cardId === undefined && !isHiddenPrizePlacement)) {
    return null;
  }

  const sourceAnchor = boardMoveSourceAnchor(view, event, fromArea);
  const targetAnchor = boardMoveTargetAnchor(phase, view, event, toArea);
  if (!sourceAnchor || !targetAnchor) {
    return null;
  }
  const isDiscardRecovery = fromArea === CabtAreaType.DISCARD
    && (toArea === CabtAreaType.HAND || toArea === CabtAreaType.DECK);

  return [cardMoveMotion({
    id: `${phase.key}:${event.id}:${serial ?? cardId}`,
    event,
    phase,
    sourceAnchor,
    targetAnchor,
    identity: {
      kind: attachedIdentityKind(fromArea)
        ?? (fromArea === CabtAreaType.STADIUM ? 'stadium' : undefined)
        ?? ((fromArea === CabtAreaType.DECK && (toArea === CabtAreaType.DISCARD || toArea === CabtAreaType.PRIZE))
          || isDiscardRecovery ? 'card' : 'pokemon'),
      serial,
      cardId,
      name: stringValue(params?.cardName),
    },
    removeSprite: (fromArea === CabtAreaType.ACTIVE || fromArea === CabtAreaType.BENCH) && (toArea === CabtAreaType.ACTIVE || toArea === CabtAreaType.BENCH)
      || isKnockOutMove(fromArea, toArea)
      ? 'scope-exit'
      : 'prepaint',
    durationMs: cardMoveDurationMs(fromArea, toArea),
    coordinateSpace: (isAttachedCardArea(fromArea) || fromArea === CabtAreaType.DISCARD) && toArea === CabtAreaType.HAND
      ? 'cross-plane'
      : 'board',
    spriteVisual: (isAttachedCardArea(fromArea) && toArea === CabtAreaType.HAND)
      || (fromArea === CabtAreaType.DECK && toArea === CabtAreaType.DISCARD)
      || isDiscardRecovery
      ? { kind: 'card', card: cardViewFromEvent(event) }
      : undefined,
    handoffPolicy: isDiscardRecovery && toArea === CabtAreaType.HAND
      ? { hideDestinationUntil: 'none' }
      : undefined,
  })];
}

function switchBoardCardMoveMotions(
  phase: AnimationEventPhase,
  view: GameView,
  event: ActionTimelineEvent,
): AnimationMotion[] | null {
  const playerIndex = event.playerIndex;
  const params = event.params as Record<string, unknown> | undefined;
  if (playerIndex === undefined) {
    return null;
  }
  const activeAnchor = boardSlotAnchorForPokemon(view.players[playerIndex], finiteNumber(params?.serialActive), finiteNumber(params?.cardIdActive));
  const benchAnchor = boardSlotAnchorForPokemon(view.players[playerIndex], finiteNumber(params?.serialBench), finiteNumber(params?.cardIdBench));
  if (!activeAnchor || !benchAnchor) {
    return null;
  }
  return [
    cardMoveMotion({
      id: `${phase.key}:${event.id}:active-${params?.serialActive ?? params?.cardIdActive}`,
      event,
      phase,
      sourceAnchor: activeAnchor,
      targetAnchor: benchAnchor,
      identity: {
        kind: 'pokemon',
        serial: finiteNumber(params?.serialActive),
        cardId: finiteNumber(params?.cardIdActive),
      },
      removeSprite: 'scope-exit',
    }),
    cardMoveMotion({
      id: `${phase.key}:${event.id}:bench-${params?.serialBench ?? params?.cardIdBench}`,
      event,
      phase,
      sourceAnchor: benchAnchor,
      targetAnchor: activeAnchor,
      identity: {
        kind: 'pokemon',
        serial: finiteNumber(params?.serialBench),
        cardId: finiteNumber(params?.cardIdBench),
      },
      removeSprite: 'scope-exit',
    }),
  ];
}

function cardMoveMotion(input: {
  id: string;
  event: ActionTimelineEvent;
  phase: AnimationEventPhase;
  sourceAnchor: AnimationAnchorRef;
  targetAnchor: AnimationAnchorRef;
  identity: AnimationIdentity;
  removeSprite: 'prepaint' | 'scope-exit';
  durationMs?: number;
  coordinateSpace?: AnimationMotion['coordinateSpace'];
  spriteVisual?: AnimationSpriteVisual;
  handoffPolicy?: Partial<AnimationHandoffPolicy>;
}): AnimationMotion {
  const coordinateSpace = input.coordinateSpace ?? 'board';
  const removeSprite = coordinateSpace === 'cross-plane' ? 'arrival' : input.removeSprite;
  const handoffPolicy = {
    hideSourceUntil: input.sourceAnchor.kind === 'deck-top' ? 'snapshot' : 'scope-exit',
    hideDestinationUntil: coordinateSpace === 'cross-plane' ? 'arrival' : 'prepaint',
    removeSprite,
    prepaintFrames: 2,
    ...input.handoffPolicy,
  } satisfies AnimationHandoffPolicy;
  return {
    id: input.id,
    kind: 'card-move',
    identity: input.identity,
    sourceAnchor: input.sourceAnchor,
    targetAnchor: input.targetAnchor,
    coordinateSpace,
    startMs: actionAnimationStartMs(input.phase.events, input.event),
    durationMs: input.durationMs ?? actionAnimationTiming.boardMoveMs,
    spriteVisual: input.spriteVisual ?? cardMoveSpriteVisual(input),
    handoffPolicy,
  };
}

function cardMoveSpriteVisual(input: {
  event: ActionTimelineEvent;
  identity: AnimationIdentity;
}): AnimationSpriteVisual {
  const cardId = input.identity.cardId;
  if (cardId !== undefined) {
    return {
      kind: 'card',
      card: cabtCardToView({
        id: cardId,
        serial: input.identity.serial,
        playerIndex: input.event.playerIndex,
      }),
      faceDown: input.event.kind === 'MoveCardReverse',
    };
  }
  return {
    kind: 'card',
    faceDown: true,
  };
}

function cardMoveDurationMs(fromArea: number, toArea: number): number {
  if (fromArea === CabtAreaType.ENERGY || fromArea === CabtAreaType.TOOL) {
    return actionAnimationTiming.handMoveMs;
  }
  if (isKnockOutMove(fromArea, toArea)) {
    return actionAnimationTiming.knockOutMs;
  }
  if (fromArea === CabtAreaType.DECK && toArea === CabtAreaType.DISCARD) {
    return actionAnimationTiming.deckDiscardMs;
  }
  if (fromArea === CabtAreaType.STADIUM && toArea === CabtAreaType.DISCARD) {
    return actionAnimationTiming.stadiumMoveMs;
  }
  return actionAnimationTiming.boardMoveMs;
}

function attachedIdentityKind(fromArea: number): AnimationIdentity['kind'] | undefined {
  if (fromArea === CabtAreaType.ENERGY) {
    return 'energy';
  }
  if (fromArea === CabtAreaType.TOOL) {
    return 'tool';
  }
  return undefined;
}
