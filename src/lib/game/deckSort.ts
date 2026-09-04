import type { CardView } from './types';

// Deck-search reading order: a player reads their deck the way a deck list is
// written — Pokemon first (by stage), then Trainers (by trainer type), then
// Energy, alphabetical within each group.
//
// Sorting is also what keeps the prompt honest: the engine hands us
// `select.deck` in its real, hidden shuffle order, so rendering it as given
// would leak the top of the deck. Ordering by card identity destroys that
// information. Never render a deck list in engine order.

const SUPER_TYPE_ORDER: Record<string, number> = {
  Pokemon: 0,
  Trainer: 1,
  Energy: 2,
};

const STAGE_ORDER: Record<string, number> = {
  Basic: 0,
  'Stage 1': 1,
  'Stage 2': 2,
};

const TRAINER_TYPE_ORDER: Record<string, number> = {
  Supporter: 0,
  Item: 1,
  'Pokémon Tool': 2,
  Stadium: 3,
};

function rank(order: Record<string, number>, value: string | number | undefined): number {
  if (value === undefined || value === null) {
    return Number.MAX_SAFE_INTEGER;
  }
  return order[String(value)] ?? Number.MAX_SAFE_INTEGER;
}

function groupRank(card: CardView): number {
  if (card.superType === 'Pokemon') {
    return rank(STAGE_ORDER, card.stage);
  }
  if (card.superType === 'Trainer') {
    return rank(TRAINER_TYPE_ORDER, card.trainerType);
  }
  return 0;
}

// Total order over cards; equal cards compare 0, so a stable sort keeps their
// incoming order (they are indistinguishable on screen anyway).
export function compareDeckCards(a: CardView, b: CardView): number {
  const superType = rank(SUPER_TYPE_ORDER, a.superType) - rank(SUPER_TYPE_ORDER, b.superType);
  if (superType !== 0) {
    return superType;
  }
  const group = groupRank(a) - groupRank(b);
  if (group !== 0) {
    return group;
  }
  return a.name.localeCompare(b.name, 'en');
}

// Stable sort of anything that carries a card (Array.prototype.sort is stable).
export function sortByDeckOrder<T>(items: T[], cardOf: (item: T) => CardView): T[] {
  return [...items].sort((a, b) => compareDeckCards(cardOf(a), cardOf(b)));
}
