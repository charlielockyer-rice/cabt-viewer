import type { AnimationMotion } from '../animations/replayAnimationPlan';

export type MaybeAnimationMotionGroup = AnimationMotion | AnimationMotion[] | null | undefined;

export function compactAnimationMotions(groups: MaybeAnimationMotionGroup[]): AnimationMotion[] {
  return groups.flatMap((group) => group ?? []);
}
