import {
  isAttachedCardArea,
  isBoardPositionMove,
} from './actionAnimationPhases';
import { isMoveCardKind, type ReplayActionGroup } from './replayActionGroups';
import { cabtEvolutionTriggeredDrawSkill, isCabtResolvingTrainerCard } from './replayCardData';
import { eventCardMatches } from './replayCardIdentity';
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

  for (let index = startIndex + 1; index < entries.length; index += 1) {
    const groups = entries[index].groups;
    if (!groups.length) {
      continue;
    }
    if (groups.length === 1 && isCardEffectContinuationGroup(groups[0], playerIndex, firstGroup)) {
      return {
        endIndex: index,
        resolvingPlayEvent: playEvent,
        group: {
          ...firstGroup,
          events: [...firstGroup.events, ...groups[0].events],
        },
      };
    }
    return null;
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
    return !continuationEvents.some((event) => isMoveBetween(event, CabtAreaType.HAND, CabtAreaType.DECK));
  }
  return false;
}

function isTerminalResolvingMoveEvent(event: ActionTimelineEvent): boolean {
  const params = event.params as Record<string, unknown> | undefined;
  const fromArea = Number(params?.fromArea);
  const toArea = Number(params?.toArea);
  return isMoveCardKind(event.kind)
    && (
      toArea === CabtAreaType.DISCARD
      || isBoardPositionMove(fromArea, toArea)
      || isAttachedCardArea(fromArea)
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
  if (!isMoveCardKind(event.kind)) {
    return false;
  }
  const params = event.params as Record<string, unknown> | undefined;
  const fromArea = Number(params?.fromArea);
  const toArea = Number(params?.toArea);
  return (fromArea === CabtAreaType.DECK && (
    toArea === CabtAreaType.HAND
    || toArea === CabtAreaType.ACTIVE
    || toArea === CabtAreaType.BENCH
    || toArea === CabtAreaType.LOOKING
  ))
    || (fromArea === CabtAreaType.LOOKING && (
      toArea === CabtAreaType.HAND
      || toArea === CabtAreaType.DECK
    ));
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
  if (startGroup.events.some((event) => isMoveBetween(event, CabtAreaType.DECK, CabtAreaType.LOOKING))) {
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
    sawDeckToHand ||= groups[0].events.some((event) => isMoveBetween(event, CabtAreaType.DECK, CabtAreaType.HAND));
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

function deckRevealContinuationFrom(
  entries: ReplayFrameEntry[],
  startIndex: number,
  startGroup: ReplayActionGroup,
  playerIndex: number,
): CardEffectContinuation | null {
  if (!startGroup.events.some((event) => isMoveBetween(event, CabtAreaType.DECK, CabtAreaType.LOOKING))) {
    return null;
  }

  const revealedSerials = new Set(
    startGroup.events
      .filter((event) => isMoveBetween(event, CabtAreaType.DECK, CabtAreaType.LOOKING))
      .map(eventSerial)
      .filter((serial): serial is number => Number.isFinite(serial)),
  );
  if (!revealedSerials.size) {
    return null;
  }

  const continuationEvents: ActionTimelineEvent[] = [];
  for (let index = startIndex + 1; index < entries.length; index += 1) {
    const groups = entries[index].groups;
    if (!groups.length) {
      continue;
    }
    if (!groups.every((group) => isDeckRevealContinuationGroup(group, playerIndex, revealedSerials))) {
      return null;
    }

    continuationEvents.push(...groups.flatMap((group) => group.events));
    const events = [...startGroup.events, ...continuationEvents];
    if (isCompleteDeckRevealEffect(events, revealedSerials)) {
      const orderedEvents = orderedDeckRevealResolutionEvents(startGroup.events, continuationEvents);
      return {
        endIndex: index,
        group: {
          ...startGroup,
          events: orderedEvents,
        },
      };
    }
  }
  return null;
}

function orderedDeckRevealResolutionEvents(
  revealEvents: ActionTimelineEvent[],
  continuationEvents: ActionTimelineEvent[],
): ActionTimelineEvent[] {
  const takeEvents = continuationEvents.filter((event) => isMoveBetween(event, CabtAreaType.LOOKING, CabtAreaType.HAND));
  if (!takeEvents.length || !continuationEvents.some((event) => isMoveBetween(event, CabtAreaType.LOOKING, CabtAreaType.DECK))) {
    return [...revealEvents, ...continuationEvents];
  }

  const shuffleEvents = continuationEvents.filter((event) => event.kind === 'Shuffle');
  const beforeTakeEvents = continuationEvents.filter((event) =>
    event.kind !== 'Shuffle' && !isMoveBetween(event, CabtAreaType.LOOKING, CabtAreaType.HAND));
  return [...revealEvents, ...beforeTakeEvents, ...takeEvents, ...shuffleEvents];
}

function isDeckRevealContinuationGroup(
  group: ReplayActionGroup,
  playerIndex: number,
  revealedSerials: ReadonlySet<number>,
): boolean {
  return group.events.length > 0
    && group.events.every((event) => {
      if (event.playerIndex !== undefined && event.playerIndex !== playerIndex) {
        return false;
      }
      if (event.kind === 'Shuffle') {
        return true;
      }
      if (event.kind === 'Attach') {
        const serial = eventSerial(event);
        return serial !== undefined && revealedSerials.has(serial);
      }
      return isMoveBetween(event, CabtAreaType.LOOKING, CabtAreaType.HAND)
        || isMoveBetween(event, CabtAreaType.LOOKING, CabtAreaType.DECK);
    });
}

function isCompleteDeckRevealEffect(events: ActionTimelineEvent[], revealedSerials: ReadonlySet<number>): boolean {
  const resolvedSerials = new Set<number>();
  let returnedToDeck = false;
  let shuffled = false;

  for (const event of events) {
    const serial = eventSerial(event);
    if (event.kind === 'Shuffle') {
      shuffled = true;
      continue;
    }
    if (serial === undefined || !revealedSerials.has(serial)) {
      continue;
    }
    if (event.kind === 'Attach'
      || isMoveBetween(event, CabtAreaType.LOOKING, CabtAreaType.HAND)
      || isMoveBetween(event, CabtAreaType.LOOKING, CabtAreaType.DECK)) {
      resolvedSerials.add(serial);
    }
    if (isMoveBetween(event, CabtAreaType.LOOKING, CabtAreaType.DECK)) {
      returnedToDeck = true;
    }
  }

  return resolvedSerials.size === revealedSerials.size && (!returnedToDeck || shuffled);
}

function eventSerial(event: ActionTimelineEvent): number | undefined {
  const params = event.params as Record<string, unknown> | undefined;
  const serial = Number(params?.serial);
  return Number.isFinite(serial) ? serial : undefined;
}

function deckSearchContinuationOrderIsValid(events: ActionTimelineEvent[], sawDeckToHand: boolean): boolean {
  let hasSeenDeckToHand = sawDeckToHand;
  for (const event of events) {
    if (isMoveBetween(event, CabtAreaType.DECK, CabtAreaType.HAND)) {
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
      || isMoveBetween(event, CabtAreaType.DECK, CabtAreaType.HAND)
    ));
}

export function isCompleteDeckSearchEffect(events: ActionTimelineEvent[], playerIndex: number): boolean {
  return events.every((event) => event.playerIndex === undefined || event.playerIndex === playerIndex)
    && events.some((event) => event.kind === 'Play')
    && events.some((event) => isMoveBetween(event, CabtAreaType.DECK, CabtAreaType.HAND))
    && events.some((event) => event.kind === 'Shuffle');
}

function isCardEffectContinuationGroup(
  group: ReplayActionGroup,
  playerIndex: number,
  startGroup: ReplayActionGroup,
): boolean {
  if (startGroup.events.some((event) => isMoveBetween(event, CabtAreaType.DECK, CabtAreaType.LOOKING))) {
    return isDeckRevealResolutionGroup(group, playerIndex);
  }
  return false;
}

function isDeckRevealResolutionGroup(group: ReplayActionGroup, playerIndex: number): boolean {
  return group.events.every((event) => event.playerIndex === undefined || event.playerIndex === playerIndex)
    && group.events.some((event) => event.kind === 'Attach')
    && group.events.some((event) => isMoveBetween(event, CabtAreaType.LOOKING, CabtAreaType.DECK))
    && group.events.some((event) => event.kind === 'Shuffle');
}

function isMoveBetween(event: ActionTimelineEvent, fromArea: number, toArea: number): boolean {
  const params = event.params as Record<string, unknown> | undefined;
  return isMoveCardKind(event.kind)
    && Number(params?.fromArea) === fromArea
    && Number(params?.toArea) === toArea;
}
