import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  hasKnownHandSource,
  snapshotHandCardRects,
  sourceRectForHand,
  type RectSnapshot,
} from './handPlayAnimationGeometry';

class FakeHTMLElement {
  dataset: Record<string, string> = {};
  #rect: DOMRect;
  #matches = new Map<string, FakeHTMLElement | null>();

  constructor(rect: DOMRect, dataset: Record<string, string> = {}) {
    this.#rect = rect;
    this.dataset = dataset;
  }

  setMatch(selector: string, element: FakeHTMLElement | null): void {
    this.#matches.set(selector, element);
  }

  querySelector(selector: string): FakeHTMLElement | null {
    return this.#matches.get(selector) ?? null;
  }

  getBoundingClientRect(): DOMRect {
    return this.#rect;
  }
}

describe('hand play source geometry', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reuses a previous card rect when the card already left hand DOM', () => {
    vi.stubGlobal('HTMLElement', FakeHTMLElement);
    const previous = snapshot({ left: 10, top: 20, width: 63, height: 88 });
    const hand = element({ left: 100, top: 100, width: 500, height: 120 });

    expect(sourceRectForHand(hand, 7, new Map([[7, previous]]))).toMatchObject(previous);
  });

  it('uses the matching hand card when it is still visible', () => {
    vi.stubGlobal('HTMLElement', FakeHTMLElement);
    const hand = element({ left: 100, top: 100, width: 500, height: 120 });
    const card = element({ left: 140, top: 120, width: 70, height: 98 });
    hand.setMatch('[data-card-serial="12"]', card);

    expect(sourceRectForHand(hand, 12, new Map()).left).toBe(140);
    expect(hasKnownHandSource(hand, 12, new Map())).toBe(true);
  });

  it('falls back to a centered hand card-sized rect', () => {
    vi.stubGlobal('HTMLElement', FakeHTMLElement);
    const hand = element({ left: 100, top: 50, width: 500, height: 140 });

    const rect = sourceRectForHand(hand, Number.NaN, new Map());

    expect(rect.width).toBe(80);
    expect(rect.height).toBeCloseTo(111.746, 3);
    expect(rect.left).toBe(310);
    expect(rect.top).toBeCloseTo(64.127, 3);
  });

  it('does not report an unknown or non-finite serial as a known source', () => {
    vi.stubGlobal('HTMLElement', FakeHTMLElement);
    const hand = element({ left: 0, top: 0, width: 300, height: 120 });

    expect(hasKnownHandSource(hand, Number.NaN, new Map())).toBe(false);
    expect(hasKnownHandSource(hand, 44, new Map())).toBe(false);
    expect(hasKnownHandSource(hand, 44, new Map([[44, snapshot({ left: 0, top: 0, width: 60, height: 84 })]]))).toBe(true);
  });

  it('snapshots visible hand cards by serial', () => {
    vi.stubGlobal('HTMLElement', FakeHTMLElement);
    const first = element({ left: 10, top: 20, width: 60, height: 84 }, { cardSerial: '101' });
    const invalid = element({ left: 0, top: 0, width: 1, height: 1 }, { cardSerial: 'nope' });
    const root = {
      querySelectorAll: () => [first, invalid],
    } as unknown as ParentNode;

    const snapshots = snapshotHandCardRects(root);

    expect(snapshots.get(101)).toMatchObject({
      left: 10,
      top: 20,
      width: 60,
      height: 84,
    });
    expect(snapshots.size).toBe(1);
  });
});

function element(
  input: { left: number; top: number; width: number; height: number },
  dataset: Record<string, string> = {},
): FakeHTMLElement {
  return new FakeHTMLElement(rect(input), dataset);
}

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

function snapshot(input: { left: number; top: number; width: number; height: number }): RectSnapshot {
  const domRect = rect(input);
  return {
    left: domRect.left,
    top: domRect.top,
    right: domRect.right,
    bottom: domRect.bottom,
    x: domRect.x,
    y: domRect.y,
    width: domRect.width,
    height: domRect.height,
  };
}
