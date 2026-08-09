import { describe, expect, it } from 'vitest';
import { clipOptionLabel } from './clipOptions';

// Option shapes captured verbatim from public/local-replays/setA-fleet-config-CSV-game1.json.
const mainSelect = {
  type: 'Main',
  option: [
    { type: 'Attach', area: 2, index: 1, inPlayArea: 4, inPlayIndex: 0 },
    { type: 'Attach', area: 2, index: 1, inPlayArea: 5, inPlayIndex: 3 },
    { type: 'Play', index: 4 },
    { type: 'Evolve', area: 2, index: 5, inPlayArea: 5, inPlayIndex: 3 },
  ],
};

const switchSelect = {
  type: 'Card',
  option: [
    { type: 'Card', area: 5, index: 0, playerIndex: 0 },
    { type: 'Card', area: 5, index: 2, playerIndex: 0 },
  ],
};

describe('clipOptionLabel', () => {
  it('names the in-play destination when the option has one', () => {
    expect(clipOptionLabel(mainSelect, 0)).toBe('Attach → Active');
    expect(clipOptionLabel(mainSelect, 1)).toBe('Attach → Bench 4');
    expect(clipOptionLabel(mainSelect, 3)).toBe('Evolve → Bench 4');
  });

  it('falls back to the source zone, then to the bare action', () => {
    expect(clipOptionLabel(switchSelect, 0)).toBe('Card · Bench 1');
    expect(clipOptionLabel(switchSelect, 1)).toBe('Card · Bench 3');
    expect(clipOptionLabel(mainSelect, 2)).toBe('Play');
    expect(clipOptionLabel({ option: [{ type: 'Yes' }, { type: 'No' }] }, 1)).toBe('No');
  });

  it('returns nothing it cannot name', () => {
    expect(clipOptionLabel(null, 0)).toBe('');
    expect(clipOptionLabel({ option: [] }, 0)).toBe('');
    expect(clipOptionLabel(mainSelect, 99)).toBe('');
    expect(clipOptionLabel({ option: [{ area: 5, index: 0 }] }, 0)).toBe('');
    expect(clipOptionLabel({ option: [{ type: 'Card', area: 12, index: 0 }] }, 0)).toBe('Card');
  });
});
