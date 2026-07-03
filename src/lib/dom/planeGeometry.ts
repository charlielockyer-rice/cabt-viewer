export type Point = {
  x: number;
  y: number;
};

export type PlaneMapper = {
  pointFromViewport: (point: Point) => Point;
};

export function centerOf(rect: DOMRect): Point {
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
  };
}

export type LocalRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

// Untransformed plane-local coordinates via offset accumulation. Elements
// positioned with these coordinates inside the tilted board plane inherit its
// 3D transform, so no perspective math is needed. Falls back to viewport rect
// deltas when the offset chain does not reach the root.
export function localRectIn(root: HTMLElement, element: HTMLElement): LocalRect | null {
  let left = 0;
  let top = 0;
  let current: HTMLElement | null = element;
  while (current && current !== root) {
    left += current.offsetLeft;
    top += current.offsetTop;
    current = current.offsetParent instanceof HTMLElement ? current.offsetParent : null;
  }
  if (current !== root) {
    const rootRect = root.getBoundingClientRect();
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return null;
    }
    return {
      left: rect.left - rootRect.left,
      top: rect.top - rootRect.top,
      width: rect.width,
      height: rect.height,
    };
  }
  const style = getComputedStyle(element);
  return {
    left,
    top,
    width: parsedPixelValue(style.width) ?? element.offsetWidth,
    height: parsedPixelValue(style.height) ?? element.offsetHeight,
  };
}

export function localRectCenter(rect: LocalRect): Point {
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
  };
}

function parsedPixelValue(value: string): number | null {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function planeMapper(planeElement: HTMLElement): PlaneMapper {
  const fallbackRect = planeElement.getBoundingClientRect();
  const width = planeElement.offsetWidth || fallbackRect.width;
  const height = planeElement.offsetHeight || fallbackRect.height;

  if (width <= 0 || height <= 0) {
    return fallbackPlaneMapper(fallbackRect);
  }

  const quad = viewportQuad(planeElement);
  const homography = solveHomography(
    quad,
    [
      { x: 0, y: 0 },
      { x: width, y: 0 },
      { x: width, y: height },
      { x: 0, y: height },
    ],
  );

  if (!homography) {
    return fallbackPlaneMapper(fallbackRect);
  }

  return {
    pointFromViewport: (point) => applyHomography(point, homography),
  };
}

export function viewportQuad(element: HTMLElement): Point[] {
  const quad = (element as HTMLElement & {
    getBoxQuads?: () => Array<{
      p1: Point;
      p2: Point;
      p3: Point;
      p4: Point;
    }>;
  }).getBoxQuads?.()[0];

  if (quad) {
    return [quad.p1, quad.p2, quad.p3, quad.p4];
  }

  return measuredViewportQuad(element);
}

function fallbackPlaneMapper(fallbackRect: DOMRect): PlaneMapper {
  return {
    pointFromViewport: (point) => ({
      x: point.x - fallbackRect.left,
      y: point.y - fallbackRect.top,
    }),
  };
}

function measuredViewportQuad(element: HTMLElement): Point[] {
  const width = element.offsetWidth;
  const height = element.offsetHeight;
  if (width <= 0 || height <= 0) {
    return rectQuad(element.getBoundingClientRect());
  }

  const positions = [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: height },
    { x: 0, y: height },
  ];
  const previousPosition = element.style.position;
  const needsPosition = getComputedStyle(element).position === 'static';
  if (needsPosition) {
    element.style.position = 'relative';
  }

  const markers = positions.map((position) => {
    const marker = document.createElement('span');
    marker.style.cssText = [
      'position: absolute',
      `left: ${position.x}px`,
      `top: ${position.y}px`,
      'width: 0',
      'height: 0',
      'margin: 0',
      'padding: 0',
      'border: 0',
      'visibility: hidden',
      'pointer-events: none',
    ].join('; ');
    element.append(marker);
    return marker;
  });

  try {
    return markers.map((marker) => {
      const rect = marker.getBoundingClientRect();
      return { x: rect.left, y: rect.top };
    });
  } finally {
    for (const marker of markers) {
      marker.remove();
    }
    if (needsPosition) {
      element.style.position = previousPosition;
    }
  }
}

// Projects a flat width x height rectangle onto an arbitrary on-screen quad
// as a CSS matrix3d, so a position:fixed sprite can start flat (hand space)
// and land exactly on a perspective-projected board destination.
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

export function rectQuad(rect: DOMRect): Point[] {
  return [
    { x: rect.left, y: rect.top },
    { x: rect.right, y: rect.top },
    { x: rect.right, y: rect.bottom },
    { x: rect.left, y: rect.bottom },
  ];
}

// A 180-degree-rotated flat quad, for cards leaving the top player's hand.
export function rotatedRectQuad(rect: DOMRect): Point[] {
  return [
    { x: rect.right, y: rect.bottom },
    { x: rect.left, y: rect.bottom },
    { x: rect.left, y: rect.top },
    { x: rect.right, y: rect.top },
  ];
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

function applyHomography(point: Point, homography: number[]): Point {
  const denominator = homography[6] * point.x + homography[7] * point.y + 1;
  if (Math.abs(denominator) < 1e-8) {
    return point;
  }
  return {
    x: (homography[0] * point.x + homography[1] * point.y + homography[2]) / denominator,
    y: (homography[3] * point.x + homography[4] * point.y + homography[5]) / denominator,
  };
}
