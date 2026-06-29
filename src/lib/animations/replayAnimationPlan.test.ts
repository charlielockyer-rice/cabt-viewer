import { describe, expect, it } from 'vitest';
import {
  createReplayAnimationPhasePlan,
  replayAnimationPhasePlanKey,
  replayAnimationPlanHasAnyPhase,
  replayAnimationPlanHasPhase,
  replayAnimationPlanOwnsMotion,
  replayAnimationMotionSpanMs,
  replayAnimationVisibilityClaimsForMotions,
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
      kind: 'Play',
      view: gameView(),
      durationMs: 980,
      motions,
    });

    expect(plan.motions.map((motion) => ({
      id: motion.id,
      startMs: motion.startMs,
      durationMs: motion.durationMs,
      endMs: motion.startMs + motion.durationMs,
    }))).toEqual([
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
    expect(plan.durationMs).toBe(980);
  });

  it('computes the motion span from explicit start and duration fields', () => {
    expect(replayAnimationMotionSpanMs([
      cardMoveMotion('first', 0, 300),
      cardMoveMotion('second', 90, 520),
      cardMoveMotion('third', 700, 120),
    ])).toBe(820);
  });

  it('matches animation phase keys through the shared routing helper', () => {
    expect(replayAnimationPlanHasPhase({ kind: 'Draw', playerIndex: 0 }, 'Draw', 0)).toBe(true);
    expect(replayAnimationPlanHasPhase({ kind: 'Draw', playerIndex: 0 }, 'Draw')).toBe(true);
    expect(replayAnimationPlanHasPhase({ kind: 'Draw', playerIndex: 0 }, 'Draw', 1)).toBe(false);
    expect(replayAnimationPlanHasPhase({ kind: 'Draw', playerIndex: 0 }, 'Shuffle', 0)).toBe(false);
    expect(replayAnimationPlanHasPhase(undefined, 'Draw', 0)).toBe(false);
  });

  it('matches grouped animation phase ownership by kind and player', () => {
    expect(replayAnimationPlanHasAnyPhase({ kind: 'Damage', playerIndex: 1 }, ['Attack', 'Damage'], 1)).toBe(true);
    expect(replayAnimationPlanHasAnyPhase({ kind: 'Damage', playerIndex: 1 }, ['Attack', 'Damage'], 0)).toBe(false);
    expect(replayAnimationPlanHasAnyPhase({ kind: 'Coin', playerIndex: 0 }, ['Attack', 'Damage'], 0)).toBe(false);
  });

  it('matches animation motion ownership by phase kind and motion player', () => {
    expect(replayAnimationPlanOwnsMotion(
      { kind: 'Play', playerIndex: 0 },
      cardMoveMotion('play-card', 0, 300),
      ['Play', 'Attach'],
    )).toBe(true);
    expect(replayAnimationPlanOwnsMotion(
      { kind: 'Play', playerIndex: 1 },
      cardMoveMotion('play-card', 0, 300),
      ['Play', 'Attach'],
    )).toBe(false);
    expect(replayAnimationPlanOwnsMotion(
      { kind: 'DeckSearchReveal', playerIndex: 0 },
      revealSessionMotion(),
      ['DeckReveal', 'DeckSearchReveal'],
    )).toBe(true);
    expect(replayAnimationPlanOwnsMotion(
      { kind: 'Shuffle', playerIndex: 0 },
      revealSessionMotion(),
      ['DeckReveal', 'DeckSearchReveal'],
    )).toBe(false);
    expect(replayAnimationPlanOwnsMotion(
      { kind: 'Condition', playerIndex: 0 },
      neutralPulseMotion('condition-pulse'),
      ['Coin', 'Change', 'Condition', 'Devolve', 'MoveAttached'],
    )).toBe(true);
    expect(replayAnimationPlanOwnsMotion(
      { kind: 'Condition', playerIndex: 1 },
      neutralPulseMotion('condition-pulse'),
      ['Coin', 'Change', 'Condition', 'Devolve', 'MoveAttached'],
    )).toBe(false);
  });

  it('derives card-move visibility claims from handoff policies by default', () => {
    const plan = createReplayAnimationPhasePlan({
      key: 'Move:0',
      kind: 'Play',
      view: gameView(),
      durationMs: 360,
      motions: [cardMoveMotion('move', 0, 360)],
    });

    expect(plan.visibilityClaims).toEqual([
      {
        scopeKey: 'Move:0',
        motionId: 'move',
        role: 'source',
        anchor: {
          kind: 'hand-card',
          playerIndex: 0,
          handIndex: 0,
          serial: 101,
        },
        identity: undefined,
      },
      {
        scopeKey: 'Move:0',
        motionId: 'move',
        role: 'destination',
        anchor: { kind: 'discard-pile', playerIndex: 0 },
        identity: undefined,
      },
    ]);
  });

  it('does not derive deck-top source claims or claims for none policies', () => {
    expect(replayAnimationVisibilityClaimsForMotions('Draw:0', [
      {
        ...cardMoveMotion('draw', 0, 320),
        sourceAnchor: { kind: 'deck-top', playerIndex: 0 },
        handoffPolicy: {
          hideSourceUntil: 'snapshot',
          hideDestinationUntil: 'prepaint',
          removeSprite: 'prepaint',
          prepaintFrames: 2,
        },
      },
      {
        id: 'ability',
        kind: 'pulse',
        anchor: { kind: 'board-slot', playerIndex: 0, slot: 'active', slotIndex: 0 },
        coordinateSpace: 'board',
        startMs: 0,
        durationMs: 300,
        spriteVisual: { kind: 'pulse', tone: 'ability' },
      },
      {
        id: 'shuffle',
        kind: 'shuffle',
        anchor: { kind: 'deck-top', playerIndex: 0 },
        coordinateSpace: 'viewport',
        startMs: 0,
        durationMs: 300,
      },
    ])).toEqual([
      {
        scopeKey: 'Draw:0',
        motionId: 'draw',
        role: 'destination',
        anchor: { kind: 'discard-pile', playerIndex: 0 },
        identity: undefined,
      },
    ]);
  });

  it('derives source-only claims for hand-to-deck style card moves', () => {
    expect(replayAnimationVisibilityClaimsForMotions('HandToDeck:0', [
      {
        ...cardMoveMotion('hand-to-deck', 0, 300),
        targetAnchor: { kind: 'deck-top', playerIndex: 0 },
        handoffPolicy: {
          hideSourceUntil: 'scope-exit',
          hideDestinationUntil: 'none',
          removeSprite: 'phase-end',
          prepaintFrames: 2,
        },
      },
    ])).toEqual([
      {
        scopeKey: 'HandToDeck:0',
        motionId: 'hand-to-deck',
        role: 'source',
        anchor: {
          kind: 'hand-card',
          playerIndex: 0,
          handIndex: 0,
          serial: 101,
        },
        identity: undefined,
      },
    ]);
  });

  it('derives reveal-session claims from step handoff policies', () => {
    expect(replayAnimationVisibilityClaimsForMotions('DeckSearchReveal:0', [revealSessionMotion()])).toEqual([
      {
        scopeKey: 'DeckSearchReveal:0',
        motionId: 'pokegear-session',
        stepId: 'take-selected',
        role: 'destination',
        anchor: { kind: 'hand-slot', playerIndex: 0, handIndex: 3 },
        identity: undefined,
      },
    ]);
  });

  it('rejects a phase duration that cannot contain its explicit motions', () => {
    expect(() => createReplayAnimationPhasePlan({
      key: 'TooShort',
      kind: 'Play',
      view: gameView(),
      durationMs: 359,
      motions: [cardMoveMotion('move', 0, 360)],
    })).toThrow('shorter than motion span 360ms');
  });

  it('rejects board motions that target viewport-only anchors', () => {
    expect(() => createReplayAnimationPhasePlan({
      key: 'BoardMove:0',
      kind: 'BoardMove',
      view: gameView(),
      durationMs: 360,
      motions: [
        {
          ...cardMoveMotion('bad-board-move', 0, 360),
          coordinateSpace: 'board',
          sourceAnchor: { kind: 'pokemon-card', playerIndex: 0, slot: 'active', slotIndex: 0, serial: 101 },
          targetAnchor: { kind: 'hand-card', playerIndex: 0, handIndex: 2, serial: 101 },
        },
      ],
    })).toThrow('must use board-plane anchors');
  });

  it('rejects cross-plane motions that do not cross coordinate families', () => {
    expect(() => createReplayAnimationPhasePlan({
      key: 'CrossPlane:0',
      kind: 'AttachedMove',
      view: gameView(),
      durationMs: 360,
      motions: [
        {
          ...cardMoveMotion('bad-cross-plane', 0, 360),
          coordinateSpace: 'cross-plane',
          sourceAnchor: { kind: 'pokemon-card', playerIndex: 0, slot: 'active', slotIndex: 0, serial: 101 },
          targetAnchor: { kind: 'discard-pile', playerIndex: 0 },
        },
      ],
    })).toThrow('must cross between board and viewport anchors');
  });

  it('rejects resolving cleanup purpose on broad or mismatched card moves', () => {
    expect(() => createReplayAnimationPhasePlan({
      key: 'BadCleanup',
      kind: 'BoardMove',
      view: gameView(),
      durationMs: 360,
      motions: [
        {
          ...cardMoveMotion('bad-cleanup', 0, 360),
          purpose: 'resolving-cleanup',
          coordinateSpace: 'board',
          sourceAnchor: { kind: 'play-zone-card', playerIndex: 0 },
          targetAnchor: { kind: 'discard-card', playerIndex: 0 },
          identity: { kind: 'card', cardId: 101 },
        },
      ],
    })).toThrow('invalid purpose "resolving-cleanup"');
  });

  it('includes semantic motion fields in phase keys', () => {
    const baseMotion = {
      ...cardMoveMotion('cleanup', 0, 360),
      purpose: 'resolving-cleanup' as const,
      coordinateSpace: 'board' as const,
      sourceAnchor: { kind: 'play-zone-card' as const, playerIndex: 0, serial: 101 },
      targetAnchor: { kind: 'discard-card' as const, playerIndex: 0, serial: 101 },
      identity: { kind: 'card' as const, serial: 101, cardId: 101 },
    };
    const first = createReplayAnimationPhasePlan({
      key: 'Cleanup',
      kind: 'BoardMove',
      view: gameView(),
      durationMs: 360,
      motions: [baseMotion],
    });
    const second = createReplayAnimationPhasePlan({
      key: 'Cleanup',
      kind: 'BoardMove',
      view: gameView(),
      durationMs: 360,
      motions: [{
        ...baseMotion,
        targetAnchor: { kind: 'discard-card' as const, playerIndex: 0, serial: 202 },
        identity: { kind: 'card' as const, serial: 202, cardId: 101 },
        sourceAnchor: { kind: 'play-zone-card' as const, playerIndex: 0, serial: 202 },
      }],
    });

    expect(replayAnimationPhasePlanKey(first)).not.toBe(replayAnimationPhasePlanKey(second));
  });

  it('validates nested reveal session timing explicitly', () => {
    const plan = createReplayAnimationPhasePlan({
      key: 'DeckSearchReveal:0',
      kind: 'DeckSearchReveal',
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

    expect(plan.durationMs).toBe(900);
  });

  it('rejects negative nested reveal session timing', () => {
    expect(() => createReplayAnimationPhasePlan({
      key: 'BadReveal',
      kind: 'DeckReveal',
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
      kind: 'card',
      card: { id: 101, serial: 101 },
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

function neutralPulseMotion(id: string): AnimationMotion {
  return {
    id,
    kind: 'pulse',
    anchor: { kind: 'board-slot', playerIndex: 0, slot: 'active', slotIndex: 0 },
    coordinateSpace: 'board',
    startMs: 0,
    durationMs: 300,
    spriteVisual: { kind: 'pulse', tone: 'neutral' },
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
