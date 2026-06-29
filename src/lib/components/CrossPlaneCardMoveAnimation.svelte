<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import { afterTwoAnimationFrames } from '../animations/animationFrames';
  import {
    crossPlaneSpriteForMotion,
    crossPlaneSpriteId,
    type CrossPlaneSprite,
  } from '../animations/crossPlaneCardMoveSprites';
  import { replayAnimationScopeExitSettleMs, replayAnimationSpriteRemovalMs } from '../animations/replayAnimationHandoff';
  import { createReplayPhasePlanRunner } from '../animations/replayPhasePlanRunner.svelte';
  import { scheduleReplayAnimationScopeClear } from '../animations/replayAnimationSpriteLifecycle';
  import {
    replayAnimationPlanOwnsMotion,
    type CardMoveAnimationMotion,
    type ReplayAnimationPhasePlan,
  } from '../animations/replayAnimationPlan';
  import CardTile from './CardTile.svelte';

  type Props = {
    animationPlan?: ReplayAnimationPhasePlan;
    scopeKey?: string | number;
    replayMode?: boolean;
  };

  let {
    animationPlan,
    scopeKey = '',
    replayMode = false,
  }: Props = $props();

  const timers: ReturnType<typeof setTimeout>[] = [];
  const frameIds: number[] = [];
  let activeSprites = $state<CrossPlaneSprite[]>([]);
  let generation = 0;
  const replayPlanRunner = createReplayPhasePlanRunner({
    selectMotions: crossPlaneMotions,
    onScopeChange: settleSprites,
    onPlanChange: clearSprites,
    startPlanned: startMotions,
  });

  onDestroy(() => {
    clearSprites();
  });

  $effect(() => {
    replayPlanRunner.update({ scopeKey, replayMode, animationPlan });
  });

  function crossPlaneMotions(plan: ReplayAnimationPhasePlan | undefined): CardMoveAnimationMotion[] {
    return (plan?.motions ?? []).filter((motion): motion is CardMoveAnimationMotion =>
      motion.kind === 'card-move'
      && motion.coordinateSpace === 'cross-plane'
      && replayAnimationPlanOwnsMotion(plan, motion, ['AttachedMove', 'DiscardRecover']));
  }

  async function startMotions(motions: CardMoveAnimationMotion[]) {
    const nextGeneration = ++generation;
    const sprites = motions.flatMap((motion) => crossPlaneSpriteForMotion(motion, nextGeneration));
    if (!sprites.length) {
      return;
    }
    activeSprites = [...activeSprites, ...sprites];
    await tick();
    if (nextGeneration !== generation) {
      return;
    }

    for (const motion of motions) {
      const sprite = activeSprites.find((item) => item.id === crossPlaneSpriteId(motion, nextGeneration));
      if (!sprite) {
        continue;
      }
      const removeMs = replayAnimationSpriteRemovalMs(motion, animationPlan?.durationMs);
      if (removeMs === undefined) {
        continue;
      }
      const finishTimer = setTimeout(() => {
        if (nextGeneration !== generation) {
          return;
        }
        removeSpriteAfterPrepaint(sprite.id, nextGeneration);
      }, removeMs);
      timers.push(finishTimer);
    }
  }

  function removeSpriteAfterPrepaint(spriteIdToRemove: string, currentGeneration: number) {
    afterTwoAnimationFrames(() => {
      if (generation === currentGeneration) {
        activeSprites = activeSprites.filter((sprite) => sprite.id !== spriteIdToRemove);
      }
    }, frameIds);
  }

  function clearSprites() {
    generation += 1;
    for (const timer of timers) {
      clearTimeout(timer);
    }
    timers.length = 0;
    for (const frameId of frameIds) {
      cancelAnimationFrame(frameId);
    }
    frameIds.length = 0;
    activeSprites = [];
  }

  function settleSprites() {
    generation += 1;
    for (const timer of timers) {
      clearTimeout(timer);
    }
    timers.length = 0;
    for (const frameId of frameIds) {
      cancelAnimationFrame(frameId);
    }
    frameIds.length = 0;
    scheduleReplayAnimationScopeClear({
      items: activeSprites,
      timers,
      delayMs: replayAnimationScopeExitSettleMs,
      removeIds(ids) {
        activeSprites = activeSprites.filter((sprite) => !ids.has(sprite.id));
      },
    });
  }

  function spriteStyle(sprite: CrossPlaneSprite): string {
    return [
      `left: ${sprite.left}px`,
      `top: ${sprite.top}px`,
      `width: ${sprite.width}px`,
      `height: ${sprite.height}px`,
      `--cross-plane-move-x: ${sprite.moveX.toFixed(1)}px`,
      `--cross-plane-move-y: ${sprite.moveY.toFixed(1)}px`,
      `--cross-plane-target-scale: ${sprite.targetScale.toFixed(3)}`,
      `--cross-plane-delay: ${sprite.delayMs}ms`,
      `--cross-plane-duration: ${sprite.durationMs}ms`,
      `--cross-plane-rotation: ${sprite.opponentSide ? 180 : 0}deg`,
    ].join('; ');
  }
</script>

<span class="cross-plane-card-move-layer" aria-hidden="true">
  {#each activeSprites as sprite (sprite.id)}
    <span
      class="cross-plane-card-move-sprite"
      style={spriteStyle(sprite)}
      data-cross-plane-card-move-id={sprite.id}
    >
      <CardTile card={sprite.card} compact faceDown={sprite.faceDown} />
    </span>
  {/each}
</span>

<style>
  .cross-plane-card-move-layer {
    position: fixed;
    inset: 0;
    z-index: 80;
    pointer-events: none;
  }

  .cross-plane-card-move-sprite {
    position: fixed;
    display: block;
    transform-origin: center;
    animation: cross-plane-card-move var(--cross-plane-duration, 360ms) cubic-bezier(0.2, 0.82, 0.22, 1) var(--cross-plane-delay, 0ms) both;
    will-change: transform, opacity;
  }

  .cross-plane-card-move-sprite :global(.card-tile) {
    width: 100%;
    height: 100%;
    pointer-events: none;
  }

  @keyframes cross-plane-card-move {
    0% {
      opacity: 0;
      transform: translate3d(0, 0, 0) scale(1) rotate(var(--cross-plane-rotation, 0deg));
    }
    1% {
      opacity: 1;
      transform: translate3d(0, 0, 0) scale(1) rotate(var(--cross-plane-rotation, 0deg));
    }
    100% {
      opacity: 1;
      transform:
        translate3d(var(--cross-plane-move-x), var(--cross-plane-move-y), 0)
        scale(var(--cross-plane-target-scale))
        rotate(var(--cross-plane-rotation, 0deg));
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .cross-plane-card-move-sprite {
      animation: none;
      display: none;
    }
  }
</style>
