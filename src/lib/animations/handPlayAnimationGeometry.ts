import type { Point } from '../dom/planeGeometry';
import type { CardView } from '../game/types';
import { cardHeightToWidthRatio } from './viewportCardMotion';

export type HandPlayCardVisual = {
  label: string;
  setLabel: string;
  typeClass: string;
};

export type RectSnapshot = {
  x: number;
  y: number;
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};

export function handPlayCardVisual(
  card: CardView | undefined,
  label = card?.name ?? 'Card',
): HandPlayCardVisual {
  return {
    label,
    setLabel: card ? [card.set, card.setNumber].filter(Boolean).join(' ') : '',
    typeClass: handPlayCardTypeClass(card),
  };
}

export function visibleElementRect(element: HTMLElement): DOMRect | undefined {
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 ? rect : undefined;
}

export function visibleCardRectForAnchor(element: HTMLElement): DOMRect | undefined {
  const card = element.classList.contains('card-tile') ? element : element.querySelector('.card-tile');
  return visibleElementRect(card instanceof HTMLElement ? card : element);
}

export function visualTargetForHandPlay(target: HTMLElement): HTMLElement {
  if (target.classList.contains('card-tile')) {
    return target;
  }
  const cardTile = target.querySelector('.card-tile');
  return cardTile instanceof HTMLElement ? cardTile : target;
}

export function slotAttachStartOffset(sourceRect: DOMRect, targetRect: DOMRect): { x: number; y: number } {
  const sourceCenter = rectCenter(sourceRect);
  const targetCenter = rectCenter(targetRect);
  return {
    x: clamp((sourceCenter.x - targetCenter.x) / targetRect.width, -0.72, 0.72),
    y: clamp((sourceCenter.y - targetCenter.y) / targetRect.height, -0.82, 0.82),
  };
}

export function sourceQuadForHandElement(sourceElement: HTMLElement, rect: DOMRect): Point[] {
  if (sourceElement.closest('.player-panel.top')) {
    return rotatedRectQuad(rect);
  }
  return rectQuad(rect);
}

export function cssMatrix3dForQuad(width: number, height: number, quad: Point[]): string | null {
  if (
    width <= 0
    || height <= 0
    || quad.length !== 4
    || quad.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))
  ) {
    return null;
  }

  const homography = solveHomography(
    [
      { x: 0, y: 0 },
      { x: width, y: 0 },
      { x: width, y: height },
      { x: 0, y: height },
    ],
    quad,
  );

  if (!homography || homography.some((value) => !Number.isFinite(value))) {
    return null;
  }

  return [
    'matrix3d(',
    formatMatrixNumber(homography[0]), ', ',
    formatMatrixNumber(homography[3]), ', ',
    '0, ',
    formatMatrixNumber(homography[6]), ', ',
    formatMatrixNumber(homography[1]), ', ',
    formatMatrixNumber(homography[4]), ', ',
    '0, ',
    formatMatrixNumber(homography[7]), ', ',
    '0, 0, 1, 0, ',
    formatMatrixNumber(homography[2]), ', ',
    formatMatrixNumber(homography[5]), ', ',
    '0, ',
    formatMatrixNumber(homography[8]),
    ')',
  ].join('');
}

export function sourceRectForHand(
  handElement: HTMLElement,
  serial: number,
  previousCardRects: ReadonlyMap<number, RectSnapshot>,
): DOMRect {
  const previousRect = previousCardRects.get(serial);
  if (previousRect) {
    return rectSnapshotToDomRect(previousRect);
  }

  if (Number.isFinite(serial)) {
    const matchingCard = handElement.querySelector(`[data-card-serial="${serial}"]`);
    if (matchingCard instanceof HTMLElement) {
      return matchingCard.getBoundingClientRect();
    }
  }

  const handRect = handElement.getBoundingClientRect();
  const cardRect = firstHandCardRect(handElement);
  const width = cardRect?.width ?? Math.min(handRect.width * 0.16, handRect.height / cardHeightToWidthRatio);
  const height = cardRect?.height ?? width * cardHeightToWidthRatio;
  return {
    left: handRect.left + handRect.width / 2 - width / 2,
    top: handRect.top + handRect.height / 2 - height / 2,
    right: handRect.left + handRect.width / 2 + width / 2,
    bottom: handRect.top + handRect.height / 2 + height / 2,
    x: handRect.left + handRect.width / 2 - width / 2,
    y: handRect.top + handRect.height / 2 - height / 2,
    width,
    height,
    toJSON: () => ({}),
  } as DOMRect;
}

export function hasKnownHandSource(
  handElement: HTMLElement,
  serial: number,
  previousCardRects: ReadonlyMap<number, RectSnapshot>,
): boolean {
  if (!Number.isFinite(serial)) {
    return false;
  }
  if (previousCardRects.has(serial)) {
    return true;
  }
  return handElement.querySelector(`[data-card-serial="${serial}"]`) instanceof HTMLElement;
}

export function snapshotHandCardRects(root: ParentNode = document): Map<number, RectSnapshot> {
  const nextRects = new Map<number, RectSnapshot>();
  for (const element of root.querySelectorAll('[data-card-anchor$=":hand"] [data-card-serial]')) {
    if (!(element instanceof HTMLElement)) {
      continue;
    }
    const serial = Number(element.dataset.cardSerial);
    if (!Number.isFinite(serial)) {
      continue;
    }
    const rect = element.getBoundingClientRect();
    nextRects.set(serial, rectSnapshot(rect));
  }
  return nextRects;
}

export function rectSnapshotToDomRect(rect: RectSnapshot): DOMRect {
  return {
    ...rect,
    toJSON: () => ({}),
  } as DOMRect;
}

function handPlayCardTypeClass(card: CardView | undefined): string {
  if (!card) {
    return 'pokemon';
  }
  if (card.energyType !== undefined || card.superType === 'Energy' || card.name.includes('Energy')) {
    return 'energy';
  }
  if (card.trainerType !== undefined || card.superType === 'Trainer') {
    return 'trainer';
  }
  return 'pokemon';
}

function rectCenter(rect: DOMRect): Point {
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function rectQuad(rect: DOMRect): Point[] {
  return [
    { x: rect.left, y: rect.top },
    { x: rect.right, y: rect.top },
    { x: rect.right, y: rect.bottom },
    { x: rect.left, y: rect.bottom },
  ];
}

function rotatedRectQuad(rect: DOMRect): Point[] {
  return [
    { x: rect.right, y: rect.bottom },
    { x: rect.left, y: rect.bottom },
    { x: rect.left, y: rect.top },
    { x: rect.right, y: rect.top },
  ];
}

function firstHandCardRect(handElement: HTMLElement): DOMRect | null {
  const card = handElement.querySelector('.card-tile');
  return card instanceof HTMLElement ? card.getBoundingClientRect() : null;
}

function rectSnapshot(rect: Pick<DOMRect, 'left' | 'top' | 'right' | 'bottom' | 'width' | 'height'>): RectSnapshot {
  return {
    left: rect.left,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    x: rect.left,
    y: rect.top,
    width: rect.width,
    height: rect.height,
  };
}

function formatMatrixNumber(value: number): string {
  return Number.isFinite(value) ? value.toFixed(6).replace(/\.?0+$/, '') : '0';
}

function solveHomography(from: Point[], to: Point[]): number[] | null {
  const matrix: number[][] = [];
  for (let index = 0; index < 4; index += 1) {
    const source = from[index];
    const target = to[index];
    matrix.push([
      source.x,
      source.y,
      1,
      0,
      0,
      0,
      -target.x * source.x,
      -target.x * source.y,
      target.x,
    ]);
    matrix.push([
      0,
      0,
      0,
      source.x,
      source.y,
      1,
      -target.y * source.x,
      -target.y * source.y,
      target.y,
    ]);
  }

  for (let column = 0; column < 8; column += 1) {
    let pivotRow = column;
    for (let row = column + 1; row < 8; row += 1) {
      if (Math.abs(matrix[row][column]) > Math.abs(matrix[pivotRow][column])) {
        pivotRow = row;
      }
    }
    if (Math.abs(matrix[pivotRow][column]) < 1e-8) {
      return null;
    }
    [matrix[column], matrix[pivotRow]] = [matrix[pivotRow], matrix[column]];

    const pivot = matrix[column][column];
    for (let col = column; col < 9; col += 1) {
      matrix[column][col] /= pivot;
    }

    for (let row = 0; row < 8; row += 1) {
      if (row === column) {
        continue;
      }
      const factor = matrix[row][column];
      for (let col = column; col < 9; col += 1) {
        matrix[row][col] -= factor * matrix[column][col];
      }
    }
  }

  return [...matrix.map((row) => row[8]), 1];
}
