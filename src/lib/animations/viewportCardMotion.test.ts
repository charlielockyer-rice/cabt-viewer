import { afterEach, describe, expect, it, vi } from 'vitest';
import { revealedCardLayout, strictVisualElementForMotionAnchor } from './viewportCardMotion';

class FakeHTMLElement {
  dataset: Record<string, string> = {};

  closest(): FakeHTMLElement | null {
    return null;
  }

  querySelector(): FakeHTMLElement | null {
    return null;
  }

  getAttributeNames(): string[] {
    return [
      'data-animation-anchor',
      'data-animation-anchor-key',
      'data-animation-card-serial',
      'data-animation-card-id',
      'data-animation-card-name',
    ];
  }
}

describe('strictVisualElementForMotionAnchor', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does not broaden an unresolved discard card to the discard pile surface', () => {
    vi.stubGlobal('HTMLElement', FakeHTMLElement);
    vi.stubGlobal('document', {
      querySelectorAll: () => [],
    });

    expect(strictVisualElementForMotionAnchor(
      { kind: 'discard-card', playerIndex: 0, serial: 99 },
      { kind: 'card', serial: 99 },
    )).toBeUndefined();
  });
});

describe('revealedCardLayout', () => {
  it('centers a single revealed card on the board', () => {
    const layout = revealedCardLayout(1, {
      viewportWidth: 1200,
      viewportHeight: 800,
      boardRect: rect({ left: 100, top: 80, width: 900, height: 640 }),
    });
    const target = layout.target(0);

    expect(layout.cardWidth).toBeGreaterThan(100);
    expect(target.x).toBe(550);
    expect(target.rotation).toBe(0);
  });

  it('spreads multiple revealed cards with mirrored rotation', () => {
    const layout = revealedCardLayout(3, {
      viewportWidth: 1200,
      viewportHeight: 800,
      boardRect: rect({ left: 0, top: 0, width: 900, height: 640 }),
    });

    expect(layout.target(0).x).toBeLessThan(layout.target(1).x);
    expect(layout.target(2).x).toBeGreaterThan(layout.target(1).x);
    expect(layout.target(0).rotation).toBe(-layout.target(2).rotation);
  });

  it('uses narrower mobile spacing and card widths', () => {
    const desktop = revealedCardLayout(4, {
      viewportWidth: 1200,
      viewportHeight: 800,
      boardRect: rect({ left: 0, top: 0, width: 900, height: 640 }),
    });
    const mobile = revealedCardLayout(4, {
      viewportWidth: 390,
      viewportHeight: 740,
      boardRect: rect({ left: 0, top: 0, width: 360, height: 560 }),
    });

    expect(mobile.cardWidth).toBeLessThan(desktop.cardWidth);
  });
});

function rect(input: { left: number; top: number; width: number; height: number }): DOMRect {
  return {
    ...input,
    right: input.left + input.width,
    bottom: input.top + input.height,
    x: input.left,
    y: input.top,
    toJSON: () => ({}),
  } as DOMRect;
}
