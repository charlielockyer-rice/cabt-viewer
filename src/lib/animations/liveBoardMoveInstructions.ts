import { replayEventMoveAreas, replayEventSerial } from '../cabt/replayEventAreas';
import { finiteNumber } from '../cabt/replayEventParams';
import { CabtAreaType } from '../cabt/types';
import type { ActionTimelineEvent } from '../game/types';

export type LiveBoardMoveElementResolver = {
  stadiumCard(playerIndex: number, serial: number): HTMLElement | null;
  deckTop(playerIndex: number): HTMLElement | null;
  pokemon(serial: number | undefined, cardId: number | undefined, playerIndex: number | undefined): HTMLElement | null;
  boardAnchor(playerIndex: number, slot: 'active' | 'bench', index: number): HTMLElement | null;
  discardCard(playerIndex: number, serial: number | undefined, cardId: number | undefined): HTMLElement | null;
  discardPile(playerIndex: number): HTMLElement | null;
};

export type LiveBoardMoveInstruction = {
  event: ActionTimelineEvent;
  source: HTMLElement;
  target: HTMLElement;
  cardId: number;
  serial?: number;
  waitForDestinationCard: boolean;
  holdUntilScopeChange: boolean;
  toDeck: boolean;
  fromDeck: boolean;
  key: string;
};

export function liveBoardMoveInstructionsForEvent(
  event: ActionTimelineEvent,
  moveEvents: readonly ActionTimelineEvent[],
  resolver: LiveBoardMoveElementResolver,
): LiveBoardMoveInstruction[] {
  if (event.kind === 'Switch') {
    return switchMoveInstructions(event, resolver);
  }

  const source = sourceElementForEvent(event, resolver);
  const target = targetElementForEvent(event, moveEvents, resolver);
  const areas = replayEventMoveAreas(event);
  const params = event.params as Record<string, unknown> | undefined;
  const cardId = finiteNumber(params?.cardId);
  if (!source || !target || !areas || cardId === undefined) {
    return [];
  }
  const serial = replayEventSerial(event);
  return [{
    event,
    source,
    target,
    cardId,
    serial,
    waitForDestinationCard: areas.toArea === CabtAreaType.DISCARD,
    holdUntilScopeChange: false,
    toDeck: areas.toArea === CabtAreaType.DECK,
    fromDeck: areas.fromArea === CabtAreaType.DECK,
    key: `${serial ?? cardId}`,
  }];
}

function switchMoveInstructions(
  event: ActionTimelineEvent,
  resolver: LiveBoardMoveElementResolver,
): LiveBoardMoveInstruction[] {
  const params = event.params as Record<string, unknown> | undefined;
  const activeCardId = finiteNumber(params?.cardIdActive);
  const benchCardId = finiteNumber(params?.cardIdBench);
  const activeSerial = finiteNumber(params?.serialActive);
  const benchSerial = finiteNumber(params?.serialBench);
  const activeSource = resolver.pokemon(activeSerial, activeCardId, event.playerIndex);
  const benchSource = resolver.pokemon(benchSerial, benchCardId, event.playerIndex);
  if (!activeSource || !benchSource || activeCardId === undefined || benchCardId === undefined) {
    return [];
  }
  return [
    {
      event,
      source: activeSource,
      target: benchSource,
      cardId: activeCardId,
      serial: activeSerial,
      waitForDestinationCard: false,
      holdUntilScopeChange: false,
      toDeck: false,
      fromDeck: false,
      key: `active-${activeSerial ?? activeCardId}`,
    },
    {
      event,
      source: benchSource,
      target: activeSource,
      cardId: benchCardId,
      serial: benchSerial,
      waitForDestinationCard: false,
      holdUntilScopeChange: false,
      toDeck: false,
      fromDeck: false,
      key: `bench-${benchSerial ?? benchCardId}`,
    },
  ];
}

function sourceElementForEvent(
  event: ActionTimelineEvent,
  resolver: LiveBoardMoveElementResolver,
): HTMLElement | null {
  const params = event.params as Record<string, unknown> | undefined;
  const areas = replayEventMoveAreas(event);
  const serial = replayEventSerial(event);
  if (areas?.fromArea === CabtAreaType.STADIUM && event.playerIndex !== undefined && serial !== undefined) {
    return resolver.stadiumCard(event.playerIndex, serial);
  }
  if (areas?.fromArea === CabtAreaType.DECK && event.playerIndex !== undefined) {
    return resolver.deckTop(event.playerIndex);
  }
  const cardId = finiteNumber(params?.cardId);
  return resolver.pokemon(serial, cardId, event.playerIndex);
}

function targetElementForEvent(
  event: ActionTimelineEvent,
  moveEvents: readonly ActionTimelineEvent[],
  resolver: LiveBoardMoveElementResolver,
): HTMLElement | null {
  const params = event.params as Record<string, unknown> | undefined;
  const playerIndex = event.playerIndex;
  const areas = replayEventMoveAreas(event);
  if (playerIndex === undefined) {
    return null;
  }
  const serial = replayEventSerial(event);
  const cardId = finiteNumber(params?.cardId);
  if (areas?.toArea === CabtAreaType.ACTIVE) {
    return resolver.pokemon(serial, cardId, playerIndex)
      ?? resolver.boardAnchor(playerIndex, 'active', 0);
  }
  if (areas?.toArea === CabtAreaType.BENCH) {
    const destination = resolver.pokemon(serial, cardId, playerIndex);
    if (destination) {
      return destination;
    }
    const benchIndex = finiteNumber(params?.toIndex ?? params?.index ?? params?.benchIndex);
    if (benchIndex !== undefined && Number.isInteger(benchIndex)) {
      return resolver.boardAnchor(playerIndex, 'bench', benchIndex);
    }
    return pairedBenchSourceElement(event, moveEvents, resolver);
  }
  if (areas?.toArea === CabtAreaType.DISCARD) {
    return resolver.discardCard(playerIndex, serial, cardId)
      ?? resolver.discardPile(playerIndex);
  }
  if (areas?.toArea === CabtAreaType.DECK) {
    return resolver.deckTop(playerIndex);
  }
  return null;
}

function pairedBenchSourceElement(
  event: ActionTimelineEvent,
  moveEvents: readonly ActionTimelineEvent[],
  resolver: LiveBoardMoveElementResolver,
): HTMLElement | null {
  const areas = replayEventMoveAreas(event);
  if (areas?.fromArea !== CabtAreaType.ACTIVE || areas.toArea !== CabtAreaType.BENCH) {
    return null;
  }
  const pairedEvent = moveEvents.find((candidate) => {
    const candidateAreas = replayEventMoveAreas(candidate);
    return candidate !== event
      && candidate.playerIndex === event.playerIndex
      && candidateAreas?.fromArea === CabtAreaType.BENCH
      && candidateAreas.toArea === CabtAreaType.ACTIVE;
  });
  return pairedEvent ? sourceElementForEvent(pairedEvent, resolver) : null;
}
