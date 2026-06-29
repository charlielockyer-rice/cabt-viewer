import {
  actionAnimationTiming,
  isKnockOutMove,
} from './actionAnimationPhases';
import { isMoveCardKind } from './replayActionGroups';
import { eventCardMatches } from './replayCardIdentity';
import type { ResolvingPlayedCard } from './replayResolvingCards';
import type {
  AnimationAnchorRef,
  AnimationMotion,
} from '../animations/replayAnimationPlan';
import type { ActionTimelineEvent, GameView, PlayerView } from '../game/types';
import type { ReplayAnimationPhase, ReplayStep } from '../game/replay';

export const resolvingDiscardHandoffGapMs = 24;

export function applyKnockOutDiscardTopOrdering(steps: ReplayStep[]): void {
  for (const step of steps) {
    const knockOutEvents = (step.actionTimeline ?? []).filter(isKnockOutEvent);
    if (!knockOutEvents.length) {
      continue;
    }

    if (step.displayView) {
      step.displayView = gameViewWithPromotedDiscardCards(step.displayView, knockOutEvents);
    }
    if (step.animationPhases?.length) {
      step.animationPhases = step.animationPhases.map((phase) => {
        if (phase.kind !== 'KnockOut') {
          return phase;
        }
        return {
          ...phase,
          view: gameViewWithPromotedDiscardCards(phase.view, phase.actionTimeline.filter(isKnockOutEvent)),
        };
      });
    }
  }
}

function gameViewWithPromotedDiscardCards(view: GameView, events: ActionTimelineEvent[]): GameView {
  return {
    ...view,
    players: view.players.map((player, playerIndex) => {
      const playerEvents = events.filter((event) => event.playerIndex === playerIndex);
      if (!playerEvents.length) {
        return player;
      }
      return playerEvents.reduce(promoteDiscardCardToTop, player);
    }),
  };
}

function promoteDiscardCardToTop(player: PlayerView, event: ActionTimelineEvent): PlayerView {
  const cardIndex = player.discard.findIndex((card) => eventCardMatches(card, event));
  if (cardIndex < 0 || cardIndex === player.discard.length - 1) {
    return player;
  }
  const discard = [...player.discard];
  const [card] = discard.splice(cardIndex, 1);
  return {
    ...player,
    discard: [...discard, card],
  };
}

export function resolvingDiscardCardMoveMotions(
  phase: Pick<ReplayAnimationPhase, 'key'>,
  resolving: ResolvingPlayedCard[],
  startBaseMs: number,
): AnimationMotion[] {
  return resolving.map((entry, index) =>
    resolvingDiscardCardMoveMotion(phase, entry, startBaseMs + index * actionAnimationTiming.handMoveStepMs));
}

function resolvingDiscardCardMoveMotion(
  phase: Pick<ReplayAnimationPhase, 'key'>,
  entry: ResolvingPlayedCard,
  startMs: number,
): AnimationMotion {
  const serial = entry.card.serial;
  const cardId = entry.card.id;
  const sourceAnchor: AnimationAnchorRef = { kind: 'play-zone-card', playerIndex: entry.playerIndex, serial };
  return {
    id: `${phase.key}:resolving-discard:${entry.playerIndex}:${serial ?? cardId ?? 'unknown'}`,
    kind: 'card-move',
    purpose: 'resolving-cleanup',
    identity: {
      kind: 'card',
      serial,
      cardId,
      name: entry.card.name,
    },
    sourceAnchor,
    targetAnchor: { kind: 'discard-card', playerIndex: entry.playerIndex, serial },
    coordinateSpace: 'board',
    startMs,
    durationMs: actionAnimationTiming.boardMoveMs,
    spriteVisual: {
      kind: 'card',
      card: entry.card,
    },
    handoffPolicy: {
      hideSourceUntil: 'scope-exit',
      hideDestinationUntil: 'prepaint',
      removeSprite: 'prepaint',
      prepaintFrames: 2,
    },
  };
}

function isKnockOutEvent(event: ActionTimelineEvent): boolean {
  const params = event.params as Record<string, unknown> | undefined;
  return isMoveCardKind(event.kind)
    && isKnockOutMove(Number(params?.fromArea), Number(params?.toArea));
}
