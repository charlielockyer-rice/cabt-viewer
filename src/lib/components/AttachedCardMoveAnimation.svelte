<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import {
    resolveExactAnimationAnchorElement,
    resolveAnimationAnchorElements,
    type AnimationAnchorRef,
    type AnimationIdentity,
  } from '../animations/animationAnchors';
  import {
    hideElementForAnimation,
    releaseElementVisibilityClaim,
    type ElementVisibilityClaim,
  } from '../animations/animationVisibilityClaims';
  import type { AnimationVisibilityRole } from '../animations/animationVisibility';
  import type { CardMoveAnimationMotion, ReplayAnimationPhasePlan } from '../animations/replayAnimationPlan';
  import { actionAnimationBatchEvents, actionAnimationStartMs, actionAnimationTiming } from '../cabt/actionAnimationSchedule';
  import { cabtCardToView } from '../cabt/cardView';
  import { CabtAreaType } from '../cabt/types';
  import { elementRectInPlane, type PlaneRect } from '../dom/planeGeometry';
  import { cardFaceImageUrl } from '../game/cardAssets';
  import { replayAnimationPhaseGapMs } from '../game/replay';
  import type { ActionTimelineEvent } from '../game/types';

  type Props = {
    events?: ActionTimelineEvent[];
    scopeKey?: string | number;
    replayMode?: boolean;
    animationPlan?: ReplayAnimationPhasePlan;
  };

  type AttachedMoveSprite = {
    id: string;
    imageUrl: string;
    label: string;
    setLabel: string;
    typeClass: string;
    left: number;
    top: number;
    width: number;
    height: number;
    moveX: number;
    moveY: number;
    startScale: number;
    targetScale: number;
    startRotation: number;
    targetRotation: number;
    delayMs: number;
    durationMs: number;
    hiddenElement?: HTMLElement;
    destinationCardElement?: HTMLElement;
    planned: boolean;
  };

  type ActiveAttachedMoveSprite = AttachedMoveSprite & {
    element: HTMLElement;
    visibilityClaims: ElementVisibilityClaim[];
  };

  type AttachedMoveSource = {
    rect: RectSnapshot;
    hiddenElement?: HTMLElement;
  };

  type RectSnapshot = PlaneRect;

  let {
    events = [],
    scopeKey = '',
    replayMode = false,
    animationPlan,
  }: Props = $props();

  const timers: ReturnType<typeof setTimeout>[] = [];
  let snapshotTimer: ReturnType<typeof setInterval> | undefined;
  let previousAttachedRects = new Map<number, RectSnapshot>();
  let motionLayer = $state<HTMLElement>();
  let seenEventIds = new Set<number>();
  let initialized = false;
  let lastScopeKey: string | number = '';
  let lastPlanKey = '';
  let reduceMotion = $state(false);
  let activeSprites: ActiveAttachedMoveSprite[] = [];

  onMount(() => {
    if (typeof window.matchMedia !== 'function') {
      return;
    }
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const updateMotionPreference = () => {
      reduceMotion = media.matches;
    };
    updateMotionPreference();
    media.addEventListener('change', updateMotionPreference);
    snapshotTimer = setInterval(() => {
      const nextRects = snapshotAttachedRects();
      if (nextRects.size) {
        previousAttachedRects = nextRects;
      }
    }, 100);
    return () => {
      media.removeEventListener('change', updateMotionPreference);
      if (snapshotTimer) {
        clearInterval(snapshotTimer);
      }
    };
  });

  onDestroy(() => {
    clearSprites();
  });

  $effect(() => {
    syncMotionLayerParent();
  });

  $effect(() => {
    const currentEvents = events;
    const currentScopeKey = scopeKey;
    const currentPlan = animationPlan;
    const planKey = currentPlanKey(currentPlan);
    const plannedMotions = attachedCardMoveMotions(currentPlan);
    const scopeChanged = initialized && currentScopeKey !== lastScopeKey;
    const planChanged = planKey !== lastPlanKey;
    if (scopeChanged || (plannedMotions.length && planChanged)) {
      clearSprites();
    }
    lastScopeKey = currentScopeKey;
    lastPlanKey = planKey;

    if (plannedMotions.length) {
      const shouldStartPlan = !initialized || planChanged || scopeChanged;
      initialized = true;
      previousAttachedRects = snapshotAttachedRects();
      if (shouldStartPlan && !reduceMotion) {
        startAttachedSprites(plannedMotions.flatMap(spriteForMotion));
      }
      markEventsSeen(currentEvents);
      return;
    }

    if (!initialized) {
      markEventsSeen(currentEvents);
      initialized = true;
      previousAttachedRects = snapshotAttachedRects();
      return;
    }

    if (replayMode) {
      markEventsSeen(currentEvents);
      previousAttachedRects = snapshotAttachedRects();
      return;
    }

    const animationEvents = actionAnimationBatchEvents(currentEvents, seenEventIds);
    const moveEvents = animationEvents.filter((event) =>
      isAttachedMoveEvent(event)
      && !seenEventIds.has(event.id));

    markEventsSeen(currentEvents);

    if (moveEvents.length) {
      startAttachedMoves(moveEvents, animationEvents);
    }
    previousAttachedRects = snapshotAttachedRects();
  });

  function markEventsSeen(currentEvents: ActionTimelineEvent[]) {
    for (const event of currentEvents) {
      seenEventIds.add(event.id);
    }
  }

  function startAttachedMoves(moveEvents: ActionTimelineEvent[], animationEvents: ActionTimelineEvent[]): boolean {
    if (reduceMotion) {
      return false;
    }

    return startAttachedSprites(moveEvents.flatMap((event) => spriteForEvent(event, animationEvents)));
  }

  function startAttachedSprites(nextSprites: AttachedMoveSprite[]): boolean {
    if (!nextSprites.length) {
      return false;
    }

    clearSprites();
    for (const sprite of nextSprites) {
      const element = renderSprite(sprite);
      motionLayer?.appendChild(element);
      const activeSprite: ActiveAttachedMoveSprite = {
        ...sprite,
        element,
        visibilityClaims: [],
      };
      activeSprites = [...activeSprites, activeSprite];
      const startTimer = setTimeout(() => {
        if (!activeSprite.planned && activeSprite.hiddenElement) {
          hideActiveElement(
            activeSprite,
            activeSprite.hiddenElement,
            'source',
            'data-attached-move-animation-hidden',
          );
        }
        if (!activeSprite.planned && activeSprite.destinationCardElement) {
          hideActiveElement(
            activeSprite,
            activeSprite.destinationCardElement,
            'destination',
            'data-attached-move-destination-card-hidden',
          );
        }
      }, sprite.delayMs);
      const cleanupTimer = setTimeout(() => {
        releaseActiveSprite(activeSprite);
        element.remove();
        activeSprites = activeSprites.filter((item) => item.element !== element);
      }, sprite.delayMs + sprite.durationMs + replayHandoffHoldMs());
      timers.push(startTimer, cleanupTimer);
    }
    return true;
  }

  function currentPlanKey(plan: ReplayAnimationPhasePlan | undefined) {
    return plan ? `${plan.key}:${plan.motions.map((motion) => motion.id).join(',')}` : '';
  }

  function attachedCardMoveMotions(plan: ReplayAnimationPhasePlan | undefined): CardMoveAnimationMotion[] {
    return (plan?.motions ?? []).filter((motion): motion is CardMoveAnimationMotion =>
      motion.kind === 'card-move'
      && motion.coordinateSpace === 'board'
      && (motion.sourceAnchor.kind === 'attached-energy' || motion.sourceAnchor.kind === 'attached-tool'));
  }

  function spriteForMotion(motion: CardMoveAnimationMotion): AttachedMoveSprite[] {
    const source = sourceForAnchor(motion.sourceAnchor, 'planned');
    const target = targetElementForAnchor(motion.targetAnchor, 'planned');
    const boardPlane = boardPlaneElement();
    if (!source || !target || !boardPlane) {
      return [];
    }

    return spritesForResolvedMove({
      id: motion.id,
      source,
      target,
      identity: motion.identity,
      delayMs: motion.startMs,
      durationMs: motion.durationMs,
      planned: true,
    });
  }

  function spriteForEvent(event: ActionTimelineEvent, animationEvents: ActionTimelineEvent[]): AttachedMoveSprite[] {
    const params = event.params as Record<string, unknown> | undefined;
    const source = sourceForEvent(event);
    const target = targetElementForEvent(event);
    const serial = Number(params?.serial);
    const cardId = Number(params?.cardId);
    return spritesForResolvedMove({
      id: `${event.id}-${Number.isFinite(serial) ? serial : cardId}`,
      source,
      target,
      identity: {
        kind: Number(params?.fromArea) === CabtAreaType.TOOL ? 'tool' : 'energy',
        serial: Number.isFinite(serial) ? serial : undefined,
        cardId: Number.isFinite(cardId) ? cardId : undefined,
      },
      delayMs: actionAnimationStartMs(animationEvents, event),
      durationMs: actionAnimationTiming.handMoveMs,
      planned: false,
    });
  }

  function spritesForResolvedMove(input: {
    id: string;
    source: AttachedMoveSource | null;
    target: HTMLElement | null;
    identity?: AnimationIdentity;
    delayMs: number;
    durationMs: number;
    planned: boolean;
  }): AttachedMoveSprite[] {
    const source = input.source;
    const target = input.target;
    const boardPlane = boardPlaneElement();
    if (!source || !target || !boardPlane) {
      return [];
    }

    const sourceRect = source.rect;
    const targetRect = elementRectInPlane(target, boardPlane);
    if (!targetRect) {
      return [];
    }
    if (sourceRect.width <= 0 || sourceRect.height <= 0 || targetRect.width <= 0 || targetRect.height <= 0) {
      return [];
    }

    const sourceCenter = centerOf(sourceRect);
    const targetCenter = centerOf(targetRect);
    const serial = input.identity?.serial;
    const cardId = input.identity?.cardId;
    const card = cardId !== undefined ? cabtCardToView(cardId) : undefined;
    const width = sourceRect.width;
    const height = sourceRect.height;
    const targetScale = Math.min(targetRect.width / sourceRect.width, targetRect.height / sourceRect.height);
    const targetRotation = targetRotationFor(target);
    return [{
      id: input.id,
      imageUrl: card ? (cardFaceImageUrl(card) ?? '') : '',
      label: card?.name ?? input.identity?.name ?? 'Card',
      setLabel: card ? [card.set, card.setNumber].filter(Boolean).join(' ') : '',
      typeClass: input.identity?.kind === 'energy' || card?.energyType !== undefined || card?.superType === 'Energy' || card?.name.includes('Energy')
        ? 'energy'
        : input.identity?.kind === 'tool' || card?.trainerType !== undefined || card?.superType === 'Trainer'
          ? 'trainer'
          : 'pokemon',
      left: sourceCenter.x - width / 2,
      top: sourceCenter.y - height / 2,
      width,
      height,
      moveX: targetCenter.x - sourceCenter.x,
      moveY: targetCenter.y - sourceCenter.y,
      startScale: 1,
      targetScale: Number.isFinite(targetScale) && targetScale > 0 ? targetScale : 1,
      startRotation: source.hiddenElement ? sourceRotationFor(source.hiddenElement) : targetRotation,
      targetRotation,
      delayMs: input.delayMs,
      durationMs: input.durationMs,
      hiddenElement: source.hiddenElement,
      destinationCardElement: destinationCardElementFor(target, serial, cardId),
      planned: input.planned,
    }];
  }

  function replayHandoffHoldMs() {
    return replayMode ? replayAnimationPhaseGapMs + 40 : 90;
  }

  function isAttachedMoveEvent(event: ActionTimelineEvent): boolean {
    const params = event.params as Record<string, unknown> | undefined;
    return event.kind === 'MoveCard'
      && (
        Number(params?.fromArea) === CabtAreaType.ENERGY
        || Number(params?.fromArea) === CabtAreaType.TOOL
      )
      && (
        Number(params?.toArea) === CabtAreaType.DISCARD
        || Number(params?.toArea) === CabtAreaType.DECK
      );
  }

  function sourceForAnchor(anchor: AnimationAnchorRef, mode: 'planned' | 'live' = 'live'): AttachedMoveSource | null {
    if (anchor.kind !== 'attached-energy' && anchor.kind !== 'attached-tool') {
      return null;
    }
    const element = mode === 'planned' ? exactElementForAnchor(anchor) : elementForAnchor(anchor);
    if (!element) {
      if (mode === 'planned') {
        return null;
      }
      return anchor.serial !== undefined ? previousSourceForSerial(anchor.serial) : null;
    }
    const boardPlane = boardPlaneElement();
    if (!boardPlane) {
      if (mode === 'planned') {
        return null;
      }
      return anchor.serial !== undefined ? previousSourceForSerial(anchor.serial) : null;
    }
    const ownerCard = ownerPokemonCardElement(element);
    const rect = ownerCard ? elementRectInPlane(ownerCard, boardPlane) : elementRectInPlane(element, boardPlane);
    if (rect) {
      return { rect, hiddenElement: element };
    }
    if (mode === 'planned') {
      return null;
    }
    return anchor.serial !== undefined ? previousSourceForSerial(anchor.serial) : null;
  }

  function sourceForEvent(event: ActionTimelineEvent): AttachedMoveSource | null {
    const params = event.params as Record<string, unknown> | undefined;
    const serial = Number(params?.serial);
    const fromArea = Number(params?.fromArea);
    if (!Number.isFinite(serial)) {
      return null;
    }
    const boardPlane = boardPlaneElement();
    if (!boardPlane) {
      return previousSourceForSerial(serial);
    }
    if (fromArea === CabtAreaType.ENERGY) {
      const visibleEnergy = document.querySelector(`[data-energy-serial="${serial}"]`);
      if (visibleEnergy instanceof HTMLElement) {
        const ownerCard = ownerPokemonCardElement(visibleEnergy);
        const rect = ownerCard ? elementRectInPlane(ownerCard, boardPlane) : elementRectInPlane(visibleEnergy, boardPlane);
        if (!rect) {
          return previousSourceForSerial(serial);
        }
        return {
          rect,
          hiddenElement: visibleEnergy,
        };
      }
      return previousSourceForSerial(serial);
    }
    if (fromArea === CabtAreaType.TOOL) {
      const visibleTool = document.querySelector(`[data-tool-serial="${serial}"]`);
      if (visibleTool instanceof HTMLElement) {
        const ownerCard = ownerPokemonCardElement(visibleTool);
        const rect = ownerCard ? elementRectInPlane(ownerCard, boardPlane) : elementRectInPlane(visibleTool, boardPlane);
        if (!rect) {
          return previousSourceForSerial(serial);
        }
        return {
          rect,
          hiddenElement: visibleTool,
        };
      }
      return previousSourceForSerial(serial);
    }
    return null;
  }

  function previousSourceForSerial(serial: number): AttachedMoveSource | null {
    const rect = previousAttachedRects.get(serial);
    return rect ? { rect } : null;
  }

  function targetElementForEvent(event: ActionTimelineEvent): HTMLElement | null {
    const params = event.params as Record<string, unknown> | undefined;
    const playerIndex = event.playerIndex;
    if (playerIndex === undefined) {
      return null;
    }
    const toArea = Number(params?.toArea);
    if (toArea === CabtAreaType.DISCARD) {
      return discardTopElementForPlayer(playerIndex)
        ?? document.querySelector(`[data-card-anchor="player:${playerIndex}:discard"]`);
    }
    if (toArea === CabtAreaType.DECK) {
      const anchor = document.querySelector(`[data-card-anchor="player:${playerIndex}:deck"]`);
      return anchor?.closest('.deck-pile') as HTMLElement | null;
    }
    return null;
  }

  function targetElementForAnchor(anchor: AnimationAnchorRef, mode: 'planned' | 'live' = 'live'): HTMLElement | null {
    const element = mode === 'planned' ? exactElementForAnchor(anchor) : elementForAnchor(anchor);
    if (!element) {
      return null;
    }
    if (anchor.kind === 'deck-top') {
      return element.closest('.deck-pile') as HTMLElement | null;
    }
    return element;
  }

  function exactElementForAnchor(anchor: AnimationAnchorRef): HTMLElement | null {
    return resolveExactAnimationAnchorElement(anchor);
  }

  function elementForAnchor(anchor: AnimationAnchorRef): HTMLElement | null {
    const exact = resolveExactAnimationAnchorElement(anchor);
    if (exact) {
      return exact;
    }
    if ('serial' in anchor && anchor.serial !== undefined) {
      const fallbackAnchor = { ...anchor, serial: undefined } as AnimationAnchorRef;
      return resolveAnimationAnchorElements(fallbackAnchor).at(0) ?? null;
    }
    return null;
  }

  function targetRotationFor(target: HTMLElement): number {
    return target.closest('.top-piles') ? 180 : 0;
  }

  function sourceRotationFor(source: HTMLElement): number {
    return source.closest('.top-active-slot, .bench-row.opponent') ? 180 : 0;
  }

  function ownerPokemonCardElement(attachedElement: Element): HTMLElement | null {
    const slot = attachedElement.closest('.board-slot');
    const card = slot?.querySelector('.card-tile');
    return card instanceof HTMLElement ? card : null;
  }

  function discardTopElementForPlayer(playerIndex: number): HTMLElement | null {
    const discard = document.querySelector(`[data-card-anchor="player:${playerIndex}:discard"]`);
    const topCard = discard?.querySelector('.discard-card-top .card-tile');
    if (topCard instanceof HTMLElement) {
      return topCard;
    }
    const stack = discard?.querySelector('.discard-card-top');
    return stack instanceof HTMLElement ? stack : null;
  }

  function clearSprites() {
    for (const timer of timers) {
      clearTimeout(timer);
    }
    timers.length = 0;
    for (const sprite of activeSprites) {
      releaseActiveSprite(sprite);
      sprite.element.remove();
    }
    activeSprites = [];
  }

  function hideActiveElement(
    sprite: ActiveAttachedMoveSprite,
    element: HTMLElement,
    role: AnimationVisibilityRole,
    fallbackAttribute: string,
  ) {
    sprite.visibilityClaims.push(hideElementForAnimation({
      element,
      scopeKey,
      role,
      fallbackAttribute,
    }));
  }

  function releaseActiveSprite(sprite: ActiveAttachedMoveSprite) {
    for (const claim of sprite.visibilityClaims) {
      releaseElementVisibilityClaim(claim);
    }
    sprite.visibilityClaims = [];
  }

  function snapshotAttachedRects(): Map<number, RectSnapshot> {
    const nextRects = new Map<number, RectSnapshot>();
    const boardPlane = boardPlaneElement();
    if (!boardPlane) {
      return nextRects;
    }
    for (const element of document.querySelectorAll('[data-energy-serial], [data-tool-serial]')) {
      if (!(element instanceof HTMLElement)) {
        continue;
      }
      const serial = Number(element.dataset.energySerial ?? element.dataset.toolSerial);
      if (!Number.isFinite(serial)) {
        continue;
      }
      const ownerCard = ownerPokemonCardElement(element);
      const rect = ownerCard ? elementRectInPlane(ownerCard, boardPlane) : elementRectInPlane(element, boardPlane);
      if (rect) {
        nextRects.set(serial, rect);
      }
    }
    return nextRects;
  }

  function boardPlaneElement(): HTMLElement | null {
    const plane = motionLayer?.parentElement;
    return plane instanceof HTMLElement ? plane : null;
  }

  function syncMotionLayerParent() {
    if (!motionLayer) {
      return;
    }
    const plane = document.querySelector('.game-board-plane');
    if (plane instanceof HTMLElement && motionLayer.parentElement !== plane) {
      plane.appendChild(motionLayer);
    }
  }

  function destinationCardElementFor(target: HTMLElement, serial: number, cardId: number): HTMLElement | undefined {
    const selector = Number.isFinite(serial)
      ? `[data-card-serial="${serial}"]`
      : Number.isFinite(cardId)
        ? `[data-card-id="${cardId}"]`
        : '';
    if (!selector) {
      return undefined;
    }
    if (target.matches(selector)) {
      return target;
    }
    const card = target.querySelector(selector);
    return card instanceof HTMLElement ? card : undefined;
  }

  function centerOf(rect: RectSnapshot): { x: number; y: number } {
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    };
  }

  function spriteStyle(sprite: AttachedMoveSprite): string {
    return [
      `left: ${sprite.left}px`,
      `top: ${sprite.top}px`,
      `width: ${sprite.width}px`,
      `height: ${sprite.height}px`,
      `--attached-move-x: ${sprite.moveX.toFixed(1)}px`,
      `--attached-move-y: ${sprite.moveY.toFixed(1)}px`,
      `--attached-move-start-scale: ${sprite.startScale.toFixed(3)}`,
      `--attached-move-target-scale: ${sprite.targetScale.toFixed(3)}`,
      `--attached-move-start-rotation: ${sprite.startRotation.toFixed(1)}deg`,
      `--attached-move-target-rotation: ${sprite.targetRotation.toFixed(1)}deg`,
      `--attached-move-delay: ${sprite.delayMs}ms`,
      `--attached-move-duration: ${sprite.durationMs}ms`,
    ].join('; ');
  }

  function renderSprite(sprite: AttachedMoveSprite): HTMLElement {
    const outer = document.createElement('span');
    outer.className = 'attached-move-sprite';
    outer.setAttribute('style', spriteStyle(sprite));
    const card = document.createElement('span');
    card.className = `attached-move-card ${sprite.typeClass}`;
    if (sprite.imageUrl) {
      const image = document.createElement('img');
      image.src = sprite.imageUrl;
      image.alt = '';
      image.draggable = false;
      image.loading = 'eager';
      image.decoding = 'sync';
      card.appendChild(image);
    } else {
      const fallback = document.createElement('span');
      fallback.className = 'fallback-card';
      const name = document.createElement('span');
      name.className = 'fallback-name';
      name.textContent = sprite.label;
      fallback.appendChild(name);
      if (sprite.setLabel) {
        const set = document.createElement('span');
        set.className = 'fallback-set';
        set.textContent = sprite.setLabel;
        fallback.appendChild(set);
      }
      card.appendChild(fallback);
    }
    outer.appendChild(card);
    return outer;
  }

</script>

<span class="attached-card-move-animation" bind:this={motionLayer} aria-hidden="true">
</span>

<style>
  .attached-card-move-animation {
    position: absolute;
    inset: 0;
    z-index: 3;
    overflow: visible;
    pointer-events: none;
    transform-style: preserve-3d;
  }

  :global(.game-board-plane .board-slot) {
    z-index: 4;
  }

  :global(.attached-move-sprite) {
    position: absolute;
    display: grid;
    place-items: center;
    transform-origin: center;
    animation: attached-card-move var(--attached-move-duration, 360ms) cubic-bezier(0.2, 0.82, 0.22, 1) var(--attached-move-delay) both;
    will-change: transform, opacity;
  }

  :global(.attached-move-card) {
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

  :global(.attached-move-card img) {
    width: 100%;
    height: 100%;
    display: block;
    object-fit: fill;
    pointer-events: none;
    -webkit-user-drag: none;
  }

  :global(.attached-move-card .fallback-card) {
    display: grid;
    grid-template-rows: 1fr auto;
    align-items: center;
    justify-items: center;
    height: 100%;
    padding: 9%;
    background: linear-gradient(145deg, #f8fafc, #d7dee8);
    color: #18212d;
    box-sizing: border-box;
  }

  :global(.attached-move-card.energy .fallback-card) {
    background: linear-gradient(145deg, #fff6c2, #dfc04d);
  }

  :global(.attached-move-card .fallback-name) {
    display: -webkit-box;
    max-width: 100%;
    overflow: hidden;
    text-align: center;
    font-size: 12px;
    font-weight: 950;
    line-height: 1.08;
    overflow-wrap: anywhere;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 5;
  }

  :global(.attached-move-card .fallback-set) {
    max-width: 100%;
    overflow: hidden;
    color: rgba(24, 33, 45, 0.68);
    font-size: 9px;
    font-weight: 850;
    text-overflow: ellipsis;
    text-transform: uppercase;
    white-space: nowrap;
  }

  :global([data-attached-move-animation-hidden='true']) {
    opacity: 0;
  }

  :global([data-attached-move-destination-card-hidden='true']) {
    visibility: hidden;
  }

  @keyframes attached-card-move {
    0% {
      opacity: 0;
      transform:
        translate3d(0, 0, 0)
        rotate(var(--attached-move-start-rotation))
        scale(var(--attached-move-start-scale));
    }
    8% {
      opacity: 1;
      transform:
        translate3d(0, 0, 0)
        rotate(var(--attached-move-start-rotation))
        scale(var(--attached-move-start-scale));
    }
    88% {
      opacity: 1;
      transform:
        translate3d(var(--attached-move-x), var(--attached-move-y), 0)
        rotate(var(--attached-move-target-rotation))
        scale(var(--attached-move-target-scale));
    }
    100% {
      opacity: 1;
      transform:
        translate3d(var(--attached-move-x), var(--attached-move-y), 0)
        rotate(var(--attached-move-target-rotation))
        scale(var(--attached-move-target-scale));
    }
  }

</style>
