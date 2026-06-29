<script lang="ts">
  import { cardBackCssVar, cardFaceImageUrl } from '../game/cardAssets';
  import { onDestroy } from 'svelte';
  import {
    hideElementForAnimation,
    releaseElementVisibilityClaim,
    type ElementVisibilityClaim,
  } from '../animations/animationVisibilityClaims';
  import { createReplayPhasePlanRunner } from '../animations/replayPhasePlanRunner.svelte';
  import { scheduleReplayAnimationGroupRemoval, scheduleReplayAnimationScopeClear } from '../animations/replayAnimationSpriteLifecycle';
  import { replayAnimationScopeExitSettleMs } from '../animations/replayAnimationHandoff';
  import { replayAnimationPlanHasPhase, replayAnimationSelectedMotionsPlanKey, type CardMoveAnimationMotion, type ReplayAnimationPhasePlan } from '../animations/replayAnimationPlan';
  import {
    strictVisualElementForMotionAnchor,
    centerOf,
    deckTopElement,
    plannedMotionCard,
    plannedMotionFaceDown,
  } from '../animations/viewportCardMotion';
  import { actionAnimationBatchEvents, actionAnimationStartMs } from '../cabt/actionAnimationSchedule';
  import { cabtCardToView } from '../cabt/cardView';
  import { CabtAreaType } from '../cabt/types';
  import type { ActionTimelineEvent, CardView } from '../game/types';

  type Props = {
    events?: ActionTimelineEvent[];
    scopeKey?: string | number;
    replayMode?: boolean;
    animationPlan?: ReplayAnimationPhasePlan;
  };

  type RectSnapshot = {
    left: number;
    top: number;
    width: number;
    height: number;
  };

  type HandCardSnapshot = RectSnapshot & {
    serial: number;
    sourceElement: HTMLElement;
  };

  type HandSnapshot = {
    handRect: RectSnapshot;
    cards: HandCardSnapshot[];
    concealed: boolean;
    topHand: boolean;
  };

  type ResetSpriteBase = {
    id: string;
    card?: CardView;
    concealed: boolean;
    topHand: boolean;
    left: number;
    top: number;
    width: number;
    height: number;
    moveX: number;
    moveY: number;
    scale: number;
    delayMs: number;
    durationMs: number;
  };

  type PlannedResetSprite = ResetSpriteBase & { lifecycle: { kind: 'planned' } };
  type LiveResetSprite = ResetSpriteBase & { lifecycle: { kind: 'live'; sourceElement: HTMLElement } };
  type ResetSprite = PlannedResetSprite | LiveResetSprite;

  type ResetAnimation = {
    id: number;
    sprites: ResetSprite[];
  };

  type LiveHiddenResetSource = ElementVisibilityClaim;

  type ClearOptions = {
    restoreSources?: boolean;
    restoreConnectedSourcesAfterMs?: number;
  };

  let {
    events = [],
    scopeKey = '',
    replayMode = false,
    animationPlan,
  }: Props = $props();

  const timers: ReturnType<typeof setTimeout>[] = [];
  const sourceRestoreTimers: ReturnType<typeof setTimeout>[] = [];
  const cardMoveDurationMs = 360;
  const handOutroSettleMs = 180;
  let nextAnimationId = 1;
  let resets = $state<ResetAnimation[]>([]);
  let liveHiddenSources: LiveHiddenResetSource[] = [];
  const replayPlanRunner = createReplayPhasePlanRunner({
    selectMotions: handToDeckPlanMotions,
    planKey: replayAnimationSelectedMotionsPlanKey,
    lifecycle: 'replay',
    onScopeChange: settleResets,
    onPlanChange: () => clearResets({ restoreSources: false, restoreConnectedSourcesAfterMs: handOutroSettleMs }),
    startPlanned: startPlannedReset,
  });

  onDestroy(() => {
    clearResets({ restoreSources: true });
    for (const timer of sourceRestoreTimers) {
      clearTimeout(timer);
    }
    sourceRestoreTimers.length = 0;
  });

  $effect(() => {
    const currentEvents = events;
    const currentScopeKey = scopeKey;
    const replay = replayPlanRunner.update({
      events: currentEvents,
      scopeKey: currentScopeKey,
      replayMode,
      animationPlan,
    });
    if (replay.handled) {
      return;
    }

    const animationEvents = actionAnimationBatchEvents(currentEvents, replay.seenEventIds);
    const resetEvents = animationEvents.filter((event) => {
      if (!isHandToDeckMove(event)) {
        return false;
      }
      if (replayPlanRunner.hasSeen(event)) {
        return false;
      }
      return true;
    });

    replay.markEventsSeen(currentEvents);

    if (resetEvents.length) {
      startReset(resetEvents, animationEvents);
    }
  });

  function handToDeckPlanMotions(plan: ReplayAnimationPhasePlan | undefined): CardMoveAnimationMotion[] {
    return (plan?.motions ?? []).filter((motion): motion is CardMoveAnimationMotion =>
      motion.kind === 'card-move'
      && motion.coordinateSpace === 'viewport'
      && motion.sourceAnchor.kind === 'hand-card'
      && motion.targetAnchor.kind === 'deck-top'
      && replayAnimationPlanHasPhase(plan, 'HandToDeck', motion.sourceAnchor.playerIndex),
    );
  }

  function startPlannedReset(motions: CardMoveAnimationMotion[]) {
    const sprites = motions.map((motion) => plannedResetSpriteForMotion(motion));
    if (sprites.some((sprite) => !sprite)) {
      return;
    }
    const plannedSprites = sprites.filter((sprite): sprite is PlannedResetSprite => !!sprite);

    const animation: ResetAnimation = {
      id: nextAnimationId++,
      sprites: plannedSprites,
    };
    resets = [...resets, animation];
    scheduleReplayAnimationGroupRemoval({
      item: animation,
      motions,
      phaseDurationMs: animationPlan?.durationMs,
      timers,
      removeIds: removeResets,
    });
  }

  function startReset(
    resetEvents: ActionTimelineEvent[],
    animationEvents: ActionTimelineEvent[],
  ) {
    if (replayPlanRunner.reduceMotion) {
      return;
    }

    const hands = snapshotHands();
    const sprites = resetEvents.flatMap((event) => resetSpriteForEvent(event, hands, animationEvents));
    if (!sprites.length) {
      return;
    }

    const animation: ResetAnimation = {
      id: nextAnimationId++,
      sprites,
    };
    const animationSources = hideLiveSources(sprites.map((sprite) => sprite.lifecycle.sourceElement));
    resets = [...resets, animation];
    const timer = setTimeout(() => {
      showLiveSources(animationSources);
      resets = resets.filter((item) => item.id !== animation.id);
    }, Math.max(...sprites.map((sprite) => sprite.delayMs)) + cardMoveDurationMs + 120);
    timers.push(timer);
  }

  function clearResets({
    restoreSources: shouldRestoreSources = true,
    restoreConnectedSourcesAfterMs,
  }: ClearOptions = {}) {
    const sourcesToRestore = [...liveHiddenSources];
    for (const timer of timers) {
      clearTimeout(timer);
    }
    timers.length = 0;
    if (shouldRestoreSources) {
      showLiveSources(sourcesToRestore);
    } else if (restoreConnectedSourcesAfterMs !== undefined && sourcesToRestore.length) {
      const timer = setTimeout(() => {
        showLiveSources(sourcesToRestore.filter((source) => source.element.isConnected));
        const timerIndex = sourceRestoreTimers.indexOf(timer);
        if (timerIndex >= 0) {
          sourceRestoreTimers.splice(timerIndex, 1);
        }
      }, restoreConnectedSourcesAfterMs);
      sourceRestoreTimers.push(timer);
    }
    liveHiddenSources = [];
    resets = [];
  }

  function settleResets() {
    scheduleReplayAnimationScopeClear({
      items: resets,
      timers,
      delayMs: replayAnimationScopeExitSettleMs,
      removeIds: removeResets,
    });
  }

  function removeResets(ids: ReadonlySet<number>) {
    resets = resets.filter((item) => !ids.has(item.id));
  }

  function resetSpriteForEvent(
    event: ActionTimelineEvent,
    hands: Map<number, HandSnapshot>,
    animationEvents: ActionTimelineEvent[],
  ): LiveResetSprite[] {
    if (event.playerIndex === undefined) {
      return [];
    }
    const params = event.params as Record<string, unknown> | undefined;
    const serial = Number(params?.serial);
    const cardId = Number(params?.cardId);
    if (!Number.isFinite(serial) || !Number.isFinite(cardId)) {
      return [];
    }

    const hand = hands.get(event.playerIndex);
    const card = hand?.cards.find((item) => item.serial === serial);
    const deck = deckTopElement(event.playerIndex);
    if (!hand || !card || !deck) {
      return [];
    }

    const deckRect = deck.getBoundingClientRect();
    if (deckRect.width <= 0 || deckRect.height <= 0 || card.width <= 0 || card.height <= 0) {
      return [];
    }

    const deckCenter = centerOf(deckRect);
    const cardCenter = centerOf(card);
    return [{
      id: `${event.id}-${serial}`,
      card: cabtCardToView(cardId),
      concealed: hand.concealed,
      topHand: hand.topHand,
      left: card.left,
      top: card.top,
      width: card.width,
      height: card.height,
      moveX: deckCenter.x - cardCenter.x,
      moveY: deckCenter.y - cardCenter.y,
      scale: Math.max(0.5, Math.min(1.2, deckRect.width / card.width)),
      delayMs: actionAnimationStartMs(animationEvents, event),
      durationMs: cardMoveDurationMs,
      lifecycle: { kind: 'live', sourceElement: card.sourceElement },
    }];
  }

  function plannedResetSpriteForMotion(motion: CardMoveAnimationMotion): PlannedResetSprite | undefined {
    const sourceElement = strictVisualElementForMotionAnchor(motion.sourceAnchor, motion.identity);
    const deck = strictVisualElementForMotionAnchor(motion.targetAnchor, motion.identity);
    if (!sourceElement || !deck) {
      return undefined;
    }
    const visualCard = sourceElement.querySelector('.card-tile');
    const sourceRect = (visualCard instanceof HTMLElement ? visualCard : sourceElement).getBoundingClientRect();
    const deckRect = deck.getBoundingClientRect();
    if (sourceRect.width <= 0 || sourceRect.height <= 0 || deckRect.width <= 0 || deckRect.height <= 0) {
      return undefined;
    }

    const deckCenter = centerOf(deckRect);
    const cardCenter = centerOf(sourceRect);
    const handElement = sourceElement.closest('.hand');
    const card = plannedMotionCard(motion);
    return {
      id: motion.id,
      card,
      concealed: handElement?.classList.contains('concealed') ?? plannedMotionFaceDown(motion),
      topHand: !!sourceElement.closest('.player-panel.top'),
      left: sourceRect.left,
      top: sourceRect.top,
      width: sourceRect.width,
      height: sourceRect.height,
      moveX: deckCenter.x - cardCenter.x,
      moveY: deckCenter.y - cardCenter.y,
      scale: Math.max(0.5, Math.min(1.2, deckRect.width / sourceRect.width)),
      delayMs: motion.startMs,
      durationMs: motion.durationMs,
      lifecycle: { kind: 'planned' },
    };
  }

  function isHandToDeckMove(event: ActionTimelineEvent): boolean {
    const params = event.params as Record<string, unknown> | undefined;
    return event.kind === 'MoveCard'
      && event.playerIndex !== undefined
      && Number(params?.fromArea) === CabtAreaType.HAND
      && Number(params?.toArea) === CabtAreaType.DECK
      && Number.isFinite(Number(params?.serial))
      && Number.isFinite(Number(params?.cardId));
  }

  function snapshotHands(): Map<number, HandSnapshot> {
    const hands = new Map<number, HandSnapshot>();
    for (const handElement of document.querySelectorAll('[data-card-anchor$=":hand"]')) {
      if (!(handElement instanceof HTMLElement)) {
        continue;
      }
      const match = handElement.dataset.cardAnchor?.match(/^player:(\d+):hand$/);
      const playerIndex = match ? Number(match[1]) : NaN;
      if (!Number.isFinite(playerIndex)) {
        continue;
      }
      const handRect = handElement.getBoundingClientRect();
      const cards: HandCardSnapshot[] = [];
      for (const element of handElement.querySelectorAll('.hand-card-frame[data-animation-card-serial]')) {
        if (!(element instanceof HTMLElement)
          || element.dataset.drawAnimationHidden === 'true'
          || element.dataset.animationVisibilityHidden === 'true') {
          continue;
        }
        const serial = Number(element.dataset.animationCardSerial);
        if (!Number.isFinite(serial)) {
          continue;
        }
        const visualCard = element.querySelector('.card-tile');
        if (!(visualCard instanceof HTMLElement)) {
          continue;
        }
        const rect = visualCard.getBoundingClientRect();
        cards.push({
          serial,
          sourceElement: element,
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
        });
      }
      hands.set(playerIndex, {
        handRect: {
          left: handRect.left,
          top: handRect.top,
          width: handRect.width,
          height: handRect.height,
        },
        cards,
        concealed: handElement.classList.contains('concealed'),
        topHand: !!handElement.closest('.player-panel.top'),
      });
    }
    return hands;
  }

  function hideLiveSources(sources: HTMLElement[]) {
    const liveHiddenClaims: LiveHiddenResetSource[] = [];
    for (const source of sources) {
      liveHiddenClaims.push(hideElementForAnimation({
        element: source,
        scopeKey,
        role: 'source',
        fallbackAttribute: 'data-hand-reset-animation-hidden',
        forceFallback: true,
      }));
    }
    liveHiddenSources = [...liveHiddenSources, ...liveHiddenClaims];
    return liveHiddenClaims;
  }

  function showLiveSources(sources: LiveHiddenResetSource[]) {
    const nextHiddenSources = new Set(liveHiddenSources);
    for (const source of sources) {
      releaseElementVisibilityClaim(source);
      nextHiddenSources.delete(source);
    }
    liveHiddenSources = [...nextHiddenSources];
  }

  function spriteStyle(sprite: ResetSprite): string {
    return [
      `left: ${sprite.left}px`,
      `top: ${sprite.top}px`,
      `width: ${sprite.width}px`,
      `height: ${sprite.height}px`,
      `--hand-reset-move-x: ${sprite.moveX.toFixed(1)}px`,
      `--hand-reset-move-y: ${sprite.moveY.toFixed(1)}px`,
      `--hand-reset-scale: ${sprite.scale.toFixed(3)}`,
      `--hand-reset-delay: ${sprite.delayMs}ms`,
      `--hand-reset-move-ms: ${sprite.durationMs}ms`,
    ].join('; ');
  }
</script>

<span class="hand-reset-animation" aria-hidden="true">
  {#each resets as reset (reset.id)}
    {#each reset.sprites as sprite (sprite.id)}
      <span
        class={`hand-reset-card ${sprite.concealed ? 'concealed' : ''} ${sprite.topHand ? 'top-hand' : ''}`}
        style={spriteStyle(sprite)}
      >
        <span class="hand-reset-card-position">
          <span class={`hand-reset-card-motion ${sprite.concealed ? '' : 'revealed'}`}>
            <span class="hand-reset-card-orientation">
              <span class="hand-reset-card-inner">
                <span class="hand-reset-card-face hand-reset-card-back" style={cardBackCssVar()}></span>
                {#if !sprite.concealed}
                <span class="hand-reset-card-face hand-reset-card-front">
                  {#if cardFaceImageUrl(sprite.card)}
                    <img src={cardFaceImageUrl(sprite.card)} alt="" draggable="false" />
                  {:else}
                    <span class="fallback-name">{sprite.card?.name ?? 'Card'}</span>
                  {/if}
                </span>
                {/if}
              </span>
            </span>
          </span>
        </span>
      </span>
    {/each}
  {/each}
</span>

<style>
  .hand-reset-animation {
    position: fixed;
    inset: 0;
    z-index: 76;
    overflow: visible;
    pointer-events: none;
  }

  .hand-reset-card {
    position: absolute;
    display: block;
    border-radius: 6px;
    transform-origin: center;
    transform-style: preserve-3d;
    will-change: transform;
  }

  :global([data-hand-reset-animation-hidden='true']) {
    visibility: hidden;
  }

  .hand-reset-card-position,
  .hand-reset-card-motion,
  .hand-reset-card-orientation,
  .hand-reset-card-inner {
    position: absolute;
    inset: 0;
    display: block;
    border-radius: inherit;
    transform-style: preserve-3d;
  }

  .hand-reset-card-motion {
    display: grid;
    place-items: center;
    overflow: hidden;
    animation: hand-reset-to-deck var(--hand-reset-move-ms) cubic-bezier(0.22, 0.61, 0.36, 1) var(--hand-reset-delay) both;
    will-change: transform, opacity;
  }

  .hand-reset-card-inner {
    transform-style: preserve-3d;
    will-change: transform;
  }

  .hand-reset-card.top-hand .hand-reset-card-orientation {
    transform: rotate(180deg);
  }

  .hand-reset-card-motion.revealed .hand-reset-card-inner {
    animation: hand-reset-flip-to-back var(--hand-reset-move-ms) ease-in-out var(--hand-reset-delay) both;
  }

  .hand-reset-card-face {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    overflow: hidden;
    border-radius: inherit;
    box-shadow:
      0 12px 26px rgba(23, 30, 38, 0.22),
      0 0 0 1px rgba(18, 21, 26, 0.18);
    backface-visibility: hidden;
  }

  .hand-reset-card-front {
    background: #f7f8fa;
  }

  .hand-reset-card-back {
    transform: rotateY(180deg);
    background:
      var(--card-back-image, var(--cardback-shade)),
      linear-gradient(135deg, rgba(255, 255, 255, 0.1), transparent 28%),
      repeating-linear-gradient(45deg, rgba(255, 255, 255, 0.08) 0 6px, transparent 6px 12px),
      linear-gradient(145deg, #203654, #111a2c);
    background-size: cover, auto, auto, auto;
    background-position: center;
  }

  .hand-reset-card-motion:not(.revealed) .hand-reset-card-back {
    transform: rotateY(0deg);
  }

  .hand-reset-card-motion:not(.revealed) .hand-reset-card-front {
    display: none;
  }

  .hand-reset-card img {
    width: 100%;
    height: 100%;
    display: block;
    pointer-events: none;
    -webkit-user-drag: none;
    object-fit: fill;
  }

  .fallback-name {
    padding: 0 7px;
    color: #1f2933;
    font-size: 11px;
    font-weight: 900;
    line-height: 1.08;
    text-align: center;
  }

  @keyframes hand-reset-to-deck {
    0% {
      opacity: 1;
      transform: translate3d(0, 0, 0) scale(1);
    }
    99% {
      opacity: 1;
      transform: translate3d(var(--hand-reset-move-x), var(--hand-reset-move-y), 0) scale(var(--hand-reset-scale));
    }
    100% {
      opacity: 0;
      transform: translate3d(var(--hand-reset-move-x), var(--hand-reset-move-y), 0) scale(var(--hand-reset-scale));
    }
  }

  @keyframes hand-reset-flip-to-back {
    0% {
      transform: rotateY(0deg);
    }
    100% {
      transform: rotateY(180deg);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .hand-reset-card-motion.revealed .hand-reset-card-inner,
    .hand-reset-card-motion {
      animation: none;
    }
  }
</style>
