export type Anchor =
  | { kind: 'slot'; player: number; slot: 'active' | 'bench'; index: number }
  | { kind: 'pokemon'; player?: number; serial?: number; cardId?: number }
  | { kind: 'deck'; player: number }
  // Discard resolution: `surface` targets the pile itself (deck-mill landing),
  // `exact` requires the identified card and resolves to null otherwise (safe
  // hide claims), the default prefers the identified card, then the top card,
  // then the pile.
  | { kind: 'discard'; player: number; serial?: number; cardId?: number; exact?: boolean; surface?: boolean }
  | { kind: 'stadium'; player: number; serial?: number }
  | { kind: 'attached'; attached: 'energy' | 'tool'; serial: number }
  | { kind: 'hand'; player: number }
  // Hand slots resolve by serial first, then by position: `fromEnd` counts
  // back from the last slot (arriving cards land at the end of the hand),
  // `index` counts from the start (mulligan redraws refill in order).
  | { kind: 'hand-slot'; player: number; serial?: number; fromEnd?: number; index?: number }
  | { kind: 'prize'; player: number; index: number }
  | { kind: 'playZone'; player: number; serial?: number };

export type ResolvedAnchor = {
  // The element visibility claims attach to.
  element: HTMLElement;
  // The element sprites measure their geometry from. Attached cards animate
  // from the owning Pokemon card's footprint, not the badge itself.
  geometry: HTMLElement;
};

export function resolveAnchor(anchor: Anchor): ResolvedAnchor | null {
  switch (anchor.kind) {
    case 'slot': {
      const element = query(`[data-card-anchor="player:${anchor.player}:${anchor.slot}:${anchor.index}"]`);
      return element ? { element, geometry: element } : null;
    }
    case 'pokemon': {
      const element = pokemonElement(anchor);
      return element ? { element, geometry: element } : null;
    }
    case 'deck': {
      const pile = query(`[data-card-anchor="player:${anchor.player}:deck"]`)?.closest('.deck-pile');
      if (!(pile instanceof HTMLElement)) {
        return null;
      }
      const face = pile.querySelector('.deck-card-face');
      return { element: pile, geometry: face instanceof HTMLElement ? face : pile };
    }
    case 'discard': {
      const pile = query(`[data-card-anchor="player:${anchor.player}:discard"]`);
      if (!pile) {
        return null;
      }
      if (anchor.surface) {
        return { element: pile, geometry: pile };
      }
      const exactCard = discardCardElement(pile, anchor.serial, anchor.cardId);
      if (anchor.exact) {
        return exactCard ? { element: exactCard, geometry: exactCard } : null;
      }
      const element = exactCard
        ?? childElement(pile, '.discard-card-top .card-tile')
        ?? childElement(pile, '.discard-card-top')
        ?? pile;
      return { element, geometry: element };
    }
    case 'stadium': {
      // Either player may use the stadium in play, so fall back from the
      // player-scoped anchor to whichever stadium is on the board.
      const element = (anchor.serial !== undefined
        ? query(`[data-card-anchor$=":stadium"][data-card-serial="${anchor.serial}"]`)
        : null)
        ?? query(`[data-card-anchor="player:${anchor.player}:stadium"]`)
        ?? query('[data-card-anchor$=":stadium"]');
      return element ? { element, geometry: element } : null;
    }
    case 'attached': {
      const attribute = anchor.attached === 'energy' ? 'data-energy-serial' : 'data-tool-serial';
      const element = query(`[${attribute}="${anchor.serial}"]`);
      if (!element) {
        return null;
      }
      const ownerCard = element.closest('.board-slot')?.querySelector('.card-tile');
      return { element, geometry: ownerCard instanceof HTMLElement ? ownerCard : element };
    }
    case 'hand': {
      const element = query(`[data-card-anchor="player:${anchor.player}:hand"]`);
      return element ? { element, geometry: element } : null;
    }
    case 'hand-slot': {
      const slots = handSlots(anchor.player);
      const element = (anchor.serial !== undefined
        ? slots.find((slot) => Number(slot.dataset.cardSerial) === anchor.serial)
        : undefined)
        ?? (anchor.fromEnd !== undefined ? slots[slots.length - anchor.fromEnd] : undefined)
        ?? (anchor.index !== undefined ? slots[anchor.index] : undefined);
      return element ? { element, geometry: element } : null;
    }
    case 'prize': {
      const element = query(`[data-card-anchor="player:${anchor.player}:prize:${anchor.index}"]`);
      return element ? { element, geometry: element } : null;
    }
    case 'playZone': {
      const zone = query(`[data-card-anchor="player:${anchor.player}:playZone"]`);
      if (!zone) {
        return null;
      }
      const card = anchor.serial !== undefined
        ? childElement(zone, `[data-card-serial="${anchor.serial}"]`)
        : null;
      const element = card ?? zone;
      return { element, geometry: element };
    }
  }
}

export function handSlots(player: number): HTMLElement[] {
  const hand = query(`[data-card-anchor="player:${player}:hand"]`);
  if (!hand) {
    return [];
  }
  return [...hand.querySelectorAll(`[data-hand-card-slot^="player:${player}:hand:"]`)]
    .filter((element): element is HTMLElement => element instanceof HTMLElement);
}

function pokemonElement(anchor: { player?: number; serial?: number; cardId?: number }): HTMLElement | null {
  if (anchor.serial !== undefined) {
    // A serial names one physical card. Never fall through to the cardId
    // lookup: it would match a same-name copy elsewhere on the board, and a
    // wrong-instance animation is worse than none (a KO'd active must not
    // borrow its benched twin).
    return query(`[data-pokemon-serial="${anchor.serial}"]`);
  }
  if (anchor.cardId !== undefined && anchor.player !== undefined) {
    return query(`[data-owner-index="${anchor.player}"][data-pokemon-card-id="${anchor.cardId}"]`);
  }
  return null;
}

function discardCardElement(pile: HTMLElement, serial?: number, cardId?: number): HTMLElement | null {
  if (serial !== undefined) {
    return childElement(pile, `.card-tile[data-card-serial="${serial}"]`);
  }
  if (cardId !== undefined) {
    return childElement(pile, `.card-tile[data-card-id="${cardId}"]`);
  }
  return null;
}

function childElement(root: HTMLElement, selector: string): HTMLElement | null {
  const element = root.querySelector(selector);
  return element instanceof HTMLElement ? element : null;
}

// Sprites render real board components, so anchor queries must never match
// elements inside an animation layer.
function query(selector: string): HTMLElement | null {
  for (const element of document.querySelectorAll(selector)) {
    if (element instanceof HTMLElement && !element.closest('[data-anim-layer]')) {
      return element;
    }
  }
  return null;
}
