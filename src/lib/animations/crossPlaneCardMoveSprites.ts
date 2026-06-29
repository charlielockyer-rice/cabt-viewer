import {
  centerOf,
  isConcealedHandTarget,
  strictVisualElementForMotionAnchor,
} from './viewportCardMotion';
import type { CardMoveAnimationMotion } from './replayAnimationPlan';
import type { CardView } from '../game/types';

export type CrossPlaneSprite = {
  id: string;
  card: CardView;
  left: number;
  top: number;
  width: number;
  height: number;
  moveX: number;
  moveY: number;
  targetScale: number;
  delayMs: number;
  durationMs: number;
  faceDown: boolean;
  opponentSide: boolean;
};

export type CrossPlaneMotionElements = {
  sourceElement?: HTMLElement;
  targetElement?: HTMLElement;
};

export function crossPlaneSpriteForMotion(
  motion: CardMoveAnimationMotion,
  currentGeneration: number,
  elements: CrossPlaneMotionElements = elementsForMotion(motion),
): CrossPlaneSprite[] {
  if (motion.spriteVisual.kind !== 'card' || !motion.spriteVisual.card) {
    return [];
  }
  const { sourceElement, targetElement } = elements;
  if (!sourceElement || !targetElement) {
    return [];
  }
  const sourceRect = sourceRectForElement(sourceElement);
  const targetRect = targetElement.getBoundingClientRect();
  if (!sourceRect || !targetRect || sourceRect.width <= 0 || sourceRect.height <= 0 || targetRect.width <= 0 || targetRect.height <= 0) {
    return [];
  }
  const sourceCenter = centerOf(sourceRect);
  const targetCenter = centerOf(targetRect);
  return [{
    id: crossPlaneSpriteId(motion, currentGeneration),
    card: motion.spriteVisual.card,
    left: sourceRect.left,
    top: sourceRect.top,
    width: sourceRect.width,
    height: sourceRect.height,
    moveX: targetCenter.x - sourceCenter.x,
    moveY: targetCenter.y - sourceCenter.y,
    targetScale: targetRect.width / sourceRect.width,
    delayMs: motion.startMs,
    durationMs: motion.durationMs,
    faceDown: isConcealedHandTarget(targetElement),
    opponentSide: isOpponentSide(sourceElement) || isOpponentSide(targetElement),
  }];
}

export function crossPlaneSpriteId(motion: CardMoveAnimationMotion, currentGeneration: number): string {
  return `${currentGeneration}:${motion.id}`;
}

function elementsForMotion(motion: CardMoveAnimationMotion): CrossPlaneMotionElements {
  return {
    sourceElement: strictVisualElementForMotionAnchor(motion.sourceAnchor, motion.identity),
    targetElement: strictVisualElementForMotionAnchor(motion.targetAnchor, motion.identity),
  };
}

function sourceRectForElement(source: HTMLElement): DOMRect {
  const ownerCard = source.closest('.board-slot')?.querySelector('.card-tile');
  return (ownerCard instanceof HTMLElement ? ownerCard : source).getBoundingClientRect();
}

function isOpponentSide(element: HTMLElement): boolean {
  return !!element.closest('.player-panel.top, .top-active-slot, .bench-row.opponent');
}
