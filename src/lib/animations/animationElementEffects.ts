export type AnimationElementEffectClaim = {
  readonly id: number;
  readonly element: HTMLElement;
  readonly attributes: readonly string[];
  readonly styles: readonly string[];
};

type EffectEntry = {
  id: number;
  value: string;
};

type ElementEffectState = {
  attributes: Map<string, EffectEntry[]>;
  styles: Map<string, EffectEntry[]>;
};

let nextEffectClaimId = 1;
const elementEffects = new WeakMap<HTMLElement, ElementEffectState>();

export function claimAnimationElementEffect(input: {
  element: HTMLElement;
  attributes?: Record<string, string>;
  styles?: Record<string, string>;
}): AnimationElementEffectClaim {
  const id = nextEffectClaimId++;
  const attributes = input.attributes ?? {};
  const styles = input.styles ?? {};
  const state = elementEffectState(input.element);

  for (const [name, value] of Object.entries(attributes)) {
    const stack = state.attributes.get(name) ?? [];
    stack.push({ id, value });
    state.attributes.set(name, stack);
    input.element.setAttribute(name, value);
  }

  for (const [name, value] of Object.entries(styles)) {
    const stack = state.styles.get(name) ?? [];
    stack.push({ id, value });
    state.styles.set(name, stack);
    input.element.style.setProperty(name, value);
  }

  return {
    id,
    element: input.element,
    attributes: Object.keys(attributes),
    styles: Object.keys(styles),
  };
}

export function releaseAnimationElementEffectClaim(claim: AnimationElementEffectClaim): void {
  const state = elementEffects.get(claim.element);
  if (!state) {
    return;
  }

  for (const name of claim.attributes) {
    releaseStackedAttribute(claim.element, state, name, claim.id);
  }

  for (const name of claim.styles) {
    releaseStackedStyle(claim.element, state, name, claim.id);
  }

  if (!state.attributes.size && !state.styles.size) {
    elementEffects.delete(claim.element);
  }
}

export function releaseAnimationElementEffectClaims(claims: Iterable<AnimationElementEffectClaim>): void {
  for (const claim of claims) {
    releaseAnimationElementEffectClaim(claim);
  }
}

function elementEffectState(element: HTMLElement): ElementEffectState {
  const existing = elementEffects.get(element);
  if (existing) {
    return existing;
  }
  const state: ElementEffectState = {
    attributes: new Map(),
    styles: new Map(),
  };
  elementEffects.set(element, state);
  return state;
}

function releaseStackedAttribute(
  element: HTMLElement,
  state: ElementEffectState,
  name: string,
  claimId: number,
) {
  const stack = removeStackEntry(state.attributes.get(name), claimId);
  if (!stack.length) {
    state.attributes.delete(name);
    element.removeAttribute(name);
    return;
  }
  state.attributes.set(name, stack);
  element.setAttribute(name, stack.at(-1)?.value ?? '');
}

function releaseStackedStyle(
  element: HTMLElement,
  state: ElementEffectState,
  name: string,
  claimId: number,
) {
  const stack = removeStackEntry(state.styles.get(name), claimId);
  if (!stack.length) {
    state.styles.delete(name);
    element.style.removeProperty(name);
    return;
  }
  state.styles.set(name, stack);
  element.style.setProperty(name, stack.at(-1)?.value ?? '');
}

function removeStackEntry(stack: EffectEntry[] | undefined, claimId: number): EffectEntry[] {
  return (stack ?? []).filter((entry) => entry.id !== claimId);
}
