export const CabtAreaType = {
  DECK: 1,
  HAND: 2,
  DISCARD: 3,
  ACTIVE: 4,
  BENCH: 5,
  PRIZE: 6,
  STADIUM: 7,
  ENERGY: 8,
  TOOL: 9,
  PRE_EVOLUTION: 10,
  PLAYER: 11,
  LOOKING: 12,
} as const;

export const CabtEnergyType = {
  COLORLESS: 0,
  GRASS: 1,
  FIRE: 2,
  WATER: 3,
  LIGHTNING: 4,
  PSYCHIC: 5,
  FIGHTING: 6,
  DARKNESS: 7,
  METAL: 8,
  DRAGON: 9,
  RAINBOW: 10,
  TEAM_ROCKET: 11,
} as const;

export const CabtCardType = {
  POKEMON: 0,
  ITEM: 1,
  TOOL: 2,
  SUPPORTER: 3,
  STADIUM: 4,
  BASIC_ENERGY: 5,
  SPECIAL_ENERGY: 6,
} as const;

export const CabtSelectType = {
  MAIN: 0,
  CARD: 1,
  ATTACHED_CARD: 2,
  CARD_OR_ATTACHED_CARD: 3,
  ENERGY: 4,
  SKILL: 5,
  ATTACK: 6,
  EVOLVE: 7,
  COUNT: 8,
  YES_NO: 9,
  SPECIAL_CONDITION: 10,
} as const;

export const CabtSelectContext = {
  MAIN: 0,
  SETUP_ACTIVE_POKEMON: 1,
  SETUP_BENCH_POKEMON: 2,
  SWITCH: 3,
  TO_ACTIVE: 4,
  TO_BENCH: 5,
  TO_FIELD: 6,
  TO_HAND: 7,
  DISCARD: 8,
  TO_DECK: 9,
  TO_DECK_BOTTOM: 10,
  TO_PRIZE: 11,
  NOT_MOVE: 12,
  DAMAGE_COUNTER: 13,
  DAMAGE_COUNTER_ANY: 14,
  DAMAGE: 15,
  REMOVE_DAMAGE_COUNTER: 16,
  HEAL: 17,
  EVOLVES_FROM: 18,
  EVOLVES_TO: 19,
  DEVOLVE: 20,
  ATTACH_FROM: 21,
  ATTACH_TO: 22,
  DETACH_FROM: 23,
  LOOK: 24,
  EFFECT_TARGET: 25,
  DISCARD_ENERGY_CARD: 26,
  DISCARD_TOOL_CARD: 27,
  SWITCH_ENERGY_CARD: 28,
  DISCARD_CARD_OR_ATTACHED_CARD: 29,
  DISCARD_ENERGY: 30,
  TO_HAND_ENERGY: 31,
  TO_DECK_ENERGY: 32,
  SWITCH_ENERGY: 33,
  SKILL_ORDER: 34,
  ATTACK: 35,
  DISABLE_ATTACK: 36,
  EVOLVE: 37,
  DRAW_COUNT: 38,
  DAMAGE_COUNTER_COUNT: 39,
  REMOVE_DAMAGE_COUNTER_COUNT: 40,
  IS_FIRST: 41,
  MULLIGAN: 42,
  ACTIVATE: 43,
  FIRST_EFFECT: 44,
  MORE_DEVOLVE: 45,
  COIN_HEAD: 46,
  AFFECT_SPECIAL_CONDITION: 47,
  RECOVER_SPECIAL_CONDITION: 48,
} as const;

export const CabtOptionType = {
  NUMBER: 0,
  YES: 1,
  NO: 2,
  CARD: 3,
  TOOL_CARD: 4,
  ENERGY_CARD: 5,
  ENERGY: 6,
  PLAY: 7,
  ATTACH: 8,
  EVOLVE: 9,
  ABILITY: 10,
  DISCARD: 11,
  RETREAT: 12,
  ATTACK: 13,
  END: 14,
  SKILL: 15,
  SPECIAL_CONDITION: 16,
} as const;

export const CabtLogType = {
  SHUFFLE: 0,
  HAS_BASIC_POKEMON: 1,
  TURN_START: 2,
  TURN_END: 3,
  DRAW: 4,
  DRAW_REVERSE: 5,
  MOVE_CARD: 6,
  MOVE_CARD_REVERSE: 7,
  SWITCH: 8,
  CHANGE: 9,
  PLAY: 10,
  ATTACH: 11,
  EVOLVE: 12,
  DEVOLVE: 13,
  MOVE_ATTACHED: 14,
  ATTACK: 15,
  HP_CHANGE: 16,
  POISONED: 17,
  BURNED: 18,
  ASLEEP: 19,
  PARALYZED: 20,
  CONFUSED: 21,
  COIN: 22,
  RESULT: 23,
} as const;

export type CabtCard = {
  id: number;
  playerIndex?: number;
  serial?: number;
};

export type CabtPokemon = CabtCard & {
  hp: number;
  maxHp: number;
  appearThisTurn: boolean;
  energies: number[];
  energyCards: CabtCard[];
  tools: CabtCard[];
  preEvolution: CabtCard[];
};

export type CabtPlayerState = {
  active: Array<CabtPokemon | null>;
  bench: CabtPokemon[];
  benchMax: number;
  deckCount: number;
  discard: CabtCard[];
  prize: Array<CabtCard | null>;
  handCount: number;
  hand: CabtCard[] | null;
  poisoned: boolean;
  burned: boolean;
  asleep: boolean;
  paralyzed: boolean;
  confused: boolean;
};

export type CabtState = {
  turn: number;
  turnActionCount: number;
  yourIndex: number;
  firstPlayer: number;
  supporterPlayed: boolean;
  stadiumPlayed: boolean;
  energyAttached: boolean;
  retreated: boolean;
  result: number;
  stadium: CabtCard[];
  looking: Array<CabtCard | null> | null;
  players: CabtPlayerState[];
};

export type CabtOption = {
  type: number;
  number?: number | null;
  area?: number | null;
  index?: number | null;
  playerIndex?: number | null;
  toolIndex?: number | null;
  energyIndex?: number | null;
  count?: number | null;
  inPlayArea?: number | null;
  inPlayIndex?: number | null;
  attackId?: number | null;
  cardId?: number | null;
  serial?: number | null;
  specialConditionType?: number | null;
};

export type CabtSelectData = {
  type: number;
  context: number;
  minCount: number;
  maxCount: number;
  remainDamageCounter: number;
  remainEnergyCost: number;
  option: CabtOption[];
  deck: CabtCard[] | null;
  contextCard: CabtCard | null;
  effect: CabtCard | null;
};

export type CabtObservation = {
  select: CabtSelectData | null;
  logs: Array<Record<string, unknown>>;
  current: CabtState | null;
  search_begin_input?: string | null;
};

export type CabtCardData = {
  cardId: number;
  name: string;
  cardType: number;
  pokemonType?: number;
  evolutionType?: number;
  retreatCost?: number;
  hp?: number;
  weakness?: number;
  resistance?: number;
  energyType?: number;
  basic?: boolean;
  stage1?: boolean;
  stage2?: boolean;
  ex?: boolean;
  megaEx?: boolean;
  tera?: boolean;
  aceSpec?: boolean;
  evolvesFrom?: string | null;
  skills?: Array<{ name: string; text?: string }>;
  attacks?: number[];
  set?: string;
  setNumber?: string;
  imageUrl?: string;
};

export type CabtAttack = {
  attackId: number;
  name: string;
  text?: string;
  damage?: number;
  energies?: number[];
};
