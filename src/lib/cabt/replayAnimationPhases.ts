import {
  actionAnimationPhaseDurationMs,
  actionAnimationPhaseKey,
  actionAnimationPhaseKind,
  actionAnimationPhaseMayHavePlan,
  actionAnimationPhaseNeedsDedicatedView,
  actionAnimationPhaseUsesSourceView,
  actionAnimationTimelinePhaseKey,
  type ActionAnimationPhaseKind,
} from './actionAnimationPhases';
import { assertUnhandledActionAnimationPhaseKind } from './replayAnimationExhaustive';
import type { ActionTimelineEvent } from '../game/types';

export type AnimationEventPhase = {
  key: string;
  kind: ActionAnimationPhaseKind;
  playerIndex?: number;
  events: ActionTimelineEvent[];
  durationMs: number;
  usesSourceView: boolean;
};

export function animationEventPhases(events: ActionTimelineEvent[]): AnimationEventPhase[] {
  const phases: AnimationEventPhase[] = [];
  for (const event of events) {
    const key = animationPhaseKeyForReplayEvent(event, phases);
    if (!key) {
      const last = phases.at(-1);
      if (last) {
        last.events.push(event);
      }
      continue;
    }
    const kind = actionAnimationPhaseKind(key);
    if (!kind) {
      continue;
    }
    const last = phases.at(-1);
    if (last && last.key === key) {
      last.events.push(event);
      last.durationMs = actionAnimationPhaseDurationMs(key, last.events.length);
      continue;
    }
    phases.push({
      key,
      kind,
      playerIndex: event.playerIndex,
      events: [event],
      durationMs: actionAnimationPhaseDurationMs(key, 1),
      usesSourceView: actionAnimationPhaseUsesSourceView(key),
    });
  }
  return phases.filter((phase) => phase.events.some((event) => actionAnimationPhaseKey(event)));
}

export function animationPhaseLabel(phase: AnimationEventPhase): string | undefined {
  const event = phase.events.find((candidate) => actionAnimationPhaseKey(candidate));
  if (!event) {
    return undefined;
  }
  const actor = playerLabel(event.playerIndex);
  const cardEventCount = phase.events.filter((candidate) => actionAnimationPhaseKey(candidate) === phase.key).length;

  switch (phase.kind) {
    case 'Ability':
    case 'Play':
    case 'Attach':
    case 'Evolve':
    case 'Shuffle':
    case 'Attack':
    case 'AttachedMove':
    case 'BoardMove':
    case 'BoardToDeck':
    case 'Coin':
    case 'Condition':
    case 'Damage':
    case 'Change':
    case 'Devolve':
    case 'DiscardRecover':
    case 'HandMove':
    case 'KnockOut':
    case 'MoveAttached':
    case 'PrizeTake':
    case 'StadiumMove':
      return event.message;
    case 'HandToDeck':
      return `${actor} put ${cardEventCount} ${plural(cardEventCount, 'card')} from hand into their deck.`;
    case 'Draw':
      return cardEventCount === 1 ? event.message : `${actor} drew ${cardEventCount} cards.`;
    case 'DeckDiscard':
      return cardEventCount === 1 ? event.message : `${actor} discarded ${cardEventCount} cards from the deck.`;
    case 'DeckRevealReturn':
      return `${actor} returned ${cardEventCount} revealed ${plural(cardEventCount, 'card')} to their deck.`;
    case 'DeckRevealTake':
      return cardEventCount === 1
        ? `${actor} put a revealed card into their hand.`
        : `${actor} put ${cardEventCount} revealed cards into their hand.`;
    case 'DeckSearchReveal':
      return cardEventCount === 1
        ? `${actor} revealed a card from their deck and put it into their hand.`
        : `${actor} revealed ${cardEventCount} cards from their deck and put them into their hand.`;
    case 'DeckBoardPlace':
      return cardEventCount === 1
        ? event.message
        : `${actor} put ${cardEventCount} Pokemon from their deck onto the board.`;
    case 'DeckPrizePlace':
      return cardEventCount === 1
        ? event.message
        : `${actor} set ${cardEventCount} Prize cards.`;
    case 'DeckReveal':
      return `${actor} revealed the top ${cardEventCount} ${plural(cardEventCount, 'card')} of their deck.`;
  }
  return assertUnhandledActionAnimationPhaseKind(phase.kind);
}

export function animationPhaseNeedsDedicatedView(phase: AnimationEventPhase): boolean {
  return actionAnimationPhaseNeedsDedicatedView(phase.key);
}

export function animationPhaseMayHavePlan(phase: AnimationEventPhase): boolean {
  return actionAnimationPhaseMayHavePlan(phase.key);
}

function animationPhaseKeyForReplayEvent(event: ActionTimelineEvent, phases: AnimationEventPhase[]): string | null {
  return actionAnimationTimelinePhaseKey(event, phases.map((phase) => phase.key));
}

export function playerLabel(playerIndex: number | undefined): string {
  return playerIndex === undefined ? 'Game' : `Player ${playerIndex + 1}`;
}

export function plural(count: number, singular: string): string {
  return count === 1 ? singular : `${singular}s`;
}
