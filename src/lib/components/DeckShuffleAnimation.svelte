<script lang="ts">
  import { onDestroy } from 'svelte';
  import { actionAnimationBatchEvents, actionAnimationStartMs } from '../cabt/actionAnimationSchedule';
  import { cardBackCssVar } from '../game/cardAssets';
  import { createPrefersReducedMotion } from '../animations/prefersReducedMotion.svelte';
  import { ReplayAnimationRunState } from '../animations/replayAnimationRunState';
  import { replayAnimationPlanHasPhase, type ReplayAnimationPhasePlan, type ShuffleAnimationMotion } from '../animations/replayAnimationPlan';
  import type { ActionTimelineEvent } from '../game/types';

  type Props = {
    events?: ActionTimelineEvent[];
    playerIndex: number;
    scopeKey?: string | number;
    replayMode?: boolean;
    opponent?: boolean;
    animationPlan?: ReplayAnimationPhasePlan;
  };

  type ShuffleSprite = {
    id: string;
    delayMs: number;
    splitX: number;
    splitY: number;
    splitRotation: number;
    crossX: number;
    crossY: number;
    crossRotation: number;
    settleX: number;
    settleY: number;
    settleRotation: number;
  };

  type ShuffleAnimation = {
    id: string;
    sprites: ShuffleSprite[];
  };

  let {
    events = [],
    playerIndex,
    scopeKey = '',
    replayMode = false,
    opponent = false,
    animationPlan,
  }: Props = $props();

  let shuffles = $state<ShuffleAnimation[]>([]);
  const runState = new ReplayAnimationRunState();
  let nextAnimationId = 1;
  const prefersReducedMotion = createPrefersReducedMotion();
  let reduceMotion = $derived(prefersReducedMotion.current);
  const timers: ReturnType<typeof setTimeout>[] = [];

  onDestroy(() => {
    clearShuffles();
  });

  $effect(() => {
    const currentEvents = events;
    const currentScopeKey = scopeKey;
    const plannedMotions = shufflePlanMotions(animationPlan);
    const planKey = shufflePlanKey(plannedMotions);
    const run = runState.update(currentScopeKey, planKey);
    if (run.scopeChanged || run.planChanged) {
      clearShuffles();
    }

    if (plannedMotions.length) {
      if (!reduceMotion && run.shouldStartPlan) {
        startPlannedShuffles(plannedMotions);
      }
      runState.markEventsSeen(currentEvents);
      return;
    }

    if (run.firstRun) {
      runState.markEventsSeen(currentEvents);
      return;
    }

    if (replayMode) {
      runState.markEventsSeen(currentEvents);
      return;
    }

    const animationEvents = actionAnimationBatchEvents(currentEvents, runState.seenEventIds);
    const shuffleEvents = animationEvents.filter((event) => {
      if (event.kind !== 'Shuffle' || event.playerIndex !== playerIndex) {
        return false;
      }
      if (runState.hasSeen(event)) {
        return false;
      }
      return true;
    });

    runState.markEventsSeen(currentEvents);

    shuffleEvents.forEach((event) => {
      const timer = setTimeout(() => {
        startShuffle();
      }, actionAnimationStartMs(animationEvents, event));
      timers.push(timer);
    });
  });

  function shufflePlanMotions(plan: ReplayAnimationPhasePlan | undefined): ShuffleAnimationMotion[] {
    return (plan?.motions ?? []).filter((motion): motion is ShuffleAnimationMotion =>
      motion.kind === 'shuffle'
      && motion.anchor.kind === 'deck-top'
      && motion.anchor.playerIndex === playerIndex
      && replayAnimationPlanHasPhase(plan, 'Shuffle', playerIndex),
    );
  }

  function shufflePlanKey(motions: ShuffleAnimationMotion[]): string {
    return motions.map((motion) => `${motion.id}:${motion.startMs}:${motion.durationMs}`).join('|');
  }

  function startPlannedShuffles(motions: ShuffleAnimationMotion[]) {
    for (const motion of motions) {
      const timer = setTimeout(() => {
        startShuffle(motion.id, motion.durationMs);
      }, motion.startMs);
      timers.push(timer);
    }
  }

  function startShuffle(id = `${nextAnimationId++}`, durationMs = 980) {
    if (reduceMotion) {
      return;
    }

    const animation: ShuffleAnimation = {
      id,
      sprites: shuffleSprites(),
    };

    shuffles = [...shuffles, animation];
    const timer = setTimeout(() => {
      shuffles = shuffles.filter((item) => item.id !== animation.id);
    }, durationMs);
    timers.push(timer);
  }

  function clearShuffles() {
    for (const timer of timers) {
      clearTimeout(timer);
    }
    timers.length = 0;
    shuffles = [];
  }

  function shuffleSprites(): ShuffleSprite[] {
    const direction = opponent ? -1 : 1;
    return Array.from({ length: 6 }, (_item, index) => {
      const side = index % 2 === 0 ? -1 : 1;
      const depth = index - 2.5;
      return {
        id: `${playerIndex}-${index}`,
        delayMs: index * 32,
        splitX: side * (20 + index * 2),
        splitY: direction * (-18 - Math.abs(depth) * 2),
        splitRotation: side * (5 + index * 0.8),
        crossX: -side * (15 + index),
        crossY: direction * (-4 + depth),
        crossRotation: -side * (4 + index * 0.5),
        settleX: side * 4,
        settleY: direction * 2,
        settleRotation: side * 1.5,
      };
    });
  }

  function spriteStyle(sprite: ShuffleSprite) {
    return [
      `--shuffle-delay: ${sprite.delayMs}ms`,
      `--split-x: ${sprite.splitX.toFixed(1)}px`,
      `--split-y: ${sprite.splitY.toFixed(1)}px`,
      `--split-rotation: ${sprite.splitRotation.toFixed(1)}deg`,
      `--cross-x: ${sprite.crossX.toFixed(1)}px`,
      `--cross-y: ${sprite.crossY.toFixed(1)}px`,
      `--cross-rotation: ${sprite.crossRotation.toFixed(1)}deg`,
      `--settle-x: ${sprite.settleX.toFixed(1)}px`,
      `--settle-y: ${sprite.settleY.toFixed(1)}px`,
      `--settle-rotation: ${sprite.settleRotation.toFixed(1)}deg`,
      `--base-rotation: ${opponent ? 180 : 0}deg`,
    ].join('; ');
  }
</script>

<span class="deck-shuffle-animation" class:opponent aria-hidden="true">
  {#each shuffles as shuffle (shuffle.id)}
    <span class="shuffle-stack">
      <span class="shuffle-glow"></span>
      {#each shuffle.sprites as sprite (sprite.id)}
        <span class="shuffle-card" style={`${spriteStyle(sprite)}; ${cardBackCssVar()}`}></span>
      {/each}
    </span>
  {/each}
</span>

<style>
  .deck-shuffle-animation {
    position: absolute;
    inset: 0;
    z-index: 8;
    overflow: visible;
    pointer-events: none;
    transform-style: preserve-3d;
  }

  .shuffle-stack,
  .shuffle-card,
  .shuffle-glow {
    position: absolute;
    inset: 0;
    border-radius: 5px;
    pointer-events: none;
  }

  .shuffle-card {
    background:
      var(--card-back-image, var(--cardback-shade)),
      linear-gradient(135deg, rgba(255, 255, 255, 0.1), transparent 28%),
      repeating-linear-gradient(45deg, rgba(255, 255, 255, 0.08) 0 6px, transparent 6px 12px),
      linear-gradient(145deg, #203654, #111a2c);
    background-size: cover, auto, auto, auto;
    background-position: center;
    box-shadow:
      0 7px 16px rgba(23, 30, 38, 0.2),
      0 0 0 1px rgba(18, 21, 26, 0.16);
    opacity: 0;
    animation: shuffle-card 760ms cubic-bezier(0.2, 0.72, 0.22, 1) var(--shuffle-delay) both;
    will-change: transform, opacity;
  }

  .shuffle-glow {
    border: 1px solid rgba(82, 188, 168, 0.55);
    box-shadow:
      0 0 0 0 rgba(82, 188, 168, 0.22),
      0 0 22px rgba(82, 188, 168, 0.24);
    opacity: 0;
    animation: shuffle-glow 760ms ease-out both;
  }

  @keyframes shuffle-card {
    0% {
      opacity: 0;
      transform: translate3d(0, 0, 0) rotate(var(--base-rotation)) scale(0.98);
    }
    12% {
      opacity: 1;
      transform: translate3d(0, -6px, 0) rotate(var(--base-rotation)) scale(1.01);
    }
    38% {
      opacity: 1;
      transform: translate3d(var(--split-x), var(--split-y), 0) rotate(calc(var(--base-rotation) + var(--split-rotation))) scale(1.02);
    }
    62% {
      opacity: 1;
      transform: translate3d(var(--cross-x), var(--cross-y), 0) rotate(calc(var(--base-rotation) + var(--cross-rotation))) scale(1.01);
    }
    84% {
      opacity: 1;
      transform: translate3d(var(--settle-x), var(--settle-y), 0) rotate(calc(var(--base-rotation) + var(--settle-rotation))) scale(1);
    }
    100% {
      opacity: 0;
      transform: translate3d(0, 0, 0) rotate(var(--base-rotation)) scale(0.98);
    }
  }

  @keyframes shuffle-glow {
    0% {
      opacity: 0;
      transform: scale(0.98);
    }
    22% {
      opacity: 1;
      transform: scale(1.05);
      box-shadow:
        0 0 0 7px rgba(82, 188, 168, 0.14),
        0 0 24px rgba(82, 188, 168, 0.28);
    }
    100% {
      opacity: 0;
      transform: scale(1.14);
      box-shadow:
        0 0 0 16px rgba(82, 188, 168, 0),
        0 0 30px rgba(82, 188, 168, 0);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .shuffle-card,
    .shuffle-glow {
      animation: none;
    }
  }
</style>
