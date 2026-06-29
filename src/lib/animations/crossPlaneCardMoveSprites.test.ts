import { afterEach, describe, expect, it, vi } from 'vitest';
import { crossPlaneSpriteForMotion, crossPlaneSpriteId } from './crossPlaneCardMoveSprites';
import type { CardMoveAnimationMotion } from './replayAnimationPlan';

class FakeElement {
  #closest = new Map<string, FakeElement>();
  #queries = new Map<string, FakeElement>();

  constructor(private readonly rect: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>) {}

  closest(selector: string): FakeElement | null {
    return this.#closest.get(selector) ?? null;
  }

  querySelector(selector: string): FakeElement | null {
    return this.#queries.get(selector) ?? null;
  }

  setClosest(selector: string, element: FakeElement) {
    this.#closest.set(selector, element);
  }

  setQuery(selector: string, element: FakeElement) {
    this.#queries.set(selector, element);
  }

  getBoundingClientRect(): DOMRect {
    const { left, top, width, height } = this.rect;
    return {
      left,
      top,
      width,
      height,
      x: left,
      y: top,
      right: left + width,
      bottom: top + height,
      toJSON: () => ({}),
    } as DOMRect;
  }
}

describe('crossPlaneSpriteForMotion', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses the board card rect and derives cross-plane motion geometry', () => {
    vi.stubGlobal('HTMLElement', FakeElement);
    const source = new FakeElement(rect(10, 20, 30, 40));
    const boardSlot = new FakeElement(rect(0, 0, 100, 100));
    const ownerCard = new FakeElement(rect(12, 22, 60, 90));
    const target = new FakeElement(rect(200, 300, 120, 180));
    source.setClosest('.board-slot', boardSlot);
    boardSlot.setQuery('.card-tile', ownerCard);
    target.setClosest('.hand.concealed', new FakeElement(rect(0, 0, 1, 1)));
    target.setClosest('.player-panel.top, .top-active-slot, .bench-row.opponent', new FakeElement(rect(0, 0, 1, 1)));

    const sprites = crossPlaneSpriteForMotion(motion(), 7, {
      sourceElement: source as unknown as HTMLElement,
      targetElement: target as unknown as HTMLElement,
    });

    expect(sprites).toEqual([{
      id: '7:cross-plane',
      card: { id: 25, serial: 12, name: 'Pikachu' },
      left: 12,
      top: 22,
      width: 60,
      height: 90,
      moveX: 218,
      moveY: 323,
      targetScale: 2,
      delayMs: 40,
      durationMs: 360,
      faceDown: true,
      opponentSide: true,
    }]);
  });

  it('returns no sprite when either visual rect is missing', () => {
    vi.stubGlobal('HTMLElement', FakeElement);

    expect(crossPlaneSpriteForMotion(motion(), 1, {
      sourceElement: new FakeElement(rect(0, 0, 0, 40)) as unknown as HTMLElement,
      targetElement: new FakeElement(rect(100, 100, 60, 90)) as unknown as HTMLElement,
    })).toEqual([]);
  });
});

describe('crossPlaneSpriteId', () => {
  it('combines generation and motion id', () => {
    expect(crossPlaneSpriteId(motion(), 3)).toBe('3:cross-plane');
  });
});

function rect(left: number, top: number, width: number, height: number): Pick<DOMRect, 'left' | 'top' | 'width' | 'height'> {
  return { left, top, width, height };
}

function motion(): CardMoveAnimationMotion {
  return {
    id: 'cross-plane',
    kind: 'card-move',
    identity: { kind: 'card', serial: 12, cardId: 25 },
    sourceAnchor: { kind: 'attached-energy', playerIndex: 0, slot: 'active', slotIndex: 0, serial: 12 },
    targetAnchor: { kind: 'hand-card', playerIndex: 0, serial: 12 },
    coordinateSpace: 'cross-plane',
    startMs: 40,
    durationMs: 360,
    spriteVisual: {
      kind: 'card',
      card: { id: 25, serial: 12, name: 'Pikachu' },
    },
    handoffPolicy: {
      hideSourceUntil: 'scope-exit',
      hideDestinationUntil: 'arrival',
      removeSprite: 'arrival',
      prepaintFrames: 2,
    },
  };
}
