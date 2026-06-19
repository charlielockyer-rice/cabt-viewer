<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { CabtAreaType } from '../cabt/types';
  import type { ActionTimelineEvent } from '../game/types';

  type Props = {
    events?: ActionTimelineEvent[];
    scopeKey?: string | number;
    replayMode?: boolean;
  };

  type Point = {
    x: number;
    y: number;
  };

  type PlaneMapper = {
    pointFromViewport: (point: Point) => Point;
  };

  type PrizeTargetAnimation = {
    target: HTMLElement;
    delayMs: number;
    order: number;
    startX: number;
    startY: number;
  };

  let {
    events = [],
    scopeKey = '',
    replayMode = false,
  }: Props = $props();

  const timers: ReturnType<typeof setTimeout>[] = [];
  const cardMoveDurationMs = 280;
  const cardSequenceStepMs = 45;
  const cardHandoffMs = cardMoveDurationMs + 24;
  let seenEventIds = new Set<number>();
  let initialized = false;
  let reduceMotion = $state(false);
  let lastScopeKey: string | number = '';
  let anchorElement = $state<HTMLElement>();
  const activeTargetCounts = new WeakMap<HTMLElement, number>();
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
    clearPlacements();
  });

  $effect(() => {
    const currentEvents = events;
    const currentScopeKey = scopeKey;
    const scopeChanged = initialized && currentScopeKey !== lastScopeKey;
    lastScopeKey = currentScopeKey;

    if (!initialized) {
      for (const event of currentEvents) {
        seenEventIds.add(event.id);
      }
      initialized = true;
      return;
    }

    if (replayMode && scopeChanged) {
      clearPlacements();
    }

    const prizeEvents = currentEvents.filter((event) => {
      if (!isPrizePlacementEvent(event)) {
        return false;
      }
      if ((!replayMode || !scopeChanged) && seenEventIds.has(event.id)) {
        return false;
      }
      return true;
    });

    for (const event of currentEvents) {
      seenEventIds.add(event.id);
    }

    if (prizeEvents.length) {
      startPlacement(prizeEvents);
    }
  });

  function isPrizePlacementEvent(event: ActionTimelineEvent): boolean {
    const params = event.params as Record<string, unknown> | undefined;
    return (event.kind === 'MoveCard' || event.kind === 'MoveCardReverse')
      && Number(params?.fromArea) === CabtAreaType.DECK
      && Number(params?.toArea) === CabtAreaType.PRIZE;
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

  function clearPlacements() {
    for (const timer of timers) {
      clearTimeout(timer);
    }
    timers.length = 0;
    deactivateTargets(activeTargets);
    activeTargets = [];
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

  function centerOf(rect: DOMRect): Point {
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    };
  }

  function planeMapper(planeElement: HTMLElement): PlaneMapper {
    const fallbackRect = planeElement.getBoundingClientRect();
    const quad = (planeElement as HTMLElement & {
      getBoxQuads?: () => Array<{
        p1: Point;
        p2: Point;
        p3: Point;
        p4: Point;
      }>;
    }).getBoxQuads?.()[0];
    const width = planeElement.offsetWidth || fallbackRect.width;
    const height = planeElement.offsetHeight || fallbackRect.height;

    if (!quad || width <= 0 || height <= 0) {
      return {
        pointFromViewport: (point) => ({
          x: point.x - fallbackRect.left,
          y: point.y - fallbackRect.top,
        }),
      };
    }

    const homography = solveHomography(
      [quad.p1, quad.p2, quad.p3, quad.p4],
      [
        { x: 0, y: 0 },
        { x: width, y: 0 },
        { x: width, y: height },
        { x: 0, y: height },
      ],
    );

    if (!homography) {
      return {
        pointFromViewport: (point) => ({
          x: point.x - fallbackRect.left,
          y: point.y - fallbackRect.top,
        }),
      };
    }

    return {
      pointFromViewport: (point) => applyHomography(point, homography),
    };
  }

  function solveHomography(from: Point[], to: Point[]): number[] | null {
    const matrix: number[][] = [];
    for (let index = 0; index < 4; index += 1) {
      const source = from[index];
      const target = to[index];
      matrix.push([
        source.x,
        source.y,
        1,
        0,
        0,
        0,
        -target.x * source.x,
        -target.x * source.y,
        target.x,
      ]);
      matrix.push([
        0,
        0,
        0,
        source.x,
        source.y,
        1,
        -target.y * source.x,
        -target.y * source.y,
        target.y,
      ]);
    }

    for (let column = 0; column < 8; column += 1) {
      let pivotRow = column;
      for (let row = column + 1; row < 8; row += 1) {
        if (Math.abs(matrix[row][column]) > Math.abs(matrix[pivotRow][column])) {
          pivotRow = row;
        }
      }
      if (Math.abs(matrix[pivotRow][column]) < 1e-8) {
        return null;
      }
      [matrix[column], matrix[pivotRow]] = [matrix[pivotRow], matrix[column]];

      const pivot = matrix[column][column];
      for (let col = column; col < 9; col += 1) {
        matrix[column][col] /= pivot;
      }

      for (let row = 0; row < 8; row += 1) {
        if (row === column) {
          continue;
        }
        const factor = matrix[row][column];
        for (let col = column; col < 9; col += 1) {
          matrix[row][col] -= factor * matrix[column][col];
        }
      }
    }

    return [...matrix.map((row) => row[8]), 1];
  }

  function applyHomography(point: Point, homography: number[]): Point {
    const denominator = homography[6] * point.x + homography[7] * point.y + 1;
    if (Math.abs(denominator) < 1e-8) {
      return point;
    }
    return {
      x: (homography[0] * point.x + homography[1] * point.y + homography[2]) / denominator,
      y: (homography[3] * point.x + homography[4] * point.y + homography[5]) / denominator,
    };
  }
</script>

<span class="deck-prize-animation-anchor" bind:this={anchorElement} aria-hidden="true"></span>

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
      var(--cardback-shade),
      url("/assets/cardback.png") center / cover no-repeat;
    box-shadow:
      0 3px 8px rgba(23, 30, 38, 0.16),
      0 0 0 1px rgba(18, 21, 26, 0.12);
    animation: deck-prize-place 280ms cubic-bezier(0.22, 0.61, 0.36, 1) var(--prize-delay) both;
    transform-origin: center;
    will-change: transform, opacity;
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

  @media (prefers-reduced-motion: reduce) {
    :global([data-prize-animation-active='true']::after) {
      animation: none;
    }
  }
</style>
