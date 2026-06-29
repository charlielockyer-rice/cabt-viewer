import { describe, expect, it, vi } from 'vitest';
import { ReplayAnimationVisibilityLifecycle } from './replayAnimationVisibilityLifecycle';
import type { AnimationVisibilityClaim, AnimationVisibilityToken } from './animationVisibility';
import type { ReplayAnimationPhasePlan } from './replayAnimationPlan';

describe('ReplayAnimationVisibilityLifecycle', () => {
  it('starts and releases timed visibility claims from the animation plan', () => {
    vi.useFakeTimers();
    const manager = fakeVisibilityManager();
    const lifecycle = new ReplayAnimationVisibilityLifecycle({
      manager,
      refresh: () => manager.refresh(),
    });

    lifecycle.update({
      active: true,
      scopeKey: 'scope-a',
      animationPlan: cardMovePlan(),
      reduceMotion: false,
    });

    expect(manager.hiddenClaims.map((claim) => claim.role)).toEqual(['destination']);
    expect(manager.refreshCount).toBeGreaterThan(0);

    vi.advanceTimersByTime(50);

    expect(manager.hiddenClaims.map((claim) => claim.role)).toEqual(['destination', 'source']);

    vi.advanceTimersByTime(120);

    expect(manager.hiddenClaims.map((claim) => claim.role)).toEqual(['destination']);

    vi.advanceTimersByTime(200);

    expect(manager.hiddenClaims).toEqual([]);
    vi.useRealTimers();
  });

  it('keeps scope-exit claims through a short settle window when scopes change', () => {
    vi.useFakeTimers();
    const manager = fakeVisibilityManager();
    const releasedScopes: string[] = [];
    const lifecycle = new ReplayAnimationVisibilityLifecycle({
      manager,
      releaseScope(scopeKey) {
        releasedScopes.push(scopeKey);
        return 0;
      },
      scopeExitSettleMs: 40,
      staleScopeReleaseMs: 220,
    });
    const plan = cardMovePlan({
      hideSourceUntil: 'scope-exit',
      removeSprite: 'scope-exit',
    });

    lifecycle.update({
      active: true,
      scopeKey: 'scope-a',
      animationPlan: plan,
      reduceMotion: false,
    });
    vi.advanceTimersByTime(50);

    expect(manager.hiddenClaims.map((claim) => claim.role)).toContain('source');

    lifecycle.update({
      active: true,
      scopeKey: 'scope-b',
      animationPlan: undefined,
      reduceMotion: false,
    });

    expect(manager.hiddenClaims.map((claim) => claim.role)).toContain('source');
    vi.advanceTimersByTime(39);
    expect(manager.hiddenClaims.map((claim) => claim.role)).toContain('source');

    vi.advanceTimersByTime(1);

    expect(manager.hiddenClaims.map((claim) => claim.role)).not.toContain('source');

    vi.advanceTimersByTime(180);
    expect(releasedScopes).toEqual(['scope-a']);
    vi.useRealTimers();
  });

  it('does not hide final DOM when reduced motion is enabled', () => {
    vi.useFakeTimers();
    const manager = fakeVisibilityManager();
    const lifecycle = new ReplayAnimationVisibilityLifecycle({
      manager,
      refresh: () => manager.refresh(),
    });

    lifecycle.update({
      active: true,
      scopeKey: 'scope-a',
      animationPlan: cardMovePlan(),
      reduceMotion: true,
    });
    vi.runAllTimers();

    expect(manager.hiddenClaims).toEqual([]);
    expect(manager.refreshCount).toBe(1);
    vi.useRealTimers();
  });
});

function fakeVisibilityManager() {
  let nextId = 1;
  const claims = new Map<string, AnimationVisibilityClaim>();
  return {
    get hiddenClaims() {
      return Array.from(claims.values());
    },
    refreshCount: 0,
    hide(claim: AnimationVisibilityClaim): AnimationVisibilityToken {
      const token = { id: `token-${nextId++}`, claimKey: `${claim.scopeKey}:${claim.role}` };
      claims.set(token.id, claim);
      return token;
    },
    release(token: AnimationVisibilityToken | string): boolean {
      return claims.delete(typeof token === 'string' ? token : token.id);
    },
    refresh() {
      this.refreshCount += 1;
    },
  };
}

function cardMovePlan(policy: Partial<ReplayAnimationPhasePlan['motions'][number]['handoffPolicy']> = {}): ReplayAnimationPhasePlan {
  const sourceAnchor = { kind: 'hand-card', playerIndex: 0, serial: 12 } as const;
  const targetAnchor = { kind: 'discard-card', playerIndex: 0, serial: 12 } as const;
  return {
    key: 'HandMove:0',
    kind: 'HandMove',
    playerIndex: 0,
    view: { players: [] },
    durationMs: 400,
    motions: [{
      id: 'move-1',
      kind: 'card-move',
      identity: { kind: 'card', serial: 12, cardId: 25 },
      sourceAnchor,
      targetAnchor,
      coordinateSpace: 'viewport',
      startMs: 50,
      durationMs: 320,
      spriteVisual: { kind: 'card', card: { id: 25, serial: 12, name: 'Pikachu' } },
      handoffPolicy: {
        hideSourceUntil: 'snapshot',
        hideDestinationUntil: 'prepaint',
        removeSprite: 'prepaint',
        prepaintFrames: 2,
        ...policy,
      },
    }],
    visibilityClaims: [
      {
        scopeKey: 'HandMove:0',
        motionId: 'move-1',
        role: 'source',
        anchor: sourceAnchor,
        identity: { kind: 'card', serial: 12, cardId: 25 },
      },
      {
        scopeKey: 'HandMove:0',
        motionId: 'move-1',
        role: 'destination',
        anchor: targetAnchor,
        identity: { kind: 'card', serial: 12, cardId: 25 },
      },
    ],
  };
}
