import { describe, expect, it } from 'vitest';
import { settledLandingWidth } from './revealLayout';

describe('settledLandingWidth', () => {
  it('prefers a settled sibling width over a transient measured width', () => {
    // The incoming slot measures narrow mid-layout (40); a settled sibling is
    // the real fixed hand-card width (96) — land at 96, not 40.
    expect(settledLandingWidth(96, 40, 120)).toBe(96);
  });

  it('uses the measured width when there is no settled sibling', () => {
    expect(settledLandingWidth(undefined, 88, 120)).toBe(88);
  });

  it('falls back to the computed geometry when nothing is measurable', () => {
    expect(settledLandingWidth(undefined, undefined, 120)).toBe(120);
    expect(settledLandingWidth(0, 0, 120)).toBe(120);
  });
});
