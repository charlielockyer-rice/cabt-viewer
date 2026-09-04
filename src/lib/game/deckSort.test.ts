import { describe, expect, it } from 'vitest';
import { compareDeckCards, sortByDeckOrder } from './deckSort';
import type { CardView } from './types';

function pokemon(name: string, stage: 'Basic' | 'Stage 1' | 'Stage 2'): CardView {
  return { name, fullName: name, superType: 'Pokemon', stage };
}

function trainer(name: string, trainerType: string): CardView {
  return { name, fullName: name, superType: 'Trainer', trainerType };
}

function energy(name: string): CardView {
  return { name, fullName: name, superType: 'Energy' };
}

describe('deck sort', () => {
  it('orders Pokemon, then Trainers, then Energy', () => {
    const deck = [
      energy('Basic {W} Energy'),
      trainer('Ultra Ball', 'Item'),
      pokemon('Snover', 'Basic'),
    ];

    expect(sortByDeckOrder(deck, (card) => card).map((card) => card.name)).toEqual([
      'Snover',
      'Ultra Ball',
      'Basic {W} Energy',
    ]);
  });

  it('orders Pokemon by stage, then by name', () => {
    const deck = [
      pokemon('Abomasnow', 'Stage 1'),
      pokemon('Zubat', 'Basic'),
      pokemon('Alakazam', 'Stage 2'),
      pokemon('Applin', 'Basic'),
      pokemon('Aerodactyl', 'Stage 1'),
    ];

    expect(sortByDeckOrder(deck, (card) => card).map((card) => card.name)).toEqual([
      'Applin',
      'Zubat',
      'Abomasnow',
      'Aerodactyl',
      'Alakazam',
    ]);
  });

  it('orders Trainers Supporter, Item, Tool, Stadium, then by name', () => {
    const deck = [
      trainer('Forest of Vitality', 'Stadium'),
      trainer('Nest Ball', 'Item'),
      trainer('Rare Candy', 'Item'),
      trainer('Bravery Charm', 'Pokémon Tool'),
      trainer("Iono", 'Supporter'),
    ];

    expect(sortByDeckOrder(deck, (card) => card).map((card) => card.name)).toEqual([
      'Iono',
      'Nest Ball',
      'Rare Candy',
      'Bravery Charm',
      'Forest of Vitality',
    ]);
  });

  it('orders Energy by name', () => {
    const deck = [energy('Basic {W} Energy'), energy('Basic {G} Energy'), energy('Jet Energy')];

    expect(sortByDeckOrder(deck, (card) => card).map((card) => card.name)).toEqual([
      'Basic {G} Energy',
      'Basic {W} Energy',
      'Jet Energy',
    ]);
  });

  it('is stable: equal cards keep their incoming order', () => {
    const deck = [
      { ...pokemon('Snover', 'Basic'), serial: 7 },
      { ...pokemon('Snover', 'Basic'), serial: 3 },
      { ...pokemon('Snover', 'Basic'), serial: 5 },
    ];

    expect(compareDeckCards(deck[0], deck[1])).toBe(0);
    expect(sortByDeckOrder(deck, (card) => card).map((card) => card.serial)).toEqual([7, 3, 5]);
  });

  it('sorts unclassified cards last without dropping them', () => {
    const unknown: CardView = { name: 'Card 999', fullName: 'Card 999' };
    const deck = [unknown, energy('Jet Energy'), pokemon('Snover', 'Basic')];

    expect(sortByDeckOrder(deck, (card) => card).map((card) => card.name)).toEqual([
      'Snover',
      'Jet Energy',
      'Card 999',
    ]);
  });

  it('leaves the input array untouched', () => {
    const deck = [energy('Jet Energy'), pokemon('Snover', 'Basic')];

    sortByDeckOrder(deck, (card) => card);

    expect(deck.map((card) => card.name)).toEqual(['Jet Energy', 'Snover']);
  });
});
