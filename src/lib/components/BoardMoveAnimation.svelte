<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import CardTile from './CardTile.svelte';
  import { actionAnimationPhaseKind, actionAnimationTimelinePhaseKeyForEvent } from '../cabt/actionAnimationPhases';
  import { actionAnimationBatchEvents, actionAnimationStartMs, actionAnimationTiming } from '../cabt/actionAnimationSchedule';
  import { isDeckBoardPlacementEvent, isLiveBoardMoveEvent } from '../cabt/replayBoardMoveEvents';
  import { replayEventMoveAreas, replayEventSerial } from '../cabt/replayEventAreas';
  import { finiteNumber } from '../cabt/replayEventParams';
  import type { AnimationAnchorRef, AnimationIdentity } from '../animations/animationAnchors';
  import { afterTwoAnimationFrames } from '../animations/animationFrames';
  import { strictAnimationVisualElementForAnchor } from '../animations/animationAnchorVisuals';
  import {
    hideElementForAnimation,
    releaseElementVisibilityClaim,
    type ElementVisibilityClaim,
  } from '../animations/animationVisibilityClaims';
  import { replayAnimationScopeExitSettleMs, replayAnimationSpriteRemovalMs } from '../animations/replayAnimationHandoff';
  import { createReplayPhasePlanRunner } from '../animations/replayPhasePlanRunner.svelte';
  import {
    isResolvingCleanupCardMoveMotion,
    replayAnimationPhasePlanKey,
    replayAnimationPlanOwnsMotion,
    type CardMoveAnimationMotion,
    type ReplayAnimationPhasePlan,
  } from '../animations/replayAnimationPlan';
  import { cabtCardToView } from '../cabt/cardView';
  import { CabtAreaType } from '../cabt/types';
  import { elementRectInPlane } from '../dom/planeGeometry';
  import { cardBackCssVar } from '../game/cardAssets';
  import type { ActionTimelineEvent, CardView } from '../game/types';

  type Props = {
    events?: ActionTimelineEvent[];
    scopeKey?: string | number;
    replayMode?: boolean;
    animationPlan?: ReplayAnimationPhasePlan;
  };

  type BoardMoveSpriteBase = {
    id: string;
    html?: string;
    fallbackName: string;
    left: number;
    top: number;
    width: number;
    height: number;
    startX: number;
    startY: number;
    startScale: number;
    correctionX: number;
    correctionY: number;
    toDeck: boolean;
    fromDeck: boolean;
    opponentSide: boolean;
    delayMs: number;
    durationMs: number;
    measuring: boolean;
    card?: Pick<CardView, 'id' | 'serial' | 'name' | 'fullName' | 'cardImage' | 'imageUrl'>;
    faceDown?: boolean;
  };

  type PlannedBoardMoveSprite = BoardMoveSpriteBase & { lifecycle: { kind: 'planned' } };
  type LiveBoardMoveSprite = BoardMoveSpriteBase & { lifecycle: { kind: 'live'; handoff: LiveBoardMoveHandoff } };
  type BoardMoveSprite = PlannedBoardMoveSprite | LiveBoardMoveSprite;

  type LiveBoardMoveHandoff = {
    destinationCardId: number;
    destinationSerial?: number;
    waitForDestinationCard: boolean;
  };

  type BoardMoveInstruction = {
    event: ActionTimelineEvent;
    source: HTMLElement;
    target: HTMLElement;
    cardId: number;
    serial?: number;
    waitForDestinationCard: boolean;
    holdUntilScopeChange: boolean;
    toDeck: boolean;
    fromDeck: boolean;
    key: string;
  };

  type LiveHiddenBoardMoveElement = ElementVisibilityClaim;

  const boardMoveHandoffPollMs = 16;
  const boardMoveHandoffMaxWaitMs = 300;

  let {
    events = [],
    scopeKey = '',
    replayMode = false,
    animationPlan,
  }: Props = $props();

  let motionLayer = $state<HTMLElement>();
  const timers: ReturnType<typeof setTimeout>[] = [];
  const handoffTimers: ReturnType<typeof setTimeout>[] = [];
  const handoffFrameIds: number[] = [];
  let sprites = $state<BoardMoveSprite[]>([]);
  let animationGeneration = 0;
  const liveHiddenElements = new Map<HTMLElement, LiveHiddenBoardMoveElement[]>();
  const replayPlanRunner = createReplayPhasePlanRunner({
    selectMotions: boardCardMoveMotions,
    planKey: (_motions, plan) => replayAnimationPhasePlanKey(plan),
    onScopeChange: () => clearBoardMoves({ settleHandoff: replayMode }),
    onPlanChange: () => clearBoardMoves({ settleHandoff: replayMode }),
    startPlanned: startPlannedBoardMoves,
  });

  onDestroy(() => {
    clearBoardMoves();
    for (const timer of handoffTimers) {
      clearTimeout(timer);
    }
    handoffTimers.length = 0;
    for (const frameId of handoffFrameIds) {
      cancelAnimationFrame(frameId);
    }
    handoffFrameIds.length = 0;
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
    replay.markEventsSeen(currentEvents);
    if (!animationEvents.length || replay.reduceMotion) {
      return;
    }

    startLiveBoardMoves(animationEvents);
  });

  function boardCardMoveMotions(plan: ReplayAnimationPhasePlan | undefined): CardMoveAnimationMotion[] {
    return (plan?.motions ?? []).filter((motion): motion is CardMoveAnimationMotion =>
      motion.kind === 'card-move'
      && motion.coordinateSpace === 'board'
      && motion.sourceAnchor.kind !== 'attached-energy'
      && motion.sourceAnchor.kind !== 'attached-tool'
      && boardMoveOwnsPlannedMotion(plan, motion));
  }

  function boardMoveOwnsPlannedMotion(plan: ReplayAnimationPhasePlan | undefined, motion: CardMoveAnimationMotion): boolean {
    if (isResolvingCleanupCardMoveMotion(motion)) {
      return true;
    }
    return replayAnimationPlanOwnsMotion(plan, motion, [
      'BoardMove',
      'BoardToDeck',
      'DeckBoardPlace',
      'DeckPrizePlace',
      'StadiumMove',
      'DiscardRecover',
      'KnockOut',
    ]);
  }

  function startPlannedBoardMoves(motions: CardMoveAnimationMotion[]) {
    const boardPlane = motionLayer?.parentElement;
    if (!motionLayer || !boardPlane) {
      return;
    }
    const generation = animationGeneration;
    for (const motion of motions) {
      const sourceElement = elementForAnchor(motion.sourceAnchor, motion.identity);
      const targetElement = elementForAnchor(motion.targetAnchor, motion.identity);
      if (!sourceElement || !targetElement) {
        continue;
      }
      const sprite = plannedBoardMoveSpriteForMotion(motion, sourceElement, targetElement, generation);
      if (!sprite) {
        continue;
      }
      startPlannedBoardMoveSprite({
        sprite,
        source: sourceElement,
        target: targetElement,
        generation,
        handoffDelayMs: plannedBoardMoveHandoffDelayMs(motion),
        holdUntilScopeChange: motion.handoffPolicy.removeSprite === 'scope-exit',
      });
    }
  }

  function plannedBoardMoveSpriteForMotion(
    motion: CardMoveAnimationMotion,
    sourceElement: HTMLElement,
    targetElement: HTMLElement,
    generation: number,
  ): PlannedBoardMoveSprite | undefined {
    const boardPlane = motionLayer?.parentElement;
    if (!boardPlane || motion.spriteVisual.kind !== 'card') {
      return undefined;
    }
    const card = motion.spriteVisual.card;
    const faceDown = motion.spriteVisual.faceDown;
    if (!card && !faceDown) {
      return undefined;
    }
    const sourceRect = elementRectInPlane(sourceElement, boardPlane);
    const targetRect = elementRectInPlane(targetElement, boardPlane);
    if (!sourceRect || !targetRect || sourceRect.width <= 0 || targetRect.width <= 0) {
      return undefined;
    }
    const cardId = motion.identity?.cardId ?? card?.id;
    return {
      id: `${generation}:${motion.id}`,
      fallbackName: motion.identity?.name ?? card?.name ?? (cardId !== undefined ? cabtCardToView(cardId).name : 'Card'),
      left: targetRect.left,
      top: targetRect.top,
      width: targetRect.width,
      height: targetRect.height,
      startX: sourceRect.left + sourceRect.width / 2 - (targetRect.left + targetRect.width / 2),
      startY: sourceRect.top + sourceRect.height / 2 - (targetRect.top + targetRect.height / 2),
      startScale: sourceRect.width / targetRect.width,
      correctionX: 0,
      correctionY: 0,
      toDeck: motion.targetAnchor.kind === 'deck-top',
      fromDeck: motion.sourceAnchor.kind === 'deck-top',
      opponentSide: isOpponentAnchor(motion.sourceAnchor) || isOpponentAnchor(motion.targetAnchor),
      delayMs: motion.startMs,
      durationMs: motion.durationMs,
      measuring: true,
      card,
      faceDown,
      lifecycle: { kind: 'planned' },
    };
  }

  function startPlannedBoardMoveSprite(input: {
    sprite: BoardMoveSprite;
    source: HTMLElement;
    target: HTMLElement;
    generation: number;
    handoffDelayMs?: number;
    holdUntilScopeChange: boolean;
  }) {
    const startTimer = setTimeout(async () => {
      if (input.generation !== animationGeneration) {
        return;
      }
      sprites = [...sprites, input.sprite];
      await tick();
      if (input.generation !== animationGeneration) {
        return;
      }
      if (!document.body.contains(input.source) || !document.body.contains(input.target)) {
        sprites = sprites.filter((item) => item.id !== input.sprite.id);
        return;
      }

      const correction = measureSpriteCorrection(input.sprite, input.target);
      sprites = sprites.map((item) => item.id === input.sprite.id
        ? {
            ...item,
            correctionX: correction.x,
            correctionY: correction.y,
            measuring: false,
          }
        : item);
      if (input.holdUntilScopeChange || input.handoffDelayMs === undefined) {
        return;
      }
      const finishTimer = setTimeout(() => {
        removeSpritesAfterPrepaint(new Set([input.sprite.id]), input.generation);
      }, input.handoffDelayMs);
      timers.push(finishTimer);
    }, input.sprite.delayMs);
    timers.push(startTimer);
  }

  function plannedBoardMoveHandoffDelayMs(motion: CardMoveAnimationMotion) {
    const removeMs = replayAnimationSpriteRemovalMs(motion, animationPlan?.durationMs);
    return removeMs === undefined ? undefined : Math.max(0, removeMs - motion.startMs);
  }

  function startLiveBoardMoves(animationEvents: ActionTimelineEvent[]) {
    const boardPlane = motionLayer?.parentElement;
    if (!motionLayer || !boardPlane) {
      return;
    }
    const generation = animationGeneration;
    const moveEvents = animationEvents.filter((event) =>
      isLiveBoardMoveEvent(event)
      && ownsLiveBoardMovePhase(animationEvents, event));
    for (const instruction of moveEvents.flatMap((event) => liveMoveInstructionsForEvent(event, moveEvents))) {
      const sourceElement = instruction.source;
      const targetElement = instruction.target;
      const sourceRect = elementRectInPlane(sourceElement, boardPlane);
      const targetRect = elementRectInPlane(targetElement, boardPlane);
      if (!sourceRect || !targetRect || sourceRect.width <= 0 || targetRect.width <= 0) {
        continue;
      }

      const delayMs = actionAnimationStartMs(animationEvents, instruction.event);
      startLiveBoardMoveInstruction({
        source: sourceElement,
        target: targetElement,
        cardId: instruction.cardId,
        serial: instruction.serial,
        waitForDestinationCard: instruction.waitForDestinationCard,
        holdUntilScopeChange: instruction.holdUntilScopeChange,
        toDeck: instruction.toDeck,
        fromDeck: instruction.fromDeck,
        opponentSide: isOpponentSide(sourceElement) || isOpponentSide(targetElement),
        delayMs,
        durationMs: actionAnimationTiming.boardMoveMs,
        key: `${instruction.event.id}-${instruction.key}`,
      }, generation, liveBoardMoveHandoffDelayMs(animationEvents, instruction, delayMs));
    }
  }

  function startLiveBoardMoveInstruction(
    instruction: {
      source: HTMLElement;
      target: HTMLElement;
      cardId?: number;
      serial?: number;
      fallbackName?: string;
      waitForDestinationCard: boolean;
      holdUntilScopeChange: boolean;
      toDeck: boolean;
      fromDeck: boolean;
      opponentSide: boolean;
      delayMs: number;
      durationMs: number;
      key: string;
    },
    generation: number,
    handoffDelayMs?: number,
  ) {
    const boardPlane = motionLayer?.parentElement;
    if (!boardPlane) {
      return;
    }
    const sourceRect = elementRectInPlane(instruction.source, boardPlane);
    const targetRect = elementRectInPlane(instruction.target, boardPlane);
    if (!sourceRect || !targetRect || sourceRect.width <= 0 || targetRect.width <= 0) {
      return;
    }

    const sprite: LiveBoardMoveSprite = {
      id: `${generation}:${instruction.key}`,
      html: spriteHtml(instruction.source, instruction.target, instruction.fromDeck),
      fallbackName: instruction.fallbackName ?? (instruction.cardId !== undefined ? cabtCardToView(instruction.cardId).name : 'Card'),
      left: targetRect.left,
      top: targetRect.top,
      width: targetRect.width,
      height: targetRect.height,
      startX: sourceRect.left + sourceRect.width / 2 - (targetRect.left + targetRect.width / 2),
      startY: sourceRect.top + sourceRect.height / 2 - (targetRect.top + targetRect.height / 2),
      startScale: sourceRect.width / targetRect.width,
      correctionX: 0,
      correctionY: 0,
      toDeck: instruction.toDeck,
      fromDeck: instruction.fromDeck,
      opponentSide: instruction.opponentSide,
      delayMs: instruction.delayMs,
      durationMs: instruction.durationMs,
      measuring: true,
      lifecycle: {
        kind: 'live',
        handoff: {
          destinationCardId: instruction.cardId ?? 0,
          destinationSerial: instruction.serial,
          waitForDestinationCard: instruction.waitForDestinationCard,
        },
      },
    };

    const startTimer = setTimeout(async () => {
      if (generation !== animationGeneration) {
        return;
      }
      sprites = [...sprites, sprite];
      await tick();
      if (generation !== animationGeneration) {
        return;
      }
      if (!document.body.contains(instruction.source) || !document.body.contains(instruction.target)) {
        sprites = sprites.filter((item) => item.id !== sprite.id);
        return;
      }

      const correction = measureSpriteCorrection(sprite, instruction.target);
      hideLiveBoardMoveElement(instruction.source);
      hideLiveBoardMoveElement(instruction.target);
      sprites = sprites.map((item) => item.id === sprite.id
        ? {
            ...item,
            correctionX: correction.x,
            correctionY: correction.y,
            measuring: false,
          }
        : item);
      if (instruction.holdUntilScopeChange) {
        return;
      }
      const resolvedHandoffDelayMs = handoffDelayMs ?? instruction.durationMs;
      if (resolvedHandoffDelayMs === undefined) {
        return;
      }
      const finishTimer = setTimeout(() => {
        handOffLiveBoardMoveWhenDestinationReady(instruction.source, instruction.target, sprite, Date.now(), generation);
      }, resolvedHandoffDelayMs);
      timers.push(finishTimer);
    }, instruction.delayMs);
    timers.push(startTimer);
  }

  function elementForAnchor(anchor: AnimationAnchorRef, identity?: AnimationIdentity): HTMLElement | null {
    return strictAnimationVisualElementForAnchor(anchor, identity) ?? null;
  }

  function isOpponentAnchor(anchor: AnimationAnchorRef): boolean {
    const element = elementForAnchor(anchor);
    return !!element && isOpponentSide(element);
  }

  function liveBoardMoveHandoffDelayMs(
    animationEvents: ActionTimelineEvent[],
    instruction: BoardMoveInstruction,
    delayMs: number,
  ) {
    if (!instruction.fromDeck) {
      return actionAnimationTiming.boardMoveMs;
    }
    const latestDeckPlacementStartMs = Math.max(
      0,
      ...animationEvents
        .filter(isDeckBoardPlacementEvent)
        .map((event) => actionAnimationStartMs(animationEvents, event)),
    );
    return actionAnimationTiming.boardMoveMs
      + Math.max(0, latestDeckPlacementStartMs - delayMs);
  }

  function ownsLiveBoardMovePhase(animationEvents: ActionTimelineEvent[], event: ActionTimelineEvent): boolean {
    const key = actionAnimationTimelinePhaseKeyForEvent(animationEvents, event);
    const kind = key ? actionAnimationPhaseKind(key) : null;
    return kind === 'BoardMove'
      || kind === 'BoardToDeck'
      || kind === 'DeckBoardPlace'
      || kind === 'StadiumMove'
      || kind === 'KnockOut';
  }

  function liveMoveInstructionsForEvent(event: ActionTimelineEvent, moveEvents: ActionTimelineEvent[]): BoardMoveInstruction[] {
    if (event.kind === 'Switch') {
      return switchMoveInstructions(event);
    }

    const source = sourceElementForEvent(event);
    const target = targetElementForEvent(event, moveEvents);
    const areas = replayEventMoveAreas(event);
    const params = event.params as Record<string, unknown> | undefined;
    const cardId = finiteNumber(params?.cardId);
    if (!source || !target || !areas || cardId === undefined) {
      return [];
    }
    const serial = replayEventSerial(event);
    return [{
      event,
      source,
      target,
      cardId,
      serial,
      waitForDestinationCard: areas.toArea === CabtAreaType.DISCARD,
      holdUntilScopeChange: false,
      toDeck: areas.toArea === CabtAreaType.DECK,
      fromDeck: areas.fromArea === CabtAreaType.DECK,
      key: `${serial ?? cardId}`,
    }];
  }

  function switchMoveInstructions(event: ActionTimelineEvent): BoardMoveInstruction[] {
    const params = event.params as Record<string, unknown> | undefined;
    const activeCardId = finiteNumber(params?.cardIdActive);
    const benchCardId = finiteNumber(params?.cardIdBench);
    const activeSerial = finiteNumber(params?.serialActive);
    const benchSerial = finiteNumber(params?.serialBench);
    const activeSource = pokemonElementForIdentity(activeSerial ?? Number.NaN, activeCardId ?? Number.NaN, event.playerIndex);
    const benchSource = pokemonElementForIdentity(benchSerial ?? Number.NaN, benchCardId ?? Number.NaN, event.playerIndex);
    if (!activeSource || !benchSource || activeCardId === undefined || benchCardId === undefined) {
      return [];
    }
    return [
      {
        event,
        source: activeSource,
        target: benchSource,
        cardId: activeCardId,
        serial: activeSerial,
        waitForDestinationCard: false,
        holdUntilScopeChange: false,
        toDeck: false,
        fromDeck: false,
        key: `active-${activeSerial ?? activeCardId}`,
      },
      {
        event,
        source: benchSource,
        target: activeSource,
        cardId: benchCardId,
        serial: benchSerial,
        waitForDestinationCard: false,
        holdUntilScopeChange: false,
        toDeck: false,
        fromDeck: false,
        key: `bench-${benchSerial ?? benchCardId}`,
      },
    ];
  }

  function sourceElementForEvent(event: ActionTimelineEvent): HTMLElement | null {
    const params = event.params as Record<string, unknown> | undefined;
    const areas = replayEventMoveAreas(event);
    const serial = replayEventSerial(event);
    if (areas?.fromArea === CabtAreaType.STADIUM && event.playerIndex !== undefined && serial !== undefined) {
      const stadium = document.querySelector(`[data-card-anchor="player:${event.playerIndex}:stadium"][data-card-serial="${serial}"]`);
      return stadium instanceof HTMLElement ? stadium : null;
    }
    if (areas?.fromArea === CabtAreaType.DECK && event.playerIndex !== undefined) {
      return deckTopElement(event.playerIndex);
    }
    const cardId = finiteNumber(params?.cardId);
    return pokemonElementForIdentity(serial ?? Number.NaN, cardId ?? Number.NaN, event.playerIndex);
  }

  function targetElementForEvent(event: ActionTimelineEvent, moveEvents: ActionTimelineEvent[]): HTMLElement | null {
    const params = event.params as Record<string, unknown> | undefined;
    const playerIndex = event.playerIndex;
    const areas = replayEventMoveAreas(event);
    if (playerIndex === undefined) {
      return null;
    }
    const serial = replayEventSerial(event);
    const cardId = finiteNumber(params?.cardId);
    if (areas?.toArea === CabtAreaType.ACTIVE) {
      const destination = pokemonElementForIdentity(serial ?? Number.NaN, cardId ?? Number.NaN, playerIndex);
      if (destination) {
        return destination;
      }
      return boardAnchor(playerIndex, 'active', 0);
    }
    if (areas?.toArea === CabtAreaType.BENCH) {
      const destination = pokemonElementForIdentity(serial ?? Number.NaN, cardId ?? Number.NaN, playerIndex);
      if (destination) {
        return destination;
      }
      const benchIndex = finiteNumber(params?.toIndex ?? params?.index ?? params?.benchIndex);
      if (benchIndex !== undefined && Number.isInteger(benchIndex)) {
        return boardAnchor(playerIndex, 'bench', benchIndex);
      }
      return pairedBenchSourceElement(event, moveEvents);
    }
    if (areas?.toArea === CabtAreaType.DISCARD) {
      const discardCard = discardCardElement(playerIndex, serial ?? Number.NaN, cardId ?? Number.NaN);
      if (discardCard) {
        return discardCard;
      }
      const discard = document.querySelector(`[data-card-anchor="player:${playerIndex}:discard"]`);
      return discard instanceof HTMLElement ? discard : null;
    }
    if (areas?.toArea === CabtAreaType.DECK) {
      return deckTopElement(playerIndex);
    }
    return null;
  }

  function pairedBenchSourceElement(event: ActionTimelineEvent, moveEvents: ActionTimelineEvent[]): HTMLElement | null {
    const areas = replayEventMoveAreas(event);
    if (areas?.fromArea !== CabtAreaType.ACTIVE || areas.toArea !== CabtAreaType.BENCH) {
      return null;
    }
    const pairedEvent = moveEvents.find((candidate) => {
      const candidateAreas = replayEventMoveAreas(candidate);
      return candidate !== event
        && candidate.playerIndex === event.playerIndex
        && candidateAreas?.fromArea === CabtAreaType.BENCH
        && candidateAreas.toArea === CabtAreaType.ACTIVE;
    });
    return pairedEvent ? sourceElementForEvent(pairedEvent) : null;
  }

  function discardCardElement(playerIndex: number, serial: number, cardId: number): HTMLElement | null {
    const pile = document.querySelector(`[data-card-anchor="player:${playerIndex}:discard"]`);
    if (!(pile instanceof HTMLElement)) {
      return null;
    }
    const card = Number.isFinite(serial)
      ? pile.querySelector(`.card-tile[data-card-serial="${serial}"]`)
      : Number.isFinite(cardId)
        ? pile.querySelector(`.card-tile[data-card-id="${cardId}"]`)
        : null;
    return card instanceof HTMLElement ? card : null;
  }

  function boardAnchor(playerIndex: number, slot: 'active' | 'bench', index: number): HTMLElement | null {
    const element = document.querySelector(`[data-card-anchor="player:${playerIndex}:${slot}:${index}"]`);
    return element instanceof HTMLElement ? element : null;
  }

  function deckTopElement(playerIndex: number): HTMLElement | null {
    const anchor = document.querySelector(`[data-card-anchor="player:${playerIndex}:deck"]`);
    const pile = anchor?.closest('.deck-pile') as HTMLElement | null;
    return pile?.querySelector('.deck-card-face') ?? pile;
  }

  function discardPileElement(playerIndex: number): HTMLElement | null {
    const element = document.querySelector(`[data-animation-anchor-key="player:${playerIndex}:discard-pile"]`);
    return element instanceof HTMLElement ? element : null;
  }

  function pokemonElementForIdentity(serial: number, cardId: number, playerIndex: number | undefined): HTMLElement | null {
    if (Number.isFinite(serial)) {
      const bySerial = document.querySelector(`[data-pokemon-serial="${serial}"]`);
      if (bySerial instanceof HTMLElement) {
        return bySerial;
      }
    }
    if (Number.isFinite(cardId) && playerIndex !== undefined) {
      const byCard = document.querySelector(`[data-owner-index="${playerIndex}"][data-pokemon-card-id="${cardId}"]`);
      if (byCard instanceof HTMLElement) {
        return byCard;
      }
    }
    return null;
  }

  function isOpponentSide(slotElement: HTMLElement): boolean {
    return !!slotElement.closest('.top-active-slot, .bench-row.opponent, .top-stadium-card');
  }

  function clearBoardMoves({ settleHandoff = false }: { settleHandoff?: boolean } = {}) {
    animationGeneration += 1;
    const cleanupGeneration = animationGeneration;
    for (const timer of timers) {
      clearTimeout(timer);
    }
    timers.length = 0;
    const elementsToRestore = liveHiddenElementSnapshots();
    const spriteIdsToClear = new Set(sprites.map((sprite) => sprite.id));
    if (settleHandoff && (elementsToRestore.length || spriteIdsToClear.size)) {
      const timer = setTimeout(() => {
        restoreLiveBoardMoveElements(elementsToRestore);
        removeSpritesAfterPrepaint(spriteIdsToClear, cleanupGeneration);
        const timerIndex = handoffTimers.indexOf(timer);
        if (timerIndex >= 0) {
          handoffTimers.splice(timerIndex, 1);
        }
      }, replayAnimationScopeExitSettleMs);
      handoffTimers.push(timer);
      return;
    }

    restoreLiveBoardMoveElements(elementsToRestore);
    sprites = [];
  }

  function liveHiddenElementSnapshots() {
    return [...liveHiddenElements.values()].flat();
  }

  function restoreLiveBoardMoveElements(elements: LiveHiddenBoardMoveElement[]) {
    for (const hidden of elements) {
      releaseLiveBoardMoveElementClaim(hidden);
    }
  }

  function hideLiveBoardMoveElement(element: HTMLElement) {
    const hidden = hideElementForAnimation({
      element,
      scopeKey,
      role: 'handoff',
      fallbackAttribute: 'data-board-move-animation-hidden',
    });
    const existing = liveHiddenElements.get(element) ?? [];
    liveHiddenElements.set(element, [...existing, hidden]);
  }

  function showLiveBoardMoveElement(element: HTMLElement) {
    const entries = liveHiddenElements.get(element);
    if (!entries?.length) {
      return;
    }
    for (const hidden of entries) {
      releaseElementVisibilityClaim(hidden);
    }
    liveHiddenElements.delete(element);
  }

  function releaseLiveBoardMoveElementClaim(hidden: LiveHiddenBoardMoveElement) {
    const entries = liveHiddenElements.get(hidden.element);
    if (!entries?.length) {
      return;
    }
    const index = entries.indexOf(hidden);
    if (index >= 0) {
      entries.splice(index, 1);
    }
    releaseElementVisibilityClaim(hidden);
    if (entries.length) {
      liveHiddenElements.set(hidden.element, entries);
      return;
    }
    liveHiddenElements.delete(hidden.element);
  }

  function removeSpritesAfterPrepaint(spriteIdsToClear: Set<string>, generation: number) {
    if (!spriteIdsToClear.size) {
      return;
    }
    afterTwoAnimationFrames(() => {
      if (generation === animationGeneration) {
        sprites = sprites.filter((sprite) => !spriteIdsToClear.has(sprite.id));
      }
    }, handoffFrameIds);
  }

  function measureSpriteCorrection(sprite: BoardMoveSprite, target: HTMLElement) {
    const spriteElement = document.querySelector(`[data-board-move-id="${sprite.id}"] .card-tile`);
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

  function spriteHtml(source: HTMLElement, target: HTMLElement, fromDeck = false) {
    const cloneSource = fromDeck ? target : source;
    const clone = cloneSource.cloneNode(true);
    if (!(clone instanceof HTMLElement)) {
      return cloneSource.outerHTML;
    }

    if (cloneSource.classList.contains('stadium-card')) {
      const cardTile = cloneSource.querySelector('.card-tile');
      return cardTile instanceof HTMLElement ? cardTile.outerHTML : cloneSource.outerHTML;
    }

    clone.className = target.classList.contains('board-slot') ? target.className : source.className;
    clone.classList.remove('empty');
    clone.classList.add('board-slot');
    clone.removeAttribute('id');
    clone.removeAttribute('data-testid');
    clone.removeAttribute('data-card-anchor');
    clone.removeAttribute('data-owner-index');
    clone.removeAttribute('data-slot-kind');
    clone.removeAttribute('data-slot-index');
    clone.removeAttribute('data-pokemon-card-id');
    clone.removeAttribute('data-pokemon-serial');
    clone.removeAttribute('title');
    clone.removeAttribute('data-board-move-animation-hidden');
    clone.removeAttribute('data-reveal-animation-hidden');
    stripAnimationAttributes(clone);
    prepareCloneImages(clone);
    return clone.outerHTML;
  }

  function stripAnimationAttributes(clone: HTMLElement) {
    for (const element of [clone, ...clone.querySelectorAll('*')]) {
      if (!(element instanceof HTMLElement)) {
        continue;
      }
      for (const attribute of Array.from(element.attributes)) {
        if (attribute.name.startsWith('data-animation-')) {
          element.removeAttribute(attribute.name);
        }
      }
    }
  }

  function prepareCloneImages(clone: HTMLElement) {
    for (const image of clone.querySelectorAll('img')) {
      image.loading = 'eager';
      image.decoding = 'sync';
    }
  }

  function handOffLiveBoardMoveWhenDestinationReady(
    source: HTMLElement,
    target: HTMLElement,
    sprite: LiveBoardMoveSprite,
    startTime: number,
    generation: number,
  ) {
    if (generation !== animationGeneration) {
      return;
    }
    const destinationReady = sprite.lifecycle.handoff.waitForDestinationCard
      ? liveDestinationContainsCard(target, sprite.lifecycle.handoff)
      : sprite.toDeck
        ? true
      : !!target.querySelector('.card-tile');
    const timedOut = Date.now() - startTime >= boardMoveHandoffMaxWaitMs;
    const detached = !document.body.contains(source) || !document.body.contains(target);
    if (destinationReady || timedOut || detached) {
      showLiveBoardMoveElement(source);
      showLiveBoardMoveElement(target);
      removeSpritesAfterPrepaint(new Set([sprite.id]), generation);
      return;
    }

    const retry = setTimeout(() => {
      handOffLiveBoardMoveWhenDestinationReady(source, target, sprite, startTime, generation);
    }, boardMoveHandoffPollMs);
    timers.push(retry);
  }

  function liveDestinationContainsCard(target: HTMLElement, handoff: LiveBoardMoveHandoff) {
    const selector = handoff.destinationSerial !== undefined
      ? `.card-tile[data-card-serial="${handoff.destinationSerial}"]`
      : `.card-tile[data-card-id="${handoff.destinationCardId}"]`;
    return target.matches(selector) || !!target.querySelector(selector);
  }

  function spriteStyle(sprite: BoardMoveSprite) {
    return [
      `left: ${sprite.left}px`,
      `top: ${sprite.top}px`,
      `width: ${sprite.width}px`,
      `height: ${sprite.height}px`,
      `--board-move-source-slot-w: ${sprite.width}px`,
      `--board-move-start-x: ${sprite.startX.toFixed(3)}px`,
      `--board-move-start-y: ${sprite.startY.toFixed(3)}px`,
      `--board-move-start-scale: ${sprite.startScale.toFixed(6)}`,
      `--board-move-correction-x: ${sprite.correctionX.toFixed(3)}px`,
      `--board-move-correction-y: ${sprite.correctionY.toFixed(3)}px`,
      `--board-move-duration: ${sprite.durationMs}ms`,
    ].join('; ');
  }

  function spriteCard(sprite: BoardMoveSprite): CardView | undefined {
    return sprite.card as CardView | undefined;
  }
</script>

<span class="board-move-animation-layer" style={cardBackCssVar()} bind:this={motionLayer} aria-hidden="true">
  {#each sprites as sprite (sprite.id)}
    <span
      class="board-move-card"
      class:opponent-side={sprite.opponentSide}
      class:measuring={sprite.measuring}
      class:to-deck={sprite.toDeck}
      data-board-move-id={sprite.id}
      style={spriteStyle(sprite)}
    >
      <span class="board-move-card-inner">
        {#if sprite.card || sprite.faceDown}
          <CardTile card={spriteCard(sprite)} compact faceDown={sprite.faceDown} />
        {:else if sprite.html}
          {@html sprite.html}
        {:else}
          <span class="board-move-fallback">{sprite.fallbackName}</span>
        {/if}
      </span>
    </span>
  {/each}
</span>

<style>
  .board-move-animation-layer {
    position: absolute;
    inset: 0;
    z-index: 29;
    transform-style: preserve-3d;
    pointer-events: none;
  }

  .board-move-card {
    position: absolute;
    display: block;
    transform-origin: 50% 50%;
    transform-style: preserve-3d;
    animation: board-card-move var(--board-move-duration, 520ms) cubic-bezier(0.22, 0.78, 0.2, 1) both;
    will-change: transform;
  }

  .board-move-card.measuring {
    opacity: 0;
    animation: none;
    transform:
      translate3d(0, 0, 0)
      scale(1);
  }

  .board-move-card-inner {
    position: relative;
    display: block;
    width: 100%;
    height: 100%;
    transform-style: preserve-3d;
  }

  .board-move-card.to-deck .board-move-card-inner {
    animation: board-card-flip-to-back var(--board-move-duration, 520ms) ease-in-out both;
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

  .board-move-fallback {
    display: grid;
    place-items: center;
    width: 100%;
    height: 100%;
    border-radius: 5px;
    background: #f7f8fa;
    box-shadow: 0 3px 8px rgba(23, 30, 38, 0.28);
    font-size: 12px;
    font-weight: 900;
    text-align: center;
  }

  :global(.board-slot.empty[data-board-move-animation-hidden="true"]) {
    border-color: transparent !important;
    background: transparent !important;
  }

  :global(.board-slot[data-board-move-animation-hidden="true"]) {
    transition: none !important;
  }

  :global(.board-slot[data-board-move-animation-hidden="true"] > .card-tile),
  :global(.board-slot[data-board-move-animation-hidden="true"] > .pokemon-status),
  :global(.board-slot[data-board-move-animation-hidden="true"] > .energy-badges),
  :global(.board-slot[data-board-move-animation-hidden="true"] > .tool-card-preview),
  :global(.board-slot[data-board-move-animation-hidden="true"] > .slot-badges),
  :global(.board-slot[data-board-move-animation-hidden="true"] > .empty-zone) {
    opacity: 0;
  }

  :global(.stadium-card[data-board-move-animation-hidden="true"]) {
    opacity: 0;
  }

  :global(.discard-pile .card-tile[data-board-move-animation-hidden="true"]) {
    opacity: 0;
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

  @media (prefers-reduced-motion: reduce) {
    .board-move-card {
      animation: none;
    }
  }
</style>
