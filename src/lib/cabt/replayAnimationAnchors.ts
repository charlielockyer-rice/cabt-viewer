import { isBoardPositionMove } from './actionAnimationPhases';
import { isMoveCardKind } from './replayActionGroups';
import { eventCardMatches } from './replayCardIdentity';
import { finiteNumber } from './replayEventParams';
import {
  isCabtResolvingTrainerCard,
  isCabtStadiumCard,
} from './replayCardData';
import { CabtAreaType } from './types';
import type { AnimationEventPhase } from './replayAnimationPhases';
import type { AnimationAnchorRef } from '../animations/replayAnimationPlan';
import type { ActionTimelineEvent, CardView, GameView, PlayerView, PokemonSlotView } from '../game/types';

export function handDestinationAnchorForEvent(view: GameView, event: ActionTimelineEvent): AnimationAnchorRef | undefined {
  const playerIndex = event.playerIndex;
  if (playerIndex === undefined) {
    return undefined;
  }
  const hand = view.players[playerIndex]?.hand ?? [];
  const handIndex = hand.findIndex((card) => eventCardMatches(card, event));
  const card = hand[handIndex];
  return handIndex < 0 || !card
    ? undefined
    : {
        kind: 'hand-card',
        playerIndex,
        handIndex,
        serial: card.serial,
      };
}

export function prizeSourceAnchorForEvent(
  view: GameView,
  event: ActionTimelineEvent,
  phaseEvents: ActionTimelineEvent[],
): AnimationAnchorRef | undefined {
  const playerIndex = event.playerIndex;
  if (playerIndex === undefined) {
    return undefined;
  }
  const params = event.params as Record<string, unknown> | undefined;
  const explicitIndex = finiteNumber(params?.fromIndex)
    ?? finiteNumber(params?.index)
    ?? finiteNumber(params?.prizeIndex);
  if (explicitIndex !== undefined) {
    return { kind: 'prize-card', playerIndex, prizeIndex: explicitIndex };
  }

  const samePlayerPrizeEvents = phaseEvents.filter((candidate) => {
    const candidateParams = candidate.params as Record<string, unknown> | undefined;
    return candidate.playerIndex === playerIndex
      && isMoveCardKind(candidate.kind)
      && Number(candidateParams?.fromArea) === CabtAreaType.PRIZE
      && Number(candidateParams?.toArea) === CabtAreaType.HAND;
  });
  const eventIndex = samePlayerPrizeEvents.findIndex((candidate) => candidate.id === event.id);
  if (eventIndex < 0) {
    return undefined;
  }
  const prizesLeft = view.players[playerIndex]?.prizesLeft ?? 0;
  return {
    kind: 'prize-card',
    playerIndex,
    prizeIndex: Math.max(0, prizesLeft - samePlayerPrizeEvents.length + eventIndex),
  };
}

export function handPlayTargetAnchorForEvent(view: GameView, event: ActionTimelineEvent): AnimationAnchorRef | undefined {
  const playerIndex = event.playerIndex;
  if (playerIndex === undefined) {
    return undefined;
  }
  const params = event.params as Record<string, unknown> | undefined;
  const serial = finiteNumber(params?.serial);
  const cardId = finiteNumber(params?.cardId);
  if (event.kind === 'Play') {
    if (cardId !== undefined && isCabtStadiumCard(cardId)) {
      return { kind: 'stadium-card', playerIndex, serial };
    }
    const boardDestination = boardPokemonDestinationForEvent(view.players[playerIndex], event);
    if (boardDestination?.slot.pokemon) {
      return {
        kind: 'pokemon-card',
        playerIndex,
        slot: boardDestination.kind,
        slotIndex: boardDestination.slot.index,
        serial: boardDestination.slot.pokemon.serial,
      };
    }
    if (cardId !== undefined && isCabtResolvingTrainerCard(cardId)) {
      return { kind: 'play-zone-card', playerIndex, serial };
    }
    return attachedSourceAnchorForEvent(view.players[playerIndex], event, CabtAreaType.TOOL)
      ?? attachedSourceAnchorForEvent(view.players[playerIndex], event, CabtAreaType.ENERGY);
  }
  if (event.kind === 'Attach') {
    return attachedSourceAnchorForEvent(view.players[playerIndex], event, CabtAreaType.ENERGY)
      ?? attachedSourceAnchorForEvent(view.players[playerIndex], event, CabtAreaType.TOOL);
  }
  if (event.kind === 'Evolve') {
    const targetSerial = finiteNumber(params?.serialTarget);
    const targetCardId = finiteNumber(params?.cardIdTarget);
    return boardSlotAnchorForPokemon(view.players[playerIndex], targetSerial, targetCardId);
  }
  if (!isMoveCardKind(event.kind)) {
    return undefined;
  }
  const toArea = Number(params?.toArea);
  if (toArea === CabtAreaType.DISCARD) {
    return { kind: 'discard-card', playerIndex, serial };
  }
  if (toArea === CabtAreaType.ACTIVE || toArea === CabtAreaType.BENCH) {
    const destination = boardPokemonDestinationForEvent(view.players[playerIndex], event);
    if (!destination?.slot.pokemon) {
      return undefined;
    }
    return {
      kind: 'pokemon-card',
      playerIndex,
      slot: destination.kind,
      slotIndex: destination.slot.index,
      serial: destination.slot.pokemon.serial,
    };
  }
  return undefined;
}

export function revealAttachTargetAnchorForEvent(view: GameView, event: ActionTimelineEvent): AnimationAnchorRef | undefined {
  const playerIndex = event.playerIndex;
  if (playerIndex === undefined) {
    return undefined;
  }
  return attachedSourceAnchorForEvent(view.players[playerIndex], event, CabtAreaType.ENERGY)
    ?? attachedSourceAnchorForEvent(view.players[playerIndex], event, CabtAreaType.TOOL);
}

export function boardMoveSourceAnchor(view: GameView, event: ActionTimelineEvent, fromArea: number): AnimationAnchorRef | undefined {
  const playerIndex = event.playerIndex;
  if (playerIndex === undefined) {
    return undefined;
  }
  if (fromArea === CabtAreaType.DECK) {
    return { kind: 'deck-top', playerIndex };
  }
  if (fromArea === CabtAreaType.STADIUM) {
    const player = view.players[playerIndex];
    const card = player?.stadium.find((candidate) => eventCardMatches(candidate, event));
    return card ? { kind: 'stadium-card', playerIndex, serial: card.serial } : undefined;
  }
  if (fromArea === CabtAreaType.DISCARD) {
    const params = event.params as Record<string, unknown> | undefined;
    const card = view.players[playerIndex]?.discard.find((candidate) => eventCardMatches(candidate, event));
    return {
      kind: 'discard-card',
      playerIndex,
      serial: card?.serial ?? finiteNumber(params?.serial),
    };
  }
  if (fromArea === CabtAreaType.ENERGY || fromArea === CabtAreaType.TOOL) {
    return attachedSourceAnchorForEvent(view.players[playerIndex], event, fromArea);
  }
  if (fromArea === CabtAreaType.ACTIVE || fromArea === CabtAreaType.BENCH) {
    return boardSlotAnchorForEvent(view.players[playerIndex], event);
  }
  return undefined;
}

export function attachedSourceAnchorForEvent(
  player: PlayerView | undefined,
  event: ActionTimelineEvent,
  fromArea: number,
): AnimationAnchorRef | undefined {
  if (!player) {
    return undefined;
  }
  const params = event.params as Record<string, unknown> | undefined;
  const serial = finiteNumber(params?.serial);
  const cardId = finiteNumber(params?.cardId);
  const matches = (card: CardView) =>
    (serial !== undefined && card.serial === serial)
    || (serial === undefined && cardId !== undefined && card.id === cardId);
  const slots: Array<{ slot: PokemonSlotView; kind: 'active' | 'bench' }> = [
    { slot: player.active, kind: 'active' },
    ...player.bench.map((slot) => ({ slot, kind: 'bench' as const })),
  ];
  for (const { slot, kind } of slots) {
    const cards = fromArea === CabtAreaType.ENERGY ? slot.energy : slot.tools;
    if (cards.some(matches)) {
      return {
        kind: fromArea === CabtAreaType.ENERGY ? 'attached-energy' : 'attached-tool',
        playerIndex: player.index,
        slot: kind,
        slotIndex: slot.index,
        serial,
      };
    }
  }
  return undefined;
}

export function boardMoveTargetAnchor(
  phase: AnimationEventPhase,
  view: GameView,
  event: ActionTimelineEvent,
  toArea: number,
): AnimationAnchorRef | undefined {
  const playerIndex = event.playerIndex;
  if (playerIndex === undefined) {
    return undefined;
  }
  if (toArea === CabtAreaType.DECK) {
    return { kind: 'deck-top', playerIndex };
  }
  if (toArea === CabtAreaType.DISCARD) {
    const discard = view.players[playerIndex]?.discard ?? [];
    const card = discard.find((candidate) => eventCardMatches(candidate, event));
    if (card) {
      return { kind: 'discard-card', playerIndex, serial: card.serial };
    }
    return { kind: 'discard-pile', playerIndex };
  }
  if (toArea === CabtAreaType.HAND) {
    const params = event.params as Record<string, unknown> | undefined;
    if (Number(params?.fromArea) === CabtAreaType.DISCARD) {
      return { kind: 'hand', playerIndex };
    }
    return handDestinationAnchorForEvent(view, event);
  }
  if (toArea === CabtAreaType.PRIZE) {
    return prizeDestinationAnchorForEvent(view, event, phase.events);
  }
  if (toArea === CabtAreaType.ACTIVE) {
    const reciprocal = reciprocalBoardPositionEvent(phase, event);
    if (reciprocal) {
      return boardSlotAnchorForEvent(view.players[playerIndex], reciprocal);
    }
    return { kind: 'board-slot', playerIndex, slot: 'active', slotIndex: 0 };
  }
  if (toArea === CabtAreaType.BENCH) {
    const reciprocal = reciprocalBoardPositionEvent(phase, event);
    if (reciprocal) {
      return boardSlotAnchorForEvent(view.players[playerIndex], reciprocal);
    }
    const destination = boardPokemonDestinationForEvent(view.players[playerIndex], event);
    if (destination) {
      return { kind: 'board-slot', playerIndex, slot: destination.kind, slotIndex: destination.slot.index };
    }
    const params = event.params as Record<string, unknown> | undefined;
    const benchIndex = finiteNumber(params?.toIndex) ?? finiteNumber(params?.index) ?? finiteNumber(params?.benchIndex);
    return benchIndex === undefined ? undefined : { kind: 'board-slot', playerIndex, slot: 'bench', slotIndex: benchIndex };
  }
  return undefined;
}

export function boardSlotAnchorForEvent(player: PlayerView | undefined, event: ActionTimelineEvent): AnimationAnchorRef | undefined {
  const params = event.params as Record<string, unknown> | undefined;
  return boardSlotAnchorForPokemon(player, finiteNumber(params?.serial), finiteNumber(params?.cardId));
}

export function boardSlotAnchorForPokemon(
  player: PlayerView | undefined,
  serial: number | undefined,
  cardId: number | undefined,
): AnimationAnchorRef | undefined {
  if (!player) {
    return undefined;
  }
  const matches = (slot: PokemonSlotView) =>
    (serial !== undefined && slot.pokemon?.serial === serial)
    || (serial === undefined && cardId !== undefined && slot.pokemon?.id === cardId);
  if (matches(player.active)) {
    return { kind: 'board-slot', playerIndex: player.index, slot: 'active', slotIndex: player.active.index };
  }
  const benchSlot = player.bench.find(matches);
  return benchSlot ? { kind: 'board-slot', playerIndex: player.index, slot: 'bench', slotIndex: benchSlot.index } : undefined;
}

export function boardPokemonDestinationForEvent(
  player: PlayerView | undefined,
  event: ActionTimelineEvent,
): { kind: 'active' | 'bench'; slot: PokemonSlotView } | undefined {
  if (!player) {
    return undefined;
  }
  if (player.active.pokemon && eventCardMatches(player.active.pokemon, event)) {
    return { kind: 'active', slot: player.active };
  }
  const benchSlot = player.bench.find((slot) => slot.pokemon && eventCardMatches(slot.pokemon, event));
  return benchSlot ? { kind: 'bench', slot: benchSlot } : undefined;
}

function prizeDestinationAnchorForEvent(
  view: GameView,
  event: ActionTimelineEvent,
  phaseEvents: ActionTimelineEvent[],
): AnimationAnchorRef | undefined {
  const playerIndex = event.playerIndex;
  if (playerIndex === undefined) {
    return undefined;
  }
  const params = event.params as Record<string, unknown> | undefined;
  const explicitIndex = finiteNumber(params?.toIndex)
    ?? finiteNumber(params?.index)
    ?? finiteNumber(params?.prizeIndex);
  if (explicitIndex !== undefined) {
    return { kind: 'prize-card', playerIndex, prizeIndex: explicitIndex };
  }

  const samePlayerPrizeEvents = phaseEvents.filter((candidate) => {
    const candidateParams = candidate.params as Record<string, unknown> | undefined;
    return candidate.playerIndex === playerIndex
      && isMoveCardKind(candidate.kind)
      && Number(candidateParams?.fromArea) === CabtAreaType.DECK
      && Number(candidateParams?.toArea) === CabtAreaType.PRIZE;
  });
  const eventIndex = samePlayerPrizeEvents.findIndex((candidate) => candidate.id === event.id);
  if (eventIndex < 0) {
    return undefined;
  }
  const prizesLeft = view.players[playerIndex]?.prizesLeft ?? 0;
  return {
    kind: 'prize-card',
    playerIndex,
    prizeIndex: Math.max(0, prizesLeft - samePlayerPrizeEvents.length + eventIndex),
  };
}

function reciprocalBoardPositionEvent(phase: AnimationEventPhase, event: ActionTimelineEvent): ActionTimelineEvent | undefined {
  const params = event.params as Record<string, unknown> | undefined;
  const fromArea = Number(params?.fromArea);
  const toArea = Number(params?.toArea);
  if (!isBoardPositionMove(fromArea, toArea)) {
    return undefined;
  }
  return phase.events.find((candidate) => {
    if (candidate === event || candidate.playerIndex !== event.playerIndex || !isMoveCardKind(candidate.kind)) {
      return false;
    }
    const candidateParams = candidate.params as Record<string, unknown> | undefined;
    return Number(candidateParams?.fromArea) === toArea
      && Number(candidateParams?.toArea) === fromArea;
  });
}
