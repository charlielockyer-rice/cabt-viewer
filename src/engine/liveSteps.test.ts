import { describe, expect, it } from 'vitest';
import { LiveObservationNormalizer } from './liveSteps';
import { CabtAreaType, CabtLogType, type CabtObservation, type CabtPlayerState } from '../lib/cabt/types';

describe('LiveObservationNormalizer', () => {
  describe('canonical event stream (positional dedupe)', () => {
    it('drops re-delivered lines when the actor switches, regardless of encoding', () => {
      const normalizer = new LiveObservationNormalizer();
      const draw = { type: CabtLogType.DRAW, playerIndex: 0, cardId: 42, serial: 7 };

      // Seat 0 sees its own draw card-first.
      const first = normalizer.push(observation(0, [draw]));
      expect(first.newLogs).toEqual([draw]);

      // Seat 1's next observation re-delivers the same event in the
      // opponent-facing encoding; content differs, position matches.
      const redelivered = normalizer.push(observation(1, [
        { type: CabtLogType.DRAW_REVERSE, playerIndex: 0 },
      ]));
      expect(redelivered.newLogs).toEqual([]);
    });

    it('keeps only the unseen tail of an overlapping delivery', () => {
      const normalizer = new LiveObservationNormalizer();
      const turnLogs = [
        { type: CabtLogType.PLAY, playerIndex: 0, cardId: 5, serial: 1 },
        { type: CabtLogType.ATTACK, playerIndex: 0, attackId: 9 },
      ];
      normalizer.push(observation(0, turnLogs));

      // Seat 1 receives the whole turn plus one new event.
      const next = normalizer.push(observation(1, [
        ...turnLogs,
        { type: CabtLogType.TURN_START, playerIndex: 1 },
      ]));
      expect(next.newLogs).toEqual([{ type: CabtLogType.TURN_START, playerIndex: 1 }]);
    });

    it('keeps legitimately identical lines delivered within one observation', () => {
      const normalizer = new LiveObservationNormalizer();
      const prizeSet = { type: CabtLogType.MOVE_CARD_REVERSE, playerIndex: 1, fromArea: 1, toArea: 6 };

      const result = normalizer.push(observation(0, [prizeSet, prizeSet, prizeSet, prizeSet, prizeSet, prizeSet]));

      expect(result.newLogs).toHaveLength(6);
    });

    it('tracks each seat stream independently across interleaved observations', () => {
      const normalizer = new LiveObservationNormalizer();
      const a = { type: CabtLogType.SHUFFLE, playerIndex: 0 };
      const b = { type: CabtLogType.SHUFFLE, playerIndex: 1 };
      const c = { type: CabtLogType.TURN_START, playerIndex: 0 };

      expect(normalizer.push(observation(0, [a, b])).newLogs).toEqual([a, b]);
      expect(normalizer.push(observation(1, [a, b, c])).newLogs).toEqual([c]);
      expect(normalizer.push(observation(0, [c])).newLogs).toEqual([]);
    });
  });

  describe('hidden-information visibility', () => {
    it('downgrades a concealed seat draw to the opponent-facing encoding', () => {
      const normalizer = new LiveObservationNormalizer(new Set([1]));

      const result = normalizer.push(observation(1, [
        { type: CabtLogType.DRAW, playerIndex: 1, cardId: 42, serial: 7 },
      ]));

      expect(result.newLogs).toEqual([{ type: CabtLogType.DRAW_REVERSE, playerIndex: 1 }]);
    });

    it('keeps concrete draws for unconcealed seats (spectator or own seat)', () => {
      const normalizer = new LiveObservationNormalizer();
      const draw = { type: CabtLogType.DRAW, playerIndex: 1, cardId: 42, serial: 7 };

      expect(normalizer.push(observation(1, [draw])).newLogs).toEqual([draw]);
    });
  });

  describe('event-sourced hands', () => {
    it('removes the exact discarded card from a tracked hand', () => {
      const normalizer = new LiveObservationNormalizer();
      normalizer.push(observation(0, [], {
        seat0Hand: [
          { id: 10, serial: 1, playerIndex: 0 },
          { id: 11, serial: 2, playerIndex: 0 },
          { id: 12, serial: 3, playerIndex: 0 },
        ],
      }));

      // Opponent's observation: seat 0 is forced to discard a specific card
      // (public, so the log is concrete).
      const result = normalizer.push(observation(1, [
        { type: CabtLogType.MOVE_CARD, playerIndex: 0, cardId: 11, serial: 2, fromArea: CabtAreaType.HAND, toArea: CabtAreaType.DISCARD },
      ], { seat0HandCount: 2 }));

      expect(result.observation.current!.players[0].hand!.map((card) => card.serial)).toEqual([1, 3]);
    });

    it('keeps hands exact through same-count discard-and-draw sequences', () => {
      const normalizer = new LiveObservationNormalizer();
      normalizer.push(observation(0, [], {
        seat0Hand: [
          { id: 10, serial: 1, playerIndex: 0 },
          { id: 11, serial: 2, playerIndex: 0 },
        ],
      }));

      // Discard one known card, draw one unknown: same count, new contents.
      // The old length-matching heuristic showed the stale hand here.
      const result = normalizer.push(observation(1, [
        { type: CabtLogType.MOVE_CARD, playerIndex: 0, cardId: 10, serial: 1, fromArea: CabtAreaType.HAND, toArea: CabtAreaType.DISCARD },
        { type: CabtLogType.DRAW_REVERSE, playerIndex: 0 },
      ], { seat0HandCount: 2 }));

      const hand = result.observation.current!.players[0].hand!;
      expect(hand[0]).toEqual({ id: 11, serial: 2, playerIndex: 0 });
      expect(hand[1].id).toBe(0);
      expect(hand[1].serial).toBeLessThan(0);
    });

    it('applies play/attach/evolve announcements as exact hand removals', () => {
      const normalizer = new LiveObservationNormalizer();
      normalizer.push(observation(0, [], {
        seat0Hand: [
          { id: 10, serial: 1, playerIndex: 0 },
          { id: 11, serial: 2, playerIndex: 0 },
        ],
      }));

      const result = normalizer.push(observation(1, [
        { type: CabtLogType.ATTACH, playerIndex: 0, cardId: 10, serial: 1, cardIdTarget: 99, serialTarget: 50 },
      ], { seat0HandCount: 1 }));

      expect(result.observation.current!.players[0].hand).toEqual([{ id: 11, serial: 2, playerIndex: 0 }]);
    });

    it('takes an unknown first when a hidden removal arrives', () => {
      const normalizer = new LiveObservationNormalizer();
      normalizer.push(observation(0, [], {
        seat0Hand: [{ id: 10, serial: 1, playerIndex: 0 }],
      }));
      // Unknown card enters, then a hidden card leaves: the unknown goes.
      const result = normalizer.push(observation(1, [
        { type: CabtLogType.MOVE_CARD_REVERSE, playerIndex: 0, fromArea: CabtAreaType.PRIZE, toArea: CabtAreaType.HAND },
        { type: CabtLogType.MOVE_CARD_REVERSE, playerIndex: 0, fromArea: CabtAreaType.HAND, toArea: CabtAreaType.DECK },
      ], { seat0HandCount: 1 }));

      expect(result.observation.current!.players[0].hand).toEqual([{ id: 10, serial: 1, playerIndex: 0 }]);
    });
  });

  describe('seat-stable hands', () => {
    it('always fills the non-acting hand to handCount so views never flip to bare card backs', () => {
      const normalizer = new LiveObservationNormalizer();

      const result = normalizer.push(observation(0, [], {
        seat0Hand: [{ id: 10, serial: 1, playerIndex: 0 }],
        seat1HandCount: 3,
      }));

      const players = result.observation.current!.players;
      expect(players[0].hand).toEqual([{ id: 10, serial: 1, playerIndex: 0 }]);
      expect(players[1].hand).toHaveLength(3);
      for (const card of players[1].hand!) {
        expect(card.id).toBe(0);
        expect(card.serial).toBeLessThan(0);
      }
    });

    it('carries the cached hand forward and keeps placeholder serials stable across steps', () => {
      const normalizer = new LiveObservationNormalizer();
      const first = normalizer.push(observation(0, [], { seat1HandCount: 2 }));
      const firstSerials = first.observation.current!.players[1].hand!.map((card) => card.serial);

      const second = normalizer.push(observation(0, [], { seat1HandCount: 3 }));
      const secondSerials = second.observation.current!.players[1].hand!.map((card) => card.serial);

      expect(secondSerials.slice(0, 2)).toEqual(firstSerials);
      expect(new Set(secondSerials).size).toBe(3);
    });

    it('replaces the cache when the seat acts again, and trims placeholders first on shrink', () => {
      const normalizer = new LiveObservationNormalizer();
      // Seat 1 acts: real hand cached.
      normalizer.push(observation(1, [], {
        seat1Hand: [
          { id: 20, serial: 11, playerIndex: 1 },
          { id: 21, serial: 12, playerIndex: 1 },
        ],
      }));
      // Seat 0 acts; seat 1's count grew by one (placeholder appended).
      const grown = normalizer.push(observation(0, [], { seat1HandCount: 3 }));
      expect(grown.observation.current!.players[1].hand!.map((card) => card.id)).toEqual([20, 21, 0]);

      // Count shrinks by one: the unknown placeholder goes before real cards.
      const shrunk = normalizer.push(observation(0, [], { seat1HandCount: 2 }));
      expect(shrunk.observation.current!.players[1].hand!.map((card) => card.id)).toEqual([20, 21]);
    });

    it('passes observations without battle state through untouched', () => {
      const normalizer = new LiveObservationNormalizer();
      const empty: CabtObservation = { select: null, logs: [], current: null };

      expect(normalizer.push(empty)).toEqual({ observation: empty, newLogs: [] });
    });
  });
});

type HandSetup = {
  seat0Hand?: Array<{ id: number; serial: number; playerIndex: number }>;
  seat0HandCount?: number;
  seat1Hand?: Array<{ id: number; serial: number; playerIndex: number }>;
  seat1HandCount?: number;
};

function observation(yourIndex: number, logs: Array<Record<string, unknown>>, hands: HandSetup = {}): CabtObservation {
  const seat0Hand = hands.seat0Hand ?? (yourIndex === 0 ? [] : null);
  const seat1Hand = hands.seat1Hand ?? (yourIndex === 1 ? [] : null);
  return {
    select: null,
    logs,
    current: {
      turn: 1,
      turnActionCount: 0,
      yourIndex,
      firstPlayer: 0,
      supporterPlayed: false,
      stadiumPlayed: false,
      energyAttached: false,
      retreated: false,
      result: -1,
      stadium: [],
      looking: null,
      players: [
        player(seat0Hand, hands.seat0HandCount),
        player(seat1Hand, hands.seat1HandCount),
      ],
    },
  };
}

function player(hand: Array<{ id: number; serial: number; playerIndex: number }> | null, handCount?: number): CabtPlayerState {
  return {
    active: [null],
    bench: [],
    benchMax: 5,
    deckCount: 40,
    discard: [],
    prize: [],
    handCount: handCount ?? hand?.length ?? 0,
    hand,
    poisoned: false,
    burned: false,
    asleep: false,
    paralyzed: false,
    confused: false,
  };
}
