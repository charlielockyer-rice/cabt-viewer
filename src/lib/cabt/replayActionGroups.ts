import {
  actionAnimationPhaseKey,
  isBoardPositionMove,
} from './actionAnimationPhases';
import { cabtCardName } from './replayCardData';
import {
  animationEventPhases,
  playerLabel,
  plural,
} from './replayAnimationPhases';
import {
  isMoveCardKind,
  isReplayMoveBetween,
  replayEventMoveAreas,
} from './replayEventAreas';
import { CabtAreaType } from './types';
import type { ActionTimelineEvent } from '../game/types';

export type ReplayActionGroup = {
  label: string;
  type: string;
  events: ActionTimelineEvent[];
  turn: number;
};

export { isMoveCardKind } from './replayEventAreas';

export function replayActionGroups(events: ActionTimelineEvent[], turn: number): ReplayActionGroup[] {
  const groups: ReplayActionGroup[] = [];
  let current: ReplayActionGroup | null = null;

  for (const event of events) {
    if (!current || startsReplayGroup(event, current)) {
      current = groupForEvent(event, current, turn);
      groups.push(current);
      continue;
    }
    current.events.push(event);
    current.label = labelForGroup(current);
  }

  return groups;
}

export function persistentActionLabel(label: string, events: ActionTimelineEvent[] | undefined): string {
  if (!events || events.length < 2) {
    return label;
  }
  const playEvent = events.find((event) => event.kind === 'Play');
  if (!playEvent) {
    return label;
  }
  const phases = animationEventPhases(events);
  const hasEffectPhase = phases.some((phase) =>
    phase.kind === 'HandToDeck'
    || phase.kind === 'DeckDiscard'
    || phase.kind === 'DeckReveal'
    || phase.kind === 'DeckSearchReveal'
    || phase.kind === 'DeckBoardPlace'
    || phase.kind === 'DeckRevealReturn'
    || phase.kind === 'DeckRevealTake'
    || phase.kind === 'Draw',
  );
  if (!hasEffectPhase) {
    return label;
  }

  const playerIndex = playEvent.playerIndex;
  const actor = playerLabel(playerIndex);
  const playedCard = eventCardName(playEvent);
  const clauses = [`played ${playedCard}`];
  let handToDeckWasSummarized = false;

  for (const phase of phases) {
    if (phase.kind === 'Play') {
      continue;
    }
    const count = phase.events.filter((event) => actionAnimationPhaseKey(event) === phase.key).length;
    if (phase.kind === 'HandToDeck') {
      clauses.push(`shuffled ${count} ${plural(count, 'card')} from hand into their deck`);
      handToDeckWasSummarized = true;
      continue;
    }
    if (phase.kind === 'Draw') {
      clauses.push(`drew ${count} ${plural(count, 'card')}`);
      continue;
    }
    if (phase.kind === 'DeckSearchReveal') {
      clauses.push(count === 1
        ? 'revealed a card from their deck and put it into their hand'
        : `revealed ${count} cards from their deck and put them into their hand`);
      continue;
    }
    if (phase.kind === 'DeckBoardPlace') {
      clauses.push(count === 1
        ? 'put a Pokemon from their deck onto the board'
        : `put ${count} Pokemon from their deck onto the board`);
      continue;
    }
    if (phase.kind === 'DeckRevealReturn') {
      clauses.push(`returned ${count} revealed ${plural(count, 'card')} to their deck`);
      continue;
    }
    if (phase.kind === 'DeckRevealTake') {
      clauses.push(count === 1
        ? 'put a revealed card into their hand'
        : `put ${count} revealed cards into their hand`);
      continue;
    }
    if (phase.kind === 'DeckReveal') {
      clauses.push(`revealed the top ${count} ${plural(count, 'card')} of their deck`);
      continue;
    }
    if (phase.kind === 'DeckDiscard') {
      clauses.push(`discarded ${count} ${plural(count, 'card')} from their deck`);
      continue;
    }
    if (phase.kind === 'Attach') {
      clauses.push(...phase.events
        .filter((event) => actionAnimationPhaseKey(event) === phase.key)
        .map((event) => eventMessageWithoutActor(event, actor)));
      continue;
    }
    if (phase.kind === 'Shuffle' && !handToDeckWasSummarized) {
      clauses.push('shuffled their deck');
    }
  }

  return `${actor} ${joinClauses(clauses)}.`;
}

function startsReplayGroup(event: ActionTimelineEvent, current: ReplayActionGroup): boolean {
  const kind = event.kind ?? 'Event';
  if (isChoiceOrPhaseKind(kind)) {
    return true;
  }
  if (isCheckupKind(kind) && current.type === 'TurnEnd') {
    return true;
  }
  if (kind === 'Draw') {
    return current.type !== 'TurnStart'
      && current.type !== 'Draw'
      && !isChoiceConsequenceGroup(current.type);
  }
  if (isMoveCardKind(kind)) {
    return isMoveCardKind(current.type)
      && !sameMoveCardBatch(current.events.at(-1), event)
      && !sameBoardPositionMoveBatch(current.events.at(-1), event);
  }
  if (kind === 'HasBasicPokemon') {
    return current.type !== 'Draw' && current.type !== 'HasBasicPokemon';
  }
  return false;
}

function groupForEvent(event: ActionTimelineEvent, previous: ReplayActionGroup | null, turn: number): ReplayActionGroup {
  const type = isCheckupKind(event.kind) && previous?.type === 'TurnEnd' ? 'PokemonCheckup' : (event.kind ?? 'Event');
  const group = {
    label: event.message,
    type,
    events: [event],
    turn,
  };
  group.label = labelForGroup(group);
  return group;
}

function labelForGroup(group: ReplayActionGroup): string {
  if (group.type === 'PokemonCheckup') {
    return 'Pokemon Checkup.';
  }
  if (group.type === 'Draw') {
    return drawGroupLabel(group.events);
  }
  if (isMoveCardKind(group.type)) {
    return moveCardGroupLabel(group.events, group.turn);
  }
  return group.events[0]?.message ?? 'Event';
}

function isChoiceOrPhaseKind(kind: string): boolean {
  return [
    'Play',
    'Attach',
    'Evolve',
    'Devolve',
    'MoveAttached',
    'Ability',
    'Attack',
    'TurnEnd',
    'TurnStart',
    'Result',
  ].includes(kind);
}

function isChoiceConsequenceGroup(type: string): boolean {
  return ['Play', 'Attach', 'Evolve', 'Devolve', 'MoveAttached', 'Ability', 'Attack'].includes(type);
}

function isCheckupKind(kind: string | undefined): boolean {
  return [
    'HPChange',
    'HpChange',
    'Poisoned',
    'Burned',
    'Asleep',
    'Paralyzed',
    'Confused',
    'Coin',
  ].includes(kind ?? '');
}

function sameMoveCardBatch(previous: ActionTimelineEvent | undefined, next: ActionTimelineEvent): boolean {
  const previousAreas = previous ? replayEventMoveAreas(previous) : undefined;
  const nextAreas = replayEventMoveAreas(next);
  return previous?.playerIndex === next.playerIndex
    && previousAreas !== undefined
    && nextAreas !== undefined
    && previousAreas.fromArea === nextAreas.fromArea
    && previousAreas.toArea === nextAreas.toArea
    && isBatchedMoveDestination(nextAreas.fromArea, nextAreas.toArea);
}

function isBatchedMoveDestination(fromArea: number, toArea: number): boolean {
  if (toArea === CabtAreaType.ACTIVE || toArea === CabtAreaType.BENCH) {
    return fromArea === CabtAreaType.DECK;
  }
  return !isBoardPositionMove(fromArea, toArea);
}

function sameBoardPositionMoveBatch(previous: ActionTimelineEvent | undefined, next: ActionTimelineEvent): boolean {
  return previous?.playerIndex === next.playerIndex
    && isBoardPositionMoveEvent(previous)
    && isBoardPositionMoveEvent(next);
}

function isBoardPositionMoveEvent(event: ActionTimelineEvent | undefined): boolean {
  const areas = event ? replayEventMoveAreas(event) : undefined;
  return !!areas && isBoardPositionMove(areas.fromArea, areas.toArea);
}

function drawGroupLabel(events: ActionTimelineEvent[]): string {
  const drawEvents = events.filter((event) => event.kind === 'Draw');
  if (drawEvents.length === 0) {
    return events[0]?.message ?? 'Draw.';
  }
  if (drawEvents.length === 1 && events.length === 1) {
    return events[0].message;
  }

  const playerIndex = drawEvents[0].playerIndex;
  const samePlayer = drawEvents.every((event) => event.playerIndex === playerIndex);
  if (isMulliganRedrawGroup(events)) {
    if (!samePlayer || playerIndex === undefined) {
      return 'Players redrew opening hands.';
    }
    return `Player ${playerIndex + 1} redrew their opening hand.`;
  }
  if (isOpeningHandGroup(events)) {
    if (!samePlayer || playerIndex === undefined) {
      return 'Players drew opening hands.';
    }
    return `Player ${playerIndex + 1} drew an opening hand.`;
  }
  if (!samePlayer || playerIndex === undefined) {
    return `Players drew ${drawEvents.length} cards.`;
  }
  return `Player ${playerIndex + 1} drew ${drawEvents.length} cards.`;
}

function isOpeningHandGroup(events: ActionTimelineEvent[]): boolean {
  return events.some((event) => event.kind === 'HasBasicPokemon');
}

function isMulliganRedrawGroup(events: ActionTimelineEvent[]): boolean {
  return events.some((event) => event.kind === 'HasBasicPokemon' && (event.params as Record<string, unknown> | undefined)?.hasBasicPokemon === false)
    && events.some((event) => event.kind === 'Shuffle')
    && events.some((event) => {
      return event.kind === 'MoveCard'
        && isReplayMoveBetween(event, CabtAreaType.HAND, CabtAreaType.DECK);
    });
}

function moveCardGroupLabel(events: ActionTimelineEvent[], turn: number): string {
  if (events.length === 1) {
    return events[0].message;
  }
  const moveEvents = events.filter((event) => isMoveCardKind(event.kind));
  const firstMove = moveEvents[0];
  const playerIndex = moveEvents[0]?.playerIndex;
  const samePlayer = moveEvents.every((event) => event.playerIndex === playerIndex);
  const allSameMove = moveEvents.every((event) => sameMoveCardBatch(moveEvents[0], event));
  if (
    samePlayer
    && playerIndex !== undefined
    && allSameMove
    && firstMove !== undefined
    && isReplayMoveBetween(firstMove, CabtAreaType.DECK, CabtAreaType.PRIZE)
  ) {
    if (turn === 0) {
      return `Player ${playerIndex + 1} set ${moveEvents.length} Prize cards.`;
    }
    return `Player ${playerIndex + 1} put ${moveEvents.length} cards from deck into their Prize cards.`;
  }
  if (
    samePlayer
    && playerIndex !== undefined
    && allSameMove
    && firstMove !== undefined
    && isReplayMoveBetween(firstMove, CabtAreaType.HAND, CabtAreaType.DECK)
    && events.some((event) => event.kind === 'Shuffle')
  ) {
    if (turn === 0) {
      return `Player ${playerIndex + 1} shuffled their opening hand into their deck.`;
    }
    return `Player ${playerIndex + 1} shuffled ${moveEvents.length} cards from hand into their deck.`;
  }
  if (
    samePlayer
    && playerIndex !== undefined
    && allSameMove
    && firstMove !== undefined
    && isReplayMoveBetween(firstMove, CabtAreaType.PRIZE, CabtAreaType.HAND)
  ) {
    return `Player ${playerIndex + 1} took ${moveEvents.length} Prize cards.`;
  }
  return events[0].message;
}

function eventCardName(event: ActionTimelineEvent): string {
  const params = event.params as Record<string, unknown> | undefined;
  return cabtCardName(Number(params?.cardId));
}

function eventMessageWithoutActor(event: ActionTimelineEvent, actor: string): string {
  const text = event.message.replace(/\.$/, '');
  const withoutActor = text.startsWith(`${actor} `) ? text.slice(actor.length + 1) : text;
  return withoutActor.charAt(0).toLowerCase() + withoutActor.slice(1);
}

function joinClauses(clauses: string[]): string {
  if (clauses.length <= 1) {
    return clauses[0] ?? '';
  }
  if (clauses.length === 2) {
    return `${clauses[0]} and ${clauses[1]}`;
  }
  return `${clauses.slice(0, -1).join(', ')}, and ${clauses.at(-1)}`;
}
