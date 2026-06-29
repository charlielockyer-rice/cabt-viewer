import {
  releaseAnimationElementEffectClaim,
  type AnimationElementEffectClaim,
} from './animationElementEffects';
import { serializeAnimationAnchor, serializeAnimationIdentity } from './animationAnchors';
import type { PulseAnimationMotion } from './replayAnimationPlan';

type TimedEffectMotion = {
  startMs: number;
  durationMs: number;
};

type ScheduledAnimationEffect = {
  claim: AnimationElementEffectClaim;
  cleanup?: () => void;
};

export class ScheduledAnimationEffectRunner<Motion extends TimedEffectMotion> {
  private readonly timers: ReturnType<typeof setTimeout>[] = [];
  private readonly activeEffects = new Map<AnimationElementEffectClaim, (() => void) | undefined>();
  private generation = 0;

  start(
    motions: readonly Motion[],
    callbacks: {
      resolveElement: (motion: Motion) => HTMLElement | null;
      activate: (element: HTMLElement, motion: Motion) => ScheduledAnimationEffect | AnimationElementEffectClaim | null | undefined;
    },
  ) {
    const generation = this.generation;
    for (const motion of motions) {
      const timer = setTimeout(() => {
        if (generation !== this.generation) {
          return;
        }
        const element = callbacks.resolveElement(motion);
        if (!element) {
          return;
        }
        const effect = normalizeEffect(callbacks.activate(element, motion));
        if (!effect) {
          return;
        }
        this.activeEffects.set(effect.claim, effect.cleanup);
        const cleanup = setTimeout(() => {
          if (generation !== this.generation) {
            return;
          }
          this.clearEffect(effect.claim);
        }, motion.durationMs);
        this.timers.push(cleanup);
      }, motion.startMs);
      this.timers.push(timer);
    }
  }

  clear() {
    this.generation += 1;
    for (const timer of this.timers) {
      clearTimeout(timer);
    }
    this.timers.length = 0;
    for (const [claim, cleanup] of this.activeEffects) {
      cleanup?.();
      releaseAnimationElementEffectClaim(claim);
    }
    this.activeEffects.clear();
  }

  private clearEffect(claim: AnimationElementEffectClaim) {
    const cleanup = this.activeEffects.get(claim);
    cleanup?.();
    releaseAnimationElementEffectClaim(claim);
    this.activeEffects.delete(claim);
  }
}

function normalizeEffect(
  effect: ScheduledAnimationEffect | AnimationElementEffectClaim | null | undefined,
): ScheduledAnimationEffect | null {
  if (!effect) {
    return null;
  }
  return 'claim' in effect ? effect : { claim: effect };
}

export function pulseMotionPlanKey(motions: readonly PulseAnimationMotion[]): string {
  return motions.map((motion) => [
    motion.id,
    motion.startMs,
    motion.durationMs,
    serializeAnimationAnchor(motion.anchor),
    motion.sourceAnchor ? serializeAnimationAnchor(motion.sourceAnchor) : '',
    serializeAnimationIdentity(motion.identity),
    motion.spriteVisual.kind === 'pulse' ? motion.spriteVisual.tone : '',
    motion.label ?? '',
    motion.value ?? '',
  ].join(':')).join('|');
}
