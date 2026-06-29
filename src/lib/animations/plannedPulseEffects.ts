import {
  releaseAnimationElementEffectClaim,
  releaseAnimationElementEffectClaims,
  type AnimationElementEffectClaim,
} from './animationElementEffects';
import { serializeAnimationAnchor, serializeAnimationIdentity } from './animationAnchors';
import type { PulseAnimationMotion } from './replayAnimationPlan';

type TimedEffectMotion = {
  startMs: number;
  durationMs: number;
};

export class ScheduledAnimationEffectRunner<Motion extends TimedEffectMotion> {
  private readonly timers: ReturnType<typeof setTimeout>[] = [];
  private readonly activeClaims = new Set<AnimationElementEffectClaim>();
  private generation = 0;

  start(
    motions: readonly Motion[],
    callbacks: {
      resolveElement: (motion: Motion) => HTMLElement | null;
      activate: (element: HTMLElement, motion: Motion) => AnimationElementEffectClaim | null | undefined;
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
        const claim = callbacks.activate(element, motion);
        if (!claim) {
          return;
        }
        this.activeClaims.add(claim);
        const cleanup = setTimeout(() => {
          if (generation !== this.generation) {
            return;
          }
          this.clearClaim(claim);
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
    releaseAnimationElementEffectClaims(this.activeClaims);
    this.activeClaims.clear();
  }

  private clearClaim(claim: AnimationElementEffectClaim) {
    releaseAnimationElementEffectClaim(claim);
    this.activeClaims.delete(claim);
  }
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
