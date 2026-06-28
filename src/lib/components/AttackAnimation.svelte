<script lang="ts">
  import { cardFaceImageUrl } from '../game/cardAssets';
  import { onDestroy, onMount } from 'svelte';
  import {
    hideElementForAnimation,
    releaseElementVisibilityClaim,
    type ElementVisibilityClaim,
  } from '../animations/animationVisibilityClaims';
  import { actionAnimationBatchEvents, actionAnimationStartMs, actionAnimationTiming } from '../cabt/actionAnimationSchedule';
  import { cabtCardToView } from '../cabt/cardView';
  import { CabtAreaType } from '../cabt/types';
  import { replayAnimationPhaseGapMs } from '../game/replay';
  import type { ActionTimelineEvent, CardView } from '../game/types';

  type Props = {
    events?: ActionTimelineEvent[];
    stepEvents?: ActionTimelineEvent[];
    scopeKey?: string | number;
    replayMode?: boolean;
  };

  type DamageSprite = {
    id: string;
    value: number;
    left: number;
    top: number;
    delayMs: number;
  };

  type KnockOutSprite = {
    id: string;
    card: CardView;
    left: number;
    top: number;
    width: number;
    height: number;
    deltaX: number;
    deltaY: number;
    rotation: number;
    targetRotation: number;
    targetScale: number;
    delayMs: number;
  };

  let {
    events = [],
    stepEvents = [],
    scopeKey = '',
    replayMode = false,
  }: Props = $props();

  const timers: ReturnType<typeof setTimeout>[] = [];
  let seenEventIds = new Set<number>();
  let initialized = false;
  let lastScopeKey: string | number = '';
  let reduceMotion = $state(false);
  let damageSprites = $state<DamageSprite[]>([]);
  let knockOutSprites = $state<KnockOutSprite[]>([]);
  let animationGeneration = 0;
  const activeAttackAnnouncements = new Set<HTMLElement>();
  const activeAttackLunges = new Set<HTMLElement>();
  const knockOutVisibilityClaims = new Map<string, ElementVisibilityClaim[]>();
  const knockOutTiltDeg = 22;
  const knockOutSpritePadPx = 10;

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
    clearAttackAnimations();
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

    if (scopeChanged) {
      clearAttackAnimations();
    }

    const animationEvents = actionAnimationBatchEvents(currentEvents, seenEventIds, replayMode, scopeChanged);
    for (const event of currentEvents) {
      seenEventIds.add(event.id);
    }
    if (!animationEvents.length || reduceMotion) {
      return;
    }

    startAttackAnnouncements(animationEvents);
    startDamageAnimations(animationEvents);
    startKnockOutAnimations(animationEvents);
  });

  function startAttackAnnouncements(animationEvents: ActionTimelineEvent[]) {
    for (const event of animationEvents.filter((candidate) => candidate.kind === 'Attack')) {
      const attacker = slotElementForEvent(event);
      if (!attacker) {
        continue;
      }
      const delayMs = actionAnimationStartMs(animationEvents, event);
      const timer = setTimeout(() => {
        activeAttackAnnouncements.add(attacker);
        attacker.dataset.attackAnnounceActive = 'true';
        attacker.style.setProperty('--attack-name', JSON.stringify(attackNameForEvent(event)));
        const cleanup = setTimeout(() => {
          clearAttackAnnouncement(attacker);
        }, actionAnimationTiming.attackAnnounceMs);
        timers.push(cleanup);
      }, delayMs);
      timers.push(timer);
    }
  }

  function startDamageAnimations(animationEvents: ActionTimelineEvent[]) {
    const attackEvent = stepEvents.find((event) => event.kind === 'Attack');
    for (const event of animationEvents.filter(isDamageEvent)) {
      const target = slotElementForEvent(event);
      const attacker = attackEvent ? slotElementForEvent(attackEvent) : null;
      if (!target) {
        continue;
      }
      const delayMs = actionAnimationStartMs(animationEvents, event);
      const targetRect = target.getBoundingClientRect();
      const value = damageValue(event);

      if (attacker) {
        const sourceRect = attacker.getBoundingClientRect();
        const dx = targetRect.left + targetRect.width / 2 - (sourceRect.left + sourceRect.width / 2);
        const dy = targetRect.top + targetRect.height / 2 - (sourceRect.top + sourceRect.height / 2);
        const distance = Math.max(1, Math.hypot(dx, dy));
        attacker.style.setProperty('--attack-lunge-x', `${(dx / distance * 22).toFixed(1)}px`);
        attacker.style.setProperty('--attack-lunge-y', `${(dy / distance * 22).toFixed(1)}px`);
        const lungeTimer = setTimeout(() => {
          activeAttackLunges.add(attacker);
          attacker.dataset.attackLungeActive = 'true';
          const cleanup = setTimeout(() => {
            clearAttackLunge(attacker);
          }, actionAnimationTiming.damageVisualMs);
          timers.push(cleanup);
        }, delayMs);
        attacker.style.setProperty('--damage-visual-ms', `${actionAnimationTiming.damageVisualMs}ms`);
        timers.push(lungeTimer);
      }

      if (value > 0) {
        const sprite: DamageSprite = {
          id: `${event.id}-${value}`,
          value,
          left: targetRect.left + targetRect.width / 2,
          top: targetRect.top + targetRect.height * 0.42,
          delayMs,
        };
        damageSprites = [...damageSprites, sprite];
        const cleanup = setTimeout(() => {
          damageSprites = damageSprites.filter((item) => item.id !== sprite.id);
        }, delayMs + actionAnimationTiming.damageVisualMs);
        timers.push(cleanup);
      }
    }
  }

  function startKnockOutAnimations(animationEvents: ActionTimelineEvent[]) {
    const koEvents = animationEvents.filter(isKnockOutEvent);
    if (!koEvents.length) {
      return;
    }
    const generation = animationGeneration;
    for (const event of koEvents) {
      const source = slotElementForEvent(event);
      const discard = discardElementForPlayer(event.playerIndex);
      const params = event.params as Record<string, unknown> | undefined;
      const cardId = Number(params?.cardId);
      if (!source || !discard || !Number.isFinite(cardId)) {
        continue;
      }
      const sourceCard = source.querySelector('.card-tile');
      const sourceRect = (sourceCard instanceof HTMLElement ? sourceCard : source).getBoundingClientRect();
      const discardRect = discard.getBoundingClientRect();
      const spriteWidth = sourceRect.width + knockOutSpritePadPx * 2;
      const spriteHeight = sourceRect.height + knockOutSpritePadPx * 2;
      const spriteLeft = sourceRect.left - knockOutSpritePadPx;
      const spriteTop = sourceRect.top - knockOutSpritePadPx;
      const delayMs = actionAnimationStartMs(animationEvents, event);
      const sprite: KnockOutSprite = {
        id: `${event.id}-${params?.serial ?? cardId}`,
        card: cabtCardToView(cardId),
        left: spriteLeft,
        top: spriteTop,
        width: spriteWidth,
        height: spriteHeight,
        deltaX: discardRect.left + discardRect.width / 2 - (spriteLeft + spriteWidth / 2),
        deltaY: discardRect.top + discardRect.height / 2 - (spriteTop + spriteHeight / 2),
        rotation: source.closest('.top-active-slot, .top-bench-row') ? 180 : 0,
        targetRotation: discard.closest('.top-piles') ? 180 : 0,
        targetScale: Math.max(0.35, Math.min(1, discardRect.width / sourceRect.width)),
        delayMs,
      };
      const startTimer = setTimeout(() => {
        if (generation !== animationGeneration || !document.body.contains(source) || !document.body.contains(discard)) {
          return;
        }
        hideKnockOutElement(sprite.id, source, 'source');
        const destination = discardCardElement(event.playerIndex, Number(params?.serial), cardId);
        if (destination) {
          hideKnockOutElement(sprite.id, destination, 'destination');
        }
        knockOutSprites = [...knockOutSprites, sprite];
        const cleanup = setTimeout(() => {
          releaseKnockOutSprite(sprite.id);
        }, actionAnimationTiming.knockOutMs + replayAnimationPhaseGapMs);
        timers.push(cleanup);
      }, delayMs);
      timers.push(startTimer);
    }
  }

  function clearAttackAnimations() {
    animationGeneration += 1;
    for (const timer of timers) {
      clearTimeout(timer);
    }
    timers.length = 0;
    for (const element of activeAttackAnnouncements) {
      clearAttackAnnouncement(element);
    }
    for (const element of activeAttackLunges) {
      clearAttackLunge(element);
    }
    for (const spriteId of Array.from(knockOutVisibilityClaims.keys())) {
      releaseKnockOutSprite(spriteId);
    }
    damageSprites = [];
    knockOutSprites = [];
  }

  function clearAttackAnnouncement(element: HTMLElement) {
    delete element.dataset.attackAnnounceActive;
    element.style.removeProperty('--attack-name');
    activeAttackAnnouncements.delete(element);
  }

  function clearAttackLunge(element: HTMLElement) {
    delete element.dataset.attackLungeActive;
    element.style.removeProperty('--attack-lunge-x');
    element.style.removeProperty('--attack-lunge-y');
    element.style.removeProperty('--damage-visual-ms');
    activeAttackLunges.delete(element);
  }

  function hideKnockOutElement(spriteId: string, element: HTMLElement, role: 'source' | 'destination') {
    const claim = hideElementForAnimation({
      element,
      scopeKey,
      role,
      fallbackAttribute: 'data-attack-knock-out-hidden',
    });
    const claims = knockOutVisibilityClaims.get(spriteId) ?? [];
    claims.push(claim);
    knockOutVisibilityClaims.set(spriteId, claims);
  }

  function releaseKnockOutSprite(spriteId: string) {
    const claims = knockOutVisibilityClaims.get(spriteId) ?? [];
    for (const claim of claims) {
      releaseElementVisibilityClaim(claim);
    }
    knockOutVisibilityClaims.delete(spriteId);
    knockOutSprites = knockOutSprites.filter((item) => item.id !== spriteId);
  }

  function isDamageEvent(event: ActionTimelineEvent) {
    return event.kind === 'HpChange' || event.kind === 'HPChange';
  }

  function isKnockOutEvent(event: ActionTimelineEvent) {
    const params = event.params as Record<string, unknown> | undefined;
    const fromArea = Number(params?.fromArea);
    const toArea = Number(params?.toArea);
    return event.kind === 'MoveCard'
      && toArea === CabtAreaType.DISCARD
      && (fromArea === CabtAreaType.ACTIVE || fromArea === CabtAreaType.BENCH);
  }

  function slotElementForEvent(event: ActionTimelineEvent): HTMLElement | null {
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

  function discardElementForPlayer(playerIndex: number | undefined): HTMLElement | null {
    if (playerIndex === undefined) {
      return null;
    }
    const element = document.querySelector(`[data-card-anchor="player:${playerIndex}:discard"]`);
    return element instanceof HTMLElement ? element : null;
  }

  function discardCardElement(playerIndex: number | undefined, serial: number, cardId: number): HTMLElement | null {
    const discard = discardElementForPlayer(playerIndex);
    if (!discard) {
      return null;
    }
    const card = Number.isFinite(serial)
      ? discard.querySelector(`.card-tile[data-card-serial="${serial}"]`)
      : Number.isFinite(cardId)
        ? discard.querySelector(`.card-tile[data-card-id="${cardId}"]`)
        : null;
    return card instanceof HTMLElement ? card : null;
  }

  function attackNameForEvent(event: ActionTimelineEvent): string {
    const match = event.message.match(/\bused\s+(.+?)\s+with\b/i);
    return match?.[1] ?? 'Attack';
  }

  function damageValue(event: ActionTimelineEvent): number {
    const params = event.params as Record<string, unknown> | undefined;
    const value = Number(params?.value);
    return Number.isFinite(value) ? Math.abs(Math.min(0, value)) : 0;
  }

  function damageSpriteStyle(sprite: DamageSprite) {
    return [
      `left: ${sprite.left}px`,
      `top: ${sprite.top}px`,
      `--attack-delay: ${sprite.delayMs}ms`,
      `--damage-visual-ms: ${actionAnimationTiming.damageVisualMs}ms`,
    ].join('; ');
  }

  function knockOutSpriteStyle(sprite: KnockOutSprite) {
    return [
      `left: ${sprite.left}px`,
      `top: ${sprite.top}px`,
      `width: ${sprite.width}px`,
      `height: ${sprite.height}px`,
      `--ko-x: ${sprite.deltaX.toFixed(1)}px`,
      `--ko-y: ${sprite.deltaY.toFixed(1)}px`,
      `--ko-rotation: ${sprite.rotation}deg`,
      `--ko-end-rotation: ${sprite.rotation + knockOutTiltDeg}deg`,
      `--ko-target-rotation: ${sprite.targetRotation}deg`,
      `--ko-scale: ${sprite.targetScale.toFixed(3)}`,
      `--ko-pad: ${knockOutSpritePadPx}px`,
      `--attack-delay: ${sprite.delayMs}ms`,
    ].join('; ');
  }
</script>

<span class="attack-animation-layer" aria-hidden="true">
  {#each damageSprites as sprite (sprite.id)}
    <span class="attack-damage-number" style={damageSpriteStyle(sprite)}>{sprite.value}</span>
  {/each}
  {#each knockOutSprites as sprite (sprite.id)}
      <span class="attack-ko-card" style={knockOutSpriteStyle(sprite)}>
        <span class="attack-ko-card-frame">
        {#if cardFaceImageUrl(sprite.card)}
          <img src={cardFaceImageUrl(sprite.card)} alt="" draggable="false" />
        {:else}
          <span>{sprite.card.name}</span>
        {/if}
      </span>
    </span>
  {/each}
</span>

<style>
  /* TODO: Move KO board-to-discard motion into the board/replay motion owner when
     that orchestrator covers attack KOs. This component is mounted outside
     .game-board-plane, so a true board-plane sprite would need cross-component
     DOM ownership or a portal instead of a local coordinate change. */
  .attack-animation-layer {
    position: fixed;
    inset: 0;
    z-index: 30;
    pointer-events: none;
  }

  :global(.board-slot[data-attack-announce-active="true"]) {
    animation: attack-announcement-glow 520ms ease-out both;
  }

  :global(.board-slot[data-attack-announce-active="true"]::after) {
    content: var(--attack-name);
    position: absolute;
    left: 50%;
    top: -12px;
    z-index: 12;
    min-width: max-content;
    max-width: 210px;
    padding: 6px 10px;
    border-radius: 999px;
    background: rgba(17, 24, 39, 0.9);
    color: white;
    box-shadow: 0 8px 20px rgba(17, 24, 39, 0.24);
    font-size: 12px;
    font-weight: 900;
    line-height: 1;
    text-align: center;
    transform: translate(-50%, -100%);
    animation: attack-name-pop 520ms ease-out both;
    pointer-events: none;
  }

  :global(.board-slot[data-attack-lunge-active="true"]) {
    animation: attack-lunge var(--damage-visual-ms, 560ms) cubic-bezier(0.2, 0.82, 0.22, 1) both;
  }

  :global(.board-slot[data-attack-knock-out-hidden="true"] > .card-tile),
  :global(.board-slot[data-attack-knock-out-hidden="true"] > .pokemon-status),
  :global(.board-slot[data-attack-knock-out-hidden="true"] > .energy-badges),
  :global(.board-slot[data-attack-knock-out-hidden="true"] > .tool-card-preview),
  :global(.board-slot[data-attack-knock-out-hidden="true"] > .slot-badges) {
    opacity: 0;
  }

  .attack-damage-number {
    position: fixed;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 64px;
    height: 42px;
    padding: 0 12px;
    border-radius: 8px;
    border: 2px solid rgba(255, 255, 255, 0.86);
    background:
      linear-gradient(180deg, #fef2f2 0%, #fecaca 42%, #dc2626 100%);
    box-shadow:
      0 12px 26px rgba(127, 29, 29, 0.32),
      0 0 0 5px rgba(248, 113, 113, 0.16),
      inset 0 2px 2px rgba(255, 255, 255, 0.72);
    color: #fff;
    font-size: 27px;
    font-weight: 950;
    line-height: 1;
    letter-spacing: 0;
    -webkit-text-stroke: 1.2px #450a0a;
    paint-order: stroke fill;
    transform: translate(-50%, -50%);
    text-shadow: 0 2px 2px rgba(69, 10, 10, 0.32);
    animation: attack-damage-number var(--damage-visual-ms, 560ms) ease-out var(--attack-delay) both;
  }

  .attack-damage-number::before,
  .attack-damage-number::after {
    content: none;
  }

  .attack-ko-card {
    position: fixed;
    display: grid;
    place-items: center;
    overflow: visible;
    border-radius: 6px;
    transform-origin: 50% 50%;
    animation: attack-ko-card 620ms cubic-bezier(0.24, 0.78, 0.24, 1) var(--attack-delay) both;
  }

  .attack-ko-card-frame {
    position: absolute;
    inset: var(--ko-pad, 0);
    display: grid;
    place-items: center;
    overflow: visible;
    border-radius: inherit;
    background: #f7f8fa;
    box-shadow: 0 16px 36px rgba(23, 30, 38, 0.3);
  }

  .attack-ko-card-frame img {
    width: 100%;
    height: 100%;
    display: block;
    object-fit: fill;
    border-radius: inherit;
    pointer-events: none;
  }

  .attack-ko-card-frame > span {
    padding: 8px;
    font-size: 12px;
    font-weight: 900;
    text-align: center;
  }

  @keyframes attack-announcement-glow {
    0% {
      filter: none;
      box-shadow: none;
    }
    35%,
    70% {
      filter: saturate(1.15) brightness(1.04);
      box-shadow: 0 0 0 4px rgba(251, 191, 36, 0.62), 0 0 22px rgba(251, 191, 36, 0.58);
    }
    100% {
      filter: none;
      box-shadow: none;
    }
  }

  @keyframes attack-name-pop {
    0% {
      opacity: 0;
      transform: translate(-50%, -88%) scale(0.88);
    }
    22%,
    78% {
      opacity: 1;
      transform: translate(-50%, -100%) scale(1);
    }
    100% {
      opacity: 0;
      transform: translate(-50%, -112%) scale(0.98);
    }
  }

  @keyframes attack-lunge {
    0%,
    100% {
      translate: 0 0;
      filter: none;
    }
    42% {
      translate: var(--attack-lunge-x) var(--attack-lunge-y);
      filter: saturate(1.12) brightness(1.03);
    }
  }

  @keyframes attack-damage-number {
    0% {
      opacity: 0;
      transform: translate(-50%, -38%) scale(0.76);
    }
    18%,
    68% {
      opacity: 1;
      transform: translate(-50%, -56%) scale(1);
    }
    100% {
      opacity: 0;
      transform: translate(-50%, -78%) scale(1.08);
    }
  }

  @keyframes attack-ko-card {
    0% {
      opacity: 1;
      transform: translate3d(0, 0, 0) rotate(var(--ko-rotation));
    }
    32% {
      opacity: 1;
      transform: translate3d(0, 0, 0) rotate(var(--ko-end-rotation));
    }
    78% {
      opacity: 1;
      transform: translate3d(var(--ko-x), var(--ko-y), 0) rotate(var(--ko-end-rotation)) scale(var(--ko-scale));
    }
    100% {
      opacity: 1;
      transform: translate3d(var(--ko-x), var(--ko-y), 0) rotate(var(--ko-target-rotation)) scale(var(--ko-scale));
    }
  }

  @media (prefers-reduced-motion: reduce) {
    :global(.board-slot[data-attack-announce-active="true"]),
    :global(.board-slot[data-attack-lunge-active="true"]),
    .attack-damage-number,
    .attack-ko-card {
      animation: none;
    }
  }
</style>
