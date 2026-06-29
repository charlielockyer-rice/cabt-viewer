import type { CardMoveAnimationMotion } from './replayAnimationPlan';
import { strictAnimationVisualElementForAnchor } from './animationAnchorVisuals';
import { cabtCardToView } from '../cabt/cardView';
import type { CardView } from '../game/types';

export const cardHeightToWidthRatio = 88 / 63;

export type ViewportRect = Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>;

export type RevealedCardLayout = {
  cardWidth: number;
  cardHeight: number;
  target(index: number): {
    x: number;
    y: number;
    rotation: number;
  };
};

export type RevealedCardLayoutInput = {
  viewportWidth?: number;
  viewportHeight?: number;
  boardRect?: ViewportRect;
};

export function strictVisualElementForMotionAnchor(
  anchor: CardMoveAnimationMotion['sourceAnchor'],
  identity: CardMoveAnimationMotion['identity'],
): HTMLElement | undefined {
  return strictAnimationVisualElementForAnchor(anchor, identity);
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

export function revealedCardLayout(count: number, input: RevealedCardLayoutInput = {}): RevealedCardLayout {
  const viewportWidth = input.viewportWidth ?? (typeof window === 'undefined' ? 1200 : window.innerWidth);
  const viewportHeight = input.viewportHeight ?? (typeof window === 'undefined' ? 800 : window.innerHeight);
  const boardRect = input.boardRect ?? (typeof document === 'undefined'
    ? undefined
    : document.querySelector('.playmat')?.getBoundingClientRect());
  const layoutCount = Math.max(1, count);
  const centerX = boardRect ? boardRect.left + boardRect.width / 2 : viewportWidth / 2;
  const centerY = boardRect ? boardRect.top + boardRect.height * 0.5 : viewportHeight * 0.47;
  const maxWidth = boardRect ? boardRect.width - 96 : viewportWidth - 96;
  const availableWidth = Math.max(220, maxWidth);
  const spacingRatio = viewportWidth < 760 ? 0.62 : 0.7;
  const minCardWidth = viewportWidth < 760 ? 92 : 112;
  const maxColumns = Math.max(1, Math.floor(((availableWidth / minCardWidth) - 1) / spacingRatio + 1));
  const columns = Math.min(layoutCount, maxColumns);
  const rows = Math.ceil(layoutCount / columns);
  const boardHeight = boardRect?.height ?? viewportHeight;
  const revealBandHeight = boardHeight * (viewportWidth < 760 ? 0.46 : 0.52);
  const maxByHeight = revealBandHeight / (cardHeightToWidthRatio * (rows + Math.max(0, rows - 1) * 0.08));
  const maxReadableWidth = Math.min(viewportWidth < 760 ? 174 : 252, availableWidth, maxByHeight);
  const countScale = layoutCount <= 1 ? 1 : layoutCount <= 2 ? 0.9 : layoutCount <= 4 ? 0.78 : layoutCount <= 6 ? 0.68 : 0.58;
  const desiredCardWidth = maxReadableWidth * countScale;
  const maxByWidth = availableWidth / (1 + spacingRatio * Math.max(0, columns - 1));
  const cardWidth = Math.max(minCardWidth, Math.min(maxReadableWidth, desiredCardWidth, maxByWidth));
  const cardHeight = cardWidth * cardHeightToWidthRatio;
  const spacing = cardWidth * spacingRatio;
  const rotationStep = layoutCount <= 1 ? 0 : Math.min(5, 20 / Math.max(1, layoutCount - 1));
  const arcDrop = cardWidth * 0.045;
  const rowGap = cardHeight * 0.08;
  const totalHeight = rows * cardHeight + Math.max(0, rows - 1) * rowGap;
  const originY = centerY - totalHeight / 2 + cardHeight / 2;

  return {
    cardWidth,
    cardHeight,
    target(index: number) {
      const row = Math.floor(index / columns);
      const rowStart = row * columns;
      const cardsInRow = Math.min(columns, layoutCount - rowStart);
      const column = index - rowStart;
      const offset = column - (cardsInRow - 1) / 2;
      return {
        x: centerX + offset * spacing,
        y: originY + row * (cardHeight + rowGap) + Math.abs(offset) * arcDrop,
        rotation: offset * rotationStep,
      };
    },
  };
}
