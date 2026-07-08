import { describe, expect, it } from 'vitest';
import { boardTargetCaption, boardTargetDecisionOptions, boardTargetPickForSlot, toggleSelectionIndex } from './decisions';
import type { DecisionOptionView, DecisionView } from './types';

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

describe('board target decisions (product options)', () => {
  // The dedicated evolve select: two identical hand copies × two targets.
  function evolveOption(index: number, handIndex: number, benchIndex: number, cardId = 900): DecisionOptionView {
    return {
      index,
      type: 9,
      area: 2,
      label: `Dragapult ex → Drakloak (Bench ${benchIndex + 1})`,
      card: { id: cardId, name: cardId === 900 ? 'Dragapult ex' : 'Other', fullName: 'x' },
      hand: { playerIndex: 0, handIndex },
      boardTarget: { ownerIndex: 0, slot: 'bench', index: benchIndex },
      boardTargetCard: { id: 800, name: 'Drakloak', fullName: 'Drakloak' },
    };
  }
  function evolveDecision(options: DecisionOptionView[]): DecisionView {
    return { seq: 1, seat: 0, kind: 'choose-cards', message: 'Choose evolution', min: 1, max: 1, options };
  }

  it('recognizes the shape even with repeated targets', () => {
    const decision = evolveDecision([
      evolveOption(0, 0, 0), evolveOption(1, 0, 1), evolveOption(2, 1, 0), evolveOption(3, 1, 1),
    ]);
    expect(boardTargetDecisionOptions(decision)).toHaveLength(4);
  });

  it('clicking a target picks the first game-equivalent option', () => {
    const decision = evolveDecision([
      evolveOption(0, 0, 0), evolveOption(1, 0, 1), evolveOption(2, 1, 0), evolveOption(3, 1, 1),
    ]);
    const pick = boardTargetPickForSlot(decision, { ownerIndex: 0, slot: 'bench', index: 1 });
    expect(pick).not.toBe('ambiguous');
    expect((pick as DecisionOptionView).index).toBe(1);
  });

  it('flags a target contested by distinct cards as ambiguous', () => {
    const decision = evolveDecision([
      evolveOption(0, 0, 0, 900), evolveOption(1, 1, 0, 901),
    ]);
    expect(boardTargetPickForSlot(decision, { ownerIndex: 0, slot: 'bench', index: 0 })).toBe('ambiguous');
  });

  it('does not claim decisions whose options lack targets or select attached cards', () => {
    const untargeted = evolveDecision([{ ...evolveOption(0, 0, 0), boardTarget: undefined }]);
    expect(boardTargetDecisionOptions(untargeted)).toEqual([]);
    const attached = evolveDecision([{ ...evolveOption(0, 0, 0), attached: true }]);
    expect(boardTargetDecisionOptions(attached)).toEqual([]);
    const multi = { ...evolveDecision([evolveOption(0, 0, 0)]), max: 2 };
    expect(boardTargetDecisionOptions(multi)).toEqual([]);
  });

  it('captions options with their landing spot', () => {
    expect(boardTargetCaption(evolveOption(0, 0, 1))).toBe('Drakloak · Bench 2');
    expect(boardTargetCaption({ ...evolveOption(0, 0, 0), boardTargetCard: undefined })).toBe('Bench 1');
    expect(boardTargetCaption({ ...evolveOption(0, 0, 0), boardTarget: undefined })).toBeUndefined();
  });
});
