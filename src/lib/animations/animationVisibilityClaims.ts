import {
  animationAnchorForElement,
  parseAnimationAnchor,
  serializeAnimationAnchor,
  type AnimationAnchorRef,
  type AnimationIdentity,
} from './animationAnchors';
import {
  replayAnimationVisibility,
  type AnimationVisibilityRole,
  type AnimationVisibilityToken,
} from './animationVisibility';

export type ElementVisibilityClaim = {
  element: HTMLElement;
  scopeKey?: string;
  role?: AnimationVisibilityRole;
  anchorKey?: string;
  identity?: AnimationIdentity;
  claimKey?: string;
  token?: AnimationVisibilityToken;
  fallbackAttribute?: string;
  fallbackClaimId?: string;
  released?: boolean;
};

export type AnchorVisibilityClaim = {
  scopeKey: string;
  role: AnimationVisibilityRole;
  anchor: AnimationAnchorRef;
  anchorKey: string;
  identity?: AnimationIdentity;
  claimKey: string;
  token: AnimationVisibilityToken;
  released?: boolean;
};

export type AnimationVisibilityClaimHandle = ElementVisibilityClaim | AnchorVisibilityClaim;

export type AnchorVisibilityClaimInput = {
  scopeKey: string | number;
  role: AnimationVisibilityRole;
  identity?: AnimationIdentity;
} & (
  | { anchor: AnimationAnchorRef; anchorKey?: string }
  | { anchor?: AnimationAnchorRef; anchorKey: string }
);

const fallbackClaimCounts = new WeakMap<HTMLElement, Map<string, number>>();
const fallbackClaims = new Map<string, {
  element: HTMLElement;
  attribute: string;
  scopeKey: string;
  released?: boolean;
}>();

let nextFallbackClaimId = 1;

export function hideElementForAnimation(input: {
  element: HTMLElement;
  scopeKey: string | number;
  role: AnimationVisibilityRole;
  fallbackAttribute?: string;
  forceFallback?: boolean;
}): ElementVisibilityClaim {
  const anchor = input.forceFallback ? null : animationAnchorForElement(input.element);
  if (anchor) {
    const scopeKey = String(input.scopeKey);
    const token = replayAnimationVisibility.hide({
      scopeKey,
      anchor: anchor.anchor,
      identity: anchor.identity,
      role: input.role,
    });
    return {
      element: input.element,
      scopeKey,
      role: input.role,
      anchorKey: serializeAnimationAnchor(anchor.anchor),
      identity: anchor.identity,
      claimKey: token.claimKey,
      token,
    };
  }

  let fallbackClaimId: string | undefined;
  if (input.fallbackAttribute) {
    fallbackClaimId = claimFallbackAttribute(
      input.element,
      input.fallbackAttribute,
      String(input.scopeKey),
    );
  }
  return {
    element: input.element,
    scopeKey: String(input.scopeKey),
    role: input.role,
    fallbackAttribute: input.fallbackAttribute,
    fallbackClaimId,
  };
}

export function claimAnimationAnchorVisibility(input: AnchorVisibilityClaimInput): AnchorVisibilityClaim {
  const anchor = resolveAnchorInput(input);
  const anchorKey = serializeAnimationAnchor(anchor);
  if (input.anchorKey !== undefined && input.anchorKey !== anchorKey) {
    throw new Error(`Animation visibility anchor key ${input.anchorKey} does not match ${anchorKey}`);
  }

  const scopeKey = String(input.scopeKey);
  const token = replayAnimationVisibility.hide({
    scopeKey,
    anchor,
    identity: input.identity,
    role: input.role,
  });
  return {
    scopeKey,
    role: input.role,
    anchor,
    anchorKey,
    identity: input.identity,
    claimKey: token.claimKey,
    token,
  };
}

export function releaseAnimationVisibilityClaim(claim: AnimationVisibilityClaimHandle): void {
  if (claim.released) {
    return;
  }
  claim.released = true;
  if (claim.token) {
    replayAnimationVisibility.release(claim.token);
  }
  if ('element' in claim && claim.fallbackAttribute) {
    if (claim.fallbackClaimId) {
      releaseFallbackClaim(claim.fallbackClaimId);
    } else {
      releaseFallbackAttribute(claim.element, claim.fallbackAttribute);
    }
  }
}

export function releaseElementVisibilityClaim(claim: ElementVisibilityClaim): void {
  releaseAnimationVisibilityClaim(claim);
}

export function releaseAnimationVisibilityClaims(claims: Iterable<AnimationVisibilityClaimHandle>): void {
  for (const claim of claims) {
    releaseAnimationVisibilityClaim(claim);
  }
}

export function releaseElementVisibilityClaims(claims: Iterable<ElementVisibilityClaim>): void {
  releaseAnimationVisibilityClaims(claims);
}

export function releaseAnimationVisibilityScope(scopeKey: string | number): number {
  const normalizedScopeKey = String(scopeKey);
  let released = replayAnimationVisibility.releaseScope(normalizedScopeKey);
  for (const [id, claim] of Array.from(fallbackClaims.entries())) {
    if (claim.scopeKey === normalizedScopeKey && releaseFallbackClaim(id)) {
      released += 1;
    }
  }
  return released;
}

export function refreshAnimationVisibilityClaims(): void {
  replayAnimationVisibility.refresh();
}

function resolveAnchorInput(input: AnchorVisibilityClaimInput): AnimationAnchorRef {
  if (input.anchor) {
    return input.anchor;
  }
  const anchorKey = input.anchorKey;
  if (!anchorKey) {
    throw new Error('Animation visibility claim requires an anchor or anchor key');
  }
  const anchor = parseAnimationAnchor(anchorKey);
  if (!anchor) {
    throw new Error(`Invalid animation visibility anchor key: ${anchorKey}`);
  }
  return anchor;
}

function claimFallbackAttribute(element: HTMLElement, attribute: string, scopeKey: string): string {
  const fallbackClaimId = `fallback-visibility-${nextFallbackClaimId++}`;
  const counts = fallbackClaimCounts.get(element) ?? new Map<string, number>();
  counts.set(attribute, (counts.get(attribute) ?? 0) + 1);
  fallbackClaimCounts.set(element, counts);
  fallbackClaims.set(fallbackClaimId, { element, attribute, scopeKey });
  element.setAttribute(attribute, 'true');
  return fallbackClaimId;
}

function releaseFallbackClaim(fallbackClaimId: string): boolean {
  const claim = fallbackClaims.get(fallbackClaimId);
  if (!claim || claim.released) {
    return false;
  }
  claim.released = true;
  fallbackClaims.delete(fallbackClaimId);
  releaseFallbackAttribute(claim.element, claim.attribute);
  return true;
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
