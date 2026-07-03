import { actionAnimationStartMs, actionAnimationTiming } from '../cabt/actionAnimationSchedule';
import { cabtCardToView } from '../cabt/cardView';
import { CabtAreaType } from '../cabt/types';
import type { ActionTimelineEvent, CardView, PlayerView, PokemonSlotView } from '../game/types';
import type { Anchor } from './anchors';
import type { HideMode } from './visibility';

export type SpriteSpec =
  | { kind: 'slot'; slot: PokemonSlotView; activeSize: boolean }
  | { kind: 'card'; card: CardView }
  | { kind: 'flip-card'; card: CardView };

export type HideClaim = {
  anchor: Anchor;
  mode: HideMode;
};

export type CardMotion = {
  id: string;
  style: 'board-move' | 'attached-move' | 'deck-discard';
  sprite: SpriteSpec;
  from: Anchor;
  to: Anchor;
  startMs: number;
  durationMs: number;
  toDeck: boolean;
  fromDeck: boolean;
  // Live-mode handoff waits until the destination shows this exact card.
  waitForDestinationCard: boolean;
  hide: HideClaim[];
};

// Turns one batch of timeline events into board-plane card motions. This is a
// pure function of (events, players) so replay phases and live frames share
// one classification. `players` must be indexable by event playerIndex.
export function choreographBoardMotions(events: ActionTimelineEvent[], players: PlayerView[]): CardMotion[] {
  const motions: CardMotion[] = [];
  for (const event of events) {
    if (event.kind === 'Switch') {
      motions.push(...switchMotions(event, events, players));
      continue;
    }
    if (event.kind === 'MoveCard') {
      motions.push(...moveCardMotions(event, events, players));
    }
  }
  return motions;
}

function switchMotions(event: ActionTimelineEvent, batch: ActionTimelineEvent[], players: PlayerView[]): CardMotion[] {
  const params = eventParams(event);
  const player = event.playerIndex;
  const activeCard = num(params.cardIdActive);
  const benchCard = num(params.cardIdBench);
  const activeSerial = num(params.serialActive);
  const benchSerial = num(params.serialBench);
  if (player === undefined || activeCard === undefined || benchCard === undefined) {
    return [];
  }

  const startMs = actionAnimationStartMs(batch, event);
  const fromActive: Anchor = { kind: 'pokemon', player, serial: activeSerial, cardId: activeCard };
  const fromBench: Anchor = { kind: 'pokemon', player, serial: benchSerial, cardId: benchCard };
  return [
    {
      id: `${event.id}-active-${activeSerial ?? activeCard}`,
      style: 'board-move',
      sprite: slotSprite(players, player, activeSerial, activeCard, false),
      from: fromActive,
      to: fromBench,
      startMs,
      durationMs: actionAnimationTiming.boardMoveMs,
      toDeck: false,
      fromDeck: false,
      waitForDestinationCard: false,
      hide: [
        { anchor: fromActive, mode: 'contents' },
        { anchor: fromBench, mode: 'contents' },
      ],
    },
    {
      id: `${event.id}-bench-${benchSerial ?? benchCard}`,
      style: 'board-move',
      sprite: slotSprite(players, player, benchSerial, benchCard, true),
      from: fromBench,
      to: fromActive,
      startMs,
      durationMs: actionAnimationTiming.boardMoveMs,
      toDeck: false,
      fromDeck: false,
      waitForDestinationCard: false,
      hide: [
        { anchor: fromBench, mode: 'contents' },
        { anchor: fromActive, mode: 'contents' },
      ],
    },
  ];
}

function moveCardMotions(event: ActionTimelineEvent, batch: ActionTimelineEvent[], players: PlayerView[]): CardMotion[] {
  const params = eventParams(event);
  const player = event.playerIndex;
  const fromArea = num(params.fromArea);
  const toArea = num(params.toArea);
  const cardId = num(params.cardId);
  const serial = num(params.serial);
  if (player === undefined || fromArea === undefined || toArea === undefined) {
    return [];
  }

  if (fromArea === CabtAreaType.DECK && toArea === CabtAreaType.DISCARD) {
    if (cardId === undefined) {
      return [];
    }
    return [{
      id: `${event.id}-${serial ?? cardId}`,
      style: 'deck-discard',
      sprite: { kind: 'flip-card', card: cabtCardToView(cardId) },
      from: { kind: 'deck', player },
      to: { kind: 'discard', player, surface: true },
      startMs: actionAnimationStartMs(batch, event),
      durationMs: actionAnimationTiming.deckDiscardMs,
      toDeck: false,
      fromDeck: false,
      waitForDestinationCard: false,
      hide: [],
    }];
  }

  if (isAttachedArea(fromArea) && (toArea === CabtAreaType.DISCARD || toArea === CabtAreaType.DECK)) {
    if (serial === undefined || cardId === undefined) {
      return [];
    }
    const from: Anchor = { kind: 'attached', attached: fromArea === CabtAreaType.ENERGY ? 'energy' : 'tool', serial };
    const toDiscard = toArea === CabtAreaType.DISCARD;
    const hide: HideClaim[] = [{ anchor: from, mode: 'element' }];
    if (toDiscard) {
      hide.push({ anchor: { kind: 'discard', player, serial, cardId, exact: true }, mode: 'element' });
    }
    return [{
      id: `${event.id}-${serial}`,
      style: 'attached-move',
      sprite: { kind: 'card', card: cabtCardToView(cardId) },
      from,
      to: toDiscard ? { kind: 'discard', player } : { kind: 'deck', player },
      startMs: actionAnimationStartMs(batch, event),
      durationMs: actionAnimationTiming.handMoveMs,
      toDeck: false,
      fromDeck: false,
      waitForDestinationCard: false,
      hide,
    }];
  }

  if (fromArea === CabtAreaType.STADIUM && toArea === CabtAreaType.DISCARD) {
    if (cardId === undefined) {
      return [];
    }
    return [{
      id: `${event.id}-${serial ?? cardId}`,
      style: 'board-move',
      sprite: { kind: 'card', card: cabtCardToView(cardId) },
      from: { kind: 'stadium', player, serial },
      to: { kind: 'discard', player, serial, cardId },
      startMs: actionAnimationStartMs(batch, event),
      durationMs: actionAnimationTiming.boardMoveMs,
      toDeck: false,
      fromDeck: false,
      waitForDestinationCard: true,
      hide: [
        { anchor: { kind: 'stadium', player, serial }, mode: 'element' },
        { anchor: { kind: 'discard', player, serial, cardId, exact: true }, mode: 'element' },
      ],
    }];
  }

  if (cardId === undefined) {
    return [];
  }
  const identity: Anchor = { kind: 'pokemon', player, serial, cardId };

  if (fromArea === CabtAreaType.DECK && (toArea === CabtAreaType.ACTIVE || toArea === CabtAreaType.BENCH)) {
    return [{
      id: `${event.id}-${serial ?? cardId}`,
      style: 'board-move',
      sprite: slotSprite(players, player, serial, cardId, toArea === CabtAreaType.ACTIVE),
      from: { kind: 'deck', player },
      to: identity,
      startMs: actionAnimationStartMs(batch, event),
      durationMs: actionAnimationTiming.boardMoveMs,
      toDeck: false,
      fromDeck: true,
      waitForDestinationCard: false,
      hide: [{ anchor: identity, mode: 'contents' }],
    }];
  }

  if ((fromArea === CabtAreaType.ACTIVE || fromArea === CabtAreaType.BENCH) && toArea === CabtAreaType.DECK) {
    return [{
      id: `${event.id}-${serial ?? cardId}`,
      style: 'board-move',
      sprite: slotSprite(players, player, serial, cardId, fromArea === CabtAreaType.ACTIVE),
      from: identity,
      to: { kind: 'deck', player },
      startMs: actionAnimationStartMs(batch, event),
      durationMs: actionAnimationTiming.boardMoveMs,
      toDeck: true,
      fromDeck: false,
      waitForDestinationCard: false,
      hide: [{ anchor: identity, mode: 'contents' }],
    }];
  }

  if (fromArea === CabtAreaType.BENCH && toArea === CabtAreaType.ACTIVE) {
    const to: Anchor = { kind: 'slot', player, slot: 'active', index: 0 };
    return [{
      id: `${event.id}-${serial ?? cardId}`,
      style: 'board-move',
      sprite: slotSprite(players, player, serial, cardId, true),
      from: identity,
      to,
      startMs: actionAnimationStartMs(batch, event),
      durationMs: actionAnimationTiming.boardMoveMs,
      toDeck: false,
      fromDeck: false,
      waitForDestinationCard: false,
      hide: [
        { anchor: identity, mode: 'contents' },
        { anchor: to, mode: 'contents' },
      ],
    }];
  }

  if (fromArea === CabtAreaType.ACTIVE && toArea === CabtAreaType.BENCH) {
    const to = activeToBenchTarget(event, batch);
    if (!to) {
      return [];
    }
    return [{
      id: `${event.id}-${serial ?? cardId}`,
      style: 'board-move',
      sprite: slotSprite(players, player, serial, cardId, false),
      from: identity,
      to,
      startMs: actionAnimationStartMs(batch, event),
      durationMs: actionAnimationTiming.boardMoveMs,
      toDeck: false,
      fromDeck: false,
      waitForDestinationCard: false,
      hide: [
        { anchor: identity, mode: 'contents' },
        { anchor: to, mode: 'contents' },
      ],
    }];
  }

  return [];
}

// An active Pokemon retreating to bench lands where its counterpart came
// from: the paired bench->active event names that slot. An explicit bench
// index in the event params wins when present.
function activeToBenchTarget(event: ActionTimelineEvent, batch: ActionTimelineEvent[]): Anchor | null {
  const params = eventParams(event);
  const player = event.playerIndex;
  const benchIndex = num(params.toIndex) ?? num(params.index) ?? num(params.benchIndex);
  if (benchIndex !== undefined && Number.isInteger(benchIndex) && player !== undefined) {
    return { kind: 'slot', player, slot: 'bench', index: benchIndex };
  }
  const paired = batch.find((candidate) => {
    if (candidate === event || candidate.kind !== 'MoveCard' || candidate.playerIndex !== player) {
      return false;
    }
    const candidateParams = eventParams(candidate);
    return num(candidateParams.fromArea) === CabtAreaType.BENCH && num(candidateParams.toArea) === CabtAreaType.ACTIVE;
  });
  if (!paired) {
    return null;
  }
  const pairedParams = eventParams(paired);
  const serial = num(pairedParams.serial);
  const cardId = num(pairedParams.cardId);
  if (serial === undefined && cardId === undefined) {
    return null;
  }
  return { kind: 'pokemon', player, serial, cardId };
}

function slotSprite(
  players: PlayerView[],
  playerIndex: number,
  serial: number | undefined,
  cardId: number,
  activeSize: boolean,
): SpriteSpec {
  const slot = slotForIdentity(players, playerIndex, serial, cardId);
  if (slot?.pokemon) {
    return {
      kind: 'slot',
      slot: { ...slot, pokemon: { ...slot.pokemon, animationHidden: undefined } },
      activeSize,
    };
  }
  return {
    kind: 'slot',
    slot: syntheticSlot(playerIndex, cabtCardToView(cardId)),
    activeSize,
  };
}

function slotForIdentity(
  players: PlayerView[],
  playerIndex: number,
  serial: number | undefined,
  cardId: number,
): PokemonSlotView | undefined {
  const candidates = players.flatMap((player) => [player.active, ...player.bench]);
  if (serial !== undefined) {
    const bySerial = candidates.find((slot) => slot.pokemon?.serial === serial);
    if (bySerial) {
      return bySerial;
    }
  }
  return candidates.find((slot) => slot.ownerIndex === playerIndex && slot.pokemon?.id === cardId);
}

function syntheticSlot(playerIndex: number, card: CardView): PokemonSlotView {
  return {
    ownerIndex: playerIndex,
    slot: 'bench',
    index: 0,
    target: { player: 0, slot: 0, index: 0 },
    empty: false,
    pokemon: card,
    cards: [card],
    damage: 0,
    hp: card.hp ?? 0,
    retreat: [],
    energy: [],
    tools: [],
    specialConditions: [],
  };
}

function isAttachedArea(area: number): boolean {
  return area === CabtAreaType.ENERGY || area === CabtAreaType.TOOL;
}

function eventParams(event: ActionTimelineEvent): Record<string, unknown> {
  return (event.params ?? {}) as Record<string, unknown>;
}

function num(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
