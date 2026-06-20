<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { actionAnimationBatchEvents, actionAnimationStartMs } from '../cabt/actionAnimationSchedule';
  import { cabtCardToView } from '../cabt/cardView';
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

  type RectSnapshot = Point & {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
  };

  type FixedAnimation = {
    kind: 'fixed';
    id: number;
    target: HTMLElement;
    delayMs: number;
    width: number;
    height: number;
    startTransform: string;
    endTransform: string;
    imageUrl: string;
    hideContents: boolean;
  };

  type SlotAttachAnimation = {
    kind: 'slotAttach';
    target: HTMLElement;
    delayMs: number;
    imageUrl: string;
    startX: number;
    startY: number;
    startRotation: number;
    hideContents: false;
  };

  type TargetAnimation = FixedAnimation | SlotAttachAnimation;

  type ActivePlay = Omit<FixedAnimation, 'target' | 'hideContents' | 'kind'>;

  let {
    events = [],
    scopeKey = '',
    replayMode = false,
  }: Props = $props();

  const timers: ReturnType<typeof setTimeout>[] = [];
  const cardMoveDurationMs = 360;
  const cardHeightToWidthRatio = 88 / 63;
  let nextPlayId = 0;
  let seenEventIds = new Set<number>();
  let initialized = false;
  let reduceMotion = $state(false);
  let lastScopeKey: string | number = '';
  let previousCardRects = new Map<number, RectSnapshot>();
  let activePlays = $state<ActivePlay[]>([]);
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
    clearPlays();
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
      previousCardRects = snapshotHandCardRects();
      return;
    }

    if (replayMode && scopeChanged) {
      clearPlays();
    }

    const animationEvents = actionAnimationBatchEvents(currentEvents, seenEventIds, replayMode, scopeChanged);
    const playEvents = animationEvents.filter((event) => {
      if (!isHandPlayEvent(event)) {
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

    if (playEvents.length) {
      startPlay(playEvents, animationEvents);
    }
    previousCardRects = snapshotHandCardRects();
  });

  function isHandPlayEvent(event: ActionTimelineEvent): boolean {
    const params = event.params as Record<string, unknown> | undefined;
    if (event.kind === 'Play' || event.kind === 'Attach') {
      return Number.isFinite(Number(params?.cardId));
    }
    return event.kind === 'MoveCard'
      && Number(params?.fromArea) === CabtAreaType.HAND
      && (
        Number(params?.toArea) === CabtAreaType.DISCARD
        || Number(params?.toArea) === CabtAreaType.ACTIVE
        || Number(params?.toArea) === CabtAreaType.BENCH
      )
      && Number.isFinite(Number(params?.cardId));
  }

  function startPlay(playEvents: ActionTimelineEvent[], animationEvents: ActionTimelineEvent[]) {
    if (reduceMotion) {
      return;
    }

    const targetAnimations = playEvents.flatMap((event) => targetAnimationForEvent(event, animationEvents));
    if (!targetAnimations.length) {
      return;
    }

    for (const animation of targetAnimations) {
      activateTarget(animation);
      if (animation.kind === 'fixed') {
        activePlays = [...activePlays, animation];
      }
      const timer = setTimeout(() => {
        if (animation.kind === 'fixed') {
          activePlays = activePlays.filter((play) => play.id !== animation.id);
        }
        deactivateTargets([animation.target]);
      }, animation.delayMs + cardMoveDurationMs + 24);
      timers.push(timer);
    }

    const timer = setTimeout(() => {
      deactivateTargets(targetAnimations.map((animation) => animation.target));
    }, Math.max(...targetAnimations.map((animation) => animation.delayMs)) + cardMoveDurationMs + 120);
    timers.push(timer);
  }

  function clearPlays() {
    for (const timer of timers) {
      clearTimeout(timer);
    }
    timers.length = 0;
    activePlays = [];
    deactivateTargets(activeTargets);
    activeTargets = [];
  }

  function targetAnimationForEvent(event: ActionTimelineEvent, animationEvents: ActionTimelineEvent[]): TargetAnimation[] {
    if (event.playerIndex === undefined) {
      return [];
    }
    const params = event.params as Record<string, unknown> | undefined;
    const cardId = Number(params?.cardId);
    if (!Number.isFinite(cardId)) {
      return [];
    }

    const serial = Number(params?.serial);
    const handElement = handAnchor(event.playerIndex);
    const target = targetForEvent(event);
    const planeElement = target?.closest('.game-board-plane') as HTMLElement | null;
    if (!handElement || !target || !planeElement) {
      return [];
    }
    if (event.kind === 'Attach' && !hasKnownHandSource(handElement, serial)) {
      return [];
    }

    const sourceRect = sourceRectForHand(handElement, serial);
    const visualTarget = visualTargetForAnimation(target);
    const targetRect = visualTarget.getBoundingClientRect();
    if (sourceRect.width <= 0 || sourceRect.height <= 0 || targetRect.width <= 0 || targetRect.height <= 0) {
      return [];
    }

    const card = cabtCardToView(cardId);
    const delayMs = actionAnimationStartMs(animationEvents, event);
    if (event.kind === 'Attach') {
      return [slotAttachAnimationForEvent(target, sourceRect, targetRect, card.imageUrl ?? '', delayMs)];
    }

    const sourceQuad = sourceQuadForHand(handElement, sourceRect);
    const targetQuad = viewportQuad(visualTarget);

    return [{
      kind: 'fixed',
      id: nextPlayId++,
      target,
      delayMs,
      width: sourceRect.width,
      height: sourceRect.height,
      startTransform: cssMatrix3dForQuad(sourceRect.width, sourceRect.height, sourceQuad),
      endTransform: cssMatrix3dForQuad(sourceRect.width, sourceRect.height, targetQuad),
      imageUrl: card.imageUrl ?? '',
      hideContents: shouldHideTargetContents(event, target),
    }];
  }

  function slotAttachAnimationForEvent(
    target: HTMLElement,
    sourceRect: DOMRect,
    targetRect: DOMRect,
    imageUrl: string,
    delayMs: number,
  ): SlotAttachAnimation {
    const sourceCenter = centerOf(sourceRect);
    const targetCenter = centerOf(targetRect);
    const startX = clamp((sourceCenter.x - targetCenter.x) / targetRect.width, -0.72, 0.72);
    const startY = clamp((sourceCenter.y - targetCenter.y) / targetRect.height, -0.82, 0.82);
    return {
      kind: 'slotAttach',
      target,
      delayMs,
      imageUrl,
      startX,
      startY,
      startRotation: target.closest('.top-active-slot, .bench-row.opponent') ? 180 : 0,
      hideContents: false,
    };
  }

  function shouldHideTargetContents(event: ActionTimelineEvent, target: HTMLElement): boolean {
    const params = event.params as Record<string, unknown> | undefined;
    if (event.kind === 'Attach') {
      return false;
    }
    if (isDiscardCardTarget(target)) {
      return event.kind === 'Play'
        || (
          event.kind === 'MoveCard'
          && Number(params?.toArea) === CabtAreaType.DISCARD
        );
    }
    if (event.kind === 'MoveCard') {
      const toArea = Number(params?.toArea);
      return toArea === CabtAreaType.ACTIVE || toArea === CabtAreaType.BENCH;
    }
    return !!target.dataset.pokemonSerial;
  }

  function isDiscardCardTarget(target: HTMLElement): boolean {
    return target.classList.contains('card-tile')
      && target.closest('[data-card-anchor$=":discard"]') instanceof HTMLElement;
  }

  function activateTarget(animation: TargetAnimation) {
    const count = activeTargetCounts.get(animation.target) ?? 0;
    activeTargetCounts.set(animation.target, count + 1);
    animation.target.dataset.handPlayAnimationActive = 'true';
    if (animation.kind === 'slotAttach') {
      animation.target.dataset.handAttachAnimationActive = 'true';
      animation.target.style.setProperty('--hand-attach-card-image', cssUrl(animation.imageUrl));
      animation.target.style.setProperty('--hand-attach-start-x', `${(animation.startX * 100).toFixed(1)}%`);
      animation.target.style.setProperty('--hand-attach-start-y', `${(animation.startY * 100).toFixed(1)}%`);
      animation.target.style.setProperty('--hand-attach-start-rotation', `${animation.startRotation.toFixed(1)}deg`);
      animation.target.style.setProperty('--hand-attach-delay', `${animation.delayMs}ms`);
    }
    if (animation.hideContents) {
      animation.target.dataset.handPlayAnimationHideContents = 'true';
    }
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
      delete target.dataset.handPlayAnimationActive;
      delete target.dataset.handPlayAnimationHideContents;
      delete target.dataset.handAttachAnimationActive;
      target.style.removeProperty('--hand-attach-card-image');
      target.style.removeProperty('--hand-attach-start-x');
      target.style.removeProperty('--hand-attach-start-y');
      target.style.removeProperty('--hand-attach-start-rotation');
      target.style.removeProperty('--hand-attach-delay');
    }
    activeTargets = [...nextActiveTargets];
  }

  function targetForEvent(event: ActionTimelineEvent): HTMLElement | null {
    const params = event.params as Record<string, unknown> | undefined;
    const playerIndex = event.playerIndex;
    const serial = Number(params?.serial);
    const cardId = Number(params?.cardId);

    if (event.kind === 'Attach') {
      const targetSerial = Number(params?.serialTarget);
      const targetCardId = Number(params?.cardIdTarget);
      return boardSlotByPokemonIdentity(targetSerial, targetCardId, playerIndex);
    }

    if (Number.isFinite(serial)) {
      const boardSlot = document.querySelector(`[data-pokemon-serial="${serial}"]`);
      if (boardSlot instanceof HTMLElement) {
        return boardSlot;
      }
      const discardCard = document.querySelector(`[data-card-anchor="player:${playerIndex}:discard"] [data-card-serial="${serial}"]`);
      if (discardCard instanceof HTMLElement) {
        return discardCard;
      }
    }

    if (event.kind === 'MoveCard') {
      const toArea = Number(params?.toArea);
      if (toArea === CabtAreaType.DISCARD) {
        return discardTarget(playerIndex, serial);
      }
      if (toArea === CabtAreaType.ACTIVE) {
        return document.querySelector(`[data-card-anchor="player:${playerIndex}:active:0"]`);
      }
      if (toArea === CabtAreaType.BENCH) {
        return boardSlotByPokemonIdentity(serial, cardId, playerIndex)
          ?? document.querySelector(`[data-card-anchor^="player:${playerIndex}:bench:"]`);
      }
    }

    if (event.kind === 'Play') {
      return discardTarget(playerIndex, serial)
        ?? boardSlotByPokemonIdentity(serial, cardId, playerIndex);
    }

    return null;
  }

  function discardTarget(playerIndex: number | undefined, serial: number): HTMLElement | null {
    if (playerIndex === undefined) {
      return null;
    }
    if (Number.isFinite(serial)) {
      const card = document.querySelector(`[data-card-anchor="player:${playerIndex}:discard"] [data-card-serial="${serial}"]`);
      if (card instanceof HTMLElement) {
        return card;
      }
    }
    return document.querySelector(`[data-card-anchor="player:${playerIndex}:discard"]`);
  }

  function boardSlotByPokemonIdentity(serial: number, cardId: number, playerIndex: number | undefined): HTMLElement | null {
    if (Number.isFinite(serial)) {
      const bySerial = document.querySelector(`[data-pokemon-serial="${serial}"]`);
      if (bySerial instanceof HTMLElement) {
        return bySerial;
      }
    }
    if (playerIndex !== undefined && Number.isFinite(cardId)) {
      const byId = document.querySelector(`[data-owner-index="${playerIndex}"][data-pokemon-card-id="${cardId}"]`);
      if (byId instanceof HTMLElement) {
        return byId;
      }
    }
    return null;
  }

  function handAnchor(playerIndex: number): HTMLElement | null {
    return document.querySelector(`[data-card-anchor="player:${playerIndex}:hand"]`);
  }

  function sourceRectForHand(handElement: HTMLElement, serial: number): DOMRect {
    const previousRect = previousCardRects.get(serial);
    if (previousRect) {
      return rectSnapshotToDomRect(previousRect);
    }

    if (Number.isFinite(serial)) {
      const matchingCard = handElement.querySelector(`[data-card-serial="${serial}"]`);
      if (matchingCard instanceof HTMLElement) {
        return matchingCard.getBoundingClientRect();
      }
    }

    const handRect = handElement.getBoundingClientRect();
    const cardRect = firstHandCardRect(handElement);
    const width = cardRect?.width ?? Math.min(handRect.width * 0.16, handRect.height / cardHeightToWidthRatio);
    const height = cardRect?.height ?? width * cardHeightToWidthRatio;
    return {
      left: handRect.left + handRect.width / 2 - width / 2,
      top: handRect.top + handRect.height / 2 - height / 2,
      right: handRect.left + handRect.width / 2 + width / 2,
      bottom: handRect.top + handRect.height / 2 + height / 2,
      x: handRect.left + handRect.width / 2 - width / 2,
      y: handRect.top + handRect.height / 2 - height / 2,
      width,
      height,
      toJSON: () => ({}),
    } as DOMRect;
  }

  function hasKnownHandSource(handElement: HTMLElement, serial: number): boolean {
    if (!Number.isFinite(serial)) {
      return false;
    }
    if (previousCardRects.has(serial)) {
      return true;
    }
    return handElement.querySelector(`[data-card-serial="${serial}"]`) instanceof HTMLElement;
  }

  function snapshotHandCardRects(): Map<number, RectSnapshot> {
    const nextRects = new Map<number, RectSnapshot>();
    for (const element of document.querySelectorAll('[data-card-anchor$=":hand"] [data-card-serial]')) {
      if (!(element instanceof HTMLElement)) {
        continue;
      }
      const serial = Number(element.dataset.cardSerial);
      if (!Number.isFinite(serial)) {
        continue;
      }
      const rect = element.getBoundingClientRect();
      nextRects.set(serial, {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
      });
    }
    return nextRects;
  }

  function rectSnapshotToDomRect(rect: RectSnapshot): DOMRect {
    return {
      ...rect,
      toJSON: () => ({}),
    } as DOMRect;
  }

  function firstHandCardRect(handElement: HTMLElement): DOMRect | null {
    const card = handElement.querySelector('.card-tile');
    return card instanceof HTMLElement ? card.getBoundingClientRect() : null;
  }

  function centerOf(rect: DOMRect): Point {
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    };
  }

  function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
  }

  function visualTargetForAnimation(target: HTMLElement): HTMLElement {
    if (target.classList.contains('card-tile')) {
      return target;
    }
    const cardTile = target.querySelector('.card-tile');
    return cardTile instanceof HTMLElement ? cardTile : target;
  }

  function rectQuad(rect: DOMRect): Point[] {
    return [
      { x: rect.left, y: rect.top },
      { x: rect.right, y: rect.top },
      { x: rect.right, y: rect.bottom },
      { x: rect.left, y: rect.bottom },
    ];
  }

  function sourceQuadForHand(handElement: HTMLElement, rect: DOMRect): Point[] {
    if (handElement.closest('.player-panel.top')) {
      return rotatedRectQuad(rect);
    }
    return rectQuad(rect);
  }

  function rotatedRectQuad(rect: DOMRect): Point[] {
    return [
      { x: rect.right, y: rect.bottom },
      { x: rect.left, y: rect.bottom },
      { x: rect.left, y: rect.top },
      { x: rect.right, y: rect.top },
    ];
  }

  function viewportQuad(element: HTMLElement): Point[] {
    const quad = (element as HTMLElement & {
      getBoxQuads?: () => Array<{
        p1: Point;
        p2: Point;
        p3: Point;
        p4: Point;
      }>;
    }).getBoxQuads?.()[0];

    if (quad) {
      return [quad.p1, quad.p2, quad.p3, quad.p4];
    }

    return measuredViewportQuad(element);
  }

  function measuredViewportQuad(element: HTMLElement): Point[] {
    const width = element.offsetWidth;
    const height = element.offsetHeight;
    if (width <= 0 || height <= 0) {
      return rectQuad(element.getBoundingClientRect());
    }

    const positions = [
      { x: 0, y: 0 },
      { x: width, y: 0 },
      { x: width, y: height },
      { x: 0, y: height },
    ];
    const previousPosition = element.style.position;
    const needsPosition = getComputedStyle(element).position === 'static';
    if (needsPosition) {
      element.style.position = 'relative';
    }

    const markers = positions.map((position) => {
      const marker = document.createElement('span');
      marker.style.cssText = [
        'position: absolute',
        `left: ${position.x}px`,
        `top: ${position.y}px`,
        'width: 0',
        'height: 0',
        'margin: 0',
        'padding: 0',
        'border: 0',
        'visibility: hidden',
        'pointer-events: none',
      ].join('; ');
      element.append(marker);
      return marker;
    });

    const points = markers.map((marker) => {
      const rect = marker.getBoundingClientRect();
      return { x: rect.left, y: rect.top };
    });

    for (const marker of markers) {
      marker.remove();
    }
    if (needsPosition) {
      element.style.position = previousPosition;
    }
    return points;
  }

  function cssMatrix3dForQuad(width: number, height: number, quad: Point[]): string {
    const homography = solveHomography(
      [
        { x: 0, y: 0 },
        { x: width, y: 0 },
        { x: width, y: height },
        { x: 0, y: height },
      ],
      quad,
    );

    if (!homography) {
      return 'matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1)';
    }

    return [
      'matrix3d(',
      formatMatrixNumber(homography[0]), ', ',
      formatMatrixNumber(homography[3]), ', ',
      '0, ',
      formatMatrixNumber(homography[6]), ', ',
      formatMatrixNumber(homography[1]), ', ',
      formatMatrixNumber(homography[4]), ', ',
      '0, ',
      formatMatrixNumber(homography[7]), ', ',
      '0, 0, 1, 0, ',
      formatMatrixNumber(homography[2]), ', ',
      formatMatrixNumber(homography[5]), ', ',
      '0, ',
      formatMatrixNumber(homography[8]),
      ')',
    ].join('');
  }

  function formatMatrixNumber(value: number): string {
    return Number.isFinite(value) ? value.toFixed(6).replace(/\.?0+$/, '') : '0';
  }

  function cssUrl(value: string): string {
    return value ? `url(${JSON.stringify(value)})` : 'none';
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

</script>

<span class="hand-play-animation-anchor" aria-hidden="true"></span>
{#if activePlays.length}
  <div class="hand-play-layer" aria-hidden="true">
    {#each activePlays as play (play.id)}
      <div
        class="hand-play-card"
        style={`width: ${play.width.toFixed(1)}px; height: ${play.height.toFixed(1)}px; --hand-play-start-transform: ${play.startTransform}; --hand-play-end-transform: ${play.endTransform}; --hand-play-delay: ${play.delayMs}ms;`}
      >
        {#if play.imageUrl}
          <img src={play.imageUrl} alt="" draggable="false" />
        {/if}
      </div>
    {/each}
  </div>
{/if}

<style>
  .hand-play-animation-anchor {
    display: none;
  }

  :global(.card-tile[data-hand-play-animation-hide-contents='true']) {
    visibility: hidden;
  }

  :global([data-hand-play-animation-hide-contents='true']:not(.card-tile) > *) {
    visibility: hidden;
  }

  :global([data-hand-attach-animation-active='true']) {
    isolation: isolate;
  }

  :global([data-hand-attach-animation-active='true']::before) {
    content: "";
    position: absolute;
    inset: 0;
    z-index: 1;
    display: block;
    border-radius: inherit;
    pointer-events: none;
    background: var(--hand-attach-card-image) center / cover no-repeat, #f7f8fa;
    box-shadow:
      0 8px 16px rgba(23, 30, 38, 0.18),
      0 0 0 1px rgba(18, 21, 26, 0.14);
    transform-origin: center;
    animation: hand-attach-slide-under 360ms cubic-bezier(0.22, 0.61, 0.36, 1) var(--hand-attach-delay) both;
    will-change: transform, opacity;
  }

  :global([data-hand-attach-animation-active='true'] > .card-tile) {
    z-index: 2;
  }

  .hand-play-layer {
    position: fixed;
    inset: 0;
    z-index: 80;
    overflow: visible;
    pointer-events: none;
    perspective: 1200px;
    transform-style: preserve-3d;
  }

  .hand-play-card {
    position: absolute;
    top: 0;
    left: 0;
    z-index: 20;
    display: block;
    overflow: hidden;
    border-radius: 5px;
    pointer-events: none;
    background: #f7f8fa;
    box-shadow:
      0 12px 26px rgba(23, 30, 38, 0.24),
      0 0 0 1px rgba(18, 21, 26, 0.18);
    transform-origin: 0 0;
    animation: hand-play-travel 360ms cubic-bezier(0.22, 0.61, 0.36, 1) var(--hand-play-delay) both;
    backface-visibility: hidden;
    will-change: transform, opacity;
  }

  .hand-play-card img {
    width: 100%;
    height: 100%;
    display: block;
    object-fit: fill;
    pointer-events: none;
    -webkit-user-drag: none;
  }

  @keyframes hand-play-travel {
    0% {
      opacity: 0;
      transform: var(--hand-play-start-transform);
    }
    1% {
      opacity: 1;
      transform: var(--hand-play-start-transform);
    }
    100% {
      opacity: 1;
      transform: var(--hand-play-end-transform);
    }
  }

  @keyframes hand-attach-slide-under {
    0% {
      opacity: 0;
      transform:
        translate3d(var(--hand-attach-start-x), var(--hand-attach-start-y), 0)
        rotate(var(--hand-attach-start-rotation))
        scale(0.94);
    }
    8% {
      opacity: 0.92;
      transform:
        translate3d(var(--hand-attach-start-x), var(--hand-attach-start-y), 0)
        rotate(var(--hand-attach-start-rotation))
        scale(0.94);
    }
    100% {
      opacity: 0;
      transform:
        translate3d(0, 0, 0)
        rotate(var(--hand-attach-start-rotation))
        scale(0.82);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .hand-play-card,
    :global([data-hand-attach-animation-active='true']::before) {
      animation: none;
    }
  }
</style>
