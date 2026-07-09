import cardRows from './cardData.generated.json';
import { resolveCardImageUrl } from '../game/cardImages';
import { classifyCard } from './cardClassify';
import type { CardView } from '../game/types';

type CardRow = {
  id: number;
  name: string;
  set: string;
  setNumber: string;
  kind: string;
  hp: number | null;
  type: string;
  cardType: number;
  energyType?: number;
  basic?: boolean;
  stage1?: boolean;
  stage2?: boolean;
};

const cardDatabase = new Map<number, CardRow>((cardRows as CardRow[]).map((card) => [card.id, card]));

export function cabtCardToView(cardId: number): CardView {
  const row = cardDatabase.get(cardId);
  const name = displayName(row?.name ?? `Card ${cardId}`);
  const view: CardView = {
    id: cardId,
    name,
    fullName: name,
    set: row?.set || undefined,
    setNumber: row?.setNumber || undefined,
    ...classifyCard({
      cardType: row?.cardType ?? -1,
      energyType: row?.energyType,
      basic: row?.basic,
      stage1: row?.stage1,
      stage2: row?.stage2,
    }),
    hp: row?.hp ?? undefined,
  };
  return {
    ...view,
    imageUrl: resolveCardImageUrl(view),
  };
}

export function displayName(name: string): string {
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
