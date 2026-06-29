import {
  resolveStrictAnimationAnchorElement,
  type AnimationAnchorRef,
  type AnimationIdentity,
} from './animationAnchors';

export function strictAnimationVisualElementForAnchor(
  anchor: AnimationAnchorRef,
  identity?: AnimationIdentity,
): HTMLElement | undefined {
  const element = resolveStrictAnimationAnchorElement(anchor, { identity });
  return element ? visualElementForResolvedAnchor(element, anchor.kind) : undefined;
}

export function visualElementForResolvedAnchor(
  element: HTMLElement,
  anchorKind: AnimationAnchorRef['kind'],
): HTMLElement {
  if (anchorKind === 'deck-top') {
    const pile = element.closest('.deck-pile');
    if (pile instanceof HTMLElement) {
      const face = pile.querySelector('.deck-card-face');
      return face instanceof HTMLElement ? face : pile;
    }
  }
  if (anchorKind === 'hand-card'
    || anchorKind === 'discard-card'
    || anchorKind === 'play-zone-card'
    || anchorKind === 'stadium-card') {
    const card = element.classList.contains('card-tile') ? element : element.querySelector('.card-tile');
    return card instanceof HTMLElement ? card : element;
  }
  if (anchorKind === 'discard-pile') {
    const topCard = element.querySelector('.discard-card-top .card-tile');
    return topCard instanceof HTMLElement ? topCard : element;
  }
  return element;
}
