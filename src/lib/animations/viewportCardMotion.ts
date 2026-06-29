import {
  resolveStrictAnimationAnchorElement,
} from './animationAnchors';
import type { CardMoveAnimationMotion } from './replayAnimationPlan';
import { cabtCardToView } from '../cabt/cardView';
import type { CardView } from '../game/types';

export const cardHeightToWidthRatio = 88 / 63;

export type ViewportRect = Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>;

export function animationElementForMotionAnchor(
  anchor: CardMoveAnimationMotion['sourceAnchor'],
  identity: CardMoveAnimationMotion['identity'],
): HTMLElement | undefined {
  const element = resolveStrictAnimationAnchorElement(anchor, { identity });
  if (!element) {
    return undefined;
  }
  if (anchor.kind === 'deck-top') {
    const pile = element.closest('.deck-pile');
    if (pile instanceof HTMLElement) {
      const face = pile.querySelector('.deck-card-face');
      return face instanceof HTMLElement ? face : pile;
    }
  }
  if (anchor.kind === 'hand-card') {
    const visual = element.querySelector('.card-tile');
    return visual instanceof HTMLElement ? visual : element;
  }
  return element;
}

export function plannedMotionCard(motion: CardMoveAnimationMotion): CardView | undefined {
  if (motion.spriteVisual.kind !== 'card') {
    return undefined;
  }
  const cardId = motion.identity?.cardId ?? motion.spriteVisual.card?.id;
  if (!Number.isFinite(Number(cardId))) {
    return undefined;
  }
  return {
    ...cabtCardToView(Number(cardId)),
    ...(motion.spriteVisual.card ?? {}),
    serial: motion.identity?.serial ?? motion.spriteVisual.card?.serial,
  };
}

export function plannedMotionFaceDown(motion: CardMoveAnimationMotion): boolean {
  return motion.spriteVisual.kind === 'card' && motion.spriteVisual.faceDown === true;
}

export function isConcealedHandTarget(element: HTMLElement): boolean {
  return !!element.closest('.hand.concealed');
}

export function deckTopElement(playerIndex: number): HTMLElement | null {
  const anchor = document.querySelector(`[data-card-anchor="player:${playerIndex}:deck"]`);
  const pile = anchor?.closest('.deck-pile') as HTMLElement | null;
  return pile?.querySelector('.deck-card-face') ?? pile;
}

export function handAnchor(playerIndex: number): HTMLElement | null {
  return document.querySelector(`[data-card-anchor="player:${playerIndex}:hand"]`);
}

export function handCardSlots(handElement: HTMLElement, playerIndex: number): HTMLElement[] {
  return Array.from(handElement.querySelectorAll(`[data-hand-card-slot^="player:${playerIndex}:hand:"]`))
    .filter((element): element is HTMLElement => element instanceof HTMLElement);
}

export function handSlotForSerial(handSlots: HTMLElement[], serial: number): HTMLElement | undefined {
  if (!Number.isFinite(serial)) {
    return undefined;
  }
  return handSlots.find((element) => Number(element.dataset.cardSerial) === serial);
}

export function handCardVisualRect(targetElement: HTMLElement | undefined): DOMRect | undefined {
  if (!targetElement) {
    return undefined;
  }
  const visual = targetElement.querySelector('.card-tile');
  if (visual instanceof HTMLElement) {
    const rect = visual.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      return rect;
    }
  }
  const rect = targetElement.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 ? rect : undefined;
}

export function fallbackHandTarget(handRect: DOMRect, index: number, count: number): DOMRect {
  const width = Math.min(handRect.height / cardHeightToWidthRatio, handRect.width / Math.max(1, count));
  const height = width * cardHeightToWidthRatio;
  const step = Math.min(width * 0.82, handRect.width / Math.max(1, count));
  const centerX = handRect.left + handRect.width / 2 + (index - (count - 1) / 2) * step;
  const centerY = handRect.top + handRect.height / 2;
  return {
    left: centerX - width / 2,
    top: centerY - height / 2,
    right: centerX + width / 2,
    bottom: centerY + height / 2,
    x: centerX - width / 2,
    y: centerY - height / 2,
    width,
    height,
    toJSON: () => ({}),
  } as DOMRect;
}

export function centerOf(rect: ViewportRect): { x: number; y: number } {
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
  };
}
