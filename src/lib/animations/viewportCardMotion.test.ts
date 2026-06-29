import { afterEach, describe, expect, it, vi } from 'vitest';
import { animationElementForMotionAnchor } from './viewportCardMotion';

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

describe('animationElementForMotionAnchor', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does not broaden an unresolved discard card to the discard pile surface', () => {
    vi.stubGlobal('HTMLElement', FakeHTMLElement);
    vi.stubGlobal('document', {
      querySelectorAll: () => [],
    });

    expect(animationElementForMotionAnchor(
      { kind: 'discard-card', playerIndex: 0, serial: 99 },
      { kind: 'card', serial: 99 },
    )).toBeUndefined();
  });
});
