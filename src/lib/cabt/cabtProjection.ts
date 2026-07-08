import { resolveCardImageUrl } from '../game/cardImages';
import {
  SlotType,
  targetFor,
  type BoardSlotRef,
  type CardView,
  type DecisionOptionView,
  type DecisionView,
  type GameView,
  type LogView,
  type ActionTimelineEvent,
  type PlayerView,
  type PokemonSlotView,
} from '../game/types';
import {
  CabtAreaType,
  CabtCardType,
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
    turnSeat: turnSeatFor(current),
    logs,
    actionTimeline,
    events: [observation],
  };
}

// The turn owner is derivable: turn 1 belongs to firstPlayer and alternates.
// (During setup the engine reports turn 0; the value is meaningless there.)
function turnSeatFor(current: NonNullable<CabtObservation['current']>): number {
  return (((current.firstPlayer + current.turn - 1) % 2) + 2) % 2;
}

// The engine's select, projected 1:1 into the UI interaction contract.
// A finished game's observation still carries a (possibly empty) select;
// there is nothing to decide.
export function projectDecision(observation: CabtObservation, seq: number, dataMaps: CabtDataMaps): DecisionView | undefined {
  const select = observation.select;
  const current = observation.current;
  if (!select || !current || current.result >= 0 || !select.option.length) {
    return undefined;
  }
  const seat = current.yourIndex;
  const kind = select.type === CabtSelectType.MAIN
    ? 'main'
    : isPrizeSelectionPrompt(select)
      ? 'choose-prize'
      : isCardSelectionPrompt(observation)
        ? 'choose-cards'
        : 'choose-option';
  return {
    seq,
    seat,
    kind,
    message: kind === 'main' ? 'Main phase' : kind === 'choose-prize' ? 'Choose Prize Card' : cabtSelectLabel(select.context),
    min: select.minCount,
    max: select.maxCount,
    remaining: select.remainDamageCounter > 0
      ? select.remainDamageCounter
      : select.remainEnergyCost > 0
        ? select.remainEnergyCost
        : undefined,
    options: select.option.map((option, index) => projectOption(option, index, observation, dataMaps, seat)),
  };
}

function projectOption(
  option: CabtOption,
  index: number,
  observation: CabtObservation,
  dataMaps: CabtDataMaps,
  seat: number,
): DecisionOptionView {
  const optionCard = cardForOption(option, observation, index);
  const abilityName = option.type === CabtOptionType.ABILITY
    ? optionCard ? dataMaps.cardData[optionCard.id]?.skills?.[0]?.name : undefined
    : undefined;
  const projected: DecisionOptionView = {
    index,
    type: option.type,
    area: option.area ?? undefined,
    label: decisionOptionLabel(option, dataMaps, observation, abilityName),
    card: optionCard ? cabtCardToView(optionCard, dataMaps) : undefined,
    hand: handSourceFor(option, seat),
    boardTarget: inPlayTargetFor(option, seat),
    board: boardRefFor(option, seat),
    attached: (option.energyIndex ?? option.toolIndex) != null ? true : undefined,
    attackName: option.type === CabtOptionType.ATTACK && option.attackId
      ? dataMaps.attacks[option.attackId]?.name
      : undefined,
    abilityName,
    number: option.number ?? option.count ?? undefined,
  };
  return projected;
}

function decisionOptionLabel(
  option: CabtOption,
  dataMaps: CabtDataMaps,
  observation: CabtObservation,
  abilityName: string | undefined,
): string {
  if (option.type === CabtOptionType.RETREAT) return 'Retreat';
  if (option.type === CabtOptionType.ABILITY && abilityName) return abilityName;
  return optionLabel(option, dataMaps, observation, observation.select?.context);
}

// Main-phase options that play a card out of the acting seat's hand: PLAY /
// ATTACH / EVOLVE with a hand index (the engine may omit the HAND area).
function handSourceFor(option: CabtOption, seat: number): DecisionOptionView['hand'] {
  const playsFromHand = option.type === CabtOptionType.PLAY
    || option.type === CabtOptionType.ATTACH
    || option.type === CabtOptionType.EVOLVE;
  if (!playsFromHand || option.index === undefined || option.index === null) {
    return undefined;
  }
  if (option.area !== undefined && option.area !== null && option.area !== CabtAreaType.HAND) {
    return undefined;
  }
  return { playerIndex: option.playerIndex ?? seat, handIndex: option.index };
}

function inPlayTargetFor(option: CabtOption, seat: number): BoardSlotRef | undefined {
  if (option.inPlayArea === undefined || option.inPlayArea === null
    || option.inPlayIndex === undefined || option.inPlayIndex === null) {
    return undefined;
  }
  if (option.inPlayArea !== CabtAreaType.ACTIVE && option.inPlayArea !== CabtAreaType.BENCH) {
    return undefined;
  }
  return {
    ownerIndex: option.playerIndex ?? seat,
    slot: option.inPlayArea === CabtAreaType.BENCH ? 'bench' : 'active',
    index: option.inPlayIndex,
  };
}

function boardRefFor(option: CabtOption, seat: number): BoardSlotRef | undefined {
  if (option.area !== CabtAreaType.ACTIVE && option.area !== CabtAreaType.BENCH) {
    return undefined;
  }
  if (option.index === undefined || option.index === null) {
    return undefined;
  }
  return {
    ownerIndex: option.playerIndex ?? seat,
    slot: option.area === CabtAreaType.BENCH ? 'bench' : 'active',
    index: option.index,
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
// Only Trainer cards belong there: the engine also uses contextCard/effect to
// name an ability's source Pokemon (already on the board) or an energy being
// attached, and rendering those in the play zone duplicates them.
function playZoneForPlayer(
  select: CabtObservation['select'],
  playerIndex: number,
  dataMaps: CabtDataMaps,
): CardView[] {
  const cards = [select?.contextCard, select?.effect]
    .filter((card): card is CabtCard => !!card
      && card.playerIndex === playerIndex
      && isTrainerCardType(dataMaps.cardData[card.id]?.cardType));
  const unique = cards.filter((card, index) =>
    cards.findIndex((other) => other.serial === card.serial && other.id === card.id) === index);
  return unique.map((card) => cardToView(card, dataMaps));
}

function isTrainerCardType(cardType: number | undefined): boolean {
  return cardType !== undefined
    && cardType >= CabtCardType.ITEM
    && cardType <= CabtCardType.STADIUM;
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
  const activeAttackOptions = new Map(options
    .map((option, optionIndex) => [option, optionIndex] as const)
    .filter(([option]) =>
      option.type === CabtOptionType.ATTACK
      && typeof option.attackId === 'number'
      && (option.area === undefined || option.area === null || option.area === CabtAreaType.ACTIVE))
    .map(([option, optionIndex]) => [option.attackId as number, optionIndex]));
  const activeAbilityOption = options.findIndex((option) => option.type === CabtOptionType.ABILITY && option.area === CabtAreaType.ACTIVE);
  const benchAbilityOptions = new Map(options
    .map((option, optionIndex) => [option, optionIndex] as const)
    .filter(([option]) => option.type === CabtOptionType.ABILITY && option.area === CabtAreaType.BENCH && typeof option.index === 'number')
    .map(([option, optionIndex]) => [option.index as number, optionIndex]));
  const retreatOption = options.findIndex((option) => option.type === CabtOptionType.RETREAT);
  return {
    active: {
      attacks: activeAttacks(active, dataMaps).map((attack) => ({
        name: attack.name,
        legal: activeAttackOptions.has(attack.attackId),
        optionIndex: activeAttackOptions.get(attack.attackId),
      })),
      abilities: activeAbilityOption >= 0
        ? [{
            name: dataMaps.cardData[active?.id ?? -1]?.skills?.[0]?.name ?? 'Ability',
            legal: true,
            optionIndex: activeAbilityOption,
          }]
        : [],
      retreat: {
        legal: retreatOption >= 0,
        targets: retreatOption >= 0 ? player.bench.map((bench, index) => (bench ? index : -1)).filter((index) => index >= 0) : [],
        optionIndex: retreatOption >= 0 ? retreatOption : undefined,
      },
    },
    bench: player.bench.map((_bench, index) => ({
      index,
      abilities: benchAbilityOptions.has(index)
        ? [{
            name: dataMaps.cardData[player.bench[index]?.id ?? -1]?.skills?.[0]?.name ?? 'Ability',
            legal: true,
            optionIndex: benchAbilityOptions.get(index),
          }]
        : [],
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

// Every select context the engine can emit gets a human label; a raw
// CABT_CONTEXT_n in the UI is a bug.
function cabtSelectLabel(context: number) {
  const labels: Record<number, string> = {
    [CabtSelectContext.SETUP_ACTIVE_POKEMON]: 'Choose Active Pokemon',
    [CabtSelectContext.SETUP_BENCH_POKEMON]: 'Choose Bench Pokemon',
    [CabtSelectContext.SWITCH]: 'Choose Switch Target',
    [CabtSelectContext.TO_ACTIVE]: 'Choose Active Pokemon',
    [CabtSelectContext.TO_BENCH]: 'Choose Bench Pokemon',
    [CabtSelectContext.TO_FIELD]: 'Choose where to play',
    [CabtSelectContext.TO_HAND]: 'Choose Card',
    [CabtSelectContext.DISCARD]: 'Choose Discard',
    [CabtSelectContext.TO_DECK]: 'Choose cards for the deck',
    [CabtSelectContext.TO_DECK_BOTTOM]: 'Choose card for the bottom of the deck',
    [CabtSelectContext.TO_PRIZE]: 'Choose Prize Card',
    [CabtSelectContext.NOT_MOVE]: 'Choose cards to keep',
    [CabtSelectContext.DAMAGE_COUNTER]: 'Put damage counters',
    [CabtSelectContext.DAMAGE_COUNTER_ANY]: 'Put damage counters',
    [CabtSelectContext.DAMAGE]: 'Choose damage target',
    [CabtSelectContext.REMOVE_DAMAGE_COUNTER]: 'Remove damage counters',
    [CabtSelectContext.HEAL]: 'Choose Pokemon to heal',
    [CabtSelectContext.EVOLVES_FROM]: 'Choose Pokemon to evolve',
    [CabtSelectContext.EVOLVES_TO]: 'Choose evolution',
    [CabtSelectContext.DEVOLVE]: 'Choose Pokemon to devolve',
    [CabtSelectContext.ATTACH_FROM]: 'Choose Attachment Source',
    [CabtSelectContext.ATTACH_TO]: 'Choose Attachment Target',
    [CabtSelectContext.DETACH_FROM]: 'Choose attachment to remove',
    [CabtSelectContext.LOOK]: 'Look at cards',
    [CabtSelectContext.EFFECT_TARGET]: 'Choose a target',
    [CabtSelectContext.DISCARD_ENERGY_CARD]: 'Choose energy to discard',
    [CabtSelectContext.DISCARD_TOOL_CARD]: 'Choose Tool to discard',
    [CabtSelectContext.SWITCH_ENERGY_CARD]: 'Choose energy to move',
    [CabtSelectContext.DISCARD_CARD_OR_ATTACHED_CARD]: 'Choose card to discard',
    [CabtSelectContext.DISCARD_ENERGY]: 'Choose energy to discard',
    [CabtSelectContext.TO_HAND_ENERGY]: 'Choose energy for your hand',
    [CabtSelectContext.TO_DECK_ENERGY]: 'Choose energy for deck',
    [CabtSelectContext.SWITCH_ENERGY]: 'Choose energy to move',
    [CabtSelectContext.SKILL_ORDER]: 'Choose effect order',
    [CabtSelectContext.ATTACK]: 'Choose Attack',
    [CabtSelectContext.DISABLE_ATTACK]: 'Choose attack to disable',
    [CabtSelectContext.EVOLVE]: 'Choose evolution',
    [CabtSelectContext.DRAW_COUNT]: 'Choose cards to draw',
    [CabtSelectContext.DAMAGE_COUNTER_COUNT]: 'Choose damage counter count',
    [CabtSelectContext.REMOVE_DAMAGE_COUNTER_COUNT]: 'Choose damage counters to remove',
    [CabtSelectContext.IS_FIRST]: 'Choose Turn Order',
    [CabtSelectContext.MULLIGAN]: 'Mulligan',
    [CabtSelectContext.ACTIVATE]: 'Resolve Effect',
    [CabtSelectContext.FIRST_EFFECT]: 'Choose which effect first',
    [CabtSelectContext.MORE_DEVOLVE]: 'Devolve further?',
    [CabtSelectContext.COIN_HEAD]: 'Call the coin flip',
    [CabtSelectContext.AFFECT_SPECIAL_CONDITION]: 'Choose Special Condition',
    [CabtSelectContext.RECOVER_SPECIAL_CONDITION]: 'Choose condition to recover',
  };
  return labels[context] ?? 'Choose an option';
}

function playerName(index: number) {
  return index === 0 ? 'Player 1' : 'Player 2';
}
