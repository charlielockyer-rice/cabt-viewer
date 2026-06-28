<script lang="ts">
  import { cardBackCssVar, cardFaceImageUrl } from '../game/cardAssets';
  import { onDestroy } from 'svelte';
  import {
    hideElementForAnimation,
    releaseElementVisibilityClaim,
    type ElementVisibilityClaim,
  } from '../animations/animationVisibilityClaims';
  import { actionAnimationBatchEvents, actionAnimationStartMs, actionAnimationTiming } from '../cabt/actionAnimationSchedule';
  import { cabtCardToView } from '../cabt/cardView';
  import { CabtAreaType } from '../cabt/types';
  import type { ActionTimelineEvent, CardView } from '../game/types';

  type Props = {
    events?: ActionTimelineEvent[];
    scopeKey?: string | number;
    replayMode?: boolean;
  };

  type RevealMode = 'revealing' | 'searching' | 'held' | 'selecting' | 'taking' | 'attaching' | 'returning';

  type RevealSprite = {
    id: string;
    card: CardView;
    serial?: number;
    targetElement?: HTMLElement;
    order: number;
    mode: RevealMode;
    delayMs: number;
    left: number;
    top: number;
    width: number;
    height: number;
    revealX: number;
    revealY: number;
    deckScale: number;
    takeX: number;
    takeY: number;
    takeScale: number;
    takeRotation: number;
    takeFlip: number;
    exitX: number;
    exitY: number;
    exitScale: number;
    rotation: number;
  };

  type RevealAnimation = {
    id: number;
    sprites: RevealSprite[];
  };

  type HiddenRevealTarget = ElementVisibilityClaim;

  let {
    events = [],
    scopeKey = '',
    replayMode = false,
  }: Props = $props();

  const timers: ReturnType<typeof setTimeout>[] = [];
  const cardHeightToWidthRatio = 88 / 63;
  const handoffSettleMs = 48;
  let reveals = $state<RevealAnimation[]>([]);
  let seenEventIds = new Set<number>();
  let initialized = false;
  let lastScopeKey: string | number = '';
  let nextAnimationId = 1;
  const activeAttachElements = new Set<HTMLElement>();
  let hiddenTargets: HiddenRevealTarget[] = [];

  onDestroy(() => {
    clearReveals();
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
    const revealEvents = animationEvents.filter((event) => isDeckRevealEvent(event) && shouldAnimateEvent(event, scopeChanged));
    const attachEvents = animationEvents.filter((event) => isRevealAttachEvent(event) && shouldAnimateEvent(event, scopeChanged));
    const takeEvents = animationEvents.filter((event) => isRevealTakeEvent(event) && shouldAnimateEvent(event, scopeChanged));
    const returnEvents = animationEvents.filter((event) => isRevealReturnEvent(event) && shouldAnimateEvent(event, scopeChanged));

    if (replayMode && scopeChanged && !revealEvents.length && !attachEvents.length && !takeEvents.length && !returnEvents.length) {
      clearReveals();
    }

    for (const event of currentEvents) {
      seenEventIds.add(event.id);
    }

    if (revealEvents.length) {
      startReveal(revealEvents, animationEvents);
    }
    if (attachEvents.length) {
      attachRevealedCards(attachEvents, animationEvents);
    }
    if (takeEvents.length) {
      takeRevealedCards(takeEvents, animationEvents);
    }
    if (returnEvents.length) {
      returnRevealedCards(returnEvents, animationEvents);
    }
  });

  function shouldAnimateEvent(event: ActionTimelineEvent, scopeChanged: boolean): boolean {
    return (replayMode && scopeChanged) || !seenEventIds.has(event.id);
  }

  function isDeckRevealEvent(event: ActionTimelineEvent): boolean {
    const params = event.params as Record<string, unknown> | undefined;
    return event.kind === 'MoveCard'
      && Number(params?.fromArea) === CabtAreaType.DECK
      && (
        Number(params?.toArea) === CabtAreaType.LOOKING
        || Number(params?.toArea) === CabtAreaType.HAND
      )
      && Number.isFinite(Number(params?.cardId));
  }

  function isRevealAttachEvent(event: ActionTimelineEvent): boolean {
    const params = event.params as Record<string, unknown> | undefined;
    const serial = Number(params?.serial);
    return event.kind === 'Attach'
      && Number.isFinite(serial)
      && reveals.some((reveal) => reveal.sprites.some((sprite) => sprite.serial === serial));
  }

  function isRevealReturnEvent(event: ActionTimelineEvent): boolean {
    const params = event.params as Record<string, unknown> | undefined;
    return event.kind === 'MoveCard'
      && Number(params?.fromArea) === CabtAreaType.LOOKING
      && Number(params?.toArea) === CabtAreaType.DECK
      && Number.isFinite(Number(params?.serial));
  }

  function isRevealTakeEvent(event: ActionTimelineEvent): boolean {
    const params = event.params as Record<string, unknown> | undefined;
    return event.kind === 'MoveCard'
      && Number(params?.fromArea) === CabtAreaType.LOOKING
      && Number(params?.toArea) === CabtAreaType.HAND
      && Number.isFinite(Number(params?.serial));
  }

  function startReveal(revealEvents: ActionTimelineEvent[], animationEvents: ActionTimelineEvent[]) {
    const eventsByPlayer = new Map<number, ActionTimelineEvent[]>();
    for (const event of revealEvents) {
      if (event.playerIndex === undefined) {
        continue;
      }
      const playerEvents = eventsByPlayer.get(event.playerIndex) ?? [];
      playerEvents.push(event);
      eventsByPlayer.set(event.playerIndex, playerEvents);
    }

    const sprites = [...eventsByPlayer.entries()].flatMap(([playerIndex, playerEvents]) =>
      spritesForPlayer(playerIndex, playerEvents, animationEvents),
    );
    if (!sprites.length) {
      return;
    }

    clearReveals();
    const hiddenTargets = sprites
      .filter((sprite) => sprite.mode === 'searching' && sprite.targetElement)
      .map((sprite) => sprite.targetElement!);
    const hiddenSearchTargets = hideTargets(hiddenTargets);
    const animation: RevealAnimation = {
      id: nextAnimationId++,
      sprites,
    };
    reveals = [animation];

    for (const sprite of sprites) {
      if (sprite.mode !== 'searching') {
        continue;
      }
      const revealMs = motionDurationMs(actionAnimationTiming.deckRevealMs);
      const target = sprite.targetElement;
      const handoffTimer = setTimeout(() => {
        if (target) {
          showTargets(hiddenSearchTargets.filter((hidden) => hidden.element === target));
        }
        removeSprites((item) => item.id === sprite.id);
      }, sprite.delayMs + revealMs + handoffSettleMs);
      timers.push(handoffTimer);
    }

    const timer = setTimeout(() => {
      updateSprites((sprite) => sprite.mode === 'revealing' ? { ...sprite, mode: 'held', delayMs: 0 } : sprite);
    }, Math.max(...sprites.map((sprite) => sprite.delayMs)) + motionDurationMs(actionAnimationTiming.deckRevealMs));
    timers.push(timer);
  }

  function attachRevealedCards(attachEvents: ActionTimelineEvent[], animationEvents: ActionTimelineEvent[]) {
    for (const event of attachEvents) {
      const params = event.params as Record<string, unknown> | undefined;
      const serial = Number(params?.serial);
      const sprite = revealSprite(serial);
      const target = boardSlotByPokemonIdentity(Number(params?.serialTarget), Number(params?.cardIdTarget), event.playerIndex);
      const targetRect = visualTargetForAnimation(target)?.getBoundingClientRect();
      if (!sprite || !targetRect || targetRect.width <= 0 || targetRect.height <= 0) {
        continue;
      }

      const sourceCenter = spriteCenter(sprite);
      const targetCenter = centerOf(targetRect);
      const delayMs = actionAnimationStartMs(animationEvents, event);
      markAttachTarget(target, serial, delayMs);
      updateSprites((item) => item.serial === serial
        ? {
            ...item,
            mode: 'attaching',
            delayMs,
            exitX: targetCenter.x - sourceCenter.x,
            exitY: targetCenter.y - sourceCenter.y,
            exitScale: Math.max(0.36, Math.min(0.86, (targetRect.width / item.width) * 0.54)),
          }
        : item);
      const timer = setTimeout(() => {
        removeSprites((item) => item.serial === serial);
      }, delayMs + actionAnimationTiming.handMoveMs + 80);
      timers.push(timer);
    }
  }

  function takeRevealedCards(takeEvents: ActionTimelineEvent[], animationEvents: ActionTimelineEvent[]) {
    for (const event of takeEvents) {
      const params = event.params as Record<string, unknown> | undefined;
      const serial = Number(params?.serial);
      const sprite = revealSprite(serial);
      if (event.playerIndex === undefined || !sprite) {
        continue;
      }
      const target = handTargetForPlayer(event.playerIndex, serial, 0, 1);
      if (!target) {
        continue;
      }
      const takeSource = normalizedSpriteForTake(sprite);
      const sourceCenter = spriteCenter(takeSource);
      const delayMs = actionAnimationStartMs(animationEvents, event);
      const hiddenTakeTargets = target.element ? hideTargets([target.element]) : [];
      updateSprites((item) => item.serial === serial
        ? {
            ...normalizedSpriteForTake(item),
            mode: 'taking',
            delayMs,
            exitX: target.center.x - sourceCenter.x,
            exitY: target.center.y - sourceCenter.y,
            exitScale: Math.max(0.32, Math.min(1.2, target.width / takeSource.width)),
          }
        : item);
      const timer = setTimeout(() => {
        if (target.element) {
          showTargets(hiddenTakeTargets);
        }
        removeSprites((item) => item.serial === serial);
      }, delayMs + actionAnimationTiming.handMoveMs + handoffSettleMs);
      timers.push(timer);
    }
  }

  function returnRevealedCards(returnEvents: ActionTimelineEvent[], animationEvents: ActionTimelineEvent[]) {
    const eventsByPlayer = new Map<number, ActionTimelineEvent[]>();
    for (const event of returnEvents) {
      if (event.playerIndex === undefined) {
        continue;
      }
      const playerEvents = eventsByPlayer.get(event.playerIndex) ?? [];
      playerEvents.push(event);
      eventsByPlayer.set(event.playerIndex, playerEvents);
    }

    for (const [playerIndex, playerEvents] of eventsByPlayer.entries()) {
      const deckRect = deckTopElement(playerIndex)?.getBoundingClientRect();
      if (!deckRect || deckRect.width <= 0 || deckRect.height <= 0) {
        continue;
      }
      const returningSerials = new Set(
        playerEvents
          .map((event) => eventSerial(event))
          .filter((serial): serial is number => Number.isFinite(serial)),
      );
      moveSelectedSpritesToReveal(playerIndex, returningSerials);
      const deckCenter = centerOf(deckRect);
      for (const event of playerEvents) {
        const params = event.params as Record<string, unknown> | undefined;
        const serial = Number(params?.serial);
        const sprite = revealSprite(serial);
        if (!sprite) {
          continue;
        }
        const sourceCenter = spriteCenter(sprite);
        const delayMs = actionAnimationStartMs(animationEvents, event);
        updateSprites((item) => item.serial === serial
          ? {
              ...item,
              mode: 'returning',
              delayMs,
              exitX: deckCenter.x - sourceCenter.x,
              exitY: deckCenter.y - sourceCenter.y,
              exitScale: Math.max(0.32, Math.min(0.9, deckRect.width / item.width)),
            }
          : item);
        const timer = setTimeout(() => {
          removeSprites((item) => item.serial === serial);
        }, delayMs + actionAnimationTiming.deckRevealReturnMs + 80);
        timers.push(timer);
      }
    }
  }

  function clearReveals() {
    for (const timer of timers) {
      clearTimeout(timer);
    }
    timers.length = 0;
    clearHiddenTargets();
    reveals = [];
    clearAttachTargets();
  }

  function moveSelectedSpritesToReveal(playerIndex: number, returningSerials: ReadonlySet<number>) {
    const selectedSprites = reveals
      .flatMap((reveal) => reveal.sprites)
      .filter((sprite) =>
        sprite.card.playerIndex === playerIndex
        && sprite.mode === 'held'
        && !returningSerials.has(sprite.serial ?? Number.NaN));
    if (!selectedSprites.length) {
      return;
    }

    const layout = revealLayout(selectedSprites.length);
    const selectedTargets = new Map<string, {
      center: { x: number; y: number };
      width: number;
      height: number;
    }>();
    for (const [index, sprite] of selectedSprites.entries()) {
      const target = layout.target(index);
      selectedTargets.set(sprite.id, {
        center: { x: target.x, y: target.y },
        width: layout.cardWidth,
        height: layout.cardHeight,
      });
    }

    updateSprites((sprite) => {
      const target = selectedTargets.get(sprite.id);
      if (!target) {
        return sprite;
      }
      const sourceCenter = spriteCenter(sprite);
      return {
        ...sprite,
        mode: 'selecting',
        delayMs: 0,
        exitX: target.center.x - sourceCenter.x,
        exitY: target.center.y - sourceCenter.y,
        exitScale: Math.max(0.32, Math.min(1.6, target.width / sprite.width)),
        rotation: 0,
        order: 100 + sprite.order,
      };
    });

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

  function visualTargetForAnimation(target: HTMLElement | null): HTMLElement | null {
    if (!target) {
      return null;
    }
    const cardTile = target.querySelector('.card-tile');
    return cardTile instanceof HTMLElement ? cardTile : target;
  }

  function markAttachTarget(target: HTMLElement, serial: number, delayMs: number) {
    const startTimer = setTimeout(() => {
      const energyBadge = attachedEnergyElement(target, serial);
      energyBadge?.classList.add('reveal-attach-handoff-energy');
      if (energyBadge) {
        activeAttachElements.add(energyBadge);
      }
    }, delayMs);
    const endTimer = setTimeout(() => {
      const energyBadge = attachedEnergyElement(target, serial);
      energyBadge?.classList.remove('reveal-attach-handoff-energy');
      if (energyBadge) {
        activeAttachElements.delete(energyBadge);
      }
    }, delayMs + actionAnimationTiming.handMoveMs + 120);
    timers.push(startTimer, endTimer);
  }

  function clearAttachTargets() {
    for (const element of activeAttachElements) {
      element.classList.remove('reveal-attach-handoff-energy');
    }
    activeAttachElements.clear();
  }

  function attachedEnergyElement(target: HTMLElement, serial: number): HTMLElement | null {
    if (Number.isFinite(serial)) {
      const bySerial = target.querySelector(`[data-energy-serial="${serial}"]`);
      if (bySerial instanceof HTMLElement) {
        return bySerial;
      }
    }
    const badges = target.querySelectorAll('.energy-badges img');
    const fallback = badges.item(badges.length - 1);
    return fallback instanceof HTMLElement ? fallback : null;
  }

  function spritesForPlayer(
    playerIndex: number,
    playerEvents: ActionTimelineEvent[],
    animationEvents: ActionTimelineEvent[],
  ): RevealSprite[] {
    const deckRect = deckTopElement(playerIndex)?.getBoundingClientRect();
    if (!deckRect || deckRect.width <= 0 || deckRect.height <= 0) {
      return [];
    }

    const layout = revealLayout(playerEvents.length);
    const deckCenter = centerOf(deckRect);
    return playerEvents.map((event, index) => {
      const params = event.params as Record<string, unknown> | undefined;
      const cardId = Number(params?.cardId);
      const serial = Number(params?.serial);
      const toArea = Number(params?.toArea);
      const target = layout.target(index);
      const takeTarget = toArea === CabtAreaType.HAND
        ? handTargetForPlayer(playerIndex, serial, index, playerEvents.length)
        : undefined;
      const destination = takeTarget?.center ?? target;
      const mode: RevealMode = toArea === CabtAreaType.HAND ? 'searching' : 'revealing';
      return {
        id: `${event.id}-${Number.isFinite(serial) ? serial : index}`,
        card: {
          ...cabtCardToView(cardId),
          serial: Number.isFinite(serial) ? serial : undefined,
          playerIndex,
        },
        serial: Number.isFinite(serial) ? serial : undefined,
        targetElement: takeTarget?.element,
        order: index + 1,
        mode,
        delayMs: actionAnimationStartMs(animationEvents, event),
        left: deckCenter.x - layout.cardWidth / 2,
        top: deckCenter.y - layout.cardHeight / 2,
        width: layout.cardWidth,
        height: layout.cardHeight,
        revealX: target.x - deckCenter.x,
        revealY: target.y - deckCenter.y,
        deckScale: Math.max(0.32, Math.min(0.9, deckRect.width / layout.cardWidth)),
        takeX: destination.x - deckCenter.x,
        takeY: destination.y - deckCenter.y,
        takeScale: Math.max(0.32, Math.min(1.2, (takeTarget?.width ?? layout.cardWidth) / layout.cardWidth)),
        takeRotation: takeTarget?.concealed ? 180 : 0,
        takeFlip: takeTarget?.concealed ? 0 : 180,
        exitX: 0,
        exitY: 0,
        exitScale: 1,
        rotation: target.rotation,
      };
    });
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

  function updateSprites(update: (sprite: RevealSprite) => RevealSprite) {
    reveals = reveals.map((reveal) => ({
      ...reveal,
      sprites: reveal.sprites.map(update),
    }));
  }

  function removeSprites(predicate: (sprite: RevealSprite) => boolean) {
    reveals = reveals
      .map((reveal) => ({
        ...reveal,
        sprites: reveal.sprites.filter((sprite) => !predicate(sprite)),
      }))
      .filter((reveal) => reveal.sprites.length > 0);
  }

  function revealSprite(serial: number): RevealSprite | undefined {
    if (!Number.isFinite(serial)) {
      return undefined;
    }
    return reveals.flatMap((reveal) => reveal.sprites).find((sprite) => sprite.serial === serial);
  }

  function eventSerial(event: ActionTimelineEvent): number | undefined {
    const params = event.params as Record<string, unknown> | undefined;
    const serial = Number(params?.serial);
    return Number.isFinite(serial) ? serial : undefined;
  }

  function deckTopElement(playerIndex: number): HTMLElement | null {
    const anchor = document.querySelector(`[data-card-anchor="player:${playerIndex}:deck"]`);
    const pile = anchor?.closest('.deck-pile') as HTMLElement | null;
    return pile?.querySelector('.deck-card-face') ?? pile;
  }

  function handTargetForPlayer(
    playerIndex: number,
    serial: number,
    index: number,
    count: number,
  ): { center: { x: number; y: number }; width: number; concealed: boolean; element?: HTMLElement } | undefined {
    const handElement = handAnchor(playerIndex);
    if (!handElement) {
      return undefined;
    }
    const handRect = handElement.getBoundingClientRect();
    if (handRect.width <= 0 || handRect.height <= 0) {
      return undefined;
    }
    const handSlots = handCardSlots(handElement, playerIndex);
    const targetElement = handSlotForSerial(handSlots, serial);
    const targetRect = handCardVisualRect(targetElement) ?? fallbackHandTarget(handRect, index, count);
    return {
      center: centerOf(targetRect),
      width: targetRect.width,
      concealed: handElement.classList.contains('concealed'),
      element: targetElement,
    };
  }

  function handAnchor(playerIndex: number): HTMLElement | null {
    return document.querySelector(`[data-card-anchor="player:${playerIndex}:hand"]`);
  }

  function handCardSlots(handElement: HTMLElement, playerIndex: number): HTMLElement[] {
    return Array.from(handElement.querySelectorAll(`[data-hand-card-slot^="player:${playerIndex}:hand:"]`))
      .filter((element): element is HTMLElement => element instanceof HTMLElement);
  }

  function handSlotForSerial(handSlots: HTMLElement[], serial: number): HTMLElement | undefined {
    if (!Number.isFinite(serial)) {
      return undefined;
    }
    return handSlots.find((element) => Number(element.dataset.cardSerial) === serial);
  }

  function handCardVisualRect(targetElement: HTMLElement | undefined): DOMRect | undefined {
    if (!targetElement) {
      return undefined;
    }
    const visual = targetElement.querySelector('.card-tile');
    if (visual instanceof HTMLElement) {
      const rect = visual.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        return rect;
      }
    }
    const rect = targetElement.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 ? rect : undefined;
  }

  function fallbackHandTarget(handRect: DOMRect, index: number, count: number): DOMRect {
    const width = Math.min(handRect.height / cardHeightToWidthRatio, handRect.width / Math.max(1, count));
    const height = width * cardHeightToWidthRatio;
    const step = Math.min(width * 0.82, handRect.width / Math.max(1, count));
    const centerX = handRect.left + handRect.width / 2 + (index - (count - 1) / 2) * step;
    const centerY = handRect.top + handRect.height / 2;
    return {
      left: centerX - width / 2,
      top: centerY - height / 2,
      right: centerX + width / 2,
      bottom: centerY + height / 2,
      x: centerX - width / 2,
      y: centerY - height / 2,
      width,
      height,
      toJSON: () => ({}),
    } as DOMRect;
  }

  function hideTargets(targets: HTMLElement[]) {
    const hidden: HiddenRevealTarget[] = [];
    for (const target of targets) {
      hidden.push(hideElementForAnimation({
        element: target,
        scopeKey,
        role: 'destination',
        fallbackAttribute: 'data-reveal-animation-hidden',
      }));
    }
    hiddenTargets = [...hiddenTargets, ...hidden];
    return hidden;
  }

  function showTargets(targets: HiddenRevealTarget[]) {
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

  function motionDurationMs(durationMs: number): number {
    return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 1 : durationMs;
  }

  function spriteCenter(sprite: RevealSprite): { x: number; y: number } {
    return {
      x: sprite.left + sprite.width / 2 + sprite.revealX,
      y: sprite.top + sprite.height / 2 + sprite.revealY,
    };
  }

  function normalizedSpriteForTake(sprite: RevealSprite): RevealSprite {
    if (sprite.mode !== 'selecting') {
      return sprite;
    }
    const center = {
      x: sprite.left + sprite.width / 2 + sprite.revealX + sprite.exitX,
      y: sprite.top + sprite.height / 2 + sprite.revealY + sprite.exitY,
    };
    const width = sprite.width * sprite.exitScale;
    const height = sprite.height * sprite.exitScale;
    return {
      ...sprite,
      left: center.x - width / 2,
      top: center.y - height / 2,
      width,
      height,
      revealX: 0,
      revealY: 0,
      takeX: 0,
      takeY: 0,
      takeScale: 1,
      takeRotation: 0,
      exitX: 0,
      exitY: 0,
      exitScale: 1,
      rotation: 0,
    };
  }

  function centerOf(rect: DOMRect): { x: number; y: number } {
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    };
  }

  function spriteStyle(sprite: RevealSprite): string {
    return [
      `left: ${sprite.left}px`,
      `top: ${sprite.top}px`,
      `width: ${sprite.width}px`,
      `height: ${sprite.height}px`,
      `--reveal-x: ${sprite.revealX.toFixed(1)}px`,
      `--reveal-y: ${sprite.revealY.toFixed(1)}px`,
      `--deck-scale: ${sprite.deckScale.toFixed(3)}`,
      `--take-x: ${sprite.takeX.toFixed(1)}px`,
      `--take-y: ${sprite.takeY.toFixed(1)}px`,
      `--take-scale: ${sprite.takeScale.toFixed(3)}`,
      `--take-rotation: ${sprite.takeRotation.toFixed(1)}deg`,
      `--take-flip: ${sprite.takeFlip.toFixed(1)}deg`,
      `--exit-x: ${sprite.exitX.toFixed(1)}px`,
      `--exit-y: ${sprite.exitY.toFixed(1)}px`,
      `--exit-scale: ${sprite.exitScale.toFixed(3)}`,
      `--reveal-delay: ${sprite.delayMs}ms`,
      `--reveal-rotation: ${sprite.rotation.toFixed(1)}deg`,
      `z-index: ${sprite.order}`,
    ].join('; ');
  }
</script>

<span class="deck-reveal-animation" aria-hidden="true">
  {#each reveals as reveal (reveal.id)}
    {#each reveal.sprites as sprite (sprite.id)}
      <span class={`reveal-card ${sprite.mode}`} style={spriteStyle(sprite)}>
        <span class="reveal-card-inner">
          <span class="reveal-card-face reveal-card-back" style={cardBackCssVar()}></span>
          <span class="reveal-card-face reveal-card-front">
            {#if cardFaceImageUrl(sprite.card)}
              <img src={cardFaceImageUrl(sprite.card)} alt="" draggable="false" />
            {:else}
              <span class="fallback-name">{sprite.card.name}</span>
            {/if}
          </span>
        </span>
      </span>
    {/each}
  {/each}
</span>

<style>
  .deck-reveal-animation {
    position: fixed;
    inset: 0;
    z-index: 40;
    overflow: visible;
    pointer-events: none;
    perspective: 1200px;
    transform-style: preserve-3d;
  }

  .reveal-card {
    position: absolute;
    display: block;
    border-radius: 9px;
    transform-origin: center;
    transform-style: preserve-3d;
    isolation: isolate;
    will-change: transform, opacity;
  }

  .reveal-card.revealing {
    animation: deck-reveal-travel 1180ms cubic-bezier(0.18, 0.86, 0.24, 1) var(--reveal-delay) both;
  }

  .reveal-card.searching {
    animation: deck-search-reveal 1180ms cubic-bezier(0.18, 0.86, 0.24, 1) var(--reveal-delay) both;
  }

  .reveal-card.held {
    transform: translate3d(var(--reveal-x), var(--reveal-y), 0) scale(1) rotate(var(--reveal-rotation));
  }

  .reveal-card.selecting {
    animation: deck-reveal-select 420ms cubic-bezier(0.18, 0.86, 0.24, 1) var(--reveal-delay) both;
  }

  .reveal-card.taking {
    animation: deck-reveal-take 360ms cubic-bezier(0.2, 0.82, 0.22, 1) var(--reveal-delay) both;
  }

  .reveal-card.attaching {
    animation: deck-reveal-attach 360ms cubic-bezier(0.2, 0.82, 0.22, 1) var(--reveal-delay) both;
  }

  .reveal-card.returning {
    animation: deck-reveal-return 420ms cubic-bezier(0.34, 0.02, 0.24, 1) var(--reveal-delay) both;
  }

  .reveal-card-inner {
    position: absolute;
    inset: 0;
    display: block;
    border-radius: inherit;
    transform-style: preserve-3d;
    transform: rotateY(180deg);
    will-change: transform;
  }

  :global([data-reveal-animation-hidden='true']) {
    opacity: 0;
  }

  .reveal-card.revealing .reveal-card-inner {
    animation: deck-reveal-flip 420ms ease-in-out var(--reveal-delay) both;
  }

  .reveal-card.searching .reveal-card-inner {
    animation: deck-search-reveal-flip 1180ms ease-in-out var(--reveal-delay) both;
  }

  .reveal-card.returning .reveal-card-inner {
    animation: deck-reveal-return-flip 320ms ease-in-out var(--reveal-delay) both;
  }

  .reveal-card-face {
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

  .reveal-card-back {
    transform: translateZ(0.2px);
    background:
      var(--card-back-image, var(--cardback-shade)),
      linear-gradient(135deg, rgba(255, 255, 255, 0.1), transparent 28%),
      repeating-linear-gradient(45deg, rgba(255, 255, 255, 0.08) 0 6px, transparent 6px 12px),
      linear-gradient(145deg, #203654, #111a2c);
    background-size: cover, auto, auto, auto;
    background-position: center;
  }

  .reveal-card-front {
    transform: rotateY(180deg) translateZ(0.2px);
    background: #f7f8fa;
  }

  .reveal-card-front img {
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

  @keyframes deck-reveal-travel {
    0% {
      opacity: 0;
      transform:
        translate3d(0, 0, 0)
        scale(var(--deck-scale))
        rotate(0deg);
    }
    2% {
      opacity: 1;
      transform:
        translate3d(0, 0, 0)
        scale(var(--deck-scale))
        rotate(0deg);
    }
    72%,
    100% {
      opacity: 1;
      transform: translate3d(var(--reveal-x), var(--reveal-y), 0) scale(1) rotate(var(--reveal-rotation));
    }
  }

  @keyframes deck-search-reveal {
    0% {
      opacity: 0;
      transform:
        translate3d(0, 0, 0)
        scale(var(--deck-scale))
        rotate(0deg);
    }
    2% {
      opacity: 1;
      transform:
        translate3d(0, 0, 0)
        scale(var(--deck-scale))
        rotate(0deg);
    }
    42% {
      opacity: 1;
      transform: translate3d(var(--reveal-x), var(--reveal-y), 0) scale(1) rotate(var(--reveal-rotation));
    }
    68% {
      opacity: 1;
      transform: translate3d(var(--reveal-x), var(--reveal-y), 0) scale(1) rotate(var(--reveal-rotation));
    }
    96% {
      opacity: 1;
      transform:
        translate3d(var(--take-x), var(--take-y), 0)
        scale(var(--take-scale))
        rotate(var(--take-rotation));
    }
    100% {
      opacity: 1;
      transform:
        translate3d(var(--take-x), var(--take-y), 0)
        scale(var(--take-scale))
        rotate(var(--take-rotation));
    }
  }

  @keyframes deck-reveal-attach {
    0% {
      opacity: 1;
      transform: translate3d(var(--reveal-x), var(--reveal-y), 0) scale(1) rotate(var(--reveal-rotation));
    }
    68% {
      opacity: 1;
      transform:
        translate3d(calc(var(--reveal-x) + var(--exit-x)), calc(var(--reveal-y) + var(--exit-y)), 0)
        scale(var(--exit-scale))
        rotate(0deg);
    }
    100% {
      opacity: 0;
      transform:
        translate3d(calc(var(--reveal-x) + var(--exit-x)), calc(var(--reveal-y) + var(--exit-y)), 0)
        scale(var(--exit-scale))
        rotate(0deg);
    }
  }

  @keyframes deck-reveal-take {
    0% {
      opacity: 1;
      transform: translate3d(var(--reveal-x), var(--reveal-y), 0) scale(1) rotate(var(--reveal-rotation));
    }
    72%,
    100% {
      opacity: 1;
      transform:
        translate3d(calc(var(--reveal-x) + var(--exit-x)), calc(var(--reveal-y) + var(--exit-y)), 0)
        scale(var(--exit-scale))
        rotate(0deg);
    }
  }

  @keyframes deck-reveal-select {
    0% {
      opacity: 1;
      transform: translate3d(var(--reveal-x), var(--reveal-y), 0) scale(1) rotate(var(--reveal-rotation));
    }
    100% {
      opacity: 1;
      transform:
        translate3d(calc(var(--reveal-x) + var(--exit-x)), calc(var(--reveal-y) + var(--exit-y)), 0)
        scale(var(--exit-scale))
        rotate(0deg);
    }
  }

  @keyframes deck-reveal-return {
    0% {
      opacity: 1;
      transform: translate3d(var(--reveal-x), var(--reveal-y), 0) scale(1) rotate(var(--reveal-rotation));
    }
    88% {
      opacity: 1;
      transform:
        translate3d(calc(var(--reveal-x) + var(--exit-x)), calc(var(--reveal-y) + var(--exit-y)), 0)
        scale(var(--exit-scale))
        rotate(0deg);
    }
    100% {
      opacity: 0;
      transform:
        translate3d(calc(var(--reveal-x) + var(--exit-x)), calc(var(--reveal-y) + var(--exit-y)), 0)
        scale(var(--exit-scale))
        rotate(0deg);
    }
  }

  @keyframes deck-reveal-flip {
    0% {
      transform: rotateY(0deg);
    }
    100% {
      transform: rotateY(180deg);
    }
  }

  @keyframes deck-search-reveal-flip {
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
      transform: rotateY(var(--take-flip));
    }
  }

  @keyframes deck-reveal-return-flip {
    0% {
      transform: rotateY(180deg);
    }
    100% {
      transform: rotateY(0deg);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .reveal-card.revealing,
    .reveal-card.searching,
    .reveal-card.selecting,
    .reveal-card.taking,
    .reveal-card.attaching,
    .reveal-card.returning,
    .reveal-card.revealing .reveal-card-inner,
    .reveal-card.searching .reveal-card-inner,
    .reveal-card.returning .reveal-card-inner {
      animation-duration: 1ms;
    }
  }
</style>
