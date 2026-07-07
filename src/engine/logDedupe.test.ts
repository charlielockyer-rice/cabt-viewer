import { describe, expect, it } from 'vitest';
import { createLogDeduper } from './logDedupe';

const log = (type: number, cardId: number) => ({ type, cardId });

describe('createLogDeduper', () => {
  it('passes fresh logs through in order', () => {
    const deduper = createLogDeduper();
    const logs = [log(1, 10), log(2, 11)];
    expect(deduper.filterNew(logs)).toEqual(logs);
  });

  it('drops logs re-delivered in a later observation', () => {
    const deduper = createLogDeduper();
    deduper.filterNew([log(1, 10), log(2, 11), log(3, 12)]);
    // Actor switch: the next observation re-contains the previous logs.
    expect(deduper.filterNew([log(2, 11), log(3, 12), log(4, 13)])).toEqual([log(4, 13)]);
  });

  it('drops a full re-delivered turn (human obs after agent turn)', () => {
    const deduper = createLogDeduper();
    const agentTurn = Array.from({ length: 60 }, (_, i) => log(1, i));
    for (const entry of agentTurn) {
      deduper.filterNew([entry]);
    }
    expect(deduper.filterNew(agentTurn)).toEqual([]);
  });

  it('lets an identical action animate again once outside the window', () => {
    const deduper = createLogDeduper(3);
    expect(deduper.filterNew([log(1, 10)])).toHaveLength(1);
    deduper.filterNew([log(2, 20), log(2, 21), log(2, 22)]);
    // log(1, 10) has been evicted from the window: same content next turn is fresh.
    expect(deduper.filterNew([log(1, 10)])).toHaveLength(1);
  });

  it('distinguishes logs that differ in any field', () => {
    const deduper = createLogDeduper();
    deduper.filterNew([{ type: 1, cardId: 10, playerIndex: 0 }]);
    expect(deduper.filterNew([{ type: 1, cardId: 10, playerIndex: 1 }])).toHaveLength(1);
  });
});
