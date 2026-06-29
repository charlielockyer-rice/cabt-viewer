import { describe, expect, it } from 'vitest';
import {
  replayAnimationClaimTiming,
  replayAnimationSpriteGroupRemovalMs,
  replayAnimationSpriteRemovalMs,
} from './replayAnimationHandoff';
import { createReplayAnimationPhasePlan, type AnimationMotion } from './replayAnimationPlan';
import type { GameView } from '../game/types';

describe('replay animation handoff timing', () => {
  it('releases prepaint destination claims when the moving sprite arrives', () => {
    const plan = planWithMotion(cardMoveMotion({
      id: 'draw-card',
      startMs: 100,
      durationMs: 250,
      hideDestinationUntil: 'prepaint',
    }));

    expect(replayAnimationClaimTiming(plan, {
      scopeKey: plan.key,
      motionId: 'draw-card',
      role: 'destination',
      anchor: { kind: 'hand-card', playerIndex: 0, handIndex: 2 },
      identity: { kind: 'card', serial: 11, cardId: 22 },
    })).toEqual({
      startMs: 0,
      releaseMs: 350,
    });
  });

  it('keeps scope-exit source claims until the animation scope changes', () => {
    const plan = planWithMotion(cardMoveMotion({
      id: 'bench-switch',
      startMs: 90,
      durationMs: 420,
      hideSourceUntil: 'scope-exit',
    }));

    expect(replayAnimationClaimTiming(plan, {
      scopeKey: plan.key,
      motionId: 'bench-switch',
      role: 'source',
      anchor: { kind: 'hand-card', playerIndex: 0, handIndex: 0 },
      identity: { kind: 'card', serial: 11, cardId: 22 },
    })).toEqual({
      startMs: 90,
      releaseMs: undefined,
    });
  });

  it('derives sprite removal timing from the same handoff policy', () => {
    expect(replayAnimationSpriteRemovalMs(cardMoveMotion({
      id: 'prepaint',
      startMs: 100,
      durationMs: 250,
      removeSprite: 'prepaint',
    }))).toBe(350);
    expect(replayAnimationSpriteRemovalMs(cardMoveMotion({
      id: 'arrival',
      startMs: 100,
      durationMs: 250,
      removeSprite: 'arrival',
    }))).toBe(374);
    expect(replayAnimationSpriteRemovalMs(cardMoveMotion({
      id: 'phase-end',
      startMs: 100,
      durationMs: 250,
      removeSprite: 'phase-end',
    }), 900)).toBe(900);
    expect(replayAnimationSpriteRemovalMs(cardMoveMotion({
      id: 'scope-exit',
      startMs: 100,
      durationMs: 250,
      removeSprite: 'scope-exit',
    }))).toBeUndefined();
  });

  it('keeps grouped planned sprites until scope exit when any sprite is scope-owned', () => {
    expect(replayAnimationSpriteGroupRemovalMs([
      cardMoveMotion({
        id: 'arrival',
        startMs: 100,
        durationMs: 250,
        removeSprite: 'arrival',
      }),
      cardMoveMotion({
        id: 'scope-exit',
        startMs: 300,
        durationMs: 250,
        removeSprite: 'scope-exit',
      }),
    ], 900)).toBeUndefined();

    expect(replayAnimationSpriteGroupRemovalMs([
      cardMoveMotion({
        id: 'arrival',
        startMs: 100,
        durationMs: 250,
        removeSprite: 'arrival',
      }),
      cardMoveMotion({
        id: 'phase-end',
        startMs: 300,
        durationMs: 250,
        removeSprite: 'phase-end',
      }),
    ], 900)).toBe(900);
  });

  it('rejects claims whose identity does not match the owning motion', () => {
    const plan = planWithMotion(cardMoveMotion({
      id: 'draw-card',
      startMs: 0,
      durationMs: 250,
    }));

    expect(replayAnimationClaimTiming(plan, {
      scopeKey: plan.key,
      motionId: 'draw-card',
      role: 'destination',
      anchor: { kind: 'hand-card', playerIndex: 0, handIndex: 2 },
      identity: { kind: 'card', serial: 999, cardId: 22 },
    })).toBeUndefined();
  });

  it('offsets reveal-session step claim timing by the owning motion start', () => {
    const plan = planWithMotion({
      id: 'search-session',
      kind: 'reveal-session',
      playerIndex: 0,
      coordinateSpace: 'viewport',
      startMs: 200,
      durationMs: 900,
      handoffPolicy: {
        hideSourceUntil: 'none',
        hideDestinationUntil: 'none',
        removeSprite: 'phase-end',
      },
      steps: [
        {
          id: 'take-card',
          kind: 'take',
          startMs: 300,
          durationMs: 250,
          targetAnchor: { kind: 'hand-card', playerIndex: 0, handIndex: 4 },
          identity: { kind: 'card', serial: 44, cardId: 55 },
          handoffPolicy: {
            hideSourceUntil: 'none',
            hideDestinationUntil: 'arrival',
            removeSprite: 'arrival',
          },
        },
      ],
    });

    expect(replayAnimationClaimTiming(plan, {
      scopeKey: plan.key,
      motionId: 'search-session',
      stepId: 'take-card',
      role: 'destination',
      anchor: { kind: 'hand-card', playerIndex: 0, handIndex: 4 },
      identity: { kind: 'card', serial: 44, cardId: 55 },
    })).toEqual({
      startMs: 0,
      releaseMs: 774,
    });
  });
});

function planWithMotion(motion: AnimationMotion) {
  return createReplayAnimationPhasePlan({
    key: 'Test:0',
    view: gameView(),
    durationMs: 1200,
    motions: [motion],
  });
}

function cardMoveMotion(input: {
  id: string;
  startMs: number;
  durationMs: number;
  hideSourceUntil?: 'none' | 'snapshot' | 'phase-end' | 'scope-exit';
  hideDestinationUntil?: 'none' | 'arrival' | 'prepaint';
  removeSprite?: 'arrival' | 'prepaint' | 'phase-end' | 'scope-exit';
}): AnimationMotion {
  return {
    id: input.id,
    kind: 'card-move',
    identity: { kind: 'card', serial: 11, cardId: 22 },
    sourceAnchor: { kind: 'hand-card', playerIndex: 0, handIndex: 0 },
    targetAnchor: { kind: 'hand-card', playerIndex: 0, handIndex: 2 },
    coordinateSpace: 'viewport',
    startMs: input.startMs,
    durationMs: input.durationMs,
    spriteVisual: { kind: 'card' },
    handoffPolicy: {
      hideSourceUntil: input.hideSourceUntil ?? 'none',
      hideDestinationUntil: input.hideDestinationUntil ?? 'prepaint',
      removeSprite: input.removeSprite ?? 'prepaint',
      prepaintFrames: 2,
    },
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
