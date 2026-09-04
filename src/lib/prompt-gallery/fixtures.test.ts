import { describe, expect, it } from 'vitest';
import { decisionDemos } from './fixtures';

describe('prompt gallery fixtures', () => {
  it('carries captured engine decisions for every dialog kind', () => {
    const kinds = new Set(decisionDemos.map((demo) => demo.decision.kind));

    expect(kinds.has('main')).toBe(true);
    expect(kinds.has('choose-cards')).toBe(true);
    expect(kinds.has('choose-option')).toBe(true);
  });

  it('covers the deck-search layout: a whole deck with a few legal picks', () => {
    const deckSearch = decisionDemos.find((demo) => demo.decision.deckCards);

    expect(deckSearch?.decision.deckCards?.length).toBeGreaterThan(40);
    const selectable = deckSearch?.decision.deckCards?.filter((item) => item.optionIndex !== undefined) ?? [];
    expect(selectable.map((item) => item.optionIndex).sort((a, b) => (a ?? 0) - (b ?? 0)))
      .toEqual(deckSearch?.decision.options.map((option) => option.index));
  });

  it('captured decisions are well-formed', () => {
    for (const demo of decisionDemos) {
      expect(demo.decision.options.length).toBeGreaterThan(0);
      expect(demo.decision.min).toBeGreaterThanOrEqual(0);
      expect(demo.decision.max).toBeGreaterThanOrEqual(demo.decision.min);
      for (const option of demo.decision.options) {
        expect(Number.isInteger(option.index)).toBe(true);
        expect(typeof option.label).toBe('string');
      }
    }
  });
});
