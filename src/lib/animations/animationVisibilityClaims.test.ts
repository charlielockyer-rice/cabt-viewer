import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type AnimationAnchorRef,
  serializeAnimationAnchor,
  serializeAnimationIdentity,
} from './animationAnchors';
import { replayAnimationVisibility } from './animationVisibility';
import {
  claimAnimationAnchorVisibility,
  hideElementForAnimation,
  refreshAnimationVisibilityClaims,
  releaseAnimationVisibilityClaim,
  releaseAnimationVisibilityScope,
  releaseElementVisibilityClaim,
} from './animationVisibilityClaims';

class FakeHTMLElement {
  attributes = new Map<string, string>();
  dataset: Record<string, string | undefined> = {};

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }

  getAttribute(name: string): string | undefined {
    return this.attributes.get(name);
  }
}

describe('animation visibility claim fallbacks', () => {
  afterEach(() => {
    replayAnimationVisibility.clear();
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

  it('can release scoped fallback attributes without revealing claims from another scope', () => {
    vi.stubGlobal('HTMLElement', class {});
    const attributes = new Map<string, string>();
    const element = {
      closest: () => null,
      setAttribute: (name: string, value: string) => attributes.set(name, value),
      removeAttribute: (name: string) => attributes.delete(name),
    } as unknown as HTMLElement;

    const oldClaim = hideElementForAnimation({
      element,
      scopeKey: 'old-scope',
      role: 'destination',
      fallbackAttribute: 'data-test-hidden',
    });
    const newClaim = hideElementForAnimation({
      element,
      scopeKey: 'new-scope',
      role: 'destination',
      fallbackAttribute: 'data-test-hidden',
    });

    expect(releaseAnimationVisibilityScope('old-scope')).toBe(1);
    expect(attributes.get('data-test-hidden')).toBe('true');
    releaseElementVisibilityClaim(oldClaim);
    expect(attributes.get('data-test-hidden')).toBe('true');
    releaseElementVisibilityClaim(newClaim);
    expect(attributes.has('data-test-hidden')).toBe(false);
  });
});

describe('semantic animation visibility claims', () => {
  const anchor: AnimationAnchorRef = {
    kind: 'pokemon-card',
    playerIndex: 0,
    slot: 'bench',
    slotIndex: 1,
    serial: 11,
  };
  const identity = { kind: 'pokemon' as const, serial: 11 };

  afterEach(() => {
    replayAnimationVisibility.clear();
    vi.unstubAllGlobals();
  });

  it('keeps multiple claims on the same anchor hidden until all claims release', () => {
    const element = new FakeHTMLElement();
    installAnchorDocument(() => [element]);

    const first = claimAnimationAnchorVisibility({
      scopeKey: 'scope-a',
      anchor,
      identity,
      role: 'destination',
    });
    const second = claimAnimationAnchorVisibility({
      scopeKey: 'scope-a',
      anchorKey: serializeAnimationAnchor(anchor),
      identity,
      role: 'destination',
    });

    expect(first.anchorKey).toBe(serializeAnimationAnchor(anchor));
    expect(first.claimKey).toBe([
      'scope-a',
      'destination',
      serializeAnimationAnchor(anchor),
      serializeAnimationIdentity(identity),
    ].join('|'));
    expect(element.getAttribute(replayAnimationVisibility.hiddenAttribute)).toBe('true');

    releaseAnimationVisibilityClaim(first);
    expect(element.getAttribute(replayAnimationVisibility.hiddenAttribute)).toBe('true');

    releaseAnimationVisibilityClaim(second);
    expect(element.getAttribute(replayAnimationVisibility.hiddenAttribute)).toBeUndefined();
  });

  it('re-applies an active semantic claim when the DOM node is replaced', () => {
    const oldElement = new FakeHTMLElement();
    const newElement = new FakeHTMLElement();
    let elements = [oldElement];
    installAnchorDocument(() => elements);

    const claim = claimAnimationAnchorVisibility({
      scopeKey: 'scope-a',
      anchor,
      identity,
      role: 'handoff',
    });

    expect(oldElement.getAttribute(replayAnimationVisibility.hiddenAttribute)).toBe('true');
    elements = [newElement];
    refreshAnimationVisibilityClaims();

    expect(oldElement.getAttribute(replayAnimationVisibility.hiddenAttribute)).toBeUndefined();
    expect(newElement.getAttribute(replayAnimationVisibility.hiddenAttribute)).toBe('true');

    releaseAnimationVisibilityClaim(claim);
    expect(newElement.getAttribute(replayAnimationVisibility.hiddenAttribute)).toBeUndefined();
  });

  it('releases semantic claims by scope while preserving active claims from other scopes', () => {
    const element = new FakeHTMLElement();
    installAnchorDocument(() => [element]);

    claimAnimationAnchorVisibility({
      scopeKey: 'old-scope',
      anchor,
      identity,
      role: 'source',
    });
    const newClaim = claimAnimationAnchorVisibility({
      scopeKey: 'new-scope',
      anchor,
      identity,
      role: 'source',
    });

    expect(releaseAnimationVisibilityScope('old-scope')).toBe(1);
    expect(element.getAttribute(replayAnimationVisibility.hiddenAttribute)).toBe('true');

    releaseAnimationVisibilityClaim(newClaim);
    expect(element.getAttribute(replayAnimationVisibility.hiddenAttribute)).toBeUndefined();
  });

  it('does not let a stale release reveal an element still claimed by another scope', () => {
    const element = new FakeHTMLElement();
    installAnchorDocument(() => [element]);

    const staleClaim = claimAnimationAnchorVisibility({
      scopeKey: 'old-scope',
      anchor,
      identity,
      role: 'destination',
    });
    const activeClaim = claimAnimationAnchorVisibility({
      scopeKey: 'new-scope',
      anchor,
      identity,
      role: 'destination',
    });

    expect(releaseAnimationVisibilityScope('old-scope')).toBe(1);
    releaseAnimationVisibilityClaim(staleClaim);
    expect(element.getAttribute(replayAnimationVisibility.hiddenAttribute)).toBe('true');

    releaseAnimationVisibilityClaim(activeClaim);
    expect(element.getAttribute(replayAnimationVisibility.hiddenAttribute)).toBeUndefined();
  });
});

function installAnchorDocument(elements: () => FakeHTMLElement[]): void {
  vi.stubGlobal('HTMLElement', FakeHTMLElement);
  vi.stubGlobal('document', {
    querySelectorAll: () => elements(),
  });
}
