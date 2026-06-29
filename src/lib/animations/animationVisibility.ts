import {
  animationClaimKey,
  type AnimationAnchorRef,
  type AnimationIdentity,
  resolveAnimationAnchorElements,
} from './animationAnchors';

export type AnimationVisibilityRole = 'source' | 'destination' | 'handoff';

export type AnimationVisibilityClaim = {
  scopeKey: string;
  motionId?: string;
  stepId?: string;
  anchor: AnimationAnchorRef;
  identity?: AnimationIdentity;
  role: AnimationVisibilityRole;
};

export type AnimationVisibilityToken = {
  readonly id: string;
  readonly claimKey: string;
};

export type AnimationVisibilityElement = {
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
};

export type AnimationVisibilityResolver = (
  anchor: AnimationAnchorRef,
  identity: AnimationIdentity | undefined,
) => Iterable<AnimationVisibilityElement>;

export type AnimationVisibilityManagerOptions = {
  resolver?: AnimationVisibilityResolver;
  hiddenAttribute?: string;
};

type ActiveClaim = AnimationVisibilityClaim & {
  id: string;
  claimKey: string;
};

const defaultHiddenAttribute = 'data-animation-visibility-hidden';

let nextTokenId = 1;

export class AnimationVisibilityManager {
  readonly hiddenAttribute: string;

  #claims = new Map<string, ActiveClaim>();
  #resolver: AnimationVisibilityResolver;
  #lastElements = new Set<AnimationVisibilityElement>();

  constructor(options: AnimationVisibilityManagerOptions = {}) {
    this.hiddenAttribute = options.hiddenAttribute ?? defaultHiddenAttribute;
    this.#resolver = options.resolver ?? ((anchor, identity) => resolveAnimationAnchorElements(anchor, { identity }));
  }

  hide(claim: AnimationVisibilityClaim): AnimationVisibilityToken {
    const id = `visibility-${nextTokenId++}`;
    const claimKey = animationClaimKey(claim);
    this.#claims.set(id, { ...claim, id, claimKey });
    this.refresh();
    return { id, claimKey };
  }

  release(token: AnimationVisibilityToken | string): boolean {
    const id = typeof token === 'string' ? token : token.id;
    const released = this.#claims.delete(id);
    if (released) {
      this.refresh();
    }
    return released;
  }

  releaseScope(scopeKey: string): number {
    let released = 0;
    for (const [id, claim] of Array.from(this.#claims.entries())) {
      if (claim.scopeKey === scopeKey) {
        this.#claims.delete(id);
        released += 1;
      }
    }
    if (released > 0) {
      this.refresh();
    }
    return released;
  }

  clear(): void {
    if (this.#claims.size === 0 && this.#lastElements.size === 0) {
      return;
    }
    this.#claims.clear();
    this.refresh();
  }

  refresh(): void {
    for (const element of this.#lastElements) {
      element.removeAttribute(this.hiddenAttribute);
    }
    this.#lastElements.clear();

    for (const claim of this.#claims.values()) {
      for (const element of this.#resolver(claim.anchor, claim.identity)) {
        element.setAttribute(this.hiddenAttribute, 'true');
        this.#lastElements.add(element);
      }
    }
  }

  activeClaimCount(): number {
    return this.#claims.size;
  }

  activeClaimKeys(): string[] {
    return Array.from(this.#claims.values(), (claim) => claim.claimKey);
  }
}

export const replayAnimationVisibility = new AnimationVisibilityManager();
