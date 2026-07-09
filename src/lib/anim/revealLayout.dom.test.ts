// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { settledHandLandingWidth } from './revealLayout';

// happy-dom does no layout, so stub each card tile's measured width.
function tile(width: number): HTMLElement {
  const el = document.createElement('div');
  el.className = 'card-tile';
  el.getBoundingClientRect = () =>
    ({ width, height: width * (88 / 63), x: 0, y: 0, top: 0, left: 0, right: width, bottom: 0, toJSON() {} }) as DOMRect;
  return el;
}

describe('settledHandLandingWidth (shared reveal/prize-take landing)', () => {
  it('lands at a settled sibling width, not the arriving slot mid-layout width', () => {
    // The arriving slot measures narrow (40) mid-layout; a settled sibling is the
    // real fixed hand-card width (96). Both a searched-card reveal and a prize
    // take must land at 96 so they don't snap.
    const arriving = tile(40);
    const sibling = tile(96);
    expect(settledHandLandingWidth([arriving, sibling], arriving, 120)).toBe(96);
  });

  it('excludes the arriving slot even when it is the widest measured', () => {
    // A prize take whose incoming slot reads wide (151) must still land at the
    // settled sibling (124.8), the hand's real fixed width — the #31 symptom.
    const arriving = tile(151);
    const sibling = tile(124.8);
    expect(settledHandLandingWidth([arriving, sibling], arriving, 120)).toBe(124.8);
  });

  it('uses the arriving slot measured width when it is the only hand card', () => {
    const only = tile(88);
    expect(settledHandLandingWidth([only], only, 120)).toBe(88);
  });

  it('falls back to the computed geometry when nothing is measurable', () => {
    expect(settledHandLandingWidth([], undefined, 120)).toBe(120);
  });
});
