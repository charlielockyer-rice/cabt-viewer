export type AnimationBoardSlot = 'active' | 'bench';

export type AnimationHandAnchorRef = { kind: 'hand'; playerIndex: number };
export type AnimationHandCardAnchorRef = { kind: 'hand-card'; playerIndex: number; handIndex?: number; serial?: number };
export type AnimationHandInsertionSlotAnchorRef = { kind: 'hand-slot'; playerIndex: number; handIndex: number };
export type AnimationDeckTopAnchorRef = { kind: 'deck-top'; playerIndex: number };
export type AnimationDiscardTopCardAnchorRef = { kind: 'discard-card'; playerIndex: number; serial?: number };
export type AnimationDiscardPileSurfaceAnchorRef = { kind: 'discard-pile'; playerIndex: number };
export type AnimationPlayZoneCardAnchorRef = { kind: 'play-zone-card'; playerIndex: number; serial?: number };
export type AnimationStadiumCardAnchorRef = { kind: 'stadium-card'; playerIndex: number; serial?: number };
export type AnimationActivePokemonCardAnchorRef = { kind: 'pokemon-card'; playerIndex: number; slot: 'active'; slotIndex: number; serial?: number };
export type AnimationBenchPokemonCardAnchorRef = { kind: 'pokemon-card'; playerIndex: number; slot: 'bench'; slotIndex: number; serial?: number };
export type AnimationBoardSlotSurfaceAnchorRef = { kind: 'board-slot'; playerIndex: number; slot: AnimationBoardSlot; slotIndex: number };
export type AnimationBenchSlotSurfaceAnchorRef = { kind: 'board-slot'; playerIndex: number; slot: 'bench'; slotIndex: number };
export type AnimationAttachedEnergyAnchorRef = { kind: 'attached-energy'; playerIndex: number; slot: AnimationBoardSlot; slotIndex: number; serial?: number };
export type AnimationAttachedToolAnchorRef = { kind: 'attached-tool'; playerIndex: number; slot: AnimationBoardSlot; slotIndex: number; serial?: number };
export type AnimationPrizeAnchorRef = { kind: 'prize-card'; playerIndex: number; prizeIndex: number; face?: 'card' | 'back' };
export type AnimationRevealSearchCardSlotAnchorRef = { kind: 'reveal-card'; playerIndex: number; revealIndex: number; serial?: number };

export type AnimationAnchorRef =
  | AnimationHandAnchorRef
  | AnimationHandInsertionSlotAnchorRef
  | AnimationHandCardAnchorRef
  | AnimationDeckTopAnchorRef
  | AnimationDiscardPileSurfaceAnchorRef
  | AnimationDiscardTopCardAnchorRef
  | AnimationPlayZoneCardAnchorRef
  | AnimationStadiumCardAnchorRef
  | AnimationActivePokemonCardAnchorRef
  | AnimationBenchPokemonCardAnchorRef
  | AnimationBoardSlotSurfaceAnchorRef
  | AnimationAttachedEnergyAnchorRef
  | AnimationAttachedToolAnchorRef
  | AnimationPrizeAnchorRef
  | AnimationRevealSearchCardSlotAnchorRef;

export type AnimationIdentityKind = 'card' | 'pokemon' | 'energy' | 'tool' | 'stadium' | 'prize' | 'unknown';

export type AnimationIdentity = {
  kind: AnimationIdentityKind;
  serial?: number;
  cardId?: number;
  name?: string;
};

export type AnimationAnchorResolveOptions = {
  root?: ParentNode;
  identity?: AnimationIdentity;
};

export type AnimationAnchorAttributes = Record<string, string | number | undefined>;

export type ResolvedAnimationAnchor = {
  element: HTMLElement;
  anchor: AnimationAnchorRef;
  identity?: AnimationIdentity;
};

const anchorKinds = new Set<AnimationAnchorRef['kind']>([
  'hand',
  'hand-slot',
  'hand-card',
  'deck-top',
  'discard-pile',
  'discard-card',
  'play-zone-card',
  'stadium-card',
  'pokemon-card',
  'board-slot',
  'attached-energy',
  'attached-tool',
  'prize-card',
  'reveal-card',
]);

const boardSlots = new Set<AnimationBoardSlot>(['active', 'bench']);

export function serializeAnimationAnchor(anchor: AnimationAnchorRef): string {
  switch (anchor.kind) {
    case 'hand':
      return `player:${anchor.playerIndex}:hand`;
    case 'hand-slot':
      return serializeParts('player', anchor.playerIndex, 'hand-slot', anchor.handIndex);
    case 'hand-card':
      return serializeParts('player', anchor.playerIndex, 'hand-card', taggedPart('index', anchor.handIndex), taggedPart('serial', anchor.serial));
    case 'deck-top':
      return `player:${anchor.playerIndex}:deck-top`;
    case 'discard-pile':
      return `player:${anchor.playerIndex}:discard-pile`;
    case 'discard-card':
      return serializeParts('player', anchor.playerIndex, 'discard-card', taggedPart('serial', anchor.serial));
    case 'play-zone-card':
      return serializeParts('player', anchor.playerIndex, 'play-zone-card', taggedPart('serial', anchor.serial));
    case 'stadium-card':
      return serializeParts('player', anchor.playerIndex, 'stadium-card', taggedPart('serial', anchor.serial));
    case 'pokemon-card':
      return serializeParts('player', anchor.playerIndex, 'pokemon-card', anchor.slot, anchor.slotIndex, taggedPart('serial', anchor.serial));
    case 'board-slot':
      return serializeParts('player', anchor.playerIndex, 'board-slot', anchor.slot, anchor.slotIndex);
    case 'attached-energy':
      return serializeParts('player', anchor.playerIndex, 'attached-energy', anchor.slot, anchor.slotIndex, taggedPart('serial', anchor.serial));
    case 'attached-tool':
      return serializeParts('player', anchor.playerIndex, 'attached-tool', anchor.slot, anchor.slotIndex, taggedPart('serial', anchor.serial));
    case 'prize-card':
      return serializeParts('player', anchor.playerIndex, 'prize-card', anchor.prizeIndex, taggedPart('face', anchor.face));
    case 'reveal-card':
      return serializeParts('player', anchor.playerIndex, 'reveal-card', anchor.revealIndex, taggedPart('serial', anchor.serial));
  }
}

export function parseAnimationAnchor(value: string): AnimationAnchorRef | null {
  const parts = value.split(':');
  if (parts[0] !== 'player') {
    return null;
  }
  const playerIndex = parseNumber(parts[1]);
  if (playerIndex === null) {
    return null;
  }
  const kind = parts[2] as AnimationAnchorRef['kind'] | undefined;
  if (!kind || !anchorKinds.has(kind)) {
    return null;
  }

  switch (kind) {
    case 'hand':
      return parts.length === 3 ? { kind, playerIndex } : null;
    case 'hand-slot': {
      const handIndex = parseNumber(parts[3]);
      return handIndex === null || parts.length !== 4 ? null : { kind, playerIndex, handIndex };
    }
    case 'hand-card': {
      const tags = parseTags(parts, 3, ['index', 'serial']);
      if (!tags) {
        return null;
      }
      const handIndex = parseTaggedNumber(tags, 'index');
      const serial = parseTaggedNumber(tags, 'serial');
      return handIndex === false || serial === false ? null : compact({ kind, playerIndex, handIndex, serial });
    }
    case 'deck-top':
    case 'discard-pile':
      return parts.length === 3 ? { kind, playerIndex } : null;
    case 'discard-card':
    case 'play-zone-card':
    case 'stadium-card': {
      const tags = parseTags(parts, 3, ['serial']);
      if (!tags) {
        return null;
      }
      const serial = parseTaggedNumber(tags, 'serial');
      return serial === false ? null : compact({ kind, playerIndex, serial } as AnimationAnchorRef);
    }
    case 'pokemon-card':
    case 'board-slot':
    case 'attached-energy':
    case 'attached-tool': {
      const slot = parts[3] as AnimationBoardSlot | undefined;
      const slotIndex = parseNumber(parts[4]);
      if (!slot || !boardSlots.has(slot) || slotIndex === null) {
        return null;
      }
      if (kind === 'board-slot') {
        return parts.length === 5 ? { kind, playerIndex, slot, slotIndex } : null;
      }
      const tags = parseTags(parts, 5, ['serial']);
      if (!tags) {
        return null;
      }
      const serial = parseTaggedNumber(tags, 'serial');
      return serial === false ? null : compact({ kind, playerIndex, slot, slotIndex, serial } as AnimationAnchorRef);
    }
    case 'prize-card': {
      const prizeIndex = parseNumber(parts[3]);
      if (prizeIndex === null) {
        return null;
      }
      if (parts.length === 4) {
        return { kind, playerIndex, prizeIndex };
      }
      const tags = parseTags(parts, 4, ['face']);
      const face = tags?.get('face');
      return face === 'card' || face === 'back'
        ? { kind, playerIndex, prizeIndex, face }
        : null;
    }
    case 'reveal-card': {
      const revealIndex = parseNumber(parts[3]);
      if (revealIndex === null) {
        return null;
      }
      const tags = parseTags(parts, 4, ['serial']);
      if (!tags) {
        return null;
      }
      const serial = parseTaggedNumber(tags, 'serial');
      return serial === false ? null : compact({ kind, playerIndex, revealIndex, serial });
    }
  }
}

export function serializeAnimationIdentity(identity: AnimationIdentity | undefined): string {
  if (!identity) {
    return '';
  }
  return serializeParts(
    identity.kind,
    taggedPart('serial', identity.serial),
    taggedPart('card', identity.cardId),
    taggedPart('name', identity.name ? encodeURIComponent(identity.name) : undefined),
  );
}

export function parseAnimationIdentity(value: string): AnimationIdentity | null {
  if (!value) {
    return null;
  }
  const parts = value.split(':');
  const kind = parts[0] as AnimationIdentityKind | undefined;
  if (!kind || !['card', 'pokemon', 'energy', 'tool', 'stadium', 'prize', 'unknown'].includes(kind)) {
    return null;
  }
  const tags = parseTags(parts, 1, ['serial', 'card', 'name']);
  if (!tags) {
    return null;
  }
  const serial = parseTaggedNumber(tags, 'serial');
  const cardId = parseTaggedNumber(tags, 'card');
  if (serial === false || cardId === false) {
    return null;
  }
  const encodedName = tags.get('name');
  return compact({
    kind,
    serial,
    cardId,
    name: encodedName ? decodeURIComponent(encodedName) : undefined,
  });
}

export function animationAnchorAttributes(anchor: AnimationAnchorRef, identity?: AnimationIdentity): AnimationAnchorAttributes {
  const attrs: AnimationAnchorAttributes = {
    'data-animation-anchor': anchor.kind,
    'data-animation-anchor-key': serializeAnimationAnchor(anchor),
    'data-animation-player': anchor.playerIndex,
  };

  if ('serial' in anchor) {
    attrs['data-animation-card-serial'] = anchor.serial;
  }
  if ('slot' in anchor) {
    attrs['data-animation-slot'] = anchor.slot;
    attrs['data-animation-slot-index'] = anchor.slotIndex;
  }
  if ('handIndex' in anchor) {
    attrs['data-animation-hand-index'] = anchor.handIndex;
  }
  if ('prizeIndex' in anchor) {
    attrs['data-animation-prize-index'] = anchor.prizeIndex;
    attrs['data-animation-prize-face'] = anchor.face;
  }
  if ('revealIndex' in anchor) {
    attrs['data-animation-reveal-index'] = anchor.revealIndex;
  }
  if (identity) {
    attrs['data-animation-identity'] = serializeAnimationIdentity(identity);
    attrs['data-animation-identity-kind'] = identity.kind;
    attrs['data-animation-card-serial'] = identity.serial ?? attrs['data-animation-card-serial'];
    attrs['data-animation-card-id'] = identity.cardId;
    attrs['data-animation-card-name'] = identity.name;
  }

  return attrs;
}

export function animationAnchorSelector(anchor: AnimationAnchorRef, identity?: AnimationIdentity): string {
  const selector = baseAnimationAnchorSelector(anchor);
  const identitySelectors = animationIdentitySelectorParts(identity);
  return [selector, ...identitySelectors].join('');
}

export function animationAnchorCandidateSelectors(anchor: AnimationAnchorRef, identity?: AnimationIdentity): string[] {
  const selector = baseAnimationAnchorSelector(anchor);
  const identitySelectors = animationIdentitySelectorParts(identity);
  if (identitySelectors.length === 0) {
    return [selector];
  }
  return Array.from(new Set([
    [selector, ...identitySelectors].join(''),
    ...identitySelectors.map((identitySelector) => `${selector}${identitySelector}`),
  ]));
}

function baseAnimationAnchorSelector(anchor: AnimationAnchorRef): string {
  const attrs = animationAnchorAttributes(anchor);
  return `[data-animation-anchor-key="${escapeCssAttributeValue(String(attrs['data-animation-anchor-key']))}"]`;
}

function animationIdentitySelectorParts(identity: AnimationIdentity | undefined): string[] {
  const selectorParts: string[] = [];
  if (identity?.serial !== undefined) {
    selectorParts.push(`[data-animation-card-serial="${identity.serial}"]`);
  }
  if (identity?.cardId !== undefined) {
    selectorParts.push(`[data-animation-card-id="${identity.cardId}"]`);
  }
  if (identity?.name) {
    selectorParts.push(`[data-animation-card-name="${escapeCssAttributeValue(identity.name)}"]`);
  }
  return selectorParts;
}

export function resolveAnimationAnchorElements(
  anchor: AnimationAnchorRef,
  { root, identity }: AnimationAnchorResolveOptions = {},
): HTMLElement[] {
  const resolvedRoot = root ?? globalThis.document;
  if (!resolvedRoot) {
    return [];
  }
  const elements = new Set<HTMLElement>();
  for (const selector of animationAnchorCandidateSelectors(anchor, identity)) {
    for (const element of Array.from(resolvedRoot.querySelectorAll(selector))) {
      if (element instanceof HTMLElement && animationIdentityMatchesElement(element, identity)) {
        elements.add(element);
      }
    }
  }
  return Array.from(elements);
}

export function resolveExactAnimationAnchorElement(
  anchor: AnimationAnchorRef,
  options: AnimationAnchorResolveOptions = {},
): HTMLElement | null {
  return resolveAnimationAnchorElements(anchor, options).at(0) ?? null;
}

export function animationAnchorForElement(element: Element): ResolvedAnimationAnchor | null {
  const anchoredElement = element.closest('[data-animation-anchor-key]');
  if (!(anchoredElement instanceof HTMLElement)) {
    return null;
  }
  const anchorKey = anchoredElement.dataset.animationAnchorKey;
  if (!anchorKey) {
    return null;
  }
  const anchor = parseAnimationAnchor(anchorKey);
  if (!anchor) {
    return null;
  }
  return {
    element: anchoredElement,
    anchor,
    identity: animationIdentityForElement(anchoredElement),
  };
}

export function animationIdentityForElement(element: HTMLElement): AnimationIdentity | undefined {
  const parsed = parseAnimationIdentity(element.dataset.animationIdentity ?? '');
  if (parsed) {
    return parsed;
  }
  const kind = animationIdentityKindForAnchor(element.dataset.animationAnchor);
  if (!kind) {
    return undefined;
  }
  const anchor = parseAnimationAnchor(element.dataset.animationAnchorKey ?? '');
  const serial = parseOptionalDatasetNumber(element.dataset.animationCardSerial ?? element.dataset.cardSerial)
    ?? (anchor && 'serial' in anchor ? anchor.serial : undefined);
  const cardId = parseOptionalDatasetNumber(element.dataset.animationCardId ?? element.dataset.cardId);
  const name = element.dataset.animationCardName ?? element.dataset.cardName;
  return compact({
    kind,
    serial,
    cardId,
    name,
  });
}

export function animationIdentityKindForAnchor(anchorKind: string | undefined): AnimationIdentityKind | null {
  if (anchorKind === 'pokemon-card') {
    return 'pokemon';
  }
  if (anchorKind === 'attached-energy') {
    return 'energy';
  }
  if (anchorKind === 'attached-tool') {
    return 'tool';
  }
  if (anchorKind === 'stadium-card') {
    return 'stadium';
  }
  if (anchorKind === 'prize-card') {
    return 'prize';
  }
  if (anchorKind === 'hand-card'
    || anchorKind === 'discard-card'
    || anchorKind === 'play-zone-card') {
    return 'card';
  }
  return null;
}

export function animationClaimKey(parts: {
  scopeKey: string;
  anchor: AnimationAnchorRef;
  identity?: AnimationIdentity;
  role: string;
}): string {
  return [
    parts.scopeKey,
    parts.role,
    serializeAnimationAnchor(parts.anchor),
    serializeAnimationIdentity(parts.identity),
  ].join('|');
}

function animationIdentityMatchesElement(element: HTMLElement, identity: AnimationIdentity | undefined): boolean {
  if (!identity) {
    return true;
  }
  const elementIdentity = animationIdentityForElement(element);
  if (!elementIdentity) {
    return true;
  }
  if (identity.serial !== undefined && elementIdentity.serial !== undefined) {
    return identity.serial === elementIdentity.serial;
  }
  if (identity.cardId !== undefined && elementIdentity.cardId !== undefined) {
    return identity.cardId === elementIdentity.cardId;
  }
  if (identity.name && elementIdentity.name) {
    return identity.name === elementIdentity.name;
  }
  return true;
}

function serializeParts(...parts: Array<string | number | string[] | undefined>): string {
  return parts
    .filter((part) => part !== undefined)
    .flatMap((part) => Array.isArray(part) ? part : [part])
    .map(String)
    .join(':');
}

function taggedPart(tag: string, value: string | number | undefined): string[] | undefined {
  return value === undefined ? undefined : [tag, String(value)];
}

function parseNumber(value: string | undefined): number | null {
  if (value === undefined || value === '') {
    return null;
  }
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : null;
}

function compact<T extends Record<string, unknown>>(value: T): T {
  for (const key of Object.keys(value)) {
    if (value[key] === undefined) {
      delete value[key];
    }
  }
  return value;
}

function parseOptionalDatasetNumber(value: string | undefined): number | undefined {
  if (value === undefined || value === '') {
    return undefined;
  }
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : undefined;
}

function escapeCssAttributeValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function parseTags(parts: string[], startIndex: number, allowedTags: string[]): Map<string, string> | null {
  const remaining = parts.length - startIndex;
  if (remaining < 0 || remaining % 2 !== 0) {
    return null;
  }
  const tags = new Map<string, string>();
  const allowed = new Set(allowedTags);
  for (let index = startIndex; index < parts.length; index += 2) {
    const tag = parts[index];
    const value = parts[index + 1];
    if (!tag || !allowed.has(tag) || value === undefined || tags.has(tag)) {
      return null;
    }
    tags.set(tag, value);
  }
  return tags;
}

function parseTaggedNumber(tags: Map<string, string>, tag: string): number | undefined | false {
  if (!tags.has(tag)) {
    return undefined;
  }
  return parseNumber(tags.get(tag)) ?? false;
}
