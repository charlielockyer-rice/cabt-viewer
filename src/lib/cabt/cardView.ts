import cardRows from './cardData.generated.json';
import { resolveCardImageUrl } from '../game/cardImages';
import type { CardView } from '../game/types';

type CardRow = {
  id: number;
  name: string;
  set: string;
  setNumber: string;
  kind: string;
  hp: number | null;
  type: string;
};

const cardDatabase = new Map<number, CardRow>((cardRows as CardRow[]).map((card) => [card.id, card]));

export function cabtCardToView(cardId: number): CardView {
  const row = cardDatabase.get(cardId);
  const name = displayName(row?.name ?? `Card ${cardId}`);
  const kind = row?.kind ?? '';
  const isPokemon = kind.includes('Pokémon') || !!row?.hp;
  const isEnergy = kind.includes('Energy') || /Energy\b/.test(name);
  const view: CardView = {
    id: cardId,
    name,
    fullName: name,
    set: row?.set || undefined,
    setNumber: row?.setNumber || undefined,
    superType: isPokemon ? 'Pokemon' : isEnergy ? 'Energy' : 'Trainer',
    cardType: isPokemon ? energySymbolToType(row?.type) : undefined,
    trainerType: !isPokemon && !isEnergy ? kind : undefined,
    energyType: isEnergy ? energySymbolToType(row?.type || name) : undefined,
    hp: row?.hp ?? undefined,
  };
  return {
    ...view,
    imageUrl: resolveCardImageUrl(view),
  };
}

function displayName(name: string): string {
  return name
    .replaceAll('{G}', 'Grass')
    .replaceAll('{R}', 'Fire')
    .replaceAll('{W}', 'Water')
    .replaceAll('{L}', 'Lightning')
    .replaceAll('{P}', 'Psychic')
    .replaceAll('{F}', 'Fighting')
    .replaceAll('{D}', 'Darkness')
    .replaceAll('{M}', 'Metal')
    .replaceAll('{C}', 'Colorless');
}

function energySymbolToType(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  if (value.includes('{G}') || /grass/i.test(value)) return 1;
  if (value.includes('{R}') || /fire/i.test(value)) return 2;
  if (value.includes('{W}') || /water/i.test(value)) return 3;
  if (value.includes('{L}') || /lightning/i.test(value)) return 4;
  if (value.includes('{P}') || /psychic/i.test(value)) return 5;
  if (value.includes('{F}') || /fighting/i.test(value)) return 6;
  if (value.includes('{D}') || /dark/i.test(value)) return 7;
  if (value.includes('{M}') || /metal/i.test(value)) return 8;
  return 0;
}
