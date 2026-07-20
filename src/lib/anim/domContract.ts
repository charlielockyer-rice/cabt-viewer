// The animation↔board contract, in one place.
//
// The animation layer finds real board elements by a set of data-attributes and
// a `data-card-anchor` value grammar that board components emit. That handshake
// used to live as bare string literals scattered across the producers
// (CenterPiles, BoardSlot, Hand, GameBoard, CardTile) and the consumers
// (anchors.ts, the animation layers) — a rename in one place silently broke the
// other. These constants are the single source of truth both sides reference.
//
// (Svelte can't interpolate a constant into a template *attribute name*, so
// producer templates still write the attribute literally — but their VALUES go
// through cardAnchorValue, and every querySelector consumer uses these names.)

export const AnimAttr = {
  cardAnchor: 'data-card-anchor',
  cardSerial: 'data-card-serial',
  cardId: 'data-card-id',
  pokemonSerial: 'data-pokemon-serial',
  pokemonCardId: 'data-pokemon-card-id',
  ownerIndex: 'data-owner-index',
  energySerial: 'data-energy-serial',
  toolSerial: 'data-tool-serial',
  handCardSlot: 'data-hand-card-slot',
  animLayer: 'data-anim-layer',
} as const;

// The `data-card-anchor` value grammar: player:<index>:<zone>[:<slot>].
export const cardAnchorValue = {
  hand: (player: number) => `player:${player}:hand`,
  deck: (player: number) => `player:${player}:deck`,
  discard: (player: number) => `player:${player}:discard`,
  stadium: (player: number) => `player:${player}:stadium`,
  playZone: (player: number) => `player:${player}:playZone`,
  prize: (player: number, index: number) => `player:${player}:prize:${index}`,
  slot: (player: number, slot: string, index: number) => `player:${player}:${slot}:${index}`,
  // The per-card hand-slot marker (data-hand-card-slot value prefix).
  handSlotPrefix: (player: number) => `player:${player}:hand:`,
  // A player's prize anchors as a value prefix (for a `^=` match over all prizes).
  prizePrefix: (player: number) => `player:${player}:prize:`,
} as const;

// Attribute-selector helper: `attr(AnimAttr.cardSerial, 5)` -> [data-card-serial="5"].
export function attr(name: string, value: string | number): string {
  return `[${name}="${value}"]`;
}
