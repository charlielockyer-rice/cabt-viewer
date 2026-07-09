// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { boardClaimIsAuthoritative, claimSignature } from './settleClaim';

function slot(serial: string): HTMLElement {
  const el = document.createElement('div');
  el.dataset.pokemonSerial = serial;
  document.body.appendChild(el);
  return el;
}

describe('boardClaimIsAuthoritative (board-move settle release rule)', () => {
  it('defers while the claimed element is still attached and shows the same card', () => {
    // Destination card may still be painting — hold the sprite past the settle
    // window (the genuine gap-avoidance case).
    const el = slot('85');
    expect(boardClaimIsAuthoritative(el, claimSignature(el))).toBe(false);
  });

  it('releases immediately when the attached element now shows a different card', () => {
    // Position-keyed slot (e.g. the active slot) mutated in place: serial changed
    // => the settled occupant is authoritative.
    const el = slot('85');
    const signature = claimSignature(el);
    el.dataset.pokemonSerial = '80';
    expect(boardClaimIsAuthoritative(el, signature)).toBe(true);
  });

  it('releases immediately when the claimed element has left the document', () => {
    // Identity-keyed bench slot: the vacating occupant's node is DESTROYED on a
    // swap and the arriving card renders in a fresh, authoritative node. The
    // stale detached node's dataset is frozen, so a signature-only check would
    // wrongly "match" and DEFER — lingering the sprite over the settled card and
    // doubling its drop-shadow (the reopened #26 regression). The detached check
    // is what keeps the sprite dropping synchronously.
    const el = slot('80');
    const signature = claimSignature(el);
    el.remove();
    expect(el.dataset.pokemonSerial).toBe('80'); // frozen: signature still "matches"
    expect(claimSignature(el)).toBe(signature);
    expect(boardClaimIsAuthoritative(el, signature)).toBe(true);
  });

  it('a switch releases ALL its claims immediately (no deferred sprite hold)', () => {
    // The full switch shape: the active slot mutates in place (85 -> 80), the
    // bench slot node is destroyed (80 leaves) and recreated (85 arrives). Every
    // claim must be authoritative, so endScope drops both sprites synchronously.
    const activeSlot = slot('85');
    const benchSlot = slot('80');
    const activeSig = claimSignature(activeSlot);
    const benchSig = claimSignature(benchSlot);
    // post-swap DOM: active mutates in place, bench node is replaced.
    activeSlot.dataset.pokemonSerial = '80';
    benchSlot.remove();
    const newBench = slot('85');
    void newBench;
    expect(boardClaimIsAuthoritative(activeSlot, activeSig)).toBe(true);
    expect(boardClaimIsAuthoritative(benchSlot, benchSig)).toBe(true);
  });
});
