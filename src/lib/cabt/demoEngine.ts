import { activeAttacks, cabtObservationToGameView, type CabtDataMaps } from './cabtProjection';
import { SlotType, type CardTarget, type EngineResponse, type GameView, type LogView } from '../game/types';
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
    return cabtObservationToGameView(this.observation, this.logs, DEMO_CABT_DATA);
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
      ...activeAttacks(player.active[0], DEMO_CABT_DATA).map((attack) => ({
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
