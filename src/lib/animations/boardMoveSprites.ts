import { cabtCardToView } from '../cabt/cardView';
import type { CardMoveAnimationMotion } from './replayAnimationPlan';
import type { PlaneRect } from '../dom/planeGeometry';
import type { CardView } from '../game/types';

export type BoardMoveSpriteBase = {
  id: string;
  html?: string;
  fallbackName: string;
  left: number;
  top: number;
  width: number;
  height: number;
  startX: number;
  startY: number;
  startScale: number;
  correctionX: number;
  correctionY: number;
  toDeck: boolean;
  fromDeck: boolean;
  opponentSide: boolean;
  delayMs: number;
  durationMs: number;
  measuring: boolean;
  card?: Pick<CardView, 'id' | 'serial' | 'name' | 'fullName' | 'cardImage' | 'imageUrl'>;
  faceDown?: boolean;
};

export type PlannedBoardMoveSprite = BoardMoveSpriteBase & { lifecycle: { kind: 'planned' } };
export type LiveBoardMoveSprite = BoardMoveSpriteBase & { lifecycle: { kind: 'live'; handoff: LiveBoardMoveHandoff } };
export type BoardMoveSprite = PlannedBoardMoveSprite | LiveBoardMoveSprite;

export type LiveBoardMoveHandoff = {
  destinationCardId: number;
  destinationSerial?: number;
  waitForDestinationCard: boolean;
};

export type LiveBoardMoveSpriteInput = {
  source: HTMLElement;
  target: HTMLElement;
  sourceRect: PlaneRect;
  targetRect: PlaneRect;
  generation: number;
  key: string;
  cardId?: number;
  serial?: number;
  fallbackName?: string;
  waitForDestinationCard: boolean;
  toDeck: boolean;
  fromDeck: boolean;
  opponentSide: boolean;
  delayMs: number;
  durationMs: number;
};

export function plannedBoardMoveSpriteForMotion(input: {
  motion: CardMoveAnimationMotion;
  sourceRect: PlaneRect;
  targetRect: PlaneRect;
  generation: number;
  opponentSide: boolean;
}): PlannedBoardMoveSprite | undefined {
  const { motion, sourceRect, targetRect, generation, opponentSide } = input;
  if (motion.spriteVisual.kind !== 'card' || !isUsableBoardMoveRects(sourceRect, targetRect)) {
    return undefined;
  }
  const card = motion.spriteVisual.card;
  const faceDown = motion.spriteVisual.faceDown;
  if (!card && !faceDown) {
    return undefined;
  }
  const cardId = motion.identity?.cardId ?? card?.id;
  return {
    ...boardMoveSpriteGeometry(sourceRect, targetRect),
    id: `${generation}:${motion.id}`,
    fallbackName: motion.identity?.name ?? card?.name ?? (cardId !== undefined ? cabtCardToView(cardId).name : 'Card'),
    toDeck: motion.targetAnchor.kind === 'deck-top',
    fromDeck: motion.sourceAnchor.kind === 'deck-top',
    opponentSide,
    delayMs: motion.startMs,
    durationMs: motion.durationMs,
    card,
    faceDown,
    lifecycle: { kind: 'planned' },
  };
}

export function liveBoardMoveSpriteForInput(input: LiveBoardMoveSpriteInput): LiveBoardMoveSprite | undefined {
  if (!isUsableBoardMoveRects(input.sourceRect, input.targetRect)) {
    return undefined;
  }
  return {
    ...boardMoveSpriteGeometry(input.sourceRect, input.targetRect),
    id: `${input.generation}:${input.key}`,
    html: boardMoveSpriteHtml(input.source, input.target, input.fromDeck),
    fallbackName: input.fallbackName ?? (input.cardId !== undefined ? cabtCardToView(input.cardId).name : 'Card'),
    toDeck: input.toDeck,
    fromDeck: input.fromDeck,
    opponentSide: input.opponentSide,
    delayMs: input.delayMs,
    durationMs: input.durationMs,
    lifecycle: {
      kind: 'live',
      handoff: {
        destinationCardId: input.cardId ?? 0,
        destinationSerial: input.serial,
        waitForDestinationCard: input.waitForDestinationCard,
      },
    },
  };
}

export function boardMoveSpriteHtml(source: HTMLElement, target: HTMLElement, fromDeck = false): string {
  const cloneSource = fromDeck ? target : source;
  const clone = cloneSource.cloneNode(true);
  if (!(clone instanceof HTMLElement)) {
    return cloneSource.outerHTML;
  }

  if (cloneSource.classList.contains('stadium-card')) {
    const cardTile = cloneSource.querySelector('.card-tile');
    return cardTile instanceof HTMLElement ? cardTile.outerHTML : cloneSource.outerHTML;
  }

  clone.className = target.classList.contains('board-slot') ? target.className : source.className;
  clone.classList.remove('empty');
  clone.classList.add('board-slot');
  clone.removeAttribute('id');
  clone.removeAttribute('data-testid');
  clone.removeAttribute('data-card-anchor');
  clone.removeAttribute('data-owner-index');
  clone.removeAttribute('data-slot-kind');
  clone.removeAttribute('data-slot-index');
  clone.removeAttribute('data-pokemon-card-id');
  clone.removeAttribute('data-pokemon-serial');
  clone.removeAttribute('title');
  clone.removeAttribute('data-board-move-animation-hidden');
  clone.removeAttribute('data-reveal-animation-hidden');
  stripAnimationAttributes(clone);
  prepareCloneImages(clone);
  return clone.outerHTML;
}

function boardMoveSpriteGeometry(sourceRect: PlaneRect, targetRect: PlaneRect) {
  return {
    left: targetRect.left,
    top: targetRect.top,
    width: targetRect.width,
    height: targetRect.height,
    startX: sourceRect.left + sourceRect.width / 2 - (targetRect.left + targetRect.width / 2),
    startY: sourceRect.top + sourceRect.height / 2 - (targetRect.top + targetRect.height / 2),
    startScale: sourceRect.width / targetRect.width,
    correctionX: 0,
    correctionY: 0,
    measuring: true,
  };
}

function isUsableBoardMoveRects(sourceRect: PlaneRect, targetRect: PlaneRect): boolean {
  return sourceRect.width > 0
    && targetRect.width > 0
    && sourceRect.height > 0
    && targetRect.height > 0;
}

function stripAnimationAttributes(clone: HTMLElement) {
  for (const element of [clone, ...clone.querySelectorAll('*')]) {
    if (!(element instanceof HTMLElement)) {
      continue;
    }
    for (const attribute of Array.from(element.attributes)) {
      if (attribute.name.startsWith('data-animation-')) {
        element.removeAttribute(attribute.name);
      }
    }
  }
}

function prepareCloneImages(clone: HTMLElement) {
  for (const image of clone.querySelectorAll('img')) {
    image.loading = 'eager';
    image.decoding = 'sync';
  }
}
