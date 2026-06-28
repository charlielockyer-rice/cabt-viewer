<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { actionAnimationBatchEvents, actionAnimationStartMs, actionAnimationTiming } from '../cabt/actionAnimationSchedule';
  import { cabtCardToView } from '../cabt/cardView';
  import { CabtAreaType } from '../cabt/types';
  import { cardFaceImageUrl } from '../game/cardAssets';
  import { replayAnimationPhaseGapMs } from '../game/replay';
  import type { ActionTimelineEvent } from '../game/types';

  type Props = {
    events?: ActionTimelineEvent[];
    scopeKey?: string | number;
    replayMode?: boolean;
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
    hiddenElement?: HTMLElement;
    destinationCardElement?: HTMLElement;
  };

  type ActiveAttachedMoveSprite = AttachedMoveSprite & {
    element: HTMLElement;
  };

  type AttachedMoveSource = {
    rect: RectSnapshot;
    hiddenElement?: HTMLElement;
  };

  type RectSnapshot = {
    left: number;
    top: number;
    width: number;
    height: number;
  };

  let {
    events = [],
    scopeKey = '',
    replayMode = false,
  }: Props = $props();

  const timers: ReturnType<typeof setTimeout>[] = [];
  let snapshotTimer: ReturnType<typeof setInterval> | undefined;
  let previousAttachedRects = new Map<number, RectSnapshot>();
  let motionLayer = $state<HTMLElement>();
  let seenEventIds = new Set<number>();
  let initialized = false;
  let lastScopeKey: string | number = '';
  let lastAnimatedReplayScopeKey: string | number = '';
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
    const scopeChanged = initialized && currentScopeKey !== lastScopeKey;
    if (scopeChanged && replayMode) {
      lastAnimatedReplayScopeKey = '';
    }
    lastScopeKey = currentScopeKey;

    if (!initialized) {
      for (const event of currentEvents) {
        seenEventIds.add(event.id);
      }
      initialized = true;
      previousAttachedRects = snapshotAttachedRects();
      if (!replayMode || !currentEvents.some(isAttachedMoveEvent)) {
        return;
      }
    }

    const animationEvents = replayMode && currentScopeKey !== lastAnimatedReplayScopeKey
      ? currentEvents
      : actionAnimationBatchEvents(currentEvents, seenEventIds, replayMode, scopeChanged);
    const moveEvents = animationEvents.filter((event) =>
      isAttachedMoveEvent(event)
      && (
        (replayMode && currentScopeKey !== lastAnimatedReplayScopeKey)
        || !seenEventIds.has(event.id)
      ));

    for (const event of currentEvents) {
      seenEventIds.add(event.id);
    }

    if (moveEvents.length) {
      const started = startAttachedMoves(moveEvents, animationEvents);
      if (started && replayMode) {
        lastAnimatedReplayScopeKey = currentScopeKey;
      }
    }
    previousAttachedRects = snapshotAttachedRects();
  });

  function startAttachedMoves(moveEvents: ActionTimelineEvent[], animationEvents: ActionTimelineEvent[]): boolean {
    if (reduceMotion) {
      return false;
    }

    const nextSprites = moveEvents.flatMap((event) => spriteForEvent(event, animationEvents));
    if (!nextSprites.length) {
      return false;
    }

    clearSprites();
    for (const sprite of nextSprites) {
      const element = renderSprite(sprite);
      motionLayer?.appendChild(element);
      activeSprites = [...activeSprites, { ...sprite, element }];
      const startTimer = setTimeout(() => {
        if (sprite.hiddenElement) {
          sprite.hiddenElement.dataset.attachedMoveAnimationHidden = 'true';
        }
        if (sprite.destinationCardElement) {
          sprite.destinationCardElement.dataset.attachedMoveDestinationCardHidden = 'true';
        }
      }, sprite.delayMs);
      const cleanupTimer = setTimeout(() => {
        if (sprite.hiddenElement) {
          delete sprite.hiddenElement.dataset.attachedMoveAnimationHidden;
        }
        if (sprite.destinationCardElement) {
          delete sprite.destinationCardElement.dataset.attachedMoveDestinationCardHidden;
        }
        element.remove();
        activeSprites = activeSprites.filter((item) => item.element !== element);
      }, sprite.delayMs + actionAnimationTiming.handMoveMs + replayHandoffHoldMs());
      timers.push(startTimer, cleanupTimer);
    }
    return true;
  }

  function spriteForEvent(event: ActionTimelineEvent, animationEvents: ActionTimelineEvent[]): AttachedMoveSprite[] {
    const params = event.params as Record<string, unknown> | undefined;
    const source = sourceForEvent(event);
    const target = targetElementForEvent(event);
    const boardPlane = boardPlaneElement();
    if (!source || !target || !boardPlane) {
      return [];
    }

    const sourceRect = source.rect;
    const targetRect = localElementRect(target, boardPlane);
    if (!targetRect) {
      return [];
    }
    if (sourceRect.width <= 0 || sourceRect.height <= 0 || targetRect.width <= 0 || targetRect.height <= 0) {
      return [];
    }

    const sourceCenter = centerOf(sourceRect);
    const targetCenter = centerOf(targetRect);
    const serial = Number(params?.serial);
    const cardId = Number(params?.cardId);
    const card = cabtCardToView(cardId);
    const width = sourceRect.width;
    const height = sourceRect.height;
    const targetScale = Math.min(targetRect.width / sourceRect.width, targetRect.height / sourceRect.height);
    const targetRotation = targetRotationFor(target);
    return [{
      id: `${event.id}-${Number.isFinite(serial) ? serial : cardId}`,
      imageUrl: cardFaceImageUrl(card) ?? '',
      label: card.name,
      setLabel: [card.set, card.setNumber].filter(Boolean).join(' '),
      typeClass: card.energyType !== undefined || card.superType === 'Energy' || card.name.includes('Energy')
        ? 'energy'
        : card.trainerType !== undefined || card.superType === 'Trainer'
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
      delayMs: actionAnimationStartMs(animationEvents, event),
      hiddenElement: source.hiddenElement,
      destinationCardElement: destinationCardElementFor(target, serial, cardId),
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
        || Number(params?.toArea) === CabtAreaType.HAND
        || Number(params?.toArea) === CabtAreaType.DECK
      );
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
        const rect = ownerCard ? localElementRect(ownerCard, boardPlane) : localElementRect(visibleEnergy, boardPlane);
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
        const rect = ownerCard ? localElementRect(ownerCard, boardPlane) : localElementRect(visibleTool, boardPlane);
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
    if (toArea === CabtAreaType.HAND) {
      return document.querySelector(`[data-card-anchor="player:${playerIndex}:hand"]`);
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
      if (sprite.hiddenElement) {
        delete sprite.hiddenElement.dataset.attachedMoveAnimationHidden;
      }
      if (sprite.destinationCardElement) {
        delete sprite.destinationCardElement.dataset.attachedMoveDestinationCardHidden;
      }
      sprite.element.remove();
    }
    activeSprites = [];
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
      const rect = ownerCard ? localElementRect(ownerCard, boardPlane) : localElementRect(element, boardPlane);
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

  function localElementRect(element: HTMLElement, root: HTMLElement): RectSnapshot | null {
    let left = 0;
    let top = 0;
    let current: HTMLElement | null = element;
    while (current && current !== root) {
      left += current.offsetLeft;
      top += current.offsetTop;
      current = current.offsetParent instanceof HTMLElement ? current.offsetParent : null;
    }
    if (current !== root) {
      const rootRect = root.getBoundingClientRect();
      const rect = element.getBoundingClientRect();
      return {
        left: rect.left - rootRect.left,
        top: rect.top - rootRect.top,
        width: rect.width,
        height: rect.height,
      };
    }
    const style = getComputedStyle(element);
    const width = parsedPixelValue(style.width) ?? element.offsetWidth;
    const height = parsedPixelValue(style.height) ?? element.offsetHeight;
    return {
      left,
      top,
      width,
      height,
    };
  }

  function parsedPixelValue(value: string) {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
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
    animation: attached-card-move 360ms cubic-bezier(0.2, 0.82, 0.22, 1) var(--attached-move-delay) both;
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
