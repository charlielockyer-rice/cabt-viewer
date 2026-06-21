<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { actionAnimationBatchEvents, actionAnimationStartMs, actionAnimationTiming } from '../cabt/actionAnimationSchedule';
  import { cabtCardToView } from '../cabt/cardView';
  import { CabtAreaType } from '../cabt/types';
  import { replayAnimationPhaseGapMs } from '../game/replay';
  import type { ActionTimelineEvent, CardView } from '../game/types';

  type Props = {
    events?: ActionTimelineEvent[];
    scopeKey?: string | number;
    replayMode?: boolean;
  };

  type BoardMoveSprite = {
    id: string;
    card: CardView;
    left: number;
    top: number;
    width: number;
    height: number;
    deltaX: number;
    deltaY: number;
    startRotation: number;
    targetRotation: number;
    targetScale: number;
    delayMs: number;
  };

  let {
    events = [],
    scopeKey = '',
    replayMode = false,
  }: Props = $props();

  const timers: ReturnType<typeof setTimeout>[] = [];
  let seenEventIds = new Set<number>();
  let initialized = false;
  let lastScopeKey: string | number = '';
  let reduceMotion = $state(false);
  let sprites = $state<BoardMoveSprite[]>([]);

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
    for (const timer of timers) {
      clearTimeout(timer);
    }
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

    const animationEvents = actionAnimationBatchEvents(currentEvents, seenEventIds, replayMode, scopeChanged);
    for (const event of currentEvents) {
      seenEventIds.add(event.id);
    }
    if (!animationEvents.length || reduceMotion) {
      return;
    }

    startBoardMoves(animationEvents);
  });

  function startBoardMoves(animationEvents: ActionTimelineEvent[]) {
    const moveEvents = animationEvents.filter(isBoardMoveEvent);
    for (const event of moveEvents) {
      const source = sourceElementForEvent(event);
      const target = targetElementForEvent(event, moveEvents);
      const params = event.params as Record<string, unknown> | undefined;
      const cardId = Number(params?.cardId);
      if (!source || !target || !Number.isFinite(cardId)) {
        continue;
      }

      const sourceCard = source.querySelector('.card-tile');
      const sourceRect = (sourceCard instanceof HTMLElement ? sourceCard : source).getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      const delayMs = actionAnimationStartMs(animationEvents, event);
      const sprite: BoardMoveSprite = {
        id: `${event.id}-${params?.serial ?? cardId}`,
        card: cabtCardToView(cardId),
        left: sourceRect.left,
        top: sourceRect.top,
        width: sourceRect.width,
        height: sourceRect.height,
        deltaX: targetRect.left + targetRect.width / 2 - (sourceRect.left + sourceRect.width / 2),
        deltaY: targetRect.top + targetRect.height / 2 - (sourceRect.top + sourceRect.height / 2),
        startRotation: source.closest('.top-active-slot, .bench-row.opponent') ? 180 : 0,
        targetRotation: target.closest('.top-active-slot, .bench-row.opponent') ? 180 : 0,
        targetScale: Math.max(0.35, Math.min(1.8, targetRect.width / sourceRect.width)),
        delayMs,
      };

      const startTimer = setTimeout(() => {
        source.dataset.boardMoveAnimationHidden = 'true';
        sprites = [...sprites, sprite];
        const cleanup = setTimeout(() => {
          delete source.dataset.boardMoveAnimationHidden;
          sprites = sprites.filter((item) => item.id !== sprite.id);
        }, actionAnimationTiming.boardMoveMs + replayAnimationPhaseGapMs);
        timers.push(cleanup);
      }, delayMs);
      timers.push(startTimer);
    }
  }

  function isBoardMoveEvent(event: ActionTimelineEvent) {
    const params = event.params as Record<string, unknown> | undefined;
    const fromArea = Number(params?.fromArea);
    const toArea = Number(params?.toArea);
    return event.kind === 'MoveCard'
      && (
        (fromArea === CabtAreaType.BENCH && toArea === CabtAreaType.ACTIVE)
        || (fromArea === CabtAreaType.ACTIVE && toArea === CabtAreaType.BENCH)
      );
  }

  function sourceElementForEvent(event: ActionTimelineEvent): HTMLElement | null {
    const params = event.params as Record<string, unknown> | undefined;
    const serial = Number(params?.serial);
    if (Number.isFinite(serial)) {
      const bySerial = document.querySelector(`[data-pokemon-serial="${serial}"]`);
      if (bySerial instanceof HTMLElement) {
        return bySerial;
      }
    }
    const cardId = Number(params?.cardId);
    if (Number.isFinite(cardId) && event.playerIndex !== undefined) {
      const byCard = document.querySelector(`[data-owner-index="${event.playerIndex}"][data-pokemon-card-id="${cardId}"]`);
      if (byCard instanceof HTMLElement) {
        return byCard;
      }
    }
    return null;
  }

  function targetElementForEvent(event: ActionTimelineEvent, moveEvents: ActionTimelineEvent[]): HTMLElement | null {
    const params = event.params as Record<string, unknown> | undefined;
    const playerIndex = event.playerIndex;
    if (playerIndex === undefined) {
      return null;
    }
    const toArea = Number(params?.toArea);
    if (toArea === CabtAreaType.ACTIVE) {
      return boardAnchor(playerIndex, 'active', 0);
    }
    if (toArea === CabtAreaType.BENCH) {
      const benchIndex = Number(params?.toIndex ?? params?.index ?? params?.benchIndex);
      if (Number.isInteger(benchIndex)) {
        return boardAnchor(playerIndex, 'bench', benchIndex);
      }
      return pairedBenchSourceElement(event, moveEvents);
    }
    return null;
  }

  function pairedBenchSourceElement(event: ActionTimelineEvent, moveEvents: ActionTimelineEvent[]): HTMLElement | null {
    const params = event.params as Record<string, unknown> | undefined;
    const fromArea = Number(params?.fromArea);
    const toArea = Number(params?.toArea);
    if (fromArea !== CabtAreaType.ACTIVE || toArea !== CabtAreaType.BENCH) {
      return null;
    }
    const pairedEvent = moveEvents.find((candidate) => {
      const candidateParams = candidate.params as Record<string, unknown> | undefined;
      return candidate !== event
        && candidate.playerIndex === event.playerIndex
        && Number(candidateParams?.fromArea) === CabtAreaType.BENCH
        && Number(candidateParams?.toArea) === CabtAreaType.ACTIVE;
    });
    return pairedEvent ? sourceElementForEvent(pairedEvent) : null;
  }

  function boardAnchor(playerIndex: number, slot: 'active' | 'bench', index: number): HTMLElement | null {
    const element = document.querySelector(`[data-card-anchor="player:${playerIndex}:${slot}:${index}"]`);
    return element instanceof HTMLElement ? element : null;
  }

  function spriteStyle(sprite: BoardMoveSprite) {
    return [
      `left: ${sprite.left}px`,
      `top: ${sprite.top}px`,
      `width: ${sprite.width}px`,
      `height: ${sprite.height}px`,
      `--board-move-x: ${sprite.deltaX.toFixed(1)}px`,
      `--board-move-y: ${sprite.deltaY.toFixed(1)}px`,
      `--board-move-start-rotation: ${sprite.startRotation}deg`,
      `--board-move-target-rotation: ${sprite.targetRotation}deg`,
      `--board-move-target-scale: ${sprite.targetScale.toFixed(3)}`,
      `--board-move-delay: ${sprite.delayMs}ms`,
    ].join('; ');
  }
</script>

<span class="board-move-animation-layer" aria-hidden="true">
  {#each sprites as sprite (sprite.id)}
    <span class="board-move-card" style={spriteStyle(sprite)}>
      {#if sprite.card.imageUrl}
        <img src={sprite.card.imageUrl} alt="" draggable="false" />
      {:else}
        <span>{sprite.card.name}</span>
      {/if}
    </span>
  {/each}
</span>

<style>
  .board-move-animation-layer {
    position: fixed;
    inset: 0;
    z-index: 28;
    pointer-events: none;
  }

  :global(.board-slot[data-board-move-animation-hidden="true"] > .card-tile),
  :global(.board-slot[data-board-move-animation-hidden="true"] > .pokemon-status),
  :global(.board-slot[data-board-move-animation-hidden="true"] > .energy-badges),
  :global(.board-slot[data-board-move-animation-hidden="true"] > .tool-card-preview),
  :global(.board-slot[data-board-move-animation-hidden="true"] > .slot-badges) {
    opacity: 0;
  }

  .board-move-card {
    position: fixed;
    display: grid;
    place-items: center;
    overflow: visible;
    border-radius: 5px;
    background: #f7f8fa;
    box-shadow: 0 14px 30px rgba(23, 30, 38, 0.28);
    transform-origin: 50% 50%;
    animation: board-card-move 520ms cubic-bezier(0.22, 0.78, 0.2, 1) var(--board-move-delay) both;
  }

  .board-move-card img {
    width: 100%;
    height: 100%;
    display: block;
    border-radius: inherit;
    object-fit: fill;
    pointer-events: none;
  }

  .board-move-card > span {
    padding: 8px;
    font-size: 12px;
    font-weight: 900;
    text-align: center;
  }

  @keyframes board-card-move {
    0% {
      opacity: 1;
      transform: translate3d(0, 0, 0) rotate(var(--board-move-start-rotation)) scale(1);
    }
    100% {
      opacity: 1;
      transform:
        translate3d(var(--board-move-x), var(--board-move-y), 0)
        rotate(var(--board-move-target-rotation))
        scale(var(--board-move-target-scale));
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .board-move-card {
      animation: none;
    }
  }
</style>
