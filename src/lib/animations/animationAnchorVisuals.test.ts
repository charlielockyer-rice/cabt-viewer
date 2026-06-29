import { afterEach, describe, expect, it, vi } from 'vitest';
import { strictAnimationVisualElementForAnchor } from './animationAnchorVisuals';

class FakeHTMLElement {
  dataset: Record<string, string | undefined>;
  className: string;
  parent?: FakeHTMLElement;
  children = new Map<string, FakeHTMLElement>();

  constructor(input: {
    dataset?: Record<string, string | undefined>;
    className?: string;
    parent?: FakeHTMLElement;
  } = {}) {
    this.dataset = input.dataset ?? {};
    this.className = input.className ?? '';
    this.parent = input.parent;
  }

  get classList() {
    return {
      contains: (className: string) => this.className.split(/\s+/).includes(className),
    };
  }

  closest(selector: string): FakeHTMLElement | null {
    if (selector === '.deck-pile') {
      return this.classList.contains('deck-pile') ? this : (this.parent?.closest(selector) ?? null);
    }
    if (selector === '[data-animation-anchor-key]') {
      return this.dataset.animationAnchorKey ? this : null;
    }
    return null;
  }

  querySelector(selector: string): FakeHTMLElement | null {
    return this.children.get(selector) ?? null;
  }
}

describe('strictAnimationVisualElementForAnchor', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does not broaden an unresolved discard card to the discard pile surface', () => {
    installAnchorDocument([]);

    expect(strictAnimationVisualElementForAnchor(
      { kind: 'discard-card', playerIndex: 0, serial: 99 },
      { kind: 'card', serial: 99 },
    )).toBeUndefined();
  });

  it('uses the visible card tile for specific card anchors', () => {
    const cardTile = new FakeHTMLElement({ className: 'card-tile' });
    const anchor = new FakeHTMLElement({
      dataset: {
        animationAnchor: 'discard-card',
        animationAnchorKey: 'player:0:discard-card:serial:99',
        animationCardSerial: '99',
      },
    });
    anchor.children.set('.card-tile', cardTile);
    installAnchorDocument([anchor]);

    expect(strictAnimationVisualElementForAnchor(
      { kind: 'discard-card', playerIndex: 0, serial: 99 },
      { kind: 'card', serial: 99 },
    )).toBe(cardTile);
  });

  it('uses the deck face for deck-top anchors', () => {
    const deckPile = new FakeHTMLElement({ className: 'deck-pile' });
    const deckFace = new FakeHTMLElement({ className: 'deck-card-face' });
    deckPile.children.set('.deck-card-face', deckFace);
    const anchor = new FakeHTMLElement({
      dataset: {
        animationAnchor: 'deck-top',
        animationAnchorKey: 'player:0:deck-top',
      },
      parent: deckPile,
    });
    installAnchorDocument([anchor]);

    expect(strictAnimationVisualElementForAnchor({ kind: 'deck-top', playerIndex: 0 })).toBe(deckFace);
  });

  it('uses the visible top card for discard pile surface anchors', () => {
    const topCard = new FakeHTMLElement({ className: 'card-tile' });
    const anchor = new FakeHTMLElement({
      dataset: {
        animationAnchor: 'discard-pile',
        animationAnchorKey: 'player:0:discard-pile',
      },
    });
    anchor.children.set('.discard-card-top .card-tile', topCard);
    installAnchorDocument([anchor]);

    expect(strictAnimationVisualElementForAnchor({ kind: 'discard-pile', playerIndex: 0 })).toBe(topCard);
  });
});

function installAnchorDocument(elements: FakeHTMLElement[]) {
  vi.stubGlobal('HTMLElement', FakeHTMLElement);
  vi.stubGlobal('document', {
    querySelectorAll: () => elements,
  });
}
