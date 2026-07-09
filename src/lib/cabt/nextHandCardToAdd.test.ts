import { describe, expect, it } from 'vitest';
import { nextHandCardToAdd } from './cabtReplay';
import type { CardView } from '../game/types';

// Pre-state hand projection appends one card per hand-add event as the hand
// grows from its pre-state toward the settled hand. Regression guard for the
// duplicate-serial collision (M1): when the settled hand reorders its known
// serials, positional indexing minted a card the pre-state hand already held,
// producing two cards with the same serial and colliding Hand.svelte's keyed
// each-block.
function card(serial: number | undefined): CardView {
  return { serial, name: serial === undefined ? 'face-down' : `card-${serial}`, fullName: '' };
}

const serialsOf = (hand: CardView[]) => hand.map((c) => c.serial);

describe('nextHandCardToAdd', () => {
  it('appends the trailing card for a plain draw (settled = pre + appended)', () => {
    const pre = [card(91), card(95)];
    const settled = [card(91), card(95), card(120)];
    expect(nextHandCardToAdd(pre, settled).serial).toBe(120);
  });

  it('never re-adds a serial the pre-state hand already holds (the M1 reorder)', () => {
    // Pre-state hand ends with serial 99; the settled hand moved 99 to the last
    // index and slotted the genuinely-new card earlier. Positional indexing
    // would have grabbed 99 again.
    const pre = [card(91), card(95), card(105), card(96), card(121), card(99)];
    const settled = [card(91), card(95), card(105), card(96), card(121), card(7), card(99)];
    const added = nextHandCardToAdd(pre, settled);
    expect(added.serial).toBe(7);
    const result = [...pre, added];
    const defined = serialsOf(result).filter((s): s is number => s !== undefined);
    expect(new Set(defined).size).toBe(defined.length);
  });

  it('returns the positional face-down card when the drawn card is concealed', () => {
    const pre = [card(91), card(95)];
    const settled = [card(91), card(95), card(undefined)];
    expect(nextHandCardToAdd(pre, settled).serial).toBeUndefined();
  });

  it('falls back to a face-down card when the settled hand has no novel serial', () => {
    const pre = [card(91), card(95)];
    const settled = [card(91), card(95)]; // degenerate: nothing genuinely new
    expect(nextHandCardToAdd(pre, settled).serial).toBeUndefined();
  });
});
