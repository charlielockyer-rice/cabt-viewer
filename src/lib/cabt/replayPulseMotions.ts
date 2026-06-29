import { actionAnimationTiming, isSpecialConditionEvent } from './actionAnimationPhases';
import { actionAnimationStartMs } from './actionAnimationSchedule';
import {
  boardSlotAnchorForEvent,
  boardSlotAnchorForPokemon,
} from './replayAnimationAnchors';
import { compactAnimationMotions } from './replayAnimationMotionUtils';
import { cabtCardName } from './replayCardData';
import { finiteNumber, stringValue } from './replayEventParams';
import { CabtAreaType } from './types';
import type { AnimationEventPhase } from './replayAnimationPhases';
import type { AnimationAnchorRef, AnimationIdentity, AnimationMotion } from '../animations/replayAnimationPlan';
import type { ActionTimelineEvent, GameView } from '../game/types';

export function abilityPulseMotions(phase: AnimationEventPhase, view: GameView): AnimationMotion[] {
  const motions = phase.events.map((event) => {
    if (event.kind !== 'Ability') {
      return [];
    }
    const anchor = abilityAnchorForEvent(view, event);
    if (!anchor) {
      return null;
    }
    return [{
      kind: 'pulse',
      id: `${phase.key}:${event.id}:ability`,
      anchor,
      coordinateSpace: 'board',
      spriteVisual: { kind: 'pulse', tone: 'ability' },
      label: abilityNameForEvent(event),
      startMs: actionAnimationStartMs(phase.events, event),
      durationMs: actionAnimationTiming.abilityAnnounceMs,
    } satisfies AnimationMotion];
  });
  return compactAnimationMotions(motions);
}

export function attackPulseMotions(phase: AnimationEventPhase, view: GameView): AnimationMotion[] {
  const motions = phase.events.map((event) => {
    if (event.kind !== 'Attack') {
      return [];
    }
    const anchor = event.playerIndex === undefined
      ? undefined
      : boardSlotAnchorForEvent(view.players[event.playerIndex], event);
    if (!anchor) {
      return null;
    }
    return [{
      kind: 'pulse',
      id: `${phase.key}:${event.id}:attack`,
      identity: animationIdentityForEvent(event, 'pokemon'),
      anchor,
      coordinateSpace: 'board',
      spriteVisual: { kind: 'pulse', tone: 'attack' },
      label: attackNameForEvent(event),
      startMs: actionAnimationStartMs(phase.events, event),
      durationMs: actionAnimationTiming.attackAnnounceMs,
    } satisfies AnimationMotion];
  });
  return compactAnimationMotions(motions);
}

export function damagePulseMotions(
  phase: AnimationEventPhase,
  view: GameView,
  stepEvents: ActionTimelineEvent[],
): AnimationMotion[] {
  const attackEvent = stepEvents.find((event) => event.kind === 'Attack');
  const attackAnchor = attackEvent?.playerIndex === undefined
    ? undefined
    : boardSlotAnchorForEvent(view.players[attackEvent.playerIndex], attackEvent);
  const motions = phase.events.map((event) => {
    if (event.kind !== 'HpChange' && event.kind !== 'HPChange') {
      return [];
    }
    const anchor = event.playerIndex === undefined
      ? undefined
      : boardSlotAnchorForEvent(view.players[event.playerIndex], event);
    if (!anchor) {
      return null;
    }
    return [{
      kind: 'pulse',
      id: `${phase.key}:${event.id}:damage`,
      identity: animationIdentityForEvent(event, 'pokemon'),
      anchor,
      sourceAnchor: attackAnchor,
      coordinateSpace: 'board',
      spriteVisual: { kind: 'pulse', tone: 'damage' },
      value: damageValueForEvent(event),
      startMs: actionAnimationStartMs(phase.events, event),
      durationMs: actionAnimationTiming.damageVisualMs,
    } satisfies AnimationMotion];
  });
  return compactAnimationMotions(motions);
}

export function coinPulseMotions(phase: AnimationEventPhase): AnimationMotion[] {
  const motions = phase.events.map((event) => {
    if (event.kind !== 'Coin' || event.playerIndex === undefined) {
      return [];
    }
    return [{
      kind: 'pulse',
      id: `${phase.key}:${event.id}:coin`,
      anchor: { kind: 'deck-top', playerIndex: event.playerIndex },
      coordinateSpace: 'board',
      spriteVisual: { kind: 'pulse', tone: 'neutral' },
      label: coinResultLabel(event),
      startMs: actionAnimationStartMs(phase.events, event),
      durationMs: actionAnimationTiming.coinAnnounceMs,
    } satisfies AnimationMotion];
  });
  return compactAnimationMotions(motions);
}

export function changePulseMotions(phase: AnimationEventPhase, view: GameView): AnimationMotion[] {
  const motions = phase.events.map((event) => {
    if (event.kind !== 'Change' || event.playerIndex === undefined) {
      return [];
    }
    const anchor = changeAnchorForEvent(view, event);
    if (!anchor) {
      return null;
    }
    return [{
      kind: 'pulse',
      id: `${phase.key}:${event.id}:change`,
      identity: changeAnimationIdentityForEvent(event),
      anchor,
      coordinateSpace: 'board',
      spriteVisual: { kind: 'pulse', tone: 'neutral' },
      label: changePulseLabel(event),
      startMs: actionAnimationStartMs(phase.events, event),
      durationMs: actionAnimationTiming.conditionAnnounceMs,
    } satisfies AnimationMotion];
  });
  return compactAnimationMotions(motions);
}

export function boardMutationPulseMotions(phase: AnimationEventPhase, view: GameView): AnimationMotion[] {
  const motions = phase.events.map((event) => {
    if ((event.kind !== 'Devolve' && event.kind !== 'MoveAttached') || event.playerIndex === undefined) {
      return [];
    }
    const anchor = boardMutationAnchorForEvent(view, event);
    if (!anchor) {
      return null;
    }
    return [{
      kind: 'pulse',
      id: `${phase.key}:${event.id}:${event.kind}`,
      identity: boardMutationAnimationIdentityForEvent(event),
      anchor,
      coordinateSpace: 'board',
      spriteVisual: { kind: 'pulse', tone: 'neutral' },
      label: boardMutationPulseLabel(event),
      startMs: actionAnimationStartMs(phase.events, event),
      durationMs: actionAnimationTiming.conditionAnnounceMs,
    } satisfies AnimationMotion];
  });
  return compactAnimationMotions(motions);
}

export function conditionPulseMotions(phase: AnimationEventPhase, view: GameView): AnimationMotion[] {
  const motions = phase.events.map((event) => {
    if (!isSpecialConditionEvent(event.kind) || event.playerIndex === undefined) {
      return [];
    }
    const anchor = conditionAnchorForEvent(view, event);
    if (!anchor) {
      return null;
    }
    return [{
      kind: 'pulse',
      id: `${phase.key}:${event.id}:condition`,
      identity: animationIdentityForEvent(event, 'pokemon'),
      anchor,
      coordinateSpace: 'board',
      spriteVisual: { kind: 'pulse', tone: 'neutral' },
      label: conditionPulseLabel(event),
      startMs: actionAnimationStartMs(phase.events, event),
      durationMs: actionAnimationTiming.conditionAnnounceMs,
    } satisfies AnimationMotion];
  });
  return compactAnimationMotions(motions);
}

export function shuffleMotions(phase: AnimationEventPhase): AnimationMotion[] {
  return phase.events.flatMap((event) => {
    if (event.kind !== 'Shuffle' || event.playerIndex === undefined) {
      return [];
    }
    return [{
      kind: 'shuffle',
      id: `${phase.key}:${event.id}:shuffle`,
      anchor: { kind: 'deck-top', playerIndex: event.playerIndex },
      coordinateSpace: 'board',
      startMs: actionAnimationStartMs(phase.events, event),
      durationMs: actionAnimationTiming.deckShuffleMs,
    }];
  });
}

function abilityAnchorForEvent(view: GameView, event: ActionTimelineEvent): AnimationAnchorRef | undefined {
  if (event.playerIndex === undefined) {
    return undefined;
  }
  const player = view.players[event.playerIndex];
  if (!player) {
    return undefined;
  }
  const params = event.params as Record<string, unknown> | undefined;
  const area = finiteNumber(params?.area);
  const index = finiteNumber(params?.index);
  if (area === CabtAreaType.ACTIVE) {
    return {
      kind: 'board-slot',
      playerIndex: event.playerIndex,
      slot: 'active',
      slotIndex: player.active.index,
    };
  }
  if (area === CabtAreaType.BENCH && index !== undefined) {
    const benchSlot = player.bench.find((slot) => slot.index === index);
    if (benchSlot) {
      return {
        kind: 'board-slot',
        playerIndex: event.playerIndex,
        slot: 'bench',
        slotIndex: benchSlot.index,
      };
    }
  }
  return boardSlotAnchorForEvent(player, event);
}

function changeAnchorForEvent(view: GameView, event: ActionTimelineEvent): AnimationAnchorRef | undefined {
  if (event.playerIndex === undefined) {
    return undefined;
  }
  const params = event.params as Record<string, unknown> | undefined;
  const player = view.players[event.playerIndex];
  return boardSlotAnchorForPokemon(
    player,
    finiteNumber(params?.serial) ?? finiteNumber(params?.serialBefore) ?? finiteNumber(params?.serialAfter),
    finiteNumber(params?.cardIdBefore) ?? finiteNumber(params?.cardId) ?? finiteNumber(params?.cardIdAfter),
  );
}

function changeAnimationIdentityForEvent(event: ActionTimelineEvent): AnimationIdentity {
  const params = event.params as Record<string, unknown> | undefined;
  return {
    kind: 'pokemon',
    serial: finiteNumber(params?.serial) ?? finiteNumber(params?.serialBefore) ?? finiteNumber(params?.serialAfter),
    cardId: finiteNumber(params?.cardIdBefore) ?? finiteNumber(params?.cardId) ?? finiteNumber(params?.cardIdAfter),
    name: stringValue(params?.cardNameBefore) ?? stringValue(params?.cardName),
  };
}

function boardMutationAnchorForEvent(view: GameView, event: ActionTimelineEvent): AnimationAnchorRef | undefined {
  if (event.playerIndex === undefined) {
    return undefined;
  }
  const params = event.params as Record<string, unknown> | undefined;
  return boardSlotAnchorForPokemon(
    view.players[event.playerIndex],
    finiteNumber(params?.serialTarget)
      ?? finiteNumber(params?.serialSource)
      ?? finiteNumber(params?.serialFrom)
      ?? finiteNumber(params?.serialTo)
      ?? finiteNumber(params?.serial),
    finiteNumber(params?.cardIdTarget)
      ?? finiteNumber(params?.cardIdSource)
      ?? finiteNumber(params?.cardIdFrom)
      ?? finiteNumber(params?.cardIdTo)
      ?? finiteNumber(params?.cardId),
  );
}

function boardMutationAnimationIdentityForEvent(event: ActionTimelineEvent): AnimationIdentity {
  const params = event.params as Record<string, unknown> | undefined;
  return {
    kind: 'pokemon',
    serial: finiteNumber(params?.serialTarget)
      ?? finiteNumber(params?.serialSource)
      ?? finiteNumber(params?.serialFrom)
      ?? finiteNumber(params?.serialTo)
      ?? finiteNumber(params?.serial),
    cardId: finiteNumber(params?.cardIdTarget)
      ?? finiteNumber(params?.cardIdSource)
      ?? finiteNumber(params?.cardIdFrom)
      ?? finiteNumber(params?.cardIdTo)
      ?? finiteNumber(params?.cardId),
    name: stringValue(params?.cardName) ?? stringValue(params?.cardNameTarget) ?? stringValue(params?.cardNameSource),
  };
}

function conditionAnchorForEvent(view: GameView, event: ActionTimelineEvent): AnimationAnchorRef | undefined {
  if (event.playerIndex === undefined) {
    return undefined;
  }
  const player = view.players[event.playerIndex];
  return boardSlotAnchorForEvent(player, event)
    ?? (player ? { kind: 'board-slot', playerIndex: event.playerIndex, slot: 'active', slotIndex: player.active.index } : undefined);
}

function animationIdentityForEvent(event: ActionTimelineEvent, kind: AnimationIdentity['kind']): AnimationIdentity {
  const params = event.params as Record<string, unknown> | undefined;
  return {
    kind,
    serial: finiteNumber(params?.serial),
    cardId: finiteNumber(params?.cardId),
    name: stringValue(params?.cardName),
  };
}

function abilityNameForEvent(event: ActionTimelineEvent): string {
  const params = event.params as Record<string, unknown> | undefined;
  const explicit = typeof params?.abilityName === 'string' ? params.abilityName.trim() : '';
  if (explicit) {
    return explicit;
  }
  const match = event.message.match(/\bused\s+(.+?)\s+with\b/i);
  return match?.[1] ?? 'Ability';
}

function attackNameForEvent(event: ActionTimelineEvent): string {
  const match = event.message.match(/\bused\s+(.+?)\s+with\b/i);
  return match?.[1] ?? 'Attack';
}

function damageValueForEvent(event: ActionTimelineEvent): number {
  const params = event.params as Record<string, unknown> | undefined;
  const value = Number(params?.value);
  return Number.isFinite(value) ? Math.abs(Math.min(0, value)) : 0;
}

function coinResultLabel(event: ActionTimelineEvent): string {
  const params = event.params as Record<string, unknown> | undefined;
  if (params?.head === true) {
    return 'Heads';
  }
  if (params?.head === false) {
    return 'Tails';
  }
  return 'Coin';
}

function changePulseLabel(event: ActionTimelineEvent): string {
  const params = event.params as Record<string, unknown> | undefined;
  const cardIdAfter = finiteNumber(params?.cardIdAfter);
  if (cardIdAfter !== undefined) {
    return `Changed to ${cabtCardName(cardIdAfter)}`;
  }
  return 'Changed';
}

function boardMutationPulseLabel(event: ActionTimelineEvent): string {
  if (event.kind === 'Devolve') {
    return 'Devolved';
  }
  return 'Moved attached card';
}

function conditionPulseLabel(event: ActionTimelineEvent): string {
  const params = event.params as Record<string, unknown> | undefined;
  if (params?.isRecover) {
    return event.kind === 'Asleep' ? 'Awake' : 'Recovered';
  }
  return event.kind ?? 'Condition';
}
