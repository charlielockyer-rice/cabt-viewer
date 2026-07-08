import { describe, expect, it } from 'vitest';
import { toggleSelectionIndex } from './decisions';

describe('toggleSelectionIndex', () => {
  it('adds and removes indexes up to max', () => {
    let selected: number[] = [];
    selected = toggleSelectionIndex(selected, 2, 3);
    selected = toggleSelectionIndex(selected, 4, 3);
    expect(selected).toEqual([2, 4]);
    selected = toggleSelectionIndex(selected, 2, 3);
    expect(selected).toEqual([4]);
  });

  it('swaps the selection when max is 1', () => {
    expect(toggleSelectionIndex([3], 5, 1)).toEqual([5]);
    expect(toggleSelectionIndex([5], 5, 1)).toEqual([]);
  });

  it('ignores adds beyond max', () => {
    expect(toggleSelectionIndex([1, 2], 3, 2)).toEqual([1, 2]);
  });
});
