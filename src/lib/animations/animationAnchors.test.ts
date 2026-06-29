import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  animationAnchorAttributes,
  animationAnchorCandidateSelectors,
  animationAnchorSelector,
  animationIdentityForElement,
  animationIdentityKindForAnchor,
  parseAnimationAnchor,
  parseAnimationIdentity,
  resolveAnimationAnchorElements,
  serializeAnimationAnchor,
  serializeAnimationIdentity,
  type AnimationAnchorRef,
} from './animationAnchors';

describe('animation anchors', () => {
  beforeEach(() => {
    vi.stubGlobal('HTMLElement', TestElement);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const anchors: AnimationAnchorRef[] = [
    { kind: 'hand', playerIndex: 0 },
    { kind: 'hand-slot', playerIndex: 0, handIndex: 3 },
    { kind: 'hand-card', playerIndex: 0, handIndex: 3, serial: 91 },
    { kind: 'deck-top', playerIndex: 1 },
    { kind: 'discard-pile', playerIndex: 1 },
    { kind: 'discard-card', playerIndex: 1, serial: 12 },
    { kind: 'play-zone-card', playerIndex: 0, serial: 13 },
    { kind: 'stadium-card', playerIndex: 1, serial: 14 },
    { kind: 'pokemon-card', playerIndex: 0, slot: 'active', slotIndex: 0, serial: 15 },
    { kind: 'board-slot', playerIndex: 0, slot: 'bench', slotIndex: 2 },
    { kind: 'attached-energy', playerIndex: 1, slot: 'active', slotIndex: 0, serial: 16 },
    { kind: 'attached-tool', playerIndex: 1, slot: 'bench', slotIndex: 4, serial: 17 },
    { kind: 'prize-card', playerIndex: 0, prizeIndex: 5 },
    { kind: 'prize-card', playerIndex: 0, prizeIndex: 4, face: 'back' },
    { kind: 'reveal-card', playerIndex: 1, revealIndex: 6, serial: 18 },
  ];

  it('round-trips supported anchor references', () => {
    for (const anchor of anchors) {
      expect(parseAnimationAnchor(serializeAnimationAnchor(anchor))).toEqual(anchor);
    }
  });

  it('rejects malformed anchor strings', () => {
    expect(parseAnimationAnchor('player:x:deck-top')).toBeNull();
    expect(parseAnimationAnchor('player:0:unknown')).toBeNull();
    expect(parseAnimationAnchor('player:0:pokemon-card:discard:0')).toBeNull();
    expect(parseAnimationAnchor('player:0:prize-card:nope')).toBeNull();
  });

  it('round-trips identities', () => {
    const identity = { kind: 'pokemon' as const, serial: 42, cardId: 99, name: 'Hop’s Snorlax' };
    const serialized = serializeAnimationIdentity(identity);
    expect(parseAnimationIdentity(serialized)).toEqual(identity);
  });

  it('builds attributes and selectors from semantic anchors', () => {
    const anchor = { kind: 'pokemon-card' as const, playerIndex: 0, slot: 'bench' as const, slotIndex: 1, serial: 7 };
    const attrs = animationAnchorAttributes(anchor, { kind: 'pokemon', serial: 7, cardId: 143 });

    expect(attrs['data-animation-anchor']).toBe('pokemon-card');
    expect(attrs['data-animation-anchor-key']).toBe('player:0:pokemon-card:bench:1:serial:7');
    expect(attrs['data-animation-player']).toBe(0);
    expect(attrs['data-animation-slot']).toBe('bench');
    expect(attrs['data-animation-card-serial']).toBe(7);
    expect(attrs['data-animation-card-id']).toBe(143);
    expect(animationAnchorSelector(anchor, { kind: 'pokemon', serial: 7 })).toContain('data-animation-card-serial="7"');
  });

  it('serializes hand card anchors with serial-sensitive stable keys', () => {
    const anchor = { kind: 'hand-card' as const, playerIndex: 0, handIndex: 2, serial: 77 };

    expect(serializeAnimationAnchor(anchor)).toBe('player:0:hand-card:index:2:serial:77');
    expect(animationAnchorSelector(anchor, { kind: 'card', serial: 77 })).toBe(
      '[data-animation-anchor-key="player:0:hand-card:index:2:serial:77"][data-animation-card-serial="77"]',
    );
  });

  it('serializes attached card anchors with serial-sensitive stable keys', () => {
    const energy = { kind: 'attached-energy' as const, playerIndex: 1, slot: 'bench' as const, slotIndex: 3, serial: 91 };
    const tool = { kind: 'attached-tool' as const, playerIndex: 1, slot: 'active' as const, slotIndex: 0, serial: 92 };

    expect(serializeAnimationAnchor(energy)).toBe('player:1:attached-energy:bench:3:serial:91');
    expect(serializeAnimationAnchor(tool)).toBe('player:1:attached-tool:active:0:serial:92');
    expect(animationAnchorSelector(energy, { kind: 'energy', serial: 91, cardId: 5 })).toBe(
      '[data-animation-anchor-key="player:1:attached-energy:bench:3:serial:91"][data-animation-card-serial="91"][data-animation-card-id="5"]',
    );
  });

  it('builds identity fallback selectors while preserving the anchor-key selector', () => {
    const anchor = { kind: 'hand-card' as const, playerIndex: 0, handIndex: 1 };

    expect(animationAnchorCandidateSelectors(anchor, { kind: 'card', cardId: 44, name: 'Rare Candy' })).toEqual([
      '[data-animation-anchor-key="player:0:hand-card:index:1"][data-animation-card-id="44"][data-animation-card-name="Rare Candy"]',
      '[data-animation-anchor-key="player:0:hand-card:index:1"][data-animation-card-id="44"]',
      '[data-animation-anchor-key="player:0:hand-card:index:1"][data-animation-card-name="Rare Candy"]',
      '[data-animation-anchor-key="player:0:hand-card:index:1"]',
    ]);
  });

  it('resolves legacy key-only DOM when identity attributes are unavailable', () => {
    const anchor = { kind: 'hand-card' as const, playerIndex: 0, handIndex: 1 };
    const element = new TestElement({
      animationAnchor: 'hand-card',
      animationAnchorKey: 'player:0:hand-card:index:1',
    });
    const root = queryRoot([element]);

    expect(resolveAnimationAnchorElements(anchor, {
      root,
      identity: { kind: 'card', cardId: 44, name: 'Rare Candy' },
    })).toEqual([element]);
  });

  it('uses serial identity when the current DOM exposes it', () => {
    const anchor = { kind: 'hand-card' as const, playerIndex: 0, handIndex: 1 };
    const matching = new TestElement({
      animationAnchor: 'hand-card',
      animationAnchorKey: 'player:0:hand-card:index:1',
      animationCardSerial: '10',
    });
    const other = new TestElement({
      animationAnchor: 'hand-card',
      animationAnchorKey: 'player:0:hand-card:index:1',
      animationCardSerial: '11',
    });
    const root = queryRoot([matching, other]);

    expect(resolveAnimationAnchorElements(anchor, {
      root,
      identity: { kind: 'card', serial: 10 },
    })).toEqual([matching]);
  });

  it('infers identity serials from legacy anchor keys', () => {
    const element = new TestElement({
      animationAnchor: 'attached-energy',
      animationAnchorKey: 'player:1:attached-energy:bench:3:serial:91',
    });

    expect(animationIdentityForElement(element)).toEqual({
      kind: 'energy',
      serial: 91,
    });
  });

  it('infers identity kinds from anchor kinds', () => {
    expect(animationIdentityKindForAnchor('pokemon-card')).toBe('pokemon');
    expect(animationIdentityKindForAnchor('attached-energy')).toBe('energy');
    expect(animationIdentityKindForAnchor('attached-tool')).toBe('tool');
    expect(animationIdentityKindForAnchor('stadium-card')).toBe('stadium');
    expect(animationIdentityKindForAnchor('prize-card')).toBe('prize');
    expect(animationIdentityKindForAnchor('discard-card')).toBe('card');
    expect(animationIdentityKindForAnchor('board-slot')).toBeNull();
  });
});

class TestElement {
  dataset: Record<string, string>;

  constructor(dataset: Record<string, string>) {
    this.dataset = dataset;
  }
}

function queryRoot(elements: TestElement[]): ParentNode {
  return {
    querySelectorAll: (selector: string) => {
      const anchorKey = selector.match(/data-animation-anchor-key="([^"]+)"/)?.[1];
      const serial = selector.match(/data-animation-card-serial="([^"]+)"/)?.[1];
      const cardId = selector.match(/data-animation-card-id="([^"]+)"/)?.[1];
      const cardName = selector.match(/data-animation-card-name="([^"]+)"/)?.[1];
      return elements.filter((element) => {
        if (anchorKey && element.dataset.animationAnchorKey !== anchorKey) {
          return false;
        }
        if (serial && element.dataset.animationCardSerial !== serial) {
          return false;
        }
        if (cardId && element.dataset.animationCardId !== cardId) {
          return false;
        }
        if (cardName && element.dataset.animationCardName !== cardName) {
          return false;
        }
        return true;
      }) as unknown as NodeListOf<Element>;
    },
  } as ParentNode;
}
