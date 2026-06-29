import {
  actionAnimationTiming,
  isAttachedCardArea,
  isKnockOutMove,
} from './actionAnimationPhases';
import { handDestinationAnchorForEvent } from './replayAnimationAnchors';
import { cabtLogsToTimeline, formatCabtLog } from './logFormat';
import {
  isMoveCardKind,
  persistentActionLabel,
  replayActionGroups,
  type ReplayActionGroup,
} from './replayActionGroups';
import { eventCardMatches, sameKnownCard } from './replayCardIdentity';
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
  isCabtStadiumCard,
} from './replayCardData';
import { finiteNumber } from './replayEventParams';
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
import { boardCardMoveMotions } from './replayBoardCardMotions';
import { revealSessionMotions } from './replayRevealSessionMotions';
import {
  drawCardMoveMotions,
  handPlayCardMoveMotions,
  handToDeckCardMoveMotions,
  isPlannedHandPlayMoveEvent,
  isPrizeToHandMoveEvent,
  prizeTakeCardMoveMotions,
} from './replayViewportCardMotions';
import { CabtAreaType } from './types';
import {
  createReplayAnimationPhasePlan,
  replayAnimationMotionSpanMs,
  type AnimationAnchorRef,
  type AnimationMotion,
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

function isAttachedToHandMoveEvent(event: ActionTimelineEvent): boolean {
  const params = event.params as Record<string, unknown> | undefined;
  return isMoveCardKind(event.kind)
    && isAttachedCardArea(Number(params?.fromArea))
    && Number(params?.toArea) === CabtAreaType.HAND;
}

function isKnockOutEvent(event: ActionTimelineEvent): boolean {
  const params = event.params as Record<string, unknown> | undefined;
  return isMoveCardKind(event.kind)
    && isKnockOutMove(Number(params?.fromArea), Number(params?.toArea));
}
