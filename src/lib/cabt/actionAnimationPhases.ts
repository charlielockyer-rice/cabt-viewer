import { CabtAreaType } from './types';
import type { ActionTimelineEvent } from '../game/types';

export const actionAnimationTiming = {
  handMoveMs: 360,
  handMoveStepMs: 60,
  deckDiscardMs: 300,
  deckDiscardStepMs: 300,
  deckDrawMs: 320,
  deckDrawStepMs: 35,
  deckShuffleMs: 980,
  deckRevealMs: 1180,
  deckRevealStepMs: 45,
  deckRevealReturnMs: 420,
  deckRevealReturnStepMs: 35,
  stadiumMoveMs: 520,
  prizeTakeMs: 1180,
  prizeTakeStepMs: 45,
  evolveMs: 680,
  attackAnnounceMs: 520,
  abilityAnnounceMs: 560,
  coinAnnounceMs: 520,
  conditionAnnounceMs: 560,
  damageMs: 320,
  damageVisualMs: 560,
  knockOutMs: 620,
  boardMoveMs: 520,
} as const;

export type ActionAnimationPhase = {
  key: string;
  durationMs: number;
  stepMs: number;
};

export function actionAnimationPhaseForEvent(event: ActionTimelineEvent): ActionAnimationPhase | null {
  const key = actionAnimationPhaseKey(event);
  if (!key) {
    return null;
  }
  return actionAnimationPhaseForKey(key);
}

export function actionAnimationTimelinePhaseForEvent(
  event: ActionTimelineEvent,
  previousPhaseKeys: readonly string[],
): ActionAnimationPhase | null {
  const key = actionAnimationTimelinePhaseKey(event, previousPhaseKeys);
  if (!key) {
    return null;
  }
  return actionAnimationPhaseForKey(key);
}

export function actionAnimationTimelinePhaseKey(
  event: ActionTimelineEvent,
  previousPhaseKeys: readonly string[],
): string | null {
  const key = actionAnimationPhaseKey(event);
  if (!key) {
    return null;
  }
  if (
    key.startsWith('Damage:')
    && !previousPhaseKeys.some((phaseKey) => phaseKey.startsWith('Attack:') || phaseKey.startsWith('Condition:'))
  ) {
    return null;
  }
  if (key.startsWith('KnockOut:') && !previousPhaseKeys.some((phaseKey) => phaseKey.startsWith('Attack:'))) {
    return null;
  }
  if (key.startsWith('AttachedMove:') && previousPhaseKeys.some((phaseKey) => phaseKey.startsWith('KnockOut:'))) {
    return null;
  }
  return key;
}

export function actionAnimationTimelinePhaseKeyForEvent(
  events: readonly ActionTimelineEvent[],
  targetEvent: ActionTimelineEvent,
): string | null {
  const phaseKeys: string[] = [];
  for (const event of events) {
    const key = actionAnimationTimelinePhaseKey(event, phaseKeys);
    if (event.id === targetEvent.id) {
      return key;
    }
    if (key) {
      phaseKeys.push(key);
    }
  }
  return null;
}

export function actionAnimationPhaseForKey(key: string): ActionAnimationPhase {
  return {
    key,
    durationMs: actionAnimationPhaseCardDurationMs(key),
    stepMs: actionAnimationPhaseStepMs(key),
  };
}

export function actionAnimationPhaseKey(event: ActionTimelineEvent): string | null {
  const params = event.params as Record<string, unknown> | undefined;
  const fromArea = Number(params?.fromArea);
  const toArea = Number(params?.toArea);
  const playerKey = event.playerIndex ?? 'unknown';

  if (event.kind === 'Play' || event.kind === 'Attach' || event.kind === 'Evolve') {
    return `${event.kind}:${playerKey}`;
  }
  if (event.kind === 'Attack') {
    return `Attack:${playerKey}`;
  }
  if (event.kind === 'Ability') {
    return `Ability:${playerKey}`;
  }
  if (event.kind === 'Coin') {
    return `Coin:${playerKey}`;
  }
  if (isSpecialConditionEvent(event.kind)) {
    return `Condition:${playerKey}`;
  }
  if (event.kind === 'Switch') {
    return `BoardMove:${playerKey}`;
  }
  if (event.kind === 'HpChange' || event.kind === 'HPChange') {
    return `Damage:${playerKey}`;
  }
  if (isMoveCardEventKind(event.kind)) {
    if (isBoardPositionMove(fromArea, toArea)) {
      return `BoardMove:${playerKey}`;
    }
    if (isBoardToDeckMove(fromArea, toArea)) {
      return `BoardToDeck:${playerKey}`;
    }
    if (isKnockOutMove(fromArea, toArea)) {
      return `KnockOut:${playerKey}`;
    }
    if (fromArea === CabtAreaType.HAND && toArea === CabtAreaType.DECK) {
      return `HandToDeck:${playerKey}`;
    }
    if (fromArea === CabtAreaType.DISCARD && (toArea === CabtAreaType.HAND || toArea === CabtAreaType.DECK)) {
      return `DiscardRecover:${playerKey}:${toArea}`;
    }
    if (fromArea === CabtAreaType.HAND) {
      return `HandMove:${playerKey}:${toArea}`;
    }
    if (fromArea === CabtAreaType.DECK && toArea === CabtAreaType.DISCARD) {
      return `DeckDiscard:${playerKey}`;
    }
    if (fromArea === CabtAreaType.DECK && toArea === CabtAreaType.LOOKING) {
      return `DeckReveal:${playerKey}`;
    }
    if (fromArea === CabtAreaType.DECK && toArea === CabtAreaType.HAND) {
      return `DeckSearchReveal:${playerKey}`;
    }
    if (fromArea === CabtAreaType.DECK && (toArea === CabtAreaType.ACTIVE || toArea === CabtAreaType.BENCH)) {
      return `DeckBoardPlace:${playerKey}`;
    }
    if (fromArea === CabtAreaType.DECK && toArea === CabtAreaType.PRIZE) {
      return `DeckPrizePlace:${playerKey}`;
    }
    if (fromArea === CabtAreaType.LOOKING && toArea === CabtAreaType.DECK) {
      return `DeckRevealReturn:${playerKey}`;
    }
    if (fromArea === CabtAreaType.LOOKING && toArea === CabtAreaType.HAND) {
      return `DeckRevealTake:${playerKey}`;
    }
    if (isAttachedCardArea(fromArea) && isAttachedCardMoveDestination(toArea)) {
      return `AttachedMove:${playerKey}:${fromArea}->${toArea}`;
    }
    if (fromArea === CabtAreaType.STADIUM && toArea === CabtAreaType.DISCARD) {
      return `StadiumMove:${playerKey}:${fromArea}->${toArea}`;
    }
    if (fromArea === CabtAreaType.PRIZE && toArea === CabtAreaType.HAND) {
      return `PrizeTake:${playerKey}`;
    }
  }
  if (event.kind === 'Shuffle') {
    return `Shuffle:${playerKey}`;
  }
  if (event.kind === 'Draw' || event.kind === 'DrawReverse') {
    return `Draw:${playerKey}`;
  }
  return null;
}

export function actionAnimationPhaseDurationMs(key: string, count: number): number {
  const durationMs = actionAnimationPhaseCardDurationMs(key);
  const stepMs = actionAnimationPhaseStepMs(key);
  return count <= 0 ? 0 : durationMs + Math.max(0, count - 1) * stepMs;
}

export function actionAnimationPhaseCardDurationMs(key: string): number {
  if (key.startsWith('Shuffle:')) {
    return actionAnimationTiming.deckShuffleMs;
  }
  if (key.startsWith('Draw:')) {
    return actionAnimationTiming.deckDrawMs;
  }
  if (key.startsWith('DeckDiscard:')) {
    return actionAnimationTiming.deckDiscardMs;
  }
  if (key.startsWith('DeckReveal:')) {
    return actionAnimationTiming.deckRevealMs;
  }
  if (key.startsWith('DeckSearchReveal:')) {
    return actionAnimationTiming.deckRevealMs;
  }
  if (key.startsWith('DeckBoardPlace:')) {
    return actionAnimationTiming.boardMoveMs;
  }
  if (key.startsWith('DeckPrizePlace:')) {
    return actionAnimationTiming.boardMoveMs;
  }
  if (key.startsWith('DeckRevealReturn:')) {
    return actionAnimationTiming.deckRevealReturnMs;
  }
  if (key.startsWith('DeckRevealTake:')) {
    return actionAnimationTiming.handMoveMs;
  }
  if (key.startsWith('AttachedMove:')) {
    return actionAnimationTiming.handMoveMs;
  }
  if (key.startsWith('DiscardRecover:')) {
    return actionAnimationTiming.handMoveMs;
  }
  if (key.startsWith('PrizeTake:')) {
    return actionAnimationTiming.prizeTakeMs;
  }
  if (key.startsWith('StadiumMove:')) {
    return actionAnimationTiming.stadiumMoveMs;
  }
  if (key.startsWith('Evolve:')) {
    return actionAnimationTiming.evolveMs;
  }
  if (key.startsWith('Attack:')) {
    return actionAnimationTiming.attackAnnounceMs;
  }
  if (key.startsWith('Ability:')) {
    return actionAnimationTiming.abilityAnnounceMs;
  }
  if (key.startsWith('Coin:')) {
    return actionAnimationTiming.coinAnnounceMs;
  }
  if (key.startsWith('Condition:')) {
    return actionAnimationTiming.conditionAnnounceMs;
  }
  if (key.startsWith('Damage:')) {
    return actionAnimationTiming.damageVisualMs;
  }
  if (key.startsWith('KnockOut:')) {
    return actionAnimationTiming.knockOutMs;
  }
  if (key.startsWith('BoardToDeck:')) {
    return actionAnimationTiming.boardMoveMs;
  }
  if (key.startsWith('BoardMove:')) {
    return actionAnimationTiming.boardMoveMs;
  }
  return actionAnimationTiming.handMoveMs;
}

export function actionAnimationPhaseStepMs(key: string): number {
  if (key.startsWith('Draw:')) {
    return actionAnimationTiming.deckDrawStepMs;
  }
  if (key.startsWith('DeckDiscard:')) {
    return actionAnimationTiming.deckDiscardStepMs;
  }
  if (key.startsWith('DeckReveal:')) {
    return actionAnimationTiming.deckRevealStepMs;
  }
  if (key.startsWith('DeckSearchReveal:')) {
    return actionAnimationTiming.deckRevealStepMs;
  }
  if (key.startsWith('DeckBoardPlace:')) {
    return actionAnimationTiming.handMoveStepMs;
  }
  if (key.startsWith('DeckPrizePlace:')) {
    return actionAnimationTiming.handMoveStepMs;
  }
  if (key.startsWith('DeckRevealReturn:')) {
    return actionAnimationTiming.deckRevealReturnStepMs;
  }
  if (key.startsWith('DeckRevealTake:')) {
    return actionAnimationTiming.handMoveStepMs;
  }
  if (key.startsWith('AttachedMove:')) {
    return actionAnimationTiming.handMoveStepMs;
  }
  if (key.startsWith('DiscardRecover:')) {
    return actionAnimationTiming.handMoveStepMs;
  }
  if (key.startsWith('PrizeTake:')) {
    return actionAnimationTiming.prizeTakeStepMs;
  }
  if (key.startsWith('StadiumMove:')) {
    return actionAnimationTiming.handMoveStepMs;
  }
  if (key.startsWith('Shuffle:')) {
    return actionAnimationTiming.deckShuffleMs;
  }
  if (key.startsWith('Attack:')) {
    return actionAnimationTiming.attackAnnounceMs;
  }
  if (key.startsWith('Ability:')) {
    return actionAnimationTiming.abilityAnnounceMs;
  }
  if (key.startsWith('Coin:')) {
    return actionAnimationTiming.coinAnnounceMs;
  }
  if (key.startsWith('Condition:')) {
    return actionAnimationTiming.conditionAnnounceMs;
  }
  if (key.startsWith('Damage:')) {
    return actionAnimationTiming.damageVisualMs;
  }
  if (key.startsWith('KnockOut:')) {
    return actionAnimationTiming.knockOutMs;
  }
  if (key.startsWith('BoardToDeck:')) {
    return actionAnimationTiming.handMoveStepMs;
  }
  if (key.startsWith('BoardMove:')) {
    return 0;
  }
  return actionAnimationTiming.handMoveStepMs;
}

export function actionAnimationPhaseUsesSourceView(key: string): boolean {
  return key.startsWith('HandToDeck:')
    || key.startsWith('Play:')
    || key.startsWith('HandMove:')
    || key.startsWith('Attach:')
    || key.startsWith('Evolve:')
    || key.startsWith('Ability:')
    || key.startsWith('Attack:')
    || key.startsWith('Condition:')
    || key.startsWith('Damage:')
    || key.startsWith('KnockOut:')
    || key.startsWith('BoardToDeck:')
    || key.startsWith('BoardMove:')
    || key.startsWith('AttachedMove:')
    || key.startsWith('DiscardRecover:')
    || key.startsWith('StadiumMove:')
    || key.startsWith('PrizeTake:');
}

export function actionAnimationPhaseNeedsDedicatedView(key: string): boolean {
  return key.startsWith('Evolve:')
    || key.startsWith('Ability:')
    || key.startsWith('Attack:')
    || key.startsWith('Coin:')
    || key.startsWith('Condition:')
    || key.startsWith('Damage:')
    || key.startsWith('KnockOut:')
    || key.startsWith('BoardToDeck:')
    || key.startsWith('BoardMove:')
    || key.startsWith('AttachedMove:')
    || key.startsWith('DiscardRecover:')
    || key.startsWith('StadiumMove:')
    || key.startsWith('PrizeTake:');
}

export function actionAnimationPhaseMayHavePlan(key: string): boolean {
  return key.startsWith('HandToDeck:')
    || key.startsWith('Play:')
    || key.startsWith('HandMove:')
    || key.startsWith('Attach:')
    || key.startsWith('Evolve:')
    || key.startsWith('Ability:')
    || key.startsWith('Attack:')
    || key.startsWith('Coin:')
    || key.startsWith('Condition:')
    || key.startsWith('Damage:')
    || key.startsWith('KnockOut:')
    || key.startsWith('BoardToDeck:')
    || key.startsWith('BoardMove:')
    || key.startsWith('AttachedMove:')
    || key.startsWith('Draw:')
    || key.startsWith('Shuffle:')
    || key.startsWith('DeckDiscard:')
    || key.startsWith('DeckBoardPlace:')
    || key.startsWith('DeckPrizePlace:')
    || key.startsWith('DiscardRecover:')
    || key.startsWith('StadiumMove:')
    || key.startsWith('DeckReveal:')
    || key.startsWith('DeckSearchReveal:')
    || key.startsWith('DeckRevealReturn:')
    || key.startsWith('DeckRevealTake:')
    || key.startsWith('PrizeTake:');
}

export function isSpecialConditionEvent(kind: string | undefined): boolean {
  return kind === 'Poisoned'
    || kind === 'Burned'
    || kind === 'Asleep'
    || kind === 'Paralyzed'
    || kind === 'Confused';
}

export function isMoveCardEventKind(kind: string | undefined): boolean {
  return kind === 'MoveCard' || kind === 'MoveCardReverse';
}

export function isKnockOutMove(fromArea: number, toArea: number): boolean {
  return toArea === CabtAreaType.DISCARD
    && (fromArea === CabtAreaType.ACTIVE || fromArea === CabtAreaType.BENCH);
}

export function isBoardPositionMove(fromArea: number, toArea: number): boolean {
  return (fromArea === CabtAreaType.ACTIVE && toArea === CabtAreaType.BENCH)
    || (fromArea === CabtAreaType.BENCH && toArea === CabtAreaType.ACTIVE);
}

export function isBoardToDeckMove(fromArea: number, toArea: number): boolean {
  return toArea === CabtAreaType.DECK
    && (fromArea === CabtAreaType.ACTIVE || fromArea === CabtAreaType.BENCH);
}

export function isAttachedCardArea(area: number): boolean {
  return area === CabtAreaType.ENERGY
    || area === CabtAreaType.TOOL;
}

export function isAttachedCardMoveDestination(area: number): boolean {
  return area === CabtAreaType.DISCARD
    || area === CabtAreaType.DECK
    || area === CabtAreaType.HAND;
}
