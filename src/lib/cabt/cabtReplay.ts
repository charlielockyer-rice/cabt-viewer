import { cabtLogsToTimeline, formatCabtLog } from './logFormat';
import {
  persistentActionLabel,
  replayActionGroups,
  type ReplayActionGroup,
} from './replayActionGroups';
import {
  cardEffectContinuation,
  type ReplayFrameEntry,
} from './replayContinuations';
import {
  resolvingContextForStep,
  resolvingDisplayView,
  resolvingFinalizerCardsForGroup,
  resolvingPlayedCardsForEvents,
  type ResolvingPlayedCard,
  type ResolvingPlayedCardContext,
} from './replayResolvingCards';
import {
  applyReplayEvent,
  shouldProjectSingleGroup,
} from './replayProjection';
import { cabtCardNames } from './replayCardData';
import {
  extractVisualizeFrames,
  replayEnvironment,
  replayPlayerNames,
  type CabtVisualizeFrame,
} from './replayInput';
import { logsWithSynthesizedAbility } from './replaySyntheticLogs';
import {
  groupedStepAnimationPhases,
  shouldBuildGroupedStepAnimationPhases,
} from './replayGroupedAnimationPhases';
import { cabtReplayStepLabel } from './replayStepLabels';
import { frameToGameView } from './replayView';
import { applyKnockOutDiscardTopOrdering } from './replayResolvingDiscardMotions';
import { type ActionTimelineEvent, type GameView, type LogView, type PokemonSlotView } from '../game/types';
import type { ReplaySnapshot, ReplayStep } from '../game/replay';

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
