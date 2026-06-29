<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import {
    hideElementForAnimation,
    releaseElementVisibilityClaim,
    type ElementVisibilityClaim,
  } from '../animations/animationVisibilityClaims';
  import { resolveExactAnimationAnchorElement } from '../animations/animationAnchors';
  import { replayAnimationSpriteRemovalMs } from '../animations/replayAnimationHandoff';
  import type { CardMoveAnimationMotion, ReplayAnimationPhasePlan } from '../animations/replayAnimationPlan';
  import { actionAnimationBatchEvents, actionAnimationStartMs, actionAnimationTiming } from '../cabt/actionAnimationSchedule';
  import { cabtCardToView } from '../cabt/cardView';
  import { CabtAreaType } from '../cabt/types';
  import { viewportQuad, type Point } from '../dom/planeGeometry';
  import { replayAnimationPhaseGapMs } from '../game/replay';
  import { cardFaceImageUrl, cssAssetUrl } from '../game/cardAssets';
  import type { ActionTimelineEvent } from '../game/types';

  type Props = {
    events?: ActionTimelineEvent[];
    scopeKey?: string | number;
    replayMode?: boolean;
    animationPlan?: ReplayAnimationPhasePlan;
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
    hideContents: boolean;
    removeMs?: number;
    planned: boolean;
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
    removeMs?: number;
    planned: boolean;
  };

  type TargetAnimation = FixedAnimation | SlotAttachAnimation;

  type ActivePlay = Omit<FixedAnimation, 'target' | 'hideContents' | 'kind'>;

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
  const cardHeightToWidthRatio = 88 / 63;
  let nextPlayId = 0;
  let seenEventIds = new Set<number>();
  let initialized = false;
  let reduceMotion = $state(false);
  let lastScopeKey: string | number = '';
  let lastPlanKey = '';
  let previousCardRects = new Map<number, RectSnapshot>();
  let activePlays = $state<ActivePlay[]>([]);
  const activeTargetCounts = new WeakMap<HTMLElement, number>();
  const hiddenContentClaims = new WeakMap<HTMLElement, ElementVisibilityClaim[]>();
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
    const currentPlan = animationPlan;
    const plannedMotions = handPlayPlanMotions(currentPlan);
    const planKey = currentPlanKey(currentPlan);
    const scopeChanged = initialized && currentScopeKey !== lastScopeKey;
    const planChanged = planKey !== lastPlanKey;
    lastScopeKey = currentScopeKey;
    lastPlanKey = planKey;

    if (replayMode && (scopeChanged || (plannedMotions.length && planChanged))) {
      clearPlays();
    }

    if (plannedMotions.length) {
      initialized = true;
      if (!reduceMotion && (scopeChanged || planChanged)) {
        startPlannedPlay(plannedMotions);
      }
      markEventsSeen(currentEvents);
      previousCardRects = snapshotHandCardRects();
      return;
    }

    if (!initialized) {
      markEventsSeen(currentEvents);
      initialized = true;
      previousCardRects = snapshotHandCardRects();
      return;
    }

    if (replayMode && scopeChanged) {
      clearPlays();
    }

    if (replayMode) {
      markEventsSeen(currentEvents);
      previousCardRects = snapshotHandCardRects();
      return;
    }

    const animationEvents = actionAnimationBatchEvents(currentEvents, seenEventIds);
    const playEvents = animationEvents.filter((event) => {
      if (!isHandPlayEvent(event)) {
        return false;
      }
      if (seenEventIds.has(event.id)) {
        return false;
      }
      return true;
    });

    markEventsSeen(currentEvents);

    if (playEvents.length) {
      startPlay(playEvents, animationEvents);
    }
    previousCardRects = snapshotHandCardRects();
  });

  function markEventsSeen(currentEvents: ActionTimelineEvent[]) {
    for (const event of currentEvents) {
      seenEventIds.add(event.id);
    }
  }

  function currentPlanKey(plan: ReplayAnimationPhasePlan | undefined): string {
    return plan ? `${plan.key}:${plan.motions.map((motion) => motion.id).join(',')}` : '';
  }

  function handPlayPlanMotions(plan: ReplayAnimationPhasePlan | undefined): CardMoveAnimationMotion[] {
    return (plan?.motions ?? []).filter((motion): motion is CardMoveAnimationMotion =>
      motion.kind === 'card-move'
      && motion.coordinateSpace === 'viewport'
      && motion.sourceAnchor.kind === 'hand-card'
      && motion.targetAnchor.kind !== 'deck-top'
      && motion.targetAnchor.kind !== 'hand-card');
  }

  function isHandPlayEvent(event: ActionTimelineEvent): boolean {
    const params = event.params as Record<string, unknown> | undefined;
    if (event.kind === 'Play' || event.kind === 'Attach' || event.kind === 'Evolve') {
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
    activateAnimations(targetAnimations);
  }

  function startPlannedPlay(motions: CardMoveAnimationMotion[]) {
    const targetAnimations = motions.flatMap(targetAnimationForMotion);
    activateAnimations(targetAnimations);
  }

  function activateAnimations(targetAnimations: TargetAnimation[]) {
    if (!targetAnimations.length) {
      return;
    }

    for (const animation of targetAnimations) {
      activateTarget(animation);
      if (animation.kind === 'fixed') {
        activePlays = [...activePlays, animation];
      }
      const animationMoveMs = animation.kind === 'fixed' && animation.mode === 'evolve'
        ? evolveMoveDurationMs
        : cardMoveDurationMs;
      const animationVisibleMs = animation.kind === 'fixed' && animation.mode === 'evolve'
        ? evolveVisibleDurationMs
        : animationMoveMs;
      const cleanupDelayMs = animation.planned
        ? animation.removeMs
        : animation.delayMs + animationVisibleMs + 24;
      if (cleanupDelayMs !== undefined) {
        const timer = setTimeout(() => {
          if (animation.kind === 'fixed') {
            activePlays = activePlays.filter((play) => play.id !== animation.id);
          }
          deactivateTargets([animation.target]);
        }, cleanupDelayMs);
        timers.push(timer);
      }
    }

    const cleanupTimes = targetAnimations
      .map((animation) => animation.planned ? animation.removeMs : animation.delayMs + animationTotalMs(animation))
      .filter((time): time is number => time !== undefined);
    if (cleanupTimes.length) {
      const timer = setTimeout(() => {
        deactivateTargets(targetAnimations.filter((animation) =>
          !animation.planned || animation.removeMs !== undefined).map((animation) => animation.target));
      }, Math.max(...cleanupTimes) + 120);
      timers.push(timer);
    }
  }

  function targetAnimationForMotion(motion: CardMoveAnimationMotion): TargetAnimation[] {
    if (motion.sourceAnchor.kind !== 'hand-card') {
      return [];
    }
    const playerIndex = motion.sourceAnchor.playerIndex;
    const serial = Number(motion.sourceAnchor.serial ?? motion.identity?.serial);
    const handElement = handAnchor(playerIndex);
    const target = targetElementForMotion(motion);
    const planeElement = target?.closest('.game-board-plane') as HTMLElement | null;
    if (!handElement || !target || !planeElement) {
      return [];
    }

    const sourceRect = sourceRectForHand(handElement, serial);
    const visualTarget = visualTargetForAnimation(target);
    const targetRect = visualTarget.getBoundingClientRect();
    if (sourceRect.width <= 0 || sourceRect.height <= 0 || targetRect.width <= 0 || targetRect.height <= 0) {
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
        sourceRect,
        attachRect,
        cardFaceImageUrl(spriteCard ?? metadataCard) ?? '',
        motion.startMs,
        replayAnimationSpriteRemovalMs(motion, animationPlan?.durationMs),
        true,
      )];
    }

    const sourceQuad = sourceQuadForHand(handElement, sourceRect);
    const targetQuad = viewportQuad(visualTarget);
    const startTransform = cssMatrix3dForQuad(sourceRect.width, sourceRect.height, sourceQuad);
    const endTransform = cssMatrix3dForQuad(sourceRect.width, sourceRect.height, targetQuad);
    if (!startTransform || !endTransform) {
      return [];
    }

    const label = spriteCard?.name ?? metadataCard?.name ?? motion.identity?.name ?? 'Card';
    const isEvolution = isEvolutionMotion(motion);
    return [{
      kind: 'fixed',
      mode: isEvolution ? 'evolve' : 'play',
      id: nextPlayId++,
      target,
      delayMs: motion.startMs,
      width: sourceRect.width,
      height: sourceRect.height,
      startTransform,
      endTransform,
      imageUrl: cardFaceImageUrl(spriteCard ?? metadataCard) ?? '',
      label,
      setLabel: metadataCard ? [metadataCard.set, metadataCard.setNumber].filter(Boolean).join(' ') : '',
      typeClass: metadataCard && (metadataCard.energyType !== undefined || metadataCard.superType === 'Energy' || metadataCard.name.includes('Energy'))
        ? 'energy'
        : metadataCard && (metadataCard.trainerType !== undefined || metadataCard.superType === 'Trainer')
          ? 'trainer'
          : 'pokemon',
      hideContents: false,
      removeMs: replayAnimationSpriteRemovalMs(motion, animationPlan?.durationMs),
      planned: true,
    }];
  }

  function isEvolutionMotion(motion: CardMoveAnimationMotion): boolean {
    return motion.id.startsWith('Evolve:');
  }

  function slotAttachTargetForMotion(motion: CardMoveAnimationMotion, target: HTMLElement): HTMLElement | null {
    if (
      motion.targetAnchor.kind !== 'attached-energy'
      && motion.targetAnchor.kind !== 'attached-tool'
      && motion.identity?.kind !== 'energy'
      && motion.identity?.kind !== 'tool'
    ) {
      return null;
    }
    const slot = target.closest('.board-slot');
    return slot instanceof HTMLElement ? slot : null;
  }

  function targetElementForMotion(motion: CardMoveAnimationMotion): HTMLElement | null {
    const exact = resolveExactAnimationAnchorElement(motion.targetAnchor, { identity: motion.identity });
    if (exact) {
      return targetVisualElementForAnchor(exact, motion.targetAnchor.kind);
    }
    return null;
  }

  function targetVisualElementForAnchor(element: HTMLElement, anchorKind: string): HTMLElement {
    if (anchorKind === 'discard-pile') {
      const topCard = element.querySelector('.discard-card-top .card-tile');
      if (topCard instanceof HTMLElement) {
        return topCard;
      }
    }
    return element;
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
      return [slotAttachAnimationForEvent(target, sourceRect, targetRect, cardFaceImageUrl(card) ?? '', delayMs)];
    }

    const sourceQuad = sourceQuadForHand(handElement, sourceRect);
    const targetQuad = viewportQuad(visualTarget);
    const startTransform = cssMatrix3dForQuad(sourceRect.width, sourceRect.height, sourceQuad);
    const endTransform = cssMatrix3dForQuad(sourceRect.width, sourceRect.height, targetQuad);
    if (!startTransform || !endTransform) {
      return [];
    }
    const isEvolution = event.kind === 'Evolve';

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
      label: card.name,
      setLabel: [card.set, card.setNumber].filter(Boolean).join(' '),
      typeClass: card.energyType !== undefined || card.superType === 'Energy' || card.name.includes('Energy')
        ? 'energy'
        : card.trainerType !== undefined || card.superType === 'Trainer'
          ? 'trainer'
          : 'pokemon',
      hideContents: isEvolution ? false : shouldHideTargetContents(event, target),
      planned: false,
    }];
  }

  function slotAttachAnimationForEvent(
    target: HTMLElement,
    sourceRect: DOMRect,
    targetRect: DOMRect,
    imageUrl: string,
    delayMs: number,
    removeMs?: number,
    planned = false,
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
      removeMs,
      planned,
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
    if (event.kind === 'Play' && isPlayZoneCardTarget(target)) {
      return true;
    }
    if (event.kind === 'Play' && isStadiumCardTarget(target)) {
      return true;
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

  function isPlayZoneCardTarget(target: HTMLElement): boolean {
    return target.dataset.cardAnchor?.endsWith(':playZone') === true
      || target.closest('[data-card-anchor$=":playZone"]') instanceof HTMLElement;
  }

  function isStadiumCardTarget(target: HTMLElement): boolean {
    return target.dataset.cardAnchor?.endsWith(':stadium') === true
      || target.closest('[data-card-anchor$=":stadium"]') instanceof HTMLElement;
  }

  function activateTarget(animation: TargetAnimation) {
    const count = activeTargetCounts.get(animation.target) ?? 0;
    activeTargetCounts.set(animation.target, count + 1);
    animation.target.dataset.handPlayAnimationActive = 'true';
    if (animation.kind === 'slotAttach') {
      animation.target.dataset.handAttachAnimationActive = 'true';
      animation.target.style.setProperty('--hand-attach-card-image', cssAssetUrl(animation.imageUrl));
      animation.target.style.setProperty('--hand-attach-start-x', `${(animation.startX * 100).toFixed(1)}%`);
      animation.target.style.setProperty('--hand-attach-start-y', `${(animation.startY * 100).toFixed(1)}%`);
      animation.target.style.setProperty('--hand-attach-start-rotation', `${animation.startRotation.toFixed(1)}deg`);
      animation.target.style.setProperty('--hand-attach-delay', `${animation.delayMs}ms`);
    }
    if (animation.kind === 'fixed' && animation.mode === 'evolve') {
      animation.target.dataset.handEvolveAnimationActive = 'true';
      animation.target.style.setProperty('--hand-evolve-delay', `${animation.delayMs}ms`);
      animation.target.style.setProperty('--hand-evolve-move-ms', `${evolveMoveDurationMs}ms`);
      animation.target.style.setProperty('--hand-evolve-visible-ms', `${evolveVisibleDurationMs}ms`);
    }
    if (animation.hideContents) {
      hideTargetContents(animation.target);
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
      showTargetContents(target);
      delete target.dataset.handAttachAnimationActive;
      delete target.dataset.handEvolveAnimationActive;
      target.style.removeProperty('--hand-attach-card-image');
      target.style.removeProperty('--hand-attach-start-x');
      target.style.removeProperty('--hand-attach-start-y');
      target.style.removeProperty('--hand-attach-start-rotation');
      target.style.removeProperty('--hand-attach-delay');
      target.style.removeProperty('--hand-evolve-delay');
      target.style.removeProperty('--hand-evolve-move-ms');
      target.style.removeProperty('--hand-evolve-visible-ms');
    }
    activeTargets = [...nextActiveTargets];
  }

  function hideTargetContents(target: HTMLElement) {
    const claims = hiddenContentClaims.get(target) ?? [];
    claims.push(hideElementForAnimation({
      element: target,
      scopeKey,
      role: 'destination',
      fallbackAttribute: 'data-hand-play-animation-hide-contents',
    }));
    hiddenContentClaims.set(target, claims);
  }

  function showTargetContents(target: HTMLElement) {
    const claims = hiddenContentClaims.get(target) ?? [];
    for (const claim of claims) {
      releaseElementVisibilityClaim(claim);
    }
    hiddenContentClaims.delete(target);
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

  function cssMatrix3dForQuad(width: number, height: number, quad: Point[]): string | null {
    if (
      width <= 0
      || height <= 0
      || quad.length !== 4
      || quad.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))
    ) {
      return null;
    }

    const homography = solveHomography(
      [
        { x: 0, y: 0 },
        { x: width, y: 0 },
        { x: width, y: height },
        { x: 0, y: height },
      ],
      quad,
    );

    if (!homography || homography.some((value) => !Number.isFinite(value))) {
      return null;
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
