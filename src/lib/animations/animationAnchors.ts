export type AnimationBoardSlot = 'active' | 'bench';

export type AnimationAnchorRef =
  | { kind: 'hand'; playerIndex: number }
  | { kind: 'hand-slot'; playerIndex: number; handIndex: number }
  | { kind: 'hand-card'; playerIndex: number; handIndex?: number; serial?: number }
  | { kind: 'deck-top'; playerIndex: number }
  | { kind: 'discard-pile'; playerIndex: number }
  | { kind: 'discard-card'; playerIndex: number; serial?: number }
  | { kind: 'play-zone-card'; playerIndex: number; serial?: number }
  | { kind: 'stadium-card'; playerIndex: number; serial?: number }
  | { kind: 'pokemon-card'; playerIndex: number; slot: AnimationBoardSlot; slotIndex: number; serial?: number }
  | { kind: 'board-slot'; playerIndex: number; slot: AnimationBoardSlot; slotIndex: number }
  | { kind: 'attached-energy'; playerIndex: number; slot: AnimationBoardSlot; slotIndex: number; serial?: number }
  | { kind: 'attached-tool'; playerIndex: number; slot: AnimationBoardSlot; slotIndex: number; serial?: number }
  | { kind: 'prize-card'; playerIndex: number; prizeIndex: number }
  | { kind: 'reveal-card'; playerIndex: number; revealIndex: number; serial?: number };

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
      return serializeParts('player', anchor.playerIndex, 'prize-card', anchor.prizeIndex);
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
      return prizeIndex === null || parts.length !== 4 ? null : { kind, playerIndex, prizeIndex };
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
  }
  if ('revealIndex' in anchor) {
    attrs['data-animation-reveal-index'] = anchor.revealIndex;
  }
  if (identity) {
    attrs['data-animation-identity'] = serializeAnimationIdentity(identity);
    attrs['data-animation-identity-kind'] = identity.kind;
    attrs['data-animation-card-serial'] = identity.serial ?? attrs['data-animation-card-serial'];
    attrs['data-animation-card-id'] = identity.cardId;
  }

  return attrs;
}

export function animationAnchorSelector(anchor: AnimationAnchorRef, identity?: AnimationIdentity): string {
  const attrs = animationAnchorAttributes(anchor, identity);
  const selectorParts = [
    `[data-animation-anchor-key="${escapeCssAttributeValue(String(attrs['data-animation-anchor-key']))}"]`,
  ];
  if (identity?.serial !== undefined) {
    selectorParts.push(`[data-animation-card-serial="${identity.serial}"]`);
  }
  if (identity?.cardId !== undefined) {
    selectorParts.push(`[data-animation-card-id="${identity.cardId}"]`);
  }
  return selectorParts.join('');
}

export function resolveAnimationAnchorElements(
  anchor: AnimationAnchorRef,
  { root, identity }: AnimationAnchorResolveOptions = {},
): HTMLElement[] {
  const resolvedRoot = root ?? globalThis.document;
  if (!resolvedRoot) {
    return [];
  }
  return Array.from(resolvedRoot.querySelectorAll(animationAnchorSelector(anchor, identity)))
    .filter((element): element is HTMLElement => element instanceof HTMLElement);
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
  const serial = Number(element.dataset.animationCardSerial);
  const cardId = Number(element.dataset.animationCardId);
  return compact({
    kind,
    serial: Number.isFinite(serial) ? serial : undefined,
    cardId: Number.isFinite(cardId) ? cardId : undefined,
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
