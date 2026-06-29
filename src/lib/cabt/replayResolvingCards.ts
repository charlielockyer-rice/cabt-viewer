import {
  isCompleteDeckSearchEffect,
  resolvingTrainerPlayEvent,
  startGroupHasTerminalResolvingEffect,
  viewHasEventCardInDiscard,
} from './replayContinuations';
import { cardViewFromEvent, eventCardMatches, sameKnownCard } from './replayCardIdentity';
import { isCabtResolvingTrainerCard } from './replayCardData';
import type { ReplayActionGroup } from './replayActionGroups';
import type { ActionTimelineEvent, CardView, GameView, PlayerView, PokemonSlotView } from '../game/types';

export type ResolvingPlayedCard = {
  playerIndex: number;
  card: CardView;
};

export type ResolvingPlayedCardContext = {
  displayResolved: ResolvingPlayedCard[];
  displayResolving: ResolvingPlayedCard[];
  phaseResolving: ResolvingPlayedCard[];
  nextResolving: ResolvingPlayedCard[];
};

export function resolvingContextForStep(
  input: {
    baseView: GameView | undefined;
    actionTimeline: ActionTimelineEvent[] | undefined;
    hasAnimationPhases: boolean;
    resolvingFinalizers: ResolvingPlayedCard[];
    resolving: ResolvingPlayedCard[];
  },
): ResolvingPlayedCardContext {
  const { baseView, actionTimeline, hasAnimationPhases, resolvingFinalizers, resolving: currentResolving } = input;
  if (!baseView) {
    return emptyResolvingPlayedCardContext(currentResolving);
  }

  let resolving = currentResolving;
  for (const event of actionTimeline ?? []) {
    const resolvingCard = resolvingPlayedCardForEvent(baseView, event);
    if (resolvingCard && !resolving.some((entry) => sameResolvingCard(entry, resolvingCard))) {
      resolving = [...resolving, resolvingCard];
    }
  }

  const displayResolved = resolving.filter((entry) => shouldResolveCardInDisplay(hasAnimationPhases, resolvingFinalizers, entry));
  const displayResolving = resolving.filter((entry) =>
    !displayResolved.some((resolvedEntry) => sameResolvingCard(resolvedEntry, entry))
    && shouldShowResolvingCardInDisplay(actionTimeline, baseView, entry));
  const phaseResolving = resolving.filter((entry) => shouldShowResolvingCardInPhase(actionTimeline, hasAnimationPhases, resolvingFinalizers, baseView, entry));
  const visibleResolving = [...displayResolving, ...phaseResolving];
  const nextResolving = resolving.flatMap((entry) => {
    if (!visibleResolving.some((visibleEntry) => sameResolvingCard(visibleEntry, entry))) {
      return [];
    }
    if (playerHasDiscardCard(baseView.players[entry.playerIndex], entry.card)) {
      return [];
    }
    if (displayResolved.some((resolvedEntry) => sameResolvingCard(resolvedEntry, entry))) {
      return [];
    }
    return [entry];
  });
  return {
    displayResolved,
    displayResolving,
    phaseResolving,
    nextResolving,
  };
}

export function resolvingDisplayView(
  baseView: GameView | undefined,
  context: ResolvingPlayedCardContext | undefined,
): GameView | undefined {
  if (!baseView || (!context?.displayResolved.length && !context?.displayResolving.length)) {
    return undefined;
  }
  let view = baseView;
  if (context.displayResolved.length) {
    view = gameViewWithResolvedDiscards(view, context.displayResolved);
  }
  if (context.displayResolving.length) {
    view = gameViewWithResolvingCards(view, context.displayResolving);
  }
  return view;
}

export function resolvingPlayedCardsForEvents(events: Array<ActionTimelineEvent | undefined>): ResolvingPlayedCard[] {
  return events.flatMap((event) => {
    const card = event ? resolvingPlayedCardFromPlayEvent(event) : undefined;
    return card ? [card] : [];
  });
}

export function resolvingFinalizerCardsForGroup(group: ReplayActionGroup, view: GameView): ResolvingPlayedCard[] {
  const playEvent = resolvingTrainerPlayEvent(group);
  const playerIndex = playEvent?.playerIndex;
  if (!playEvent || playerIndex === undefined) {
    return [];
  }
  if (
    !startGroupHasTerminalResolvingEffect(group)
    && !isCompleteDeckSearchEffect(group.events, playerIndex)
    && !viewHasEventCardInDiscard(view, playEvent)
  ) {
    return [];
  }
  return resolvingPlayedCardsForEvents([playEvent]);
}

export function gameViewWithResolvingCards(view: GameView, resolving: ResolvingPlayedCard[]): GameView {
  const cardsByPlayer = resolvingCardsByPlayer(resolving);
  return {
    ...view,
    players: view.players.map((player, playerIndex) => {
      const pendingCards = cardsByPlayer.get(playerIndex) ?? [];
      if (!pendingCards.length) {
        return player;
      }
      return {
        ...player,
        discard: withoutCards(player.discard, pendingCards),
        playZone: [
          ...withoutCards(player.playZone, pendingCards),
          ...pendingCards,
        ],
      };
    }),
  };
}

export function gameViewWithResolvingDiscardDestinations(view: GameView, resolving: ResolvingPlayedCard[]): GameView {
  const cardsByPlayer = resolvingCardsByPlayer(resolving);
  return {
    ...view,
    players: view.players.map((player, playerIndex) => {
      const resolvedCards = cardsByPlayer.get(playerIndex) ?? [];
      if (!resolvedCards.length) {
        return player;
      }
      return {
        ...player,
        discard: [
          ...withoutCards(player.discard, resolvedCards),
          ...resolvedCards,
        ],
      };
    }),
  };
}

function emptyResolvingPlayedCardContext(nextResolving: ResolvingPlayedCard[] = []): ResolvingPlayedCardContext {
  return {
    displayResolved: [],
    displayResolving: [],
    phaseResolving: [],
    nextResolving,
  };
}

function resolvingPlayedCardForEvent(view: GameView, event: ActionTimelineEvent): ResolvingPlayedCard | undefined {
  if (event.kind !== 'Play' || event.playerIndex === undefined) {
    return undefined;
  }
  const player = view.players[event.playerIndex];
  const card = cardViewFromEvent(event);
  if (!player || !card || card.id === undefined || playerHasCardInPlay(player, event) || !isCabtResolvingTrainerCard(card.id)) {
    return undefined;
  }
  return { playerIndex: event.playerIndex, card };
}

function resolvingPlayedCardFromPlayEvent(event: ActionTimelineEvent): ResolvingPlayedCard | undefined {
  if (event.kind !== 'Play' || event.playerIndex === undefined) {
    return undefined;
  }
  const card = cardViewFromEvent(event);
  if (!card || card.id === undefined || !isCabtResolvingTrainerCard(card.id)) {
    return undefined;
  }
  return { playerIndex: event.playerIndex, card };
}

function gameViewWithResolvedDiscards(view: GameView, resolving: ResolvingPlayedCard[]): GameView {
  const cardsByPlayer = resolvingCardsByPlayer(resolving);
  return {
    ...view,
    players: view.players.map((player, playerIndex) => {
      const resolvedCards = cardsByPlayer.get(playerIndex) ?? [];
      if (!resolvedCards.length) {
        return player;
      }
      return {
        ...player,
        playZone: withoutCards(player.playZone, resolvedCards),
        discard: [
          ...withoutCards(player.discard, resolvedCards),
          ...resolvedCards,
        ],
      };
    }),
  };
}

function resolvingCardsByPlayer(resolving: ResolvingPlayedCard[]): Map<number, CardView[]> {
  const cardsByPlayer = new Map<number, CardView[]>();
  for (const entry of resolving) {
    const cards = cardsByPlayer.get(entry.playerIndex) ?? [];
    cardsByPlayer.set(entry.playerIndex, [...cards, entry.card]);
  }
  return cardsByPlayer;
}

function withoutCards(cards: CardView[], removals: CardView[]): CardView[] {
  return cards.filter((card) => !removals.some((removal) => sameKnownCard(card, removal)));
}

function shouldResolveCardInDisplay(
  hasAnimationPhases: boolean,
  resolvingFinalizers: ResolvingPlayedCard[],
  entry: ResolvingPlayedCard,
): boolean {
  return hasAnimationPhases && resolvingFinalizers.some((finalizer) => sameResolvingCard(finalizer, entry));
}

function shouldShowResolvingCardInDisplay(
  actionTimeline: ActionTimelineEvent[] | undefined,
  baseView: GameView,
  entry: ResolvingPlayedCard,
): boolean {
  if (!playerHasDiscardCard(baseView.players[entry.playerIndex], entry.card)) {
    return true;
  }
  return actionTimelineContainsPlayForCard(actionTimeline, entry.card);
}

function shouldShowResolvingCardInPhase(
  actionTimeline: ActionTimelineEvent[] | undefined,
  hasAnimationPhases: boolean,
  resolvingFinalizers: ResolvingPlayedCard[],
  baseView: GameView,
  entry: ResolvingPlayedCard,
): boolean {
  if (!hasAnimationPhases) {
    return false;
  }
  return shouldShowResolvingCardInDisplay(actionTimeline, baseView, entry)
    || actionTimelineContainsPlayForCard(actionTimeline, entry.card)
    || resolvingFinalizers.some((finalizer) => sameResolvingCard(finalizer, entry));
}

function actionTimelineContainsPlayForCard(actionTimeline: ActionTimelineEvent[] | undefined, card: CardView): boolean {
  return (actionTimeline ?? []).some((event) => event.kind === 'Play' && eventCardMatches(card, event));
}

function sameResolvingCard(left: ResolvingPlayedCard, right: ResolvingPlayedCard): boolean {
  return left.playerIndex === right.playerIndex && sameKnownCard(left.card, right.card);
}

function playerHasDiscardCard(player: PlayerView | undefined, card: CardView): boolean {
  return !!player?.discard.some((discardCard) => sameKnownCard(discardCard, card));
}

function playerHasCardInPlay(player: PlayerView, event: ActionTimelineEvent): boolean {
  return [
    ...slotCards(player.active),
    ...player.bench.flatMap(slotCards),
    ...player.stadium,
    ...player.playZone,
  ].some((card) => eventCardMatches(card, event));
}

function slotCards(slot: PokemonSlotView): CardView[] {
  return [
    ...(slot.pokemon ? [slot.pokemon] : []),
    ...slot.cards,
    ...slot.energy,
    ...slot.tools,
  ];
}
