import { afterEach, describe, expect, it, vi } from 'vitest';
import { animationElementForMotionAnchor } from './viewportCardMotion';

class FakeHTMLElement {
  dataset: Record<string, string>;

  constructor(dataset: Record<string, string>) {
    this.dataset = dataset;
  }

  closest(): FakeHTMLElement | null {
    return null;
  }

  querySelector(): FakeHTMLElement | null {
    return null;
  }
}

describe('animationElementForMotionAnchor', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('falls back from an unresolved discard card to the discard pile surface', () => {
    vi.stubGlobal('HTMLElement', FakeHTMLElement);
    const discardPile = new FakeHTMLElement({
      animationAnchor: 'discard-pile',
      animationAnchorKey: 'player:0:discard-pile',
    });
    vi.stubGlobal('document', {
      querySelectorAll: () => [],
      querySelector: (selector: string) =>
        selector === '[data-animation-anchor-key="player:0:discard-pile"]'
          ? discardPile
          : null,
    });

    expect(animationElementForMotionAnchor(
      { kind: 'discard-card', playerIndex: 0, serial: 99 },
      { kind: 'card', serial: 99 },
    )).toBe(discardPile);
  });
});
