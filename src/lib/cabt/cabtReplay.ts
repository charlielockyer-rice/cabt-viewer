import cardRows from './cardData.generated.json';
import attackRows from './attackData.generated.json';
import { cabtLogsToTimeline } from './logFormat';
import { CabtAreaType } from './types';
import { resolveCardImageUrl } from '../game/cardImages';
import { SlotType, targetFor, type ActionTimelineEvent, type CardView, type GameView, type LogView, type PlayerView, type PokemonSlotView } from '../game/types';
import type { ReplaySnapshot, ReplayStep } from '../game/replay';

type CardRow = {
  id: number;
  name: string;
  set: string;
  setNumber: string;
  kind: string;
  rule: string;
  evolvesFrom: string;
  hp: number | null;
  type: string;
  retreat: number | null;
  attackName: string;
  attackCost: string;
  attackDamage: string;
  attackText: string;
  retreatCost?: number;
  attacks?: number[];
};

type AttackRow = {
  attackId: number;
  name: string;
  text?: string;
  damage?: number;
  energies?: number[];
};

type CabtCardRef = {
  id: number;
  serial?: number;
  playerIndex?: number;
  name?: string;
};

type CabtPokemonRef = CabtCardRef & {
  hp?: number;
  maxHp?: number;
  energies?: number[];
  energyCards?: CabtCardRef[];
  tools?: CabtCardRef[];
  preEvolution?: CabtCardRef[];
};

type CabtPlayerFrame = {
  active?: CabtPokemonRef[];
  bench?: CabtPokemonRef[];
  benchMax?: number;
  deckCount?: number;
  discard?: CabtCardRef[];
  hand?: CabtCardRef[];
  handCount?: number;
  prize?: Array<CabtCardRef | null>;
  poisoned?: boolean;
  burned?: boolean;
  asleep?: boolean;
  paralyzed?: boolean;
  confused?: boolean;
};

type CabtVisualizeFrame = {
  logs?: Array<Record<string, unknown>>;
  select?: Record<string, unknown> | null;
  selected?: unknown;
  action?: unknown;
  obs?: unknown;
  current: {
    turn: number;
    yourIndex: number;
    result: number;
    stadium?: CabtCardRef[];
    players: CabtPlayerFrame[];
  };
};

type KaggleContext = {
  environment?: {
    id?: string;
    title?: string;
    rewards?: number[];
    statuses?: string[];
    steps?: Array<Array<{ action?: unknown; observation?: Record<string, unknown>; status?: string; reward?: number }>>;
    info?: {
      TeamNames?: string[];
      EpisodeId?: string | number;
    };
  };
};

type CabtRunnerJson = {
  visualize?: CabtVisualizeFrame[];
  steps?: Array<{ index?: number; action?: unknown; observation?: unknown }>;
};

const cardDatabase = new Map<number, CardRow>((cardRows as CardRow[]).map((card) => [card.id, card]));
const attackDatabase = new Map<number, AttackRow>((attackRows as AttackRow[]).map((attack) => [attack.attackId, attack]));

export function cabtReplayToSnapshot(input: unknown): ReplaySnapshot {
  const visualFrames = extractVisualizeFrames(input);
  if (!visualFrames.length) {
    throw new Error('CABT replay did not include visualize frames.');
  }

  const environment = (input as KaggleContext)?.environment;
  const players = playerNames(input);
  const views: GameView[] = [];
  const steps: ReplayStep[] = [];
  const logs: LogView[] = [];
  let logId = 1;
  let timelineId = 1;

  visualFrames.forEach((frame, index) => {
    const frameLogs = frame.logs ?? [];
    const timeline = cabtLogsToTimeline(frameLogs, { nextId: timelineId });
    timelineId = timeline.nextId;
    for (const entry of frameLogs) {
      logs.push({ id: logId++, message: formatLog(entry), params: entry });
    }
    const view = frameToGameView(frame, players, logs, timeline.events);
    views.push(view);
    const groups = replayActionGroups(timeline.events, frame.current.turn);
    if (groups.length) {
      for (const [groupIndex, group] of groups.entries()) {
        steps.push(replayStepForFrame({
          view,
          stateIndex: index,
          label: group.label,
          type: group.type,
          actionTimeline: group.events,
          displayView: groupedStepDisplayView(views[index - 1], view, groups, groupIndex),
          payload: {
            events: group.events,
            select: frame.select,
            selected: frame.selected,
            action: frame.action,
          },
        }));
      }
    } else {
      steps.push(replayStepForFrame({
        view,
        stateIndex: index,
        label: stepLabel(frame, index),
        type: String(frame.select?.type ?? 'frame'),
        payload: {
          select: frame.select,
          selected: frame.selected,
          action: frame.action,
        },
      }));
    }
  });

  steps.forEach((step, index) => {
    step.index = index;
    step.actionIndex = index === 0 ? null : index - 1;
  });

  const finalView = views.at(-1);
  const winner = typeof finalView?.winner === 'number' ? finalView.winner : -1;
  return {
    id: String(environment?.id ?? 'cabt-local-replay'),
    name: environment?.title ? `${environment.title} replay` : 'CABT replay',
    created: Date.now(),
    players: players.map((name, index) => ({ userId: index, name })),
    winner,
    stateCount: views.length,
    actionCount: Math.max(0, steps.length - 1),
    turnCount: Math.max(...views.map((view) => view.turn), 0),
    cardNames: [...new Set([...cardDatabase.values()].map((card) => card.name))],
    views,
    steps,
  };
}

type ReplayActionGroup = {
  label: string;
  type: string;
  events: ActionTimelineEvent[];
  turn: number;
};

function replayActionGroups(events: ActionTimelineEvent[], turn: number): ReplayActionGroup[] {
  const groups: ReplayActionGroup[] = [];
  let current: ReplayActionGroup | null = null;

  for (const event of events) {
    if (!current || startsReplayGroup(event, current)) {
      current = groupForEvent(event, current, turn);
      groups.push(current);
      continue;
    }
    current.events.push(event);
    current.label = labelForGroup(current);
  }

  return groups;
}

function startsReplayGroup(event: ActionTimelineEvent, current: ReplayActionGroup): boolean {
  const kind = event.kind ?? 'Event';
  if (isChoiceOrPhaseKind(kind)) {
    return true;
  }
  if (isCheckupKind(kind) && current.type === 'TurnEnd') {
    return true;
  }
  if (kind === 'Draw') {
    return current.type !== 'TurnStart'
      && current.type !== 'Draw'
      && !isChoiceConsequenceGroup(current.type);
  }
  if (isMoveCardKind(kind)) {
    return isMoveCardKind(current.type) && !sameMoveCardBatch(current.events.at(-1), event);
  }
  if (kind === 'HasBasicPokemon') {
    return current.type !== 'Draw' && current.type !== 'HasBasicPokemon';
  }
  return false;
}

function groupForEvent(event: ActionTimelineEvent, previous: ReplayActionGroup | null, turn: number): ReplayActionGroup {
  const type = isCheckupKind(event.kind) && previous?.type === 'TurnEnd' ? 'PokemonCheckup' : (event.kind ?? 'Event');
  const group = {
    label: event.message,
    type,
    events: [event],
    turn,
  };
  group.label = labelForGroup(group);
  return group;
}

function labelForGroup(group: ReplayActionGroup): string {
  if (group.type === 'PokemonCheckup') {
    return 'Pokemon Checkup.';
  }
  if (group.type === 'Draw') {
    return drawGroupLabel(group.events);
  }
  if (isMoveCardKind(group.type)) {
    return moveCardGroupLabel(group.events, group.turn);
  }
  return group.events[0]?.message ?? 'Event';
}

function isChoiceOrPhaseKind(kind: string): boolean {
  return [
    'Play',
    'Attach',
    'Evolve',
    'Devolve',
    'Attack',
    'TurnEnd',
    'TurnStart',
    'Result',
  ].includes(kind);
}

function isChoiceConsequenceGroup(type: string): boolean {
  return ['Play', 'Attach', 'Evolve', 'Devolve', 'Attack'].includes(type);
}

function isCheckupKind(kind: string | undefined): boolean {
  return [
    'HPChange',
    'HpChange',
    'Poisoned',
    'Burned',
    'Asleep',
    'Paralyzed',
    'Confused',
    'Coin',
  ].includes(kind ?? '');
}

function isMoveCardKind(kind: string | undefined): boolean {
  return kind === 'MoveCard' || kind === 'MoveCardReverse';
}

function sameMoveCardBatch(previous: ActionTimelineEvent | undefined, next: ActionTimelineEvent): boolean {
  const previousParams = previous?.params as Record<string, unknown> | undefined;
  const nextParams = next.params as Record<string, unknown> | undefined;
  return previous?.playerIndex === next.playerIndex
    && Number(previousParams?.fromArea) === Number(nextParams?.fromArea)
    && Number(previousParams?.toArea) === Number(nextParams?.toArea);
}

function drawGroupLabel(events: ActionTimelineEvent[]): string {
  const drawEvents = events.filter((event) => event.kind === 'Draw');
  if (drawEvents.length === 0) {
    return events[0]?.message ?? 'Draw.';
  }
  if (drawEvents.length === 1 && events.length === 1) {
    return events[0].message;
  }

  const playerIndex = drawEvents[0].playerIndex;
  const samePlayer = drawEvents.every((event) => event.playerIndex === playerIndex);
  if (isMulliganRedrawGroup(events)) {
    if (!samePlayer || playerIndex === undefined) {
      return 'Players redrew opening hands.';
    }
    return `Player ${playerIndex + 1} redrew their opening hand.`;
  }
  if (isOpeningHandGroup(events)) {
    if (!samePlayer || playerIndex === undefined) {
      return 'Players drew opening hands.';
    }
    return `Player ${playerIndex + 1} drew an opening hand.`;
  }
  if (!samePlayer || playerIndex === undefined) {
    return `Players drew ${drawEvents.length} cards.`;
  }
  return `Player ${playerIndex + 1} drew ${drawEvents.length} cards.`;
}

function isOpeningHandGroup(events: ActionTimelineEvent[]): boolean {
  return events.some((event) => event.kind === 'HasBasicPokemon');
}

function isMulliganRedrawGroup(events: ActionTimelineEvent[]): boolean {
  return events.some((event) => event.kind === 'HasBasicPokemon' && (event.params as Record<string, unknown> | undefined)?.hasBasicPokemon === false)
    && events.some((event) => event.kind === 'Shuffle')
    && events.some((event) => {
      const params = event.params as Record<string, unknown> | undefined;
      return event.kind === 'MoveCard'
        && Number(params?.fromArea) === CabtAreaType.HAND
        && Number(params?.toArea) === CabtAreaType.DECK;
    });
}

function moveCardGroupLabel(events: ActionTimelineEvent[], turn: number): string {
  if (events.length === 1) {
    return events[0].message;
  }
  const moveEvents = events.filter((event) => isMoveCardKind(event.kind));
  const firstParams = moveEvents[0]?.params as Record<string, unknown> | undefined;
  const playerIndex = moveEvents[0]?.playerIndex;
  const samePlayer = moveEvents.every((event) => event.playerIndex === playerIndex);
  const allSameMove = moveEvents.every((event) => sameMoveCardBatch(moveEvents[0], event));
  if (
    samePlayer
    && playerIndex !== undefined
    && allSameMove
    && Number(firstParams?.fromArea) === CabtAreaType.DECK
    && Number(firstParams?.toArea) === CabtAreaType.PRIZE
  ) {
    if (turn === 0) {
      return `Player ${playerIndex + 1} set ${moveEvents.length} Prize cards.`;
    }
    return `Player ${playerIndex + 1} put ${moveEvents.length} cards from deck into their Prize cards.`;
  }
  if (
    samePlayer
    && playerIndex !== undefined
    && allSameMove
    && Number(firstParams?.fromArea) === CabtAreaType.HAND
    && Number(firstParams?.toArea) === CabtAreaType.DECK
    && events.some((event) => event.kind === 'Shuffle')
  ) {
    if (turn === 0) {
      return `Player ${playerIndex + 1} shuffled their opening hand into their deck.`;
    }
    return `Player ${playerIndex + 1} shuffled ${moveEvents.length} cards from hand into their deck.`;
  }
  if (
    samePlayer
    && playerIndex !== undefined
    && allSameMove
    && Number(firstParams?.fromArea) === CabtAreaType.PRIZE
    && Number(firstParams?.toArea) === CabtAreaType.HAND
  ) {
    return `Player ${playerIndex + 1} took ${moveEvents.length} Prize cards.`;
  }
  return events[0].message;
}

function replayStepForFrame({
  view,
  stateIndex,
  label,
  type,
  payload,
  actionTimeline,
  displayView,
}: {
  view: GameView;
  stateIndex: number;
  label: string;
  type: string;
  payload: unknown;
  actionTimeline?: ReplayStep['actionTimeline'];
  displayView?: ReplayStep['displayView'];
}): ReplayStep {
  return {
    index: 0,
    label,
    stateIndex,
    actionIndex: null,
    sequence: stateIndex,
    turn: view.turn,
    phase: view.phase,
    activePlayerIndex: view.activePlayerIndex,
    type,
    payload,
    actionTimeline,
    displayView,
  };
}

function groupedStepDisplayView(
  previousView: GameView | undefined,
  currentView: GameView,
  groups: ReplayActionGroup[],
  groupIndex: number,
): GameView | undefined {
  if (!previousView || groups.length < 2) {
    return undefined;
  }

  const players = currentView.players.map((currentPlayer, playerIndex) => {
    const previousPlayer = previousView.players[playerIndex];
    if (!previousPlayer) {
      return currentPlayer;
    }
    return {
      ...currentPlayer,
      hand: [...previousPlayer.hand],
      deckCount: previousPlayer.deckCount,
      prizesLeft: previousPlayer.prizesLeft,
      active: previousPlayer.active,
      bench: previousPlayer.bench,
      discard: previousPlayer.discard,
      playZone: previousPlayer.playZone,
    };
  });
  const view: GameView = {
    ...currentView,
    players,
  };

  for (const group of groups.slice(0, groupIndex + 1)) {
    for (const event of group.events) {
      applyReplayEvent(view, currentView, event);
    }
  }

  return view;
}

function applyReplayEvent(view: GameView, currentView: GameView, event: ActionTimelineEvent): void {
  const playerIndex = event.playerIndex;
  if (playerIndex === undefined || !view.players[playerIndex] || !currentView.players[playerIndex]) {
    return;
  }
  const player = view.players[playerIndex];
  const currentPlayer = currentView.players[playerIndex];

  if (event.kind === 'Draw' || event.kind === 'DrawReverse') {
    player.deckCount = Math.max(0, player.deckCount - 1);
    player.hand = addCardToHand(player, currentPlayer);
    return;
  }

  if (isBoardStateEvent(event.kind)) {
    player.active = currentPlayer.active;
    player.bench = currentPlayer.bench;
    player.discard = currentPlayer.discard;
    return;
  }

  if (!isMoveCardKind(event.kind)) {
    return;
  }

  const params = event.params as Record<string, unknown> | undefined;
  const fromArea = Number(params?.fromArea);
  const toArea = Number(params?.toArea);
  applyReplayAreaDelta(player, currentPlayer, fromArea, -1);
  applyReplayAreaDelta(player, currentPlayer, toArea, 1);
}

function isBoardStateEvent(kind: string | undefined): boolean {
  return [
    'Attack',
    'Attach',
    'Evolve',
    'Devolve',
    'HpChange',
    'HPChange',
    'Poisoned',
    'Burned',
    'Asleep',
    'Paralyzed',
    'Confused',
  ].includes(kind ?? '');
}

function applyReplayAreaDelta(player: PlayerView, currentPlayer: PlayerView, area: number, delta: -1 | 1): void {
  if (area === CabtAreaType.DECK) {
    player.deckCount = Math.max(0, player.deckCount + delta);
    return;
  }
  if (area === CabtAreaType.HAND) {
    player.hand = delta > 0 ? addCardToHand(player, currentPlayer) : resizedHand(player.hand, player.hand.length - 1);
    return;
  }
  if (area === CabtAreaType.PRIZE) {
    player.prizesLeft = Math.max(0, player.prizesLeft + delta);
    return;
  }
  if (area === CabtAreaType.ACTIVE) {
    player.active = currentPlayer.active;
    return;
  }
  if (area === CabtAreaType.BENCH) {
    player.bench = currentPlayer.bench;
    return;
  }
  if (area === CabtAreaType.DISCARD) {
    player.discard = currentPlayer.discard;
    return;
  }
}

function addCardToHand(player: PlayerView, currentPlayer: PlayerView): CardView[] {
  const nextCard = currentPlayer.hand[player.hand.length] ?? faceDownCard();
  return [...player.hand, nextCard];
}

function resizedHand(hand: CardView[], count: number): CardView[] {
  const nextCount = Math.max(0, Math.round(count));
  if (hand.length >= nextCount) {
    return hand.slice(0, nextCount);
  }
  return [
    ...hand,
    ...Array.from({ length: nextCount - hand.length }, () => faceDownCard()),
  ];
}

function extractVisualizeFrames(input: unknown): CabtVisualizeFrame[] {
  const runnerFrames = (input as CabtRunnerJson)?.visualize;
  if (Array.isArray(runnerFrames)) {
    return runnerFrames as CabtVisualizeFrame[];
  }

  const steps = (input as KaggleContext)?.environment?.steps;
  const frames = steps?.[0]?.[0]?.observation?.visualize;
  if (Array.isArray(frames)) {
    return frames as CabtVisualizeFrame[];
  }

  const firstStepFrames = (steps?.[0]?.[0] as { visualize?: unknown } | undefined)?.visualize;
  if (Array.isArray(firstStepFrames)) {
    return firstStepFrames as CabtVisualizeFrame[];
  }

  const nestedEnvironment = (input as { environment?: { steps?: unknown } })?.environment?.steps;
  if (Array.isArray(nestedEnvironment)) {
    const maybeFrames = (nestedEnvironment[0] as Array<Record<string, unknown>> | undefined)?.[0]?.visualize;
    if (Array.isArray(maybeFrames)) {
      return maybeFrames as CabtVisualizeFrame[];
    }
  }

  return [];
}

function frameToGameView(
  frame: CabtVisualizeFrame,
  playerNamesForReplay: string[],
  logs: LogView[],
  actionTimeline: GameView['actionTimeline'],
): GameView {
  const current = frame.current;
  const activePlayerIndex = clampPlayerIndex(current.yourIndex);
  const players = current.players.map((player, index) =>
    buildPlayerView(player, index, activePlayerIndex, playerNamesForReplay[index] ?? `Player ${index + 1}`, current.stadium ?? []),
  );
  return {
    ready: true,
    phase: current.result >= 0 ? 7 : 2,
    phaseLabel: current.result >= 0 ? 'Finished' : 'CABT replay',
    turn: current.turn,
    activePlayerIndex,
    activePlayerId: players[activePlayerIndex]?.id,
    winner: current.result >= 0 && current.result <= 1 ? current.result : current.result === 2 ? 3 : undefined,
    players,
    prompts: [],
    logs: [...logs],
    actionTimeline,
    events: [frame],
  };
}

function buildPlayerView(
  player: CabtPlayerFrame,
  index: number,
  activePlayerIndex: number,
  name: string,
  stadium: CabtCardRef[],
): PlayerView {
  const hand = player.hand ?? [];
  return {
    index,
    id: index,
    name,
    hand: hand.length ? hand.map(cardToView) : Array.from({ length: player.handCount ?? 0 }, () => faceDownCard()),
    deckCount: player.deckCount ?? 0,
    discard: (player.discard ?? []).map(cardToView),
    lostZone: [],
    stadium: stadium.map(cardToView),
    playZone: [],
    prizesLeft: player.prize?.length ?? 0,
    active: pokemonToSlot(player.active?.[0] ?? null, index, 'active', 0, activePlayerIndex, player),
    bench: Array.from({ length: Math.max(player.benchMax ?? 5, player.bench?.length ?? 0) }, (_item, benchIndex) =>
      pokemonToSlot(player.bench?.[benchIndex] ?? null, index, 'bench', benchIndex, activePlayerIndex, player),
    ),
    playableCardIds: hand.map((card) => card.id),
    availableActions: {
      active: {
        attacks: [],
        abilities: [],
        retreat: { legal: false, targets: [] },
      },
      bench: (player.bench ?? []).map((_bench, benchIndex) => ({ index: benchIndex, abilities: [] })),
    },
  };
}

function pokemonToSlot(
  pokemonCard: CabtPokemonRef | null,
  ownerIndex: number,
  slot: 'active' | 'bench',
  index: number,
  activePlayerIndex: number,
  player: CabtPlayerFrame,
): PokemonSlotView {
  const slotType = slot === 'active' ? SlotType.ACTIVE : SlotType.BENCH;
  const pokemonView = pokemonCard ? cardToView(pokemonCard) : undefined;
  const maxHp = pokemonCard?.maxHp ?? pokemonView?.hp ?? 0;
  const currentHp = pokemonCard?.hp ?? maxHp;
  return {
    ownerIndex,
    slot,
    index,
    target: targetFor(activePlayerIndex, ownerIndex, slotType, index),
    empty: !pokemonCard,
    pokemon: pokemonView,
    cards: pokemonView ? [pokemonView, ...(pokemonCard?.preEvolution ?? []).map(cardToView)] : [],
    damage: Math.max(0, maxHp - currentHp),
    hp: maxHp,
    retreat: Array.from({ length: retreatCostFor(cardDatabase.get(pokemonCard?.id ?? -1)) }, () => 'Colorless'),
    energy: (pokemonCard?.energyCards ?? []).map(cardToView),
    tools: (pokemonCard?.tools ?? []).map(cardToView),
    specialConditions: [
      player.poisoned ? 'Poisoned' : null,
      player.burned ? 'Burned' : null,
      player.asleep ? 'Asleep' : null,
      player.paralyzed ? 'Paralyzed' : null,
      player.confused ? 'Confused' : null,
    ].filter((condition): condition is string => !!condition),
  };
}

function cardToView(cardRef: CabtCardRef): CardView {
  const data = cardDatabase.get(cardRef.id);
  const rawName = cardRef.name || data?.name || `Card ${cardRef.id}`;
  const name = displayName(rawName);
  const kind = data?.kind ?? '';
  const isPokemon = kind.includes('Pokémon') || !!data?.hp;
  const isEnergy = kind.includes('Energy') || /Energy\b/.test(rawName);
  const isTrainer = !isPokemon && !isEnergy;
  const view: CardView = {
    id: cardRef.id,
    name,
    fullName: name,
    set: data?.set || undefined,
    setNumber: data?.setNumber || undefined,
    superType: isPokemon ? 'Pokemon' : isEnergy ? 'Energy' : 'Trainer',
    cardType: isPokemon ? energySymbolToType(data?.type) : undefined,
    trainerType: isTrainer ? kind : undefined,
    energyType: isEnergy ? energySymbolToType(data?.type || rawName) : undefined,
    stage: stageLabel(kind),
    evolvesFrom: data?.evolvesFrom || undefined,
    hp: data?.hp ?? undefined,
    retreat: Array.from({ length: retreatCostFor(data) }, () => 'Colorless'),
    attacks: attacksForCard(data),
  };
  return {
    ...view,
    imageUrl: resolveCardImageUrl(view),
  };
}

function faceDownCard(): CardView {
  return {
    name: 'Card',
    fullName: 'Card',
  };
}

function playerNames(input: unknown): string[] {
  const names = (input as KaggleContext)?.environment?.info?.TeamNames;
  return names?.length ? names : ['Player 1', 'Player 2'];
}

function stepLabel(frame: CabtVisualizeFrame, index: number): string {
  const prizeSummary = prizeMoveSummary(frame.logs ?? []);
  if (prizeSummary) {
    return prizeSummary;
  }

  const attackSummary = attackLogSummary(frame.logs ?? []);
  if (attackSummary) {
    return attackSummary;
  }

  const latestLog = frame.logs?.at(-1);
  if (latestLog) {
    return formatLog(latestLog);
  }
  const selectType = frame.select?.type;
  const context = frame.select?.context;
  if (selectType || context) {
    return [selectType, context].filter(Boolean).join(' · ');
  }
  return index === 0 ? 'Initial state' : `Frame ${index}`;
}

function formatLog(log: Record<string, unknown>): string {
  const playerIndex = typeof log.playerIndex === 'number' ? log.playerIndex : undefined;
  const actor = playerIndex === undefined ? 'Game' : `Player ${playerIndex + 1}`;
  const card = cardName(Number(log.cardId));
  switch (log.type) {
    case 'TurnStart':
      return `${actor} turn started.`;
    case 'TurnEnd':
      return `${actor} ended their turn.`;
    case 'Draw':
      return `${actor} drew ${card}.`;
    case 'Play':
      return `${actor} played ${card}.`;
    case 'Attach':
      return `${actor} attached ${card}.`;
    case 'Attack':
      return `${actor} used ${attackNameForLog(log)} with ${card}.`;
    case 'MoveCard':
      if (Number(log.fromArea) === CabtAreaType.PRIZE && Number(log.toArea) === CabtAreaType.HAND) {
        return `${actor} took ${card} as a Prize card.`;
      }
      if (Number(log.fromArea) === CabtAreaType.DECK && Number(log.toArea) === CabtAreaType.PRIZE) {
        return `${actor} set a Prize card.`;
      }
      if (Number(log.fromArea) === CabtAreaType.HAND && Number(log.toArea) === CabtAreaType.DECK) {
        return `${actor} moved a card from hand to deck.`;
      }
      return `${actor} moved ${card} from ${areaName(log.fromArea)} to ${areaName(log.toArea)}.`;
    case 'HpChange':
    case 'HPChange':
      return `${actor}'s ${card} HP changed.`;
    case 'Result':
      return 'The battle finished.';
    default:
      return `${actor}: ${String(log.type ?? 'Event')}${Number.isFinite(Number(log.cardId)) ? ` ${card}` : ''}.`;
  }
}

function prizeMoveSummary(logs: Array<Record<string, unknown>>): string {
  const prizeMoves = logs.filter((log) => log.type === 'MoveCard' && Number(log.fromArea) === 6 && Number(log.toArea) === 2);
  if (!prizeMoves.length) {
    return '';
  }

  const playerIndex = typeof prizeMoves[0].playerIndex === 'number' ? prizeMoves[0].playerIndex : undefined;
  const samePlayer = prizeMoves.every((log) => log.playerIndex === playerIndex);
  if (!samePlayer || playerIndex === undefined) {
    return `Players took ${prizeMoves.length} Prize cards.`;
  }

  const actor = `Player ${playerIndex + 1}`;
  return prizeMoves.length === 1 ? `${actor} took 1 Prize card.` : `${actor} took ${prizeMoves.length} Prize cards.`;
}

function attackLogSummary(logs: Array<Record<string, unknown>>): string {
  const attack = logs.find((log) => log.type === 'Attack');
  return attack ? formatLog(attack) : '';
}

function areaName(area: unknown): string {
  const areaMap: Record<number, string> = {
    1: 'deck',
    2: 'hand',
    3: 'discard',
    4: 'active',
    5: 'bench',
    6: 'prize',
    7: 'stadium',
    8: 'energy',
    9: 'tool',
    10: 'evolution stack',
    11: 'player',
    12: 'selection',
  };
  return areaMap[Number(area)] ?? 'zone';
}

function cardName(id: number): string {
  return displayName(cardDatabase.get(id)?.name ?? (Number.isFinite(id) ? `Card ${id}` : 'a card'));
}

function attackNameForLog(log: Record<string, unknown>): string {
  const attack = attackDatabase.get(Number(log.attackId));
  if (attack?.name) {
    return displayName(attack.name);
  }
  return Number.isFinite(Number(log.attackId)) ? `attack ${log.attackId}` : 'an attack';
}

function attacksForCard(data: CardRow | undefined): CardView['attacks'] {
  if (!data) {
    return undefined;
  }
  const engineAttacks = data.attacks
    ?.map((attackId) => attackDatabase.get(attackId))
    .filter((attack): attack is AttackRow => !!attack);
  if (engineAttacks?.length) {
    return engineAttacks.map((attack) => ({
      name: displayName(attack.name),
      cost: (attack.energies ?? []).map(energyName),
      damage: attack.damage ? String(attack.damage) : '',
      text: attack.text ?? '',
    }));
  }
  if (!data.attackName) {
    return undefined;
  }
  return [{
    name: data.attackName,
    cost: energyCostLabels(data.attackCost),
    damage: data.attackDamage,
    text: data.attackText,
  }];
}

function retreatCostFor(data: CardRow | undefined): number {
  return data?.retreat ?? data?.retreatCost ?? 0;
}

function displayName(name: string): string {
  return name
    .replaceAll('{G}', 'Grass')
    .replaceAll('{R}', 'Fire')
    .replaceAll('{W}', 'Water')
    .replaceAll('{L}', 'Lightning')
    .replaceAll('{P}', 'Psychic')
    .replaceAll('{F}', 'Fighting')
    .replaceAll('{D}', 'Darkness')
    .replaceAll('{M}', 'Metal')
    .replaceAll('{C}', 'Colorless');
}

function energySymbolToType(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  if (value.includes('{G}') || /grass/i.test(value)) return 1;
  if (value.includes('{R}') || /fire/i.test(value)) return 2;
  if (value.includes('{W}') || /water/i.test(value)) return 3;
  if (value.includes('{L}') || /lightning/i.test(value)) return 4;
  if (value.includes('{P}') || /psychic/i.test(value)) return 5;
  if (value.includes('{F}') || /fighting/i.test(value)) return 6;
  if (value.includes('{D}') || /dark/i.test(value)) return 7;
  if (value.includes('{M}') || /metal/i.test(value)) return 8;
  return 0;
}

function energyCostLabels(cost: string): string[] {
  return [...cost.matchAll(/\{([A-Z])\}/g)].map((match) => displayName(`{${match[1]}}`));
}

function energyName(energy: number): string {
  return [
    'Colorless',
    'Grass',
    'Fire',
    'Water',
    'Lightning',
    'Psychic',
    'Fighting',
    'Darkness',
    'Metal',
    'Dragon',
    'Rainbow',
    'Team Rocket',
  ][energy] ?? 'Colorless';
}

function stageLabel(kind: string): string | undefined {
  if (kind.includes('Basic Pokémon')) return 'Basic';
  if (kind.includes('Stage 1')) return 'Stage 1';
  if (kind.includes('Stage 2')) return 'Stage 2';
  return undefined;
}

function clampPlayerIndex(index: number): number {
  return index === 1 ? 1 : 0;
}
