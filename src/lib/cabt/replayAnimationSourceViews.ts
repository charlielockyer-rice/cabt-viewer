import {
  isAttachedCardArea,
} from './actionAnimationPhases';
import { handDestinationAnchorForEvent } from './replayAnimationAnchors';
import { isMoveCardKind } from './replayActionGroups';
import { isCabtStadiumCard } from './replayCardData';
import { sameKnownCard } from './replayCardIdentity';
import { finiteNumber } from './replayEventParams';
import type { AnimationEventPhase } from './replayAnimationPhases';
import {
  playerHasCardInPlay,
  projectedViewForEvents,
} from './replayProjection';
import {
  isPlannedHandPlayMoveEvent,
  isPrizeToHandMoveEvent,
} from './replayViewportCardMotions';
import { CabtAreaType } from './types';
import type { ActionTimelineEvent, CardView, GameView, PlayerView } from '../game/types';

export function animationSourceViewForPhase(
  phaseStartView: GameView,
  currentView: GameView,
  phase: AnimationEventPhase,
): GameView {
  switch (phase.kind) {
    case 'Evolve':
      return handPlaySourceView(phaseStartView, currentView, phase);
    case 'Ability':
    case 'Attack':
    case 'Change':
    case 'Devolve':
    case 'MoveAttached':
    case 'Condition':
    case 'Damage':
      return projectedViewForEvents(phaseStartView, currentView, phase.events, { deferBoardStateEvents: true });
    case 'KnockOut':
    case 'BoardToDeck':
    case 'StadiumMove':
      return projectedViewForEvents(phaseStartView, currentView, phase.events, { deferMoveCardEvents: true });
    case 'BoardMove':
      return boardMoveSourceView(
        projectedViewForEvents(phaseStartView, currentView, phase.events, {
          deferBoardStateEvents: true,
          deferMoveCardEvents: true,
        }),
        phaseStartView,
        currentView,
      );
    case 'AttachedMove':
      if (phase.events.some(isAttachedToHandMoveEvent)) {
        return attachedToHandSourceView(phaseStartView, currentView, phase);
      }
      return projectedViewForEvents(phaseStartView, currentView, phase.events, { deferMoveCardEvents: true });
    case 'PrizeTake':
      return prizeTakeSourceView(phaseStartView, currentView, phase);
    case 'Play':
    case 'HandMove':
    case 'Attach':
      return handPlaySourceView(phaseStartView, currentView, phase);
    case 'Coin':
    case 'DeckBoardPlace':
    case 'DeckDiscard':
    case 'DeckPrizePlace':
    case 'DeckReveal':
    case 'DeckRevealReturn':
    case 'DeckRevealTake':
    case 'DeckSearchReveal':
    case 'DiscardRecover':
    case 'Draw':
    case 'HandToDeck':
    case 'Shuffle':
      return phaseStartView;
  }
  return assertUnhandledActionAnimationPhaseKind(phase.kind);
}

function assertUnhandledActionAnimationPhaseKind(kind: never): never {
  throw new Error(`Unhandled replay animation phase kind: ${kind}`);
}

function handPlaySourceView(
  phaseStartView: GameView,
  currentView: GameView,
  phase: AnimationEventPhase,
): GameView {
  const plannedEvents = phase.events
    .filter(isPlannedHandPlayMoveEvent)
    .filter((event) => handDestinationAnchorForEvent(phaseStartView, event));
  const usesFinalDestination = plannedEvents.some((event) => isMoveCardKind(event.kind) || event.kind === 'Attach');
  const phaseView = usesFinalDestination ? currentView : phaseStartView;
  const playerIndexes = new Set(
    plannedEvents.map((event) => event.playerIndex)
      .filter((playerIndex): playerIndex is number => playerIndex !== undefined),
  );
  if (!playerIndexes.size) {
    return projectedViewForEvents(phaseStartView, currentView, phase.events);
  }
  return {
    ...phaseView,
    players: phaseView.players.map((phasePlayer, playerIndex) => {
      if (!playerIndexes.has(playerIndex)) {
        return phasePlayer;
      }
      const phaseStartPlayer = phaseStartView.players[playerIndex] ?? phasePlayer;
      const currentPlayer = currentView.players[playerIndex] ?? phasePlayer;
      const playEvents = plannedEvents.filter((event) => event.playerIndex === playerIndex && event.kind === 'Play');
      if (!usesFinalDestination && playEvents.length) {
        return playEvents.reduce((player, event) => applyHandPlayDestination(player, currentPlayer, event), {
          ...phasePlayer,
          hand: phaseStartPlayer.hand,
        });
      }
      return {
        ...phasePlayer,
        hand: phaseStartPlayer.hand,
      };
    }),
  };
}

function applyHandPlayDestination(player: PlayerView, currentPlayer: PlayerView, event: ActionTimelineEvent): PlayerView {
  const params = event.params as Record<string, unknown> | undefined;
  const cardId = finiteNumber(params?.cardId);
  if (cardId !== undefined && isCabtStadiumCard(cardId)) {
    return {
      ...player,
      stadium: currentPlayer.stadium,
    };
  }
  if (playerHasCardInPlay(currentPlayer, event)) {
    return {
      ...player,
      active: currentPlayer.active,
      bench: currentPlayer.bench,
      stadium: currentPlayer.stadium,
      playZone: currentPlayer.playZone,
    };
  }
  return player;
}

function boardMoveSourceView(sourceView: GameView, phaseStartView: GameView, currentView: GameView): GameView {
  return {
    ...sourceView,
    players: sourceView.players.map((player, playerIndex) => {
      const phaseStartPlayer = phaseStartView.players[playerIndex];
      const currentPlayer = currentView.players[playerIndex];
      if (!phaseStartPlayer || !currentPlayer) {
        return player;
      }
      return {
        ...player,
        discard: mergedKnownCards(phaseStartPlayer.discard, currentPlayer.discard),
        playZone: mergedKnownCards(phaseStartPlayer.playZone, currentPlayer.playZone),
      };
    }),
  };
}

function attachedToHandSourceView(
  phaseStartView: GameView,
  currentView: GameView,
  phase: AnimationEventPhase,
): GameView {
  const sourceView = projectedViewForEvents(phaseStartView, currentView, phase.events, { deferMoveCardEvents: true });
  return {
    ...sourceView,
    players: sourceView.players.map((player, playerIndex) => {
      const currentPlayer = currentView.players[playerIndex];
      if (!currentPlayer || !phase.events.some((event) => event.playerIndex === playerIndex && isAttachedToHandMoveEvent(event))) {
        return player;
      }
      return {
        ...player,
        hand: currentPlayer.hand,
      };
    }),
  };
}

function prizeTakeSourceView(
  phaseStartView: GameView,
  currentView: GameView,
  phase: AnimationEventPhase,
): GameView {
  const sourceView = projectedViewForEvents(phaseStartView, currentView, phase.events, { deferMoveCardEvents: true });
  return {
    ...sourceView,
    players: sourceView.players.map((player, playerIndex) => {
      const currentPlayer = currentView.players[playerIndex];
      if (!currentPlayer || !phase.events.some((event) => event.playerIndex === playerIndex && isPrizeToHandMoveEvent(event))) {
        return player;
      }
      return {
        ...player,
        hand: currentPlayer.hand,
      };
    }),
  };
}

function mergedKnownCards(left: CardView[], right: CardView[]): CardView[] {
  return [
    ...left,
    ...right.filter((card) => !left.some((existing) => sameKnownCard(existing, card))),
  ];
}

function isAttachedToHandMoveEvent(event: ActionTimelineEvent): boolean {
  const params = event.params as Record<string, unknown> | undefined;
  return isMoveCardKind(event.kind)
    && isAttachedCardArea(Number(params?.fromArea))
    && Number(params?.toArea) === CabtAreaType.HAND;
}
