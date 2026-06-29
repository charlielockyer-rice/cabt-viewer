import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  claimAnimationElementEffect,
  releaseAnimationElementEffectClaim,
  releaseAnimationElementEffectClaims,
} from './animationElementEffects';

class FakeStyle {
  properties = new Map<string, string>();

  setProperty(name: string, value: string): void {
    this.properties.set(name, value);
  }

  removeProperty(name: string): void {
    this.properties.delete(name);
  }
}

class FakeHTMLElement {
  attributes = new Map<string, string>();
  style = new FakeStyle();

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }
}

describe('animation element effect claims', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps a newer attribute and style claim active when an older claim releases', () => {
    vi.stubGlobal('HTMLElement', FakeHTMLElement);
    const element = new FakeHTMLElement() as unknown as HTMLElement;
    const style = element.style as unknown as FakeStyle;

    const first = claimAnimationElementEffect({
      element,
      attributes: { 'data-attack-announce-active': 'true' },
      styles: { '--attack-name': '"First"' },
    });
    const second = claimAnimationElementEffect({
      element,
      attributes: { 'data-attack-announce-active': 'true' },
      styles: { '--attack-name': '"Second"' },
    });

    expect((element as unknown as FakeHTMLElement).attributes.get('data-attack-announce-active')).toBe('true');
    expect(style.properties.get('--attack-name')).toBe('"Second"');

    releaseAnimationElementEffectClaim(first);

    expect((element as unknown as FakeHTMLElement).attributes.get('data-attack-announce-active')).toBe('true');
    expect(style.properties.get('--attack-name')).toBe('"Second"');

    releaseAnimationElementEffectClaim(second);

    expect((element as unknown as FakeHTMLElement).attributes.has('data-attack-announce-active')).toBe(false);
    expect(style.properties.has('--attack-name')).toBe(false);
  });

  it('can release a batch of independent claims', () => {
    vi.stubGlobal('HTMLElement', FakeHTMLElement);
    const firstElement = new FakeHTMLElement() as unknown as HTMLElement;
    const secondElement = new FakeHTMLElement() as unknown as HTMLElement;

    const first = claimAnimationElementEffect({
      element: firstElement,
      attributes: { 'data-ability-announce-active': 'true' },
    });
    const second = claimAnimationElementEffect({
      element: secondElement,
      styles: { '--damage-visual-ms': '560ms' },
    });

    releaseAnimationElementEffectClaims([first, second]);

    expect((firstElement as unknown as FakeHTMLElement).attributes.has('data-ability-announce-active')).toBe(false);
    expect((secondElement.style as unknown as FakeStyle).properties.has('--damage-visual-ms')).toBe(false);
  });
});
