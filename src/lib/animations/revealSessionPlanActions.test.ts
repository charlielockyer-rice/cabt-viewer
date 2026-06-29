import { describe, expect, it } from 'vitest';
import {
  plannedRevealCards,
  revealCardActionsForSteps,
  revealSessionMotions,
  revealSessionPlanKey,
  revealSessionPlanSteps,
  revealStartActionsForSteps,
} from './revealSessionPlanActions';
import type { RevealSessionAnimationMotion, ReplayAnimationPhasePlan } from './replayAnimationPlan';

describe('reveal session plan actions', () => {
  it('filters reveal session motions and builds a stable plan key', () => {
    const revealMotion = revealSessionMotion();
    const plan = {
      key: 'DeckReveal:0',
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
    } as ReplayAnimationPhasePlan;

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
});

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
