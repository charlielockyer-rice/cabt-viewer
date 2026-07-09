<script lang="ts">
  import { onDestroy } from 'svelte';
  import CardTile from './CardTile.svelte';
  import { actionAnimationTiming } from '../anim/timing';
  import { AnimationEventGate } from '../anim/gate';
  import { animationActivity, scheduledEndMs } from '../anim/activity';
  import { handSlots, resolveAnchor } from '../anim/anchors';
  import { choreograph, type CardMotion, type TargetEffect } from '../anim/motions';
  import { fallbackHandTarget, handCardVisualRect, revealLayout, settledHandLandingWidth } from '../anim/revealLayout';
  import { animVisibility, type ReleaseClaim } from '../anim/visibility';
  import { cardBackCssVar } from '../game/cardAssets';
  import { centerOf } from '../dom/planeGeometry';
  import type { ActionTimelineEvent, CardView, PlayerView } from '../game/types';

  type Props = {
    events?: ActionTimelineEvent[];
    stepEvents?: ActionTimelineEvent[];
    scopeKey?: string | number;
    // Live-only turn boundary: sessions and their claims never outlive the
    // turn that created them. Ignored in replay (scopeKey owns boundaries).
    turnKey?: string | number;
    replayMode?: boolean;
    players?: PlayerView[];
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

  let {
    events = [],
    stepEvents = [],
    scopeKey = '',
    turnKey = '',
    replayMode = false,
    players = [],
  }: Props = $props();

  let liveTurnKey: string | number | undefined;
  const gate = new AnimationEventGate();
  const timers: ReturnType<typeof setTimeout>[] = [];
  const releases: ReleaseClaim[] = [];
  const activeAttachElements = new Set<HTMLElement>();
  const handoffSettleMs = 48;
  let reveals = $state<RevealAnimation[]>([]);
  let generation = 0;
  let nextAnimationId = 1;

  onDestroy(() => {
    clearSession();
  });

  $effect(() => {
    const { scopeChanged, batch } = gate.update(events, scopeKey);
    const { motions, effects } = choreograph(batch, players, stepEvents.length ? stepEvents : batch);
    const revealMotions = motions.filter(isRevealMotion);
    const attachCandidates = effects.filter((effect) => effect.kind === 'attach-under');
    const existingSessionAttaches = attachCandidates.filter(isSessionAttachEffect);

    const turnChanged = !replayMode && liveTurnKey !== undefined && turnKey !== liveTurnKey;
    liveTurnKey = turnKey;
    const sessionBoundary = replayMode ? scopeChanged : turnChanged;
    if (sessionBoundary && !revealMotions.length && !existingSessionAttaches.length) {
      clearSession();
    }
    if (!revealMotions.length && !existingSessionAttaches.length) {
      return;
    }
    if (!replayMode) {
      // Report transit time (fly-in/take/return/attach) so the live stepper
      // waits for it; session hold time is intentionally not counted.
      animationActivity.extendBy(scheduledEndMs(revealMotions, existingSessionAttaches) + handoffSettleMs + 60);
    }

    const startMotions = revealMotions.filter((motion) => motion.style === 'reveal' || motion.style === 'search-reveal');
    if (startMotions.length) {
      startReveal(startMotions);
    }
    // Membership is re-checked after startReveal: a deck-attach ability
    // creates its session sprite and consumes the attach in the same batch.
    for (const effect of attachCandidates) {
      if (isSessionAttachEffect(effect)) {
        attachRevealedCard(effect);
      }
    }
    for (const motion of revealMotions.filter((item) => item.style === 'reveal-take')) {
      takeRevealedCard(motion);
    }
    returnRevealedCards(revealMotions.filter((item) => item.style === 'reveal-return'));
    concludeSessionLeftovers(revealMotions, existingSessionAttaches);
  });

  // Safety net: once a session's resolution batch arrives (any take, return,
  // or attach), every sprite the batch did not address returns to the deck
  // instead of lingering — a stranded full-size card sprite is the worst-case
  // UI state, and an unmapped resolution encoding must degrade to a clean
  // departure, never a hang.
  function concludeSessionLeftovers(revealMotions: CardMotion[], attaches: TargetEffect[]) {
    const resolutions = revealMotions.filter((motion) => motion.style === 'reveal-take' || motion.style === 'reveal-return');
    if (!resolutions.length && !attaches.length) {
      return;
    }
    const addressed = new Set<number>();
    for (const motion of revealMotions) {
      if (motion.revealSerial !== undefined) {
        addressed.add(motion.revealSerial);
      }
    }
    for (const effect of attaches) {
      if (effect.sourceSerial !== undefined) {
        addressed.add(effect.sourceSerial);
      }
    }
    const holdingModes: RevealMode[] = ['revealing', 'searching', 'held', 'selecting'];
    const leftovers = reveals
      .flatMap((animation) => animation.sprites)
      .filter((sprite) => holdingModes.includes(sprite.mode)
        && (sprite.serial === undefined || !addressed.has(sprite.serial)));
    if (!leftovers.length) {
      return;
    }
    const baseMs = Math.max(0, ...resolutions.map((motion) => motion.startMs), ...attaches.map((effect) => effect.startMs));
    const startedGeneration = generation;
    for (const sprite of leftovers) {
      const player = sprite.card.playerIndex ?? 0;
      const deckRect = resolveAnchor({ kind: 'deck', player })?.geometry.getBoundingClientRect();
      const center = spriteCenter(sprite);
      const exit = deckRect && deckRect.width > 0
        ? centerOf(deckRect)
        : { x: center.x, y: center.y + 60 };
      updateSprites((item) => (item.id === sprite.id
        ? {
            ...item,
            mode: 'returning',
            delayMs: baseMs,
            exitX: exit.x - center.x,
            exitY: exit.y - center.y,
            exitScale: deckRect && deckRect.width > 0
              ? Math.max(0.32, Math.min(0.9, deckRect.width / item.width))
              : 0.5,
          }
        : item));
      const timer = setTimeout(() => {
        if (startedGeneration !== generation) {
          return;
        }
        removeSprites((item) => item.id === sprite.id);
      }, baseMs + actionAnimationTiming.deckRevealReturnMs + 80);
      timers.push(timer);
    }
    if (!replayMode) {
      animationActivity.extendBy(baseMs + actionAnimationTiming.deckRevealReturnMs + 120);
    }
  }

  function isRevealMotion(motion: CardMotion): boolean {
    return motion.style === 'reveal'
      || motion.style === 'search-reveal'
      || motion.style === 'reveal-take'
      || motion.style === 'reveal-return';
  }

  function isSessionAttachEffect(effect: TargetEffect): boolean {
    return effect.kind === 'attach-under'
      && effect.sourceSerial !== undefined
      && revealSprite(effect.sourceSerial) !== undefined;
  }

  function startReveal(motions: CardMotion[]) {
    clearSession();
    const sprites = [...groupByPlayer(motions).entries()].flatMap(([playerIndex, playerMotions]) =>
      spritesForPlayer(playerIndex, playerMotions),
    );
    if (!sprites.length) {
      return;
    }

    const startedGeneration = generation;
    const animation: RevealAnimation = {
      id: nextAnimationId++,
      sprites,
    };
    reveals = [animation];

    for (const sprite of sprites) {
      if (sprite.mode !== 'searching') {
        continue;
      }
      const releaseTarget = sprite.targetElement ? claimTarget(sprite.targetElement) : undefined;
      const revealMs = motionDurationMs(actionAnimationTiming.deckRevealMs);
      const handoffTimer = setTimeout(() => {
        if (startedGeneration !== generation) {
          return;
        }
        releaseTarget?.();
        removeSprites((item) => item.id === sprite.id);
      }, sprite.delayMs + revealMs + handoffSettleMs);
      timers.push(handoffTimer);
    }

    const timer = setTimeout(() => {
      if (startedGeneration !== generation) {
        return;
      }
      updateSprites((sprite) => sprite.mode === 'revealing' ? { ...sprite, mode: 'held', delayMs: 0 } : sprite);
    }, Math.max(...sprites.map((sprite) => sprite.delayMs)) + motionDurationMs(actionAnimationTiming.deckRevealMs));
    timers.push(timer);
  }

  function attachRevealedCard(effect: TargetEffect) {
    const serial = effect.sourceSerial;
    const sprite = serial !== undefined ? revealSprite(serial) : undefined;
    if (!sprite || serial === undefined) {
      return;
    }
    // The phase view already renders the arriving energy badge; keep it
    // hidden until the attach handoff animation takes ownership of it.
    const badge = resolveAnchor({ kind: 'attached', attached: 'energy', serial });
    const badgeRelease = badge ? claimTarget(badge.element) : undefined;
    // A deck-attach ability reveals and attaches in one batch: let the fan
    // flight finish before switching the sprite into its attach motion.
    if (sprite.mode === 'revealing' || sprite.mode === 'searching') {
      const startedGeneration = generation;
      const timer = setTimeout(() => {
        if (startedGeneration !== generation) {
          return;
        }
        applyRevealAttach({ ...effect, startMs: 0 }, badgeRelease);
      }, effect.startMs);
      timers.push(timer);
      return;
    }
    applyRevealAttach(effect, badgeRelease);
  }

  function applyRevealAttach(effect: TargetEffect, badgeRelease?: ReleaseClaim) {
    const serial = effect.sourceSerial;
    const sprite = serial !== undefined ? revealSprite(serial) : undefined;
    const target = resolveAnchor(effect.anchor);
    const targetCard = target?.element.querySelector('.card-tile');
    const targetElement = targetCard instanceof HTMLElement ? targetCard : target?.geometry;
    const targetRect = targetElement?.getBoundingClientRect();
    if (!sprite || !target || !targetRect || targetRect.width <= 0 || targetRect.height <= 0 || serial === undefined) {
      return;
    }

    const startedGeneration = generation;
    const sourceCenter = spriteCenter(sprite);
    const targetCenter = centerOf(targetRect);
    const delayMs = effect.startMs;
    markAttachTarget(target.element, serial, delayMs, startedGeneration, badgeRelease);
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
      if (startedGeneration !== generation) {
        return;
      }
      removeSprites((item) => item.serial === serial);
    }, delayMs + actionAnimationTiming.handMoveMs + 80);
    timers.push(timer);
  }

  function takeRevealedCard(motion: CardMotion) {
    const serial = motion.revealSerial;
    const sprite = serial !== undefined ? revealSprite(serial) : undefined;
    if (serial === undefined || !sprite) {
      return;
    }
    const target = handTargetForMotion(motion, 0, 1);
    if (!target) {
      return;
    }
    const startedGeneration = generation;
    const takeSource = normalizedSpriteForTake(sprite);
    const sourceCenter = spriteCenter(takeSource);
    const releaseTarget = target.element ? claimTarget(target.element) : undefined;
    updateSprites((item) => item.serial === serial
      ? {
          ...normalizedSpriteForTake(item),
          mode: 'taking',
          delayMs: motion.startMs,
          exitX: target.center.x - sourceCenter.x,
          exitY: target.center.y - sourceCenter.y,
          exitScale: Math.max(0.32, Math.min(1.2, target.width / takeSource.width)),
        }
      : item);
    const timer = setTimeout(() => {
      if (startedGeneration !== generation) {
        return;
      }
      releaseTarget?.();
      removeSprites((item) => item.serial === serial);
    }, motion.startMs + actionAnimationTiming.handMoveMs + handoffSettleMs);
    timers.push(timer);
  }

  function returnRevealedCards(motions: CardMotion[]) {
    if (!motions.length) {
      return;
    }
    const startedGeneration = generation;
    const byPlayer = groupByPlayer(motions);
    for (const [playerIndex, playerMotions] of byPlayer.entries()) {
      const deck = resolveAnchor({ kind: 'deck', player: playerIndex });
      const deckRect = deck?.geometry.getBoundingClientRect();
      if (!deckRect || deckRect.width <= 0 || deckRect.height <= 0) {
        continue;
      }
      const returningSerials = new Set(
        playerMotions
          .map((motion) => motion.revealSerial)
          .filter((serial): serial is number => serial !== undefined && Number.isFinite(serial)),
      );
      moveSelectedSpritesToReveal(playerIndex, returningSerials);
      const deckCenter = centerOf(deckRect);
      for (const motion of playerMotions) {
        const serial = motion.revealSerial;
        const sprite = serial !== undefined ? revealSprite(serial) : undefined;
        if (serial === undefined || !sprite) {
          continue;
        }
        const sourceCenter = spriteCenter(sprite);
        updateSprites((item) => item.serial === serial
          ? {
              ...item,
              mode: 'returning',
              delayMs: motion.startMs,
              exitX: deckCenter.x - sourceCenter.x,
              exitY: deckCenter.y - sourceCenter.y,
              exitScale: Math.max(0.32, Math.min(0.9, deckRect.width / item.width)),
            }
          : item);
        const timer = setTimeout(() => {
          if (startedGeneration !== generation) {
            return;
          }
          removeSprites((item) => item.serial === serial);
        }, motion.startMs + actionAnimationTiming.deckRevealReturnMs + 80);
        timers.push(timer);
      }
    }
  }

  function clearSession() {
    generation += 1;
    for (const timer of timers) {
      clearTimeout(timer);
    }
    timers.length = 0;
    for (const release of releases) {
      release();
    }
    releases.length = 0;
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

  function markAttachTarget(
    target: HTMLElement,
    serial: number,
    delayMs: number,
    startedGeneration: number,
    badgeRelease?: ReleaseClaim,
  ) {
    const startTimer = setTimeout(() => {
      if (startedGeneration !== generation) {
        return;
      }
      const energyBadge = attachedEnergyElement(target, serial);
      energyBadge?.classList.add('reveal-attach-handoff-energy');
      badgeRelease?.();
      if (energyBadge) {
        activeAttachElements.add(energyBadge);
      }
    }, delayMs);
    const endTimer = setTimeout(() => {
      if (startedGeneration !== generation) {
        return;
      }
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
    const badges = target.querySelectorAll('.energy-badges > span, .energy-badges img');
    const fallback = badges.item(badges.length - 1);
    return fallback instanceof HTMLElement ? fallback : null;
  }

  function spritesForPlayer(playerIndex: number, playerMotions: CardMotion[]): RevealSprite[] {
    const deck = resolveAnchor({ kind: 'deck', player: playerIndex });
    const deckRect = deck?.geometry.getBoundingClientRect();
    if (!deckRect || deckRect.width <= 0 || deckRect.height <= 0) {
      return [];
    }

    const layout = revealLayout(playerMotions.length);
    const deckCenter = centerOf(deckRect);
    return playerMotions.map((motion, index) => {
      const serial = motion.revealSerial;
      const target = layout.target(index);
      const takeTarget = motion.style === 'search-reveal'
        ? handTargetForMotion(motion, index, playerMotions.length)
        : undefined;
      const destination = takeTarget?.center ?? target;
      const mode: RevealMode = motion.style === 'search-reveal' ? 'searching' : 'revealing';
      const card = motion.sprite.kind === 'card' ? motion.sprite.card : { name: 'Card', fullName: 'Card' };
      return {
        id: motion.id,
        card: {
          ...card,
          serial,
          playerIndex,
        },
        serial,
        targetElement: takeTarget?.element,
        order: index + 1,
        mode,
        delayMs: motion.startMs,
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

  function handTargetForMotion(
    motion: CardMotion,
    index: number,
    count: number,
  ): { center: { x: number; y: number }; width: number; concealed: boolean; element?: HTMLElement } | undefined {
    const hand = resolveAnchor({ kind: 'hand', player: motion.player });
    if (!hand) {
      return undefined;
    }
    const handRect = hand.element.getBoundingClientRect();
    if (handRect.width <= 0 || handRect.height <= 0) {
      return undefined;
    }
    const target = resolveAnchor(motion.to);
    const measured = handCardVisualRect(target?.element);
    const fallback = fallbackHandTarget(handRect, index, count);
    // The incoming card's slot can be mid-layout (narrower than its final,
    // fixed hand-card width). Take the landing POSITION from that slot but the
    // landing WIDTH from a settled sibling hand card, so the sprite lands at the
    // card's real size instead of a transient one and then snapping.
    const width = settledHandLandingWidth(handSlots(motion.player), target?.element, fallback.width);
    const center = centerOf(measured ?? fallback);
    return {
      center,
      width,
      concealed: hand.element.classList.contains('concealed'),
      element: target?.element,
    };
  }

  function claimTarget(element: HTMLElement): ReleaseClaim {
    const release = animVisibility.claim(element, 'element');
    releases.push(release);
    return release;
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

  function groupByPlayer(motions: CardMotion[]): Map<number, CardMotion[]> {
    const groups = new Map<number, CardMotion[]>();
    for (const motion of motions) {
      const group = groups.get(motion.player) ?? [];
      group.push(motion);
      groups.set(motion.player, group);
    }
    return groups;
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

<span class="reveal-session-layer" data-anim-layer aria-hidden="true">
  <span class="deck-reveal-animation">
    {#each reveals as reveal (reveal.id)}
      {#each reveal.sprites as sprite (sprite.id)}
        <span class={`reveal-card ${sprite.mode}`} style={spriteStyle(sprite)}>
          <span class="reveal-card-inner">
            <span class="reveal-card-face reveal-card-back" style={cardBackCssVar()}></span>
            <span class="reveal-card-face reveal-card-front">
              <CardTile card={sprite.card} compact />
            </span>
          </span>
        </span>
      {/each}
    {/each}
  </span>
</span>

<style>
  .reveal-session-layer {
    display: contents;
  }

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

  .reveal-card-front :global(.card-tile) {
    width: 100%;
    height: 100%;
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
