import {
  actionAnimationTiming,
  isAttachedCardArea,
  isKnockOutMove,
} from './actionAnimationPhases';
import { actionAnimationStartMs } from './actionAnimationSchedule';
import {
  boardMoveSourceAnchor,
  boardMoveTargetAnchor,
  boardSlotAnchorForPokemon,
  handDestinationAnchorForEvent,
  handPlayTargetAnchorForEvent,
  prizeSourceAnchorForEvent,
  revealAttachTargetAnchorForEvent,
} from './replayAnimationAnchors';
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
  cabtCardNames,
  cabtCardToView,
  isCabtPokemonCard,
  isCabtStadiumCard,
  isCabtToolCard,
} from './replayCardData';
import { finiteNumber, stringValue } from './replayEventParams';
import {
  extractVisualizeFrames,
  replayEnvironment,
  replayPlayerNames,
  type CabtVisualizeFrame,
} from './replayInput';
import { logsWithSynthesizedAbility } from './replaySyntheticLogs';
import {
  animationEventPhases,
  animationPhaseLabel,
  animationPhaseMayHavePlan,
  animationPhaseNeedsDedicatedView,
  type AnimationEventPhase,
} from './replayAnimationPhases';
import { cabtReplayStepLabel } from './replayStepLabels';
import { frameToGameView } from './replayView';
import {
  abilityPulseMotions,
  attackPulseMotions,
  boardMutationPulseMotions,
  changePulseMotions,
  coinPulseMotions,
  conditionPulseMotions,
  damagePulseMotions,
  shuffleMotions,
} from './replayPulseMotions';
import { CabtAreaType } from './types';
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

function attachedIdentityKind(fromArea: number): AnimationIdentity['kind'] | undefined {
  if (fromArea === CabtAreaType.ENERGY) {
    return 'energy';
  }
  if (fromArea === CabtAreaType.TOOL) {
    return 'tool';
  }
  return undefined;
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
