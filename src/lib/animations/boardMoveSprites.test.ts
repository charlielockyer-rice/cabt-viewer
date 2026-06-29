import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  boardMoveSpriteHtml,
  liveBoardMoveSpriteForInput,
  plannedBoardMoveSpriteForMotion,
} from './boardMoveSprites';
import type { CardMoveAnimationMotion } from './replayAnimationPlan';
import type { PlaneRect } from '../dom/planeGeometry';

class FakeElement {
  attributes: { name: string }[] = [];
  children: FakeElement[] = [];
  loading = '';
  decoding = '';
  classList = {
    contains: (className: string) => this.classes.has(className),
    add: (className: string) => this.classes.add(className),
    remove: (className: string) => this.classes.delete(className),
  };

  constructor(
    private tagName = 'span',
    private classes = new Set<string>(),
    private attrs = new Map<string, string>(),
  ) {
    this.syncAttributes();
  }

  get className(): string {
    return Array.from(this.classes).join(' ');
  }

  set className(value: string) {
    this.classes = new Set(value.split(/\s+/).filter(Boolean));
  }

  get outerHTML(): string {
    const attrs = [
      this.className ? `class="${this.className}"` : '',
      ...Array.from(this.attrs.entries(), ([name, value]) => `${name}="${value}"`),
    ].filter(Boolean).join(' ');
    return `<${this.tagName}${attrs ? ` ${attrs}` : ''}>${this.children.map((child) => child.outerHTML).join('')}</${this.tagName}>`;
  }

  cloneNode(): FakeElement {
    const clone = new FakeElement(this.tagName, new Set(this.classes), new Map(this.attrs));
    clone.children = this.children.map((child) => child.cloneNode());
    return clone;
  }

  removeAttribute(name: string) {
    this.attrs.delete(name);
    this.syncAttributes();
  }

  querySelector(selector: string): FakeElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  querySelectorAll(selector: string): FakeElement[] {
    const descendants = this.children.flatMap((child) => [child, ...child.querySelectorAll('*')]);
    if (selector === '*') {
      return descendants;
    }
    if (selector === 'img') {
      return descendants.filter((child) => child.tagName === 'img');
    }
    if (selector.startsWith('.')) {
      const className = selector.slice(1);
      return descendants.filter((child) => child.classes.has(className));
    }
    return [];
  }

  private syncAttributes() {
    this.attributes = Array.from(this.attrs.keys(), (name) => ({ name }));
  }
}

describe('plannedBoardMoveSpriteForMotion', () => {
  it('builds planned board sprites from measured board-plane rects', () => {
    const sprite = plannedBoardMoveSpriteForMotion({
      motion: motion(),
      sourceRect: rect(10, 20, 60, 90),
      targetRect: rect(100, 200, 120, 180),
      generation: 4,
      opponentSide: true,
    });

    expect(sprite).toMatchObject({
      id: '4:board-motion',
      fallbackName: 'Pikachu',
      left: 100,
      top: 200,
      width: 120,
      height: 180,
      startX: -120,
      startY: -225,
      startScale: 0.5,
      toDeck: false,
      fromDeck: false,
      opponentSide: true,
      delayMs: 30,
      durationMs: 520,
      measuring: true,
      card: { id: 25, serial: 7, name: 'Pikachu' },
      lifecycle: { kind: 'planned' },
    });
  });
});

describe('liveBoardMoveSpriteForInput', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('builds live board sprites and sanitizes cloned source markup', () => {
    vi.stubGlobal('HTMLElement', FakeElement);
    const source = element('span', ['source-card', 'empty'], [
      ['id', 'source-id'],
      ['data-animation-anchor-key', 'player:0:active'],
      ['data-card-anchor', 'player:0:active:0'],
      ['data-board-move-animation-hidden', 'true'],
    ]);
    const image = element('img');
    source.children.push(image);
    const target = element('span', ['board-slot', 'bench-target']);

    const sprite = liveBoardMoveSpriteForInput({
      source: source as unknown as HTMLElement,
      target: target as unknown as HTMLElement,
      sourceRect: rect(20, 30, 50, 70),
      targetRect: rect(80, 130, 100, 140),
      generation: 2,
      key: 'live-1',
      cardId: 25,
      serial: 7,
      waitForDestinationCard: true,
      toDeck: false,
      fromDeck: false,
      opponentSide: false,
      delayMs: 10,
      durationMs: 620,
    });

    expect(sprite).toMatchObject({
      id: '2:live-1',
      fallbackName: 'Pinsir',
      startX: -85,
      startY: -135,
      startScale: 0.5,
      lifecycle: {
        kind: 'live',
        handoff: {
          destinationCardId: 25,
          destinationSerial: 7,
          waitForDestinationCard: true,
        },
      },
    });
    expect(sprite?.html).not.toContain('data-animation-anchor-key');
    expect(sprite?.html).not.toContain('data-card-anchor');
    expect(sprite?.html).not.toContain('data-board-move-animation-hidden');
    expect(sprite?.html).toContain('class="board-slot bench-target"');
  });
});

describe('boardMoveSpriteHtml', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses the stadium card tile instead of wrapping the whole stadium slot', () => {
    vi.stubGlobal('HTMLElement', FakeElement);
    const source = element('span', ['stadium-card']);
    source.children.push(element('span', ['card-tile'], [['data-animation-card-id', '1']]));
    const target = element('span', ['discard']);

    expect(boardMoveSpriteHtml(source as unknown as HTMLElement, target as unknown as HTMLElement))
      .toBe('<span class="card-tile" data-animation-card-id="1"></span>');
  });
});

function rect(left: number, top: number, width: number, height: number): PlaneRect {
  return { left, top, width, height };
}

function element(tagName: string, classes: string[] = [], attrs: [string, string][] = []): FakeElement {
  return new FakeElement(tagName, new Set(classes), new Map(attrs));
}

function motion(): CardMoveAnimationMotion {
  return {
    id: 'board-motion',
    kind: 'card-move',
    identity: { kind: 'pokemon', serial: 7, cardId: 25, name: 'Pikachu' },
    sourceAnchor: { kind: 'pokemon-card', playerIndex: 0, slot: 'active', slotIndex: 0, serial: 7 },
    targetAnchor: { kind: 'pokemon-card', playerIndex: 0, slot: 'bench', slotIndex: 1, serial: 7 },
    coordinateSpace: 'board',
    startMs: 30,
    durationMs: 520,
    spriteVisual: {
      kind: 'card',
      card: { id: 25, serial: 7, name: 'Pikachu' },
    },
    handoffPolicy: {
      hideSourceUntil: 'scope-exit',
      hideDestinationUntil: 'prepaint',
      removeSprite: 'prepaint',
      prepaintFrames: 2,
    },
  };
}
