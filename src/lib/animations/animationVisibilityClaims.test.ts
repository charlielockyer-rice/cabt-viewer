import { afterEach, describe, expect, it, vi } from 'vitest';
import { hideElementForAnimation, releaseElementVisibilityClaim } from './animationVisibilityClaims';

describe('animation visibility claim fallbacks', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps fallback attributes hidden until every claim is released', () => {
    vi.stubGlobal('HTMLElement', class {});
    const attributes = new Map<string, string>();
    const element = {
      closest: () => null,
      setAttribute: (name: string, value: string) => attributes.set(name, value),
      removeAttribute: (name: string) => attributes.delete(name),
    } as unknown as HTMLElement;

    const first = hideElementForAnimation({
      element,
      scopeKey: 'scope',
      role: 'destination',
      fallbackAttribute: 'data-test-hidden',
    });
    const second = hideElementForAnimation({
      element,
      scopeKey: 'scope',
      role: 'destination',
      fallbackAttribute: 'data-test-hidden',
    });

    expect(attributes.get('data-test-hidden')).toBe('true');
    releaseElementVisibilityClaim(first);
    expect(attributes.get('data-test-hidden')).toBe('true');
    releaseElementVisibilityClaim(second);
    expect(attributes.has('data-test-hidden')).toBe(false);
  });
});
