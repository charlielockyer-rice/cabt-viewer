export const PlayerType = {
  ANY: 0,
  TOP_PLAYER: 1,
  BOTTOM_PLAYER: 2,
} as const;

export const SlotType = {
  BOARD: 0,
  ACTIVE: 1,
  BENCH: 2,
  HAND: 3,
  DISCARD: 4,
  LOSTZONE: 5,
  DECK: 6,
} as const;

export type CardTarget = {
  player: number;
  slot: number;
  index: number;
};

export type CardView = {
  id?: number;
  serial?: number;
  playerIndex?: number;
  name: string;
  fullName: string;
  set?: string;
  setNumber?: string;
  cardImage?: string;
  imageUrl?: string;
  superType?: string | number;
  cardType?: string | number;
  trainerType?: string | number;
  energyType?: string | number;
  stage?: string | number;
  evolvesFrom?: string;
  hp?: number;
  retreat?: unknown[];
  attacks?: AttackView[];
  powers?: PowerView[];
};

export type AttackView = {
  name: string;
  cost?: unknown;
  damage?: string;
  text?: string;
};

export type PowerView = {
  name: string;
  powerType?: string | number;
  text?: string;
};

export type AvailableActionStatus = {
  name: string;
  legal: boolean;
  reason?: string;
  // Engine option index to select when legal (live decisions only).
  optionIndex?: number;
};

export type AvailableAbilityStatus = AvailableActionStatus & {
  used?: boolean;
};

export type AvailableRetreatStatus = {
  legal: boolean;
  targets: number[];
  reason?: string;
  optionIndex?: number;
};

export type AvailableActionsView = {
  active?: {
    attacks: AvailableActionStatus[];
    abilities: AvailableAbilityStatus[];
    retreat: AvailableRetreatStatus;
  };
  bench: Array<{
    index: number;
    abilities: AvailableAbilityStatus[];
  }>;
};

export type PokemonSlotView = {
  ownerIndex: number;
  slot: 'active' | 'bench';
  index: number;
  target: CardTarget;
  empty: boolean;
  pokemon?: CardView;
  cards: CardView[];
  damage: number;
  hp: number;
  retreat: unknown[];
  energy: CardView[];
  tools: CardView[];
  specialConditions: unknown[];
};

export type PlayerView = {
  index: number;
  id: number;
  name: string;
  hand: CardView[];
  deckCount: number;
  discard: CardView[];
  lostZone: CardView[];
  stadium: CardView[];
  playZone: CardView[];
  prizesLeft: number;
  active: PokemonSlotView;
  bench: PokemonSlotView[];
  playableCardIds: number[];
  availableActions?: AvailableActionsView;
};

export type LogView = {
  id: number;
  message: string;
  params?: unknown;
  client?: number;
};

export type ActionTimelineEvent = {
  id: number;
  message: string;
  playerIndex?: number;
  kind?: string;
  params?: unknown;
};

// Seat-absolute board address (never viewer-relative).
export type BoardSlotRef = {
  ownerIndex: number;
  slot: 'active' | 'bench';
  index: number;
};

// One engine select option, projected with everything the UI needs to offer
// it as an affordance. `index` is the engine option index — selecting is
// sending it back; legality is presence in the list.
export type DecisionOptionView = {
  index: number;
  type: number;
  area?: number;
  label: string;
  card?: CardView;
  // Main-phase hand plays: which hand card this option plays.
  hand?: { playerIndex: number; handIndex: number };
  // In-play destination for targeted hand plays (attach, evolve).
  boardTarget?: BoardSlotRef;
  // The Pokemon currently occupying boardTarget. Product options (hand card
  // × board target) can wear identical faces with different consequences;
  // the target is what tells them apart.
  boardTargetCard?: CardView;
  // Board slot this option points at (switch targets, new active, …).
  board?: BoardSlotRef;
  // The option selects a card attached to `board` rather than the slot itself.
  attached?: boolean;
  attackName?: string;
  abilityName?: string;
  number?: number;
};

// The engine's current select, projected 1:1. This is the only interaction
// contract: every affordance derives from `options`, and the one engine
// command is `select {seq, indexes}`.
export type DecisionView = {
  seq: number;
  seat: number;
  kind: 'main' | 'choose-cards' | 'choose-prize' | 'choose-option';
  message: string;
  min: number;
  max: number;
  // Sequential effects (damage counter placement, energy payment) count down
  // across repeated single-pick decisions; show the player their progress.
  remaining?: number;
  // Which engine countdown `remaining` came from — picks the affordance
  // styling (damage counter chips vs energy pips), never card semantics.
  remainingKind?: 'damage' | 'energy';
  options: DecisionOptionView[];
};

export type SeatView = {
  control: 'self' | 'agent';
  name: string;
};

export type GameView = {
  ready: boolean;
  phase: number;
  phaseLabel: string;
  turn: number;
  activePlayerIndex: number;
  activePlayerId?: number;
  winner?: number;
  players: PlayerView[];
  decision?: DecisionView;
  seats?: SeatView[];
  turnSeat?: number;
  logs: LogView[];
  actionTimeline?: ActionTimelineEvent[];
  events: unknown[];
};

export type EngineOk = {
  ok: true;
  view: GameView;
  sequence?: GameView[];
  sessionId?: string;
};

export type EngineFailure = {
  ok: false;
  error: string;
  view?: GameView;
};

export type EngineResponse = EngineOk | EngineFailure;

export function targetFor(actorIndex: number, ownerIndex: number, slot: number, index = 0): CardTarget {
  return {
    player: actorIndex === ownerIndex ? PlayerType.BOTTOM_PLAYER : PlayerType.TOP_PLAYER,
    slot,
    index,
  };
}
