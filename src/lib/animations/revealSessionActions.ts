import { replayAnimationSpriteRemovalMs } from './replayAnimationHandoff';
import type {
  AnimationAnchorRef,
  AnimationIdentity,
  RevealSessionAnimationMotion,
  RevealSessionStep,
  ReplayAnimationPhasePlan,
} from './replayAnimationPlan';
import { replayAnimationPlanOwnsMotion } from './replayAnimationPlan';
import { actionAnimationStartMs } from '../cabt/actionAnimationSchedule';
import { cabtCardToView } from '../cabt/cardView';
import { replayEventMoveAreas } from '../cabt/replayEventAreas';
import { finiteNumber } from '../cabt/replayEventParams';
import { CabtAreaType } from '../cabt/types';
import type { ActionTimelineEvent, CardView } from '../game/types';

export type RevealCardAnchor = Extract<NonNullable<RevealSessionStep['sourceAnchor']>, { kind: 'reveal-card' }>;

export type RevealStepAction = {
  motion: RevealSessionAnimationMotion;
  step: RevealSessionStep;
};

export type RevealStartAction = {
  id: string;
  playerIndex: number;
  card: CardView;
  serial?: number;
  identity?: AnimationIdentity;
  sourceAnchor?: RevealSessionStep['sourceAnchor'];
  targetAnchor?: RevealSessionStep['targetAnchor'];
  startMs: number;
  toHand: boolean;
  removeMs?: number;
};

export type RevealCardAction = {
  id: string;
  playerIndex: number;
  serial: number;
  identity?: AnimationIdentity;
  startMs: number;
  sourceAnchor?: RevealSessionStep['sourceAnchor'];
  targetAnchor?: RevealSessionStep['targetAnchor'];
  removeMs?: number;
};

export type LiveRevealCardAction = RevealCardAction & {
  serialTarget?: number;
  cardIdTarget?: number;
};

export type PlannedRevealCard = {
  motion: RevealSessionAnimationMotion;
  step: RevealSessionStep;
  anchor: RevealCardAnchor;
};

export function revealSessionMotions(plan: ReplayAnimationPhasePlan | undefined): RevealSessionAnimationMotion[] {
  return (plan?.motions ?? []).filter((motion): motion is RevealSessionAnimationMotion =>
    motion.kind === 'reveal-session'
    && motion.coordinateSpace === 'viewport'
    && replayAnimationPlanOwnsMotion(plan, motion, [
      'Attach',
      'DeckReveal',
      'DeckSearchReveal',
      'DeckRevealReturn',
      'DeckRevealTake',
    ]),
  );
}

export function revealSessionPlanKey(motions: RevealSessionAnimationMotion[]): string {
  return motions
    .map((motion) => `${motion.id}:${motion.steps.map((step) => step.id).join(',')}`)
    .join('|');
}

export function revealSessionPlanSteps(motions: RevealSessionAnimationMotion[]): RevealStepAction[] {
  return motions.flatMap((motion) =>
    motion.steps.map((step) => ({ motion, step })),
  );
}

export function revealStartActionsForSteps(
  stepActions: RevealStepAction[],
  planDurationMs: number | undefined,
): RevealStartAction[] {
  return stepActions.flatMap(({ motion, step }) => {
    if (step.kind !== 'reveal' && !(step.kind === 'take' && step.sourceAnchor?.kind === 'deck-top')) {
      return [];
    }
    const anchor = revealCardAnchorsForStep(step).at(0);
    const card = cardViewForRevealStep(motion, step, anchor);
    if (!card) {
      return [];
    }
    return [{
      id: step.id,
      playerIndex: motion.playerIndex,
      card,
      serial: step.identity?.serial ?? card.serial,
      identity: step.identity,
      sourceAnchor: step.sourceAnchor,
      targetAnchor: step.targetAnchor,
      startMs: motion.startMs + step.startMs,
      toHand: step.kind === 'take',
      removeMs: removalMsForStep(motion, step, planDurationMs),
    }];
  });
}

export function revealCardActionsForSteps(
  stepActions: RevealStepAction[],
  kind: RevealSessionStep['kind'],
  planDurationMs: number | undefined,
): RevealCardAction[] {
  return stepActions.flatMap(({ motion, step }) => {
    if (step.kind !== kind) {
      return [];
    }
    const serial = step.identity?.serial
      ?? (step.spriteVisual?.kind === 'card' ? step.spriteVisual.card?.serial : undefined);
    if (serial === undefined || !Number.isFinite(serial)) {
      return [];
    }
    return [{
      id: step.id,
      playerIndex: motion.playerIndex,
      serial,
      identity: step.identity,
      startMs: motion.startMs + step.startMs,
      sourceAnchor: step.sourceAnchor,
      targetAnchor: step.targetAnchor,
      removeMs: removalMsForStep(motion, step, planDurationMs),
    }];
  });
}

export function plannedRevealCards(motions: RevealSessionAnimationMotion[]): PlannedRevealCard[] {
  const cards = new Map<string, PlannedRevealCard>();
  for (const motion of motions) {
    for (const step of motion.steps) {
      for (const anchor of revealCardAnchorsForStep(step)) {
        cards.set(`${anchor.playerIndex}:${anchor.revealIndex}:${anchor.serial ?? ''}`, {
          motion,
          step,
          anchor,
        });
      }
    }
  }
  return Array.from(cards.values()).sort((left, right) =>
    left.anchor.playerIndex - right.anchor.playerIndex
    || left.anchor.revealIndex - right.anchor.revealIndex,
  );
}

export function isDeckRevealEvent(event: ActionTimelineEvent): boolean {
  const cardId = finiteNumber((event.params as Record<string, unknown> | undefined)?.cardId);
  const areas = replayEventMoveAreas(event);
  return event.kind === 'MoveCard'
    && areas?.fromArea === CabtAreaType.DECK
    && (areas.toArea === CabtAreaType.LOOKING || areas.toArea === CabtAreaType.HAND)
    && cardId !== undefined;
}

export function isRevealAttachEventForSerials(
  event: ActionTimelineEvent,
  revealedSerials: ReadonlySet<number>,
): boolean {
  const serial = finiteNumber((event.params as Record<string, unknown> | undefined)?.serial);
  return event.kind === 'Attach'
    && serial !== undefined
    && revealedSerials.has(serial);
}

export function isRevealReturnEvent(event: ActionTimelineEvent): boolean {
  const serial = finiteNumber((event.params as Record<string, unknown> | undefined)?.serial);
  const areas = replayEventMoveAreas(event);
  return event.kind === 'MoveCard'
    && areas?.fromArea === CabtAreaType.LOOKING
    && areas.toArea === CabtAreaType.DECK
    && serial !== undefined;
}

export function isRevealTakeEvent(event: ActionTimelineEvent): boolean {
  const serial = finiteNumber((event.params as Record<string, unknown> | undefined)?.serial);
  const areas = replayEventMoveAreas(event);
  return event.kind === 'MoveCard'
    && areas?.fromArea === CabtAreaType.LOOKING
    && areas.toArea === CabtAreaType.HAND
    && serial !== undefined;
}

export function revealStartActionForEvent(
  event: ActionTimelineEvent,
  animationEvents: readonly ActionTimelineEvent[],
): RevealStartAction | undefined {
  const params = event.params as Record<string, unknown> | undefined;
  const cardId = finiteNumber(params?.cardId);
  if (event.playerIndex === undefined || cardId === undefined) {
    return undefined;
  }
  const serial = finiteNumber(params?.serial);
  const areas = replayEventMoveAreas(event);
  return {
    id: String(event.id),
    playerIndex: event.playerIndex,
    card: {
      ...cabtCardToView(cardId),
      serial,
      playerIndex: event.playerIndex,
    },
    serial,
    startMs: actionAnimationStartMs(animationEvents, event),
    toHand: areas?.toArea === CabtAreaType.HAND,
  };
}

export function revealCardActionForEvent(
  event: ActionTimelineEvent,
  animationEvents: readonly ActionTimelineEvent[],
): LiveRevealCardAction | undefined {
  const params = event.params as Record<string, unknown> | undefined;
  const serial = finiteNumber(params?.serial);
  if (event.playerIndex === undefined || serial === undefined) {
    return undefined;
  }
  return {
    id: String(event.id),
    playerIndex: event.playerIndex,
    serial,
    startMs: actionAnimationStartMs(animationEvents, event),
    targetAnchor: params?.targetAnchor as AnimationAnchorRef | undefined,
    serialTarget: finiteNumber(params?.serialTarget),
    cardIdTarget: finiteNumber(params?.cardIdTarget),
  };
}

export function revealCardAnchorsForStep(step: RevealSessionStep): RevealCardAnchor[] {
  return [step.sourceAnchor, step.targetAnchor].filter((anchor): anchor is RevealCardAnchor =>
    anchor?.kind === 'reveal-card',
  );
}

export function revealCountForMotion(motion: RevealSessionAnimationMotion): number {
  if (Number.isFinite(motion.revealCount) && (motion.revealCount ?? 0) > 0) {
    return motion.revealCount ?? 1;
  }
  const maxRevealIndex = motion.steps
    .flatMap(revealCardAnchorsForStep)
    .reduce((maxIndex, anchor) => Math.max(maxIndex, anchor.revealIndex), -1);
  return Math.max(1, maxRevealIndex + 1);
}

export function cardViewForRevealStep(
  motion: RevealSessionAnimationMotion,
  step: RevealSessionStep,
  anchor?: RevealCardAnchor,
): CardView | undefined {
  const spriteCard = step.spriteVisual?.kind === 'card' ? step.spriteVisual.card : undefined;
  const cardId = step.identity?.cardId ?? spriteCard?.id;
  if (!Number.isFinite(Number(cardId))) {
    return undefined;
  }
  return {
    ...cabtCardToView(Number(cardId)),
    serial: step.identity?.serial ?? spriteCard?.serial ?? anchor?.serial,
    playerIndex: motion.playerIndex,
  };
}

function removalMsForStep(
  motion: RevealSessionAnimationMotion,
  step: RevealSessionStep,
  planDurationMs: number | undefined,
): number | undefined {
  if (!step.handoffPolicy) {
    return undefined;
  }
  return replayAnimationSpriteRemovalMs({
    startMs: motion.startMs + step.startMs,
    durationMs: step.durationMs,
    handoffPolicy: step.handoffPolicy,
  }, planDurationMs);
}
