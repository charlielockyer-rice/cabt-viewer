<script lang="ts">
  import { cardBackCssVar, cardFaceImageUrl } from '../game/cardAssets';
  import { onDestroy, onMount } from 'svelte';
  import {
    hideElementForAnimation,
    releaseElementVisibilityClaim,
    type ElementVisibilityClaim,
  } from '../animations/animationVisibilityClaims';
  import { replayAnimationSpriteRemovalMs } from '../animations/replayAnimationHandoff';
  import { replayAnimationPlanHasPhase, type CardMoveAnimationMotion, type ReplayAnimationPhasePlan } from '../animations/replayAnimationPlan';
  import {
    animationElementForMotionAnchor,
    cardHeightToWidthRatio,
    centerOf,
    fallbackHandTarget,
    handAnchor,
    handCardSlots,
    handCardVisualRect,
    handSlotForSerial,
    isConcealedHandTarget,
    plannedMotionCard,
    plannedMotionFaceDown,
  } from '../animations/viewportCardMotion';
  import { actionAnimationBatchEvents, actionAnimationStartMs, actionAnimationTiming } from '../cabt/actionAnimationSchedule';
  import { cabtCardToView } from '../cabt/cardView';
  import { CabtAreaType } from '../cabt/types';
  import { planeMapper } from '../dom/planeGeometry';
  import type { ActionTimelineEvent, CardView } from '../game/types';

  type Props = {
    events?: ActionTimelineEvent[];
    scopeKey?: string | number;
    replayMode?: boolean;
    animatePlacements?: boolean;
    animateTakes?: boolean;
    animationPlan?: ReplayAnimationPhasePlan;
  };

  type PrizeTargetAnimation = {
    target: HTMLElement;
    delayMs: number;
    order: number;
    startX: number;
    startY: number;
  };

  type PrizeTakeMode = 'revealing' | 'direct';

  type PrizeTakeSprite = {
    id: string;
    card?: CardView;
    reveal: boolean;
    mode: PrizeTakeMode;
    order: number;
    delayMs: number;
    left: number;
    top: number;
    width: number;
    height: number;
    sourceScale: number;
    revealX: number;
    revealY: number;
    takeX: number;
    takeY: number;
    takeScale: number;
    takeRotation: number;
    takeFlip: number;
    rotation: number;
    durationMs: number;
    targetElement?: HTMLElement;
  };

  type PrizeTakeAnimation = {
    id: number;
    sprites: PrizeTakeSprite[];
    hiddenTargets: HiddenPrizeTarget[];
  };

  type HiddenPrizeTarget = ElementVisibilityClaim;

  let {
    events = [],
    scopeKey = '',
    replayMode = false,
    animatePlacements = true,
    animateTakes = false,
    animationPlan,
  }: Props = $props();

  const timers: ReturnType<typeof setTimeout>[] = [];
  const cardMoveDurationMs = 280;
  const cardSequenceStepMs = 45;
  const cardHandoffMs = cardMoveDurationMs + 24;
  const directTakeDurationMs = 520;
  let seenEventIds = new Set<number>();
  let initialized = false;
  let reduceMotion = $state(false);
  let lastScopeKey: string | number = '';
  let lastPlanKey = '';
  let nextAnimationId = 1;
  let anchorElement = $state<HTMLElement>();
  let prizeTakes = $state<PrizeTakeAnimation[]>([]);
  const activeTargetCounts = new WeakMap<HTMLElement, number>();
  let hiddenTargets: HiddenPrizeTarget[] = [];
  let activeTargets: HTMLElement[] = [];

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
    return () => media.removeEventListener('change', updateMotionPreference);
  });

  onDestroy(() => {
    clearAnimations();
  });

  $effect(() => {
    const currentEvents = events;
    const currentScopeKey = scopeKey;
    const plannedTakeMotions = prizeTakePlanMotions(animationPlan);
    const planKey = prizeTakePlanKey(plannedTakeMotions);
    const scopeChanged = initialized && currentScopeKey !== lastScopeKey;
    const planChanged = planKey !== lastPlanKey;
    lastScopeKey = currentScopeKey;
    lastPlanKey = planKey;

    if (animateTakes && plannedTakeMotions.length) {
      const shouldStartPlan = !initialized || planChanged || scopeChanged;
      initialized = true;
      if (shouldStartPlan) {
        clearAnimations();
        if (!reduceMotion) {
          startPlannedPrizeTake(plannedTakeMotions);
        }
      } else {
        markEventsSeen(currentEvents);
        return;
      }
      markEventsSeen(currentEvents);
      return;
    }

    if (!initialized) {
      markEventsSeen(currentEvents);
      initialized = true;
      return;
    }

    if (replayMode && scopeChanged) {
      clearAnimations();
    }

    if (replayMode) {
      markEventsSeen(currentEvents);
      return;
    }

    const animationEvents = actionAnimationBatchEvents(currentEvents, seenEventIds);
    const placementEvents = animatePlacements ? animationEvents.filter((event) => {
      if (!isPrizePlacementEvent(event)) {
        return false;
      }
      if (seenEventIds.has(event.id)) {
        return false;
      }
      return true;
    }) : [];
    const takeEvents = animateTakes
      ? animationEvents.filter((event) => isPrizeTakeEvent(event) && shouldAnimateEvent(event))
      : [];

    markEventsSeen(currentEvents);

    if (placementEvents.length) {
      startPlacement(placementEvents);
    }
    if (takeEvents.length) {
      startPrizeTake(takeEvents, animationEvents);
    }
  });

  function markEventsSeen(currentEvents: ActionTimelineEvent[]) {
    for (const event of currentEvents) {
      seenEventIds.add(event.id);
    }
  }

  function prizeTakePlanMotions(plan: ReplayAnimationPhasePlan | undefined): CardMoveAnimationMotion[] {
    return (plan?.motions ?? []).filter((motion): motion is CardMoveAnimationMotion =>
      motion.kind === 'card-move'
      && motion.coordinateSpace === 'viewport'
      && motion.sourceAnchor.kind === 'prize-card'
      && motion.targetAnchor.kind === 'hand-card'
      && replayAnimationPlanHasPhase(plan, 'PrizeTake', motion.sourceAnchor.playerIndex),
    );
  }

  function prizeTakePlanKey(motions: CardMoveAnimationMotion[]): string {
    return motions.map((motion) => `${motion.id}:${motion.startMs}:${motion.durationMs}`).join('|');
  }

  function shouldAnimateEvent(event: ActionTimelineEvent): boolean {
    return !seenEventIds.has(event.id);
  }

  function isPrizePlacementEvent(event: ActionTimelineEvent): boolean {
    const params = event.params as Record<string, unknown> | undefined;
    return (event.kind === 'MoveCard' || event.kind === 'MoveCardReverse')
      && Number(params?.fromArea) === CabtAreaType.DECK
      && Number(params?.toArea) === CabtAreaType.PRIZE;
  }

  function isPrizeTakeEvent(event: ActionTimelineEvent): boolean {
    const params = event.params as Record<string, unknown> | undefined;
    return (event.kind === 'MoveCard' || event.kind === 'MoveCardReverse')
      && Number(params?.fromArea) === CabtAreaType.PRIZE
      && Number(params?.toArea) === CabtAreaType.HAND;
  }

  function startPlacement(prizeEvents: ActionTimelineEvent[]) {
    if (reduceMotion) {
      return;
    }

    const eventsByPlayer = new Map<number, ActionTimelineEvent[]>();
    for (const event of prizeEvents) {
      if (event.playerIndex === undefined) {
        continue;
      }
      const playerEvents = eventsByPlayer.get(event.playerIndex) ?? [];
      playerEvents.push(event);
      eventsByPlayer.set(event.playerIndex, playerEvents);
    }

    const targetAnimations = [...eventsByPlayer.entries()].flatMap(([playerIndex, playerEvents]) =>
      targetAnimationsForPlayer(playerIndex, playerEvents),
    );
    if (!targetAnimations.length) {
      return;
    }

    for (const animation of targetAnimations) {
      activateTarget(animation);
      const timer = setTimeout(() => {
        deactivateTargets([animation.target]);
      }, animation.delayMs + cardHandoffMs);
      timers.push(timer);
    }

    const timer = setTimeout(() => {
      deactivateTargets(targetAnimations.map((animation) => animation.target));
    }, Math.max(...targetAnimations.map((animation) => animation.delayMs)) + cardMoveDurationMs + 120);
    timers.push(timer);
  }

  function startPrizeTake(
    takeEvents: ActionTimelineEvent[],
    animationEvents: ActionTimelineEvent[],
  ) {
    if (reduceMotion) {
      return;
    }

    const eventsByPlayer = new Map<number, ActionTimelineEvent[]>();
    for (const event of takeEvents) {
      if (event.playerIndex === undefined) {
        continue;
      }
      const playerEvents = eventsByPlayer.get(event.playerIndex) ?? [];
      playerEvents.push(event);
      eventsByPlayer.set(event.playerIndex, playerEvents);
    }

    const sprites = [...eventsByPlayer.entries()].flatMap(([playerIndex, playerEvents]) =>
      takeSpritesForPlayer(playerIndex, playerEvents, animationEvents),
    );
    if (!sprites.length) {
      return;
    }

    const hiddenTargets = sprites
      .map((sprite) => sprite.targetElement)
      .filter((target): target is HTMLElement => target instanceof HTMLElement);
    const hiddenPrizeTargets = hideTargets(hiddenTargets);

    const animation: PrizeTakeAnimation = {
      id: nextAnimationId++,
      sprites,
      hiddenTargets: hiddenPrizeTargets,
    };
    prizeTakes = [...prizeTakes, animation];

    const timer = setTimeout(() => {
      showTargets(hiddenPrizeTargets);
      prizeTakes = prizeTakes.filter((item) => item.id !== animation.id);
    }, Math.max(...sprites.map((sprite) => sprite.delayMs + prizeTakeDurationMs(sprite))) + 20);
    timers.push(timer);
  }

  function startPlannedPrizeTake(motions: CardMoveAnimationMotion[]): boolean {
    const sprites = motions.flatMap((motion, index) => plannedPrizeTakeSprite(motion, index, motions.length) ?? []);
    if (!sprites.length) {
      return false;
    }

    const animation: PrizeTakeAnimation = {
      id: nextAnimationId++,
      sprites,
      hiddenTargets: [],
    };
    prizeTakes = [...prizeTakes, animation];

    const removalMs = Math.max(...motions.map((motion) =>
      replayAnimationSpriteRemovalMs(motion, animationPlan?.durationMs) ?? (motion.startMs + motion.durationMs)));
    const timer = setTimeout(() => {
      prizeTakes = prizeTakes.filter((item) => item.id !== animation.id);
    }, removalMs);
    timers.push(timer);
    return true;
  }

  function clearAnimations() {
    for (const timer of timers) {
      clearTimeout(timer);
    }
    timers.length = 0;
    deactivateTargets(activeTargets);
    activeTargets = [];
    clearHiddenTargets();
    prizeTakes = [];
  }

  function targetAnimationsForPlayer(playerIndex: number, playerEvents: ActionTimelineEvent[]): PrizeTargetAnimation[] {
    const deckElement = deckTopElement(playerIndex);
    const targetElements = prizeSlots(playerIndex);
    const planeElement = anchorElement?.closest('.game-board-plane') as HTMLElement | null;
    if (!deckElement || !targetElements.length || !planeElement) {
      return [];
    }

    const deckRect = deckElement.getBoundingClientRect();
    if (deckRect.width <= 0 || deckRect.height <= 0) {
      return [];
    }

    const mapper = planeMapper(planeElement);
    const deckCenter = mapper.pointFromViewport(centerOf(deckRect));
    const firstTargetIndex = Math.max(0, targetElements.length - playerEvents.length);

    return playerEvents.flatMap((_, index) => {
      const target = targetElements[firstTargetIndex + index];
      if (!target) {
        return [];
      }
      const targetRect = target.getBoundingClientRect();
      const targetCenter = mapper.pointFromViewport(centerOf(targetRect));
      const startX = deckCenter.x - targetCenter.x;
      const startY = deckCenter.y - targetCenter.y;
      const isTopSide = !!target.closest('.top-piles');
      return [{
        target,
        delayMs: index * cardSequenceStepMs,
        order: index + 1,
        startX: isTopSide ? -startX : startX,
        startY: isTopSide ? -startY : startY,
      }];
    });
  }

  function takeSpritesForPlayer(
    playerIndex: number,
    playerEvents: ActionTimelineEvent[],
    animationEvents: ActionTimelineEvent[],
  ): PrizeTakeSprite[] {
    const sourceRects = prizeSourceRects(playerIndex, playerEvents.length);
    const handElement = handAnchor(playerIndex);
    if (!sourceRects.length || !handElement) {
      return [];
    }

    const handRect = handElement.getBoundingClientRect();
    if (handRect.width <= 0 || handRect.height <= 0) {
      return [];
    }

    const handSlots = handCardSlots(handElement, playerIndex);
    const handConcealed = handElement.classList.contains('concealed');
    const layout = revealLayout(playerEvents.length);

    return playerEvents.flatMap((event, index) => {
      const params = event.params as Record<string, unknown> | undefined;
      const cardId = Number(params?.cardId);
      const serial = Number(params?.serial);
      const sourceRect = sourceRects[index] ?? sourceRects[sourceRects.length - 1];
      if (!sourceRect || sourceRect.width <= 0 || sourceRect.height <= 0) {
        return [];
      }

      const sourceCenter = centerOf(sourceRect);
      const revealTarget = layout.target(index);
      const targetElement = handSlotForSerial(handSlots, serial)
        ?? handSlots[Math.max(0, handSlots.length - playerEvents.length + index)];
      const targetRect = handCardVisualRect(targetElement) ?? fallbackHandTarget(handRect, index, playerEvents.length);
      const targetCenter = centerOf(targetRect);
      const reveal = !handConcealed && Number.isFinite(cardId);

      return [{
        id: `${event.id}-${Number.isFinite(serial) ? serial : index}`,
        card: reveal ? {
          ...cabtCardToView(cardId),
          serial: Number.isFinite(serial) ? serial : undefined,
          playerIndex,
        } : undefined,
        reveal,
        mode: reveal ? 'revealing' : 'direct',
        order: index + 1,
        delayMs: actionAnimationStartMs(animationEvents, event),
        left: sourceCenter.x - layout.cardWidth / 2,
        top: sourceCenter.y - layout.cardHeight / 2,
        width: layout.cardWidth,
        height: layout.cardHeight,
        sourceScale: Math.max(0.18, Math.min(0.85, sourceRect.width / layout.cardWidth)),
        revealX: revealTarget.x - sourceCenter.x,
        revealY: revealTarget.y - sourceCenter.y,
        takeX: targetCenter.x - sourceCenter.x,
        takeY: targetCenter.y - sourceCenter.y,
        takeScale: Math.max(0.25, Math.min(1.15, targetRect.width / layout.cardWidth)),
        takeRotation: handConcealed ? 180 : 0,
        takeFlip: handConcealed ? 0 : 180,
        rotation: revealTarget.rotation,
        durationMs: reveal ? actionAnimationTiming.prizeTakeMs : directTakeDurationMs,
        targetElement,
      }];
    });
  }

  function plannedPrizeTakeSprite(motion: CardMoveAnimationMotion, index: number, motionCount: number): PrizeTakeSprite | undefined {
    const sourceElement = animationElementForMotionAnchor(motion.sourceAnchor, motion.identity);
    const targetElement = animationElementForMotionAnchor(motion.targetAnchor, motion.identity);
    if (!sourceElement || !targetElement) {
      return undefined;
    }

    const sourceRect = sourceElement.getBoundingClientRect();
    const targetRect = handCardVisualRect(targetElement) ?? targetElement.getBoundingClientRect();
    if (sourceRect.width <= 0 || sourceRect.height <= 0 || targetRect.width <= 0 || targetRect.height <= 0) {
      return undefined;
    }

    const sourceCenter = centerOf(sourceRect);
    const targetCenter = centerOf(targetRect);
    const layout = revealLayout(Math.max(index + 1, motionCount));
    const revealTarget = layout.target(index);
    const card = plannedMotionCard(motion);
    const reveal = !plannedMotionFaceDown(motion) && !isConcealedHandTarget(targetElement) && !!card;
    const handConcealed = isConcealedHandTarget(targetElement);

    return {
      id: motion.id,
      card,
      reveal,
      mode: reveal ? 'revealing' : 'direct',
      order: index + 1,
      delayMs: motion.startMs,
      left: sourceCenter.x - layout.cardWidth / 2,
      top: sourceCenter.y - layout.cardHeight / 2,
      width: layout.cardWidth,
      height: layout.cardHeight,
      sourceScale: Math.max(0.18, Math.min(0.85, sourceRect.width / layout.cardWidth)),
      revealX: revealTarget.x - sourceCenter.x,
      revealY: revealTarget.y - sourceCenter.y,
      takeX: targetCenter.x - sourceCenter.x,
      takeY: targetCenter.y - sourceCenter.y,
      takeScale: Math.max(0.25, Math.min(1.15, targetRect.width / layout.cardWidth)),
      takeRotation: handConcealed ? 180 : 0,
      takeFlip: handConcealed ? 0 : 180,
      rotation: revealTarget.rotation,
      durationMs: motion.durationMs,
      targetElement,
    };
  }

  function activateTarget(animation: PrizeTargetAnimation) {
    const count = activeTargetCounts.get(animation.target) ?? 0;
    activeTargetCounts.set(animation.target, count + 1);
    animation.target.dataset.prizeAnimationActive = 'true';
    animation.target.style.setProperty('--prize-start-x', `${animation.startX.toFixed(1)}px`);
    animation.target.style.setProperty('--prize-start-y', `${animation.startY.toFixed(1)}px`);
    animation.target.style.setProperty('--prize-delay', `${animation.delayMs}ms`);
    animation.target.style.setProperty('--prize-z-index', `${animation.order}`);
    activeTargets = [...activeTargets, animation.target];
  }

  function deactivateTargets(targets: HTMLElement[]) {
    const nextActiveTargets = new Set(activeTargets);
    for (const target of targets) {
      const count = (activeTargetCounts.get(target) ?? 1) - 1;
      if (count > 0) {
        activeTargetCounts.set(target, count);
        continue;
      }
      activeTargetCounts.delete(target);
      nextActiveTargets.delete(target);
      delete target.dataset.prizeAnimationActive;
      target.style.removeProperty('--prize-start-x');
      target.style.removeProperty('--prize-start-y');
      target.style.removeProperty('--prize-delay');
      target.style.removeProperty('--prize-z-index');
    }
    activeTargets = [...nextActiveTargets];
  }

  function hideTargets(targets: HTMLElement[]) {
    const hidden: HiddenPrizeTarget[] = [];
    for (const target of targets) {
      hidden.push(hideElementForAnimation({
        element: target,
        scopeKey,
        role: 'destination',
        fallbackAttribute: 'data-prize-take-animation-hidden',
      }));
    }
    hiddenTargets = [...hiddenTargets, ...hidden];
    return hidden;
  }

  function showTargets(targets: HiddenPrizeTarget[]) {
    const nextHiddenTargets = new Set(hiddenTargets);
    for (const target of targets) {
      releaseElementVisibilityClaim(target);
      nextHiddenTargets.delete(target);
    }
    hiddenTargets = [...nextHiddenTargets];
  }

  function clearHiddenTargets() {
    showTargets([...hiddenTargets]);
  }

  function deckTopElement(playerIndex: number): HTMLElement | null {
    const anchor = document.querySelector(`[data-card-anchor="player:${playerIndex}:deck"]`);
    const pile = anchor?.closest('.deck-pile') as HTMLElement | null;
    return pile?.querySelector('.deck-card-face') ?? pile;
  }

  function prizeSlots(playerIndex: number): HTMLElement[] {
    return Array.from(document.querySelectorAll(`[data-card-anchor^="player:${playerIndex}:prize:"]`))
      .filter((element): element is HTMLElement => element instanceof HTMLElement)
      .sort((a, b) => prizeIndex(a) - prizeIndex(b));
  }

  function prizeIndex(element: HTMLElement): number {
    const anchor = element.dataset.cardAnchor ?? '';
    const value = Number(anchor.split(':').at(-1));
    return Number.isFinite(value) ? value : 0;
  }

  function prizeSourceRects(playerIndex: number, count: number): DOMRect[] {
    const slots = prizeSlots(playerIndex);
    const grid = prizeGridForPlayer(playerIndex);
    if (!slots.length && !grid) {
      return [];
    }
    const firstMissingIndex = slots.length;
    return Array.from({ length: count }, (_, index) => prizeRectForIndex(slots, firstMissingIndex + index, grid));
  }

  function prizeRectForIndex(slots: HTMLElement[], index: number, grid: HTMLElement | null): DOMRect {
    const existing = slots.find((slot) => prizeIndex(slot) === index);
    if (existing) {
      return existing.getBoundingClientRect();
    }

    const firstRect = slots[0]?.getBoundingClientRect() ?? prizeGridCardRect(grid);
    const row = Math.floor(index / 2);
    const col = index % 2;
    const firstIndex = slots[0] ? prizeIndex(slots[0]) : 0;
    const firstRow = Math.floor(firstIndex / 2);
    const firstCol = firstIndex % 2;
    const left = firstRect.left + (col - firstCol) * firstRect.width * 0.98;
    const top = firstRect.top + (row - firstRow) * firstRect.width * 0.71;
    return {
      left,
      top,
      right: left + firstRect.width,
      bottom: top + firstRect.height,
      x: left,
      y: top,
      width: firstRect.width,
      height: firstRect.height,
      toJSON: () => ({}),
    } as DOMRect;
  }

  function prizeGridForPlayer(playerIndex: number): HTMLElement | null {
    const deckAnchor = document.querySelector(`[data-card-anchor="player:${playerIndex}:deck"]`);
    const fieldPiles = deckAnchor?.closest('.field-piles');
    const grid = fieldPiles?.querySelector('.prize-grid');
    return grid instanceof HTMLElement ? grid : null;
  }

  function prizeGridCardRect(grid: HTMLElement | null): DOMRect {
    const gridRect = grid?.getBoundingClientRect();
    if (!gridRect || gridRect.width <= 0 || gridRect.height <= 0) {
      return {
        left: 0,
        top: 0,
        right: 0,
        bottom: 0,
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        toJSON: () => ({}),
      } as DOMRect;
    }
    const width = gridRect.width / 1.98;
    const height = width * cardHeightToWidthRatio;
    return {
      left: gridRect.left,
      top: gridRect.top,
      right: gridRect.left + width,
      bottom: gridRect.top + height,
      x: gridRect.left,
      y: gridRect.top,
      width,
      height,
      toJSON: () => ({}),
    } as DOMRect;
  }

  function revealLayout(count: number) {
    const viewportWidth = typeof window === 'undefined' ? 1200 : window.innerWidth;
    const viewportHeight = typeof window === 'undefined' ? 800 : window.innerHeight;
    const boardRect = typeof document === 'undefined'
      ? undefined
      : document.querySelector('.playmat')?.getBoundingClientRect();
    const centerX = boardRect ? boardRect.left + boardRect.width / 2 : viewportWidth / 2;
    const centerY = boardRect ? boardRect.top + boardRect.height * 0.5 : viewportHeight * 0.47;
    const maxWidth = boardRect ? boardRect.width - 96 : viewportWidth - 96;
    const availableWidth = Math.max(220, maxWidth);
    const spacingRatio = viewportWidth < 760 ? 0.62 : 0.7;
    const minCardWidth = viewportWidth < 760 ? 92 : 112;
    const maxColumns = Math.max(1, Math.floor(((availableWidth / minCardWidth) - 1) / spacingRatio + 1));
    const columns = Math.min(count, maxColumns);
    const rows = Math.ceil(count / columns);
    const boardHeight = boardRect?.height ?? viewportHeight;
    const revealBandHeight = boardHeight * (viewportWidth < 760 ? 0.46 : 0.52);
    const maxByHeight = revealBandHeight / (cardHeightToWidthRatio * (rows + Math.max(0, rows - 1) * 0.08));
    const maxReadableWidth = Math.min(viewportWidth < 760 ? 174 : 252, availableWidth, maxByHeight);
    const countScale = count <= 1 ? 1 : count <= 2 ? 0.9 : count <= 4 ? 0.78 : count <= 6 ? 0.68 : 0.58;
    const desiredCardWidth = maxReadableWidth * countScale;
    const maxByWidth = availableWidth / (1 + spacingRatio * Math.max(0, columns - 1));
    const cardWidth = Math.max(minCardWidth, Math.min(maxReadableWidth, desiredCardWidth, maxByWidth));
    const cardHeight = cardWidth * cardHeightToWidthRatio;
    const spacing = cardWidth * spacingRatio;
    const rotationStep = count <= 1 ? 0 : Math.min(5, 20 / Math.max(1, count - 1));
    const arcDrop = cardWidth * 0.045;
    const rowGap = cardHeight * 0.08;
    const totalHeight = rows * cardHeight + Math.max(0, rows - 1) * rowGap;
    const originY = centerY - totalHeight / 2 + cardHeight / 2;

    return {
      cardWidth,
      cardHeight,
      target(index: number) {
        const row = Math.floor(index / columns);
        const rowStart = row * columns;
        const cardsInRow = Math.min(columns, count - rowStart);
        const column = index - rowStart;
        const offset = column - (cardsInRow - 1) / 2;
        return {
          x: centerX + offset * spacing,
          y: originY + row * (cardHeight + rowGap) + Math.abs(offset) * arcDrop,
          rotation: offset * rotationStep,
        };
      },
    };
  }

  function prizeTakeDurationMs(sprite: PrizeTakeSprite): number {
    return sprite.mode === 'direct' ? directTakeDurationMs : actionAnimationTiming.prizeTakeMs;
  }

  function takeSpriteStyle(sprite: PrizeTakeSprite): string {
    return [
      `left: ${sprite.left}px`,
      `top: ${sprite.top}px`,
      `width: ${sprite.width}px`,
      `height: ${sprite.height}px`,
      `--prize-source-scale: ${sprite.sourceScale.toFixed(3)}`,
      `--prize-reveal-x: ${sprite.revealX.toFixed(1)}px`,
      `--prize-reveal-y: ${sprite.revealY.toFixed(1)}px`,
      `--prize-take-x: ${sprite.takeX.toFixed(1)}px`,
      `--prize-take-y: ${sprite.takeY.toFixed(1)}px`,
      `--prize-take-scale: ${sprite.takeScale.toFixed(3)}`,
      `--prize-take-rotation: ${sprite.takeRotation.toFixed(1)}deg`,
      `--prize-take-flip: ${sprite.takeFlip.toFixed(1)}deg`,
      `--prize-reveal-rotation: ${sprite.rotation.toFixed(1)}deg`,
      '--prize-overlay-z: 0px',
      `--prize-take-delay: ${sprite.delayMs}ms`,
      `--prize-take-duration: ${sprite.durationMs}ms`,
      `z-index: ${sprite.order}`,
    ].join('; ');
  }
</script>

<span class="deck-prize-animation-anchor" bind:this={anchorElement} aria-hidden="true"></span>
<span class="prize-take-animation" aria-hidden="true">
  {#each prizeTakes as take (take.id)}
    {#each take.sprites as sprite (sprite.id)}
      <span class={`prize-take-card ${sprite.mode}`} class:revealed={sprite.reveal} style={takeSpriteStyle(sprite)}>
        <span class="prize-take-card-inner">
          <span class="prize-take-card-face prize-take-card-back" style={cardBackCssVar()}></span>
          <span class="prize-take-card-face prize-take-card-front">
            {#if cardFaceImageUrl(sprite.card)}
              <img src={cardFaceImageUrl(sprite.card)} alt="" draggable="false" />
            {:else}
              <span class="fallback-name">{sprite.card?.name ?? 'Prize card'}</span>
            {/if}
          </span>
        </span>
      </span>
    {/each}
  {/each}
</span>

<style>
  .deck-prize-animation-anchor {
    display: none;
  }

  :global([data-prize-animation-active='true']) {
    z-index: var(--prize-z-index, 1);
    background: transparent !important;
    border-color: transparent !important;
    box-shadow: none !important;
  }

  :global([data-prize-animation-active='true']::after) {
    content: "";
    position: absolute;
    inset: 0;
    display: block;
    box-sizing: border-box;
    border: 1px solid var(--prize-border);
    border-radius: inherit;
    pointer-events: none;
    background:
      var(--card-back-image, var(--cardback-shade)),
      linear-gradient(135deg, rgba(255, 255, 255, 0.1), transparent 28%),
      repeating-linear-gradient(45deg, rgba(255, 255, 255, 0.08) 0 6px, transparent 6px 12px),
      linear-gradient(145deg, #203654, #111a2c);
    background-size: cover, auto, auto, auto;
    background-position: center;
    box-shadow:
      0 3px 8px rgba(23, 30, 38, 0.16),
      0 0 0 1px rgba(18, 21, 26, 0.12);
    animation: deck-prize-place 280ms cubic-bezier(0.22, 0.61, 0.36, 1) var(--prize-delay) both;
    transform-origin: center;
    will-change: transform, opacity;
  }

  .prize-take-animation {
    position: fixed;
    inset: 0;
    z-index: 41;
    overflow: visible;
    pointer-events: none;
    perspective: 1200px;
    transform-style: preserve-3d;
  }

  :global([data-prize-take-animation-hidden='true']) {
    visibility: hidden;
  }

  .prize-take-card {
    position: absolute;
    display: block;
    border-radius: 9px;
    transform-origin: center;
    transform-style: preserve-3d;
    isolation: isolate;
    will-change: transform, opacity;
  }

  .prize-take-card.revealing {
    animation: prize-take-reveal var(--prize-take-duration, 1180ms) cubic-bezier(0.18, 0.86, 0.24, 1) var(--prize-take-delay) both;
  }

  .prize-take-card.direct {
    animation: prize-take-direct var(--prize-take-duration, 520ms) cubic-bezier(0.2, 0.82, 0.22, 1) var(--prize-take-delay) both;
  }

  .prize-take-card-inner {
    position: absolute;
    inset: 0;
    display: block;
    border-radius: inherit;
    transform-style: preserve-3d;
    will-change: transform;
  }

  .prize-take-card.revealed .prize-take-card-inner {
    animation: prize-take-flip var(--prize-take-duration, 1180ms) ease-in-out var(--prize-take-delay) both;
  }

  .prize-take-card-face {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    overflow: hidden;
    border-radius: inherit;
    box-shadow:
      0 18px 38px rgba(23, 30, 38, 0.26),
      0 0 0 1px rgba(18, 21, 26, 0.18);
    -webkit-backface-visibility: hidden;
    backface-visibility: hidden;
  }

  .prize-take-card-back {
    transform: translateZ(0.2px);
    background:
      var(--card-back-image, var(--cardback-shade)),
      linear-gradient(135deg, rgba(255, 255, 255, 0.1), transparent 28%),
      repeating-linear-gradient(45deg, rgba(255, 255, 255, 0.08) 0 6px, transparent 6px 12px),
      linear-gradient(145deg, #203654, #111a2c);
    background-size: cover, auto, auto, auto;
    background-position: center;
  }

  .prize-take-card-front {
    transform: rotateY(180deg) translateZ(0.2px);
    background: #f7f8fa;
  }

  .prize-take-card:not(.revealed) .prize-take-card-front {
    display: none;
  }

  .prize-take-card-front img {
    width: 100%;
    height: 100%;
    display: block;
    object-fit: fill;
    pointer-events: none;
  }

  .fallback-name {
    padding: 0 9px;
    color: #1f2933;
    font-size: 13px;
    font-weight: 900;
    line-height: 1.1;
    text-align: center;
  }

  @keyframes deck-prize-place {
    0% {
      opacity: 0;
      transform: translate3d(var(--prize-start-x), var(--prize-start-y), 0);
    }
    1% {
      opacity: 1;
      transform: translate3d(var(--prize-start-x), var(--prize-start-y), 0);
    }
    100% {
      opacity: 1;
      transform: translate3d(0, 0, 0);
    }
  }

  @keyframes prize-take-reveal {
    0% {
      opacity: 0;
      transform:
        translate3d(0, 0, var(--prize-overlay-z))
        scale(var(--prize-source-scale))
        rotate(0deg);
    }
    2% {
      opacity: 1;
      transform:
        translate3d(0, 0, var(--prize-overlay-z))
        scale(var(--prize-source-scale))
        rotate(0deg);
    }
    42% {
      opacity: 1;
      transform:
        translate3d(var(--prize-reveal-x), var(--prize-reveal-y), var(--prize-overlay-z))
        scale(1)
        rotate(var(--prize-reveal-rotation));
    }
    68% {
      opacity: 1;
      transform:
        translate3d(var(--prize-reveal-x), var(--prize-reveal-y), var(--prize-overlay-z))
        scale(1)
        rotate(var(--prize-reveal-rotation));
    }
    96% {
      opacity: 1;
      transform:
        translate3d(var(--prize-take-x), var(--prize-take-y), var(--prize-overlay-z))
        scale(var(--prize-take-scale))
        rotate(var(--prize-take-rotation));
    }
    100% {
      opacity: 1;
      transform:
        translate3d(var(--prize-take-x), var(--prize-take-y), var(--prize-overlay-z))
        scale(var(--prize-take-scale))
        rotate(var(--prize-take-rotation));
    }
  }

  @keyframes prize-take-direct {
    0% {
      opacity: 0;
      transform:
        translate3d(0, 0, var(--prize-overlay-z))
        scale(var(--prize-source-scale))
        rotate(0deg);
    }
    1% {
      opacity: 1;
      transform:
        translate3d(0, 0, var(--prize-overlay-z))
        scale(var(--prize-source-scale))
        rotate(0deg);
    }
    88% {
      opacity: 1;
      transform:
        translate3d(var(--prize-take-x), var(--prize-take-y), var(--prize-overlay-z))
        scale(var(--prize-take-scale))
        rotate(var(--prize-take-rotation));
    }
    100% {
      opacity: 1;
      transform:
        translate3d(var(--prize-take-x), var(--prize-take-y), var(--prize-overlay-z))
        scale(var(--prize-take-scale))
        rotate(var(--prize-take-rotation));
    }
  }

  @keyframes prize-take-flip {
    0% {
      transform: rotateY(0deg);
    }
    36% {
      transform: rotateY(180deg);
    }
    72% {
      transform: rotateY(180deg);
    }
    100% {
      transform: rotateY(var(--prize-take-flip));
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .prize-take-card.revealing,
    .prize-take-card.direct,
    .prize-take-card.revealed .prize-take-card-inner {
      animation-duration: 1ms;
    }
  }
</style>
