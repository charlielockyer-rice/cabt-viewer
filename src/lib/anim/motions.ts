import { actionAnimationStartMs, actionAnimationTiming } from '../cabt/actionAnimationSchedule';
import { cabtCardToView } from '../cabt/cardView';
import { CabtAreaType } from '../cabt/types';
import type { ActionTimelineEvent, CardView, PlayerView, PokemonSlotView } from '../game/types';
import type { Anchor } from './anchors';
import type { HideMode } from './visibility';

export type SpriteSpec =
  | { kind: 'slot'; slot: PokemonSlotView; activeSize: boolean }
  | { kind: 'card'; card: CardView }
  | { kind: 'flip-card'; card: CardView }
  | { kind: 'label'; text: string }
  | { kind: 'none' };

export type HideClaim = {
  anchor: Anchor;
  mode: HideMode;
};

export type MotionStyle =
  | 'board-move'
  | 'attached-move'
  | 'deck-discard'
  | 'hand-play'
  | 'deck-draw'
  | 'hand-reset'
  | 'prize-take'
  | 'knock-out'
  | 'damage-float'
  | 'deck-shuffle';

export type CardMotion = {
  id: string;
  style: MotionStyle;
  // Board-space motions render inside the tilted plane; viewport motions
  // render position:fixed and cross planes via homography.
  space: 'board' | 'viewport';
  player: number;
  sprite: SpriteSpec;
  from: Anchor;
  to: Anchor;
  // Tried in order when `to` does not resolve (e.g. a played trainer lands in
  // the play zone, the discard, or on the board depending on the view).
  toFallbacks?: Anchor[];
  startMs: number;
  durationMs: number;
  toDeck: boolean;
  fromDeck: boolean;
  // Live-mode handoff waits until the destination shows this exact card.
  waitForDestinationCard: boolean;
  hide: HideClaim[];
  // hand-play: hide whichever destination resolved, mode chosen by element.
  hideResolvedTarget?: boolean;
  // hand-play: evolution flight with target glow and slot-chrome fade.
  evolve?: boolean;
  // deck-draw: batch shares a step with a hand-to-deck reset (mulligan), so
  // draws refill existing slots by serial instead of appending.
  mulligan?: boolean;
  // prize-take: position within this player's take group, for extrapolating
  // source rects of prize slots that already left the DOM.
  takeIndex?: number;
  takeCount?: number;
};

// Target-owned CSS animations: no sprite, the real element animates.
export type TargetEffect = {
  id: string;
  kind: 'attach-under' | 'prize-place' | 'announce-attack' | 'announce-ability' | 'lunge';
  anchor: Anchor;
  player: number;
  card?: CardView;
  // attach-under: the hand card the attachment visually departs from.
  sourceSerial?: number;
  // prize-place: stacking order within the placement group.
  order: number;
  // announce-*: the attack/ability name shown above the slot.
  label?: string;
  // lunge: the defender the attacker nudges toward.
  targetAnchor?: Anchor;
  startMs: number;
  durationMs: number;
};

export type Choreography = {
  motions: CardMotion[];
  effects: TargetEffect[];
};

// Turns one batch of timeline events into motions and target effects. This is
// a pure function of (events, players) so replay phases and live frames share
// one classification. `context` is the whole step's timeline, used to find
// the attacking Pokemon when a damage phase animates on its own.
export function choreograph(
  events: ActionTimelineEvent[],
  players: PlayerView[],
  context: ActionTimelineEvent[] = events,
): Choreography {
  const motions: CardMotion[] = [];
  const effects: TargetEffect[] = [];
  const drawIndexes = new Map<number, number>();
  const drawCounts = new Map<number, number>();
  const prizePlaceIndexes = new Map<number, number>();
  const prizeTakeIndexes = new Map<number, number>();
  const prizeTakeCounts = new Map<number, number>();

  for (const event of events) {
    const player = event.playerIndex;
    if (player === undefined) {
      continue;
    }
    if (event.kind === 'Draw' || event.kind === 'DrawReverse') {
      drawCounts.set(player, (drawCounts.get(player) ?? 0) + 1);
      continue;
    }
    const params = eventParams(event);
    if ((event.kind === 'MoveCard' || event.kind === 'MoveCardReverse')
      && num(params.fromArea) === CabtAreaType.PRIZE
      && num(params.toArea) === CabtAreaType.HAND) {
      prizeTakeCounts.set(player, (prizeTakeCounts.get(player) ?? 0) + 1);
    }
  }

  for (const event of events) {
    if (event.playerIndex === undefined) {
      continue;
    }
    if (event.kind === 'Switch') {
      motions.push(...switchMotions(event, events, players));
      continue;
    }
    if (event.kind === 'Draw' || event.kind === 'DrawReverse') {
      motions.push(...drawMotions(event, events, players, drawIndexes, drawCounts));
      continue;
    }
    if (event.kind === 'Play' || event.kind === 'Evolve') {
      motions.push(...handPlayMotions(event, events));
      continue;
    }
    if (event.kind === 'Attach') {
      effects.push(...attachEffects(event, events));
      continue;
    }
    if (event.kind === 'Attack' || event.kind === 'Ability') {
      effects.push(...announceEffects(event, events));
      continue;
    }
    if (event.kind === 'HpChange' || event.kind === 'HPChange') {
      const result = damageChoreography(event, events, context);
      motions.push(...result.motions);
      effects.push(...result.effects);
      continue;
    }
    if (event.kind === 'Shuffle') {
      motions.push(...shuffleMotions(event, events));
      continue;
    }
    if (event.kind === 'MoveCard' || event.kind === 'MoveCardReverse') {
      const result = moveCardChoreography(event, events, players, prizePlaceIndexes, prizeTakeIndexes, prizeTakeCounts);
      motions.push(...result.motions);
      effects.push(...result.effects);
    }
  }
  return { motions, effects };
}

function announceEffects(event: ActionTimelineEvent, batch: ActionTimelineEvent[]): TargetEffect[] {
  const params = eventParams(event);
  const player = event.playerIndex;
  const serial = num(params.serial);
  const cardId = num(params.cardId);
  if (player === undefined || (serial === undefined && cardId === undefined)) {
    return [];
  }
  const attack = event.kind === 'Attack';
  return [{
    id: `${event.id}-announce`,
    kind: attack ? 'announce-attack' : 'announce-ability',
    anchor: { kind: 'pokemon', player, serial, cardId },
    player,
    order: 0,
    label: announceLabel(event),
    startMs: actionAnimationStartMs(batch, event),
    durationMs: attack ? actionAnimationTiming.attackAnnounceMs : actionAnimationTiming.abilityAnnounceMs,
  }];
}

function announceLabel(event: ActionTimelineEvent): string {
  const params = eventParams(event);
  const explicit = typeof params.abilityName === 'string' ? params.abilityName.trim() : '';
  if (explicit) {
    return explicit;
  }
  const match = event.message.match(/\bused\s+(.+?)\s+with\b/i);
  return match?.[1] ?? (event.kind === 'Attack' ? 'Attack' : 'Ability');
}

function damageChoreography(
  event: ActionTimelineEvent,
  batch: ActionTimelineEvent[],
  context: ActionTimelineEvent[],
): Choreography {
  const params = eventParams(event);
  const player = event.playerIndex;
  const serial = num(params.serial);
  const cardId = num(params.cardId);
  if (player === undefined || (serial === undefined && cardId === undefined)) {
    return { motions: [], effects: [] };
  }
  const target: Anchor = { kind: 'pokemon', player, serial, cardId };
  const startMs = actionAnimationStartMs(batch, event);
  const value = num(params.value);
  const damage = value !== undefined ? Math.abs(Math.min(0, value)) : 0;

  const effects: TargetEffect[] = [];
  const attackEvent = context.find((candidate) => candidate.kind === 'Attack');
  if (attackEvent && attackEvent.playerIndex !== undefined) {
    const attackParams = eventParams(attackEvent);
    effects.push({
      id: `${event.id}-lunge`,
      kind: 'lunge',
      anchor: {
        kind: 'pokemon',
        player: attackEvent.playerIndex,
        serial: num(attackParams.serial),
        cardId: num(attackParams.cardId),
      },
      player: attackEvent.playerIndex,
      order: 0,
      targetAnchor: target,
      startMs,
      durationMs: actionAnimationTiming.damageVisualMs,
    });
  }

  const motions: CardMotion[] = damage > 0
    ? [{
        id: `${event.id}-damage`,
        style: 'damage-float',
        space: 'viewport',
        player,
        sprite: { kind: 'label', text: String(damage) },
        from: target,
        to: target,
        startMs,
        durationMs: actionAnimationTiming.damageVisualMs,
        toDeck: false,
        fromDeck: false,
        waitForDestinationCard: false,
        hide: [],
      }]
    : [];
  return { motions, effects };
}

function shuffleMotions(event: ActionTimelineEvent, batch: ActionTimelineEvent[]): CardMotion[] {
  const player = event.playerIndex;
  if (player === undefined) {
    return [];
  }
  return [{
    id: `${event.id}-shuffle`,
    style: 'deck-shuffle',
    space: 'board',
    player,
    sprite: { kind: 'none' },
    from: { kind: 'deck', player },
    to: { kind: 'deck', player },
    startMs: actionAnimationStartMs(batch, event),
    durationMs: actionAnimationTiming.deckShuffleMs,
    toDeck: false,
    fromDeck: false,
    waitForDestinationCard: false,
    hide: [],
  }];
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
      space: 'board',
      player,
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
      space: 'board',
      player,
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

function moveCardChoreography(
  event: ActionTimelineEvent,
  batch: ActionTimelineEvent[],
  players: PlayerView[],
  prizePlaceIndexes: Map<number, number>,
  prizeTakeIndexes: Map<number, number>,
  prizeTakeCounts: Map<number, number>,
): Choreography {
  const none: Choreography = { motions: [], effects: [] };
  const params = eventParams(event);
  const player = event.playerIndex;
  const fromArea = num(params.fromArea);
  const toArea = num(params.toArea);
  const cardId = num(params.cardId);
  const serial = num(params.serial);
  if (player === undefined || fromArea === undefined || toArea === undefined) {
    return none;
  }

  // Prize placements and takes are the only facedown (MoveCardReverse) paths
  // that animate.
  if (fromArea === CabtAreaType.DECK && toArea === CabtAreaType.PRIZE) {
    const index = prizePlaceIndexes.get(player) ?? 0;
    prizePlaceIndexes.set(player, index + 1);
    const prizesLeft = players.find((candidate) => candidate.index === player)?.prizesLeft ?? 6;
    const placeCount = batch.filter((candidate) => {
      const candidateParams = eventParams(candidate);
      return candidate.playerIndex === player
        && (candidate.kind === 'MoveCard' || candidate.kind === 'MoveCardReverse')
        && num(candidateParams.fromArea) === CabtAreaType.DECK
        && num(candidateParams.toArea) === CabtAreaType.PRIZE;
    }).length;
    return {
      motions: [],
      effects: [{
        id: `${event.id}-prize-${index}`,
        kind: 'prize-place',
        anchor: { kind: 'prize', player, index: Math.max(0, prizesLeft - placeCount + index) },
        player,
        order: index + 1,
        startMs: index * prizePlaceStepMs,
        durationMs: prizePlaceMs,
      }],
    };
  }

  if (fromArea === CabtAreaType.PRIZE && toArea === CabtAreaType.HAND) {
    const index = prizeTakeIndexes.get(player) ?? 0;
    prizeTakeIndexes.set(player, index + 1);
    const count = prizeTakeCounts.get(player) ?? 1;
    return { motions: [{
      id: `${event.id}-${serial ?? index}`,
      style: 'prize-take',
      space: 'viewport',
      player,
      sprite: { kind: 'card', card: cardId !== undefined ? cabtCardToView(cardId) : unknownCard() },
      from: { kind: 'prize', player, index },
      to: { kind: 'hand-slot', player, serial, fromEnd: count - index },
      startMs: actionAnimationStartMs(batch, event),
      durationMs: actionAnimationTiming.prizeTakeMs,
      toDeck: false,
      fromDeck: false,
      waitForDestinationCard: false,
      hide: [],
      takeIndex: index,
      takeCount: count,
    }], effects: [] };
  }

  if (event.kind !== 'MoveCard') {
    return none;
  }

  if (fromArea === CabtAreaType.DECK && toArea === CabtAreaType.DISCARD) {
    if (cardId === undefined) {
      return none;
    }
    return { motions: [{
      id: `${event.id}-${serial ?? cardId}`,
      style: 'deck-discard',
      space: 'board',
      player,
      sprite: { kind: 'flip-card', card: cabtCardToView(cardId) },
      from: { kind: 'deck', player },
      to: { kind: 'discard', player, surface: true },
      startMs: actionAnimationStartMs(batch, event),
      durationMs: actionAnimationTiming.deckDiscardMs,
      toDeck: false,
      fromDeck: false,
      waitForDestinationCard: false,
      hide: [],
    }], effects: [] };
  }

  if (isAttachedArea(fromArea) && (toArea === CabtAreaType.DISCARD || toArea === CabtAreaType.DECK)) {
    if (serial === undefined || cardId === undefined) {
      return none;
    }
    const from: Anchor = { kind: 'attached', attached: fromArea === CabtAreaType.ENERGY ? 'energy' : 'tool', serial };
    const toDiscard = toArea === CabtAreaType.DISCARD;
    const hide: HideClaim[] = [{ anchor: from, mode: 'element' }];
    if (toDiscard) {
      hide.push({ anchor: { kind: 'discard', player, serial, cardId, exact: true }, mode: 'element' });
    }
    return { motions: [{
      id: `${event.id}-${serial}`,
      style: 'attached-move',
      space: 'board',
      player,
      sprite: { kind: 'card', card: cabtCardToView(cardId) },
      from,
      to: toDiscard ? { kind: 'discard', player } : { kind: 'deck', player },
      startMs: actionAnimationStartMs(batch, event),
      durationMs: actionAnimationTiming.handMoveMs,
      toDeck: false,
      fromDeck: false,
      waitForDestinationCard: false,
      hide,
    }], effects: [] };
  }

  if (fromArea === CabtAreaType.STADIUM && toArea === CabtAreaType.DISCARD) {
    if (cardId === undefined) {
      return none;
    }
    return { motions: [{
      id: `${event.id}-${serial ?? cardId}`,
      style: 'board-move',
      space: 'board',
      player,
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
    }], effects: [] };
  }

  if (cardId === undefined) {
    return none;
  }
  const identity: Anchor = { kind: 'pokemon', player, serial, cardId };

  if (fromArea === CabtAreaType.HAND && toArea === CabtAreaType.DECK) {
    if (serial === undefined) {
      return none;
    }
    return { motions: [{
      id: `${event.id}-${serial}`,
      style: 'hand-reset',
      space: 'viewport',
      player,
      sprite: { kind: 'card', card: cabtCardToView(cardId) },
      from: { kind: 'hand-slot', player, serial },
      to: { kind: 'deck', player },
      startMs: actionAnimationStartMs(batch, event),
      durationMs: actionAnimationTiming.handMoveMs,
      toDeck: true,
      fromDeck: false,
      waitForDestinationCard: false,
      hide: [],
    }], effects: [] };
  }

  if (fromArea === CabtAreaType.HAND
    && (toArea === CabtAreaType.DISCARD || toArea === CabtAreaType.ACTIVE || toArea === CabtAreaType.BENCH)) {
    const to: Anchor = toArea === CabtAreaType.DISCARD
      ? { kind: 'discard', player, serial, cardId }
      : identity;
    const toFallbacks: Anchor[] = toArea === CabtAreaType.ACTIVE
      ? [{ kind: 'slot', player, slot: 'active', index: 0 }]
      : toArea === CabtAreaType.BENCH
        ? [{ kind: 'slot', player, slot: 'bench', index: 0 }]
        : [];
    return { motions: [{
      id: `${event.id}-${serial ?? cardId}`,
      style: 'hand-play',
      space: 'viewport',
      player,
      sprite: { kind: 'card', card: cabtCardToView(cardId) },
      from: { kind: 'hand-slot', player, serial },
      to,
      toFallbacks,
      startMs: actionAnimationStartMs(batch, event),
      durationMs: handPlayMoveMs,
      toDeck: false,
      fromDeck: false,
      waitForDestinationCard: false,
      hide: [],
      hideResolvedTarget: true,
    }], effects: [] };
  }

  if (fromArea === CabtAreaType.DECK && (toArea === CabtAreaType.ACTIVE || toArea === CabtAreaType.BENCH)) {
    return { motions: [{
      id: `${event.id}-${serial ?? cardId}`,
      style: 'board-move',
      space: 'board',
      player,
      sprite: slotSprite(players, player, serial, cardId, toArea === CabtAreaType.ACTIVE),
      from: { kind: 'deck', player },
      to: identity,
      startMs: actionAnimationStartMs(batch, event),
      durationMs: actionAnimationTiming.boardMoveMs,
      toDeck: false,
      fromDeck: true,
      waitForDestinationCard: false,
      hide: [{ anchor: identity, mode: 'contents' }],
    }], effects: [] };
  }

  if ((fromArea === CabtAreaType.ACTIVE || fromArea === CabtAreaType.BENCH) && toArea === CabtAreaType.DECK) {
    return { motions: [{
      id: `${event.id}-${serial ?? cardId}`,
      style: 'board-move',
      space: 'board',
      player,
      sprite: slotSprite(players, player, serial, cardId, fromArea === CabtAreaType.ACTIVE),
      from: identity,
      to: { kind: 'deck', player },
      startMs: actionAnimationStartMs(batch, event),
      durationMs: actionAnimationTiming.boardMoveMs,
      toDeck: true,
      fromDeck: false,
      waitForDestinationCard: false,
      hide: [{ anchor: identity, mode: 'contents' }],
    }], effects: [] };
  }

  if (fromArea === CabtAreaType.BENCH && toArea === CabtAreaType.ACTIVE) {
    const to: Anchor = { kind: 'slot', player, slot: 'active', index: 0 };
    return { motions: [{
      id: `${event.id}-${serial ?? cardId}`,
      style: 'board-move',
      space: 'board',
      player,
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
    }], effects: [] };
  }

  if ((fromArea === CabtAreaType.ACTIVE || fromArea === CabtAreaType.BENCH) && toArea === CabtAreaType.DISCARD) {
    return { motions: [{
      id: `${event.id}-${serial ?? cardId}`,
      style: 'knock-out',
      space: 'viewport',
      player,
      sprite: { kind: 'card', card: cabtCardToView(cardId) },
      from: identity,
      to: { kind: 'discard', player, surface: true },
      startMs: actionAnimationStartMs(batch, event),
      durationMs: actionAnimationTiming.knockOutMs,
      toDeck: false,
      fromDeck: false,
      waitForDestinationCard: false,
      hide: [{ anchor: identity, mode: 'contents' }],
    }], effects: [] };
  }

  if (fromArea === CabtAreaType.ACTIVE && toArea === CabtAreaType.BENCH) {
    const to = activeToBenchTarget(event, batch);
    if (!to) {
      return none;
    }
    return { motions: [{
      id: `${event.id}-${serial ?? cardId}`,
      style: 'board-move',
      space: 'board',
      player,
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
    }], effects: [] };
  }

  return none;
}

const handPlayMoveMs = 360;
const handEvolveMoveMs = 430;
const prizePlaceMs = 280;
const prizePlaceStepMs = 45;

function handPlayMotions(event: ActionTimelineEvent, batch: ActionTimelineEvent[]): CardMotion[] {
  const params = eventParams(event);
  const player = event.playerIndex;
  const cardId = num(params.cardId);
  const serial = num(params.serial);
  if (player === undefined || cardId === undefined) {
    return [];
  }
  const card = cabtCardToView(cardId);
  const evolve = event.kind === 'Evolve';

  let to: Anchor;
  let toFallbacks: Anchor[];
  if (evolve) {
    to = { kind: 'pokemon', player, serial: num(params.serialTarget), cardId: num(params.cardIdTarget) };
    toFallbacks = [{ kind: 'pokemon', player, serial, cardId }];
  } else if (card.trainerType === 'Stadium') {
    to = { kind: 'stadium', player, serial };
    toFallbacks = [];
  } else {
    to = { kind: 'pokemon', player, serial, cardId };
    toFallbacks = [
      { kind: 'discard', player, serial, cardId, exact: true },
      { kind: 'playZone', player, serial },
      { kind: 'discard', player },
    ];
  }

  return [{
    id: `${event.id}-${serial ?? cardId}`,
    style: 'hand-play',
    space: 'viewport',
    player,
    sprite: { kind: 'card', card },
    from: { kind: 'hand-slot', player, serial },
    to,
    toFallbacks,
    startMs: actionAnimationStartMs(batch, event),
    durationMs: evolve ? handEvolveMoveMs : handPlayMoveMs,
    toDeck: false,
    fromDeck: false,
    waitForDestinationCard: false,
    hide: [],
    hideResolvedTarget: !evolve,
    evolve,
  }];
}

function attachEffects(event: ActionTimelineEvent, batch: ActionTimelineEvent[]): TargetEffect[] {
  const params = eventParams(event);
  const player = event.playerIndex;
  const cardId = num(params.cardId);
  const serial = num(params.serial);
  const serialTarget = num(params.serialTarget);
  const cardIdTarget = num(params.cardIdTarget);
  if (player === undefined || cardId === undefined) {
    return [];
  }
  return [{
    id: `${event.id}-attach-${serial ?? cardId}`,
    kind: 'attach-under',
    anchor: { kind: 'pokemon', player, serial: serialTarget, cardId: cardIdTarget },
    player,
    card: cabtCardToView(cardId),
    sourceSerial: serial,
    order: 0,
    startMs: actionAnimationStartMs(batch, event),
    durationMs: actionAnimationTiming.handMoveMs,
  }];
}

function drawMotions(
  event: ActionTimelineEvent,
  batch: ActionTimelineEvent[],
  players: PlayerView[],
  drawIndexes: Map<number, number>,
  drawCounts: Map<number, number>,
): CardMotion[] {
  const params = eventParams(event);
  const player = event.playerIndex;
  if (player === undefined) {
    return [];
  }
  void players;
  const serial = num(params.serial);
  const cardId = num(params.cardId);
  const index = drawIndexes.get(player) ?? 0;
  drawIndexes.set(player, index + 1);
  const count = drawCounts.get(player) ?? 1;
  const mulligan = batch.some((candidate) => {
    const candidateParams = eventParams(candidate);
    return candidate.kind === 'MoveCard'
      && candidate.playerIndex === player
      && num(candidateParams.fromArea) === CabtAreaType.HAND
      && num(candidateParams.toArea) === CabtAreaType.DECK;
  });

  return [{
    id: `${event.id}-${serial ?? index}`,
    style: 'deck-draw',
    space: 'viewport',
    player,
    sprite: {
      kind: 'card',
      card: event.kind === 'Draw' && cardId !== undefined ? cabtCardToView(cardId) : unknownCard(),
    },
    from: { kind: 'deck', player },
    to: mulligan
      ? { kind: 'hand-slot', player, serial, index }
      : { kind: 'hand-slot', player, serial: undefined, fromEnd: count - index },
    startMs: actionAnimationStartMs(batch, event),
    durationMs: actionAnimationTiming.deckDrawMs,
    toDeck: false,
    fromDeck: true,
    waitForDestinationCard: false,
    hide: [],
    mulligan,
  }];
}

function unknownCard(): CardView {
  return { name: 'Card', fullName: 'Card' };
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
