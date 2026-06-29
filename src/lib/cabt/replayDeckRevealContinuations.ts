import { isReplayMoveBetween, replayEventSerial } from './replayEventAreas';
import { type ReplayActionGroup } from './replayActionGroups';
import { CabtAreaType } from './types';
import type { ActionTimelineEvent } from '../game/types';

type ReplayContinuationEntry = {
  groups: ReplayActionGroup[];
};

export type DeckRevealContinuation = {
  endIndex: number;
  group: ReplayActionGroup;
};

export function deckRevealContinuationFrom(
  entries: ReplayContinuationEntry[],
  startIndex: number,
  startGroup: ReplayActionGroup,
  playerIndex: number,
): DeckRevealContinuation | null {
  if (!startGroup.events.some((event) => isReplayMoveBetween(event, CabtAreaType.DECK, CabtAreaType.LOOKING))) {
    return null;
  }

  const revealedSerials = new Set(
    startGroup.events
      .filter((event) => isReplayMoveBetween(event, CabtAreaType.DECK, CabtAreaType.LOOKING))
      .map(replayEventSerial)
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
      return {
        endIndex: index,
        group: {
          ...startGroup,
          events: orderedDeckRevealResolutionEvents(startGroup.events, continuationEvents),
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
  const takeEvents = continuationEvents.filter((event) => isReplayMoveBetween(event, CabtAreaType.LOOKING, CabtAreaType.HAND));
  if (!takeEvents.length || !continuationEvents.some((event) => isReplayMoveBetween(event, CabtAreaType.LOOKING, CabtAreaType.DECK))) {
    return [...revealEvents, ...continuationEvents];
  }

  const shuffleEvents = continuationEvents.filter((event) => event.kind === 'Shuffle');
  const beforeTakeEvents = continuationEvents.filter((event) =>
    event.kind !== 'Shuffle' && !isReplayMoveBetween(event, CabtAreaType.LOOKING, CabtAreaType.HAND));
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
        const serial = replayEventSerial(event);
        return serial !== undefined && revealedSerials.has(serial);
      }
      return isReplayMoveBetween(event, CabtAreaType.LOOKING, CabtAreaType.HAND)
        || isReplayMoveBetween(event, CabtAreaType.LOOKING, CabtAreaType.DECK);
    });
}

function isCompleteDeckRevealEffect(events: ActionTimelineEvent[], revealedSerials: ReadonlySet<number>): boolean {
  const resolvedSerials = new Set<number>();
  let returnedToDeck = false;
  let shuffled = false;

  for (const event of events) {
    const serial = replayEventSerial(event);
    if (event.kind === 'Shuffle') {
      shuffled = true;
      continue;
    }
    if (serial === undefined || !revealedSerials.has(serial)) {
      continue;
    }
    if (event.kind === 'Attach'
      || isReplayMoveBetween(event, CabtAreaType.LOOKING, CabtAreaType.HAND)
      || isReplayMoveBetween(event, CabtAreaType.LOOKING, CabtAreaType.DECK)) {
      resolvedSerials.add(serial);
    }
    if (isReplayMoveBetween(event, CabtAreaType.LOOKING, CabtAreaType.DECK)) {
      returnedToDeck = true;
    }
  }

  return resolvedSerials.size === revealedSerials.size && (!returnedToDeck || shuffled);
}
