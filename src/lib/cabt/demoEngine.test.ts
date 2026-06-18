import { describe, expect, it } from 'vitest';
import { cabtObservationToGameView } from './demoEngine';
import type { CabtDataMaps } from './demoEngine';
import { CabtAreaType, CabtCardType, CabtOptionType, CabtSelectContext, CabtSelectType } from './types';
import type { CabtObservation } from './types';

describe('cabtObservationToGameView', () => {
  it('surfaces the global CABT stadium on the owning player view', () => {
    const dataMaps: CabtDataMaps = {
      cardData: {
        1261: {
          cardId: 1261,
          name: 'Forest of Vitality',
          cardType: 4,
          set: 'MEG',
          setNumber: '117',
        },
      },
      attacks: {},
    };
    const observation = {
      select: null,
      logs: [],
      current: {
        turn: 0,
        turnActionCount: 0,
        yourIndex: 0,
        firstPlayer: 0,
        supporterPlayed: false,
        stadiumPlayed: true,
        energyAttached: false,
        retreated: false,
        result: -1,
        stadium: [{ id: 1261, serial: 49, playerIndex: 0 }],
        looking: null,
        players: [
          player(),
          player(),
        ],
      },
    } satisfies CabtObservation;

    const view = cabtObservationToGameView(observation, [], dataMaps);

    expect(view.players[0]?.stadium[0]?.name).toBe('Forest of Vitality');
    expect(view.players[1]?.stadium).toEqual([]);
  });

  it('marks active attacks legal when CABT omits the active area on attack options', () => {
    const dataMaps: CabtDataMaps = {
      cardData: {
        655: {
          cardId: 655,
          name: 'Celebi',
          cardType: CabtCardType.POKEMON,
          basic: true,
          hp: 80,
          attacks: [945, 946],
        },
      },
      attacks: {
        945: { attackId: 945, name: 'Traverse Time', energies: [1] },
        946: { attackId: 946, name: 'Solar Cutter', energies: [1], damage: 30 },
      },
    };
    const observation = {
      select: {
        type: CabtSelectType.MAIN,
        context: CabtSelectContext.MAIN,
        minCount: 1,
        maxCount: 1,
        remainDamageCounter: 0,
        remainEnergyCost: 0,
        option: [
          { type: CabtOptionType.ATTACK, attackId: 945 },
          { type: CabtOptionType.ATTACK, attackId: 946 },
        ],
        deck: null,
        contextCard: null,
        effect: null,
      },
      logs: [],
      current: {
        turn: 1,
        turnActionCount: 0,
        yourIndex: 0,
        firstPlayer: 1,
        supporterPlayed: false,
        stadiumPlayed: false,
        energyAttached: true,
        retreated: false,
        result: -1,
        stadium: [],
        looking: null,
        players: [
          { ...player(), active: [{ id: 655, hp: 80, maxHp: 80, appearThisTurn: false, energies: [1], energyCards: [], tools: [], preEvolution: [] }] },
          player(),
        ],
      },
    } satisfies CabtObservation;

    const view = cabtObservationToGameView(observation, [], dataMaps);

    expect(view.players[0]?.availableActions?.active?.attacks).toEqual([
      expect.objectContaining({ name: 'Traverse Time', legal: true }),
      expect.objectContaining({ name: 'Solar Cutter', legal: true }),
    ]);
  });

  it('renders attached energy cards for CABT discard-energy prompts', () => {
    const dataMaps: CabtDataMaps = {
      cardData: {
        1: {
          cardId: 1,
          name: 'Basic {G} Energy',
          cardType: CabtCardType.BASIC_ENERGY,
          energyType: 1,
          set: 'SVE',
          setNumber: '1',
        },
        655: {
          cardId: 655,
          name: 'Celebi',
          cardType: CabtCardType.POKEMON,
          basic: true,
          hp: 80,
        },
      },
      attacks: {},
    };
    const observation = {
      select: {
        type: CabtSelectType.CARD,
        context: CabtSelectContext.DISCARD_ENERGY,
        minCount: 1,
        maxCount: 1,
        remainDamageCounter: 0,
        remainEnergyCost: 0,
        option: [
          { type: CabtOptionType.ENERGY_CARD, area: CabtAreaType.ACTIVE, index: 0, energyIndex: 0, playerIndex: 0 },
        ],
        deck: null,
        contextCard: null,
        effect: null,
      },
      logs: [],
      current: {
        turn: 1,
        turnActionCount: 0,
        yourIndex: 0,
        firstPlayer: 1,
        supporterPlayed: false,
        stadiumPlayed: false,
        energyAttached: true,
        retreated: false,
        result: -1,
        stadium: [],
        looking: null,
        players: [
          {
            ...player(),
            active: [{
              id: 655,
              hp: 80,
              maxHp: 80,
              appearThisTurn: false,
              energies: [1],
              energyCards: [{ id: 1, serial: 50, playerIndex: 0 }],
              tools: [],
              preEvolution: [],
            }],
          },
          player(),
        ],
      },
    } satisfies CabtObservation;

    const view = cabtObservationToGameView(observation, [], dataMaps);
    const prompt = view.prompts[0];

    expect(prompt?.message).toBe('Choose energy to discard');
    expect(prompt?.fields.cardList).toEqual([
      expect.objectContaining({ name: 'Basic {G} Energy', energyType: 1 }),
    ]);
  });

  it('resolves current-player card options when CABT omits playerIndex', () => {
    const dataMaps: CabtDataMaps = {
      cardData: {
        8: {
          cardId: 8,
          name: 'Basic {W} Energy',
          cardType: CabtCardType.BASIC_ENERGY,
          energyType: 2,
          set: 'SVE',
          setNumber: '8',
        },
      },
      attacks: {},
    };
    const observation = {
      select: {
        type: CabtSelectType.CARD,
        context: CabtSelectContext.TO_HAND,
        minCount: 1,
        maxCount: 1,
        remainDamageCounter: 0,
        remainEnergyCost: 0,
        option: [
          { type: CabtOptionType.CARD, area: CabtAreaType.DISCARD, index: 0 },
        ],
        deck: null,
        contextCard: null,
        effect: null,
      },
      logs: [],
      current: {
        turn: 1,
        turnActionCount: 0,
        yourIndex: 1,
        firstPlayer: 0,
        supporterPlayed: false,
        stadiumPlayed: false,
        energyAttached: true,
        retreated: false,
        result: -1,
        stadium: [],
        looking: null,
        players: [
          player(),
          {
            ...player(),
            discard: [{ id: 8, serial: 20, playerIndex: 1 }],
          },
        ],
      },
    } satisfies CabtObservation;

    const view = cabtObservationToGameView(observation, [], dataMaps);
    const prompt = view.prompts[0];

    expect(prompt?.fields.cardList).toEqual([
      expect.objectContaining({ name: 'Basic {W} Energy', energyType: 2 }),
    ]);
  });
});

function player() {
  return {
    active: [null],
    bench: [],
    benchMax: 5,
    deckCount: 47,
    discard: [],
    prize: [],
    handCount: 0,
    hand: [],
    poisoned: false,
    burned: false,
    asleep: false,
    paralyzed: false,
    confused: false,
  };
}
