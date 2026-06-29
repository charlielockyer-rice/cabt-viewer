<script lang="ts">
  import { onDestroy } from 'svelte';
  import {
    hideElementForAnimation,
    releaseElementVisibilityClaim,
    type ElementVisibilityClaim,
  } from '../animations/animationVisibilityClaims';
  import {
    claimAnimationElementEffect,
    releaseAnimationElementEffectClaim,
    type AnimationElementEffectClaim,
  } from '../animations/animationElementEffects';
  import { strictAnimationVisualElementForAnchor } from '../animations/animationAnchorVisuals';
  import {
    cssMatrix3dForQuad,
    handPlayCardVisual,
    hasKnownHandSource,
    snapshotHandCardRects,
    slotAttachStartOffset,
    sourceRectForHand,
    sourceQuadForHandElement,
    type RectSnapshot,
    visibleCardRectForAnchor,
    visibleElementRect,
    visualTargetForHandPlay,
  } from '../animations/handPlayAnimationGeometry';
  import { replayAnimationScopeExitSettleMs, replayAnimationSpriteRemovalMs } from '../animations/replayAnimationHandoff';
  import { createReplayPhasePlanRunner, type ReplayPhasePlanRunnerContext } from '../animations/replayPhasePlanRunner.svelte';
  import { scheduleReplayAnimationScopeClear } from '../animations/replayAnimationSpriteLifecycle';
  import {
    replayAnimationPlanOwnsMotion,
    type CardMoveAnimationMotion,
    type ReplayAnimationPhasePlan,
  } from '../animations/replayAnimationPlan';
  import { actionAnimationBatchEvents, actionAnimationStartMs, actionAnimationTiming } from '../cabt/actionAnimationSchedule';
  import { cabtCardToView } from '../cabt/cardView';
  import { replayEventMoveAreas } from '../cabt/replayEventAreas';
  import { CabtAreaType } from '../cabt/types';
  import { viewportQuad } from '../dom/planeGeometry';
  import { replayAnimationPhaseGapMs } from '../game/replay';
  import { cardFaceImageUrl, cssAssetUrl } from '../game/cardAssets';
  import type { ActionTimelineEvent } from '../game/types';

  type Props = {
    events?: ActionTimelineEvent[];
    scopeKey?: string | number;
    replayMode?: boolean;
    animationPlan?: ReplayAnimationPhasePlan;
  };

  type FixedAnimation = {
    kind: 'fixed';
    mode: 'play' | 'evolve';
    id: number;
    target: HTMLElement;
    delayMs: number;
    width: number;
    height: number;
    startTransform: string;
    endTransform: string;
    imageUrl: string;
    label: string;
    setLabel: string;
    typeClass: string;
    lifecycle: HandPlayAnimationLifecycle;
  };

  type SlotAttachAnimation = {
    kind: 'slotAttach';
    target: HTMLElement;
    delayMs: number;
    imageUrl: string;
    startX: number;
    startY: number;
    startRotation: number;
    lifecycle: HandPlayAnimationLifecycle;
  };

  type HandPlayAnimationLifecycle = {
    kind: 'planned';
    removeMs?: number;
  } | {
    kind: 'live';
    hideContents: boolean;
  };

  type TargetAnimation = FixedAnimation | SlotAttachAnimation;

  type ActivePlay = Omit<FixedAnimation, 'target' | 'lifecycle' | 'kind'>;
  type ActiveTargetEffect = {
    target: HTMLElement;
    effectClaim: AnimationElementEffectClaim;
    liveHiddenClaim?: ElementVisibilityClaim;
  };

  let {
    events = [],
    scopeKey = '',
    replayMode = false,
    animationPlan,
  }: Props = $props();

  const timers: ReturnType<typeof setTimeout>[] = [];
  const cardMoveDurationMs = 360;
  const evolveMoveDurationMs = 430;
  const evolveVisibleDurationMs = actionAnimationTiming.evolveMs + replayAnimationPhaseGapMs + 40;
  let nextPlayId = 0;
  let previousCardRects = new Map<number, RectSnapshot>();
  let activePlays = $state<ActivePlay[]>([]);
  let activeTargets: ActiveTargetEffect[] = [];
  const replayPlanRunner = createReplayPhasePlanRunner({
    selectMotions: handPlayPlanMotions,
    lifecycle: 'replay',
    onScopeChange: settlePlays,
    onPlanChange: clearPlays,
    startPlanned: startPlannedPlay,
  });

  onDestroy(() => {
    clearPlays();
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
    const playEvents = animationEvents.filter((event) => {
      if (!isHandPlayEvent(event)) {
        return false;
      }
      if (replayPlanRunner.hasSeen(event)) {
        return false;
      }
      return true;
    });

    replay.markEventsSeen(currentEvents);

    if (playEvents.length) {
      startPlay(playEvents, animationEvents);
    }
    if (!replayMode) {
      previousCardRects = snapshotHandCardRects();
    }
  });

  function handPlayPlanMotions(plan: ReplayAnimationPhasePlan | undefined): CardMoveAnimationMotion[] {
    return (plan?.motions ?? []).filter((motion): motion is CardMoveAnimationMotion =>
      motion.kind === 'card-move'
      && motion.coordinateSpace === 'viewport'
      && motion.sourceAnchor.kind === 'hand-card'
      && motion.targetAnchor.kind !== 'deck-top'
      && motion.targetAnchor.kind !== 'hand-card'
      && replayAnimationPlanOwnsMotion(plan, motion, ['Play', 'HandMove', 'Evolve', 'Attach']));
  }

  function isHandPlayEvent(event: ActionTimelineEvent): boolean {
    const params = event.params as Record<string, unknown> | undefined;
    if (event.kind === 'Play' || event.kind === 'Attach' || event.kind === 'Evolve') {
      return Number.isFinite(Number(params?.cardId));
    }
    const areas = replayEventMoveAreas(event);
    return event.kind === 'MoveCard'
      && areas?.fromArea === CabtAreaType.HAND
      && (
        areas.toArea === CabtAreaType.DISCARD
        || areas.toArea === CabtAreaType.ACTIVE
        || areas.toArea === CabtAreaType.BENCH
      )
      && Number.isFinite(Number(params?.cardId));
  }

  function startPlay(playEvents: ActionTimelineEvent[], animationEvents: ActionTimelineEvent[]) {
    if (replayPlanRunner.reduceMotion) {
      return;
    }

    const targetAnimations = playEvents.flatMap((event) => targetAnimationForEvent(event, animationEvents));
    activateAnimations(targetAnimations);
  }

  function startPlannedPlay(
    motions: CardMoveAnimationMotion[],
    context: ReplayPhasePlanRunnerContext<CardMoveAnimationMotion>,
  ) {
    const targetAnimations = motions.flatMap((motion) => targetAnimationForMotion(motion, context.plan));
    activateAnimations(targetAnimations);
  }

  function activateAnimations(targetAnimations: TargetAnimation[]) {
    if (!targetAnimations.length) {
      return;
    }

    const activated = targetAnimations.map((animation) => ({
      animation,
      activeTarget: activateTarget(animation),
    }));

    for (const { animation, activeTarget } of activated) {
      if (animation.kind === 'fixed') {
        activePlays = [...activePlays, animation];
      }
      const animationMoveMs = animation.kind === 'fixed' && animation.mode === 'evolve'
        ? evolveMoveDurationMs
        : cardMoveDurationMs;
      const animationVisibleMs = animation.kind === 'fixed' && animation.mode === 'evolve'
        ? evolveVisibleDurationMs
        : animationMoveMs;
      const cleanupDelayMs = animation.lifecycle.kind === 'planned'
        ? animation.lifecycle.removeMs
        : animation.delayMs + animationVisibleMs + 24;
      if (cleanupDelayMs !== undefined) {
        const timer = setTimeout(() => {
          if (animation.kind === 'fixed') {
            removePlays(new Set([animation.id]));
          }
          deactivateTargetEffects([activeTarget]);
        }, cleanupDelayMs);
        timers.push(timer);
      }
    }

    const cleanupTimes = targetAnimations
      .map((animation) => animation.lifecycle.kind === 'planned'
        ? animation.lifecycle.removeMs
        : animation.delayMs + animationTotalMs(animation))
      .filter((time): time is number => time !== undefined);
    if (cleanupTimes.length) {
      const timer = setTimeout(() => {
        deactivateTargetEffects(activated
          .filter(({ animation }) => animation.lifecycle.kind === 'live' || animation.lifecycle.removeMs !== undefined)
          .map(({ activeTarget }) => activeTarget));
      }, Math.max(...cleanupTimes) + 120);
      timers.push(timer);
    }
  }

  // Planned replay path: strict semantic anchors only; visibility is owned by the phase plan.
  function targetAnimationForMotion(
    motion: CardMoveAnimationMotion,
    plan: ReplayAnimationPhasePlan | undefined,
  ): TargetAnimation[] {
    if (motion.sourceAnchor.kind !== 'hand-card') {
      return [];
    }
    const source = strictPlannedHandSource(motion);
    const target = strictPlannedTarget(motion);
    const planeElement = target?.closest('.game-board-plane') as HTMLElement | null;
    if (!source || !target || !planeElement) {
      return [];
    }

    const visualTarget = visualTargetForHandPlay(target);
    const targetRect = visibleElementRect(visualTarget);
    if (!targetRect) {
      return [];
    }

    const spriteCard = motion.spriteVisual.kind === 'card' && motion.spriteVisual.card
      ? motion.spriteVisual.card
      : undefined;
    const metadataCard = motion.identity?.cardId !== undefined
        ? cabtCardToView(motion.identity.cardId)
        : undefined;
    const attachTarget = slotAttachTargetForMotion(motion, target);
    if (attachTarget) {
      const attachRect = attachTarget.getBoundingClientRect();
      if (attachRect.width <= 0 || attachRect.height <= 0) {
        return [];
      }
      return [slotAttachAnimationForEvent(
        attachTarget,
        source.rect,
        attachRect,
        cardFaceImageUrl(spriteCard ?? metadataCard) ?? '',
        motion.startMs,
        { kind: 'planned', removeMs: replayAnimationSpriteRemovalMs(motion, plan?.durationMs) },
      )];
    }

    const sourceQuad = sourceQuadForHandElement(source.element, source.rect);
    const targetQuad = viewportQuad(visualTarget);
    const startTransform = cssMatrix3dForQuad(source.rect.width, source.rect.height, sourceQuad);
    const endTransform = cssMatrix3dForQuad(source.rect.width, source.rect.height, targetQuad);
    if (!startTransform || !endTransform) {
      return [];
    }

    const visual = handPlayCardVisual(metadataCard, spriteCard?.name ?? metadataCard?.name ?? motion.identity?.name ?? 'Card');
    const isEvolution = plan?.kind === 'Evolve';
    return [{
      kind: 'fixed',
      mode: isEvolution ? 'evolve' : 'play',
      id: nextPlayId++,
      target,
      delayMs: motion.startMs,
      width: source.rect.width,
      height: source.rect.height,
      startTransform,
      endTransform,
      imageUrl: cardFaceImageUrl(spriteCard ?? metadataCard) ?? '',
      label: visual.label,
      setLabel: visual.setLabel,
      typeClass: visual.typeClass,
      lifecycle: { kind: 'planned', removeMs: replayAnimationSpriteRemovalMs(motion, plan?.durationMs) },
    }];
  }

  function slotAttachTargetForMotion(motion: CardMoveAnimationMotion, target: HTMLElement): HTMLElement | null {
    if (
      motion.targetAnchor.kind !== 'attached-energy'
      && motion.targetAnchor.kind !== 'attached-tool'
    ) {
      return null;
    }
    const slot = target.closest('.board-slot');
    return slot instanceof HTMLElement ? slot : null;
  }

  function strictPlannedHandSource(motion: CardMoveAnimationMotion): { element: HTMLElement; rect: DOMRect } | undefined {
    const element = strictAnimationVisualElementForAnchor(motion.sourceAnchor, motion.identity);
    const rect = element ? visibleCardRectForAnchor(element) : undefined;
    return element && rect ? { element, rect } : undefined;
  }

  function strictPlannedTarget(motion: CardMoveAnimationMotion): HTMLElement | null {
    return strictAnimationVisualElementForAnchor(motion.targetAnchor, motion.identity) ?? null;
  }

  function clearPlays() {
    for (const timer of timers) {
      clearTimeout(timer);
    }
    timers.length = 0;
    activePlays = [];
    deactivateTargetEffects(activeTargets);
    activeTargets = [];
  }

  function settlePlays() {
    const playIds = new Set(activePlays.map((play) => play.id));
    const targets = [...activeTargets];
    scheduleReplayAnimationScopeClear({
      items: targets.map((_target, index) => ({ id: index })),
      timers,
      delayMs: replayAnimationScopeExitSettleMs,
      removeIds() {
        removePlays(playIds);
        deactivateTargetEffects(targets);
      },
    });
  }

  function removePlays(ids: ReadonlySet<number>) {
    activePlays = activePlays.filter((play) => !ids.has(play.id));
  }

  // Live event path: keep DOM fallbacks for non-replay state changes.
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
    if (event.kind === 'Attach' && !hasKnownHandSource(handElement, serial, previousCardRects)) {
      return [];
    }

    const sourceRect = sourceRectForHand(handElement, serial, previousCardRects);
    const visualTarget = visualTargetForHandPlay(target);
    const targetRect = visibleElementRect(visualTarget);
    if (sourceRect.width <= 0 || sourceRect.height <= 0 || !targetRect) {
      return [];
    }

    const card = cabtCardToView(cardId);
    const delayMs = actionAnimationStartMs(animationEvents, event);
    if (event.kind === 'Attach') {
      return [slotAttachAnimationForEvent(
        target,
        sourceRect,
        targetRect,
        cardFaceImageUrl(card) ?? '',
        delayMs,
        { kind: 'live', hideContents: false },
      )];
    }

    const sourceQuad = sourceQuadForHandElement(handElement, sourceRect);
    const targetQuad = viewportQuad(visualTarget);
    const startTransform = cssMatrix3dForQuad(sourceRect.width, sourceRect.height, sourceQuad);
    const endTransform = cssMatrix3dForQuad(sourceRect.width, sourceRect.height, targetQuad);
    if (!startTransform || !endTransform) {
      return [];
    }
    const isEvolution = event.kind === 'Evolve';
    const visual = handPlayCardVisual(card);

    return [{
      kind: 'fixed',
      mode: isEvolution ? 'evolve' : 'play',
      id: nextPlayId++,
      target,
      delayMs,
      width: sourceRect.width,
      height: sourceRect.height,
      startTransform,
      endTransform,
      imageUrl: cardFaceImageUrl(card) ?? '',
      label: visual.label,
      setLabel: visual.setLabel,
      typeClass: visual.typeClass,
      lifecycle: {
        kind: 'live',
        hideContents: isEvolution ? false : shouldHideTargetContents(event, target),
      },
    }];
  }

  function slotAttachAnimationForEvent(
    target: HTMLElement,
    sourceRect: DOMRect,
    targetRect: DOMRect,
    imageUrl: string,
    delayMs: number,
    lifecycle: HandPlayAnimationLifecycle,
  ): SlotAttachAnimation {
    const offset = slotAttachStartOffset(sourceRect, targetRect);
    return {
      kind: 'slotAttach',
      target,
      delayMs,
      imageUrl,
      startX: offset.x,
      startY: offset.y,
      startRotation: target.closest('.top-active-slot, .bench-row.opponent') ? 180 : 0,
      lifecycle,
    };
  }

  function shouldHideTargetContents(event: ActionTimelineEvent, target: HTMLElement): boolean {
    const areas = replayEventMoveAreas(event);
    if (event.kind === 'Attach') {
      return false;
    }
    if (isDiscardCardTarget(target)) {
      return event.kind === 'Play'
        || (
          event.kind === 'MoveCard'
          && areas?.toArea === CabtAreaType.DISCARD
        );
    }
    if (event.kind === 'Play' && isPlayZoneCardTarget(target)) {
      return true;
    }
    if (event.kind === 'Play' && isStadiumCardTarget(target)) {
      return true;
    }
    if (event.kind === 'MoveCard') {
      return areas?.toArea === CabtAreaType.ACTIVE || areas?.toArea === CabtAreaType.BENCH;
    }
    return !!target.dataset.pokemonSerial;
  }

  function isDiscardCardTarget(target: HTMLElement): boolean {
    return target.classList.contains('card-tile')
      && target.closest('[data-card-anchor$=":discard"]') instanceof HTMLElement;
  }

  function isPlayZoneCardTarget(target: HTMLElement): boolean {
    return target.dataset.cardAnchor?.endsWith(':playZone') === true
      || target.closest('[data-card-anchor$=":playZone"]') instanceof HTMLElement;
  }

  function isStadiumCardTarget(target: HTMLElement): boolean {
    return target.dataset.cardAnchor?.endsWith(':stadium') === true
      || target.closest('[data-card-anchor$=":stadium"]') instanceof HTMLElement;
  }

  function activateTarget(animation: TargetAnimation) {
    const attributes: Record<string, string> = {
      'data-hand-play-animation-active': 'true',
    };
    const styles: Record<string, string> = {};
    if (animation.kind === 'slotAttach') {
      attributes['data-hand-attach-animation-active'] = 'true';
      styles['--hand-attach-card-image'] = cssAssetUrl(animation.imageUrl);
      styles['--hand-attach-start-x'] = `${(animation.startX * 100).toFixed(1)}%`;
      styles['--hand-attach-start-y'] = `${(animation.startY * 100).toFixed(1)}%`;
      styles['--hand-attach-start-rotation'] = `${animation.startRotation.toFixed(1)}deg`;
      styles['--hand-attach-delay'] = `${animation.delayMs}ms`;
    }
    if (animation.kind === 'fixed' && animation.mode === 'evolve') {
      attributes['data-hand-evolve-animation-active'] = 'true';
      styles['--hand-evolve-delay'] = `${animation.delayMs}ms`;
      styles['--hand-evolve-move-ms'] = `${evolveMoveDurationMs}ms`;
      styles['--hand-evolve-visible-ms'] = `${evolveVisibleDurationMs}ms`;
    }
    const activeTarget = {
      target: animation.target,
      effectClaim: claimAnimationElementEffect({
        element: animation.target,
        attributes,
        styles,
      }),
      liveHiddenClaim: animation.lifecycle.kind === 'live' && animation.lifecycle.hideContents
        ? hideLiveTargetContents(animation.target)
        : undefined,
    };
    activeTargets = [...activeTargets, activeTarget];
    return activeTarget;
  }

  function deactivateTargetEffects(targets: ActiveTargetEffect[]) {
    const targetSet = new Set(targets);
    for (const target of targetSet) {
      releaseAnimationElementEffectClaim(target.effectClaim);
      if (target.liveHiddenClaim) {
        releaseElementVisibilityClaim(target.liveHiddenClaim);
      }
    }
    activeTargets = activeTargets.filter((target) => !targetSet.has(target));
  }

  function hideLiveTargetContents(target: HTMLElement) {
    return hideElementForAnimation({
      element: target,
      scopeKey,
      role: 'destination',
      fallbackAttribute: 'data-hand-play-animation-hide-contents',
    });
  }

  function animationTotalMs(animation: TargetAnimation): number {
    if (animation.kind === 'fixed' && animation.mode === 'evolve') {
      return evolveVisibleDurationMs;
    }
    return cardMoveDurationMs;
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

    if (event.kind === 'Evolve') {
      const targetSerial = Number(params?.serialTarget);
      const targetCardId = Number(params?.cardIdTarget);
      return boardSlotByPokemonIdentity(targetSerial, targetCardId, playerIndex)
        ?? boardSlotByPokemonIdentity(serial, cardId, playerIndex);
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
      const areas = replayEventMoveAreas(event);
      if (areas?.toArea === CabtAreaType.DISCARD) {
        return discardTarget(playerIndex, serial);
      }
      if (areas?.toArea === CabtAreaType.ACTIVE) {
        return document.querySelector(`[data-card-anchor="player:${playerIndex}:active:0"]`);
      }
      if (areas?.toArea === CabtAreaType.BENCH) {
        return boardSlotByPokemonIdentity(serial, cardId, playerIndex)
          ?? document.querySelector(`[data-card-anchor^="player:${playerIndex}:bench:"]`);
      }
    }

    if (event.kind === 'Play') {
      if (isStadiumCardId(cardId)) {
        return stadiumTarget(playerIndex, serial);
      }
      return playZoneTarget(playerIndex, serial)
        ?? discardTarget(playerIndex, serial)
        ?? boardSlotByPokemonIdentity(serial, cardId, playerIndex);
    }

    return null;
  }

  function playZoneTarget(playerIndex: number | undefined, serial: number): HTMLElement | null {
    if (playerIndex === undefined) {
      return null;
    }
    if (Number.isFinite(serial)) {
      const card = document.querySelector(`[data-card-anchor="player:${playerIndex}:playZone"] [data-card-serial="${serial}"]`);
      if (card instanceof HTMLElement) {
        return card;
      }
    }
    return document.querySelector(`[data-card-anchor="player:${playerIndex}:playZone"]`);
  }

  function stadiumTarget(playerIndex: number | undefined, serial: number): HTMLElement | null {
    if (playerIndex === undefined) {
      return null;
    }
    if (Number.isFinite(serial)) {
      const card = document.querySelector(`[data-card-anchor="player:${playerIndex}:stadium"][data-card-serial="${serial}"]`);
      if (card instanceof HTMLElement) {
        return card;
      }
    }
    return document.querySelector(`[data-card-anchor="player:${playerIndex}:stadium"]`);
  }

  function isStadiumCardId(cardId: number): boolean {
    return cabtCardToView(cardId).trainerType === 'Stadium';
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

</script>

<span class="hand-play-animation-anchor" aria-hidden="true"></span>
{#if activePlays.length}
  <div class="hand-play-layer" aria-hidden="true">
    {#each activePlays as play (play.id)}
      <div
        class="hand-play-card"
        class:evolving={play.mode === 'evolve'}
        style={`width: ${play.width.toFixed(1)}px; height: ${play.height.toFixed(1)}px; --hand-play-start-transform: ${play.startTransform}; --hand-play-end-transform: ${play.endTransform}; --hand-play-delay: ${play.delayMs}ms; --hand-play-duration: ${play.mode === 'evolve' ? evolveMoveDurationMs : cardMoveDurationMs}ms; --hand-evolve-visible-duration: ${evolveVisibleDurationMs}ms;`}
      >
        <div class={`hand-play-card-body ${play.typeClass}`}>
          {#if play.imageUrl}
            <img src={play.imageUrl} alt="" draggable="false" />
          {:else}
            <span class="fallback-card">
              <span class="fallback-name">{play.label}</span>
              {#if play.setLabel}
                <span class="fallback-set">{play.setLabel}</span>
              {/if}
            </span>
          {/if}
        </div>
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

  :global([data-hand-evolve-animation-active='true']) {
    isolation: isolate;
  }

  :global([data-hand-evolve-animation-active='true'] > .pokemon-status),
  :global([data-hand-evolve-animation-active='true'] > .energy-badges),
  :global([data-hand-evolve-animation-active='true'] > .tool-card-preview),
  :global([data-hand-evolve-animation-active='true'] > .slot-badges),
  :global([data-hand-evolve-animation-active='true'] > .prompt-damage-badge) {
    animation: hand-evolve-slot-chrome-out 170ms ease var(--hand-evolve-delay) both;
  }

  :global([data-hand-evolve-animation-active='true']::after) {
    content: "";
    position: absolute;
    inset: 0;
    z-index: 8;
    display: block;
    border-radius: inherit;
    pointer-events: none;
    opacity: 0;
    background:
      radial-gradient(circle at 50% 50%, rgba(255, 255, 255, 0.56) 0 16%, rgba(89, 198, 255, 0.28) 44%, rgba(20, 184, 166, 0) 74%);
    box-shadow:
      0 0 0 1px rgba(255, 255, 255, 0.76),
      0 0 18px rgba(59, 130, 246, 0.34),
      0 0 30px rgba(20, 184, 166, 0.2);
    transform: scale(0.84);
    animation: hand-evolve-slot-glow var(--hand-evolve-visible-ms) cubic-bezier(0.18, 0.86, 0.24, 1) var(--hand-evolve-delay) both;
    will-change: transform, opacity, box-shadow;
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
    overflow: visible;
    border-radius: 5px;
    pointer-events: none;
    transform-origin: 0 0;
    animation: hand-play-travel var(--hand-play-duration) cubic-bezier(0.22, 0.61, 0.36, 1) var(--hand-play-delay) both;
    backface-visibility: hidden;
    will-change: transform, opacity;
  }

  .hand-play-card-body {
    width: 100%;
    height: 100%;
    overflow: hidden;
    border-radius: inherit;
    background: #f7f8fa;
    box-shadow:
      0 12px 26px rgba(23, 30, 38, 0.24),
      0 0 0 1px rgba(18, 21, 26, 0.18);
    transform-origin: center;
    will-change: transform, filter, box-shadow;
  }

  .hand-play-card img {
    width: 100%;
    height: 100%;
    display: block;
    object-fit: fill;
    pointer-events: none;
    -webkit-user-drag: none;
  }

  .hand-play-card .fallback-card {
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

  .hand-play-card-body.pokemon .fallback-card {
    background: linear-gradient(145deg, #eaf4ee, #b8d7c4);
  }

  .hand-play-card-body.energy .fallback-card {
    background: linear-gradient(145deg, #fff6c2, #dfc04d);
  }

  .hand-play-card .fallback-name {
    display: -webkit-box;
    max-width: 100%;
    overflow: hidden;
    text-align: center;
    font-size: clamp(10px, calc(var(--card-w, 88px) * 0.14), 13px);
    font-weight: 950;
    line-height: 1.08;
    overflow-wrap: anywhere;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 5;
  }

  .hand-play-card .fallback-set {
    max-width: 100%;
    overflow: hidden;
    color: rgba(24, 33, 45, 0.68);
    font-size: 9px;
    font-weight: 850;
    text-overflow: ellipsis;
    text-transform: uppercase;
    white-space: nowrap;
  }

  .hand-play-card.evolving .hand-play-card-body {
    animation: hand-evolve-card-flair var(--hand-evolve-visible-duration) cubic-bezier(0.18, 0.86, 0.24, 1) var(--hand-play-delay) both;
    box-shadow:
      0 16px 34px rgba(23, 30, 38, 0.28),
      0 0 0 1px rgba(255, 255, 255, 0.68),
      0 0 24px rgba(59, 130, 246, 0.34);
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

  @keyframes hand-evolve-card-flair {
    0% {
      transform: scale(1);
      filter: brightness(1) saturate(1);
      box-shadow:
        0 16px 34px rgba(23, 30, 38, 0.28),
        0 0 0 1px rgba(255, 255, 255, 0.68),
        0 0 24px rgba(59, 130, 246, 0.34);
    }
    18% {
      transform: scale(1.035);
      filter: brightness(1.04) saturate(1.04);
    }
    42% {
      transform: scale(1.09);
      filter: brightness(1.13) saturate(1.12);
      box-shadow:
        0 20px 40px rgba(23, 30, 38, 0.3),
        0 0 0 1px rgba(255, 255, 255, 0.78),
        0 0 30px rgba(59, 130, 246, 0.42),
        0 0 44px rgba(20, 184, 166, 0.22);
    }
    58% {
      transform: scale(1.025);
      filter: brightness(1.05) saturate(1.06);
    }
    100% {
      transform: scale(1);
      filter: brightness(1) saturate(1);
      box-shadow:
        0 16px 34px rgba(23, 30, 38, 0.28),
        0 0 0 1px rgba(255, 255, 255, 0.68),
        0 0 24px rgba(59, 130, 246, 0.34);
    }
  }

  @keyframes hand-evolve-slot-chrome-out {
    0% {
      opacity: 1;
    }
    100% {
      opacity: 0;
    }
  }

  @keyframes hand-evolve-slot-glow {
    0% {
      opacity: 0;
      transform: scale(0.84);
      filter: saturate(1);
    }
    52% {
      opacity: 0.96;
      transform: scale(1.1);
      filter: saturate(1.18);
    }
    76% {
      opacity: 0.5;
      transform: scale(1.16);
      filter: saturate(1.08);
    }
    100% {
      opacity: 0;
      transform: scale(1.2);
      filter: saturate(1);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .hand-play-card,
    .hand-play-card.evolving .hand-play-card-body,
    :global([data-hand-attach-animation-active='true']::before),
    :global([data-hand-evolve-animation-active='true'] > .pokemon-status),
    :global([data-hand-evolve-animation-active='true'] > .energy-badges),
    :global([data-hand-evolve-animation-active='true'] > .tool-card-preview),
    :global([data-hand-evolve-animation-active='true'] > .slot-badges),
    :global([data-hand-evolve-animation-active='true'] > .prompt-damage-badge),
    :global([data-hand-evolve-animation-active='true']::after) {
      animation: none;
    }
  }
</style>
