import { CabtCardType } from './types';

// THE one card classifier. Live play (cabtProjection), replay (cabtReplay), and
// the animation sprite builder (cardView) all route their card-metadata through
// classifyCard so a card id yields ONE answer everywhere. Two thin data adapters
// feed it: live passes the bridge's numeric CabtCardData, replay/animation pass
// the generated card rows — both expose the same numeric facts below.
//
// The category code table (`cardType`) is authoritative, derived empirically
// from the generated card DB (all 1,267 cards carry both a numeric cardType and
// a descriptive `kind`) and cross-checked against agent-lab/pokemath/cards.py:
//
//   0  Pokemon        (Basic / Stage 1 / Stage 2 Pokémon)   -> superType Pokemon
//   1  Item                                                  -> superType Trainer
//   2  Pokémon Tool                                          -> superType Trainer
//   3  Supporter                                             -> superType Trainer
//   4  Stadium                                               -> superType Trainer
//   5  Basic Energy                                          -> superType Energy
//   6  Special Energy                                        -> superType Energy
//
// Special Energy IS Energy (Charlie's ruling; agrees with cards.py and with the
// deck-import path, which already treats codes 5 and 6 as energy). The former
// live mapping mistook code 6 for a Trainer; the former kind-string heuristics
// mistook some Items/Tools for Pokemon. classifyCard fixes both by construction.

// The metadata a card classification needs, independent of source shape. Live
// fills this from CabtCardData, replay/animation from the generated card rows.
export type CardClassifyMeta = {
  cardType: number;      // authoritative category code, 0..6 (table above)
  energyType?: number;   // CabtEnergyType numeric (0 Colorless .. 9 Dragon ..)
  basic?: boolean;
  stage1?: boolean;
  stage2?: boolean;
};

// Canonical encodings, chosen from the actual consumers:
//   superType  -> descriptive string ('Pokemon' | 'Energy' | 'Trainer'); App and
//                 CardTile compare against these strings.
//   trainerType-> descriptive string; motions.ts special-cases 'Stadium'.
//   stage      -> descriptive string; the only consumer checks presence, and the
//                 strings are what a card viewer would show.
//   cardType   -> numeric energy/type of a Pokemon (its type ring); undefined for
//                 non-Pokemon. energyIcons.normalizedTypeName takes the number.
//   energyType -> numeric type of an Energy card; undefined for non-Energy.
export type CardClassification = {
  superType: 'Pokemon' | 'Energy' | 'Trainer';
  cardType: number | undefined;
  trainerType: string | undefined;
  energyType: number | undefined;
  stage: 'Basic' | 'Stage 1' | 'Stage 2' | undefined;
};

const TRAINER_TYPE_LABEL: Record<number, string> = {
  [CabtCardType.ITEM]: 'Item',
  [CabtCardType.TOOL]: 'Pokémon Tool',
  [CabtCardType.SUPPORTER]: 'Supporter',
  [CabtCardType.STADIUM]: 'Stadium',
};

export function isPokemonType(cardType: number): boolean {
  return cardType === CabtCardType.POKEMON;
}

export function isEnergyType(cardType: number): boolean {
  return cardType === CabtCardType.BASIC_ENERGY || cardType === CabtCardType.SPECIAL_ENERGY;
}

export function classifyCard(meta: CardClassifyMeta): CardClassification {
  const { cardType } = meta;
  const pokemon = isPokemonType(cardType);
  const energy = isEnergyType(cardType);
  return {
    superType: pokemon ? 'Pokemon' : energy ? 'Energy' : 'Trainer',
    cardType: pokemon ? meta.energyType : undefined,
    trainerType: TRAINER_TYPE_LABEL[cardType],
    energyType: energy ? meta.energyType : undefined,
    stage: meta.basic ? 'Basic' : meta.stage1 ? 'Stage 1' : meta.stage2 ? 'Stage 2' : undefined,
  };
}
