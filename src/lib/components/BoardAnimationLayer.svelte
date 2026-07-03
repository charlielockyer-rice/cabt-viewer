<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte';
  import BoardSlot from './BoardSlot.svelte';
  import CardTile from './CardTile.svelte';
  import { actionAnimationBatchEvents, actionAnimationTiming } from '../cabt/actionAnimationSchedule';
  import { localRectIn, localRectCenter, type LocalRect } from '../dom/planeGeometry';
  import { resolveAnchor, type Anchor, type ResolvedAnchor } from '../anim/anchors';
  import { choreographBoardMotions, type CardMotion } from '../anim/motions';
  import { animVisibility, type ReleaseClaim } from '../anim/visibility';
  import { cardBackCssVar } from '../game/cardAssets';
  import { replayAnimationPhaseGapMs } from '../game/replay';
  import type { ActionTimelineEvent, PlayerView } from '../game/types';

  type Props = {
    events?: ActionTimelineEvent[];
    scopeKey?: string | number;
    replayMode?: boolean;
    players?: PlayerView[];
  };

  type RenderSprite = {
    id: string;
    motion: CardMotion;
    left: number;
    top: number;
    width: number;
    height: number;
    vars: string;
    opponentSide: boolean;
    measuring: boolean;
  };

  const handoffPollMs = 16;
  const handoffMaxWaitMs = 300;
  const settleMs = 40;
  const liveAttachedHoldMs = 90;

  let {
    events = [],
    scopeKey = '',
    replayMode = false,
    players = [],
  }: Props = $props();

  let layerElement = $state<HTMLElement>();
  let sprites = $state<RenderSprite[]>([]);
  let reduceMotion = $state(false);

  const timers: ReturnType<typeof setTimeout>[] = [];
  const settleTimers: ReturnType<typeof setTimeout>[] = [];
  const settleFrameIds: number[] = [];
  const scopeReleases: ReleaseClaim[] = [];
  const motionReleases = new Map<string, ReleaseClaim[]>();
  let seenEventIds = new Set<number>();
  let initialized = false;
  let lastScopeKey: string | number = '';
  let generation = 0;
  let discardOrder = 0;
  // Live play swaps the view before this effect runs, so an attached card's
  // badge can already be gone. Pre-effect snapshots keep its last geometry.
  let attachedRects = new Map<number, LocalRect>();

  onMount(() => {
    if (typeof window.matchMedia !== 'function') {
      return;
    }
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => {
      reduceMotion = media.matches;
    };
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  });

  onDestroy(() => {
    endScope({ settle: false });
    for (const timer of settleTimers) {
      clearTimeout(timer);
    }
    settleTimers.length = 0;
    for (const frameId of settleFrameIds) {
      cancelAnimationFrame(frameId);
    }
    settleFrameIds.length = 0;
  });

  $effect.pre(() => {
    void events;
    const plane = planeElement();
    if (!plane) {
      return;
    }
    const rects = new Map<number, LocalRect>();
    for (const element of document.querySelectorAll('[data-energy-serial], [data-tool-serial]')) {
      if (!(element instanceof HTMLElement) || element.closest('[data-anim-layer]')) {
        continue;
      }
      const serial = Number(element.dataset.energySerial ?? element.dataset.toolSerial);
      if (!Number.isFinite(serial)) {
        continue;
      }
      const ownerCard = element.closest('.board-slot')?.querySelector('.card-tile');
      const rect = localRectIn(plane, ownerCard instanceof HTMLElement ? ownerCard : element);
      if (rect) {
        rects.set(serial, rect);
      }
    }
    if (rects.size) {
      attachedRects = rects;
    }
  });

  $effect(() => {
    const currentEvents = events;
    const currentScopeKey = scopeKey;
    const scopeChanged = initialized && currentScopeKey !== lastScopeKey;
    if (scopeChanged) {
      endScope({ settle: replayMode });
    }
    lastScopeKey = currentScopeKey;

    if (!initialized) {
      for (const event of currentEvents) {
        seenEventIds.add(event.id);
      }
      initialized = true;
      return;
    }

    const batch = actionAnimationBatchEvents(currentEvents, seenEventIds, replayMode, scopeChanged);
    for (const event of currentEvents) {
      seenEventIds.add(event.id);
    }
    if (!batch.length || reduceMotion) {
      return;
    }
    startMotions(batch);
  });

  function startMotions(batch: ActionTimelineEvent[]) {
    const motions = choreographBoardMotions(batch, players);
    if (!motions.length) {
      return;
    }
    const startedGeneration = generation;
    const latestDeckPlacementStartMs = Math.max(0, ...motions.filter((motion) => motion.fromDeck).map((motion) => motion.startMs));
    for (const motion of motions) {
      const timer = setTimeout(() => {
        void beginMotion(motion, startedGeneration, latestDeckPlacementStartMs);
      }, motion.startMs);
      timers.push(timer);
    }
  }

  async function beginMotion(motion: CardMotion, startedGeneration: number, latestDeckPlacementStartMs: number) {
    if (startedGeneration !== generation) {
      return;
    }
    const plane = planeElement();
    if (!plane) {
      return;
    }

    if (motion.style === 'board-move') {
      await beginBoardMove(motion, plane, startedGeneration, latestDeckPlacementStartMs);
      return;
    }
    if (motion.style === 'attached-move') {
      beginAttachedMove(motion, plane, startedGeneration);
      return;
    }
    beginDeckDiscard(motion, plane, startedGeneration);
  }

  async function beginBoardMove(motion: CardMotion, plane: HTMLElement, startedGeneration: number, latestDeckPlacementStartMs: number) {
    const from = resolveAnchor(motion.from);
    const to = resolveAnchor(motion.to);
    if (!from || !to) {
      return;
    }
    const fromRect = localRectIn(plane, from.geometry);
    const toRect = localRectIn(plane, to.geometry);
    if (!fromRect || !toRect || fromRect.width <= 0 || toRect.width <= 0) {
      return;
    }

    const sprite: RenderSprite = {
      id: motion.id,
      motion,
      left: toRect.left,
      top: toRect.top,
      width: toRect.width,
      height: toRect.height,
      vars: boardMoveVars(fromRect, toRect, 0, 0),
      opponentSide: isOpponentSide(from.element) || isOpponentSide(to.element),
      measuring: true,
    };
    sprites = [...sprites, sprite];
    await tick();
    if (startedGeneration !== generation) {
      return;
    }
    if (!document.body.contains(from.element) || !document.body.contains(to.element)) {
      sprites = sprites.filter((item) => item.id !== sprite.id);
      return;
    }

    const correction = measureSpriteCorrection(sprite, to.geometry);
    applyClaims(motion);
    sprites = sprites.map((item) => item.id === sprite.id
      ? { ...item, vars: boardMoveVars(fromRect, toRect, correction.x, correction.y), measuring: false }
      : item);

    if (replayMode) {
      return;
    }
    const extraMs = motion.fromDeck ? Math.max(0, latestDeckPlacementStartMs - motion.startMs) : 0;
    const finishTimer = setTimeout(() => {
      handOffWhenDestinationReady(motion, from.element, to.element, Date.now(), startedGeneration);
    }, motion.durationMs + extraMs);
    timers.push(finishTimer);
  }

  function beginAttachedMove(motion: CardMotion, plane: HTMLElement, startedGeneration: number) {
    const from = resolveAnchor(motion.from);
    const to = resolveAnchor(motion.to);
    if (!to) {
      return;
    }
    const serial = motion.from.kind === 'attached' ? motion.from.serial : undefined;
    const fromRect = from ? localRectIn(plane, from.geometry) : (serial !== undefined ? attachedRects.get(serial) ?? null : null);
    const toRect = localRectIn(plane, to.geometry);
    if (!fromRect || !toRect || fromRect.width <= 0 || toRect.width <= 0) {
      return;
    }

    const fromCenter = localRectCenter(fromRect);
    const toCenter = localRectCenter(toRect);
    const targetScale = Math.min(toRect.width / fromRect.width, toRect.height / fromRect.height);
    const targetRotation = to.element.closest('.top-piles') ? 180 : 0;
    const startRotation = from?.element.closest('.top-active-slot, .bench-row.opponent') ? 180 : targetRotation;
    applyClaims(motion);
    sprites = [...sprites, {
      id: motion.id,
      motion,
      left: fromCenter.x - fromRect.width / 2,
      top: fromCenter.y - fromRect.height / 2,
      width: fromRect.width,
      height: fromRect.height,
      vars: [
        `--attached-move-x: ${(toCenter.x - fromCenter.x).toFixed(1)}px`,
        `--attached-move-y: ${(toCenter.y - fromCenter.y).toFixed(1)}px`,
        `--attached-move-target-scale: ${(Number.isFinite(targetScale) && targetScale > 0 ? targetScale : 1).toFixed(3)}`,
        `--attached-move-start-rotation: ${startRotation}deg`,
        `--attached-move-target-rotation: ${targetRotation}deg`,
      ].join('; '),
      opponentSide: false,
      measuring: false,
    }];

    if (replayMode) {
      return;
    }
    const cleanupTimer = setTimeout(() => {
      if (startedGeneration !== generation) {
        return;
      }
      releaseMotion(motion.id);
      sprites = sprites.filter((item) => item.id !== motion.id);
    }, motion.durationMs + liveAttachedHoldMs);
    timers.push(cleanupTimer);
  }

  function beginDeckDiscard(motion: CardMotion, plane: HTMLElement, startedGeneration: number) {
    const from = resolveAnchor(motion.from);
    const to = resolveAnchor(motion.to);
    if (!from || !to) {
      return;
    }
    const pile = from.element;
    const pileRect = localRectIn(plane, pile);
    const toRect = localRectIn(plane, to.geometry);
    if (!pileRect || !toRect || pileRect.width <= 0) {
      return;
    }
    const pileStyle = getComputedStyle(pile);
    const startX = pileRect.left + cssPixelValue(pileStyle.getPropertyValue('--deck-top-x'));
    const startY = pileRect.top + cssPixelValue(pileStyle.getPropertyValue('--deck-top-y'));

    sprites = [...sprites, {
      id: motion.id,
      motion,
      left: startX,
      top: startY,
      width: pileRect.width,
      height: pileRect.height,
      vars: [
        `--discard-x: ${(toRect.left - startX).toFixed(1)}px`,
        `--discard-y: ${(toRect.top - startY).toFixed(1)}px`,
        `--base-rotation: ${pile.closest('.top-piles') ? 180 : 0}deg`,
        `z-index: ${++discardOrder}`,
      ].join('; '),
      opponentSide: false,
      measuring: false,
    }];

    if (replayMode) {
      return;
    }
    const cleanupTimer = setTimeout(() => {
      if (startedGeneration !== generation) {
        return;
      }
      sprites = sprites.filter((item) => item.id !== motion.id);
    }, motion.durationMs + 120);
    timers.push(cleanupTimer);
  }

  function applyClaims(motion: CardMotion) {
    const releases = motionReleases.get(motion.id) ?? [];
    for (const claim of motion.hide) {
      const resolved = resolveAnchor(claim.anchor);
      if (!resolved) {
        continue;
      }
      const release = animVisibility.claim(resolved.element, claim.mode);
      releases.push(release);
      scopeReleases.push(release);
    }
    motionReleases.set(motion.id, releases);
  }

  function releaseMotion(motionId: string) {
    const releases = motionReleases.get(motionId);
    if (!releases) {
      return;
    }
    motionReleases.delete(motionId);
    for (const release of releases) {
      release();
    }
  }

  function handOffWhenDestinationReady(
    motion: CardMotion,
    source: HTMLElement,
    target: HTMLElement,
    startTime: number,
    startedGeneration: number,
  ) {
    if (startedGeneration !== generation) {
      return;
    }
    const destinationReady = motion.waitForDestinationCard
      ? destinationContainsCard(target, motion.to)
      : motion.toDeck
        ? true
        : !!target.querySelector('.card-tile');
    const timedOut = Date.now() - startTime >= handoffMaxWaitMs;
    const detached = !document.body.contains(source) || !document.body.contains(target);
    if (destinationReady || timedOut || detached) {
      releaseMotion(motion.id);
      removeSpritesAfterPrepaint(new Set([motion.id]), startedGeneration);
      return;
    }
    const retry = setTimeout(() => {
      handOffWhenDestinationReady(motion, source, target, startTime, startedGeneration);
    }, handoffPollMs);
    timers.push(retry);
  }

  function destinationContainsCard(target: HTMLElement, anchor: Anchor): boolean {
    const serial = 'serial' in anchor ? anchor.serial : undefined;
    const cardId = 'cardId' in anchor ? anchor.cardId : undefined;
    const selector = serial !== undefined
      ? `.card-tile[data-card-serial="${serial}"]`
      : cardId !== undefined
        ? `.card-tile[data-card-id="${cardId}"]`
        : '.card-tile';
    return target.matches(selector) || !!target.querySelector(selector);
  }

  function endScope({ settle = false }: { settle?: boolean } = {}) {
    generation += 1;
    const cleanupGeneration = generation;
    for (const timer of timers) {
      clearTimeout(timer);
    }
    timers.length = 0;
    const releases = [...scopeReleases];
    scopeReleases.length = 0;
    motionReleases.clear();
    const spriteIds = new Set(sprites.map((sprite) => sprite.id));

    if (settle && (releases.length || spriteIds.size)) {
      const timer = setTimeout(() => {
        for (const release of releases) {
          release();
        }
        removeSpritesAfterPrepaint(spriteIds, cleanupGeneration);
        const timerIndex = settleTimers.indexOf(timer);
        if (timerIndex >= 0) {
          settleTimers.splice(timerIndex, 1);
        }
      }, settleMs);
      settleTimers.push(timer);
      return;
    }

    for (const release of releases) {
      release();
    }
    sprites = [];
  }

  function removeSpritesAfterPrepaint(spriteIds: Set<string>, cleanupGeneration: number) {
    if (!spriteIds.size) {
      return;
    }
    const firstFrameId = requestAnimationFrame(() => {
      removeSettleFrame(firstFrameId);
      const secondFrameId = requestAnimationFrame(() => {
        removeSettleFrame(secondFrameId);
        if (cleanupGeneration === generation) {
          sprites = sprites.filter((sprite) => !spriteIds.has(sprite.id));
        }
      });
      settleFrameIds.push(secondFrameId);
    });
    settleFrameIds.push(firstFrameId);
  }

  function removeSettleFrame(frameId: number) {
    const frameIndex = settleFrameIds.indexOf(frameId);
    if (frameIndex >= 0) {
      settleFrameIds.splice(frameIndex, 1);
    }
  }

  function measureSpriteCorrection(sprite: RenderSprite, target: HTMLElement) {
    const spriteElement = layerElement?.querySelector(`[data-board-move-id="${sprite.id}"] .card-tile`);
    if (!(spriteElement instanceof HTMLElement)) {
      return { x: 0, y: 0 };
    }
    const spriteRect = spriteElement.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const projectedScaleX = spriteRect.width / sprite.width;
    const projectedScaleY = spriteRect.height / sprite.height;
    return {
      x: projectedScaleX > 0 ? (targetRect.left - spriteRect.left) / projectedScaleX : 0,
      y: projectedScaleY > 0 ? (targetRect.top - spriteRect.top) / projectedScaleY : 0,
    };
  }

  function boardMoveVars(fromRect: LocalRect, toRect: LocalRect, correctionX: number, correctionY: number): string {
    return [
      `--board-move-source-slot-w: ${toRect.width}px`,
      `--board-move-start-x: ${(fromRect.left + fromRect.width / 2 - (toRect.left + toRect.width / 2)).toFixed(3)}px`,
      `--board-move-start-y: ${(fromRect.top + fromRect.height / 2 - (toRect.top + toRect.height / 2)).toFixed(3)}px`,
      `--board-move-start-scale: ${(fromRect.width / toRect.width).toFixed(6)}`,
      `--board-move-correction-x: ${correctionX.toFixed(3)}px`,
      `--board-move-correction-y: ${correctionY.toFixed(3)}px`,
    ].join('; ');
  }

  function isOpponentSide(element: HTMLElement): boolean {
    return !!element.closest('.top-active-slot, .bench-row.opponent, .top-stadium-card');
  }

  function planeElement(): HTMLElement | null {
    const plane = layerElement?.parentElement;
    return plane instanceof HTMLElement ? plane : null;
  }

  function cssPixelValue(value: string): number {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function spriteBaseStyle(sprite: RenderSprite): string {
    return [
      `left: ${sprite.left.toFixed(2)}px`,
      `top: ${sprite.top.toFixed(2)}px`,
      `width: ${sprite.width.toFixed(2)}px`,
      `height: ${sprite.height.toFixed(2)}px`,
      sprite.vars,
    ].join('; ');
  }

  let attachedSprites = $derived(sprites.filter((sprite) => sprite.motion.style === 'attached-move'));
  let discardSprites = $derived(sprites.filter((sprite) => sprite.motion.style === 'deck-discard'));
  let boardMoveSprites = $derived(sprites.filter((sprite) => sprite.motion.style === 'board-move'));
</script>

<span class="board-anim-layer" data-anim-layer style={cardBackCssVar()} bind:this={layerElement} aria-hidden="true">
  <span class="anim-sublayer attached-sublayer">
    {#each attachedSprites as sprite (sprite.id)}
      <span class="attached-move-sprite" style={spriteBaseStyle(sprite)}>
        <span class="attached-move-card">
          {#if sprite.motion.sprite.kind === 'card'}
            <CardTile card={sprite.motion.sprite.card} compact />
          {/if}
        </span>
      </span>
    {/each}
  </span>

  <span class="anim-sublayer discard-sublayer">
    {#each discardSprites as sprite (sprite.id)}
      <span class="deck-discard-card" style={spriteBaseStyle(sprite)}>
        <span class="deck-discard-card-inner">
          <span class="deck-discard-face deck-discard-back" style={cardBackCssVar()}></span>
          <span class="deck-discard-face deck-discard-front">
            {#if sprite.motion.sprite.kind === 'flip-card'}
              <CardTile card={sprite.motion.sprite.card} compact />
            {/if}
          </span>
        </span>
      </span>
    {/each}
  </span>

  <span class="anim-sublayer board-move-sublayer">
    {#each boardMoveSprites as sprite (sprite.id)}
      <span
        class="board-move-card"
        class:opponent-side={sprite.opponentSide}
        class:measuring={sprite.measuring}
        class:to-deck={sprite.motion.toDeck}
        data-board-move-id={sprite.id}
        style={spriteBaseStyle(sprite)}
      >
        <span class="board-move-card-inner">
          {#if sprite.motion.sprite.kind === 'slot'}
            <BoardSlot slot={sprite.motion.sprite.slot} active={sprite.motion.sprite.activeSize} />
          {:else if sprite.motion.sprite.kind === 'card'}
            <CardTile card={sprite.motion.sprite.card} compact />
          {/if}
        </span>
      </span>
    {/each}
  </span>
</span>

<style>
  .board-anim-layer {
    display: contents;
  }

  .anim-sublayer {
    position: absolute;
    inset: 0;
    display: block;
    overflow: visible;
    pointer-events: none;
    transform-style: preserve-3d;
  }

  .attached-sublayer {
    z-index: 3;
  }

  .discard-sublayer {
    z-index: 9;
  }

  .board-move-sublayer {
    z-index: 29;
  }

  /* Attached sprites slide out from under the owning Pokemon card. */
  :global(.game-board-plane .board-slot) {
    z-index: 4;
  }

  /* Central visibility manager output. `contents` empties a container while
     keeping its layout; `element` hides the element itself. */
  :global(.board-slot[data-anim-hidden]) {
    transition: none !important;
  }

  :global(.board-slot.empty[data-anim-hidden]) {
    border-color: transparent !important;
    background: transparent !important;
  }

  :global(.board-slot[data-anim-hidden] > .card-tile),
  :global(.board-slot[data-anim-hidden] > .pokemon-status),
  :global(.board-slot[data-anim-hidden] > .energy-badges),
  :global(.board-slot[data-anim-hidden] > .tool-card-preview),
  :global(.board-slot[data-anim-hidden] > .slot-badges),
  :global(.board-slot[data-anim-hidden] > .empty-zone) {
    opacity: 0;
  }

  :global([data-anim-hidden='element']) {
    opacity: 0;
  }

  .board-move-card {
    position: absolute;
    display: block;
    transform-origin: 50% 50%;
    transform-style: preserve-3d;
    animation: board-card-move 520ms cubic-bezier(0.22, 0.78, 0.2, 1) both;
    will-change: transform;
  }

  .board-move-card.measuring {
    opacity: 0;
    animation: none;
    transform: translate3d(0, 0, 0) scale(1);
  }

  .board-move-card-inner {
    position: relative;
    display: block;
    width: 100%;
    height: 100%;
    transform-style: preserve-3d;
  }

  .board-move-card.to-deck .board-move-card-inner {
    animation: board-card-flip-to-back 520ms ease-in-out both;
  }

  .board-move-card.to-deck .board-move-card-inner::after {
    content: "";
    position: absolute;
    inset: 0;
    border-radius: 5px;
    background:
      var(--card-back-image),
      radial-gradient(circle at 50% 45%, rgba(255, 255, 255, 0.9) 0 14%, rgba(255, 255, 255, 0) 15%),
      linear-gradient(145deg, #2563eb 0%, #1d4ed8 46%, #f59e0b 47%, #f59e0b 53%, #1d4ed8 54%, #1e3a8a 100%);
    background-size: cover;
    background-position: center;
    box-shadow: 0 3px 8px rgba(23, 30, 38, 0.28);
    backface-visibility: hidden;
    transform: rotateY(180deg) rotate(var(--board-move-back-rotation, 0deg));
  }

  .board-move-card.to-deck.opponent-side {
    --board-move-back-rotation: 180deg;
  }

  .board-move-card.to-deck .board-move-card-inner > :global(*) {
    backface-visibility: hidden;
  }

  .board-move-card :global(.card-tile) {
    width: 100%;
    height: 100%;
    pointer-events: none;
  }

  .board-move-card :global(.board-slot) {
    --slot-card-w: var(--board-move-source-slot-w);
    width: 100%;
    height: 100%;
    pointer-events: none;
    transition: none;
  }

  .board-move-card.opponent-side :global(.card-tile) {
    transform: rotate(180deg);
  }

  .board-move-card.opponent-side :global(.energy-badges) {
    inset: calc(var(--slot-card-w) * -0.095) 0 auto auto;
    justify-content: flex-end;
    transform: rotate(180deg);
  }

  .board-move-card.opponent-side :global(.energy-badges .attached-energy-symbol) {
    transform: rotate(180deg);
  }

  .board-move-card.opponent-side :global(.tool-card-preview) {
    inset: auto auto var(--tool-preview-top) 0;
    transform: rotate(180deg);
  }

  .board-move-card.opponent-side :global(.pokemon-status) {
    inset: auto auto 0 0;
    align-items: start;
    justify-items: start;
  }

  .board-move-card.opponent-side :global(.damage-counter-value) {
    transform: rotate(180deg);
  }

  @keyframes board-card-move {
    0% {
      transform:
        translate3d(
          calc(var(--board-move-start-x) + var(--board-move-correction-x)),
          calc(var(--board-move-start-y) + var(--board-move-correction-y)),
          0
        )
        scale(var(--board-move-start-scale));
    }
    100% {
      transform:
        translate3d(var(--board-move-correction-x), var(--board-move-correction-y), 0)
        scale(1);
    }
  }

  @keyframes board-card-flip-to-back {
    0%,
    36% {
      transform: rotateY(0deg);
    }
    100% {
      transform: rotateY(180deg);
    }
  }

  .attached-move-sprite {
    position: absolute;
    display: grid;
    place-items: center;
    transform-origin: center;
    animation: attached-card-move 360ms cubic-bezier(0.2, 0.82, 0.22, 1) both;
    will-change: transform, opacity;
  }

  .attached-move-card {
    display: block;
    width: 100%;
    height: 100%;
    overflow: hidden;
    border-radius: 5px;
    background: #f7f8fa;
    box-shadow:
      0 12px 26px rgba(23, 30, 38, 0.24),
      0 0 0 1px rgba(18, 21, 26, 0.18);
    pointer-events: none;
  }

  .attached-move-card :global(.card-tile) {
    width: 100%;
    height: 100%;
    pointer-events: none;
  }

  @keyframes attached-card-move {
    0% {
      opacity: 0;
      transform:
        translate3d(0, 0, 0)
        rotate(var(--attached-move-start-rotation))
        scale(1);
    }
    8% {
      opacity: 1;
      transform:
        translate3d(0, 0, 0)
        rotate(var(--attached-move-start-rotation))
        scale(1);
    }
    88%,
    100% {
      opacity: 1;
      transform:
        translate3d(var(--attached-move-x), var(--attached-move-y), 0)
        rotate(var(--attached-move-target-rotation))
        scale(var(--attached-move-target-scale));
    }
  }

  .deck-discard-card {
    position: absolute;
    display: block;
    border-radius: 5px;
    pointer-events: none;
    transform-style: preserve-3d;
    animation: deck-discard-travel 300ms cubic-bezier(0.24, 0.78, 0.24, 1) both;
    will-change: transform, opacity;
  }

  .deck-discard-card-inner {
    position: absolute;
    inset: 0;
    display: block;
    border-radius: inherit;
    transform-style: preserve-3d;
    animation: deck-discard-flip 300ms ease-in-out both;
    will-change: transform;
  }

  .deck-discard-face {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    overflow: hidden;
    border-radius: inherit;
    box-shadow:
      0 8px 18px rgba(23, 30, 38, 0.24),
      0 0 0 1px rgba(18, 21, 26, 0.18);
    backface-visibility: hidden;
  }

  .deck-discard-back {
    background:
      var(--card-back-image, var(--cardback-shade)),
      linear-gradient(135deg, rgba(255, 255, 255, 0.1), transparent 28%),
      repeating-linear-gradient(45deg, rgba(255, 255, 255, 0.08) 0 6px, transparent 6px 12px),
      linear-gradient(145deg, #203654, #111a2c);
    background-size: cover, auto, auto, auto;
    background-position: center;
  }

  .deck-discard-front {
    transform: rotateY(180deg);
    background: #f7f8fa;
  }

  .deck-discard-front :global(.card-tile) {
    width: 100%;
    height: 100%;
  }

  @keyframes deck-discard-travel {
    0% {
      opacity: 0;
      transform: translate3d(0, 0, 0) rotate(var(--base-rotation));
    }
    1% {
      opacity: 1;
      transform: translate3d(0, 0, 0) rotate(var(--base-rotation));
    }
    10% {
      opacity: 1;
      transform: translate3d(0, 0, 0) rotate(var(--base-rotation));
    }
    55% {
      opacity: 1;
      transform: translate3d(calc(var(--discard-x) * 0.58), calc(var(--discard-y) * 0.58 - 10px), 0) rotate(var(--base-rotation));
    }
    86% {
      opacity: 1;
      transform: translate3d(var(--discard-x), var(--discard-y), 0) rotate(var(--base-rotation));
    }
    96% {
      opacity: 1;
      transform: translate3d(var(--discard-x), var(--discard-y), 0) rotate(var(--base-rotation));
    }
    100% {
      opacity: 0;
      transform: translate3d(var(--discard-x), var(--discard-y), 0) rotate(var(--base-rotation));
    }
  }

  @keyframes deck-discard-flip {
    0% {
      transform: rotateY(0deg);
    }
    72%,
    100% {
      transform: rotateY(180deg);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .board-move-card,
    .attached-move-sprite,
    .deck-discard-card,
    .deck-discard-card-inner {
      animation: none;
    }
  }
</style>
