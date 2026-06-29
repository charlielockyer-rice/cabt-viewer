import { type ReplayActionGroup } from './replayActionGroups';
import { cardViewFromEvent, eventCardMatches, sameKnownCard } from './replayCardIdentity';
import { cabtFaceDownCard } from './replayCardData';
import { replayEventMoveAreas, replayEventSerial } from './replayEventAreas';
import { finiteNumber } from './replayEventParams';
import { CabtAreaType } from './types';
import type { ActionTimelineEvent, CardView, GameView, PlayerView, PokemonSlotView } from '../game/types';

export type ReplayProjectionOptions = {
  deferBoardStateEvents?: boolean;
  deferMoveCardEvents?: boolean;
  deferSpecialConditionState?: boolean;
};

export function projectedViewForEvents(
  baseView: GameView,
  currentView: GameView,
  events: ActionTimelineEvent[],
  options: ReplayProjectionOptions = {},
): GameView {
  const view: GameView = {
    ...currentView,
    players: currentView.players.map((currentPlayer, playerIndex) => {
      const basePlayer = baseView.players[playerIndex] ?? currentPlayer;
      return {
        ...currentPlayer,
        hand: [...basePlayer.hand],
        deckCount: basePlayer.deckCount,
        prizesLeft: basePlayer.prizesLeft,
        active: basePlayer.active,
        bench: basePlayer.bench,
        discard: basePlayer.discard,
        stadium: basePlayer.stadium,
        playZone: basePlayer.playZone,
      };
    }),
  };

  for (const event of events) {
    applyReplayEvent(view, currentView, event, options);
  }
  return view;
}

export function shouldProjectSingleGroup(currentView: GameView, group: ReplayActionGroup): boolean {
  return group.events.some((event) => event.kind === 'Play' && needsPlayedCardDiscardProjection(currentView, event));
}

export function applyReplayEvent(
  view: GameView,
  currentView: GameView,
  event: ActionTimelineEvent,
  options: ReplayProjectionOptions = {},
): void {
  const playerIndex = event.playerIndex;
  if (playerIndex === undefined || !view.players[playerIndex] || !currentView.players[playerIndex]) {
    return;
  }
  const player = view.players[playerIndex];
  const currentPlayer = currentView.players[playerIndex];
  const projectedCurrentBoard = options.deferSpecialConditionState
    ? playerBoardWithDeferredSpecialConditions(currentPlayer, player)
    : currentPlayer;

  if (event.kind === 'Draw' || event.kind === 'DrawReverse') {
    player.deckCount = Math.max(0, player.deckCount - 1);
    player.hand = addCardToHand(player, currentPlayer);
    return;
  }

  if (event.kind === 'Play') {
    player.hand = removeMovedCardFromHand(player.hand, event);
    if (playerHasCardInPlay(currentPlayer, event)) {
      player.active = projectedCurrentBoard.active;
      player.bench = projectedCurrentBoard.bench;
      player.stadium = projectedCurrentBoard.stadium;
      player.playZone = projectedCurrentBoard.playZone;
      return;
    }
    player.discard = addCardToDiscard(player, currentPlayer, event);
    return;
  }

  if (event.kind === 'Evolve') {
    player.hand = removeMovedCardFromHand(player.hand, event);
    if (!options.deferBoardStateEvents) {
      player.active = projectedCurrentBoard.active;
      player.bench = projectedCurrentBoard.bench;
      player.discard = projectedCurrentBoard.discard;
    }
    return;
  }

  if (event.kind === 'HpChange' || event.kind === 'HPChange') {
    if (options.deferBoardStateEvents) {
      return;
    }
    if (applyDamageReplayEvent(player, event)) {
      return;
    }
    player.active = projectedCurrentBoard.active;
    player.bench = projectedCurrentBoard.bench;
    player.discard = projectedCurrentBoard.discard;
    return;
  }

  if (isBoardStateEvent(event.kind)) {
    if (options.deferBoardStateEvents) {
      return;
    }
    player.active = projectedCurrentBoard.active;
    player.bench = projectedCurrentBoard.bench;
    player.discard = projectedCurrentBoard.discard;
    return;
  }

  if (options.deferMoveCardEvents) {
    return;
  }

  const areas = replayEventMoveAreas(event);
  if (!areas) {
    return;
  }

  applyReplayAreaDelta(player, currentPlayer, areas.fromArea, -1, event);
  applyReplayAreaDelta(player, currentPlayer, areas.toArea, 1, event);
}

export function playerHasCardInPlay(player: PlayerView, event: ActionTimelineEvent): boolean {
  return [
    ...slotCards(player.active),
    ...player.bench.flatMap(slotCards),
    ...player.stadium,
    ...player.playZone,
  ].some((card) => eventCardMatches(card, event));
}

function needsPlayedCardDiscardProjection(currentView: GameView, event: ActionTimelineEvent): boolean {
  const playerIndex = event.playerIndex;
  if (playerIndex === undefined) {
    return false;
  }
  const player = currentView.players[playerIndex];
  if (!player) {
    return false;
  }
  return !player.hand.some((card) => eventCardMatches(card, event))
    && !player.discard.some((card) => eventCardMatches(card, event))
    && !playerHasCardInPlay(player, event);
}

function playerBoardWithDeferredSpecialConditions(currentPlayer: PlayerView, basePlayer: PlayerView): PlayerView {
  return {
    ...currentPlayer,
    active: slotWithDeferredSpecialConditions(currentPlayer.active, basePlayer),
    bench: currentPlayer.bench.map((slot) => slotWithDeferredSpecialConditions(slot, basePlayer)),
  };
}

function slotWithDeferredSpecialConditions(slot: PokemonSlotView, basePlayer: PlayerView): PokemonSlotView {
  if (slot.slot !== 'active') {
    return slot.specialConditions.length ? { ...slot, specialConditions: [] } : slot;
  }
  const baseSlot = matchingBoardSlot(basePlayer, slot);
  const specialConditions = baseSlot?.specialConditions ?? [];
  return shallowArrayEqual(slot.specialConditions, specialConditions)
    ? slot
    : { ...slot, specialConditions };
}

function matchingBoardSlot(player: PlayerView, slot: PokemonSlotView): PokemonSlotView | undefined {
  const matches = (candidate: PokemonSlotView) => {
    const serial = slot.pokemon?.serial;
    if (serial !== undefined) {
      return candidate.pokemon?.serial === serial;
    }
    const cardId = slot.pokemon?.id;
    return cardId !== undefined && candidate.pokemon?.id === cardId;
  };
  if (matches(player.active)) {
    return player.active;
  }
  return player.bench.find(matches);
}

function shallowArrayEqual(left: readonly unknown[], right: readonly unknown[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

function applyDamageReplayEvent(player: PlayerView, event: ActionTimelineEvent): boolean {
  const params = event.params as Record<string, unknown> | undefined;
  const serial = replayEventSerial(event);
  const cardId = finiteNumber(params?.cardId);
  const value = Number(params?.value);
  if (!Number.isFinite(value)) {
    return false;
  }

  let updated = false;
  const updateSlot = (slot: PokemonSlotView): PokemonSlotView => {
    const matches = serial !== undefined
      ? slot.pokemon?.serial === serial
      : cardId !== undefined && slot.pokemon?.id === cardId;
    if (!matches) {
      return slot;
    }
    updated = true;
    return {
      ...slot,
      damage: Math.max(0, Math.round(slot.damage - value)),
    };
  };

  player.active = updateSlot(player.active);
  player.bench = player.bench.map(updateSlot);
  return updated;
}

function isBoardStateEvent(kind: string | undefined): boolean {
  return [
    'Attack',
    'Attach',
    'Change',
    'Evolve',
    'Devolve',
    'MoveAttached',
    'Switch',
    'HpChange',
    'HPChange',
    'Poisoned',
    'Burned',
    'Asleep',
    'Paralyzed',
    'Confused',
  ].includes(kind ?? '');
}

function applyReplayAreaDelta(
  player: PlayerView,
  currentPlayer: PlayerView,
  area: number,
  delta: -1 | 1,
  event?: ActionTimelineEvent,
): void {
  if (area === CabtAreaType.DECK) {
    player.deckCount = Math.max(0, player.deckCount + delta);
    return;
  }
  if (area === CabtAreaType.HAND) {
    player.hand = delta > 0 ? addCardToHand(player, currentPlayer) : removeMovedCardFromHand(player.hand, event);
    return;
  }
  if (area === CabtAreaType.PRIZE) {
    player.prizesLeft = Math.max(0, player.prizesLeft + delta);
    return;
  }
  if (area === CabtAreaType.ACTIVE) {
    player.active = currentPlayer.active;
    return;
  }
  if (area === CabtAreaType.BENCH) {
    player.bench = delta > 0 ? addCardToBench(player, currentPlayer, event) : currentPlayer.bench;
    return;
  }
  if (area === CabtAreaType.DISCARD) {
    player.discard = currentPlayer.discard;
    return;
  }
  if (area === CabtAreaType.STADIUM) {
    player.stadium = delta > 0 ? currentPlayer.stadium : removeMovedCardFromZone(player.stadium, event);
    return;
  }
  if (area === CabtAreaType.ENERGY || area === CabtAreaType.TOOL || area === CabtAreaType.PRE_EVOLUTION) {
    player.active = currentPlayer.active;
    player.bench = currentPlayer.bench;
  }
}

function removeMovedCardFromZone(cards: CardView[], event: ActionTimelineEvent | undefined): CardView[] {
  const params = event?.params as Record<string, unknown> | undefined;
  const serial = event ? replayEventSerial(event) : undefined;
  if (serial !== undefined) {
    return cards.filter((card) => card.serial !== serial);
  }

  const cardId = finiteNumber(params?.cardId);
  if (cardId !== undefined) {
    const index = cards.findIndex((card) => card.id === cardId);
    return index >= 0 ? removeAt(cards, index) : cards;
  }

  return cards.slice(0, -1);
}

function removeMovedCardFromHand(hand: CardView[], event: ActionTimelineEvent | undefined): CardView[] {
  const params = event?.params as Record<string, unknown> | undefined;
  const serial = event ? replayEventSerial(event) : undefined;
  if (serial !== undefined) {
    const index = hand.findIndex((card) => card.serial === serial);
    if (index >= 0) {
      return removeAt(hand, index);
    }
  }

  const cardId = finiteNumber(params?.cardId);
  if (cardId !== undefined) {
    const index = hand.findIndex((card) => card.id === cardId);
    if (index >= 0) {
      return removeAt(hand, index);
    }
  }

  return resizedHand(hand, hand.length - 1);
}

function removeAt<T>(items: T[], index: number): T[] {
  return [...items.slice(0, index), ...items.slice(index + 1)];
}

function addCardToHand(player: PlayerView, currentPlayer: PlayerView): CardView[] {
  const nextCard = currentPlayer.hand[player.hand.length] ?? cabtFaceDownCard();
  return [...player.hand, nextCard];
}

function addCardToDiscard(player: PlayerView, currentPlayer: PlayerView, event: ActionTimelineEvent): CardView[] {
  const eventCard = cardViewFromEvent(event);
  const currentNewCard = currentPlayer.discard.find((card) => eventCardMatches(card, event));
  const nextCard = currentNewCard ?? eventCard ?? currentPlayer.discard.at(-1) ?? cabtFaceDownCard();
  if (player.discard.some((card) => sameKnownCard(card, nextCard))) {
    return player.discard;
  }
  return [...player.discard, nextCard];
}

function addCardToBench(player: PlayerView, currentPlayer: PlayerView, event: ActionTimelineEvent | undefined): PokemonSlotView[] {
  const params = event?.params as Record<string, unknown> | undefined;
  const explicitIndex = finiteNumber(params?.toIndex ?? params?.index ?? params?.benchIndex);
  const currentSlot = currentPlayer.bench.find((slot) => slot.pokemon && event && eventCardMatches(slot.pokemon, event));
  if (!currentSlot) {
    return player.bench;
  }

  let index = player.bench.findIndex((slot) => slot.empty);
  if (explicitIndex !== undefined && Number.isInteger(explicitIndex)) {
    index = explicitIndex;
  } else if (currentSlot.index !== undefined && Number.isInteger(currentSlot.index)) {
    index = currentSlot.index;
  }
  if (!Number.isInteger(index) || index < 0) {
    return player.bench;
  }

  const bench = player.bench.length ? [...player.bench] : currentPlayer.bench.map((slot) => ({ ...slot }));
  while (bench.length <= index && currentPlayer.bench[bench.length]) {
    bench.push(currentPlayer.bench[bench.length]);
  }
  if (!bench[index]) {
    return bench;
  }
  bench[index] = currentSlot;
  return bench;
}

function slotCards(slot: PokemonSlotView): CardView[] {
  return [
    ...(slot.pokemon ? [slot.pokemon] : []),
    ...slot.cards,
    ...slot.energy,
    ...slot.tools,
  ];
}

function resizedHand(hand: CardView[], count: number): CardView[] {
  const nextCount = Math.max(0, Math.round(count));
  if (hand.length >= nextCount) {
    return hand.slice(0, nextCount);
  }
  return [
    ...hand,
    ...Array.from({ length: nextCount - hand.length }, () => cabtFaceDownCard()),
  ];
}
