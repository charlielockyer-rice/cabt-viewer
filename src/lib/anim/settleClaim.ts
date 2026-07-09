// A board-move sprite's visibility claim hides the card's PRE-move slot so the
// static card and the flying sprite never both paint during the flight. At
// scope end the claim must release — and its sprite drop — the instant the
// destination view is authoritative (the settled card is already rendered), and
// only DEFER past the settle window when the destination card may not have
// painted yet. Releasing LATE overlaps the sprite with the settled card and
// doubles its drop-shadow (the retreat/switch "shadow flicker"); releasing EARLY
// gaps it (a blank slot for a frame). This is the round-4 settle-seam rule:
// release on the destination landing, never on a fixed clock.
export function claimSignature(element: HTMLElement): string {
  return element.dataset.pokemonSerial ?? element.dataset.cardSerial ?? '';
}

// The destination is authoritative — release now, don't hold the sprite — when
// EITHER:
//   - the claimed element has left the document. An identity-keyed slot (the
//     bench keys frames by Pokemon serial) DESTROYS a vacating occupant's node
//     on a swap and mints a fresh node for the arriving card, authoritative from
//     creation. The stale detached node covers nothing, so holding its claim
//     only lingers the sprite over the already-settled card. (Before this check
//     the switch fell into the defer branch because a detached node's dataset is
//     frozen, so its signature always "matched" — the shadow-flicker regression
//     after the bench was re-keyed by identity.)
//   - the claimed element is still attached but now shows a different card — a
//     position-keyed slot (e.g. the active slot, keyed by player index) mutated
//     in place, so its dataset serial changed.
// A still-attached element showing the SAME card means the settled card may
// still be painting, so the claim defers past the settle window.
export function boardClaimIsAuthoritative(element: HTMLElement, signature: string): boolean {
  return !element.isConnected || claimSignature(element) !== signature;
}
