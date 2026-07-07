import { describe, expect, it } from 'vitest';
import { decisionDemos } from './fixtures';

describe('prompt gallery fixtures', () => {
  it('carries captured engine decisions for every dialog kind', () => {
    const kinds = new Set(decisionDemos.map((demo) => demo.decision.kind));

    expect(kinds.has('main')).toBe(true);
    expect(kinds.has('choose-cards')).toBe(true);
    expect(kinds.has('choose-option')).toBe(true);
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
