import { resolveCardImageUrl } from '../game/cardImages';
import {
  SlotType,
  targetFor,
  type CardTarget,
  type CardView,
  type EngineResponse,
  type GameView,
  type LogView,
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
} from './types';

type Command = {
  type: string;
  payload?: any;
};

export type CabtDataMaps = {
  cardData: Record<number, CabtCardData>;
  attacks: Record<number, CabtAttack>;
};

const cardData: Record<number, CabtCardData> = {
  4: {
    cardId: 4,
    name: 'Charizard',
    cardType: 0,
    hp: 120,
    energyType: 2,
    stage2: true,
    retreatCost: 3,
    attacks: [1001, 1002],
    set: 'BASE',
    setNumber: '4',
  },
  25: {
    cardId: 25,
    name: 'Pikachu',
    cardType: 0,
    hp: 60,
    energyType: 4,
    basic: true,
    retreatCost: 1,
    attacks: [1003],
    set: 'BASE',
    setNumber: '58',
  },
  133: {
    cardId: 133,
    name: 'Eevee',
    cardType: 0,
    hp: 60,
    energyType: 0,
    basic: true,
    retreatCost: 1,
    attacks: [1004],
    set: 'SFA',
    setNumber: '50',
  },
  278: {
    cardId: 278,
    name: 'Charmander',
    cardType: 0,
    hp: 70,
    energyType: 2,
    basic: true,
    retreatCost: 1,
    attacks: [1005],
    set: 'MEG',
    setNumber: '11',
  },
  7: {
    cardId: 7,
    name: 'Fire Energy',
    cardType: 5,
    energyType: 2,
    set: 'SVE',
    setNumber: '2',
  },
  8: {
    cardId: 8,
    name: 'Lightning Energy',
    cardType: 5,
    energyType: 4,
    set: 'SVE',
    setNumber: '4',
  },
  9001: {
    cardId: 9001,
    name: 'Professor Research',
    cardType: 3,
    set: 'MEG',
    setNumber: '132',
  },
  9002: {
    cardId: 9002,
    name: 'Nest Ball',
    cardType: 1,
    set: 'SVI',
    setNumber: '181',
  },
};

const attacks: Record<number, CabtAttack> = {
  1001: { attackId: 1001, name: 'Slash', damage: 60, energies: [0, 0] },
  1002: { attackId: 1002, name: 'Fire Spin', damage: 100, text: 'Discard 2 Energy from this Pokemon.', energies: [2, 2, 0, 0] },
  1003: { attackId: 1003, name: 'Thunder Jolt', damage: 30, energies: [4] },
  1004: { attackId: 1004, name: 'Quick Attack', damage: 20, energies: [0] },
  1005: { attackId: 1005, name: 'Ember', damage: 30, energies: [2] },
};

export const DEMO_CABT_DATA: CabtDataMaps = {
  cardData,
  attacks,
};

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

let serial = 1;

export class CabtDemoController {
  private observation: CabtObservation | null = null;
  private logs: LogView[] = [];
  private logId = 1;

  async handle(command: Command): Promise<EngineResponse> {
    switch (command.type) {
      case 'startGame':
      case 'state':
        if (!this.observation || command.type === 'startGame') {
          this.start();
        }
        break;
      case 'playCard':
        this.playCard(command.payload?.playerIndex, command.payload?.handIndex, command.payload?.target);
        break;
      case 'attack':
        this.attack(command.payload?.playerIndex, command.payload?.attack);
        break;
      case 'retreat':
        this.retreat(command.payload?.playerIndex, command.payload?.to);
        break;
      case 'passTurn':
        this.passTurn();
        break;
      case 'concede':
        this.concede(command.payload?.playerIndex);
        break;
      case 'resolvePrompt':
        this.resolvePrompt(command.payload?.result);
        break;
      default:
        return { ok: false, error: `Unsupported command: ${command.type}`, view: this.view() };
    }
    return { ok: true, view: this.view() };
  }

  private start() {
    serial = 1;
    this.logs = [];
    this.logId = 1;
    this.observation = {
      logs: [],
      current: {
        turn: 1,
        turnActionCount: 0,
        yourIndex: 0,
        firstPlayer: 0,
        supporterPlayed: false,
        stadiumPlayed: false,
        energyAttached: false,
        retreated: false,
        result: -1,
        stadium: [],
        looking: null,
        players: [
          {
            active: [pokemon(278, 0, { energyCards: [card(7, 0)] })],
            bench: [pokemon(133, 0)],
            benchMax: 5,
            deckCount: 47,
            discard: [],
            prize: [null, null, null, null, null, null],
            handCount: 4,
            hand: [card(7, 0), card(9002, 0), card(9001, 0), card(133, 0)],
            poisoned: false,
            burned: false,
            asleep: false,
            paralyzed: false,
            confused: false,
          },
          {
            active: [pokemon(25, 1, { energyCards: [card(8, 1)] })],
            bench: [pokemon(133, 1)],
            benchMax: 5,
            deckCount: 47,
            discard: [],
            prize: [null, null, null, null, null, null],
            handCount: 3,
            hand: null,
            poisoned: false,
            burned: false,
            asleep: false,
            paralyzed: false,
            confused: false,
          },
        ],
      },
      select: null,
      search_begin_input: 'demo-cabt-search-input',
    };
    this.observation.select = this.mainSelect(0);
    this.pushLog('CABT demo battle started. This view is using the CABT observation adapter scaffold.');
  }

  private playCard(playerIndex: number, handIndex: number, target: CardTarget) {
    const current = this.requireCurrent();
    const player = current.players[playerIndex];
    const hand = player?.hand;
    const played = hand?.[handIndex];
    if (!player || !hand || !played) {
      return;
    }
    hand.splice(handIndex, 1);
    player.handCount = hand.length;
    const data = cardData[played.id];
    const targetSlot = target.slot === SlotType.BENCH ? player.bench[target.index] : player.active[0];
    if (data?.cardType === 5 && targetSlot) {
      targetSlot.energyCards.push(played);
      targetSlot.energies.push(data.energyType ?? 0);
      current.energyAttached = true;
      this.pushLog(`${playerName(playerIndex)} attached ${data.name}.`);
    } else if (data?.cardType === 0 && target.slot === SlotType.BENCH) {
      player.bench[target.index] = pokemon(played.id, playerIndex);
      this.pushLog(`${playerName(playerIndex)} benched ${data.name}.`);
    } else {
      player.discard.push(played);
      current.supporterPlayed ||= data?.cardType === 3;
      this.pushLog(`${playerName(playerIndex)} played ${data?.name ?? `Card ${played.id}`}.`);
      this.openCabtSelectPrompt();
      return;
    }
    current.turnActionCount += 1;
    this.refreshMainSelect();
  }

  private attack(playerIndex: number, attackName: string) {
    const current = this.requireCurrent();
    const attacker = current.players[playerIndex]?.active[0];
    const defender = current.players[1 - playerIndex]?.active[0];
    const attack = Object.values(attacks).find((item) => item.name === attackName);
    if (!attacker || !defender || !attack) {
      return;
    }
    defender.hp = Math.max(0, defender.hp - (attack.damage ?? 0));
    this.pushLog(`${playerName(playerIndex)} used ${attack.name} for ${attack.damage ?? 0} damage.`);
    if (defender.hp === 0) {
      current.result = playerIndex;
      this.pushLog(`${playerName(playerIndex)} wins the demo battle.`);
      this.observation!.select = null;
    } else {
      this.passTurn();
    }
  }

  private retreat(playerIndex: number, to: number) {
    const current = this.requireCurrent();
    const player = current.players[playerIndex];
    const bench = player?.bench[to];
    const active = player?.active[0];
    if (!player || !bench || !active) {
      return;
    }
    player.active = [bench];
    player.bench[to] = active;
    current.retreated = true;
    this.pushLog(`${playerName(playerIndex)} retreated to ${cardData[bench.id]?.name ?? 'the Bench'}.`);
    this.refreshMainSelect();
  }

  private passTurn() {
    const current = this.requireCurrent();
    current.yourIndex = 1 - current.yourIndex;
    current.turn += current.yourIndex === current.firstPlayer ? 1 : 0;
    current.turnActionCount = 0;
    current.energyAttached = false;
    current.supporterPlayed = false;
    current.stadiumPlayed = false;
    current.retreated = false;
    this.pushLog(`${playerName(current.yourIndex)} is now active.`);
    this.refreshMainSelect();
  }

  private concede(playerIndex: number) {
    const current = this.requireCurrent();
    current.result = 1 - playerIndex;
    this.observation!.select = null;
    this.pushLog(`${playerName(playerIndex)} conceded.`);
  }

  private resolvePrompt(result: unknown) {
    const chosen = Array.isArray(result) ? result.join(', ') : String(result);
    this.pushLog(`Resolved CABT select prompt with ${chosen}.`);
    this.refreshMainSelect();
  }

  private view(): GameView {
    return cabtObservationToGameView(this.observation, this.logs);
  }

  private requireCurrent() {
    if (!this.observation?.current) {
      this.start();
    }
    return this.observation!.current!;
  }

  private refreshMainSelect() {
    const current = this.requireCurrent();
    this.observation!.select = current.result >= 0 ? null : this.mainSelect(current.yourIndex);
  }

  private mainSelect(playerIndex: number) {
    const player = this.requireCurrent().players[playerIndex];
    const options: CabtOption[] = [
      ...(player.hand ?? []).map((item, index) => ({
        type: cardData[item.id]?.cardType === 5 ? CabtOptionType.ATTACH : CabtOptionType.PLAY,
        area: CabtAreaType.HAND,
        index,
        playerIndex,
        cardId: item.id,
        serial: item.serial,
      })),
      {
        type: CabtOptionType.RETREAT,
        area: CabtAreaType.ACTIVE,
        index: 0,
        playerIndex,
      },
      ...activeAttacks(player.active[0]).map((attack) => ({
        type: CabtOptionType.ATTACK,
        area: CabtAreaType.ACTIVE,
        index: 0,
        playerIndex,
        attackId: attack.attackId,
      })),
      { type: CabtOptionType.END },
    ];
    return {
      type: CabtSelectType.MAIN,
      context: CabtSelectContext.MAIN,
      minCount: 1,
      maxCount: 1,
      remainDamageCounter: 0,
      remainEnergyCost: 0,
      option: options,
      deck: null,
      contextCard: null,
      effect: null,
    };
  }

  private openCabtSelectPrompt() {
    this.observation!.select = {
      type: CabtSelectType.YES_NO,
      context: CabtSelectContext.ACTIVATE,
      minCount: 1,
      maxCount: 1,
      remainDamageCounter: 0,
      remainEnergyCost: 0,
      option: [
        { type: CabtOptionType.YES },
        { type: CabtOptionType.NO },
      ],
      deck: null,
      contextCard: null,
      effect: null,
    };
  }

  private pushLog(message: string) {
    this.logs = [...this.logs, { id: this.logId++, message }];
  }
}

export function cabtObservationToGameView(
  observation: CabtObservation | null,
  logs: LogView[],
  dataMaps: CabtDataMaps = DEMO_CABT_DATA,
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
      events: [],
    };
  }
  const activePlayerIndex = current.yourIndex;
  const players = current.players.map((player, index) => buildPlayerView(player, index, activePlayerIndex, dataMaps, observation));
  return {
    ready: true,
    phase: current.result >= 0 ? 7 : 2,
    phaseLabel: current.result >= 0 ? 'Finished' : 'Player turn',
    turn: current.turn,
    activePlayerIndex,
    activePlayerId: players[activePlayerIndex]?.id,
    winner: current.result >= 0 ? current.result : undefined,
    players,
    prompts: buildPrompts(observation, activePlayerIndex, dataMaps),
    logs,
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
  return {
    index,
    id: index,
    name: playerName(index),
    hand: player.hand
      ? player.hand.map((item) => cardToView(item, dataMaps))
      : Array.from({ length: player.handCount }, () => ({ name: 'Card', fullName: 'Card' })),
    deckCount: player.deckCount,
    discard: player.discard.map((item) => cardToView(item, dataMaps)),
    lostZone: [],
    stadium: stadiumForPlayer(observation.current?.stadium ?? [], index).map((item) => cardToView(item, dataMaps)),
    playZone: [],
    prizesLeft: player.prize.length,
    active: pokemonToSlot(player.active[0] ?? null, index, 'active', 0, activePlayerIndex, player, dataMaps),
    bench: Array.from({ length: player.benchMax }, (_item, benchIndex) =>
      pokemonToSlot(player.bench[benchIndex] ?? null, index, 'bench', benchIndex, activePlayerIndex, player, dataMaps),
    ),
    playableCardIds: player.hand?.map((item) => item.id) ?? [],
    availableActions: buildAvailableActions(player, index, activePlayerIndex, dataMaps, observation.select),
  };
}

function stadiumForPlayer(stadium: CabtCard[], playerIndex: number) {
  const owned = stadium.filter((item) => item.playerIndex === playerIndex);
  return owned.length ? owned : stadium.filter((item) => item.playerIndex === undefined || item.playerIndex === null);
}

function pokemonToSlot(
  pokemonCard: CabtPokemon | null,
  ownerIndex: number,
  slot: 'active' | 'bench',
  index: number,
  activePlayerIndex: number,
  player: NonNullable<CabtObservation['current']>['players'][number],
  dataMaps: CabtDataMaps,
): PokemonSlotView {
  const slotType = slot === 'active' ? SlotType.ACTIVE : SlotType.BENCH;
  const specialConditions = [
    player.poisoned ? 'Poisoned' : null,
    player.burned ? 'Burned' : null,
    player.asleep ? 'Asleep' : null,
    player.paralyzed ? 'Paralyzed' : null,
    player.confused ? 'Confused' : null,
  ].filter(Boolean);
  const pokemonView = pokemonCard ? cardToView(pokemonCard, dataMaps) : undefined;
  return {
    ownerIndex,
    slot,
    index,
    target: targetFor(activePlayerIndex, ownerIndex, slotType, index),
    empty: !pokemonCard,
    pokemon: pokemonView,
    cards: pokemonView ? [pokemonView, ...pokemonCard!.preEvolution.map((item) => cardToView(item, dataMaps))] : [],
    damage: pokemonCard ? Math.max(0, pokemonCard.maxHp - pokemonCard.hp) : 0,
    hp: pokemonCard?.maxHp ?? 0,
    retreat: retreatCost(pokemonCard, dataMaps),
    energy: pokemonCard?.energyCards.map((item) => cardToView(item, dataMaps)) ?? [],
    tools: pokemonCard?.tools.map((item) => cardToView(item, dataMaps)) ?? [],
    specialConditions,
  };
}

function cardToView(cardRef: CabtCard, dataMaps: CabtDataMaps): CardView {
  const data = dataMaps.cardData[cardRef.id];
  if (!data) {
    return {
      id: cardRef.id,
      name: `Card ${cardRef.id}`,
      fullName: `Card ${cardRef.id}`,
    };
  }
  const view: CardView = {
    id: data.cardId,
    name: data.name,
    fullName: data.name,
    set: data.set,
    setNumber: data.setNumber,
    superType: data.cardType === 0 ? 'Pokemon' : data.cardType === 5 ? 'Energy' : 'Trainer',
    cardType: data.energyType,
    trainerType: data.cardType === 1 || data.cardType === 3 || data.cardType === 4 ? data.cardType : undefined,
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

function buildPrompts(observation: CabtObservation, activePlayerIndex: number, dataMaps: CabtDataMaps): PromptView[] {
  const select = observation.select;
  if (!select || select.type === CabtSelectType.MAIN) {
    return [];
  }
  const id = promptIdForSelect(select);
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
            const optionCard = cardForOption(option, observation);
            const view = optionCard ? cardToView(optionCard, dataMaps) : {
              name: optionLabel(option, dataMaps, observation, select.context),
              fullName: optionLabel(option, dataMaps, observation, select.context),
            };
            return {
              ...view,
              index: optionIndex,
            };
          }),
          options: {
            min: select.minCount,
            max: select.maxCount,
          },
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
        options: {
          min: select.minCount,
          max: select.maxCount,
        },
        cabtSelect: select,
      },
    },
  ];
}

function isCardSelectionPrompt(observation: CabtObservation) {
  const select = observation.select;
  if (!select) {
    return false;
  }
  if (select.context === CabtSelectContext.IS_FIRST) {
    return false;
  }
  return select.option.some((option) => option.type === CabtOptionType.CARD || !!cardForOption(option, observation));
}

function promptIdForSelect(select: NonNullable<CabtObservation['select']>) {
  return hashPromptKey(JSON.stringify({
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
  }));
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

function activeAttacks(active: CabtPokemon | null | undefined, dataMaps: CabtDataMaps = DEMO_CABT_DATA) {
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

function cardForOption(option: CabtOption, observation: CabtObservation): CabtCard | CabtPokemon | null {
  const area = option.area;
  const index = option.index;
  if (area === undefined || area === null || index === undefined || index === null) {
    return null;
  }
  const current = observation.current;
  const select = observation.select;
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

function attachedCardForOption(pokemonCard: CabtPokemon | null | undefined, option: CabtOption) {
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

function cabtSelectLabel(context: number) {
  const labels: Record<number, string> = {
    [CabtSelectContext.SETUP_ACTIVE_POKEMON]: 'Choose Active Pokemon',
    [CabtSelectContext.SETUP_BENCH_POKEMON]: 'Choose Bench Pokemon',
    [CabtSelectContext.SWITCH]: 'Choose Switch Target',
    [CabtSelectContext.TO_ACTIVE]: 'Choose Active Pokemon',
    [CabtSelectContext.TO_BENCH]: 'Choose Bench Pokemon',
    [CabtSelectContext.TO_HAND]: 'Choose Card',
    [CabtSelectContext.DISCARD]: 'Choose Discard',
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

function retreatCost(pokemonCard: CabtPokemon | null | undefined, dataMaps: CabtDataMaps = DEMO_CABT_DATA) {
  return Array.from({ length: pokemonCard ? (dataMaps.cardData[pokemonCard.id]?.retreatCost ?? 0) : 0 }, () => 'Colorless');
}

function pokemon(id: number, playerIndex: number, partial: Partial<CabtPokemon> = {}): CabtPokemon {
  const data = cardData[id];
  return {
    ...card(id, playerIndex),
    hp: partial.maxHp ?? data?.hp ?? 60,
    maxHp: data?.hp ?? 60,
    appearThisTurn: false,
    energies: partial.energyCards?.map((item) => cardData[item.id]?.energyType ?? 0) ?? [],
    energyCards: [],
    tools: [],
    preEvolution: [],
    ...partial,
  };
}

function card(id: number, playerIndex: number): CabtCard {
  return {
    id,
    playerIndex,
    serial: serial++,
  };
}

function playerName(index: number) {
  return index === 0 ? 'Player 1' : 'Player 2';
}
