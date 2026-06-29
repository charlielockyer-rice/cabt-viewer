import { replayEventMoveAreas } from '../cabt/replayEventAreas';
import { CabtAreaType } from '../cabt/types';
import type { ActionTimelineEvent } from '../game/types';

export type LiveHandPlayTargetResolver = {
  pokemon(serial: number, cardId: number, playerIndex: number | undefined): HTMLElement | null;
  pokemonBySerial(serial: number): HTMLElement | null;
  playZone(playerIndex: number | undefined, serial: number): HTMLElement | null;
  stadium(playerIndex: number | undefined, serial: number): HTMLElement | null;
  discard(playerIndex: number | undefined, serial: number): HTMLElement | null;
  discardCard(playerIndex: number | undefined, serial: number): HTMLElement | null;
  active(playerIndex: number | undefined): HTMLElement | null;
  firstBench(playerIndex: number | undefined): HTMLElement | null;
  isStadium(cardId: number): boolean;
};

export function isLiveHandPlayEvent(event: ActionTimelineEvent): boolean {
  const params = event.params as Record<string, unknown> | undefined;
  if (event.kind === 'Play' || event.kind === 'Attach' || event.kind === 'Evolve') {
    return Number.isFinite(Number(params?.cardId));
  }
  const areas = replayEventMoveAreas(event);
  return event.kind === 'MoveCard'
    && areas?.fromArea === CabtAreaType.HAND
    && (
      areas.toArea === CabtAreaType.DISCARD
      || areas.toArea === CabtAreaType.ACTIVE
      || areas.toArea === CabtAreaType.BENCH
    )
    && Number.isFinite(Number(params?.cardId));
}

export function liveHandPlayTargetForEvent(
  event: ActionTimelineEvent,
  resolver: LiveHandPlayTargetResolver,
): HTMLElement | null {
  const params = event.params as Record<string, unknown> | undefined;
  const playerIndex = event.playerIndex;
  const serial = Number(params?.serial);
  const cardId = Number(params?.cardId);

  if (event.kind === 'Attach') {
    return resolver.pokemon(Number(params?.serialTarget), Number(params?.cardIdTarget), playerIndex);
  }

  if (event.kind === 'Evolve') {
    return resolver.pokemon(Number(params?.serialTarget), Number(params?.cardIdTarget), playerIndex)
      ?? resolver.pokemon(serial, cardId, playerIndex);
  }

  if (Number.isFinite(serial)) {
    const boardSlot = resolver.pokemonBySerial(serial);
    if (boardSlot) {
      return boardSlot;
    }
    const discardCard = resolver.discardCard(playerIndex, serial);
    if (discardCard) {
      return discardCard;
    }
  }

  if (event.kind === 'MoveCard') {
    const areas = replayEventMoveAreas(event);
    if (areas?.toArea === CabtAreaType.DISCARD) {
      return resolver.discard(playerIndex, serial);
    }
    if (areas?.toArea === CabtAreaType.ACTIVE) {
      return resolver.active(playerIndex);
    }
    if (areas?.toArea === CabtAreaType.BENCH) {
      return resolver.pokemon(serial, cardId, playerIndex)
        ?? resolver.firstBench(playerIndex);
    }
  }

  if (event.kind === 'Play') {
    if (resolver.isStadium(cardId)) {
      return resolver.stadium(playerIndex, serial);
    }
    return resolver.playZone(playerIndex, serial)
      ?? resolver.discard(playerIndex, serial)
      ?? resolver.pokemon(serial, cardId, playerIndex);
  }

  return null;
}
