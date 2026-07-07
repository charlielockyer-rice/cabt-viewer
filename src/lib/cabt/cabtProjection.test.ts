import { describe, expect, it } from 'vitest';
import { cabtObservationToGameView, projectDecision } from './cabtProjection';
import type { CabtDataMaps } from './cabtProjection';
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

    const decision = projectDecision(observation, 1, dataMaps);

    expect(decision?.kind).toBe('choose-cards');
    expect(decision?.message).toBe('Choose energy to discard');
    expect(decision?.options).toEqual([
      expect.objectContaining({
        index: 0,
        attached: true,
        card: expect.objectContaining({ name: 'Basic {G} Energy', energyType: 1 }),
      }),
    ]);
  });

  it('batches repeated CABT retreat energy payment prompts', () => {
    const dataMaps: CabtDataMaps = {
      cardData: {
        3: {
          cardId: 3,
          name: 'Basic {W} Energy',
          cardType: CabtCardType.BASIC_ENERGY,
          energyType: 3,
          set: 'SVE',
          setNumber: '3',
        },
        723: {
          cardId: 723,
          name: 'Mega Abomasnow ex',
          cardType: CabtCardType.POKEMON,
          stage1: true,
          hp: 350,
        },
      },
      attacks: {},
    };
    const observation = {
      select: {
        type: CabtSelectType.CARD,
        context: CabtSelectContext.DISCARD_ENERGY_CARD,
        minCount: 1,
        maxCount: 1,
        remainDamageCounter: 0,
        remainEnergyCost: 4,
        option: [0, 1, 2, 3].map((energyIndex) => ({
          type: CabtOptionType.ENERGY_CARD,
          area: CabtAreaType.ACTIVE,
          index: 0,
          energyIndex,
          playerIndex: 0,
        })),
        deck: null,
        contextCard: null,
        effect: null,
      },
      logs: [],
      current: {
        turn: 2,
        turnActionCount: 0,
        yourIndex: 0,
        firstPlayer: 0,
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
              id: 723,
              hp: 350,
              maxHp: 350,
              appearThisTurn: false,
              energies: [3, 3, 3, 3],
              energyCards: [0, 1, 2, 3].map((index) => ({ id: 3, serial: 80 + index, playerIndex: 0 })),
              tools: [],
              preEvolution: [],
            }],
          },
          player(),
        ],
      },
    } satisfies CabtObservation;

    // The engine asks for retreat energies one at a time; the decision is
    // projected honestly (no fake multi-select batching).
    const decision = projectDecision(observation, 1, dataMaps);

    expect(decision?.min).toBe(1);
    expect(decision?.max).toBe(1);
    expect(decision?.options).toHaveLength(4);
    expect(decision?.options.every((option) => option.card?.name === 'Basic {W} Energy')).toBe(true);
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

    const decision = projectDecision(observation, 1, dataMaps);

    expect(decision?.options).toEqual([
      expect.objectContaining({
        card: expect.objectContaining({ name: 'Basic {W} Energy', energyType: 2 }),
      }),
    ]);
  });

  it('resolves deck-selection card options by option order when CABT omits area and index', () => {
    const dataMaps: CabtDataMaps = {
      cardData: {
        3: {
          cardId: 3,
          name: 'Basic {W} Energy',
          cardType: CabtCardType.BASIC_ENERGY,
          energyType: 3,
          set: 'SVE',
          setNumber: '3',
        },
        1145: {
          cardId: 1145,
          name: 'Mega Signal',
          cardType: CabtCardType.ITEM,
          set: 'MEG',
          setNumber: '123',
        },
      },
      attacks: {},
    };
    const observation = {
      select: {
        type: CabtSelectType.CARD,
        context: CabtSelectContext.DISCARD,
        minCount: 1,
        maxCount: 1,
        remainDamageCounter: 0,
        remainEnergyCost: 0,
        option: [
          { type: CabtOptionType.CARD },
          { type: CabtOptionType.CARD },
        ],
        deck: [
          { id: 3, serial: 20, playerIndex: 0 },
          { id: 1145, serial: 21, playerIndex: 0 },
        ],
        contextCard: null,
        effect: null,
      },
      logs: [],
      current: {
        turn: 1,
        turnActionCount: 0,
        yourIndex: 0,
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
          player(),
        ],
      },
    } satisfies CabtObservation;

    const decision = projectDecision(observation, 1, dataMaps);

    expect(decision?.options).toEqual([
      expect.objectContaining({ index: 0, card: expect.objectContaining({ name: 'Basic {W} Energy' }) }),
      expect.objectContaining({ index: 1, card: expect.objectContaining({ name: 'Mega Signal' }) }),
    ]);
  });

  it('labels CABT draw-count prompts with numeric choices', () => {
    const observation = {
      select: {
        type: CabtSelectType.COUNT,
        context: CabtSelectContext.DRAW_COUNT,
        minCount: 1,
        maxCount: 1,
        remainDamageCounter: 0,
        remainEnergyCost: 0,
        option: [
          { type: CabtOptionType.NUMBER, number: 1 },
          { type: CabtOptionType.NUMBER, number: 2 },
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
          player(),
        ],
      },
    } satisfies CabtObservation;

    const decision = projectDecision(observation, 1, { cardData: {}, attacks: {} });

    expect(decision?.kind).toBe('choose-option');
    expect(decision?.message).toBe('Choose cards to draw');
    expect(decision?.options.map((option) => option.label)).toEqual(['Draw 1', 'Draw 2']);
  });

  it('routes CABT prize selections through the prize prompt with option indexes', () => {
    const dataMaps: CabtDataMaps = {
      cardData: {
        1123: {
          cardId: 1123,
          name: 'Switch',
          cardType: CabtCardType.ITEM,
          set: 'SVI',
          setNumber: '194',
        },
      },
      attacks: {},
    };
    const observation = {
      select: {
        type: CabtSelectType.CARD,
        context: CabtSelectContext.TO_PRIZE,
        minCount: 1,
        maxCount: 1,
        remainDamageCounter: 0,
        remainEnergyCost: 0,
        option: [
          { type: CabtOptionType.CARD, area: CabtAreaType.PRIZE, index: 3 },
        ],
        deck: null,
        contextCard: null,
        effect: null,
      },
      logs: [],
      current: {
        turn: 2,
        turnActionCount: 0,
        yourIndex: 0,
        firstPlayer: 0,
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
            prize: [null, null, null, { id: 1123, serial: 70, playerIndex: 0 }],
          },
          player(),
        ],
      },
    } satisfies CabtObservation;

    const decision = projectDecision(observation, 1, dataMaps);

    expect(decision?.kind).toBe('choose-prize');
    expect(decision?.message).toBe('Choose Prize Card');
    expect(decision?.options).toEqual([
      expect.objectContaining({ index: 0, card: expect.objectContaining({ name: 'Switch' }) }),
    ]);
  });

  it('routes facedown prize cards selected to hand through the prize prompt', () => {
    const observation = {
      select: {
        type: CabtSelectType.CARD,
        context: CabtSelectContext.TO_HAND,
        minCount: 1,
        maxCount: 1,
        remainDamageCounter: 0,
        remainEnergyCost: 0,
        option: [
          { type: CabtOptionType.CARD, area: CabtAreaType.PRIZE, index: 0, playerIndex: 0 },
          { type: CabtOptionType.CARD, area: CabtAreaType.PRIZE, index: 1, playerIndex: 0 },
          { type: CabtOptionType.CARD, area: CabtAreaType.PRIZE, index: 2, playerIndex: 0 },
          { type: CabtOptionType.CARD, area: CabtAreaType.PRIZE, index: 3, playerIndex: 0 },
          { type: CabtOptionType.CARD, area: CabtAreaType.PRIZE, index: 4, playerIndex: 0 },
          { type: CabtOptionType.CARD, area: CabtAreaType.PRIZE, index: 5, playerIndex: 0 },
        ],
        deck: null,
        contextCard: null,
        effect: null,
      },
      logs: [],
      current: {
        turn: 3,
        turnActionCount: 0,
        yourIndex: 0,
        firstPlayer: 0,
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
            prize: [null, null, null, null, null, null],
          },
          player(),
        ],
      },
    } satisfies CabtObservation;

    const decision = projectDecision(observation, 1, { cardData: {}, attacks: {} });

    expect(decision?.kind).toBe('choose-prize');
    expect(decision?.message).toBe('Choose Prize Card');
    expect(decision?.options).toHaveLength(6);
    expect(decision?.options.every((option) => option.card === undefined)).toBe(true);
  });

  it('projects a yes/no select as a choose-option decision carrying the seq', () => {
    const observation = promptObservation();

    const decision = projectDecision(observation, 42, { cardData: {}, attacks: {} });

    expect(decision).toEqual(expect.objectContaining({
      seq: 42,
      seat: observation.current.yourIndex,
      kind: 'choose-option',
      min: 1,
      max: 1,
    }));
    expect(decision?.options.map((option) => option.label)).toEqual(['Yes', 'No']);
  });

  it('maps engine results to winners the same way as replay: seats win, 2 is a draw', () => {
    const finished = (result: number) => {
      const observation = promptObservation();
      observation.current.result = result;
      return cabtObservationToGameView(observation, [], { cardData: {}, attacks: {} });
    };

    expect(finished(0).winner).toBe(0);
    expect(finished(1).winner).toBe(1);
    expect(finished(2).winner).toBe(3);
    expect(finished(2).phaseLabel).toBe('Finished');
  });
});

function promptObservation(): CabtObservation {
  return {
    select: {
      type: CabtSelectType.YES_NO,
      context: CabtSelectContext.ACTIVATE,
      minCount: 1,
      maxCount: 1,
      remainDamageCounter: 0,
      remainEnergyCost: 0,
      option: [{ type: CabtOptionType.YES }, { type: CabtOptionType.NO }],
      deck: null,
      contextCard: null,
      effect: null,
    },
    logs: [],
    current: {
      turn: 3,
      turnActionCount: 0,
      yourIndex: 0,
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
        player(),
      ],
    },
  };
}

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
