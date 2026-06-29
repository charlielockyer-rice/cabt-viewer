import {
  actionAnimationTiming,
  isAttachedCardArea,
  isAttachedCardMoveDestination,
  isBoardPositionMove,
  isBoardToDeckMove,
  isKnockOutMove,
  isSpecialConditionEvent,
} from './actionAnimationPhases';
import { actionAnimationStartMs } from './actionAnimationSchedule';
import { cabtLogsToTimeline, formatCabtLog } from './logFormat';
import {
  isMoveCardKind,
  persistentActionLabel,
  replayActionGroups,
  type ReplayActionGroup,
} from './replayActionGroups';
import { cardViewFromEvent, eventCardMatches, sameKnownCard } from './replayCardIdentity';
import {
  cardEffectContinuation,
  type ReplayFrameEntry,
} from './replayContinuations';
import {
  gameViewWithResolvingCards,
  gameViewWithResolvingDiscardDestinations,
  resolvingContextForStep,
  resolvingDisplayView,
  resolvingFinalizerCardsForGroup,
  resolvingPlayedCardsForEvents,
  type ResolvingPlayedCard,
  type ResolvingPlayedCardContext,
} from './replayResolvingCards';
import {
  applyReplayEvent,
  playerHasCardInPlay,
  projectedViewForEvents,
  shouldProjectSingleGroup,
} from './replayProjection';
import {
  cabtAbilityNameForCardId,
  cabtCardName,
  cabtCardNames,
  cabtCardToView,
  cabtDisplayName,
  cabtEvolutionTriggeredDrawSkill,
  isCabtPokemonCard,
  isCabtResolvingTrainerCard,
  isCabtStadiumCard,
  isCabtToolCard,
} from './replayCardData';
import {
  extractVisualizeFrames,
  replayEnvironment,
  replayPlayerNames,
  type CabtPokemonRef,
  type CabtVisualizeFrame,
} from './replayInput';
import {
  animationEventPhases,
  animationPhaseLabel,
  animationPhaseMayHavePlan,
  animationPhaseNeedsDedicatedView,
  type AnimationEventPhase,
} from './replayAnimationPhases';
import { cabtReplayStepLabel } from './replayStepLabels';
import { frameToGameView } from './replayView';
import { CabtAreaType, CabtOptionType } from './types';
import {
  createReplayAnimationPhasePlan,
  replayAnimationMotionSpanMs,
  type AnimationAnchorRef,
  type AnimationHandoffPolicy,
  type AnimationIdentity,
  type AnimationMotion,
  type AnimationSpriteVisual,
  type RevealSessionStep,
} from '../animations/replayAnimationPlan';
import { type ActionTimelineEvent, type CardView, type GameView, type LogView, type PlayerView, type PokemonSlotView } from '../game/types';
import type { ReplayAnimationPhase, ReplaySnapshot, ReplayStep } from '../game/replay';

export function cabtReplayToSnapshot(input: unknown): ReplaySnapshot {
  const visualFrames = extractVisualizeFrames(input);
  if (!visualFrames.length) {
    throw new Error('CABT replay did not include visualize frames.');
  }

  const environment = replayEnvironment(input);
  const players = replayPlayerNames(input);
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
      logs.push({ id: logId++, message: formatCabtLog(entry), params: entry });
    }
    const view = frameToGameView(frame, players, logs, timeline.events);
    views.push(view);
    const groups = replayActionGroups(timeline.events, frame.current.turn);
    frameEntries.push({ frame, view, groups });
  });

  let resolvingPlayedCards: ResolvingPlayedCard[] = [];

  for (let index = 0; index < frameEntries.length; index += 1) {
    const { frame, view, groups } = frameEntries[index];
    const continuation = cardEffectContinuation(frameEntries, index);
    if (continuation) {
      const currentView = frameEntries[continuation.endIndex].view;
      const resolvingContext = resolvingContextForStep({
        baseView: currentView,
        actionTimeline: continuation.group.events,
        hasAnimationPhases: shouldBuildGroupedStepAnimationPhases(views[index - 1], continuation.group),
        resolvingFinalizers: resolvingPlayedCardsForEvents([continuation.resolvingPlayEvent]),
        resolving: resolvingPlayedCards,
      });
      resolvingPlayedCards = resolvingContext.nextResolving;
      steps.push(replayStepForFrame({
        view: currentView,
        stateIndex: continuation.endIndex,
        label: continuation.group.label,
        type: continuation.group.type,
        actionTimeline: continuation.group.events,
        displayView: groupedStepDisplayView(views[index - 1], currentView, [continuation.group], 0, resolvingContext),
        animationPhases: groupedStepAnimationPhases(views[index - 1], currentView, [continuation.group], 0, resolvingContext),
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
        const resolvingContext = resolvingContextForStep({
          baseView: view,
          actionTimeline: group.events,
          hasAnimationPhases: shouldBuildGroupedStepAnimationPhases(views[index - 1], group),
          resolvingFinalizers: resolvingFinalizerCardsForGroup(group, view),
          resolving: resolvingPlayedCards,
        });
        resolvingPlayedCards = resolvingContext.nextResolving;
        steps.push(replayStepForFrame({
          view,
          stateIndex: index,
          label: group.label,
          type: group.type,
          actionTimeline: group.events,
          displayView: groupedStepDisplayView(views[index - 1], view, groups, groupIndex, resolvingContext),
          animationPhases: groupedStepAnimationPhases(views[index - 1], view, groups, groupIndex, resolvingContext),
          payload: {
            events: group.events,
            select: frame.select,
            selected: frame.selected,
            action: frame.action,
          },
        }));
      }
    } else {
      const resolvingContext = resolvingContextForStep({
        baseView: view,
        actionTimeline: undefined,
        hasAnimationPhases: false,
        resolvingFinalizers: [],
        resolving: resolvingPlayedCards,
      });
      resolvingPlayedCards = resolvingContext.nextResolving;
      steps.push(replayStepForFrame({
        view,
        stateIndex: index,
        label: cabtReplayStepLabel(frame, index),
        type: String(frame.select?.type ?? 'frame'),
        displayView: resolvingDisplayView(view, resolvingContext),
        payload: {
          select: frame.select,
          selected: frame.selected,
          action: frame.action,
        },
      }));
    }
  }

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
    cardNames: cabtCardNames(),
    views,
    steps,
  };
}

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
  const abilityName = cabtAbilityNameForCardId(cardId);
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
  const skill = cabtEvolutionTriggeredDrawSkill(cardId);
  if (!skill) {
    return null;
  }
  const serial = numberField(evolveLog?.serial);
  const source = evolvedPokemonSource(frame, playerIndex, cardId, serial);
  return {
    playerIndex,
    cardId,
    serial,
    abilityName: cabtDisplayName(skill.name.trim()),
    drawCount: skill.drawCount,
    area: source?.area,
    index: source?.index,
  };
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

function groupedStepDisplayView(
  previousView: GameView | undefined,
  currentView: GameView,
  groups: ReplayActionGroup[],
  groupIndex: number,
  resolvingContext?: ResolvingPlayedCardContext,
): GameView | undefined {
  const group = groups[groupIndex];
  if (!previousView || !group) {
    return resolvingDisplayView(currentView, resolvingContext);
  }
  const needsProjection = groups.length >= 2 || shouldProjectSingleGroup(currentView, group);
  if (!needsProjection) {
    return resolvingDisplayView(currentView, resolvingContext);
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

  return resolvingDisplayView(view, resolvingContext) ?? view;
}

function groupedStepAnimationPhases(
  previousView: GameView | undefined,
  currentView: GameView,
  groups: ReplayActionGroup[],
  groupIndex: number,
  resolvingContext?: ResolvingPlayedCardContext,
): ReplayAnimationPhase[] | undefined {
  const group = groups[groupIndex];
  if (!previousView || !group) {
    return undefined;
  }
  const eventPhases = animationEventPhases(group.events);
  if (eventPhases.length <= 1 && !eventPhases.some(animationPhaseNeedsDedicatedView) && !eventPhases.some(animationPhaseMayHavePlan)) {
    return undefined;
  }

  let phaseStartView = projectedViewForEvents(previousView, currentView, groups.slice(0, groupIndex).flatMap((item) => item.events));
  const phases: ReplayAnimationPhase[] = [];
  for (const [phaseIndex, phase] of eventPhases.entries()) {
    let phaseView = phase.usesSourceView
      ? animationSourceViewForPhase(phaseStartView, currentView, phase)
      : projectedViewForEvents(phaseStartView, currentView, phase.events);
    const label = animationPhaseLabel(phase);
    const isLastPhase = phases.length === eventPhases.length - 1;
    const resolvedInPhase = isLastPhase ? (resolvingContext?.displayResolved ?? []) : [];
    const phaseResolving = resolvingContext?.phaseResolving ?? [];
    if (phaseResolving.length) {
      phaseView = gameViewWithResolvingCards(phaseView, phaseResolving);
    }
    if (resolvedInPhase.length) {
      phaseView = gameViewWithResolvingDiscardDestinations(phaseView, resolvedInPhase);
    }
    const view = {
      ...phaseView,
      actionTimeline: phase.events,
    };
    const baseMotions = animationPhaseMotions(phase, view, group.events);
    const resolvingMotions = resolvedInPhase.length
      ? resolvingDiscardCardMoveMotions(phase, resolvedInPhase, Math.max(phase.durationMs, replayAnimationMotionSpanMs(baseMotions)) + resolvingDiscardHandoffGapMs)
      : [];
    const motions = [...baseMotions, ...resolvingMotions];
    const durationMs = Math.max(phase.durationMs, replayAnimationMotionSpanMs(motions));
    phases.push({
      key: phase.key,
      kind: phase.kind,
      label,
      view,
      actionTimeline: phase.events,
      durationMs,
      animationPlan: replayAnimationPlanForPhase(phase, view, label, group.events, { motions, durationMs }),
    });
    phaseStartView = projectedViewForEvents(phaseStartView, currentView, phase.events, {
      deferSpecialConditionState: eventPhases.slice(phaseIndex + 1).some((laterPhase) => laterPhase.kind === 'Condition'),
    });
  }
  return phases;
}

function replayAnimationPlanForPhase(
  phase: AnimationEventPhase,
  view: GameView,
  label: string | undefined,
  stepEvents: ActionTimelineEvent[] = phase.events,
  options: {
    motions?: AnimationMotion[];
    durationMs?: number;
  } = {},
) {
  const motions = options.motions ?? animationPhaseMotions(phase, view, stepEvents);
  if (!motions.length) {
    return undefined;
  }
  return createReplayAnimationPhasePlan({
    key: phase.key,
    kind: phase.kind,
    playerIndex: phase.playerIndex,
    label,
    view,
    durationMs: options.durationMs ?? phase.durationMs,
    motions,
  });
}

function shouldBuildGroupedStepAnimationPhases(
  previousView: GameView | undefined,
  group: ReplayActionGroup | undefined,
): boolean {
  if (!previousView || !group) {
    return false;
  }
  const eventPhases = animationEventPhases(group.events);
  return eventPhases.length > 1
    || eventPhases.some(animationPhaseNeedsDedicatedView)
    || eventPhases.some(animationPhaseMayHavePlan);
}

function animationPhaseMotions(
  phase: AnimationEventPhase,
  view: GameView,
  stepEvents: ActionTimelineEvent[] = phase.events,
): AnimationMotion[] {
  switch (phase.kind) {
    case 'BoardMove':
    case 'BoardToDeck':
    case 'DeckDiscard':
    case 'DeckBoardPlace':
    case 'DeckPrizePlace':
    case 'StadiumMove':
    case 'AttachedMove':
    case 'DiscardRecover':
    case 'KnockOut':
      return boardCardMoveMotions(phase, view);
    case 'Draw':
      return drawCardMoveMotions(phase, view);
    case 'Ability':
      return abilityPulseMotions(phase, view);
    case 'Attack':
      return attackPulseMotions(phase, view);
    case 'Coin':
      return coinPulseMotions(phase);
    case 'Change':
      return changePulseMotions(phase, view);
    case 'Devolve':
    case 'MoveAttached':
      return boardMutationPulseMotions(phase, view);
    case 'Condition':
      return conditionPulseMotions(phase, view);
    case 'Damage':
      return damagePulseMotions(phase, view, stepEvents);
    case 'Shuffle':
      return shuffleMotions(phase);
    case 'PrizeTake':
      return prizeTakeCardMoveMotions(phase, view);
    case 'HandToDeck':
      return handToDeckCardMoveMotions(phase, view);
    case 'Play':
    case 'HandMove':
    case 'Evolve':
      return handPlayCardMoveMotions(phase, view);
    case 'Attach':
      return [
        ...handPlayCardMoveMotions(phase, view),
        ...revealSessionMotions(phase, view, stepEvents),
      ];
    case 'DeckReveal':
    case 'DeckSearchReveal':
    case 'DeckRevealReturn':
    case 'DeckRevealTake':
      return revealSessionMotions(phase, view, stepEvents);
  }
  return assertUnhandledActionAnimationPhaseKind(phase.kind);
}

function abilityPulseMotions(phase: AnimationEventPhase, view: GameView): AnimationMotion[] {
  const motions = phase.events.map((event) => {
    if (event.kind !== 'Ability') {
      return [];
    }
    const anchor = abilityAnchorForEvent(view, event);
    if (!anchor) {
      return null;
    }
    return [{
      kind: 'pulse',
      id: `${phase.key}:${event.id}:ability`,
      anchor,
      coordinateSpace: 'board',
      spriteVisual: { kind: 'pulse', tone: 'ability' },
      label: abilityNameForEvent(event),
      startMs: actionAnimationStartMs(phase.events, event),
      durationMs: actionAnimationTiming.abilityAnnounceMs,
    } satisfies AnimationMotion];
  });
  return compactAnimationMotions(motions);
}

function abilityAnchorForEvent(view: GameView, event: ActionTimelineEvent): AnimationAnchorRef | undefined {
  if (event.playerIndex === undefined) {
    return undefined;
  }
  const player = view.players[event.playerIndex];
  if (!player) {
    return undefined;
  }
  const params = event.params as Record<string, unknown> | undefined;
  const area = finiteNumber(params?.area);
  const index = finiteNumber(params?.index);
  if (area === CabtAreaType.ACTIVE) {
    return {
      kind: 'board-slot',
      playerIndex: event.playerIndex,
      slot: 'active',
      slotIndex: player.active.index,
    };
  }
  if (area === CabtAreaType.BENCH && index !== undefined) {
    const benchSlot = player.bench.find((slot) => slot.index === index);
    if (benchSlot) {
      return {
        kind: 'board-slot',
        playerIndex: event.playerIndex,
        slot: 'bench',
        slotIndex: benchSlot.index,
      };
    }
  }
  return boardSlotAnchorForEvent(player, event);
}

function attackPulseMotions(phase: AnimationEventPhase, view: GameView): AnimationMotion[] {
  const motions = phase.events.map((event) => {
    if (event.kind !== 'Attack') {
      return [];
    }
    const anchor = event.playerIndex === undefined
      ? undefined
      : boardSlotAnchorForEvent(view.players[event.playerIndex], event);
    if (!anchor) {
      return null;
    }
    return [{
      kind: 'pulse',
      id: `${phase.key}:${event.id}:attack`,
      identity: animationIdentityForEvent(event, 'pokemon'),
      anchor,
      coordinateSpace: 'board',
      spriteVisual: { kind: 'pulse', tone: 'attack' },
      label: attackNameForEvent(event),
      startMs: actionAnimationStartMs(phase.events, event),
      durationMs: actionAnimationTiming.attackAnnounceMs,
    } satisfies AnimationMotion];
  });
  return compactAnimationMotions(motions);
}

function damagePulseMotions(phase: AnimationEventPhase, view: GameView, stepEvents: ActionTimelineEvent[]): AnimationMotion[] {
  const attackEvent = stepEvents.find((event) => event.kind === 'Attack');
  const attackAnchor = attackEvent?.playerIndex === undefined
    ? undefined
    : boardSlotAnchorForEvent(view.players[attackEvent.playerIndex], attackEvent);
  const motions = phase.events.map((event) => {
    if (event.kind !== 'HpChange' && event.kind !== 'HPChange') {
      return [];
    }
    const anchor = event.playerIndex === undefined
      ? undefined
      : boardSlotAnchorForEvent(view.players[event.playerIndex], event);
    if (!anchor) {
      return null;
    }
    return [{
      kind: 'pulse',
      id: `${phase.key}:${event.id}:damage`,
      identity: animationIdentityForEvent(event, 'pokemon'),
      anchor,
      sourceAnchor: attackAnchor,
      coordinateSpace: 'board',
      spriteVisual: { kind: 'pulse', tone: 'damage' },
      value: damageValueForEvent(event),
      startMs: actionAnimationStartMs(phase.events, event),
      durationMs: actionAnimationTiming.damageVisualMs,
    } satisfies AnimationMotion];
  });
  return compactAnimationMotions(motions);
}

function coinPulseMotions(phase: AnimationEventPhase): AnimationMotion[] {
  const motions = phase.events.map((event) => {
    if (event.kind !== 'Coin' || event.playerIndex === undefined) {
      return [];
    }
    return [{
      kind: 'pulse',
      id: `${phase.key}:${event.id}:coin`,
      anchor: { kind: 'deck-top', playerIndex: event.playerIndex },
      coordinateSpace: 'board',
      spriteVisual: { kind: 'pulse', tone: 'neutral' },
      label: coinResultLabel(event),
      startMs: actionAnimationStartMs(phase.events, event),
      durationMs: actionAnimationTiming.coinAnnounceMs,
    } satisfies AnimationMotion];
  });
  return compactAnimationMotions(motions);
}

function changePulseMotions(phase: AnimationEventPhase, view: GameView): AnimationMotion[] {
  const motions = phase.events.map((event) => {
    if (event.kind !== 'Change' || event.playerIndex === undefined) {
      return [];
    }
    const anchor = changeAnchorForEvent(view, event);
    if (!anchor) {
      return null;
    }
    return [{
      kind: 'pulse',
      id: `${phase.key}:${event.id}:change`,
      identity: changeAnimationIdentityForEvent(event),
      anchor,
      coordinateSpace: 'board',
      spriteVisual: { kind: 'pulse', tone: 'neutral' },
      label: changePulseLabel(event),
      startMs: actionAnimationStartMs(phase.events, event),
      durationMs: actionAnimationTiming.conditionAnnounceMs,
    } satisfies AnimationMotion];
  });
  return compactAnimationMotions(motions);
}

function changeAnchorForEvent(view: GameView, event: ActionTimelineEvent): AnimationAnchorRef | undefined {
  if (event.playerIndex === undefined) {
    return undefined;
  }
  const params = event.params as Record<string, unknown> | undefined;
  const player = view.players[event.playerIndex];
  return boardSlotAnchorForPokemon(
    player,
    finiteNumber(params?.serial) ?? finiteNumber(params?.serialBefore) ?? finiteNumber(params?.serialAfter),
    finiteNumber(params?.cardIdBefore) ?? finiteNumber(params?.cardId) ?? finiteNumber(params?.cardIdAfter),
  );
}

function changeAnimationIdentityForEvent(event: ActionTimelineEvent): AnimationIdentity {
  const params = event.params as Record<string, unknown> | undefined;
  return {
    kind: 'pokemon',
    serial: finiteNumber(params?.serial) ?? finiteNumber(params?.serialBefore) ?? finiteNumber(params?.serialAfter),
    cardId: finiteNumber(params?.cardIdBefore) ?? finiteNumber(params?.cardId) ?? finiteNumber(params?.cardIdAfter),
    name: stringValue(params?.cardNameBefore) ?? stringValue(params?.cardName),
  };
}

function changePulseLabel(event: ActionTimelineEvent): string {
  const params = event.params as Record<string, unknown> | undefined;
  const cardIdAfter = finiteNumber(params?.cardIdAfter);
  if (cardIdAfter !== undefined) {
    return `Changed to ${cabtCardName(cardIdAfter)}`;
  }
  return 'Changed';
}

function boardMutationPulseMotions(phase: AnimationEventPhase, view: GameView): AnimationMotion[] {
  const motions = phase.events.map((event) => {
    if ((event.kind !== 'Devolve' && event.kind !== 'MoveAttached') || event.playerIndex === undefined) {
      return [];
    }
    const anchor = boardMutationAnchorForEvent(view, event);
    if (!anchor) {
      return null;
    }
    return [{
      kind: 'pulse',
      id: `${phase.key}:${event.id}:${event.kind}`,
      identity: boardMutationAnimationIdentityForEvent(event),
      anchor,
      coordinateSpace: 'board',
      spriteVisual: { kind: 'pulse', tone: 'neutral' },
      label: boardMutationPulseLabel(event),
      startMs: actionAnimationStartMs(phase.events, event),
      durationMs: actionAnimationTiming.conditionAnnounceMs,
    } satisfies AnimationMotion];
  });
  return compactAnimationMotions(motions);
}

function boardMutationAnchorForEvent(view: GameView, event: ActionTimelineEvent): AnimationAnchorRef | undefined {
  if (event.playerIndex === undefined) {
    return undefined;
  }
  const params = event.params as Record<string, unknown> | undefined;
  return boardSlotAnchorForPokemon(
    view.players[event.playerIndex],
    finiteNumber(params?.serialTarget)
      ?? finiteNumber(params?.serialSource)
      ?? finiteNumber(params?.serialFrom)
      ?? finiteNumber(params?.serialTo)
      ?? finiteNumber(params?.serial),
    finiteNumber(params?.cardIdTarget)
      ?? finiteNumber(params?.cardIdSource)
      ?? finiteNumber(params?.cardIdFrom)
      ?? finiteNumber(params?.cardIdTo)
      ?? finiteNumber(params?.cardId),
  );
}

function boardMutationAnimationIdentityForEvent(event: ActionTimelineEvent): AnimationIdentity {
  const params = event.params as Record<string, unknown> | undefined;
  return {
    kind: 'pokemon',
    serial: finiteNumber(params?.serialTarget)
      ?? finiteNumber(params?.serialSource)
      ?? finiteNumber(params?.serialFrom)
      ?? finiteNumber(params?.serialTo)
      ?? finiteNumber(params?.serial),
    cardId: finiteNumber(params?.cardIdTarget)
      ?? finiteNumber(params?.cardIdSource)
      ?? finiteNumber(params?.cardIdFrom)
      ?? finiteNumber(params?.cardIdTo)
      ?? finiteNumber(params?.cardId),
    name: stringValue(params?.cardName) ?? stringValue(params?.cardNameTarget) ?? stringValue(params?.cardNameSource),
  };
}

function boardMutationPulseLabel(event: ActionTimelineEvent): string {
  if (event.kind === 'Devolve') {
    return 'Devolved';
  }
  return 'Moved attached card';
}

function conditionPulseMotions(phase: AnimationEventPhase, view: GameView): AnimationMotion[] {
  const motions = phase.events.map((event) => {
    if (!isSpecialConditionEvent(event.kind) || event.playerIndex === undefined) {
      return [];
    }
    const anchor = conditionAnchorForEvent(view, event);
    if (!anchor) {
      return null;
    }
    return [{
      kind: 'pulse',
      id: `${phase.key}:${event.id}:condition`,
      identity: animationIdentityForEvent(event, 'pokemon'),
      anchor,
      coordinateSpace: 'board',
      spriteVisual: { kind: 'pulse', tone: 'neutral' },
      label: conditionPulseLabel(event),
      startMs: actionAnimationStartMs(phase.events, event),
      durationMs: actionAnimationTiming.conditionAnnounceMs,
    } satisfies AnimationMotion];
  });
  return compactAnimationMotions(motions);
}

function conditionAnchorForEvent(view: GameView, event: ActionTimelineEvent): AnimationAnchorRef | undefined {
  if (event.playerIndex === undefined) {
    return undefined;
  }
  const player = view.players[event.playerIndex];
  return boardSlotAnchorForEvent(player, event)
    ?? (player ? { kind: 'board-slot', playerIndex: event.playerIndex, slot: 'active', slotIndex: player.active.index } : undefined);
}

function shuffleMotions(phase: AnimationEventPhase): AnimationMotion[] {
  return phase.events.flatMap((event) => {
    if (event.kind !== 'Shuffle' || event.playerIndex === undefined) {
      return [];
    }
    return [{
      kind: 'shuffle',
      id: `${phase.key}:${event.id}:shuffle`,
      anchor: { kind: 'deck-top', playerIndex: event.playerIndex },
      coordinateSpace: 'board',
      startMs: actionAnimationStartMs(phase.events, event),
      durationMs: actionAnimationTiming.deckShuffleMs,
    }];
  });
}

function drawCardMoveMotions(phase: AnimationEventPhase, view: GameView): AnimationMotion[] {
  const motionGroups = phase.events.map((event) => drawCardMoveMotionForEvent(phase, view, event));
  return compactAnimationMotions(motionGroups);
}

function drawCardMoveMotionForEvent(
  phase: AnimationEventPhase,
  view: GameView,
  event: ActionTimelineEvent,
): AnimationMotion | null | undefined {
  if (event.kind !== 'Draw' && event.kind !== 'DrawReverse') {
    return undefined;
  }
  const playerIndex = event.playerIndex;
  const params = event.params as Record<string, unknown> | undefined;
  const serial = finiteNumber(params?.serial);
  const cardId = finiteNumber(params?.cardId);
  const targetAnchor = handDestinationAnchorForEvent(view, event);
  if (playerIndex === undefined || cardId === undefined || !targetAnchor) {
    return null;
  }

  return {
    id: `${phase.key}:draw:${event.id}:${serial ?? cardId}`,
    kind: 'card-move',
    identity: {
      kind: 'card',
      serial,
      cardId,
      name: stringValue(params?.cardName),
    },
    sourceAnchor: { kind: 'deck-top', playerIndex },
    targetAnchor,
    coordinateSpace: 'viewport',
    startMs: actionAnimationStartMs(phase.events, event),
    durationMs: actionAnimationTiming.deckDrawMs,
    spriteVisual: {
      kind: 'card',
      card: cardViewFromEvent(event),
      faceDown: event.kind === 'DrawReverse',
    },
    handoffPolicy: {
      hideSourceUntil: 'none',
      hideDestinationUntil: 'prepaint',
      removeSprite: 'prepaint',
      prepaintFrames: 2,
    },
  };
}

function prizeTakeCardMoveMotions(phase: AnimationEventPhase, view: GameView): AnimationMotion[] {
  const motionGroups = phase.events.map((event) => prizeTakeCardMoveMotionForEvent(phase, view, event));
  return compactAnimationMotions(motionGroups);
}

function prizeTakeCardMoveMotionForEvent(
  phase: AnimationEventPhase,
  view: GameView,
  event: ActionTimelineEvent,
): AnimationMotion | null | undefined {
  if (!isMoveCardKind(event.kind)) {
    return undefined;
  }
  const playerIndex = event.playerIndex;
  const params = event.params as Record<string, unknown> | undefined;
  if (
    playerIndex === undefined
    || Number(params?.fromArea) !== CabtAreaType.PRIZE
    || Number(params?.toArea) !== CabtAreaType.HAND
  ) {
    return undefined;
  }

  const sourceAnchor = prizeSourceAnchorForEvent(view, event, phase.events);
  const targetAnchor = handDestinationAnchorForEvent(view, event);
  if (!sourceAnchor || !targetAnchor) {
    return null;
  }
  const targetCard = view.players[playerIndex]?.hand[targetAnchor.kind === 'hand-card' ? targetAnchor.handIndex ?? -1 : -1];
  const serial = finiteNumber(params?.serial) ?? targetCard?.serial;
  const cardId = finiteNumber(params?.cardId) ?? targetCard?.id;

  return {
    id: `${phase.key}:prize-take:${event.id}:${serial ?? cardId ?? 'unknown'}`,
    kind: 'card-move',
    identity: {
      kind: 'card',
      serial,
      cardId,
      name: stringValue(params?.cardName) ?? targetCard?.name,
    },
    sourceAnchor,
    targetAnchor,
    coordinateSpace: 'viewport',
    startMs: actionAnimationStartMs(phase.events, event),
    durationMs: actionAnimationTiming.prizeTakeMs,
    spriteVisual: {
      kind: 'card',
      card: cardViewFromEvent(event) ?? targetCard,
      faceDown: event.kind === 'MoveCardReverse',
    },
    handoffPolicy: {
      hideSourceUntil: 'none',
      hideDestinationUntil: 'arrival',
      removeSprite: 'arrival',
      prepaintFrames: 2,
    },
  };
}

function prizeSourceAnchorForEvent(
  view: GameView,
  event: ActionTimelineEvent,
  phaseEvents: ActionTimelineEvent[],
): AnimationAnchorRef | undefined {
  const playerIndex = event.playerIndex;
  if (playerIndex === undefined) {
    return undefined;
  }
  const params = event.params as Record<string, unknown> | undefined;
  const explicitIndex = finiteNumber(params?.fromIndex)
    ?? finiteNumber(params?.index)
    ?? finiteNumber(params?.prizeIndex);
  if (explicitIndex !== undefined) {
    return { kind: 'prize-card', playerIndex, prizeIndex: explicitIndex };
  }

  const samePlayerPrizeEvents = phaseEvents.filter((candidate) => {
    const candidateParams = candidate.params as Record<string, unknown> | undefined;
    return candidate.playerIndex === playerIndex
      && isMoveCardKind(candidate.kind)
      && Number(candidateParams?.fromArea) === CabtAreaType.PRIZE
      && Number(candidateParams?.toArea) === CabtAreaType.HAND;
  });
  const eventIndex = samePlayerPrizeEvents.findIndex((candidate) => candidate.id === event.id);
  if (eventIndex < 0) {
    return undefined;
  }
  const prizesLeft = view.players[playerIndex]?.prizesLeft ?? 0;
  return {
    kind: 'prize-card',
    playerIndex,
    prizeIndex: Math.max(0, prizesLeft - samePlayerPrizeEvents.length + eventIndex),
  };
}

function handToDeckCardMoveMotions(phase: AnimationEventPhase, view: GameView): AnimationMotion[] {
  const motionGroups = phase.events.map((event) => handToDeckCardMoveMotionForEvent(phase, view, event));
  return compactAnimationMotions(motionGroups);
}

function handToDeckCardMoveMotionForEvent(
  phase: AnimationEventPhase,
  view: GameView,
  event: ActionTimelineEvent,
): AnimationMotion | null | undefined {
  if (!isHandToDeckMoveEvent(event)) {
    return undefined;
  }
  const playerIndex = event.playerIndex;
  const sourceAnchor = handDestinationAnchorForEvent(view, event);
  if (playerIndex === undefined || !sourceAnchor) {
    return undefined;
  }
  const params = event.params as Record<string, unknown> | undefined;
  const sourceCard = view.players[playerIndex]?.hand[sourceAnchor.kind === 'hand-card' ? sourceAnchor.handIndex ?? -1 : -1];
  const serial = finiteNumber(params?.serial) ?? sourceCard?.serial;
  const cardId = finiteNumber(params?.cardId) ?? sourceCard?.id;
  if (cardId === undefined) {
    return null;
  }

  return {
    id: `${phase.key}:hand-to-deck:${event.id}:${serial ?? cardId}`,
    kind: 'card-move',
    identity: {
      kind: 'card',
      serial,
      cardId,
      name: sourceCard?.name ?? stringValue(params?.cardName),
    },
    sourceAnchor,
    targetAnchor: { kind: 'deck-top', playerIndex },
    coordinateSpace: 'viewport',
    startMs: actionAnimationStartMs(phase.events, event),
    durationMs: actionAnimationTiming.handMoveMs,
    spriteVisual: {
      kind: 'card',
      card: sourceCard ?? cardViewFromEvent(event),
      faceDown: event.kind === 'MoveCardReverse',
    },
    handoffPolicy: {
      hideSourceUntil: 'scope-exit',
      hideDestinationUntil: 'none',
      removeSprite: 'phase-end',
      prepaintFrames: 2,
    },
  };
}

function handPlayCardMoveMotions(phase: AnimationEventPhase, view: GameView): AnimationMotion[] {
  const motionGroups = phase.events.map((event) => handPlayCardMoveMotionForEvent(phase, view, event));
  return compactAnimationMotions(motionGroups);
}

function handPlayCardMoveMotionForEvent(
  phase: AnimationEventPhase,
  view: GameView,
  event: ActionTimelineEvent,
): AnimationMotion | null | undefined {
  if (!isPlannedHandPlayMoveEvent(event)) {
    return undefined;
  }
  const playerIndex = event.playerIndex;
  const sourceAnchor = handDestinationAnchorForEvent(view, event);
  if (playerIndex === undefined || !sourceAnchor) {
    return null;
  }
  const targetAnchor = handPlayTargetAnchorForEvent(view, event);
  if (!targetAnchor) {
    return undefined;
  }
  const params = event.params as Record<string, unknown> | undefined;
  const sourceCard = view.players[playerIndex]?.hand[sourceAnchor.kind === 'hand-card' ? sourceAnchor.handIndex ?? -1 : -1];
  const serial = finiteNumber(params?.serial) ?? sourceCard?.serial;
  const cardId = finiteNumber(params?.cardId) ?? sourceCard?.id;
  const isEvolution = event.kind === 'Evolve';
  if (cardId === undefined) {
    return null;
  }

  return {
    id: `${phase.key}:hand-play:${event.id}:${serial ?? cardId}`,
    kind: 'card-move',
    identity: {
      kind: handPlayIdentityKind(event),
      serial,
      cardId,
      name: sourceCard?.name ?? stringValue(params?.cardName),
    },
    sourceAnchor,
    targetAnchor,
    coordinateSpace: 'viewport',
    startMs: actionAnimationStartMs(phase.events, event),
    durationMs: actionAnimationTiming.handMoveMs,
    spriteVisual: {
      kind: 'card',
      card: sourceCard ?? cardViewFromEvent(event),
      faceDown: event.kind === 'MoveCardReverse',
    },
    handoffPolicy: {
      hideSourceUntil: 'scope-exit',
      hideDestinationUntil: isEvolution ? 'none' : 'arrival',
      removeSprite: isEvolution ? 'scope-exit' : 'arrival',
      prepaintFrames: 2,
    },
  };
}

function handPlayTargetAnchorForEvent(view: GameView, event: ActionTimelineEvent): AnimationAnchorRef | undefined {
  const playerIndex = event.playerIndex;
  if (playerIndex === undefined) {
    return undefined;
  }
  const params = event.params as Record<string, unknown> | undefined;
  const serial = finiteNumber(params?.serial);
  const cardId = finiteNumber(params?.cardId);
  if (event.kind === 'Play') {
    if (cardId !== undefined && isCabtStadiumCard(cardId)) {
      return { kind: 'stadium-card', playerIndex, serial };
    }
    const boardDestination = boardPokemonDestinationForEvent(view.players[playerIndex], event);
    if (boardDestination?.slot.pokemon) {
      return {
        kind: 'pokemon-card',
        playerIndex,
        slot: boardDestination.kind,
        slotIndex: boardDestination.slot.index,
        serial: boardDestination.slot.pokemon.serial,
      };
    }
    if (cardId !== undefined && isCabtResolvingTrainerCard(cardId)) {
      return { kind: 'play-zone-card', playerIndex, serial };
    }
    return attachedSourceAnchorForEvent(view.players[playerIndex], event, CabtAreaType.TOOL)
      ?? attachedSourceAnchorForEvent(view.players[playerIndex], event, CabtAreaType.ENERGY);
  }
  if (event.kind === 'Attach') {
    return attachedSourceAnchorForEvent(view.players[playerIndex], event, CabtAreaType.ENERGY)
      ?? attachedSourceAnchorForEvent(view.players[playerIndex], event, CabtAreaType.TOOL);
  }
  if (event.kind === 'Evolve') {
    const targetSerial = finiteNumber(params?.serialTarget);
    const targetCardId = finiteNumber(params?.cardIdTarget);
    return boardSlotAnchorForPokemon(view.players[playerIndex], targetSerial, targetCardId);
  }
  if (!isMoveCardKind(event.kind)) {
    return undefined;
  }
  const toArea = Number(params?.toArea);
  if (toArea === CabtAreaType.DISCARD) {
    return { kind: 'discard-card', playerIndex, serial };
  }
  if (toArea === CabtAreaType.ACTIVE || toArea === CabtAreaType.BENCH) {
    const destination = boardPokemonDestinationForEvent(view.players[playerIndex], event);
    if (!destination?.slot.pokemon) {
      return undefined;
    }
    return {
      kind: 'pokemon-card',
      playerIndex,
      slot: destination.kind,
      slotIndex: destination.slot.index,
      serial: destination.slot.pokemon.serial,
    };
  }
  return undefined;
}

function handPlayIdentityKind(event: ActionTimelineEvent): AnimationIdentity['kind'] {
  const params = event.params as Record<string, unknown> | undefined;
  const cardId = finiteNumber(params?.cardId);
  if (event.kind === 'Play' && cardId !== undefined && isCabtStadiumCard(cardId)) {
    return 'stadium';
  }
  if (event.kind === 'Play' && cardId !== undefined && isCabtPokemonCard(cardId)) {
    return 'pokemon';
  }
  const toArea = Number(params?.toArea);
  if (toArea === CabtAreaType.ACTIVE || toArea === CabtAreaType.BENCH) {
    return 'pokemon';
  }
  if (event.kind === 'Play' && cardId !== undefined && isCabtToolCard(cardId)) {
    return 'tool';
  }
  if (event.kind === 'Attach' && cardId !== undefined) {
    return isCabtToolCard(cardId) ? 'tool' : 'energy';
  }
  if (event.kind === 'Evolve') {
    return 'pokemon';
  }
  return 'card';
}

function revealSessionMotions(
  phase: AnimationEventPhase,
  view: GameView,
  stepEvents: ActionTimelineEvent[],
): AnimationMotion[] {
  const playerIndex = phase.events.find((event) => event.playerIndex !== undefined)?.playerIndex;
  if (playerIndex === undefined) {
    return [];
  }

  const revealEvents = stepEvents.filter((event) => isRevealSourceEvent(event, playerIndex));
  const revealIndexes = revealIndexBySerial(revealEvents);
  const steps = revealSessionStepsForPhase(phase, view, playerIndex, stepEvents, revealIndexes);
  if (!steps.length) {
    return [];
  }

  return [{
    id: `${phase.key}:reveal-session:${playerIndex}`,
    kind: 'reveal-session',
    playerIndex,
    coordinateSpace: 'viewport',
    revealCount: revealEvents.length || undefined,
    startMs: 0,
    durationMs: phase.durationMs,
    steps,
    handoffPolicy: {
      hideSourceUntil: 'none',
      hideDestinationUntil: 'prepaint',
      removeSprite: 'prepaint',
      prepaintFrames: 2,
    },
  }];
}

function revealSessionStepsForPhase(
  phase: AnimationEventPhase,
  view: GameView,
  playerIndex: number,
  stepEvents: ActionTimelineEvent[],
  revealIndexes: ReadonlyMap<number, number>,
): RevealSessionStep[] {
  if (phase.kind === 'DeckReveal') {
    return phase.events
      .filter((event) => isRevealSourceEvent(event, playerIndex))
      .map((event) => revealSessionStep(event, phase, 'reveal', {
        sourceAnchor: { kind: 'deck-top', playerIndex },
        targetAnchor: revealCardAnchor(playerIndex, event, revealIndexes),
        durationMs: actionAnimationTiming.deckRevealMs,
      }));
  }

  if (phase.kind === 'DeckSearchReveal') {
    return phase.events
      .filter((event) => isDeckToHandSearchEvent(event, playerIndex))
      .map((event) => revealSessionStep(event, phase, 'take', {
        sourceAnchor: { kind: 'deck-top', playerIndex },
        targetAnchor: handDestinationAnchorForEvent(view, event),
        durationMs: actionAnimationTiming.deckRevealMs,
      }));
  }

  if (phase.kind === 'DeckRevealReturn') {
    const returningSerials = new Set(
      phase.events
        .filter((event) => isRevealReturnEvent(event, playerIndex))
        .map((event) => finiteNumber((event.params as Record<string, unknown> | undefined)?.serial))
        .filter((serial): serial is number => serial !== undefined),
    );
    const selectSteps = stepEvents
      .filter((event) => isRevealTakeEvent(event, playerIndex))
      .filter((event) => {
        const serial = finiteNumber((event.params as Record<string, unknown> | undefined)?.serial);
        return serial !== undefined && !returningSerials.has(serial);
      })
      .map((event) => revealSessionStep(event, phase, 'select', {
        sourceAnchor: revealCardAnchor(playerIndex, event, revealIndexes),
        targetAnchor: revealCardAnchor(playerIndex, event, revealIndexes),
        startMs: 0,
        durationMs: actionAnimationTiming.deckRevealReturnMs,
      }));
    const returnSteps = phase.events
      .filter((event) => isRevealReturnEvent(event, playerIndex))
      .map((event) => revealSessionStep(event, phase, 'return', {
        sourceAnchor: revealCardAnchor(playerIndex, event, revealIndexes),
        targetAnchor: { kind: 'deck-top', playerIndex },
        durationMs: actionAnimationTiming.deckRevealReturnMs,
      }));
    return [...selectSteps, ...returnSteps];
  }

  if (phase.kind === 'DeckRevealTake') {
    return phase.events
      .filter((event) => isRevealTakeEvent(event, playerIndex))
      .map((event) => revealSessionStep(event, phase, 'take', {
        sourceAnchor: revealCardAnchor(playerIndex, event, revealIndexes),
        targetAnchor: handDestinationAnchorForEvent(view, event),
        durationMs: actionAnimationTiming.handMoveMs,
      }));
  }

  if (phase.kind === 'Attach') {
    return phase.events
      .filter((event) => isRevealAttachEvent(event, playerIndex, revealIndexes))
      .map((event) => revealSessionStep(event, phase, 'attach', {
        sourceAnchor: revealCardAnchor(playerIndex, event, revealIndexes),
        targetAnchor: revealAttachTargetAnchorForEvent(view, event),
        durationMs: actionAnimationTiming.handMoveMs,
      }));
  }

  return [];
}

function revealSessionStep(
  event: ActionTimelineEvent,
  phase: AnimationEventPhase,
  kind: RevealSessionStep['kind'],
  options: {
    sourceAnchor?: AnimationAnchorRef;
    targetAnchor?: AnimationAnchorRef;
    startMs?: number;
    durationMs: number;
  },
): RevealSessionStep {
  const params = event.params as Record<string, unknown> | undefined;
  const serial = finiteNumber(params?.serial);
  const cardId = finiteNumber(params?.cardId);
  const resolvesToVisibleDestination = kind === 'take' || kind === 'attach';
  const handoffPolicy = revealSessionStepHandoffPolicy(kind, options.sourceAnchor, resolvesToVisibleDestination);
  return {
    id: `${phase.key}:${kind}:${event.id}:${serial ?? cardId ?? 'unknown'}`,
    kind,
    identity: {
      kind: 'card',
      serial,
      cardId,
      name: stringValue(params?.cardName),
    },
    sourceAnchor: options.sourceAnchor,
    targetAnchor: options.targetAnchor,
    spriteVisual: {
      kind: 'card',
      card: cardViewFromEvent(event),
    },
    startMs: options.startMs ?? actionAnimationStartMs(phase.events, event),
    durationMs: options.durationMs,
    handoffPolicy,
  };
}

function revealSessionStepHandoffPolicy(
  kind: RevealSessionStep['kind'],
  sourceAnchor: AnimationAnchorRef | undefined,
  resolvesToVisibleDestination: boolean,
): RevealSessionStep['handoffPolicy'] {
  if (!resolvesToVisibleDestination) {
    return {
      hideSourceUntil: 'none',
      hideDestinationUntil: 'none',
      removeSprite: 'phase-end',
      prepaintFrames: 2,
    };
  }

  const directDeckSearchTake = kind === 'take' && sourceAnchor?.kind === 'deck-top';
  return {
    hideSourceUntil: 'none',
    hideDestinationUntil: directDeckSearchTake ? 'arrival' : 'prepaint',
    removeSprite: directDeckSearchTake ? 'arrival' : 'prepaint',
    prepaintFrames: 2,
  };
}

function revealIndexBySerial(revealEvents: ActionTimelineEvent[]): Map<number, number> {
  const indexes = new Map<number, number>();
  for (const [index, event] of revealEvents.entries()) {
    const serial = finiteNumber((event.params as Record<string, unknown> | undefined)?.serial);
    if (serial !== undefined) {
      indexes.set(serial, index);
    }
  }
  return indexes;
}

function revealCardAnchor(
  playerIndex: number,
  event: ActionTimelineEvent,
  revealIndexes: ReadonlyMap<number, number>,
): AnimationAnchorRef | undefined {
  const serial = finiteNumber((event.params as Record<string, unknown> | undefined)?.serial);
  if (serial === undefined) {
    return undefined;
  }
  const revealIndex = revealIndexes.get(serial);
  return revealIndex === undefined
    ? undefined
    : { kind: 'reveal-card', playerIndex, revealIndex, serial };
}

function handDestinationAnchorForEvent(view: GameView, event: ActionTimelineEvent): AnimationAnchorRef | undefined {
  const playerIndex = event.playerIndex;
  if (playerIndex === undefined) {
    return undefined;
  }
  const hand = view.players[playerIndex]?.hand ?? [];
  const handIndex = hand.findIndex((card) => eventCardMatches(card, event));
  const card = hand[handIndex];
  return handIndex < 0 || !card
    ? undefined
    : {
        kind: 'hand-card',
        playerIndex,
        handIndex,
        serial: card.serial,
      };
}

function revealAttachTargetAnchorForEvent(view: GameView, event: ActionTimelineEvent): AnimationAnchorRef | undefined {
  const playerIndex = event.playerIndex;
  if (playerIndex === undefined) {
    return undefined;
  }
  return attachedSourceAnchorForEvent(view.players[playerIndex], event, CabtAreaType.ENERGY)
    ?? attachedSourceAnchorForEvent(view.players[playerIndex], event, CabtAreaType.TOOL);
}

function boardCardMoveMotions(phase: AnimationEventPhase, view: GameView): AnimationMotion[] {
  const motionGroups = phase.events.map((event) => boardCardMoveMotionsForEvent(phase, view, event));
  return compactAnimationMotions(motionGroups);
}

function compactAnimationMotions(groups: MaybeAnimationMotionGroup[]): AnimationMotion[] {
  return groups.flatMap((group) => group ?? []);
}

function boardCardMoveMotionsForEvent(
  phase: AnimationEventPhase,
  view: GameView,
  event: ActionTimelineEvent,
): AnimationMotion[] | null {
  if (event.kind === 'Switch') {
    return switchBoardCardMoveMotions(phase, view, event);
  }
  if (!isMoveCardKind(event.kind)) {
    return [];
  }

  const params = event.params as Record<string, unknown> | undefined;
  const playerIndex = event.playerIndex;
  const fromArea = Number(params?.fromArea);
  const toArea = Number(params?.toArea);
  const serial = finiteNumber(params?.serial);
  const cardId = finiteNumber(params?.cardId);
  if (phase.kind === 'KnockOut' && !isKnockOutMove(fromArea, toArea)) {
    return [];
  }
  const isHiddenPrizePlacement = fromArea === CabtAreaType.DECK && toArea === CabtAreaType.PRIZE;
  if (playerIndex === undefined || (cardId === undefined && !isHiddenPrizePlacement)) {
    return null;
  }

  const sourceAnchor = boardMoveSourceAnchor(view, event, fromArea);
  const targetAnchor = boardMoveTargetAnchor(phase, view, event, toArea);
  if (!sourceAnchor || !targetAnchor) {
    return null;
  }
  const isDiscardRecovery = fromArea === CabtAreaType.DISCARD
    && (toArea === CabtAreaType.HAND || toArea === CabtAreaType.DECK);

  return [cardMoveMotion({
    id: `${phase.key}:${event.id}:${serial ?? cardId}`,
    event,
    phase,
    sourceAnchor,
    targetAnchor,
    identity: {
      kind: attachedIdentityKind(fromArea)
        ?? (fromArea === CabtAreaType.STADIUM ? 'stadium' : undefined)
        ?? ((fromArea === CabtAreaType.DECK && (toArea === CabtAreaType.DISCARD || toArea === CabtAreaType.PRIZE))
          || isDiscardRecovery ? 'card' : 'pokemon'),
      serial,
      cardId,
      name: stringValue(params?.cardName),
    },
    removeSprite: (fromArea === CabtAreaType.ACTIVE || fromArea === CabtAreaType.BENCH) && (toArea === CabtAreaType.ACTIVE || toArea === CabtAreaType.BENCH)
      || isKnockOutMove(fromArea, toArea)
      ? 'scope-exit'
      : 'prepaint',
    durationMs: cardMoveDurationMs(fromArea, toArea),
    coordinateSpace: (isAttachedCardArea(fromArea) || fromArea === CabtAreaType.DISCARD) && toArea === CabtAreaType.HAND
      ? 'cross-plane'
      : 'board',
    spriteVisual: (isAttachedCardArea(fromArea) && toArea === CabtAreaType.HAND)
      || (fromArea === CabtAreaType.DECK && toArea === CabtAreaType.DISCARD)
      || isDiscardRecovery
      ? { kind: 'card', card: cardViewFromEvent(event) }
      : undefined,
    handoffPolicy: isDiscardRecovery && toArea === CabtAreaType.HAND
      ? { hideDestinationUntil: 'none' }
      : undefined,
  })];
}

function switchBoardCardMoveMotions(
  phase: AnimationEventPhase,
  view: GameView,
  event: ActionTimelineEvent,
): AnimationMotion[] | null {
  const playerIndex = event.playerIndex;
  const params = event.params as Record<string, unknown> | undefined;
  if (playerIndex === undefined) {
    return null;
  }
  const activeAnchor = boardSlotAnchorForPokemon(view.players[playerIndex], finiteNumber(params?.serialActive), finiteNumber(params?.cardIdActive));
  const benchAnchor = boardSlotAnchorForPokemon(view.players[playerIndex], finiteNumber(params?.serialBench), finiteNumber(params?.cardIdBench));
  if (!activeAnchor || !benchAnchor) {
    return null;
  }
  return [
    cardMoveMotion({
      id: `${phase.key}:${event.id}:active-${params?.serialActive ?? params?.cardIdActive}`,
      event,
      phase,
      sourceAnchor: activeAnchor,
      targetAnchor: benchAnchor,
      identity: {
        kind: 'pokemon',
        serial: finiteNumber(params?.serialActive),
        cardId: finiteNumber(params?.cardIdActive),
      },
      removeSprite: 'scope-exit',
    }),
    cardMoveMotion({
      id: `${phase.key}:${event.id}:bench-${params?.serialBench ?? params?.cardIdBench}`,
      event,
      phase,
      sourceAnchor: benchAnchor,
      targetAnchor: activeAnchor,
      identity: {
        kind: 'pokemon',
        serial: finiteNumber(params?.serialBench),
        cardId: finiteNumber(params?.cardIdBench),
      },
      removeSprite: 'scope-exit',
    }),
  ];
}

function cardMoveMotion(input: {
  id: string;
  event: ActionTimelineEvent;
  phase: AnimationEventPhase;
  sourceAnchor: AnimationAnchorRef;
  targetAnchor: AnimationAnchorRef;
  identity: AnimationIdentity;
  removeSprite: 'prepaint' | 'scope-exit';
  durationMs?: number;
  coordinateSpace?: AnimationMotion['coordinateSpace'];
  spriteVisual?: AnimationSpriteVisual;
  handoffPolicy?: Partial<AnimationHandoffPolicy>;
}): AnimationMotion {
  const coordinateSpace = input.coordinateSpace ?? 'board';
  const removeSprite = coordinateSpace === 'cross-plane' ? 'arrival' : input.removeSprite;
  const handoffPolicy = {
    hideSourceUntil: input.sourceAnchor.kind === 'deck-top' ? 'snapshot' : 'scope-exit',
    hideDestinationUntil: coordinateSpace === 'cross-plane' ? 'arrival' : 'prepaint',
    removeSprite,
    prepaintFrames: 2,
    ...input.handoffPolicy,
  } satisfies AnimationHandoffPolicy;
  return {
    id: input.id,
    kind: 'card-move',
    identity: input.identity,
    sourceAnchor: input.sourceAnchor,
    targetAnchor: input.targetAnchor,
    coordinateSpace,
    startMs: actionAnimationStartMs(input.phase.events, input.event),
    durationMs: input.durationMs ?? actionAnimationTiming.boardMoveMs,
    spriteVisual: input.spriteVisual ?? cardMoveSpriteVisual(input),
    handoffPolicy,
  };
}

function cardMoveSpriteVisual(input: {
  event: ActionTimelineEvent;
  sourceAnchor: AnimationAnchorRef;
  identity: AnimationIdentity;
}): AnimationSpriteVisual {
  const cardId = input.identity.cardId;
  if (cardId !== undefined) {
    return {
      kind: 'card',
      card: cabtCardToView({
        id: cardId,
        serial: input.identity.serial,
        playerIndex: input.event.playerIndex,
      }),
      faceDown: input.event.kind === 'MoveCardReverse',
    };
  }
  return {
    kind: 'card',
    faceDown: true,
  };
}

function cardMoveDurationMs(fromArea: number, toArea: number): number {
  if (fromArea === CabtAreaType.ENERGY || fromArea === CabtAreaType.TOOL) {
    return actionAnimationTiming.handMoveMs;
  }
  if (isKnockOutMove(fromArea, toArea)) {
    return actionAnimationTiming.knockOutMs;
  }
  if (fromArea === CabtAreaType.DECK && toArea === CabtAreaType.DISCARD) {
    return actionAnimationTiming.deckDiscardMs;
  }
  if (fromArea === CabtAreaType.STADIUM && toArea === CabtAreaType.DISCARD) {
    return actionAnimationTiming.stadiumMoveMs;
  }
  return actionAnimationTiming.boardMoveMs;
}

function boardMoveSourceAnchor(view: GameView, event: ActionTimelineEvent, fromArea: number): AnimationAnchorRef | undefined {
  const playerIndex = event.playerIndex;
  if (playerIndex === undefined) {
    return undefined;
  }
  if (fromArea === CabtAreaType.DECK) {
    return { kind: 'deck-top', playerIndex };
  }
  if (fromArea === CabtAreaType.STADIUM) {
    const player = view.players[playerIndex];
    const card = player?.stadium.find((candidate) => eventCardMatches(candidate, event));
    return card ? { kind: 'stadium-card', playerIndex, serial: card.serial } : undefined;
  }
  if (fromArea === CabtAreaType.DISCARD) {
    const params = event.params as Record<string, unknown> | undefined;
    const card = view.players[playerIndex]?.discard.find((candidate) => eventCardMatches(candidate, event));
    return {
      kind: 'discard-card',
      playerIndex,
      serial: card?.serial ?? finiteNumber(params?.serial),
    };
  }
  if (fromArea === CabtAreaType.ENERGY || fromArea === CabtAreaType.TOOL) {
    return attachedSourceAnchorForEvent(view.players[playerIndex], event, fromArea);
  }
  if (fromArea === CabtAreaType.ACTIVE || fromArea === CabtAreaType.BENCH) {
    return boardSlotAnchorForEvent(view.players[playerIndex], event);
  }
  return undefined;
}

function attachedSourceAnchorForEvent(
  player: PlayerView | undefined,
  event: ActionTimelineEvent,
  fromArea: number,
): AnimationAnchorRef | undefined {
  if (!player) {
    return undefined;
  }
  const params = event.params as Record<string, unknown> | undefined;
  const serial = finiteNumber(params?.serial);
  const cardId = finiteNumber(params?.cardId);
  const matches = (card: CardView) =>
    (serial !== undefined && card.serial === serial)
    || (serial === undefined && cardId !== undefined && card.id === cardId);
  const slots: Array<{ slot: PokemonSlotView; kind: 'active' | 'bench' }> = [
    { slot: player.active, kind: 'active' },
    ...player.bench.map((slot) => ({ slot, kind: 'bench' as const })),
  ];
  for (const { slot, kind } of slots) {
    const cards = fromArea === CabtAreaType.ENERGY ? slot.energy : slot.tools;
    if (cards.some(matches)) {
      return {
        kind: fromArea === CabtAreaType.ENERGY ? 'attached-energy' : 'attached-tool',
        playerIndex: player.index,
        slot: kind,
        slotIndex: slot.index,
        serial,
      };
    }
  }
  return undefined;
}

function attachedIdentityKind(fromArea: number): AnimationIdentity['kind'] | undefined {
  if (fromArea === CabtAreaType.ENERGY) {
    return 'energy';
  }
  if (fromArea === CabtAreaType.TOOL) {
    return 'tool';
  }
  return undefined;
}

function boardMoveTargetAnchor(
  phase: AnimationEventPhase,
  view: GameView,
  event: ActionTimelineEvent,
  toArea: number,
): AnimationAnchorRef | undefined {
  const playerIndex = event.playerIndex;
  if (playerIndex === undefined) {
    return undefined;
  }
  if (toArea === CabtAreaType.DECK) {
    return { kind: 'deck-top', playerIndex };
  }
  if (toArea === CabtAreaType.DISCARD) {
    const discard = view.players[playerIndex]?.discard ?? [];
    const card = discard.find((candidate) => eventCardMatches(candidate, event));
    if (card) {
      return { kind: 'discard-card', playerIndex, serial: card.serial };
    }
    return { kind: 'discard-pile', playerIndex };
  }
  if (toArea === CabtAreaType.HAND) {
    const params = event.params as Record<string, unknown> | undefined;
    if (Number(params?.fromArea) === CabtAreaType.DISCARD) {
      return { kind: 'hand', playerIndex };
    }
    const hand = view.players[playerIndex]?.hand ?? [];
    const handIndex = hand.findIndex((card) => eventCardMatches(card, event));
    const card = hand[handIndex];
    return handIndex < 0 || !card ? undefined : {
      kind: 'hand-card',
      playerIndex,
      handIndex,
      serial: card.serial,
    };
  }
  if (toArea === CabtAreaType.PRIZE) {
    return prizeDestinationAnchorForEvent(view, event, phase.events);
  }
  if (toArea === CabtAreaType.ACTIVE) {
    const reciprocal = reciprocalBoardPositionEvent(phase, event);
    if (reciprocal) {
      return boardSlotAnchorForEvent(view.players[playerIndex], reciprocal);
    }
    return { kind: 'board-slot', playerIndex, slot: 'active', slotIndex: 0 };
  }
  if (toArea === CabtAreaType.BENCH) {
    const reciprocal = reciprocalBoardPositionEvent(phase, event);
    if (reciprocal) {
      return boardSlotAnchorForEvent(view.players[playerIndex], reciprocal);
    }
    const destination = boardPokemonDestinationForEvent(view.players[playerIndex], event);
    if (destination) {
      return { kind: 'board-slot', playerIndex, slot: destination.kind, slotIndex: destination.slot.index };
    }
    const params = event.params as Record<string, unknown> | undefined;
    const benchIndex = finiteNumber(params?.toIndex) ?? finiteNumber(params?.index) ?? finiteNumber(params?.benchIndex);
    return benchIndex === undefined ? undefined : { kind: 'board-slot', playerIndex, slot: 'bench', slotIndex: benchIndex };
  }
  return undefined;
}

function prizeDestinationAnchorForEvent(
  view: GameView,
  event: ActionTimelineEvent,
  phaseEvents: ActionTimelineEvent[],
): AnimationAnchorRef | undefined {
  const playerIndex = event.playerIndex;
  if (playerIndex === undefined) {
    return undefined;
  }
  const params = event.params as Record<string, unknown> | undefined;
  const explicitIndex = finiteNumber(params?.toIndex)
    ?? finiteNumber(params?.index)
    ?? finiteNumber(params?.prizeIndex);
  if (explicitIndex !== undefined) {
    return { kind: 'prize-card', playerIndex, prizeIndex: explicitIndex };
  }

  const samePlayerPrizeEvents = phaseEvents.filter((candidate) => {
    const candidateParams = candidate.params as Record<string, unknown> | undefined;
    return candidate.playerIndex === playerIndex
      && isMoveCardKind(candidate.kind)
      && Number(candidateParams?.fromArea) === CabtAreaType.DECK
      && Number(candidateParams?.toArea) === CabtAreaType.PRIZE;
  });
  const eventIndex = samePlayerPrizeEvents.findIndex((candidate) => candidate.id === event.id);
  if (eventIndex < 0) {
    return undefined;
  }
  const prizesLeft = view.players[playerIndex]?.prizesLeft ?? 0;
  return {
    kind: 'prize-card',
    playerIndex,
    prizeIndex: Math.max(0, prizesLeft - samePlayerPrizeEvents.length + eventIndex),
  };
}

function reciprocalBoardPositionEvent(phase: AnimationEventPhase, event: ActionTimelineEvent): ActionTimelineEvent | undefined {
  const params = event.params as Record<string, unknown> | undefined;
  const fromArea = Number(params?.fromArea);
  const toArea = Number(params?.toArea);
  if (!isBoardPositionMove(fromArea, toArea)) {
    return undefined;
  }
  return phase.events.find((candidate) => {
    if (candidate === event || candidate.playerIndex !== event.playerIndex || !isMoveCardKind(candidate.kind)) {
      return false;
    }
    const candidateParams = candidate.params as Record<string, unknown> | undefined;
    return Number(candidateParams?.fromArea) === toArea
      && Number(candidateParams?.toArea) === fromArea;
  });
}

function boardSlotAnchorForEvent(player: PlayerView | undefined, event: ActionTimelineEvent): AnimationAnchorRef | undefined {
  const params = event.params as Record<string, unknown> | undefined;
  return boardSlotAnchorForPokemon(player, finiteNumber(params?.serial), finiteNumber(params?.cardId));
}

function boardSlotAnchorForPokemon(
  player: PlayerView | undefined,
  serial: number | undefined,
  cardId: number | undefined,
): AnimationAnchorRef | undefined {
  if (!player) {
    return undefined;
  }
  const matches = (slot: PokemonSlotView) =>
    (serial !== undefined && slot.pokemon?.serial === serial)
    || (serial === undefined && cardId !== undefined && slot.pokemon?.id === cardId);
  if (matches(player.active)) {
    return { kind: 'board-slot', playerIndex: player.index, slot: 'active', slotIndex: player.active.index };
  }
  const benchSlot = player.bench.find(matches);
  return benchSlot ? { kind: 'board-slot', playerIndex: player.index, slot: 'bench', slotIndex: benchSlot.index } : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function animationIdentityForEvent(event: ActionTimelineEvent, kind: AnimationIdentity['kind']): AnimationIdentity {
  const params = event.params as Record<string, unknown> | undefined;
  return {
    kind,
    serial: finiteNumber(params?.serial),
    cardId: finiteNumber(params?.cardId),
    name: stringValue(params?.cardName),
  };
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function abilityNameForEvent(event: ActionTimelineEvent): string {
  const params = event.params as Record<string, unknown> | undefined;
  const explicit = typeof params?.abilityName === 'string' ? params.abilityName.trim() : '';
  if (explicit) {
    return explicit;
  }
  const match = event.message.match(/\bused\s+(.+?)\s+with\b/i);
  return match?.[1] ?? 'Ability';
}

function attackNameForEvent(event: ActionTimelineEvent): string {
  const match = event.message.match(/\bused\s+(.+?)\s+with\b/i);
  return match?.[1] ?? 'Attack';
}

function damageValueForEvent(event: ActionTimelineEvent): number {
  const params = event.params as Record<string, unknown> | undefined;
  const value = Number(params?.value);
  return Number.isFinite(value) ? Math.abs(Math.min(0, value)) : 0;
}

function coinResultLabel(event: ActionTimelineEvent): string {
  const params = event.params as Record<string, unknown> | undefined;
  if (params?.head === true) {
    return 'Heads';
  }
  if (params?.head === false) {
    return 'Tails';
  }
  return 'Coin';
}

function conditionPulseLabel(event: ActionTimelineEvent): string {
  const params = event.params as Record<string, unknown> | undefined;
  if (params?.isRecover) {
    return event.kind === 'Asleep' ? 'Awake' : 'Recovered';
  }
  return event.kind ?? 'Condition';
}

function boardPokemonDestinationForEvent(
  player: PlayerView | undefined,
  event: ActionTimelineEvent,
): { kind: 'active' | 'bench'; slot: PokemonSlotView } | undefined {
  if (!player) {
    return undefined;
  }
  if (player.active.pokemon && eventCardMatches(player.active.pokemon, event)) {
    return { kind: 'active', slot: player.active };
  }
  const benchSlot = player.bench.find((slot) => slot.pokemon && eventCardMatches(slot.pokemon, event));
  return benchSlot ? { kind: 'bench', slot: benchSlot } : undefined;
}

type MaybeAnimationMotionGroup = AnimationMotion | AnimationMotion[] | null | undefined;

function animationSourceViewForPhase(
  phaseStartView: GameView,
  currentView: GameView,
  phase: AnimationEventPhase,
): GameView {
  switch (phase.kind) {
    case 'Evolve':
      return handPlaySourceView(phaseStartView, currentView, phase);
    case 'Ability':
    case 'Attack':
    case 'Change':
    case 'Devolve':
    case 'MoveAttached':
    case 'Condition':
    case 'Damage':
      return projectedViewForEvents(phaseStartView, currentView, phase.events, { deferBoardStateEvents: true });
    case 'KnockOut':
    case 'BoardToDeck':
    case 'StadiumMove':
      return projectedViewForEvents(phaseStartView, currentView, phase.events, { deferMoveCardEvents: true });
    case 'BoardMove':
      return boardMoveSourceView(
        projectedViewForEvents(phaseStartView, currentView, phase.events, {
          deferBoardStateEvents: true,
          deferMoveCardEvents: true,
        }),
        phaseStartView,
        currentView,
      );
    case 'AttachedMove':
      if (phase.events.some(isAttachedToHandMoveEvent)) {
        return attachedToHandSourceView(phaseStartView, currentView, phase);
      }
      return projectedViewForEvents(phaseStartView, currentView, phase.events, { deferMoveCardEvents: true });
    case 'PrizeTake':
      return prizeTakeSourceView(phaseStartView, currentView, phase);
    case 'Play':
    case 'HandMove':
    case 'Attach':
      return handPlaySourceView(phaseStartView, currentView, phase);
    case 'Coin':
    case 'DeckBoardPlace':
    case 'DeckDiscard':
    case 'DeckPrizePlace':
    case 'DeckReveal':
    case 'DeckRevealReturn':
    case 'DeckRevealTake':
    case 'DeckSearchReveal':
    case 'DiscardRecover':
    case 'Draw':
    case 'HandToDeck':
    case 'Shuffle':
      return phaseStartView;
  }
  return assertUnhandledActionAnimationPhaseKind(phase.kind);
}

function assertUnhandledActionAnimationPhaseKind(kind: never): never {
  throw new Error(`Unhandled replay animation phase kind: ${kind}`);
}

function handPlaySourceView(
  phaseStartView: GameView,
  currentView: GameView,
  phase: AnimationEventPhase,
): GameView {
  const plannedEvents = phase.events
    .filter(isPlannedHandPlayMoveEvent)
    .filter((event) => handDestinationAnchorForEvent(phaseStartView, event));
  const usesFinalDestination = plannedEvents.some((event) => isMoveCardKind(event.kind) || event.kind === 'Attach');
  const phaseView = usesFinalDestination ? currentView : phaseStartView;
  const playerIndexes = new Set(
    plannedEvents.map((event) => event.playerIndex)
      .filter((playerIndex): playerIndex is number => playerIndex !== undefined),
  );
  if (!playerIndexes.size) {
    return projectedViewForEvents(phaseStartView, currentView, phase.events);
  }
  return {
    ...phaseView,
    players: phaseView.players.map((phasePlayer, playerIndex) => {
      if (!playerIndexes.has(playerIndex)) {
        return phasePlayer;
      }
      const phaseStartPlayer = phaseStartView.players[playerIndex] ?? phasePlayer;
      const currentPlayer = currentView.players[playerIndex] ?? phasePlayer;
      const playEvents = plannedEvents.filter((event) => event.playerIndex === playerIndex && event.kind === 'Play');
      if (!usesFinalDestination && playEvents.length) {
        return playEvents.reduce((player, event) => applyHandPlayDestination(player, currentPlayer, event), {
          ...phasePlayer,
          hand: phaseStartPlayer.hand,
        });
      }
      return {
        ...phasePlayer,
        hand: phaseStartPlayer.hand,
      };
    }),
  };
}

function applyHandPlayDestination(player: PlayerView, currentPlayer: PlayerView, event: ActionTimelineEvent): PlayerView {
  const params = event.params as Record<string, unknown> | undefined;
  const cardId = finiteNumber(params?.cardId);
  if (cardId !== undefined && isCabtStadiumCard(cardId)) {
    return {
      ...player,
      stadium: currentPlayer.stadium,
    };
  }
  if (playerHasCardInPlay(currentPlayer, event)) {
    return {
      ...player,
      active: currentPlayer.active,
      bench: currentPlayer.bench,
      stadium: currentPlayer.stadium,
      playZone: currentPlayer.playZone,
    };
  }
  return player;
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

function attachedToHandSourceView(
  phaseStartView: GameView,
  currentView: GameView,
  phase: AnimationEventPhase,
): GameView {
  const sourceView = projectedViewForEvents(phaseStartView, currentView, phase.events, { deferMoveCardEvents: true });
  return {
    ...sourceView,
    players: sourceView.players.map((player, playerIndex) => {
      const currentPlayer = currentView.players[playerIndex];
      if (!currentPlayer || !phase.events.some((event) => event.playerIndex === playerIndex && isAttachedToHandMoveEvent(event))) {
        return player;
      }
      return {
        ...player,
        hand: currentPlayer.hand,
      };
    }),
  };
}

function prizeTakeSourceView(
  phaseStartView: GameView,
  currentView: GameView,
  phase: AnimationEventPhase,
): GameView {
  const sourceView = projectedViewForEvents(phaseStartView, currentView, phase.events, { deferMoveCardEvents: true });
  return {
    ...sourceView,
    players: sourceView.players.map((player, playerIndex) => {
      const currentPlayer = currentView.players[playerIndex];
      if (!currentPlayer || !phase.events.some((event) => event.playerIndex === playerIndex && isPrizeToHandMoveEvent(event))) {
        return player;
      }
      return {
        ...player,
        hand: currentPlayer.hand,
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

const resolvingDiscardHandoffGapMs = 24;

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
        if (phase.kind !== 'KnockOut') {
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

function resolvingDiscardCardMoveMotions(
  phase: AnimationEventPhase,
  resolving: ResolvingPlayedCard[],
  startBaseMs: number,
): AnimationMotion[] {
  return resolving.map((entry, index) =>
    resolvingDiscardCardMoveMotion(phase, entry, startBaseMs + index * actionAnimationTiming.handMoveStepMs));
}

function resolvingDiscardCardMoveMotion(
  phase: Pick<ReplayAnimationPhase, 'key'>,
  entry: ResolvingPlayedCard,
  startMs: number,
): AnimationMotion {
  const serial = entry.card.serial;
  const cardId = entry.card.id;
  const sourceAnchor: AnimationAnchorRef = { kind: 'play-zone-card', playerIndex: entry.playerIndex, serial };
  return {
    id: `${phase.key}:resolving-discard:${entry.playerIndex}:${serial ?? cardId ?? 'unknown'}`,
    kind: 'card-move',
    purpose: 'resolving-cleanup',
    identity: {
      kind: 'card',
      serial,
      cardId,
      name: entry.card.name,
    },
    sourceAnchor,
    targetAnchor: { kind: 'discard-card', playerIndex: entry.playerIndex, serial },
    coordinateSpace: 'board',
    startMs,
    durationMs: actionAnimationTiming.boardMoveMs,
    spriteVisual: {
      kind: 'card',
      card: entry.card,
    },
    handoffPolicy: {
      hideSourceUntil: 'scope-exit',
      hideDestinationUntil: 'prepaint',
      removeSprite: 'prepaint',
      prepaintFrames: 2,
    },
  };
}

function isRevealSourceEvent(event: ActionTimelineEvent, playerIndex: number): boolean {
  const params = event.params as Record<string, unknown> | undefined;
  return event.playerIndex === playerIndex
    && isMoveCardKind(event.kind)
    && Number(params?.fromArea) === CabtAreaType.DECK
    && (
      Number(params?.toArea) === CabtAreaType.LOOKING
      || Number(params?.toArea) === CabtAreaType.HAND
    );
}

function isDeckToHandSearchEvent(event: ActionTimelineEvent, playerIndex: number): boolean {
  const params = event.params as Record<string, unknown> | undefined;
  return event.playerIndex === playerIndex
    && isMoveCardKind(event.kind)
    && Number(params?.fromArea) === CabtAreaType.DECK
    && Number(params?.toArea) === CabtAreaType.HAND;
}

function isRevealReturnEvent(event: ActionTimelineEvent, playerIndex: number): boolean {
  const params = event.params as Record<string, unknown> | undefined;
  return event.playerIndex === playerIndex
    && isMoveCardKind(event.kind)
    && Number(params?.fromArea) === CabtAreaType.LOOKING
    && Number(params?.toArea) === CabtAreaType.DECK;
}

function isRevealTakeEvent(event: ActionTimelineEvent, playerIndex: number): boolean {
  const params = event.params as Record<string, unknown> | undefined;
  return event.playerIndex === playerIndex
    && isMoveCardKind(event.kind)
    && Number(params?.fromArea) === CabtAreaType.LOOKING
    && Number(params?.toArea) === CabtAreaType.HAND;
}

function isRevealAttachEvent(
  event: ActionTimelineEvent,
  playerIndex: number,
  revealIndexes: ReadonlyMap<number, number>,
): boolean {
  const serial = finiteNumber((event.params as Record<string, unknown> | undefined)?.serial);
  return event.playerIndex === playerIndex
    && event.kind === 'Attach'
    && serial !== undefined
    && revealIndexes.has(serial);
}

function isAttachedToHandMoveEvent(event: ActionTimelineEvent): boolean {
  const params = event.params as Record<string, unknown> | undefined;
  return isMoveCardKind(event.kind)
    && isAttachedCardArea(Number(params?.fromArea))
    && Number(params?.toArea) === CabtAreaType.HAND;
}

function isHandToDeckMoveEvent(event: ActionTimelineEvent): boolean {
  const params = event.params as Record<string, unknown> | undefined;
  return isMoveCardKind(event.kind)
    && event.playerIndex !== undefined
    && Number(params?.fromArea) === CabtAreaType.HAND
    && Number(params?.toArea) === CabtAreaType.DECK
    && finiteNumber(params?.serial) !== undefined
    && finiteNumber(params?.cardId) !== undefined;
}

function isPlannedHandPlayMoveEvent(event: ActionTimelineEvent): boolean {
  if (event.playerIndex === undefined) {
    return false;
  }
  if (event.kind === 'Play') {
    return finiteNumber((event.params as Record<string, unknown> | undefined)?.cardId) !== undefined;
  }
  if (event.kind === 'Attach') {
    const params = event.params as Record<string, unknown> | undefined;
    return finiteNumber(params?.serial) !== undefined
      && finiteNumber(params?.cardId) !== undefined;
  }
  if (event.kind === 'Evolve') {
    const params = event.params as Record<string, unknown> | undefined;
    return finiteNumber(params?.serial) !== undefined
      && finiteNumber(params?.cardId) !== undefined
      && finiteNumber(params?.serialTarget) !== undefined
      && finiteNumber(params?.cardIdTarget) !== undefined;
  }
  if (!isMoveCardKind(event.kind)) {
    return false;
  }
  const params = event.params as Record<string, unknown> | undefined;
  const fromArea = Number(params?.fromArea);
  const toArea = Number(params?.toArea);
  return fromArea === CabtAreaType.HAND
    && (
      toArea === CabtAreaType.DISCARD
      || toArea === CabtAreaType.ACTIVE
      || toArea === CabtAreaType.BENCH
    )
    && finiteNumber(params?.serial) !== undefined
    && finiteNumber(params?.cardId) !== undefined;
}

function isPrizeToHandMoveEvent(event: ActionTimelineEvent): boolean {
  const params = event.params as Record<string, unknown> | undefined;
  return isMoveCardKind(event.kind)
    && Number(params?.fromArea) === CabtAreaType.PRIZE
    && Number(params?.toArea) === CabtAreaType.HAND;
}

function isKnockOutEvent(event: ActionTimelineEvent): boolean {
  const params = event.params as Record<string, unknown> | undefined;
  return isMoveCardKind(event.kind)
    && isKnockOutMove(Number(params?.fromArea), Number(params?.toArea));
}
