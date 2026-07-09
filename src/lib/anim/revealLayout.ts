const cardRatio = 88 / 63;

export function cardVisual(element: HTMLElement): HTMLElement {
  if (element.classList.contains('card-tile')) {
    return element;
  }
  const cardTile = element.querySelector('.card-tile');
  return cardTile instanceof HTMLElement ? cardTile : element;
}

export function handCardVisualRect(element: HTMLElement | undefined): DOMRect | undefined {
  if (!element) {
    return undefined;
  }
  const rect = cardVisual(element).getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 ? rect : undefined;
}

// The hand lays cards out at a fixed width with horizontal scroll — a card
// entering the hand lands at the same width as its already-settled siblings,
// not a width divided by count, and NOT the incoming slot's transient
// mid-layout width (which reads narrow before the card-tile gets its size, so
// a reveal sprite scaled to it lands too small and then snaps to full size).
// Prefer a settled sibling's width; fall back to the measured width, then the
// computed geometry.
export function settledLandingWidth(
  siblingWidth: number | undefined,
  measuredWidth: number | undefined,
  fallbackWidth: number,
): number {
  return siblingWidth && siblingWidth > 0
    ? siblingWidth
    : measuredWidth && measuredWidth > 0
      ? measuredWidth
      : fallbackWidth;
}

export function fallbackHandTarget(handRect: DOMRect, index: number, count: number): DOMRect {
  const width = Math.min(handRect.height / cardRatio, handRect.width / Math.max(1, count));
  const height = width * cardRatio;
  const step = Math.min(width * 0.82, handRect.width / Math.max(1, count));
  const centerX = handRect.left + handRect.width / 2 + (index - (count - 1) / 2) * step;
  const centerY = handRect.top + handRect.height / 2;
  return new DOMRect(centerX - width / 2, centerY - height / 2, width, height);
}

export function revealLayout(count: number) {
  const viewportWidth = typeof window === 'undefined' ? 1200 : window.innerWidth;
  const viewportHeight = typeof window === 'undefined' ? 800 : window.innerHeight;
  const boardRect = typeof document === 'undefined'
    ? undefined
    : document.querySelector('.playmat')?.getBoundingClientRect();
  const centerX = boardRect ? boardRect.left + boardRect.width / 2 : viewportWidth / 2;
  const centerY = boardRect ? boardRect.top + boardRect.height * 0.5 : viewportHeight * 0.47;
  const maxWidth = boardRect ? boardRect.width - 96 : viewportWidth - 96;
  const availableWidth = Math.max(220, maxWidth);
  const spacingRatio = viewportWidth < 760 ? 0.62 : 0.7;
  const minCardWidth = viewportWidth < 760 ? 92 : 112;
  const maxColumns = Math.max(1, Math.floor(((availableWidth / minCardWidth) - 1) / spacingRatio + 1));
  const columns = Math.min(count, maxColumns);
  const rows = Math.ceil(count / columns);
  const boardHeight = boardRect?.height ?? viewportHeight;
  const revealBandHeight = boardHeight * (viewportWidth < 760 ? 0.46 : 0.52);
  const maxByHeight = revealBandHeight / (cardRatio * (rows + Math.max(0, rows - 1) * 0.08));
  const maxReadableWidth = Math.min(viewportWidth < 760 ? 174 : 252, availableWidth, maxByHeight);
  const countScale = count <= 1 ? 1 : count <= 2 ? 0.9 : count <= 4 ? 0.78 : count <= 6 ? 0.68 : 0.58;
  const desiredCardWidth = maxReadableWidth * countScale;
  const maxByWidth = availableWidth / (1 + spacingRatio * Math.max(0, columns - 1));
  const cardWidth = Math.max(minCardWidth, Math.min(maxReadableWidth, desiredCardWidth, maxByWidth));
  const cardHeight = cardWidth * cardRatio;
  const spacing = cardWidth * spacingRatio;
  const rotationStep = count <= 1 ? 0 : Math.min(5, 20 / Math.max(1, count - 1));
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
      const cardsInRow = Math.min(columns, count - rowStart);
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
