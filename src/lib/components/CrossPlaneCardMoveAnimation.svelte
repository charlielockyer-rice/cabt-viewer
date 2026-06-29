<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import { afterTwoAnimationFrames } from '../animations/animationFrames';
  import {
    animationElementForMotionAnchor,
    centerOf,
    isConcealedHandTarget,
  } from '../animations/viewportCardMotion';
  import type { CardMoveAnimationMotion, ReplayAnimationPhasePlan } from '../animations/replayAnimationPlan';
  import { replayAnimationPhaseGapMs } from '../game/replay';
  import type { CardView } from '../game/types';
  import CardTile from './CardTile.svelte';

  type Props = {
    animationPlan?: ReplayAnimationPhasePlan;
    scopeKey?: string | number;
    replayMode?: boolean;
  };

  type CrossPlaneSprite = {
    id: string;
    card: CardView;
    left: number;
    top: number;
    width: number;
    height: number;
    moveX: number;
    moveY: number;
    targetScale: number;
    delayMs: number;
    durationMs: number;
    faceDown: boolean;
    opponentSide: boolean;
  };

  let {
    animationPlan,
    scopeKey = '',
    replayMode = false,
  }: Props = $props();

  const timers: ReturnType<typeof setTimeout>[] = [];
  const frameIds: number[] = [];
  let activeSprites = $state<CrossPlaneSprite[]>([]);
  let lastPlanKey = '';
  let lastScopeKey: string | number = '';
  let initialized = false;
  let generation = 0;

  onDestroy(() => {
    clearSprites();
  });

  $effect(() => {
    const currentScopeKey = scopeKey;
    const currentPlan = animationPlan;
    const motions = crossPlaneMotions(currentPlan);
    const planKey = currentPlanKey(currentPlan);
    const scopeChanged = initialized && currentScopeKey !== lastScopeKey;
    const planChanged = planKey !== lastPlanKey;
    lastScopeKey = currentScopeKey;
    lastPlanKey = planKey;
    initialized = true;

    if (scopeChanged || planChanged) {
      clearSprites();
    }
    if (!motions.length || (!planChanged && !scopeChanged)) {
      return;
    }
    startMotions(motions);
  });

  function currentPlanKey(plan: ReplayAnimationPhasePlan | undefined): string {
    return plan ? `${plan.key}:${plan.motions.map((motion) => motion.id).join(',')}` : '';
  }

  function crossPlaneMotions(plan: ReplayAnimationPhasePlan | undefined): CardMoveAnimationMotion[] {
    return (plan?.motions ?? []).filter((motion): motion is CardMoveAnimationMotion =>
      motion.kind === 'card-move' && motion.coordinateSpace === 'cross-plane');
  }

  async function startMotions(motions: CardMoveAnimationMotion[]) {
    const nextGeneration = ++generation;
    const sprites = motions.flatMap((motion) => spriteForMotion(motion, nextGeneration));
    if (!sprites.length) {
      return;
    }
    activeSprites = sprites;
    await tick();
    if (nextGeneration !== generation) {
      return;
    }

    for (const motion of motions) {
      const sprite = activeSprites.find((item) => item.id === spriteId(motion, nextGeneration));
      if (!sprite) {
        continue;
      }
      const finishTimer = setTimeout(() => {
        if (nextGeneration !== generation) {
          return;
        }
        removeSpriteAfterPrepaint(sprite.id, nextGeneration);
      }, motion.startMs + motion.durationMs + handoffSettleMs(motion));
      timers.push(finishTimer);
    }
  }

  function spriteForMotion(motion: CardMoveAnimationMotion, currentGeneration: number): CrossPlaneSprite[] {
    if (motion.spriteVisual.kind !== 'card' || !motion.spriteVisual.card) {
      return [];
    }
    const sourceElement = sourceElementForMotion(motion);
    const targetElement = targetElementForMotion(motion);
    const sourceRect = sourceElement ? sourceRectForElement(sourceElement) : undefined;
    const targetRect = targetElement?.getBoundingClientRect();
    if (!sourceRect || !targetRect || sourceRect.width <= 0 || sourceRect.height <= 0 || targetRect.width <= 0 || targetRect.height <= 0) {
      return [];
    }
    const sourceCenter = centerOf(sourceRect);
    const targetCenter = centerOf(targetRect);
    return [{
      id: spriteId(motion, currentGeneration),
      card: motion.spriteVisual.card,
      left: sourceRect.left,
      top: sourceRect.top,
      width: sourceRect.width,
      height: sourceRect.height,
      moveX: targetCenter.x - sourceCenter.x,
      moveY: targetCenter.y - sourceCenter.y,
      targetScale: targetRect.width / sourceRect.width,
      delayMs: motion.startMs,
      durationMs: motion.durationMs,
      faceDown: isConcealedHandTarget(targetElement),
      opponentSide: isOpponentSide(sourceElement) || isOpponentSide(targetElement),
    }];
  }

  function spriteId(motion: CardMoveAnimationMotion, currentGeneration: number): string {
    return `${currentGeneration}:${motion.id}`;
  }

  function sourceRectForElement(source: HTMLElement): DOMRect {
    const ownerCard = source.closest('.board-slot')?.querySelector('.card-tile');
    return (ownerCard instanceof HTMLElement ? ownerCard : source).getBoundingClientRect();
  }

  function sourceElementForMotion(motion: CardMoveAnimationMotion): HTMLElement | undefined {
    return animationElementForMotionAnchor(motion.sourceAnchor, motion.identity);
  }

  function targetElementForMotion(motion: CardMoveAnimationMotion): HTMLElement | undefined {
    return animationElementForMotionAnchor(motion.targetAnchor, motion.identity);
  }

  function isOpponentSide(element: HTMLElement): boolean {
    return !!element.closest('.player-panel.top, .top-active-slot, .bench-row.opponent');
  }

  function handoffSettleMs(motion: CardMoveAnimationMotion): number {
    if (motion.handoffPolicy.removeSprite === 'arrival') {
      return 24;
    }
    return replayMode ? replayAnimationPhaseGapMs + 40 : 40;
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
