import {
  isAttachedCardArea,
  isBoardPositionMove,
} from './actionAnimationPhases';
import { isMoveCardKind, type ReplayActionGroup } from './replayActionGroups';
import { cabtEvolutionTriggeredDrawSkill, isCabtResolvingTrainerCard } from './replayCardData';
import { eventCardMatches } from './replayCardIdentity';
import { deckRevealContinuationFrom } from './replayDeckRevealContinuations';
import {
  isReplayMoveBetween,
  isReplayMoveFromToAny,
  replayEventMoveAreas,
} from './replayEventAreas';
import { type CabtVisualizeFrame } from './replayInput';
import { CabtAreaType, CabtSelectContext } from './types';
import type { ActionTimelineEvent, GameView } from '../game/types';

export type ReplayFrameEntry = {
  frame: CabtVisualizeFrame;
  view: GameView;
  groups: ReplayActionGroup[];
};

type CardEffectContinuation = {
  endIndex: number;
  group: ReplayActionGroup;
  resolvingPlayEvent?: ActionTimelineEvent;
};

export function cardEffectContinuation(entries: ReplayFrameEntry[], startIndex: number): CardEffectContinuation | null {
  const firstGroup = entries[startIndex].groups[0];
  if (!firstGroup || entries[startIndex].groups.length !== 1) {
    return null;
  }
  const triggeredEvolutionContinuation = triggeredEvolutionAbilityContinuationFrom(entries, startIndex, firstGroup);
  if (triggeredEvolutionContinuation) {
    return triggeredEvolutionContinuation;
  }
  if (!isCardEffectStartGroup(firstGroup)) {
    return null;
  }
  const playEvent = resolvingTrainerPlayEvent(firstGroup);
  const playerIndex = playEvent?.playerIndex;
  if (!playEvent || playerIndex === undefined) {
    return null;
  }

  if (startGroupHasTerminalResolvingEffect(firstGroup)) {
    return null;
  }

  if (isCompleteDeckSearchEffect(firstGroup.events, playerIndex)) {
    return { endIndex: startIndex, group: firstGroup, resolvingPlayEvent: playEvent };
  }

  const deckSearchContinuation = deckSearchContinuationFrom(entries, startIndex, firstGroup, playerIndex);
  if (deckSearchContinuation) {
    return withResolvingPlayEvent(deckSearchContinuation, playEvent);
  }

  const deckRevealContinuation = deckRevealContinuationFrom(entries, startIndex, firstGroup, playerIndex);
  if (deckRevealContinuation) {
    return withResolvingPlayEvent(deckRevealContinuation, playEvent);
  }

  const resolvingContinuation = resolvingTrainerContinuationFrom(entries, startIndex, firstGroup, playEvent);
  if (resolvingContinuation) {
    return withResolvingPlayEvent(
      triggeredEvolutionAbilityContinuationFrom(entries, resolvingContinuation.endIndex, resolvingContinuation.group)
        ?? resolvingContinuation,
      playEvent,
    );
  }

  return null;
}

function withResolvingPlayEvent(continuation: CardEffectContinuation, resolvingPlayEvent: ActionTimelineEvent): CardEffectContinuation {
  return {
    ...continuation,
    resolvingPlayEvent,
  };
}

function triggeredEvolutionAbilityContinuationFrom(
  entries: ReplayFrameEntry[],
  startIndex: number,
  startGroup: ReplayActionGroup,
): CardEffectContinuation | null {
  const evolveEvent = [...startGroup.events].reverse().find(isTriggeredAbilityEvolveEvent);
  if (!evolveEvent || evolveEvent.playerIndex === undefined) {
    return null;
  }
  for (let index = startIndex + 1; index < entries.length; index += 1) {
    const groups = entries[index].groups;
    if (!groups.length) {
      continue;
    }
    if (groups.length !== 1 || !isTriggeredEvolutionAbilityGroup(groups[0], evolveEvent)) {
      return null;
    }
    return {
      endIndex: index,
      group: {
        ...startGroup,
        events: [...startGroup.events, ...groups[0].events],
      },
    };
  }
  return null;
}

function isTriggeredAbilityEvolveEvent(event: ActionTimelineEvent): boolean {
  const params = event.params as Record<string, unknown> | undefined;
  const cardId = Number(params?.cardId);
  return event.kind === 'Evolve'
    && event.playerIndex !== undefined
    && Number.isFinite(cardId)
    && !!cabtEvolutionTriggeredDrawSkill(cardId);
}

function isTriggeredEvolutionAbilityGroup(group: ReplayActionGroup, evolveEvent: ActionTimelineEvent): boolean {
  const ability = group.events[0];
  const abilityParams = ability?.params as Record<string, unknown> | undefined;
  const evolveParams = evolveEvent.params as Record<string, unknown> | undefined;
  const expectedSerial = Number(evolveParams?.serial);
  return ability?.kind === 'Ability'
    && ability.playerIndex === evolveEvent.playerIndex
    && abilityParams?.trigger === 'Evolve'
    && Number(abilityParams?.cardId) === Number(evolveParams?.cardId)
    && (!Number.isFinite(expectedSerial) || Number(abilityParams?.serial) === expectedSerial)
    && group.events.slice(1).length > 0
    && group.events.slice(1).every((event) =>
      (event.kind === 'Draw' || event.kind === 'DrawReverse')
      && event.playerIndex === evolveEvent.playerIndex);
}

function isCardEffectStartGroup(group: ReplayActionGroup): boolean {
  return !!resolvingTrainerPlayEvent(group);
}

export function resolvingTrainerPlayEvent(group: ReplayActionGroup): ActionTimelineEvent | undefined {
  return group.events.find((event) => {
    const params = event.params as Record<string, unknown> | undefined;
    const cardId = Number(params?.cardId);
    return event.kind === 'Play'
      && event.playerIndex !== undefined
      && Number.isFinite(cardId)
      && isCabtResolvingTrainerCard(cardId);
  });
}

function resolvingTrainerContinuationFrom(
  entries: ReplayFrameEntry[],
  startIndex: number,
  startGroup: ReplayActionGroup,
  playEvent: ActionTimelineEvent,
): CardEffectContinuation | null {
  const playerIndex = playEvent.playerIndex;
  if (playerIndex === undefined) {
    return null;
  }

  const continuationEvents: ActionTimelineEvent[] = [];
  for (let index = startIndex + 1; index < entries.length; index += 1) {
    const groups = entries[index].groups;
    if (!groups.length) {
      continue;
    }
    const cardIsDiscardedInView = viewHasEventCardInDiscard(entries[index].view, playEvent);
    if (groups.length !== 1 || !isResolvingTrainerContinuationGroup(groups[0])) {
      return null;
    }

    const nextEvents = [...continuationEvents, ...groups[0].events];
    if (
      groupHasDeckSearchStyleMove(groups[0])
      && !cardIsDiscardedInView
      && !isResolvingTrainerTerminalGroup(groups[0], nextEvents)
    ) {
      return null;
    }

    continuationEvents.push(...groups[0].events);
    if (cardIsDiscardedInView || isResolvingTrainerTerminalGroup(groups[0], continuationEvents)) {
      return {
        endIndex: index,
        group: {
          ...startGroup,
          events: [...startGroup.events, ...continuationEvents],
        },
      };
    }
  }
  return null;
}

export function startGroupHasTerminalResolvingEffect(group: ReplayActionGroup): boolean {
  return group.events.some((event) => event.kind !== 'Play')
    && isResolvingTrainerTerminalGroup(group, group.events);
}

function isResolvingTrainerTerminalGroup(group: ReplayActionGroup, continuationEvents: ActionTimelineEvent[]): boolean {
  if (group.events.some((event) => ['Draw', 'DrawReverse', 'Switch', 'Evolve', 'Devolve', 'MoveAttached', 'Attach'].includes(event.kind ?? ''))) {
    return true;
  }
  if (group.events.some((event) => ['HpChange', 'HPChange', 'Poisoned', 'Burned', 'Asleep', 'Paralyzed', 'Confused', 'Coin'].includes(event.kind ?? ''))) {
    return true;
  }
  if (group.events.some(isTerminalResolvingMoveEvent)) {
    return true;
  }
  if (group.events.some((event) => event.kind === 'Shuffle')) {
    return !continuationEvents.some((event) => isReplayMoveBetween(event, CabtAreaType.HAND, CabtAreaType.DECK));
  }
  return false;
}

function isTerminalResolvingMoveEvent(event: ActionTimelineEvent): boolean {
  const areas = replayEventMoveAreas(event);
  return !!areas && (
    areas.toArea === CabtAreaType.DISCARD
    || isBoardPositionMove(areas.fromArea, areas.toArea)
    || isAttachedCardArea(areas.fromArea)
  );
}

function isResolvingTrainerContinuationGroup(group: ReplayActionGroup): boolean {
  return group.events.length > 0
    && group.events.every(isResolvingTrainerContinuationEvent);
}

function isResolvingTrainerContinuationEvent(event: ActionTimelineEvent): boolean {
  if (isMoveCardKind(event.kind)) {
    return true;
  }
  return [
    'Attach',
    'Evolve',
    'Devolve',
    'MoveAttached',
    'Switch',
    'Draw',
    'DrawReverse',
    'Shuffle',
    'HpChange',
    'HPChange',
    'Poisoned',
    'Burned',
    'Asleep',
    'Paralyzed',
    'Confused',
    'Coin',
  ].includes(event.kind ?? '');
}

function groupHasDeckSearchStyleMove(group: ReplayActionGroup): boolean {
  return group.events.some(isDeckSearchStyleMove);
}

function isDeckSearchStyleMove(event: ActionTimelineEvent): boolean {
  return isReplayMoveFromToAny(event, CabtAreaType.DECK, [
    CabtAreaType.HAND,
    CabtAreaType.ACTIVE,
    CabtAreaType.BENCH,
    CabtAreaType.LOOKING,
  ])
    || isReplayMoveFromToAny(event, CabtAreaType.LOOKING, [
      CabtAreaType.HAND,
      CabtAreaType.DECK,
    ]);
}

export function viewHasEventCardInDiscard(view: GameView, event: ActionTimelineEvent): boolean {
  const playerIndex = event.playerIndex;
  if (playerIndex === undefined) {
    return false;
  }
  return view.players[playerIndex]?.discard.some((card) => eventCardMatches(card, event)) ?? false;
}

function deckSearchContinuationFrom(
  entries: ReplayFrameEntry[],
  startIndex: number,
  startGroup: ReplayActionGroup,
  playerIndex: number,
): CardEffectContinuation | null {
  if (startGroup.events.some((event) => isReplayMoveBetween(event, CabtAreaType.DECK, CabtAreaType.LOOKING))) {
    return null;
  }

  const continuationEvents: ActionTimelineEvent[] = [];
  let sawDeckSearchPrompt = isDeckSearchPrompt(entries[startIndex].frame);
  let sawDeckToHand = false;
  for (let index = startIndex + 1; index < entries.length; index += 1) {
    const groups = entries[index].groups;
    if (!groups.length) {
      sawDeckSearchPrompt ||= isDeckSearchPrompt(entries[index].frame);
      continue;
    }
    if (!sawDeckSearchPrompt) {
      return null;
    }
    if (groups.length !== 1 || !isDeckSearchContinuationGroup(groups[0], playerIndex)) {
      return null;
    }
    if (!deckSearchContinuationOrderIsValid(groups[0].events, sawDeckToHand)) {
      return null;
    }

    continuationEvents.push(...groups[0].events);
    sawDeckToHand ||= groups[0].events.some((event) => isReplayMoveBetween(event, CabtAreaType.DECK, CabtAreaType.HAND));
    const events = [...startGroup.events, ...continuationEvents];
    if (isCompleteDeckSearchEffect(events, playerIndex)) {
      return {
        endIndex: index,
        group: {
          ...startGroup,
          events,
        },
      };
    }
  }
  return null;
}

function deckSearchContinuationOrderIsValid(events: ActionTimelineEvent[], sawDeckToHand: boolean): boolean {
  let hasSeenDeckToHand = sawDeckToHand;
  for (const event of events) {
    if (isReplayMoveBetween(event, CabtAreaType.DECK, CabtAreaType.HAND)) {
      hasSeenDeckToHand = true;
      continue;
    }
    if (event.kind === 'Shuffle' && !hasSeenDeckToHand) {
      return false;
    }
  }
  return true;
}

function isDeckSearchPrompt(frame: CabtVisualizeFrame): boolean {
  const context = frame.select?.context;
  if (context === CabtSelectContext.TO_HAND || context === CabtSelectContext.TO_HAND_ENERGY) {
    return true;
  }
  const normalizedContext = String(context ?? '').toLowerCase().replace(/[_\s-]+/g, '');
  return normalizedContext.includes('searchdeck') || normalizedContext.includes('tohand');
}

function isDeckSearchContinuationGroup(group: ReplayActionGroup, playerIndex: number): boolean {
  return group.events.every((event) =>
    (event.playerIndex === undefined || event.playerIndex === playerIndex)
    && (
      event.kind === 'Shuffle'
      || isReplayMoveBetween(event, CabtAreaType.DECK, CabtAreaType.HAND)
    ));
}

export function isCompleteDeckSearchEffect(events: ActionTimelineEvent[], playerIndex: number): boolean {
  return events.every((event) => event.playerIndex === undefined || event.playerIndex === playerIndex)
    && events.some((event) => event.kind === 'Play')
    && events.some((event) => isReplayMoveBetween(event, CabtAreaType.DECK, CabtAreaType.HAND))
    && events.some((event) => event.kind === 'Shuffle');
}
