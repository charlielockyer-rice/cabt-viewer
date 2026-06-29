import { describe, expect, it } from 'vitest';
import {
  isDeckRevealEvent,
  isRevealAttachEventForSerials,
  isRevealReturnEvent,
  isRevealTakeEvent,
  plannedRevealCards,
  revealCardActionForEvent,
  revealCardActionsForSteps,
  revealSessionMotions,
  revealSessionPlanKey,
  revealSessionPlanSteps,
  revealStartActionForEvent,
  revealStartActionsForSteps,
} from './revealSessionActions';
import type { RevealSessionAnimationMotion, ReplayAnimationPhasePlan } from './replayAnimationPlan';
import { CabtAreaType } from '../cabt/types';
import type { ActionTimelineEvent, GameView } from '../game/types';

describe('reveal session actions', () => {
  it('filters reveal session motions and builds a stable plan key', () => {
    const revealMotion = revealSessionMotion();
    const plan = {
      key: 'DeckReveal:0',
      kind: 'DeckReveal',
      playerIndex: 0,
      view: {} as GameView,
      durationMs: 1000,
      motions: [
        revealMotion,
        {
          id: 'shuffle',
          kind: 'shuffle',
          anchor: { kind: 'deck-top', playerIndex: 0 },
          coordinateSpace: 'board',
          startMs: 0,
          durationMs: 300,
        },
      ],
      visibilityClaims: [],
    } satisfies ReplayAnimationPhasePlan;

    expect(revealSessionMotions(plan)).toEqual([revealMotion]);
    expect(revealSessionPlanKey([revealMotion])).toBe('reveal-session:reveal-66,take-66,return-70');
  });

  it('derives reveal and selected-card actions from planned reveal steps', () => {
    const motion = revealSessionMotion();
    const steps = revealSessionPlanSteps([motion]);

    expect(revealStartActionsForSteps(steps, 1000)).toMatchObject([
      {
        id: 'reveal-66',
        playerIndex: 0,
        serial: 11,
        startMs: 100,
        toHand: false,
        card: { id: 66, serial: 11, playerIndex: 0 },
      },
    ]);
    expect(revealCardActionsForSteps(steps, 'take', 1000)).toMatchObject([
      {
        id: 'take-66',
        playerIndex: 0,
        serial: 11,
        startMs: 430,
        targetAnchor: { kind: 'hand-card', playerIndex: 0, handIndex: 2, serial: 11 },
      },
    ]);
    expect(revealCardActionsForSteps(steps, 'return', 1000)).toMatchObject([
      {
        id: 'return-70',
        playerIndex: 0,
        serial: 12,
        startMs: 460,
        targetAnchor: { kind: 'deck-top', playerIndex: 0 },
      },
    ]);
  });

  it('keeps direct deck-search take target anchors on planned start actions', () => {
    const motion = revealSessionMotion({
      steps: [
        {
          id: 'search-take-66',
          kind: 'take',
          sourceAnchor: { kind: 'deck-top', playerIndex: 0 },
          targetAnchor: { kind: 'hand-card', playerIndex: 0, handIndex: 2, serial: 11 },
          identity: { kind: 'card', cardId: 66, serial: 11 },
          spriteVisual: { kind: 'card', card: { id: 66, serial: 11, name: 'Lillie' } },
          startMs: 40,
          durationMs: 300,
        },
      ],
    });

    expect(revealStartActionsForSteps(revealSessionPlanSteps([motion]), 1000)).toMatchObject([
      {
        id: 'search-take-66',
        playerIndex: 0,
        serial: 11,
        identity: { kind: 'card', cardId: 66, serial: 11 },
        targetAnchor: { kind: 'hand-card', playerIndex: 0, handIndex: 2, serial: 11 },
        startMs: 140,
        toHand: true,
      },
    ]);
  });

  it('dedupes planned held cards by reveal anchor', () => {
    const motion = revealSessionMotion({
      steps: [
        {
          id: 'first',
          kind: 'select',
          sourceAnchor: { kind: 'reveal-card', playerIndex: 0, revealIndex: 0, serial: 11 },
          identity: { kind: 'card', cardId: 66, serial: 11 },
          startMs: 0,
          durationMs: 300,
        },
        {
          id: 'second',
          kind: 'take',
          sourceAnchor: { kind: 'reveal-card', playerIndex: 0, revealIndex: 0, serial: 11 },
          identity: { kind: 'card', cardId: 66, serial: 11 },
          startMs: 300,
          durationMs: 300,
        },
      ],
    });

    expect(plannedRevealCards([motion])).toHaveLength(1);
    expect(plannedRevealCards([motion])[0]).toMatchObject({
      step: { id: 'second' },
      anchor: { playerIndex: 0, revealIndex: 0, serial: 11 },
    });
  });

  it('derives live deck reveal start actions from CABT events', () => {
    const reveal = event(1, 'MoveCard', {
      playerIndex: 0,
      cardId: 66,
      serial: 11,
      fromArea: CabtAreaType.DECK,
      toArea: CabtAreaType.LOOKING,
    });
    const directTake = event(2, 'MoveCard', {
      playerIndex: 0,
      cardId: 70,
      serial: 12,
      fromArea: CabtAreaType.DECK,
      toArea: CabtAreaType.HAND,
    });

    expect(isDeckRevealEvent(reveal)).toBe(true);
    expect(isDeckRevealEvent(directTake)).toBe(true);
    expect(revealStartActionForEvent(reveal, [reveal])).toMatchObject({
      id: '1',
      playerIndex: 0,
      card: { id: 66, serial: 11, playerIndex: 0 },
      serial: 11,
      startMs: 0,
      toHand: false,
    });
    expect(revealStartActionForEvent(directTake, [directTake])).toMatchObject({
      id: '2',
      serial: 12,
      toHand: true,
    });
  });

  it('derives live reveal follow-up actions from CABT events', () => {
    const attach = event(3, 'Attach', {
      playerIndex: 0,
      serial: 11,
      serialTarget: 64,
      cardIdTarget: 721,
      targetAnchor: { kind: 'pokemon-card', playerIndex: 0, slot: 'active', slotIndex: 0, serial: 64 },
    });
    const take = event(4, 'MoveCard', {
      playerIndex: 0,
      serial: 12,
      fromArea: CabtAreaType.LOOKING,
      toArea: CabtAreaType.HAND,
    });
    const returned = event(5, 'MoveCard', {
      playerIndex: 0,
      serial: 13,
      fromArea: CabtAreaType.LOOKING,
      toArea: CabtAreaType.DECK,
    });

    expect(isRevealAttachEventForSerials(attach, new Set([11]))).toBe(true);
    expect(isRevealAttachEventForSerials(attach, new Set([12]))).toBe(false);
    expect(isRevealTakeEvent(take)).toBe(true);
    expect(isRevealReturnEvent(returned)).toBe(true);
    expect(revealCardActionForEvent(attach, [attach])).toMatchObject({
      id: '3',
      playerIndex: 0,
      serial: 11,
      serialTarget: 64,
      cardIdTarget: 721,
      targetAnchor: { kind: 'pokemon-card', slot: 'active', slotIndex: 0, serial: 64 },
    });
  });
});

function event(id: number, kind: string, params: Record<string, unknown>): ActionTimelineEvent {
  return {
    id,
    message: kind,
    kind,
    playerIndex: typeof params.playerIndex === 'number' ? params.playerIndex : undefined,
    params,
  };
}

function revealSessionMotion(
  overrides: Partial<RevealSessionAnimationMotion> = {},
): RevealSessionAnimationMotion {
  return {
    id: 'reveal-session',
    kind: 'reveal-session',
    playerIndex: 0,
    coordinateSpace: 'viewport',
    startMs: 100,
    durationMs: 800,
    revealCount: 2,
    handoffPolicy: {
      hideSourceUntil: 'none',
      hideDestinationUntil: 'none',
      removeSprite: 'phase-end',
    },
    steps: [
      {
        id: 'reveal-66',
        kind: 'reveal',
        targetAnchor: { kind: 'reveal-card', playerIndex: 0, revealIndex: 0, serial: 11 },
        identity: { kind: 'card', cardId: 66, serial: 11 },
        spriteVisual: { kind: 'card', card: { id: 66, serial: 11, name: 'Dudunsparce' } },
        startMs: 0,
        durationMs: 320,
      },
      {
        id: 'take-66',
        kind: 'take',
        sourceAnchor: { kind: 'reveal-card', playerIndex: 0, revealIndex: 0, serial: 11 },
        targetAnchor: { kind: 'hand-card', playerIndex: 0, handIndex: 2, serial: 11 },
        identity: { kind: 'card', cardId: 66, serial: 11 },
        startMs: 330,
        durationMs: 300,
      },
      {
        id: 'return-70',
        kind: 'return',
        sourceAnchor: { kind: 'reveal-card', playerIndex: 0, revealIndex: 1, serial: 12 },
        targetAnchor: { kind: 'deck-top', playerIndex: 0 },
        identity: { kind: 'card', cardId: 70, serial: 12 },
        startMs: 360,
        durationMs: 300,
      },
    ],
    ...overrides,
  };
}
