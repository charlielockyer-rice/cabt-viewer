import { CabtAreaType } from './types';
import { replayEventMoveAreas } from './replayEventAreas';
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

type ActionAnimationPhaseKindConfig = {
  durationMs: number;
  stepMs: number;
  usesSourceView: boolean;
  needsDedicatedView: boolean;
  mayHavePlan: boolean;
};

const actionAnimationPhaseKindConfig = {
  Ability: {
    durationMs: actionAnimationTiming.abilityAnnounceMs,
    stepMs: actionAnimationTiming.abilityAnnounceMs,
    usesSourceView: true,
    needsDedicatedView: true,
    mayHavePlan: true,
  },
  Attack: {
    durationMs: actionAnimationTiming.attackAnnounceMs,
    stepMs: actionAnimationTiming.attackAnnounceMs,
    usesSourceView: true,
    needsDedicatedView: true,
    mayHavePlan: true,
  },
  Attach: {
    durationMs: actionAnimationTiming.handMoveMs,
    stepMs: actionAnimationTiming.handMoveStepMs,
    usesSourceView: true,
    needsDedicatedView: false,
    mayHavePlan: true,
  },
  AttachedMove: {
    durationMs: actionAnimationTiming.handMoveMs,
    stepMs: actionAnimationTiming.handMoveStepMs,
    usesSourceView: true,
    needsDedicatedView: true,
    mayHavePlan: true,
  },
  BoardMove: {
    durationMs: actionAnimationTiming.boardMoveMs,
    stepMs: 0,
    usesSourceView: true,
    needsDedicatedView: true,
    mayHavePlan: true,
  },
  BoardToDeck: {
    durationMs: actionAnimationTiming.boardMoveMs,
    stepMs: actionAnimationTiming.handMoveStepMs,
    usesSourceView: true,
    needsDedicatedView: true,
    mayHavePlan: true,
  },
  Change: {
    durationMs: actionAnimationTiming.conditionAnnounceMs,
    stepMs: actionAnimationTiming.conditionAnnounceMs,
    usesSourceView: true,
    needsDedicatedView: true,
    mayHavePlan: true,
  },
  Coin: {
    durationMs: actionAnimationTiming.coinAnnounceMs,
    stepMs: actionAnimationTiming.coinAnnounceMs,
    usesSourceView: false,
    needsDedicatedView: true,
    mayHavePlan: true,
  },
  Condition: {
    durationMs: actionAnimationTiming.conditionAnnounceMs,
    stepMs: actionAnimationTiming.conditionAnnounceMs,
    usesSourceView: true,
    needsDedicatedView: true,
    mayHavePlan: true,
  },
  Damage: {
    durationMs: actionAnimationTiming.damageVisualMs,
    stepMs: actionAnimationTiming.damageVisualMs,
    usesSourceView: true,
    needsDedicatedView: true,
    mayHavePlan: true,
  },
  DeckBoardPlace: {
    durationMs: actionAnimationTiming.boardMoveMs,
    stepMs: actionAnimationTiming.handMoveStepMs,
    usesSourceView: false,
    needsDedicatedView: false,
    mayHavePlan: true,
  },
  DeckDiscard: {
    durationMs: actionAnimationTiming.deckDiscardMs,
    stepMs: actionAnimationTiming.deckDiscardStepMs,
    usesSourceView: false,
    needsDedicatedView: false,
    mayHavePlan: true,
  },
  DeckPrizePlace: {
    durationMs: actionAnimationTiming.boardMoveMs,
    stepMs: actionAnimationTiming.handMoveStepMs,
    usesSourceView: false,
    needsDedicatedView: false,
    mayHavePlan: true,
  },
  DeckReveal: {
    durationMs: actionAnimationTiming.deckRevealMs,
    stepMs: actionAnimationTiming.deckRevealStepMs,
    usesSourceView: false,
    needsDedicatedView: false,
    mayHavePlan: true,
  },
  DeckRevealReturn: {
    durationMs: actionAnimationTiming.deckRevealReturnMs,
    stepMs: actionAnimationTiming.deckRevealReturnStepMs,
    usesSourceView: false,
    needsDedicatedView: false,
    mayHavePlan: true,
  },
  DeckRevealTake: {
    durationMs: actionAnimationTiming.handMoveMs,
    stepMs: actionAnimationTiming.handMoveStepMs,
    usesSourceView: false,
    needsDedicatedView: false,
    mayHavePlan: true,
  },
  DeckSearchReveal: {
    durationMs: actionAnimationTiming.deckRevealMs,
    stepMs: actionAnimationTiming.deckRevealStepMs,
    usesSourceView: false,
    needsDedicatedView: false,
    mayHavePlan: true,
  },
  Devolve: {
    durationMs: actionAnimationTiming.conditionAnnounceMs,
    stepMs: actionAnimationTiming.conditionAnnounceMs,
    usesSourceView: true,
    needsDedicatedView: true,
    mayHavePlan: true,
  },
  DiscardRecover: {
    durationMs: actionAnimationTiming.handMoveMs,
    stepMs: actionAnimationTiming.handMoveStepMs,
    usesSourceView: true,
    needsDedicatedView: true,
    mayHavePlan: true,
  },
  Draw: {
    durationMs: actionAnimationTiming.deckDrawMs,
    stepMs: actionAnimationTiming.deckDrawStepMs,
    usesSourceView: false,
    needsDedicatedView: false,
    mayHavePlan: true,
  },
  Evolve: {
    durationMs: actionAnimationTiming.evolveMs,
    stepMs: actionAnimationTiming.handMoveStepMs,
    usesSourceView: true,
    needsDedicatedView: true,
    mayHavePlan: true,
  },
  HandMove: {
    durationMs: actionAnimationTiming.handMoveMs,
    stepMs: actionAnimationTiming.handMoveStepMs,
    usesSourceView: true,
    needsDedicatedView: false,
    mayHavePlan: true,
  },
  HandToDeck: {
    durationMs: actionAnimationTiming.handMoveMs,
    stepMs: actionAnimationTiming.handMoveStepMs,
    usesSourceView: true,
    needsDedicatedView: false,
    mayHavePlan: true,
  },
  KnockOut: {
    durationMs: actionAnimationTiming.knockOutMs,
    stepMs: actionAnimationTiming.knockOutMs,
    usesSourceView: true,
    needsDedicatedView: true,
    mayHavePlan: true,
  },
  MoveAttached: {
    durationMs: actionAnimationTiming.conditionAnnounceMs,
    stepMs: actionAnimationTiming.conditionAnnounceMs,
    usesSourceView: true,
    needsDedicatedView: true,
    mayHavePlan: true,
  },
  Play: {
    durationMs: actionAnimationTiming.handMoveMs,
    stepMs: actionAnimationTiming.handMoveStepMs,
    usesSourceView: true,
    needsDedicatedView: false,
    mayHavePlan: true,
  },
  PrizeTake: {
    durationMs: actionAnimationTiming.prizeTakeMs,
    stepMs: actionAnimationTiming.prizeTakeStepMs,
    usesSourceView: true,
    needsDedicatedView: true,
    mayHavePlan: true,
  },
  Shuffle: {
    durationMs: actionAnimationTiming.deckShuffleMs,
    stepMs: actionAnimationTiming.deckShuffleMs,
    usesSourceView: false,
    needsDedicatedView: false,
    mayHavePlan: true,
  },
  StadiumMove: {
    durationMs: actionAnimationTiming.stadiumMoveMs,
    stepMs: actionAnimationTiming.handMoveStepMs,
    usesSourceView: true,
    needsDedicatedView: true,
    mayHavePlan: true,
  },
} satisfies Record<string, ActionAnimationPhaseKindConfig>;

export type ActionAnimationPhaseKind = keyof typeof actionAnimationPhaseKindConfig;

export const actionAnimationPhaseKinds = Object.keys(actionAnimationPhaseKindConfig) as ActionAnimationPhaseKind[];

const actionAnimationPhaseKindSet = new Set<string>(actionAnimationPhaseKinds);

export function actionAnimationPhaseKind(key: string): ActionAnimationPhaseKind | null {
  const separatorIndex = key.indexOf(':');
  if (separatorIndex <= 0) {
    return null;
  }
  const kind = key.slice(0, separatorIndex);
  return actionAnimationPhaseKindSet.has(kind) ? kind as ActionAnimationPhaseKind : null;
}

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
  const kind = actionAnimationPhaseKind(key);
  const previousKinds = previousPhaseKeys.map(actionAnimationPhaseKind);
  if (
    kind === 'Damage'
    && !previousKinds.some((phaseKind) => phaseKind === 'Attack' || phaseKind === 'Condition')
  ) {
    return null;
  }
  if (kind === 'KnockOut' && !previousKinds.includes('Attack')) {
    return null;
  }
  if (kind === 'AttachedMove' && previousKinds.includes('KnockOut')) {
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
  const playerKey = event.playerIndex ?? 'unknown';

  if (event.kind === 'Play' || event.kind === 'Attach' || event.kind === 'Evolve' || event.kind === 'Devolve') {
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
  if (event.kind === 'Change') {
    return `Change:${playerKey}`;
  }
  if (event.kind === 'MoveAttached') {
    return `MoveAttached:${playerKey}`;
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
  const moveAreas = replayEventMoveAreas(event);
  if (moveAreas !== undefined) {
    const { fromArea, toArea } = moveAreas;
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
  return actionAnimationPhaseConfigForKey(key)?.durationMs ?? actionAnimationTiming.handMoveMs;
}

export function actionAnimationPhaseKindDurationMs(kind: ActionAnimationPhaseKind): number {
  return actionAnimationPhaseKindConfig[kind].durationMs;
}

export function actionAnimationPhaseStepMs(key: string): number {
  return actionAnimationPhaseConfigForKey(key)?.stepMs ?? actionAnimationTiming.handMoveStepMs;
}

export function actionAnimationPhaseUsesSourceView(key: string): boolean {
  return actionAnimationPhaseConfigForKey(key)?.usesSourceView ?? false;
}

export function actionAnimationPhaseNeedsDedicatedView(key: string): boolean {
  return actionAnimationPhaseConfigForKey(key)?.needsDedicatedView ?? false;
}

export function actionAnimationPhaseMayHavePlan(key: string): boolean {
  const kind = actionAnimationPhaseKind(key);
  return kind !== null && actionAnimationPhaseKindConfig[kind].mayHavePlan;
}

function actionAnimationPhaseConfigForKey(key: string): typeof actionAnimationPhaseKindConfig[ActionAnimationPhaseKind] | undefined {
  const kind = actionAnimationPhaseKind(key);
  return kind ? actionAnimationPhaseKindConfig[kind] : undefined;
}

export function isSpecialConditionEvent(kind: string | undefined): boolean {
  return kind === 'Poisoned'
    || kind === 'Burned'
    || kind === 'Asleep'
    || kind === 'Paralyzed'
    || kind === 'Confused';
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
