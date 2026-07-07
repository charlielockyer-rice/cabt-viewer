import { resolveCardImageUrl } from '../game/cardImages';
import {
  SlotType,
  targetFor,
  type CardView,
  type GameView,
  type LogView,
  type ActionTimelineEvent,
  type PlayerView,
  type PokemonSlotView,
  type PromptView,
} from '../game/types';
import {
  CabtAreaType,
  CabtOptionType,
  CabtSelectContext,
  CabtSelectType,
  type CabtAttack,
  type CabtCard,
  type CabtCardData,
  type CabtObservation,
  type CabtOption,
  type CabtPokemon,
  type CabtSelectData,
} from './types';

// The one observation→GameView projection. Live play (engine observations +
// bridge dataMaps) uses `cabtObservationToGameView`; the replay pipeline uses
// the shared structural builders below with its own card-metadata resolvers.
// Semantic decisions — winner mapping, stadium ownership, slot geometry,
// special conditions, option→card resolution — are made here exactly once.

export type CabtDataMaps = {
  cardData: Record<number, CabtCardData>;
  attacks: Record<number, CabtAttack>;
};

// Loose card/pokemon shapes so both engine observations (CabtCard/CabtPokemon)
// and replay frames (which add `name`, and may omit fields) project through
// the same builders.
export type ProjectableCard = {
  id: number;
  serial?: number;
  playerIndex?: number;
  name?: string;
};

export type ProjectablePokemon = ProjectableCard & {
  hp?: number;
  maxHp?: number;
  energyCards?: ProjectableCard[];
  tools?: ProjectableCard[];
  preEvolution?: ProjectableCard[];
};

export type SlotResolvers = {
  cardView: (ref: ProjectableCard) => CardView;
  retreatCost: (cardId: number | undefined) => number;
};

// Engine result → GameView winner: seat index for a win, 3 for a draw.
export function projectWinner(result: number | undefined): number | undefined {
  if (result === 0 || result === 1) {
    return result;
  }
  return result === 2 ? 3 : undefined;
}

export function projectPhase(result: number | undefined): number {
  return typeof result === 'number' && result >= 0 ? 7 : 2;
}

// An unowned stadium (no playerIndex) renders on player 0's side only, so a
// shared zone never appears twice on the board.
export function stadiumForPlayer<Card extends ProjectableCard>(stadium: Card[], playerIndex: number): Card[] {
  const owned = stadium.filter((card) => card.playerIndex === playerIndex);
  if (owned.length) {
    return owned;
  }
  return playerIndex === 0
    ? stadium.filter((card) => card.playerIndex === undefined || card.playerIndex === null)
    : [];
}

export function specialConditionsFor(player: {
  poisoned?: boolean;
  burned?: boolean;
  asleep?: boolean;
  paralyzed?: boolean;
  confused?: boolean;
}): string[] {
  return [
    player.poisoned ? 'Poisoned' : null,
    player.burned ? 'Burned' : null,
    player.asleep ? 'Asleep' : null,
    player.paralyzed ? 'Paralyzed' : null,
    player.confused ? 'Confused' : null,
  ].filter((condition): condition is string => !!condition);
}

export function projectHand(
  hand: ProjectableCard[] | null,
  handCount: number,
  cardView: (ref: ProjectableCard) => CardView,
): CardView[] {
  return hand
    ? hand.map((card) => cardView(card))
    : Array.from({ length: handCount }, () => ({ name: 'Card', fullName: 'Card' }));
}

export function projectPokemonSlot(
  pokemonCard: ProjectablePokemon | null,
  ownerIndex: number,
  slot: 'active' | 'bench',
  index: number,
  activePlayerIndex: number,
  specialConditions: string[],
  resolvers: SlotResolvers,
): PokemonSlotView {
  const slotType = slot === 'active' ? SlotType.ACTIVE : SlotType.BENCH;
  const pokemonView = pokemonCard ? resolvers.cardView(pokemonCard) : undefined;
  const maxHp = pokemonCard?.maxHp ?? pokemonView?.hp ?? 0;
  const currentHp = pokemonCard?.hp ?? maxHp;
  return {
    ownerIndex,
    slot,
    index,
    target: targetFor(activePlayerIndex, ownerIndex, slotType, index),
    empty: !pokemonCard,
    pokemon: pokemonView,
    cards: pokemonView ? [pokemonView, ...(pokemonCard?.preEvolution ?? []).map((card) => resolvers.cardView(card))] : [],
    damage: Math.max(0, maxHp - currentHp),
    hp: maxHp,
    retreat: Array.from({ length: resolvers.retreatCost(pokemonCard?.id) }, () => 'Colorless'),
    energy: (pokemonCard?.energyCards ?? []).map((card) => resolvers.cardView(card)),
    tools: (pokemonCard?.tools ?? []).map((card) => resolvers.cardView(card)),
    specialConditions,
  };
}

const energyNames = [
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
];

export function cabtObservationToGameView(
  observation: CabtObservation | null,
  logs: LogView[],
  dataMaps: CabtDataMaps,
  actionTimeline: ActionTimelineEvent[] = [],
): GameView {
  const current = observation?.current;
  if (!current) {
    return {
      ready: false,
      phase: 0,
      phaseLabel: 'Waiting',
      turn: 0,
      activePlayerIndex: 0,
      players: [],
      prompts: [],
      logs,
      actionTimeline,
      events: [],
    };
  }
  const activePlayerIndex = current.yourIndex;
  const players = current.players.map((player, index) => buildPlayerView(player, index, activePlayerIndex, dataMaps, observation));
  return {
    ready: true,
    phase: projectPhase(current.result),
    phaseLabel: current.result >= 0 ? 'Finished' : 'Player turn',
    turn: current.turn,
    activePlayerIndex,
    activePlayerId: players[activePlayerIndex]?.id,
    winner: projectWinner(current.result),
    players,
    prompts: buildPrompts(observation, activePlayerIndex, dataMaps),
    logs,
    actionTimeline,
    events: [observation],
  };
}

function buildPlayerView(
  player: NonNullable<CabtObservation['current']>['players'][number],
  index: number,
  activePlayerIndex: number,
  dataMaps: CabtDataMaps,
  observation: CabtObservation,
): PlayerView {
  const resolvers: SlotResolvers = {
    cardView: (ref) => cabtCardToView(ref, dataMaps),
    retreatCost: (cardId) => (cardId === undefined ? 0 : dataMaps.cardData[cardId]?.retreatCost ?? 0),
  };
  const conditions = specialConditionsFor(player);
  return {
    index,
    id: index,
    name: playerName(index),
    hand: projectHand(player.hand, player.handCount, resolvers.cardView),
    deckCount: player.deckCount,
    discard: player.discard.map((item) => cardToView(item, dataMaps)),
    lostZone: [],
    stadium: stadiumForPlayer(observation.current?.stadium ?? [], index).map((item) => cardToView(item, dataMaps)),
    playZone: playZoneForPlayer(observation.select, index, dataMaps),
    prizesLeft: player.prize.length,
    active: projectPokemonSlot(player.active[0] ?? null, index, 'active', 0, activePlayerIndex, conditions, resolvers),
    bench: Array.from({ length: player.benchMax }, (_item, benchIndex) =>
      projectPokemonSlot(player.bench[benchIndex] ?? null, index, 'bench', benchIndex, activePlayerIndex, conditions, resolvers),
    ),
    playableCardIds: player.hand?.map((item) => item.id) ?? [],
    availableActions: buildAvailableActions(player, index, activePlayerIndex, dataMaps, observation.select),
  };
}

// The engine parks a resolving or turn-long Trainer in its Playing zone,
// exposed through the select payload as contextCard/effect. Surfacing those
// as the play zone keeps the card visible between play and eventual discard.
function playZoneForPlayer(
  select: CabtObservation['select'],
  playerIndex: number,
  dataMaps: CabtDataMaps,
): CardView[] {
  const cards = [select?.contextCard, select?.effect]
    .filter((card): card is CabtCard => !!card && card.playerIndex === playerIndex);
  const unique = cards.filter((card, index) =>
    cards.findIndex((other) => other.serial === card.serial && other.id === card.id) === index);
  return unique.map((card) => cardToView(card, dataMaps));
}

export function cabtCardToView(cardRef: ProjectableCard, dataMaps: CabtDataMaps): CardView {
  const data = dataMaps.cardData[cardRef.id];
  if (!data) {
    // id 0 is the live pipeline's unknown-card placeholder (see liveSteps.ts).
    const name = cardRef.id ? `Card ${cardRef.id}` : 'Card';
    return {
      id: cardRef.id,
      serial: cardRef.serial,
      playerIndex: cardRef.playerIndex,
      name,
      fullName: name,
    };
  }
  const view: CardView = {
    id: data.cardId,
    serial: cardRef.serial,
    playerIndex: cardRef.playerIndex,
    name: data.name,
    fullName: data.name,
    set: data.set,
    setNumber: data.setNumber,
    superType: data.cardType === 0 ? 'Pokemon' : data.cardType === 5 ? 'Energy' : 'Trainer',
    cardType: data.energyType,
    trainerType: data.cardType >= 1 && data.cardType <= 4 ? data.cardType : undefined,
    energyType: data.cardType === 5 ? data.energyType : undefined,
    stage: data.basic ? 2 : data.stage1 ? 3 : data.stage2 ? 4 : undefined,
    evolvesFrom: data.evolvesFrom ?? undefined,
    hp: data.hp,
    retreat: Array.from({ length: data.retreatCost ?? 0 }, () => 'Colorless'),
    attacks: data.attacks?.map((attackId) => dataMaps.attacks[attackId]).filter(Boolean).map((attack) => ({
      name: attack.name,
      cost: attack.energies?.map((energy) => energyNames[energy] ?? 'Colorless') ?? [],
      damage: attack.damage === undefined ? '' : String(attack.damage),
      text: attack.text,
    })),
    powers: data.skills?.map((skill) => ({ name: skill.name, text: skill.text })),
  };
  return {
    ...view,
    imageUrl: resolveCardImageUrl(view),
  };
}

function cardToView(cardRef: CabtCard, dataMaps: CabtDataMaps): CardView {
  return cabtCardToView(cardRef, dataMaps);
}

function buildPrompts(observation: CabtObservation, activePlayerIndex: number, dataMaps: CabtDataMaps): PromptView[] {
  const select = observation.select;
  if (!select || select.type === CabtSelectType.MAIN) {
    return [];
  }
  const id = promptIdForObservation(observation);
  if (isPrizeSelectionPrompt(select)) {
    return [
      {
        id,
        className: 'ChoosePrizePrompt',
        type: 'cabt-prize-select',
        playerId: activePlayerIndex,
        playerIndex: activePlayerIndex,
        supported: true,
        message: 'Choose Prize Card',
        resultSchema: 'optionIndexes',
        fields: {
          prizes: select.option.map((option, optionIndex) => {
            const optionCard = cardForOption(option, observation, optionIndex);
            return {
              index: optionIndex,
              cards: optionCard ? [cardToView(optionCard, dataMaps)] : [],
            };
          }),
          options: promptSelectionOptions(select),
          cabtSelect: select,
        },
      },
    ];
  }
  if (isCardSelectionPrompt(observation)) {
    return [
      {
        id,
        className: 'ChooseCardsPrompt',
        type: 'cabt-card-select',
        playerId: activePlayerIndex,
        playerIndex: activePlayerIndex,
        supported: true,
        message: cabtSelectLabel(select.context),
        resultSchema: 'optionIndexes',
        fields: {
          cardList: select.option.map((option, optionIndex) => {
            const optionCard = cardForOption(option, observation, optionIndex);
            const view = optionCard ? cardToView(optionCard, dataMaps) : {
              name: optionLabel(option, dataMaps, observation, select.context),
              fullName: optionLabel(option, dataMaps, observation, select.context),
            };
            return {
              ...view,
              index: optionIndex,
            };
          }),
          options: promptSelectionOptions(select),
          cabtSelect: select,
        },
      },
    ];
  }
  return [
    {
      id,
      className: 'SelectPrompt',
      type: 'cabt-select',
      playerId: activePlayerIndex,
      playerIndex: activePlayerIndex,
      supported: true,
      message: cabtSelectLabel(select.context),
      resultSchema: 'optionIndex',
      fields: {
        values: select.option.map((option) => optionLabel(option, dataMaps, observation, select.context)),
        options: promptSelectionOptions(select),
        cabtSelect: select,
      },
    },
  ];
}

function promptSelectionOptions(select: CabtSelectData) {
  const batchCount = repeatedEnergyPaymentCount(select);
  if (batchCount > select.maxCount) {
    return {
      min: Math.min(Math.max(select.minCount, batchCount), select.option.length),
      max: Math.min(batchCount, select.option.length),
    };
  }
  return {
    min: select.minCount,
    max: select.maxCount,
  };
}

function repeatedEnergyPaymentCount(select: CabtSelectData) {
  if (
    select.maxCount !== 1
    || select.remainEnergyCost <= 1
    || (select.context !== CabtSelectContext.DISCARD_ENERGY && select.context !== CabtSelectContext.DISCARD_ENERGY_CARD)
  ) {
    return 0;
  }
  return select.remainEnergyCost;
}

function isCardSelectionPrompt(observation: CabtObservation) {
  const select = observation.select;
  if (!select) {
    return false;
  }
  if (select.context === CabtSelectContext.IS_FIRST) {
    return false;
  }
  return select.option.some((option, optionIndex) => option.type === CabtOptionType.CARD || !!cardForOption(option, observation, optionIndex));
}

export function promptIdForObservation(observation: CabtObservation) {
  return hashPromptKey(JSON.stringify({
    current: observation.current,
    select: promptSelectKey(observation.select),
  }));
}

function promptSelectKey(select: CabtObservation['select']) {
  if (!select) {
    return null;
  }
  return {
    context: select.context,
    type: select.type,
    min: select.minCount,
    max: select.maxCount,
    options: select.option.map((option) => [
      option.type,
      option.area,
      option.index,
      option.playerIndex,
      option.attackId,
      option.cardId,
      option.serial,
      option.number,
    ]),
  };
}

function hashPromptKey(value: string) {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) + hash) ^ value.charCodeAt(index);
  }
  return Math.abs(hash);
}

function buildAvailableActions(
  player: NonNullable<CabtObservation['current']>['players'][number],
  playerIndex: number,
  activePlayerIndex: number,
  dataMaps: CabtDataMaps,
  select: CabtObservation['select'],
) {
  const active = player.active[0];
  const canAct = playerIndex === activePlayerIndex && select?.type === CabtSelectType.MAIN;
  const options = canAct ? select?.option ?? [] : [];
  const activeAttackIds = new Set(options
    .filter((option) =>
      option.type === CabtOptionType.ATTACK
      && (option.area === undefined || option.area === null || option.area === CabtAreaType.ACTIVE))
    .map((option) => option.attackId)
    .filter((attackId): attackId is number => typeof attackId === 'number'));
  const activeAbilityIds = new Set(options
    .filter((option) => option.type === CabtOptionType.ABILITY && option.area === CabtAreaType.ACTIVE)
    .map((option) => option.cardId)
    .filter((cardId): cardId is number => typeof cardId === 'number'));
  const benchAbilityIndexes = new Set(options
    .filter((option) => option.type === CabtOptionType.ABILITY && option.area === CabtAreaType.BENCH && typeof option.index === 'number')
    .map((option) => option.index as number));
  const retreatLegal = options.some((option) => option.type === CabtOptionType.RETREAT);
  return {
    active: {
      attacks: activeAttacks(active, dataMaps).map((attack) => ({ name: attack.name, legal: activeAttackIds.has(attack.attackId) })),
      abilities: activeAbilityIds.size ? [{ name: dataMaps.cardData[active?.id ?? -1]?.skills?.[0]?.name ?? 'Ability', legal: true }] : [],
      retreat: {
        legal: retreatLegal,
        targets: retreatLegal ? player.bench.map((bench, index) => (bench ? index : -1)).filter((index) => index >= 0) : [],
      },
    },
    bench: player.bench.map((_bench, index) => ({
      index,
      abilities: benchAbilityIndexes.has(index) ? [{ name: dataMaps.cardData[player.bench[index]?.id ?? -1]?.skills?.[0]?.name ?? 'Ability', legal: true }] : [],
    })),
  };
}

export function activeAttacks(active: CabtPokemon | null | undefined, dataMaps: CabtDataMaps) {
  return active ? (dataMaps.cardData[active.id]?.attacks ?? []).map((attackId) => dataMaps.attacks[attackId]).filter(Boolean) : [];
}

function optionLabel(option: CabtOption, dataMaps: CabtDataMaps, observation: CabtObservation, context?: number) {
  if (context === CabtSelectContext.IS_FIRST && option.type === CabtOptionType.YES) return 'Go first';
  if (context === CabtSelectContext.IS_FIRST && option.type === CabtOptionType.NO) return 'Go second';
  if (option.type === CabtOptionType.NUMBER) return numberOptionLabel(option, context);
  if (option.type === CabtOptionType.YES) return 'Yes';
  if (option.type === CabtOptionType.NO) return 'No';
  if (option.type === CabtOptionType.END) return 'End turn';
  if (option.attackId) return dataMaps.attacks[option.attackId]?.name ?? `Attack ${option.attackId}`;
  if (option.cardId) return dataMaps.cardData[option.cardId]?.name ?? `Card ${option.cardId}`;
  const optionCard = cardForOption(option, observation);
  if (optionCard) return dataMaps.cardData[optionCard.id]?.name ?? `Card ${optionCard.id}`;
  return `Option ${option.type}`;
}

function numberOptionLabel(option: CabtOption, context?: number) {
  const value = option.number ?? option.count;
  if (value === undefined || value === null) {
    return 'Number';
  }
  if (context === CabtSelectContext.DRAW_COUNT) {
    return `Draw ${value}`;
  }
  if (context === CabtSelectContext.DAMAGE_COUNTER_COUNT) {
    return `${value} damage counter${value === 1 ? '' : 's'}`;
  }
  if (context === CabtSelectContext.REMOVE_DAMAGE_COUNTER_COUNT) {
    return `Remove ${value}`;
  }
  return String(value);
}

export function cardForOption(option: CabtOption, observation: CabtObservation, optionIndex?: number): CabtCard | CabtPokemon | null {
  const area = option.area;
  const index = option.index;
  const select = observation.select;
  if (option.cardId) {
    return {
      id: option.cardId,
      playerIndex: option.playerIndex ?? observation.current?.yourIndex,
      serial: option.serial ?? undefined,
    };
  }
  if ((area === undefined || area === null) && (index === undefined || index === null) && optionIndex !== undefined) {
    return select?.deck?.[optionIndex] ?? null;
  }
  if (area === undefined || area === null || index === undefined || index === null) {
    return null;
  }
  const current = observation.current;
  if (area === CabtAreaType.DECK) {
    return select?.deck?.[index] ?? null;
  }
  if (area === CabtAreaType.STADIUM) {
    return current?.stadium[index] ?? null;
  }
  if (area === CabtAreaType.LOOKING) {
    return current?.looking?.[index] ?? null;
  }
  const playerIndex = option.playerIndex ?? current?.yourIndex;
  if (playerIndex === undefined || playerIndex === null || !current?.players[playerIndex]) {
    return null;
  }
  const player = current.players[playerIndex];
  if (area === CabtAreaType.HAND) return player.hand?.[index] ?? null;
  if (area === CabtAreaType.DISCARD) return player.discard[index] ?? null;
  if (area === CabtAreaType.ACTIVE) return attachedCardForOption(player.active[index], option) ?? player.active[index] ?? null;
  if (area === CabtAreaType.BENCH) return attachedCardForOption(player.bench[index], option) ?? player.bench[index] ?? null;
  if (area === CabtAreaType.PRIZE) return player.prize[index] ?? null;
  return null;
}

export function attachedCardForOption(pokemonCard: CabtPokemon | null | undefined, option: CabtOption) {
  if (!pokemonCard) {
    return null;
  }
  if (option.energyIndex !== undefined && option.energyIndex !== null) {
    return pokemonCard.energyCards[option.energyIndex] ?? null;
  }
  if (option.toolIndex !== undefined && option.toolIndex !== null) {
    return pokemonCard.tools[option.toolIndex] ?? null;
  }
  return null;
}

function isPrizeSelectionPrompt(select: CabtSelectData) {
  return select.context === CabtSelectContext.TO_PRIZE
    || (
      select.type === CabtSelectType.CARD
      && select.option.length > 0
      && select.option.every((option) => option.type === CabtOptionType.CARD && option.area === CabtAreaType.PRIZE)
    );
}

function cabtSelectLabel(context: number) {
  const labels: Record<number, string> = {
    [CabtSelectContext.SETUP_ACTIVE_POKEMON]: 'Choose Active Pokemon',
    [CabtSelectContext.SETUP_BENCH_POKEMON]: 'Choose Bench Pokemon',
    [CabtSelectContext.SWITCH]: 'Choose Switch Target',
    [CabtSelectContext.TO_ACTIVE]: 'Choose Active Pokemon',
    [CabtSelectContext.TO_BENCH]: 'Choose Bench Pokemon',
    [CabtSelectContext.TO_HAND]: 'Choose Card',
    [CabtSelectContext.DISCARD]: 'Choose Discard',
    [CabtSelectContext.TO_PRIZE]: 'Choose Prize Card',
    [CabtSelectContext.DISCARD_ENERGY_CARD]: 'Choose energy to discard',
    [CabtSelectContext.DISCARD_ENERGY]: 'Choose energy to discard',
    [CabtSelectContext.TO_HAND_ENERGY]: 'Choose energy for your hand',
    [CabtSelectContext.TO_DECK_ENERGY]: 'Choose energy for deck',
    [CabtSelectContext.SWITCH_ENERGY]: 'Choose energy to move',
    [CabtSelectContext.ATTACH_FROM]: 'Choose Attachment Source',
    [CabtSelectContext.ATTACH_TO]: 'Choose Attachment Target',
    [CabtSelectContext.ATTACK]: 'Choose Attack',
    [CabtSelectContext.DRAW_COUNT]: 'Choose cards to draw',
    [CabtSelectContext.DAMAGE_COUNTER_COUNT]: 'Choose damage counter count',
    [CabtSelectContext.REMOVE_DAMAGE_COUNTER_COUNT]: 'Choose damage counters to remove',
    [CabtSelectContext.IS_FIRST]: 'Choose Turn Order',
    [CabtSelectContext.MULLIGAN]: 'Mulligan',
    [CabtSelectContext.ACTIVATE]: 'Resolve Effect',
  };
  if (labels[context]) return labels[context];
  if (context === CabtSelectContext.ACTIVATE) return 'CABT_SELECT';
  return `CABT_CONTEXT_${context}`;
}

function playerName(index: number) {
  return index === 0 ? 'Player 1' : 'Player 2';
}
