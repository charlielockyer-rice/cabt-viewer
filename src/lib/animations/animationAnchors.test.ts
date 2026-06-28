import { describe, expect, it } from 'vitest';
import {
  animationAnchorAttributes,
  animationAnchorSelector,
  animationIdentityKindForAnchor,
  parseAnimationAnchor,
  parseAnimationIdentity,
  serializeAnimationAnchor,
  serializeAnimationIdentity,
  type AnimationAnchorRef,
} from './animationAnchors';

describe('animation anchors', () => {
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
