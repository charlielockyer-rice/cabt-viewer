import { animationAnchorForElement } from './animationAnchors';
import {
  replayAnimationVisibility,
  type AnimationVisibilityRole,
  type AnimationVisibilityToken,
} from './animationVisibility';

export type ElementVisibilityClaim = {
  element: HTMLElement;
  token?: AnimationVisibilityToken;
  fallbackAttribute?: string;
  released?: boolean;
};

const fallbackClaimCounts = new WeakMap<HTMLElement, Map<string, number>>();

export function hideElementForAnimation(input: {
  element: HTMLElement;
  scopeKey: string | number;
  role: AnimationVisibilityRole;
  fallbackAttribute?: string;
}): ElementVisibilityClaim {
  const anchor = animationAnchorForElement(input.element);
  if (anchor) {
    return {
      element: input.element,
      token: replayAnimationVisibility.hide({
        scopeKey: String(input.scopeKey),
        anchor: anchor.anchor,
        identity: anchor.identity,
        role: input.role,
      }),
    };
  }

  if (input.fallbackAttribute) {
    claimFallbackAttribute(input.element, input.fallbackAttribute);
  }
  return {
    element: input.element,
    fallbackAttribute: input.fallbackAttribute,
  };
}

export function releaseElementVisibilityClaim(claim: ElementVisibilityClaim): void {
  if (claim.released) {
    return;
  }
  claim.released = true;
  if (claim.token) {
    replayAnimationVisibility.release(claim.token);
  }
  if (claim.fallbackAttribute) {
    releaseFallbackAttribute(claim.element, claim.fallbackAttribute);
  }
}

export function releaseElementVisibilityClaims(claims: Iterable<ElementVisibilityClaim>): void {
  for (const claim of claims) {
    releaseElementVisibilityClaim(claim);
  }
}

function claimFallbackAttribute(element: HTMLElement, attribute: string): void {
  const counts = fallbackClaimCounts.get(element) ?? new Map<string, number>();
  counts.set(attribute, (counts.get(attribute) ?? 0) + 1);
  fallbackClaimCounts.set(element, counts);
  element.setAttribute(attribute, 'true');
}

function releaseFallbackAttribute(element: HTMLElement, attribute: string): void {
  const counts = fallbackClaimCounts.get(element);
  if (!counts) {
    element.removeAttribute(attribute);
    return;
  }
  const nextCount = (counts.get(attribute) ?? 0) - 1;
  if (nextCount > 0) {
    counts.set(attribute, nextCount);
    return;
  }
  counts.delete(attribute);
  if (counts.size === 0) {
    fallbackClaimCounts.delete(element);
  }
  element.removeAttribute(attribute);
}
