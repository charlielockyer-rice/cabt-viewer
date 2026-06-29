import cardRows from './cardData.generated.json';
import attackRows from './attackData.generated.json';
import { resolveCardImageUrl } from '../game/cardImages';
import type { CardView } from '../game/types';

export type CabtReplayCardRef = {
  id: number;
  serial?: number;
  playerIndex?: number;
  name?: string;
};

type CardRow = {
  id: number;
  name: string;
  set: string;
  setNumber: string;
  kind: string;
  rule: string;
  evolvesFrom: string;
  hp: number | null;
  type: string;
  retreat: number | null;
  attackName: string;
  attackCost: string;
  attackDamage: string;
  attackText: string;
  retreatCost?: number;
  skills?: Array<{ name: string; text?: string }>;
  attacks?: number[];
};

type AttackRow = {
  attackId: number;
  name: string;
  text?: string;
  damage?: number;
  energies?: number[];
};

const cardDatabase = new Map<number, CardRow>((cardRows as CardRow[]).map((card) => [card.id, card]));
const attackDatabase = new Map<number, AttackRow>((attackRows as AttackRow[]).map((attack) => [attack.attackId, attack]));

export function cabtCardNames(): string[] {
  return [...new Set([...cardDatabase.values()].map((card) => card.name))];
}

export function cabtCardToView(cardRef: CabtReplayCardRef): CardView {
  const data = cardDatabase.get(cardRef.id);
  const rawName = cardRef.name || data?.name || `Card ${cardRef.id}`;
  const name = cabtDisplayName(rawName);
  const kind = data?.kind ?? '';
  const isPokemon = kind.includes('Pokémon') || !!data?.hp;
  const isEnergy = kind.includes('Energy') || /Energy\b/.test(rawName);
  const isTrainer = !isPokemon && !isEnergy;
  const view: CardView = {
    id: cardRef.id,
    serial: cardRef.serial,
    playerIndex: cardRef.playerIndex,
    name,
    fullName: name,
    set: data?.set || undefined,
    setNumber: data?.setNumber || undefined,
    superType: isPokemon ? 'Pokemon' : isEnergy ? 'Energy' : 'Trainer',
    cardType: isPokemon ? energySymbolToType(data?.type) : undefined,
    trainerType: isTrainer ? kind : undefined,
    energyType: isEnergy ? energySymbolToType(data?.type || rawName) : undefined,
    stage: stageLabel(kind),
    evolvesFrom: data?.evolvesFrom || undefined,
    hp: data?.hp ?? undefined,
    retreat: Array.from({ length: retreatCostFor(data) }, () => 'Colorless'),
    powers: powersForCard(data),
    attacks: attacksForCard(data),
  };
  return {
    ...view,
    imageUrl: resolveCardImageUrl(view),
  };
}

export function cabtFaceDownCard(): CardView {
  return {
    name: 'Card',
    fullName: 'Card',
  };
}

export function cabtCardName(id: number): string {
  return cabtDisplayName(cardDatabase.get(id)?.name ?? (Number.isFinite(id) ? `Card ${id}` : 'a card'));
}

export function cabtAbilityNameForCardId(cardId: number): string {
  const data = cardDatabase.get(cardId);
  const skillName = data?.skills?.find((skill) => skill.name.trim())?.name.trim();
  return skillName ? cabtDisplayName(skillName) : 'an Ability';
}

export function cabtEvolutionTriggeredDrawSkill(cardId: number): { name: string; drawCount: number } | null {
  for (const skill of cardDatabase.get(cardId)?.skills ?? []) {
    const text = normalizedAbilityText(skill.text);
    if (!text.includes('when you play this pokemon from your hand to evolve')) {
      continue;
    }
    const drawCount = Number(text.match(/\bdraw\s+(\d+)\s+cards?\b/)?.[1]);
    if (Number.isFinite(drawCount) && drawCount > 0 && skill.name.trim()) {
      return { name: skill.name, drawCount };
    }
  }
  return null;
}

export function cabtRetreatCost(cardId: number | undefined): number {
  return retreatCostFor(cardDatabase.get(cardId ?? -1));
}

export function isCabtStadiumCard(cardId: number): boolean {
  return cardDatabase.get(cardId)?.kind === 'Stadium';
}

export function isCabtPokemonCard(cardId: number): boolean {
  const card = cardDatabase.get(cardId);
  return !!card && (card.kind.includes('Pokémon') || card.hp !== null);
}

export function isCabtToolCard(cardId: number): boolean {
  return cardDatabase.get(cardId)?.kind === 'Tool';
}

export function isCabtResolvingTrainerCard(cardId: number): boolean {
  const kind = cardDatabase.get(cardId)?.kind ?? '';
  return kind === 'Item' || kind === 'Supporter';
}

export function cabtDisplayName(name: string): string {
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

function powersForCard(data: CardRow | undefined): CardView['powers'] {
  const skills = data?.skills?.filter((skill) => skill.name.trim());
  if (!skills?.length) {
    return undefined;
  }
  return skills.map((skill) => ({
    name: cabtDisplayName(skill.name.trim()),
    text: skill.text ?? '',
  }));
}

function attacksForCard(data: CardRow | undefined): CardView['attacks'] {
  if (!data) {
    return undefined;
  }
  const engineAttacks = data.attacks
    ?.map((attackId) => attackDatabase.get(attackId))
    .filter((attack): attack is AttackRow => !!attack);
  if (engineAttacks?.length) {
    return engineAttacks.map((attack) => ({
      name: cabtDisplayName(attack.name),
      cost: (attack.energies ?? []).map(energyName),
      damage: attack.damage ? String(attack.damage) : '',
      text: attack.text ?? '',
    }));
  }
  if (!data.attackName) {
    return undefined;
  }
  return [{
    name: data.attackName,
    cost: energyCostLabels(data.attackCost),
    damage: data.attackDamage,
    text: data.attackText,
  }];
}

function retreatCostFor(data: CardRow | undefined): number {
  return data?.retreat ?? data?.retreatCost ?? 0;
}

function normalizedAbilityText(text: string | undefined): string {
  return (text ?? '')
    .toLowerCase()
    .replaceAll('é', 'e')
    .replaceAll(/\s+/g, ' ')
    .trim();
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

function energyCostLabels(cost: string): string[] {
  return [...cost.matchAll(/\{([A-Z])\}/g)].map((match) => cabtDisplayName(`{${match[1]}}`));
}

function energyName(energy: number): string {
  return [
    'Colorless',
    'Grass',
    'Fire',
    'Water',
    'Lightning',
    'Psychic',
    'Fighting',
    'Darkness',
    'Metal',
    'Dragon',
    'Rainbow',
    'Team Rocket',
  ][energy] ?? 'Colorless';
}

function stageLabel(kind: string): string | undefined {
  if (kind.includes('Basic Pokémon')) return 'Basic';
  if (kind.includes('Stage 1')) return 'Stage 1';
  if (kind.includes('Stage 2')) return 'Stage 2';
  return undefined;
}
