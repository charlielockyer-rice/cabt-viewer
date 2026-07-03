import cardRows from './cardData.generated.json';
import attackRows from './attackData.generated.json';
import { actionAnimationTiming } from './actionAnimationSchedule';
import { displayName, energySymbolToType } from './cardView';
import { cabtLogsToTimeline } from './logFormat';
import { CabtAreaType, CabtOptionType, CabtSelectContext } from './types';
import { resolveCardImageUrl } from '../game/cardImages';
import { SlotType, targetFor, type ActionTimelineEvent, type CardView, type GameView, type LogView, type PlayerView, type PokemonSlotView } from '../game/types';
import type { ReplayAnimationPhase, ReplaySnapshot, ReplayStep } from '../game/replay';

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
  skills?: Array<{ name: string; text?: string }>;
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

type KaggleEnvironment = {
  id?: string;
  title?: string;
  rewards?: number[];
  statuses?: string[];
  steps?: Array<Array<{
    action?: unknown;
    observation?: Record<string, unknown>;
    status?: string;
    reward?: number;
    visualize?: unknown;
  }>>;
  info?: {
    TeamNames?: string[];
    EpisodeId?: string | number;
  };
};

type KaggleContext = {
  environment?: KaggleEnvironment;
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

  const environment = replayEnvironment(input);
  const players = playerNames(input);
  const views: GameView[] = [];
  const steps: ReplayStep[] = [];
  const logs: LogView[] = [];
  let logId = 1;
  let timelineId = 1;

  const frameEntries: ReplayFrameEntry[] = [];

  visualFrames.forEach((frame, index) => {
    const frameLogs = logsWithSynthesizedAbility(visualFrames[index - 1], frame);
    const timeline = cabtLogsToTimeline(frameLogs, { nextId: timelineId });
    timelineId = timeline.nextId;
    for (const entry of frameLogs) {
      logs.push({ id: logId++, message: formatLog(entry), params: entry });
    }
    const view = frameToGameView(frame, players, logs, timeline.events);
    views.push(view);
    const groups = replayActionGroups(timeline.events, frame.current.turn);
    frameEntries.push({ frame, view, groups });
  });

  for (let index = 0; index < frameEntries.length; index += 1) {
    const { frame, view, groups } = frameEntries[index];
    const continuation = cardEffectContinuation(frameEntries, index);
    if (continuation) {
      const currentView = frameEntries[continuation.endIndex].view;
      steps.push(replayStepForFrame({
        view: currentView,
        stateIndex: continuation.endIndex,
        label: continuation.group.label,
        type: continuation.group.type,
        actionTimeline: continuation.group.events,
        displayView: groupedStepDisplayView(views[index - 1], currentView, [continuation.group], 0),
        animationPhases: groupedStepAnimationPhases(views[index - 1], currentView, [continuation.group], 0),
        payload: {
          events: continuation.group.events,
          select: frameEntries[continuation.endIndex].frame.select,
          selected: frameEntries[continuation.endIndex].frame.selected,
          action: frameEntries[continuation.endIndex].frame.action,
        },
      }));
      index = continuation.endIndex;
      continue;
    }

    if (groups.length) {
      for (const [groupIndex, group] of groups.entries()) {
        steps.push(replayStepForFrame({
          view,
          stateIndex: index,
          label: group.label,
          type: group.type,
          actionTimeline: group.events,
          displayView: groupedStepDisplayView(views[index - 1], view, groups, groupIndex),
          animationPhases: groupedStepAnimationPhases(views[index - 1], view, groups, groupIndex),
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
  }

  applyResolvingPlayedCards(steps, views);
  applyKnockOutDiscardTopOrdering(steps);

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

type ReplayFrameEntry = {
  frame: CabtVisualizeFrame;
  view: GameView;
  groups: ReplayActionGroup[];
};

type CardEffectContinuation = {
  endIndex: number;
  group: ReplayActionGroup;
};

function logsWithSynthesizedAbility(
  previousFrame: CabtVisualizeFrame | undefined,
  frame: CabtVisualizeFrame,
): Array<Record<string, unknown>> {
  const logs = frame.logs ?? [];
  if (!previousFrame || logs.some((log) => normalizedFrameLogType(log.type) === 'Ability')) {
    return logs;
  }
  const abilityLog = abilityLogForSelectedOption(previousFrame, frame)
    ?? abilityLogForTriggeredEvolution(previousFrame, logs);
  return abilityLog ? [abilityLog, ...logs] : logs;
}

function abilityLogForSelectedOption(
  previousFrame: CabtVisualizeFrame,
  frame: CabtVisualizeFrame,
): Record<string, unknown> | null {
  const selected = selectedOptionFromAction(previousFrame.select, frame.action);
  const option = selected?.option;
  if (!option || normalizedOptionType(option.type) !== 'Ability') {
    return null;
  }
  const playerIndex = numberField(option.playerIndex) ?? selected.playerIndex;
  if (playerIndex === undefined) {
    return null;
  }
  const area = numberField(option.area);
  const index = numberField(option.index) ?? 0;
  const source = abilitySourceCard(previousFrame, playerIndex, area, index);
  const cardId = source?.id ?? numberField(option.cardId);
  if (cardId === undefined) {
    return null;
  }
  const data = cardDatabase.get(cardId);
  const abilityName = abilityNameForCard(data);
  return {
    type: 'Ability',
    playerIndex,
    cardId,
    serial: source?.serial ?? numberField(option.serial),
    abilityName,
    area,
    index,
  };
}

type TriggeredEvolutionAbility = {
  playerIndex: number;
  cardId: number;
  serial?: number;
  abilityName: string;
  drawCount: number;
  area?: number;
  index?: number;
};

function abilityLogForTriggeredEvolution(
  previousFrame: CabtVisualizeFrame,
  logs: Array<Record<string, unknown>>,
): Record<string, unknown> | null {
  const trigger = triggeredEvolutionAbility(previousFrame);
  if (!trigger || !logsAreMatchingTriggeredDraws(logs, trigger)) {
    return null;
  }
  return {
    type: 'Ability',
    playerIndex: trigger.playerIndex,
    cardId: trigger.cardId,
    serial: trigger.serial,
    abilityName: trigger.abilityName,
    area: trigger.area,
    index: trigger.index,
    trigger: 'Evolve',
  };
}

function triggeredEvolutionAbility(frame: CabtVisualizeFrame): TriggeredEvolutionAbility | null {
  const evolveLog = [...(frame.logs ?? [])].reverse().find((log) => normalizedFrameLogType(log.type) === 'Evolve');
  const playerIndex = typeof evolveLog?.playerIndex === 'number' ? evolveLog.playerIndex : undefined;
  const cardId = Number(evolveLog?.cardId);
  if (playerIndex === undefined || !Number.isFinite(cardId)) {
    return null;
  }
  const skill = evolutionTriggeredDrawSkill(cardDatabase.get(cardId));
  if (!skill) {
    return null;
  }
  const serial = numberField(evolveLog?.serial);
  const source = evolvedPokemonSource(frame, playerIndex, cardId, serial);
  return {
    playerIndex,
    cardId,
    serial,
    abilityName: displayName(skill.name.trim()),
    drawCount: skill.drawCount,
    area: source?.area,
    index: source?.index,
  };
}

function evolutionTriggeredDrawSkill(data: CardRow | undefined): { name: string; drawCount: number } | null {
  for (const skill of data?.skills ?? []) {
    const text = normalizedAbilityText(skill.text);
    if (!text.includes('when you play this pokemon from your hand to evolve')) {
      continue;
    }
    const drawCount = Number(text.match(/\bdraw\s+(\d+)\s+cards?\b/)?.[1]);
    if (Number.isFinite(drawCount) && drawCount > 0 && skill.name.trim()) {
      return { name: skill.name, drawCount };
    }
  }
  return null;
}

function normalizedAbilityText(text: string | undefined): string {
  return (text ?? '')
    .toLowerCase()
    .replaceAll('é', 'e')
    .replaceAll(/\s+/g, ' ')
    .trim();
}

function evolvedPokemonSource(
  frame: CabtVisualizeFrame,
  playerIndex: number,
  cardId: number,
  serial: number | undefined,
): { area: number; index: number } | undefined {
  const player = frame.current.players[playerIndex];
  if (!player) {
    return undefined;
  }
  const activeIndex = (player.active ?? []).findIndex((pokemon) => pokemonRefMatches(pokemon, cardId, serial));
  if (activeIndex >= 0) {
    return { area: CabtAreaType.ACTIVE, index: activeIndex };
  }
  const benchIndex = (player.bench ?? []).findIndex((pokemon) => pokemonRefMatches(pokemon, cardId, serial));
  if (benchIndex >= 0) {
    return { area: CabtAreaType.BENCH, index: benchIndex };
  }
  return undefined;
}

function pokemonRefMatches(pokemon: CabtPokemonRef | undefined, cardId: number, serial: number | undefined): boolean {
  if (!pokemon) {
    return false;
  }
  if (serial !== undefined) {
    return pokemon.serial === serial;
  }
  return pokemon.id === cardId;
}

function logsAreMatchingTriggeredDraws(logs: Array<Record<string, unknown>>, trigger: TriggeredEvolutionAbility): boolean {
  if (logs.length !== trigger.drawCount) {
    return false;
  }
  return logs.every((log) => {
    const type = normalizedFrameLogType(log.type);
    return (type === 'Draw' || type === 'DrawReverse')
      && log.playerIndex === trigger.playerIndex;
  });
}

function selectedOptionFromAction(
  select: Record<string, unknown> | null | undefined,
  action: unknown,
): { playerIndex: number; option: Record<string, unknown> } | null {
  const options = Array.isArray(select?.option) ? select.option : [];
  if (!options.length || !Array.isArray(action)) {
    return null;
  }
  for (const [playerIndex, playerAction] of action.entries()) {
    const selectedIndex = selectedOptionIndex(playerAction);
    const option = selectedIndex === undefined ? undefined : options[selectedIndex];
    if (option && typeof option === 'object') {
      return { playerIndex, option: option as Record<string, unknown> };
    }
  }
  return null;
}

function selectedOptionIndex(playerAction: unknown): number | undefined {
  if (Array.isArray(playerAction)) {
    return numberField(playerAction[0]);
  }
  return numberField(playerAction);
}

function abilitySourceCard(
  frame: CabtVisualizeFrame,
  playerIndex: number,
  area: number | undefined,
  index: number,
): CabtPokemonRef | undefined {
  const player = frame.current.players[playerIndex];
  if (!player) {
    return undefined;
  }
  if (area === CabtAreaType.ACTIVE) {
    return player.active?.[index] ?? player.active?.[0];
  }
  if (area === CabtAreaType.BENCH) {
    return player.bench?.[index];
  }
  return undefined;
}

function normalizedOptionType(type: unknown): string {
  if (type === CabtOptionType.ABILITY) {
    return 'Ability';
  }
  return String(type ?? '');
}

function normalizedFrameLogType(type: unknown): string {
  return String(type ?? 'Event');
}

function numberField(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function cardEffectContinuation(entries: ReplayFrameEntry[], startIndex: number): CardEffectContinuation | null {
  const firstGroup = entries[startIndex].groups[0];
  if (!firstGroup || entries[startIndex].groups.length !== 1) {
    return null;
  }
  const triggeredEvolutionContinuation = triggeredEvolutionAbilityContinuationFrom(entries, startIndex, firstGroup);
  if (triggeredEvolutionContinuation) {
    return triggeredEvolutionContinuation;
  }
  if (!isCardEffectStartGroup(firstGroup)) {
    return null;
  }
  const playEvent = resolvingTrainerPlayEvent(firstGroup);
  const playerIndex = playEvent?.playerIndex;
  if (!playEvent || playerIndex === undefined) {
    return null;
  }

  if (startGroupHasTerminalResolvingEffect(firstGroup)) {
    return null;
  }

  if (isCompleteDeckSearchEffect(firstGroup.events, playerIndex)) {
    return { endIndex: startIndex, group: firstGroup };
  }

  const deckSearchContinuation = deckSearchContinuationFrom(entries, startIndex, firstGroup, playerIndex);
  if (deckSearchContinuation) {
    return deckSearchContinuation;
  }

  const deckRevealContinuation = deckRevealContinuationFrom(entries, startIndex, firstGroup, playerIndex);
  if (deckRevealContinuation) {
    return deckRevealContinuation;
  }

  const resolvingContinuation = resolvingTrainerContinuationFrom(entries, startIndex, firstGroup, playEvent);
  if (resolvingContinuation) {
    return triggeredEvolutionAbilityContinuationFrom(entries, resolvingContinuation.endIndex, resolvingContinuation.group)
      ?? resolvingContinuation;
  }

  for (let index = startIndex + 1; index < entries.length; index += 1) {
    const groups = entries[index].groups;
    if (!groups.length) {
      continue;
    }
    if (groups.length === 1 && isCardEffectContinuationGroup(groups[0], playerIndex, firstGroup)) {
      return {
        endIndex: index,
        group: {
          ...firstGroup,
          events: [...firstGroup.events, ...groups[0].events],
        },
      };
    }
    return null;
  }
  return null;
}

function triggeredEvolutionAbilityContinuationFrom(
  entries: ReplayFrameEntry[],
  startIndex: number,
  startGroup: ReplayActionGroup,
): CardEffectContinuation | null {
  const evolveEvent = [...startGroup.events].reverse().find(isTriggeredAbilityEvolveEvent);
  if (!evolveEvent || evolveEvent.playerIndex === undefined) {
    return null;
  }
  for (let index = startIndex + 1; index < entries.length; index += 1) {
    const groups = entries[index].groups;
    if (!groups.length) {
      continue;
    }
    if (groups.length !== 1 || !isTriggeredEvolutionAbilityGroup(groups[0], evolveEvent)) {
      return null;
    }
    return {
      endIndex: index,
      group: {
        ...startGroup,
        events: [...startGroup.events, ...groups[0].events],
      },
    };
  }
  return null;
}

function isTriggeredAbilityEvolveEvent(event: ActionTimelineEvent): boolean {
  const params = event.params as Record<string, unknown> | undefined;
  const cardId = Number(params?.cardId);
  return event.kind === 'Evolve'
    && event.playerIndex !== undefined
    && Number.isFinite(cardId)
    && !!evolutionTriggeredDrawSkill(cardDatabase.get(cardId));
}

function isTriggeredEvolutionAbilityGroup(group: ReplayActionGroup, evolveEvent: ActionTimelineEvent): boolean {
  const ability = group.events[0];
  const abilityParams = ability?.params as Record<string, unknown> | undefined;
  const evolveParams = evolveEvent.params as Record<string, unknown> | undefined;
  const expectedSerial = Number(evolveParams?.serial);
  return ability?.kind === 'Ability'
    && ability.playerIndex === evolveEvent.playerIndex
    && abilityParams?.trigger === 'Evolve'
    && Number(abilityParams?.cardId) === Number(evolveParams?.cardId)
    && (!Number.isFinite(expectedSerial) || Number(abilityParams?.serial) === expectedSerial)
    && group.events.slice(1).length > 0
    && group.events.slice(1).every((event) =>
      (event.kind === 'Draw' || event.kind === 'DrawReverse')
      && event.playerIndex === evolveEvent.playerIndex);
}

function isCardEffectStartGroup(group: ReplayActionGroup): boolean {
  return !!resolvingTrainerPlayEvent(group);
}

function resolvingTrainerPlayEvent(group: ReplayActionGroup): ActionTimelineEvent | undefined {
  return group.events.find((event) => {
    const params = event.params as Record<string, unknown> | undefined;
    const cardId = Number(params?.cardId);
    return event.kind === 'Play'
      && event.playerIndex !== undefined
      && Number.isFinite(cardId)
      && isResolvingTrainerCard(cardId);
  });
}

function resolvingTrainerContinuationFrom(
  entries: ReplayFrameEntry[],
  startIndex: number,
  startGroup: ReplayActionGroup,
  playEvent: ActionTimelineEvent,
): CardEffectContinuation | null {
  // Archive hardening: add negative samples before widening this heuristic. A trainer
  // that is already discarded in its Play frame should not swallow the next unrelated action.
  const playerIndex = playEvent.playerIndex;
  if (playerIndex === undefined) {
    return null;
  }

  const continuationEvents: ActionTimelineEvent[] = [];
  for (let index = startIndex + 1; index < entries.length; index += 1) {
    const groups = entries[index].groups;
    if (!groups.length) {
      continue;
    }
    const cardIsDiscardedInView = viewHasEventCardInDiscard(entries[index].view, playEvent);
    if (groups.length !== 1 || !isResolvingTrainerContinuationGroup(groups[0])) {
      return null;
    }

    const nextEvents = [...continuationEvents, ...groups[0].events];
    if (
      groupHasDeckSearchStyleMove(groups[0])
      && !cardIsDiscardedInView
      && !isResolvingTrainerTerminalGroup(groups[0], nextEvents)
    ) {
      return null;
    }

    continuationEvents.push(...groups[0].events);
    if (cardIsDiscardedInView || isResolvingTrainerTerminalGroup(groups[0], continuationEvents)) {
      return {
        endIndex: index,
        group: {
          ...startGroup,
          events: [...startGroup.events, ...continuationEvents],
        },
      };
    }
  }
  return null;
}

function startGroupHasTerminalResolvingEffect(group: ReplayActionGroup): boolean {
  return group.events.some((event) => event.kind !== 'Play')
    && isResolvingTrainerTerminalGroup(group, group.events);
}

function isResolvingTrainerTerminalGroup(group: ReplayActionGroup, continuationEvents: ActionTimelineEvent[]): boolean {
  if (group.events.some((event) => ['Draw', 'DrawReverse', 'Switch', 'Evolve', 'Devolve', 'Attach'].includes(event.kind ?? ''))) {
    return true;
  }
  if (group.events.some((event) => ['HpChange', 'HPChange', 'Poisoned', 'Burned', 'Asleep', 'Paralyzed', 'Confused', 'Coin'].includes(event.kind ?? ''))) {
    return true;
  }
  if (group.events.some(isTerminalResolvingMoveEvent)) {
    return true;
  }
  if (group.events.some((event) => event.kind === 'Shuffle')) {
    return !continuationEvents.some((event) => isMoveBetween(event, CabtAreaType.HAND, CabtAreaType.DECK));
  }
  return false;
}

function isTerminalResolvingMoveEvent(event: ActionTimelineEvent): boolean {
  const params = event.params as Record<string, unknown> | undefined;
  const fromArea = Number(params?.fromArea);
  const toArea = Number(params?.toArea);
  return isMoveCardKind(event.kind)
    && (
      toArea === CabtAreaType.DISCARD
      || isBoardPositionMove(fromArea, toArea)
      || isAttachedCardArea(fromArea)
    );
}

function isResolvingTrainerContinuationGroup(group: ReplayActionGroup): boolean {
  return group.events.length > 0
    && group.events.every(isResolvingTrainerContinuationEvent);
}

function isResolvingTrainerContinuationEvent(event: ActionTimelineEvent): boolean {
  if (isMoveCardKind(event.kind)) {
    return true;
  }
  return [
    'Attach',
    'Evolve',
    'Devolve',
    'Switch',
    'Draw',
    'DrawReverse',
    'Shuffle',
    'HpChange',
    'HPChange',
    'Poisoned',
    'Burned',
    'Asleep',
    'Paralyzed',
    'Confused',
    'Coin',
  ].includes(event.kind ?? '');
}

function groupHasDeckSearchStyleMove(group: ReplayActionGroup): boolean {
  return group.events.some(isDeckSearchStyleMove);
}

function isDeckSearchStyleMove(event: ActionTimelineEvent): boolean {
  if (!isMoveCardKind(event.kind)) {
    return false;
  }
  const params = event.params as Record<string, unknown> | undefined;
  const fromArea = Number(params?.fromArea);
  const toArea = Number(params?.toArea);
  return (fromArea === CabtAreaType.DECK && (
    toArea === CabtAreaType.HAND
    || toArea === CabtAreaType.ACTIVE
    || toArea === CabtAreaType.BENCH
    || toArea === CabtAreaType.LOOKING
  ))
    || (fromArea === CabtAreaType.LOOKING && (
      toArea === CabtAreaType.HAND
      || toArea === CabtAreaType.DECK
    ));
}

function viewHasEventCardInDiscard(view: GameView, event: ActionTimelineEvent): boolean {
  const playerIndex = event.playerIndex;
  if (playerIndex === undefined) {
    return false;
  }
  return view.players[playerIndex]?.discard.some((card) => eventCardMatches(card, event)) ?? false;
}

function deckSearchContinuationFrom(
  entries: ReplayFrameEntry[],
  startIndex: number,
  startGroup: ReplayActionGroup,
  playerIndex: number,
): CardEffectContinuation | null {
  if (startGroup.events.some((event) => isMoveBetween(event, CabtAreaType.DECK, CabtAreaType.LOOKING))) {
    return null;
  }

  const continuationEvents: ActionTimelineEvent[] = [];
  let sawDeckSearchPrompt = isDeckSearchPrompt(entries[startIndex].frame);
  let sawDeckToHand = false;
  for (let index = startIndex + 1; index < entries.length; index += 1) {
    const groups = entries[index].groups;
    if (!groups.length) {
      sawDeckSearchPrompt ||= isDeckSearchPrompt(entries[index].frame);
      continue;
    }
    if (!sawDeckSearchPrompt) {
      return null;
    }
    if (groups.length !== 1 || !isDeckSearchContinuationGroup(groups[0], playerIndex)) {
      return null;
    }
    if (!deckSearchContinuationOrderIsValid(groups[0].events, sawDeckToHand)) {
      return null;
    }

    continuationEvents.push(...groups[0].events);
    sawDeckToHand ||= groups[0].events.some((event) => isMoveBetween(event, CabtAreaType.DECK, CabtAreaType.HAND));
    const events = [...startGroup.events, ...continuationEvents];
    if (isCompleteDeckSearchEffect(events, playerIndex)) {
      return {
        endIndex: index,
        group: {
          ...startGroup,
          events,
        },
      };
    }
  }
  return null;
}

function deckRevealContinuationFrom(
  entries: ReplayFrameEntry[],
  startIndex: number,
  startGroup: ReplayActionGroup,
  playerIndex: number,
): CardEffectContinuation | null {
  if (!startGroup.events.some((event) => isMoveBetween(event, CabtAreaType.DECK, CabtAreaType.LOOKING))) {
    return null;
  }

  const revealedSerials = new Set(
    startGroup.events
      .filter((event) => isMoveBetween(event, CabtAreaType.DECK, CabtAreaType.LOOKING))
      .map(eventSerial)
      .filter((serial): serial is number => Number.isFinite(serial)),
  );
  if (!revealedSerials.size) {
    return null;
  }

  const continuationEvents: ActionTimelineEvent[] = [];
  for (let index = startIndex + 1; index < entries.length; index += 1) {
    const groups = entries[index].groups;
    if (!groups.length) {
      continue;
    }
    if (!groups.every((group) => isDeckRevealContinuationGroup(group, playerIndex, revealedSerials))) {
      return null;
    }

    continuationEvents.push(...groups.flatMap((group) => group.events));
    const events = [...startGroup.events, ...continuationEvents];
    if (isCompleteDeckRevealEffect(events, revealedSerials)) {
      const orderedEvents = orderedDeckRevealResolutionEvents(startGroup.events, continuationEvents);
      return {
        endIndex: index,
        group: {
          ...startGroup,
          events: orderedEvents,
        },
      };
    }
  }
  return null;
}

function orderedDeckRevealResolutionEvents(
  revealEvents: ActionTimelineEvent[],
  continuationEvents: ActionTimelineEvent[],
): ActionTimelineEvent[] {
  const takeEvents = continuationEvents.filter((event) => isMoveBetween(event, CabtAreaType.LOOKING, CabtAreaType.HAND));
  if (!takeEvents.length || !continuationEvents.some((event) => isMoveBetween(event, CabtAreaType.LOOKING, CabtAreaType.DECK))) {
    return [...revealEvents, ...continuationEvents];
  }

  const shuffleEvents = continuationEvents.filter((event) => event.kind === 'Shuffle');
  const beforeTakeEvents = continuationEvents.filter((event) =>
    event.kind !== 'Shuffle' && !isMoveBetween(event, CabtAreaType.LOOKING, CabtAreaType.HAND));
  return [...revealEvents, ...beforeTakeEvents, ...takeEvents, ...shuffleEvents];
}

function isDeckRevealContinuationGroup(
  group: ReplayActionGroup,
  playerIndex: number,
  revealedSerials: ReadonlySet<number>,
): boolean {
  return group.events.length > 0
    && group.events.every((event) => {
      if (event.playerIndex !== undefined && event.playerIndex !== playerIndex) {
        return false;
      }
      if (event.kind === 'Shuffle') {
        return true;
      }
      if (event.kind === 'Attach') {
        const serial = eventSerial(event);
        return serial !== undefined && revealedSerials.has(serial);
      }
      return isMoveBetween(event, CabtAreaType.LOOKING, CabtAreaType.HAND)
        || isMoveBetween(event, CabtAreaType.LOOKING, CabtAreaType.DECK);
    });
}

function isCompleteDeckRevealEffect(events: ActionTimelineEvent[], revealedSerials: ReadonlySet<number>): boolean {
  const resolvedSerials = new Set<number>();
  let returnedToDeck = false;
  let shuffled = false;

  for (const event of events) {
    const serial = eventSerial(event);
    if (event.kind === 'Shuffle') {
      shuffled = true;
      continue;
    }
    if (serial === undefined || !revealedSerials.has(serial)) {
      continue;
    }
    if (event.kind === 'Attach'
      || isMoveBetween(event, CabtAreaType.LOOKING, CabtAreaType.HAND)
      || isMoveBetween(event, CabtAreaType.LOOKING, CabtAreaType.DECK)) {
      resolvedSerials.add(serial);
    }
    if (isMoveBetween(event, CabtAreaType.LOOKING, CabtAreaType.DECK)) {
      returnedToDeck = true;
    }
  }

  return resolvedSerials.size === revealedSerials.size && (!returnedToDeck || shuffled);
}

function eventSerial(event: ActionTimelineEvent): number | undefined {
  const params = event.params as Record<string, unknown> | undefined;
  const serial = Number(params?.serial);
  return Number.isFinite(serial) ? serial : undefined;
}

function deckSearchContinuationOrderIsValid(events: ActionTimelineEvent[], sawDeckToHand: boolean): boolean {
  let hasSeenDeckToHand = sawDeckToHand;
  for (const event of events) {
    if (isMoveBetween(event, CabtAreaType.DECK, CabtAreaType.HAND)) {
      hasSeenDeckToHand = true;
      continue;
    }
    if (event.kind === 'Shuffle' && !hasSeenDeckToHand) {
      return false;
    }
  }
  return true;
}

function isDeckSearchPrompt(frame: CabtVisualizeFrame): boolean {
  const context = frame.select?.context;
  if (context === CabtSelectContext.TO_HAND || context === CabtSelectContext.TO_HAND_ENERGY) {
    return true;
  }
  const normalizedContext = String(context ?? '').toLowerCase().replace(/[_\s-]+/g, '');
  return normalizedContext.includes('searchdeck') || normalizedContext.includes('tohand');
}

function isDeckSearchContinuationGroup(group: ReplayActionGroup, playerIndex: number): boolean {
  return group.events.every((event) =>
    (event.playerIndex === undefined || event.playerIndex === playerIndex)
    && (
      event.kind === 'Shuffle'
      || isMoveBetween(event, CabtAreaType.DECK, CabtAreaType.HAND)
    ));
}

function isCompleteDeckSearchEffect(events: ActionTimelineEvent[], playerIndex: number): boolean {
  return events.every((event) => event.playerIndex === undefined || event.playerIndex === playerIndex)
    && events.some((event) => event.kind === 'Play')
    && events.some((event) => isMoveBetween(event, CabtAreaType.DECK, CabtAreaType.HAND))
    && events.some((event) => event.kind === 'Shuffle');
}

function isCardEffectContinuationGroup(
  group: ReplayActionGroup,
  playerIndex: number,
  startGroup: ReplayActionGroup,
): boolean {
  if (startGroup.events.some((event) => isMoveBetween(event, CabtAreaType.DECK, CabtAreaType.LOOKING))) {
    return isDeckRevealResolutionGroup(group, playerIndex);
  }
  return false;
}

function isDeckRevealResolutionGroup(group: ReplayActionGroup, playerIndex: number): boolean {
  return group.events.every((event) => event.playerIndex === undefined || event.playerIndex === playerIndex)
    && group.events.some((event) => event.kind === 'Attach')
    && group.events.some((event) => isMoveBetween(event, CabtAreaType.LOOKING, CabtAreaType.DECK))
    && group.events.some((event) => event.kind === 'Shuffle');
}

function isMoveBetween(event: ActionTimelineEvent, fromArea: number, toArea: number): boolean {
  const params = event.params as Record<string, unknown> | undefined;
  return isMoveCardKind(event.kind)
    && Number(params?.fromArea) === fromArea
    && Number(params?.toArea) === toArea;
}

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
    return isMoveCardKind(current.type)
      && !sameMoveCardBatch(current.events.at(-1), event)
      && !sameBoardPositionMoveBatch(current.events.at(-1), event);
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
    'Ability',
    'Attack',
    'TurnEnd',
    'TurnStart',
    'Result',
  ].includes(kind);
}

function isChoiceConsequenceGroup(type: string): boolean {
  return ['Play', 'Attach', 'Evolve', 'Devolve', 'Ability', 'Attack'].includes(type);
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
  const fromArea = Number(nextParams?.fromArea);
  const toArea = Number(nextParams?.toArea);
  return previous?.playerIndex === next.playerIndex
    && Number(previousParams?.fromArea) === fromArea
    && Number(previousParams?.toArea) === toArea
    && isBatchedMoveDestination(fromArea, toArea);
}

function isBatchedMoveDestination(fromArea: number, toArea: number): boolean {
  if (toArea === CabtAreaType.ACTIVE || toArea === CabtAreaType.BENCH) {
    return fromArea === CabtAreaType.DECK;
  }
  return !isBoardPositionMove(fromArea, toArea);
}

function sameBoardPositionMoveBatch(previous: ActionTimelineEvent | undefined, next: ActionTimelineEvent): boolean {
  return previous?.playerIndex === next.playerIndex
    && isBoardPositionMoveEvent(previous)
    && isBoardPositionMoveEvent(next);
}

function isBoardPositionMoveEvent(event: ActionTimelineEvent | undefined): boolean {
  const params = event?.params as Record<string, unknown> | undefined;
  return isMoveCardKind(event?.kind) && isBoardPositionMove(Number(params?.fromArea), Number(params?.toArea));
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
  animationPhases,
}: {
  view: GameView;
  stateIndex: number;
  label: string;
  type: string;
  payload: unknown;
  actionTimeline?: ReplayStep['actionTimeline'];
  displayView?: ReplayStep['displayView'];
  animationPhases?: ReplayStep['animationPhases'];
}): ReplayStep {
  const stepLabel = persistentActionLabel(label, actionTimeline);
  return {
    index: 0,
    label: stepLabel,
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
    animationPhases,
  };
}

function persistentActionLabel(label: string, events: ReplayStep['actionTimeline']): string {
  if (!events || events.length < 2) {
    return label;
  }
  const playEvent = events.find((event) => event.kind === 'Play');
  if (!playEvent) {
    return label;
  }
  const phases = animationEventPhases(events);
  const hasEffectPhase = phases.some((phase) =>
    phase.key.startsWith('HandToDeck:')
    || phase.key.startsWith('DeckDiscard:')
    || phase.key.startsWith('DeckReveal:')
    || phase.key.startsWith('DeckSearchReveal:')
    || phase.key.startsWith('DeckBoardPlace:')
    || phase.key.startsWith('DeckRevealReturn:')
    || phase.key.startsWith('DeckRevealTake:')
    || phase.key.startsWith('Draw:')
  );
  if (!hasEffectPhase) {
    return label;
  }

  const playerIndex = playEvent.playerIndex;
  const actor = playerLabel(playerIndex);
  const playedCard = eventCardName(playEvent);
  const clauses = [`played ${playedCard}`];
  let handToDeckWasSummarized = false;

  for (const phase of phases) {
    if (phase.key.startsWith('Play:')) {
      continue;
    }
    const count = phase.events.filter((event) => animationPhaseKey(event) === phase.key).length;
    if (phase.key.startsWith('HandToDeck:')) {
      clauses.push(`shuffled ${count} ${plural(count, 'card')} from hand into their deck`);
      handToDeckWasSummarized = true;
      continue;
    }
    if (phase.key.startsWith('Draw:')) {
      clauses.push(`drew ${count} ${plural(count, 'card')}`);
      continue;
    }
    if (phase.key.startsWith('DeckSearchReveal:')) {
      clauses.push(count === 1
        ? 'revealed a card from their deck and put it into their hand'
        : `revealed ${count} cards from their deck and put them into their hand`);
      continue;
    }
    if (phase.key.startsWith('DeckBoardPlace:')) {
      clauses.push(count === 1
        ? 'put a Pokemon from their deck onto the board'
        : `put ${count} Pokemon from their deck onto the board`);
      continue;
    }
    if (phase.key.startsWith('DeckRevealReturn:')) {
      clauses.push(`returned ${count} revealed ${plural(count, 'card')} to their deck`);
      continue;
    }
    if (phase.key.startsWith('DeckRevealTake:')) {
      clauses.push(count === 1
        ? 'put a revealed card into their hand'
        : `put ${count} revealed cards into their hand`);
      continue;
    }
    if (phase.key.startsWith('DeckReveal:')) {
      clauses.push(`revealed the top ${count} ${plural(count, 'card')} of their deck`);
      continue;
    }
    if (phase.key.startsWith('DeckDiscard:')) {
      clauses.push(`discarded ${count} ${plural(count, 'card')} from their deck`);
      continue;
    }
    if (phase.key.startsWith('Attach:')) {
      clauses.push(...phase.events
        .filter((event) => animationPhaseKey(event) === phase.key)
        .map((event) => eventMessageWithoutActor(event, actor)));
      continue;
    }
    if (phase.key.startsWith('Shuffle:') && !handToDeckWasSummarized) {
      clauses.push('shuffled their deck');
    }
  }

  return `${actor} ${joinClauses(clauses)}.`;
}

function eventCardName(event: ActionTimelineEvent): string {
  const params = event.params as Record<string, unknown> | undefined;
  return cardName(Number(params?.cardId));
}

function eventMessageWithoutActor(event: ActionTimelineEvent, actor: string): string {
  const text = event.message.replace(/\.$/, '');
  const withoutActor = text.startsWith(`${actor} `) ? text.slice(actor.length + 1) : text;
  return withoutActor.charAt(0).toLowerCase() + withoutActor.slice(1);
}

function joinClauses(clauses: string[]): string {
  if (clauses.length <= 1) {
    return clauses[0] ?? '';
  }
  if (clauses.length === 2) {
    return `${clauses[0]} and ${clauses[1]}`;
  }
  return `${clauses.slice(0, -1).join(', ')}, and ${clauses.at(-1)}`;
}

function groupedStepDisplayView(
  previousView: GameView | undefined,
  currentView: GameView,
  groups: ReplayActionGroup[],
  groupIndex: number,
): GameView | undefined {
  const group = groups[groupIndex];
  if (!previousView || !group) {
    return undefined;
  }
  const needsProjection = groups.length >= 2 || shouldProjectSingleGroup(currentView, group);
  if (!needsProjection) {
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

function groupedStepAnimationPhases(
  previousView: GameView | undefined,
  currentView: GameView,
  groups: ReplayActionGroup[],
  groupIndex: number,
): ReplayAnimationPhase[] | undefined {
  const group = groups[groupIndex];
  if (!previousView || !group) {
    return undefined;
  }
  const eventPhases = animationEventPhases(group.events);
  if (eventPhases.length <= 1 && !eventPhases.some(animationPhaseNeedsDedicatedView)) {
    return undefined;
  }

  let phaseStartView = projectedViewForEvents(previousView, currentView, groups.slice(0, groupIndex).flatMap((item) => item.events));
  const phases: ReplayAnimationPhase[] = [];
  for (const phase of eventPhases) {
    let phaseView = phase.usesSourceView
      ? animationSourceViewForPhase(phaseStartView, currentView, phase)
      : projectedViewForEvents(phaseStartView, currentView, phase.events);
    if (phase.key.startsWith('DeckBoardPlace:')) {
      phaseView = gameViewWithAnimationHiddenBoardCards(phaseView, phase.events);
    }
    if (phase.key.startsWith('DeckRevealTake:')) {
      phaseView = gameViewWithAnimationHiddenHandCards(phaseView, phase.events);
    }
    phases.push({
      key: phase.key,
      label: animationPhaseLabel(phase),
      view: {
        ...phaseView,
        actionTimeline: phase.events,
      },
      actionTimeline: phase.events,
      durationMs: phase.durationMs,
    });
    phaseStartView = projectedViewForEvents(phaseStartView, currentView, phase.events);
  }
  return phases;
}

type AnimationEventPhase = {
  key: string;
  events: ActionTimelineEvent[];
  durationMs: number;
  usesSourceView: boolean;
};

function animationEventPhases(events: ActionTimelineEvent[]): AnimationEventPhase[] {
  const phases: AnimationEventPhase[] = [];
  for (const event of events) {
    const key = animationPhaseKeyForReplayEvent(event, phases);
    if (!key) {
      const last = phases.at(-1);
      if (last) {
        last.events.push(event);
      }
      continue;
    }
    const last = phases.at(-1);
    if (last && last.key === key) {
      last.events.push(event);
      last.durationMs = animationPhaseDurationMs(key, last.events.length);
      continue;
    }
    phases.push({
      key,
      events: [event],
      durationMs: animationPhaseDurationMs(key, 1),
      usesSourceView: animationPhaseUsesSourceView(key),
    });
  }
  return phases.filter((phase) => phase.events.some((event) => animationPhaseKey(event)));
}

function animationPhaseKeyForReplayEvent(event: ActionTimelineEvent, phases: AnimationEventPhase[]): string | null {
  const key = animationPhaseKey(event);
  if (!key) {
    return null;
  }
  if (key.startsWith('Damage:') && !phases.some((phase) => phase.key.startsWith('Attack:'))) {
    return null;
  }
  if (key.startsWith('KnockOut:') && !phases.some((phase) => phase.key.startsWith('Attack:'))) {
    return null;
  }
  if (key.startsWith('AttachedMove:') && phases.some((phase) => phase.key.startsWith('KnockOut:'))) {
    return null;
  }
  return key;
}

function animationPhaseLabel(phase: AnimationEventPhase): string | undefined {
  const event = phase.events.find((candidate) => animationPhaseKey(candidate));
  if (!event) {
    return undefined;
  }
  const actor = playerLabel(event.playerIndex);
  const cardEventCount = phase.events.filter((candidate) => animationPhaseKey(candidate) === phase.key).length;

  if (
    phase.key.startsWith('Play:')
    || phase.key.startsWith('Attach:')
    || phase.key.startsWith('Evolve:')
    || phase.key.startsWith('Shuffle:')
    || phase.key.startsWith('Attack:')
    || phase.key.startsWith('Damage:')
    || phase.key.startsWith('KnockOut:')
  ) {
    return event.message;
  }
  if (phase.key.startsWith('HandToDeck:')) {
    return `${actor} put ${cardEventCount} ${plural(cardEventCount, 'card')} from hand into their deck.`;
  }
  if (phase.key.startsWith('Draw:')) {
    return cardEventCount === 1 ? event.message : `${actor} drew ${cardEventCount} cards.`;
  }
  if (phase.key.startsWith('DeckDiscard:')) {
    return cardEventCount === 1 ? event.message : `${actor} discarded ${cardEventCount} cards from the deck.`;
  }
  if (phase.key.startsWith('DeckRevealReturn:')) {
    return `${actor} returned ${cardEventCount} revealed ${plural(cardEventCount, 'card')} to their deck.`;
  }
  if (phase.key.startsWith('DeckRevealTake:')) {
    return cardEventCount === 1
      ? event.message
      : `${actor} put ${cardEventCount} revealed cards into their hand.`;
  }
  if (phase.key.startsWith('DeckSearchReveal:')) {
    return cardEventCount === 1
      ? `${actor} revealed a card from their deck and put it into their hand.`
      : `${actor} revealed ${cardEventCount} cards from their deck and put them into their hand.`;
  }
  if (phase.key.startsWith('DeckBoardPlace:')) {
    return cardEventCount === 1
      ? event.message
      : `${actor} put ${cardEventCount} Pokemon from their deck onto the board.`;
  }
  if (phase.key.startsWith('DeckReveal:')) {
    return `${actor} revealed the top ${cardEventCount} ${plural(cardEventCount, 'card')} of their deck.`;
  }
  return event.message;
}

function playerLabel(playerIndex: number | undefined): string {
  return playerIndex === undefined ? 'Game' : `Player ${playerIndex + 1}`;
}

function plural(count: number, singular: string): string {
  return count === 1 ? singular : `${singular}s`;
}

function animationPhaseKey(event: ActionTimelineEvent): string | null {
  const params = event.params as Record<string, unknown> | undefined;
  const fromArea = Number(params?.fromArea);
  const toArea = Number(params?.toArea);
  const playerKey = event.playerIndex ?? 'unknown';

  if (event.kind === 'Play' || event.kind === 'Attach' || event.kind === 'Evolve') {
    return `${event.kind}:${playerKey}`;
  }
  if (event.kind === 'Attack') {
    return `Attack:${playerKey}`;
  }
  if (event.kind === 'Ability') {
    return `Ability:${playerKey}`;
  }
  if (event.kind === 'Switch') {
    return `BoardMove:${playerKey}`;
  }
  if (event.kind === 'HpChange' || event.kind === 'HPChange') {
    return `Damage:${playerKey}`;
  }
  if (event.kind === 'MoveCard') {
    if (isBoardPositionMove(fromArea, toArea)) {
      return `BoardMove:${playerKey}`;
    }
    if (isBoardToDeckMove(fromArea, toArea)) {
      return `BoardToDeck:${playerKey}`;
    }
    if (isKnockOutMove(fromArea, toArea)) {
      return `KnockOut:${playerKey}`;
    }
    if (fromArea === CabtAreaType.HAND && toArea === CabtAreaType.DECK) {
      return `HandToDeck:${playerKey}`;
    }
    if (fromArea === CabtAreaType.HAND) {
      return `HandMove:${playerKey}:${toArea}`;
    }
    if (fromArea === CabtAreaType.DECK && toArea === CabtAreaType.DISCARD) {
      return `DeckDiscard:${playerKey}`;
    }
    if (fromArea === CabtAreaType.DECK && toArea === CabtAreaType.LOOKING) {
      return `DeckReveal:${playerKey}`;
    }
    if (fromArea === CabtAreaType.DECK && toArea === CabtAreaType.HAND) {
      return `DeckSearchReveal:${playerKey}`;
    }
    if (fromArea === CabtAreaType.DECK && (toArea === CabtAreaType.ACTIVE || toArea === CabtAreaType.BENCH)) {
      return `DeckBoardPlace:${playerKey}`;
    }
    if (fromArea === CabtAreaType.LOOKING && toArea === CabtAreaType.DECK) {
      return `DeckRevealReturn:${playerKey}`;
    }
    if (fromArea === CabtAreaType.LOOKING && toArea === CabtAreaType.HAND) {
      return `DeckRevealTake:${playerKey}`;
    }
    if (isAttachedCardArea(fromArea) && isAttachedCardMoveDestination(toArea)) {
      return `AttachedMove:${playerKey}:${fromArea}->${toArea}`;
    }
    if (fromArea === CabtAreaType.STADIUM && toArea === CabtAreaType.DISCARD) {
      return `StadiumMove:${playerKey}:${fromArea}->${toArea}`;
    }
  }
  if (event.kind === 'Shuffle') {
    return `Shuffle:${playerKey}`;
  }
  if (event.kind === 'Draw' || event.kind === 'DrawReverse') {
    return `Draw:${playerKey}`;
  }
  return null;
}

function animationPhaseUsesSourceView(key: string): boolean {
  return key.startsWith('HandToDeck:')
    || key.startsWith('Evolve:')
    || key.startsWith('Ability:')
    || key.startsWith('Attack:')
    || key.startsWith('Damage:')
    || key.startsWith('KnockOut:')
    || key.startsWith('BoardToDeck:')
    || key.startsWith('BoardMove:')
    || key.startsWith('AttachedMove:')
    || key.startsWith('StadiumMove:');
}

function animationPhaseNeedsDedicatedView(phase: AnimationEventPhase): boolean {
  return phase.key.startsWith('Evolve:')
    || phase.key.startsWith('Ability:')
    || phase.key.startsWith('Attack:')
    || phase.key.startsWith('Damage:')
    || phase.key.startsWith('KnockOut:')
    || phase.key.startsWith('BoardToDeck:')
    || phase.key.startsWith('BoardMove:')
    || phase.key.startsWith('AttachedMove:')
    || phase.key.startsWith('StadiumMove:');
}

function animationSourceViewForPhase(
  phaseStartView: GameView,
  currentView: GameView,
  phase: AnimationEventPhase,
): GameView {
  if (phase.key.startsWith('Evolve:')) {
    return projectedViewForEvents(phaseStartView, currentView, phase.events, { deferBoardStateEvents: true });
  }
  if (phase.key.startsWith('Ability:') || phase.key.startsWith('Attack:') || phase.key.startsWith('Damage:')) {
    return projectedViewForEvents(phaseStartView, currentView, phase.events, { deferBoardStateEvents: true });
  }
  if (phase.key.startsWith('KnockOut:')) {
    return projectedViewForEvents(phaseStartView, currentView, phase.events, { deferMoveCardEvents: true });
  }
  if (phase.key.startsWith('BoardToDeck:')) {
    return projectedViewForEvents(phaseStartView, currentView, phase.events, { deferMoveCardEvents: true });
  }
  if (phase.key.startsWith('BoardMove:')) {
    return boardMoveSourceView(
      projectedViewForEvents(phaseStartView, currentView, phase.events, {
        deferBoardStateEvents: true,
        deferMoveCardEvents: true,
      }),
      phaseStartView,
      currentView,
    );
  }
  if (phase.key.startsWith('AttachedMove:')) {
    return projectedViewForEvents(phaseStartView, currentView, phase.events, { deferMoveCardEvents: true });
  }
  if (phase.key.startsWith('StadiumMove:')) {
    return projectedViewForEvents(phaseStartView, currentView, phase.events, { deferMoveCardEvents: true });
  }
  return phaseStartView;
}

function boardMoveSourceView(sourceView: GameView, phaseStartView: GameView, currentView: GameView): GameView {
  return {
    ...sourceView,
    players: sourceView.players.map((player, playerIndex) => {
      const phaseStartPlayer = phaseStartView.players[playerIndex];
      const currentPlayer = currentView.players[playerIndex];
      if (!phaseStartPlayer || !currentPlayer) {
        return player;
      }
      return {
        ...player,
        discard: mergedKnownCards(phaseStartPlayer.discard, currentPlayer.discard),
        playZone: mergedKnownCards(phaseStartPlayer.playZone, currentPlayer.playZone),
      };
    }),
  };
}

function mergedKnownCards(left: CardView[], right: CardView[]): CardView[] {
  return [
    ...left,
    ...right.filter((card) => !left.some((existing) => sameKnownCard(existing, card))),
  ];
}

function animationPhaseDurationMs(key: string, count: number): number {
  const durationMs = animationPhaseCardDurationMs(key);
  const stepMs = animationPhaseStepMs(key);
  return count <= 0 ? 0 : durationMs + Math.max(0, count - 1) * stepMs;
}

function animationPhaseCardDurationMs(key: string): number {
  if (key.startsWith('Shuffle:')) {
    return actionAnimationTiming.deckShuffleMs;
  }
  if (key.startsWith('Draw:')) {
    return actionAnimationTiming.deckDrawMs;
  }
  if (key.startsWith('DeckDiscard:')) {
    return actionAnimationTiming.deckDiscardMs;
  }
  if (key.startsWith('DeckReveal:')) {
    return actionAnimationTiming.deckRevealMs;
  }
  if (key.startsWith('DeckSearchReveal:')) {
    return actionAnimationTiming.deckRevealMs;
  }
  if (key.startsWith('DeckBoardPlace:')) {
    return actionAnimationTiming.boardMoveMs;
  }
  if (key.startsWith('DeckRevealReturn:')) {
    return actionAnimationTiming.deckRevealReturnMs;
  }
  if (key.startsWith('DeckRevealTake:')) {
    return actionAnimationTiming.handMoveMs;
  }
  if (key.startsWith('AttachedMove:')) {
    return actionAnimationTiming.handMoveMs;
  }
  if (key.startsWith('StadiumMove:')) {
    return actionAnimationTiming.stadiumMoveMs;
  }
  if (key.startsWith('Evolve:')) {
    return actionAnimationTiming.evolveMs;
  }
  if (key.startsWith('Attack:')) {
    return actionAnimationTiming.attackAnnounceMs;
  }
  if (key.startsWith('Ability:')) {
    return actionAnimationTiming.abilityAnnounceMs;
  }
  if (key.startsWith('Damage:')) {
    return actionAnimationTiming.damageMs;
  }
  if (key.startsWith('KnockOut:')) {
    return actionAnimationTiming.knockOutMs;
  }
  if (key.startsWith('BoardToDeck:')) {
    return actionAnimationTiming.boardMoveMs;
  }
  if (key.startsWith('BoardMove:')) {
    return actionAnimationTiming.boardMoveMs;
  }
  return actionAnimationTiming.handMoveMs;
}

function animationPhaseStepMs(key: string): number {
  if (key.startsWith('Draw:')) {
    return actionAnimationTiming.deckDrawStepMs;
  }
  if (key.startsWith('DeckDiscard:')) {
    return actionAnimationTiming.deckDiscardStepMs;
  }
  if (key.startsWith('DeckReveal:')) {
    return actionAnimationTiming.deckRevealStepMs;
  }
  if (key.startsWith('DeckSearchReveal:')) {
    return actionAnimationTiming.deckRevealStepMs;
  }
  if (key.startsWith('DeckBoardPlace:')) {
    return actionAnimationTiming.handMoveStepMs;
  }
  if (key.startsWith('DeckRevealReturn:')) {
    return actionAnimationTiming.deckRevealReturnStepMs;
  }
  if (key.startsWith('DeckRevealTake:')) {
    return actionAnimationTiming.handMoveStepMs;
  }
  if (key.startsWith('AttachedMove:')) {
    return actionAnimationTiming.handMoveStepMs;
  }
  if (key.startsWith('StadiumMove:')) {
    return actionAnimationTiming.handMoveStepMs;
  }
  if (key.startsWith('Shuffle:')) {
    return actionAnimationTiming.deckShuffleMs;
  }
  if (key.startsWith('Attack:')) {
    return actionAnimationTiming.attackAnnounceMs;
  }
  if (key.startsWith('Ability:')) {
    return actionAnimationTiming.abilityAnnounceMs;
  }
  if (key.startsWith('Damage:')) {
    return actionAnimationTiming.damageMs;
  }
  if (key.startsWith('KnockOut:')) {
    return actionAnimationTiming.knockOutMs;
  }
  if (key.startsWith('BoardToDeck:')) {
    return actionAnimationTiming.handMoveStepMs;
  }
  if (key.startsWith('BoardMove:')) {
    return 0;
  }
  return actionAnimationTiming.handMoveStepMs;
}

function projectedViewForEvents(
  baseView: GameView,
  currentView: GameView,
  events: ActionTimelineEvent[],
  options: { deferBoardStateEvents?: boolean; deferMoveCardEvents?: boolean } = {},
): GameView {
  const view: GameView = {
    ...currentView,
    players: currentView.players.map((currentPlayer, playerIndex) => {
      const basePlayer = baseView.players[playerIndex] ?? currentPlayer;
      return {
        ...currentPlayer,
        hand: [...basePlayer.hand],
        deckCount: basePlayer.deckCount,
        prizesLeft: basePlayer.prizesLeft,
        active: basePlayer.active,
        bench: basePlayer.bench,
        discard: basePlayer.discard,
        stadium: basePlayer.stadium,
        playZone: basePlayer.playZone,
      };
    }),
  };

  for (const event of events) {
    applyReplayEvent(view, currentView, event, options);
  }
  return view;
}

function gameViewWithAnimationHiddenBoardCards(view: GameView, events: ActionTimelineEvent[]): GameView {
  const moveEvents = events.filter((event) => {
    const params = event.params as Record<string, unknown> | undefined;
    const toArea = Number(params?.toArea);
    return isMoveCardKind(event.kind)
      && (toArea === CabtAreaType.ACTIVE || toArea === CabtAreaType.BENCH);
  });
  if (!moveEvents.length) {
    return view;
  }

  return {
    ...view,
    players: view.players.map((player, playerIndex) => {
      const playerEvents = moveEvents.filter((event) => event.playerIndex === playerIndex);
      if (!playerEvents.length) {
        return player;
      }
      return {
        ...player,
        active: pokemonSlotWithHiddenAnimationCard(player.active, playerEvents),
        bench: player.bench.map((slot) => pokemonSlotWithHiddenAnimationCard(slot, playerEvents)),
      };
    }),
  };
}

function gameViewWithAnimationHiddenHandCards(view: GameView, events: ActionTimelineEvent[]): GameView {
  const moveEvents = events.filter((event) => {
    const params = event.params as Record<string, unknown> | undefined;
    return isMoveCardKind(event.kind)
      && Number(params?.fromArea) === CabtAreaType.LOOKING
      && Number(params?.toArea) === CabtAreaType.HAND;
  });
  if (!moveEvents.length) {
    return view;
  }

  return {
    ...view,
    players: view.players.map((player, playerIndex) => {
      const playerEvents = moveEvents.filter((event) => event.playerIndex === playerIndex);
      if (!playerEvents.length) {
        return player;
      }
      return {
        ...player,
        hand: player.hand.map((card) => eventMatchesAnyCard(card, playerEvents)
          ? { ...card, animationHidden: true }
          : card),
      };
    }),
  };
}

function pokemonSlotWithHiddenAnimationCard(slot: PokemonSlotView, events: ActionTimelineEvent[]): PokemonSlotView {
  if (!slot.pokemon || !events.some((event) => eventCardMatches(slot.pokemon!, event))) {
    return slot;
  }
  return {
    ...slot,
    pokemon: {
      ...slot.pokemon,
      animationHidden: true,
    },
  };
}

function eventMatchesAnyCard(card: CardView, events: ActionTimelineEvent[]): boolean {
  return events.some((event) => eventCardMatches(card, event));
}

type ResolvingPlayedCard = {
  playerIndex: number;
  card: CardView;
};

function applyResolvingPlayedCards(steps: ReplayStep[], views: GameView[]): void {
  let resolving: ResolvingPlayedCard[] = [];

  for (const step of steps) {
    const baseView = views[step.stateIndex];
    if (!baseView) {
      continue;
    }

    for (const event of step.actionTimeline ?? []) {
      const resolvingCard = resolvingPlayedCardForEvent(baseView, event);
      if (resolvingCard && !resolving.some((entry) => entry.playerIndex === resolvingCard.playerIndex && sameKnownCard(entry.card, resolvingCard.card))) {
        resolving = [...resolving, resolvingCard];
      }
    }

    const displayResolved = resolving.filter((entry) => shouldResolveCardInDisplay(step, entry));
    const displayResolving = resolving.filter((entry) =>
      !displayResolved.some((resolvedEntry) => sameResolvingCard(resolvedEntry, entry))
      && shouldShowResolvingCardInDisplay(step, baseView, entry));
    const phaseResolving = resolving.filter((entry) => shouldShowResolvingCardInPhase(step, baseView, entry));
    if (displayResolved.length) {
      const view = step.displayView ?? baseView;
      step.displayView = gameViewWithResolvedDiscards(view, displayResolved);
    }
    if (displayResolving.length) {
      const view = step.displayView ?? baseView;
      step.displayView = gameViewWithResolvingCards(view, displayResolving);
    }
    if (phaseResolving.length && step.animationPhases?.length) {
      step.animationPhases = step.animationPhases.map((phase) => ({
        ...phase,
        view: gameViewWithResolvingCards(phase.view, phaseResolving),
      }));
    }

    const visibleResolving = [...displayResolving, ...phaseResolving];
    resolving = resolving.flatMap((entry) => {
      if (!visibleResolving.some((visibleEntry) => sameResolvingCard(visibleEntry, entry))) {
        return [];
      }
      if (playerHasDiscardCard(baseView.players[entry.playerIndex], entry.card)) {
        return [];
      }
      if (displayResolved.some((resolvedEntry) => sameResolvingCard(resolvedEntry, entry))) {
        return [];
      }
      if (stepContainsPlayForCard(step, entry.card)) {
        return [entry];
      }
      return [entry];
    });
  }
}

function applyKnockOutDiscardTopOrdering(steps: ReplayStep[]): void {
  for (const step of steps) {
    const knockOutEvents = (step.actionTimeline ?? []).filter(isKnockOutEvent);
    if (!knockOutEvents.length) {
      continue;
    }

    if (step.displayView) {
      step.displayView = gameViewWithPromotedDiscardCards(step.displayView, knockOutEvents);
    }
    if (step.animationPhases?.length) {
      step.animationPhases = step.animationPhases.map((phase) => {
        if (!phase.key.startsWith('KnockOut:')) {
          return phase;
        }
        return {
          ...phase,
          view: gameViewWithPromotedDiscardCards(phase.view, phase.actionTimeline.filter(isKnockOutEvent)),
        };
      });
    }
  }
}

function gameViewWithPromotedDiscardCards(view: GameView, events: ActionTimelineEvent[]): GameView {
  return {
    ...view,
    players: view.players.map((player, playerIndex) => {
      const playerEvents = events.filter((event) => event.playerIndex === playerIndex);
      if (!playerEvents.length) {
        return player;
      }
      return playerEvents.reduce(promoteDiscardCardToTop, player);
    }),
  };
}

function promoteDiscardCardToTop(player: PlayerView, event: ActionTimelineEvent): PlayerView {
  const cardIndex = player.discard.findIndex((card) => eventCardMatches(card, event));
  if (cardIndex < 0 || cardIndex === player.discard.length - 1) {
    return player;
  }
  const discard = [...player.discard];
  const [card] = discard.splice(cardIndex, 1);
  return {
    ...player,
    discard: [...discard, card],
  };
}

function resolvingPlayedCardForEvent(view: GameView, event: ActionTimelineEvent): ResolvingPlayedCard | undefined {
  if (event.kind !== 'Play' || event.playerIndex === undefined) {
    return undefined;
  }
  const player = view.players[event.playerIndex];
  const card = cardViewFromEvent(event);
  if (!player || !card || card.id === undefined || playerHasCardInPlay(player, event) || !isResolvingTrainerCard(card.id)) {
    return undefined;
  }
  return { playerIndex: event.playerIndex, card };
}

function isResolvingTrainerCard(cardId: number): boolean {
  const kind = cardDatabase.get(cardId)?.kind ?? '';
  return kind === 'Item' || kind === 'Supporter';
}

function gameViewWithResolvingCards(view: GameView, resolving: ResolvingPlayedCard[]): GameView {
  const cardsByPlayer = new Map<number, CardView[]>();
  for (const entry of resolving) {
    const cards = cardsByPlayer.get(entry.playerIndex) ?? [];
    cardsByPlayer.set(entry.playerIndex, [...cards, entry.card]);
  }

  return {
    ...view,
    players: view.players.map((player, playerIndex) => {
      const pendingCards = cardsByPlayer.get(playerIndex) ?? [];
      if (!pendingCards.length) {
        return player;
      }
      return {
        ...player,
        discard: player.discard.filter((discardCard) => !pendingCards.some((card) => sameKnownCard(discardCard, card))),
        playZone: [
          ...player.playZone.filter((playZoneCard) => !pendingCards.some((card) => sameKnownCard(playZoneCard, card))),
          ...pendingCards,
        ],
      };
    }),
  };
}

function gameViewWithResolvedDiscards(view: GameView, resolving: ResolvingPlayedCard[]): GameView {
  const cardsByPlayer = new Map<number, CardView[]>();
  for (const entry of resolving) {
    const cards = cardsByPlayer.get(entry.playerIndex) ?? [];
    cardsByPlayer.set(entry.playerIndex, [...cards, entry.card]);
  }

  return {
    ...view,
    players: view.players.map((player, playerIndex) => {
      const resolvedCards = cardsByPlayer.get(playerIndex) ?? [];
      if (!resolvedCards.length) {
        return player;
      }
      return {
        ...player,
        playZone: player.playZone.filter((playZoneCard) => !resolvedCards.some((card) => sameKnownCard(playZoneCard, card))),
        discard: [
          ...player.discard.filter((discardCard) => !resolvedCards.some((card) => sameKnownCard(discardCard, card))),
          ...resolvedCards,
        ],
      };
    }),
  };
}

function shouldResolveCardInDisplay(step: ReplayStep, entry: ResolvingPlayedCard): boolean {
  return !!step.animationPhases?.length
    && (stepContainsPlayForCard(step, entry.card) || isCardEffectContinuationStep(step));
}

function shouldShowResolvingCardInDisplay(step: ReplayStep, baseView: GameView, entry: ResolvingPlayedCard): boolean {
  if (!playerHasDiscardCard(baseView.players[entry.playerIndex], entry.card)) {
    return true;
  }
  return stepContainsPlayForCard(step, entry.card) && !step.animationPhases?.length;
}

function shouldShowResolvingCardInPhase(step: ReplayStep, baseView: GameView, entry: ResolvingPlayedCard): boolean {
  return shouldShowResolvingCardInDisplay(step, baseView, entry)
    || stepContainsPlayForCard(step, entry.card)
    || isCardEffectContinuationStep(step);
}

function stepContainsPlayForCard(step: ReplayStep, card: CardView): boolean {
  return (step.actionTimeline ?? []).some((event) => event.kind === 'Play' && eventCardMatches(card, event));
}

function isCardEffectContinuationStep(step: ReplayStep): boolean {
  return (step.actionTimeline ?? []).some((event) => [
    'Switch',
    'MoveCard',
    'MoveCardReverse',
    'Draw',
    'DrawReverse',
    'Shuffle',
    'HpChange',
    'HPChange',
  ].includes(event.kind ?? ''));
}

function sameResolvingCard(left: ResolvingPlayedCard, right: ResolvingPlayedCard): boolean {
  return left.playerIndex === right.playerIndex && sameKnownCard(left.card, right.card);
}

function shouldProjectSingleGroup(currentView: GameView, group: ReplayActionGroup): boolean {
  return group.events.some((event) => event.kind === 'Play' && needsPlayedCardDiscardProjection(currentView, event));
}

function needsPlayedCardDiscardProjection(currentView: GameView, event: ActionTimelineEvent): boolean {
  const playerIndex = event.playerIndex;
  if (playerIndex === undefined) {
    return false;
  }
  const player = currentView.players[playerIndex];
  if (!player) {
    return false;
  }
  return !player.hand.some((card) => eventCardMatches(card, event))
    && !player.discard.some((card) => eventCardMatches(card, event))
    && !playerHasCardInPlay(player, event);
}

function applyReplayEvent(
  view: GameView,
  currentView: GameView,
  event: ActionTimelineEvent,
  options: { deferBoardStateEvents?: boolean; deferMoveCardEvents?: boolean } = {},
): void {
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

  if (event.kind === 'Play') {
    player.hand = removeMovedCardFromHand(player.hand, event);
    if (playerHasCardInPlay(currentPlayer, event)) {
      player.active = currentPlayer.active;
      player.bench = currentPlayer.bench;
      player.stadium = currentPlayer.stadium;
      player.playZone = currentPlayer.playZone;
      return;
    }
    player.discard = addCardToDiscard(player, currentPlayer, event);
    return;
  }

  if (event.kind === 'Evolve') {
    player.hand = removeMovedCardFromHand(player.hand, event);
    if (!options.deferBoardStateEvents) {
      player.active = currentPlayer.active;
      player.bench = currentPlayer.bench;
      player.discard = currentPlayer.discard;
    }
    return;
  }

  if (event.kind === 'HpChange' || event.kind === 'HPChange') {
    if (options.deferBoardStateEvents) {
      return;
    }
    if (applyDamageReplayEvent(player, event)) {
      return;
    }
    player.active = currentPlayer.active;
    player.bench = currentPlayer.bench;
    player.discard = currentPlayer.discard;
    return;
  }

  if (isBoardStateEvent(event.kind)) {
    if (options.deferBoardStateEvents) {
      return;
    }
    player.active = currentPlayer.active;
    player.bench = currentPlayer.bench;
    player.discard = currentPlayer.discard;
    return;
  }

  if (!isMoveCardKind(event.kind)) {
    return;
  }
  if (options.deferMoveCardEvents) {
    return;
  }

  const params = event.params as Record<string, unknown> | undefined;
  const fromArea = Number(params?.fromArea);
  const toArea = Number(params?.toArea);
  applyReplayAreaDelta(player, currentPlayer, fromArea, -1, event);
  applyReplayAreaDelta(player, currentPlayer, toArea, 1, event);
}

function isKnockOutMove(fromArea: number, toArea: number): boolean {
  return toArea === CabtAreaType.DISCARD
    && (fromArea === CabtAreaType.ACTIVE || fromArea === CabtAreaType.BENCH);
}

function isBoardPositionMove(fromArea: number, toArea: number): boolean {
  return (fromArea === CabtAreaType.ACTIVE && toArea === CabtAreaType.BENCH)
    || (fromArea === CabtAreaType.BENCH && toArea === CabtAreaType.ACTIVE);
}

function isBoardToDeckMove(fromArea: number, toArea: number): boolean {
  return toArea === CabtAreaType.DECK
    && (fromArea === CabtAreaType.ACTIVE || fromArea === CabtAreaType.BENCH);
}

function isAttachedCardArea(area: number): boolean {
  return area === CabtAreaType.ENERGY
    || area === CabtAreaType.TOOL;
}

function isAttachedCardMoveDestination(area: number): boolean {
  return area === CabtAreaType.DISCARD
    || area === CabtAreaType.DECK;
}

function isKnockOutEvent(event: ActionTimelineEvent): boolean {
  const params = event.params as Record<string, unknown> | undefined;
  return isMoveCardKind(event.kind)
    && isKnockOutMove(Number(params?.fromArea), Number(params?.toArea));
}

function applyDamageReplayEvent(player: PlayerView, event: ActionTimelineEvent): boolean {
  const params = event.params as Record<string, unknown> | undefined;
  const serial = Number(params?.serial);
  const cardId = Number(params?.cardId);
  const value = Number(params?.value);
  if (!Number.isFinite(value)) {
    return false;
  }

  let updated = false;
  const updateSlot = (slot: PokemonSlotView): PokemonSlotView => {
    const matches = Number.isFinite(serial)
      ? slot.pokemon?.serial === serial
      : Number.isFinite(cardId) && slot.pokemon?.id === cardId;
    if (!matches) {
      return slot;
    }
    updated = true;
    return {
      ...slot,
      damage: Math.max(0, Math.round(slot.damage - value)),
    };
  };

  player.active = updateSlot(player.active);
  player.bench = player.bench.map(updateSlot);
  return updated;
}

function isBoardStateEvent(kind: string | undefined): boolean {
  return [
    'Attack',
    'Attach',
    'Evolve',
    'Devolve',
    'Switch',
    'HpChange',
    'HPChange',
    'Poisoned',
    'Burned',
    'Asleep',
    'Paralyzed',
    'Confused',
  ].includes(kind ?? '');
}

function applyReplayAreaDelta(
  player: PlayerView,
  currentPlayer: PlayerView,
  area: number,
  delta: -1 | 1,
  event?: ActionTimelineEvent,
): void {
  if (area === CabtAreaType.DECK) {
    player.deckCount = Math.max(0, player.deckCount + delta);
    return;
  }
  if (area === CabtAreaType.HAND) {
    player.hand = delta > 0 ? addCardToHand(player, currentPlayer) : removeMovedCardFromHand(player.hand, event);
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
    player.bench = delta > 0 ? addCardToBench(player, currentPlayer, event) : currentPlayer.bench;
    return;
  }
  if (area === CabtAreaType.DISCARD) {
    player.discard = currentPlayer.discard;
    return;
  }
  if (area === CabtAreaType.STADIUM) {
    player.stadium = delta > 0 ? currentPlayer.stadium : removeMovedCardFromZone(player.stadium, event);
    return;
  }
  if (area === CabtAreaType.ENERGY || area === CabtAreaType.TOOL || area === CabtAreaType.PRE_EVOLUTION) {
    player.active = currentPlayer.active;
    player.bench = currentPlayer.bench;
  }
}

function removeMovedCardFromZone(cards: CardView[], event: ActionTimelineEvent | undefined): CardView[] {
  const params = event?.params as Record<string, unknown> | undefined;
  const serial = Number(params?.serial);
  if (Number.isFinite(serial)) {
    return cards.filter((card) => card.serial !== serial);
  }

  const cardId = Number(params?.cardId);
  if (Number.isFinite(cardId)) {
    const index = cards.findIndex((card) => card.id === cardId);
    return index >= 0 ? removeAt(cards, index) : cards;
  }

  return cards.slice(0, -1);
}

function removeMovedCardFromHand(hand: CardView[], event: ActionTimelineEvent | undefined): CardView[] {
  const params = event?.params as Record<string, unknown> | undefined;
  const serial = Number(params?.serial);
  if (Number.isFinite(serial)) {
    const index = hand.findIndex((card) => card.serial === serial);
    if (index >= 0) {
      return removeAt(hand, index);
    }
  }

  const cardId = Number(params?.cardId);
  if (Number.isFinite(cardId)) {
    const index = hand.findIndex((card) => card.id === cardId);
    if (index >= 0) {
      return removeAt(hand, index);
    }
  }

  return resizedHand(hand, hand.length - 1);
}

function removeAt<T>(items: T[], index: number): T[] {
  return [...items.slice(0, index), ...items.slice(index + 1)];
}

function addCardToHand(player: PlayerView, currentPlayer: PlayerView): CardView[] {
  const nextCard = currentPlayer.hand[player.hand.length] ?? faceDownCard();
  return [...player.hand, nextCard];
}

function addCardToDiscard(player: PlayerView, currentPlayer: PlayerView, event: ActionTimelineEvent): CardView[] {
  const eventCard = cardViewFromEvent(event);
  const currentNewCard = currentPlayer.discard.find((card) => eventCardMatches(card, event));
  const nextCard = currentNewCard ?? eventCard ?? currentPlayer.discard.at(-1) ?? faceDownCard();
  if (player.discard.some((card) => sameKnownCard(card, nextCard))) {
    return player.discard;
  }
  return [...player.discard, nextCard];
}

function addCardToBench(player: PlayerView, currentPlayer: PlayerView, event: ActionTimelineEvent | undefined): PokemonSlotView[] {
  const params = event?.params as Record<string, unknown> | undefined;
  const explicitIndex = Number(params?.toIndex ?? params?.index ?? params?.benchIndex);
  const currentSlot = currentPlayer.bench.find((slot) => slot.pokemon && event && eventCardMatches(slot.pokemon, event));
  if (!currentSlot) {
    return player.bench;
  }

  const index = Number.isInteger(explicitIndex)
    ? explicitIndex
    : Number.isInteger(currentSlot.index)
      ? currentSlot.index
      : player.bench.findIndex((slot) => slot.empty);
  if (!Number.isInteger(index) || index < 0) {
    return player.bench;
  }

  const bench = player.bench.length ? [...player.bench] : currentPlayer.bench.map((slot) => ({ ...slot }));
  while (bench.length <= index && currentPlayer.bench[bench.length]) {
    bench.push(currentPlayer.bench[bench.length]);
  }
  if (!bench[index]) {
    return bench;
  }
  bench[index] = currentSlot;
  return bench;
}

function cardViewFromEvent(event: ActionTimelineEvent): CardView | undefined {
  const params = event.params as Record<string, unknown> | undefined;
  const cardId = Number(params?.cardId);
  if (!Number.isFinite(cardId)) {
    return undefined;
  }
  return cardToView({
    id: cardId,
    serial: Number.isFinite(Number(params?.serial)) ? Number(params?.serial) : undefined,
    playerIndex: event.playerIndex,
  });
}

function eventCardMatches(card: CardView, event: ActionTimelineEvent): boolean {
  const params = event.params as Record<string, unknown> | undefined;
  const serial = Number(params?.serial);
  if (Number.isFinite(serial)) {
    return card.serial === serial;
  }
  const cardId = Number(params?.cardId);
  return Number.isFinite(cardId) && card.id === cardId;
}

function sameKnownCard(left: CardView, right: CardView): boolean {
  if (left.serial !== undefined && right.serial !== undefined) {
    return left.serial === right.serial;
  }
  return left.id === right.id && left.name === right.name;
}

function playerHasDiscardCard(player: PlayerView | undefined, card: CardView): boolean {
  return !!player?.discard.some((discardCard) => sameKnownCard(discardCard, card));
}

function playerHasCardInPlay(player: PlayerView, event: ActionTimelineEvent): boolean {
  return [
    ...slotCards(player.active),
    ...player.bench.flatMap(slotCards),
    ...player.stadium,
    ...player.playZone,
  ].some((card) => eventCardMatches(card, event));
}

function slotCards(slot: PokemonSlotView): CardView[] {
  return [
    ...(slot.pokemon ? [slot.pokemon] : []),
    ...slot.cards,
    ...slot.energy,
    ...slot.tools,
  ];
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

  const steps = replayEnvironment(input)?.steps;
  const frames = steps?.[0]?.[0]?.observation?.visualize;
  if (Array.isArray(frames)) {
    return frames as CabtVisualizeFrame[];
  }

  const firstStepFrames = (steps?.[0]?.[0] as { visualize?: unknown } | undefined)?.visualize;
  if (Array.isArray(firstStepFrames)) {
    return firstStepFrames as CabtVisualizeFrame[];
  }
  return [];
}

function replayEnvironment(input: unknown): KaggleEnvironment | undefined {
  const wrapped = (input as KaggleContext)?.environment;
  if (wrapped?.steps) {
    return wrapped;
  }
  const topLevel = input as KaggleEnvironment;
  if (Array.isArray(topLevel?.steps)) {
    return topLevel;
  }
  return wrapped;
}

function frameToGameView(
  frame: CabtVisualizeFrame,
  playerNamesForReplay: string[],
  logs: LogView[],
  actionTimeline: GameView['actionTimeline'],
): GameView {
  const current = frame.current;
  const activePlayerIndex = clampPlayerIndex(current.yourIndex);
  const stadium = current.stadium ?? [];
  const players = current.players.map((player, index) =>
    buildPlayerView(player, index, activePlayerIndex, playerNamesForReplay[index] ?? `Player ${index + 1}`, stadiumForPlayer(stadium, index)),
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

function stadiumForPlayer(stadium: CabtCardRef[], playerIndex: number): CabtCardRef[] {
  const owned = stadium.filter((card) => card.playerIndex === playerIndex);
  if (owned.length) {
    return owned;
  }
  return playerIndex === 0
    ? stadium.filter((card) => card.playerIndex === undefined || card.playerIndex === null)
    : [];
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
    serial: cardRef.serial,
    playerIndex: cardRef.playerIndex,
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
    powers: powersForCard(data),
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
  const names = replayEnvironment(input)?.info?.TeamNames;
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
    case 'Ability':
      return `${actor} used ${abilityNameForLog(log)} with ${card}.`;
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

function abilityNameForLog(log: Record<string, unknown>): string {
  const explicit = typeof log.abilityName === 'string' ? log.abilityName.trim() : '';
  if (explicit) {
    return displayName(explicit);
  }
  return abilityNameForCard(cardDatabase.get(Number(log.cardId)));
}

function abilityNameForCard(data: CardRow | undefined): string {
  const skillName = data?.skills?.find((skill) => skill.name.trim())?.name.trim();
  return skillName ? displayName(skillName) : 'an Ability';
}

function powersForCard(data: CardRow | undefined): CardView['powers'] {
  const skills = data?.skills?.filter((skill) => skill.name.trim());
  if (!skills?.length) {
    return undefined;
  }
  return skills.map((skill) => ({
    name: displayName(skill.name.trim()),
    text: skill.text ?? '',
  }));
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
