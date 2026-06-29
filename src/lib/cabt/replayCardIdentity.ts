import { cabtCardToView } from './replayCardData';
import type { ActionTimelineEvent, CardView } from '../game/types';

export function eventCardMatches(card: CardView, event: ActionTimelineEvent): boolean {
  const params = event.params as Record<string, unknown> | undefined;
  const serial = Number(params?.serial);
  if (Number.isFinite(serial)) {
    return card.serial === serial;
  }
  const cardId = Number(params?.cardId);
  return Number.isFinite(cardId) && card.id === cardId;
}

export function sameKnownCard(left: CardView, right: CardView): boolean {
  if (left.serial !== undefined && right.serial !== undefined) {
    return left.serial === right.serial;
  }
  return left.id === right.id && left.name === right.name;
}

export function cardViewFromEvent(event: ActionTimelineEvent): CardView | undefined {
  const params = event.params as Record<string, unknown> | undefined;
  const cardId = Number(params?.cardId);
  if (!Number.isFinite(cardId)) {
    return undefined;
  }
  return cabtCardToView({
    id: cardId,
    serial: Number.isFinite(Number(params?.serial)) ? Number(params?.serial) : undefined,
    playerIndex: event.playerIndex,
  });
}
