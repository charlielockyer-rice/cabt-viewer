import { describe, expect, it } from 'vitest';
import {
  createReplayAnimationPhasePlan,
  replayAnimationMotionSpanMs,
  replayAnimationMotionTimings,
  replayAnimationPhasePlanDurationMs,
  type AnimationMotion,
} from './replayAnimationPlan';
import type { GameView } from '../game/types';

describe('replay animation phase plans', () => {
  it('uses explicit motion timing as the animation contract', () => {
    const motions: AnimationMotion[] = [
      cardMoveMotion('play-card', 120, 360),
      cardMoveMotion('resolve-card', 640, 300),
    ];

    const plan = createReplayAnimationPhasePlan({
      key: 'FutureCardEffect:0',
      view: gameView(),
      durationMs: 980,
      motions,
    });

    expect(replayAnimationMotionTimings(plan)).toEqual([
      {
        id: 'play-card',
        startMs: 120,
        durationMs: 360,
        endMs: 480,
      },
      {
        id: 'resolve-card',
        startMs: 640,
        durationMs: 300,
        endMs: 940,
      },
    ]);
    expect(replayAnimationPhasePlanDurationMs(plan)).toBe(980);
  });

  it('computes the motion span from explicit start and duration fields', () => {
    expect(replayAnimationMotionSpanMs([
      cardMoveMotion('first', 0, 300),
      cardMoveMotion('second', 90, 520),
      cardMoveMotion('third', 700, 120),
    ])).toBe(820);
  });

  it('rejects a phase duration that cannot contain its explicit motions', () => {
    expect(() => createReplayAnimationPhasePlan({
      key: 'TooShort',
      view: gameView(),
      durationMs: 359,
      motions: [cardMoveMotion('move', 0, 360)],
    })).toThrow('shorter than motion span 360ms');
  });

  it('validates nested reveal session timing explicitly', () => {
    const plan = createReplayAnimationPhasePlan({
      key: 'DeckSearchReveal:0',
      view: gameView(),
      durationMs: 900,
      motions: [
        {
          id: 'pokegear-session',
          kind: 'reveal-session',
          playerIndex: 0,
          coordinateSpace: 'viewport',
          startMs: 0,
          durationMs: 900,
          handoffPolicy: {
            hideSourceUntil: 'snapshot',
            hideDestinationUntil: 'prepaint',
            removeSprite: 'prepaint',
            prepaintFrames: 2,
          },
          steps: [
            {
              id: 'reveal-seven',
              kind: 'reveal',
              startMs: 0,
              durationMs: 420,
            },
            {
              id: 'take-selected',
              kind: 'take',
              startMs: 540,
              durationMs: 260,
              targetAnchor: {
                kind: 'hand-slot',
                playerIndex: 0,
                handIndex: 3,
              },
            },
          ],
        },
      ],
    });

    expect(replayAnimationPhasePlanDurationMs(plan)).toBe(900);
  });

  it('rejects negative nested reveal session timing', () => {
    expect(() => createReplayAnimationPhasePlan({
      key: 'BadReveal',
      view: gameView(),
      durationMs: 100,
      motions: [
        {
          id: 'bad-session',
          kind: 'reveal-session',
          playerIndex: 0,
          coordinateSpace: 'viewport',
          startMs: 0,
          durationMs: 100,
          handoffPolicy: {
            hideSourceUntil: 'none',
            hideDestinationUntil: 'none',
            removeSprite: 'phase-end',
          },
          steps: [
            {
              id: 'bad-step',
              kind: 'reveal',
              startMs: -1,
              durationMs: 20,
            },
          ],
        },
      ],
    })).toThrow('bad-session.bad-step.startMs');
  });

  it('requires visibility claims to reference an owning motion', () => {
    expect(() => createReplayAnimationPhasePlan({
      key: 'BadClaim',
      view: gameView(),
      durationMs: 360,
      motions: [cardMoveMotion('move', 0, 360)],
      visibilityClaims: [
        {
          scopeKey: 'BadClaim',
          role: 'destination',
          anchor: { kind: 'discard-pile', playerIndex: 0 },
        },
      ],
    })).toThrow('missing a motion id');

    expect(() => createReplayAnimationPhasePlan({
      key: 'UnknownMotionClaim',
      view: gameView(),
      durationMs: 360,
      motions: [cardMoveMotion('move', 0, 360)],
      visibilityClaims: [
        {
          scopeKey: 'UnknownMotionClaim',
          motionId: 'other-move',
          role: 'destination',
          anchor: { kind: 'discard-pile', playerIndex: 0 },
        },
      ],
    })).toThrow('unknown motion "other-move"');
  });

  it('requires reveal-session visibility claims to reference an owning step', () => {
    expect(() => createReplayAnimationPhasePlan({
      key: 'BadRevealClaim',
      view: gameView(),
      durationMs: 900,
      motions: [revealSessionMotion()],
      visibilityClaims: [
        {
          scopeKey: 'BadRevealClaim',
          motionId: 'pokegear-session',
          role: 'destination',
          anchor: { kind: 'hand-slot', playerIndex: 0, handIndex: 3 },
        },
      ],
    })).toThrow('missing a step id');

    expect(() => createReplayAnimationPhasePlan({
      key: 'UnknownRevealStepClaim',
      view: gameView(),
      durationMs: 900,
      motions: [revealSessionMotion()],
      visibilityClaims: [
        {
          scopeKey: 'UnknownRevealStepClaim',
          motionId: 'pokegear-session',
          stepId: 'wrong-step',
          role: 'destination',
          anchor: { kind: 'hand-slot', playerIndex: 0, handIndex: 3 },
        },
      ],
    })).toThrow('unknown step "wrong-step"');
  });
});

function cardMoveMotion(id: string, startMs: number, durationMs: number): AnimationMotion {
  return {
    id,
    kind: 'card-move',
    startMs,
    durationMs,
    sourceAnchor: {
      kind: 'hand-card',
      playerIndex: 0,
      handIndex: 0,
      serial: 101,
    },
    targetAnchor: {
      kind: 'discard-pile',
      playerIndex: 0,
    },
    coordinateSpace: 'cross-plane',
    spriteVisual: {
      kind: 'anchor-snapshot',
      anchor: {
        kind: 'hand-card',
        playerIndex: 0,
        handIndex: 0,
        serial: 101,
      },
    },
    handoffPolicy: {
      hideSourceUntil: 'snapshot',
      hideDestinationUntil: 'prepaint',
      removeSprite: 'prepaint',
      prepaintFrames: 2,
    },
  };
}

function revealSessionMotion(): AnimationMotion {
  return {
    id: 'pokegear-session',
    kind: 'reveal-session',
    playerIndex: 0,
    coordinateSpace: 'viewport',
    startMs: 0,
    durationMs: 900,
    revealCount: 7,
    handoffPolicy: {
      hideSourceUntil: 'snapshot',
      hideDestinationUntil: 'prepaint',
      removeSprite: 'prepaint',
      prepaintFrames: 2,
    },
    steps: [
      {
        id: 'take-selected',
        kind: 'take',
        startMs: 540,
        durationMs: 260,
        targetAnchor: {
          kind: 'hand-slot',
          playerIndex: 0,
          handIndex: 3,
        },
        handoffPolicy: {
          hideSourceUntil: 'none',
          hideDestinationUntil: 'arrival',
          removeSprite: 'arrival',
        },
      },
    ],
  };
}

function gameView(): GameView {
  return {
    ready: true,
    phase: 0,
    phaseLabel: 'Test',
    turn: 1,
    activePlayerIndex: 0,
    players: [],
    prompts: [],
    logs: [],
    events: [],
  };
}
