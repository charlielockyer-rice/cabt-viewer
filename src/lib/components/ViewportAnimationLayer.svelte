<script lang="ts">
  import { onDestroy, onMount, untrack } from 'svelte';
  import CardTile from './CardTile.svelte';
  import { AnimationEventGate, scopeEnded } from '../anim/gate';
  import { animationActivity, scheduledEndMs } from '../anim/activity';
  import { applyTargetEffect } from '../anim/effects';
  import { handSlots, resolveAnchor, type Anchor, type ResolvedAnchor } from '../anim/anchors';
  import { choreograph, groupMotionsByPlayer, type CardMotion, type TargetEffect } from '../anim/motions';
  import { cardVisual, fallbackHandTarget, handCardVisualRect, revealLayout, settledHandLandingWidth } from '../anim/revealLayout';
  import { animVisibility, type HideMode, type ReleaseClaim } from '../anim/visibility';
  import { replayStore } from '../../state/replay.svelte';
  import { cardBackCssVar, cardFaceImageUrl, cssAssetUrl } from '../game/cardAssets';
  import { replayAnimationPhaseGapMs } from '../game/replay';
  import { actionAnimationTiming } from '../anim/timing';
  import {
    centerOf,
    cssMatrix3dForQuad,
    planeMapper,
    rectQuad,
    rotatedRectQuad,
    viewportQuad,
  } from '../dom/planeGeometry';
  import type { ActionTimelineEvent, CardView, PlayerView } from '../game/types';

  type Props = {
    events?: ActionTimelineEvent[];
    stepEvents?: ActionTimelineEvent[];
    scopeKey?: string | number;
    turnKey?: string | number;
    // Live scope-end boundary: bumps on every applied view. Held sprites/claims
    // release when it changes, handing off at the newly-rendered destination —
    // replay's deterministic model. Ignored in replay (scopeKey owns it).
    applySignal?: number;
    replayMode?: boolean;
    players?: PlayerView[];
  };

  type Sprite = {
    id: string;
    style: CardMotion['style'];
    card?: CardView;
    text?: string;
    reveal: boolean;
    concealed: boolean;
    topHand: boolean;
    direct: boolean;
    evolve: boolean;
    coinHead?: boolean;
    css: string;
  };

  type HandCardSnapshot = {
    frameRect: DOMRect;
    visualRect: DOMRect;
    frameElement: HTMLElement;
  };

  type HandSnapshot = {
    concealed: boolean;
    topHand: boolean;
    handRect: DOMRect;
    cards: Map<number, HandCardSnapshot>;
  };

  const handPlayMoveMs = 360;
  const evolveMoveMs = 430;
  const evolveVisibleMs = actionAnimationTiming.evolveMs + replayAnimationPhaseGapMs + 40;
  // The evolve sprite + its destination claim hand off when the evolved card has
  // actually rendered and decoded, not on a fixed clock — poll interval + a
  // bounded safety release so the sprite never strands if the art never loads.
  const evolveReadyPollMs = 40;
  const maxEvolveHoldMs = 1400;
  const drawMoveMs = actionAnimationTiming.deckDrawMs;
  const drawHandoffMs = Math.round(drawMoveMs * 0.88);
  const resetMoveMs = 360;
  const prizeTakeDirectMs = 520;
  const prizePlaceHandoffMs = 304;
  const coinSizePx = 132;
  const cardRatio = 88 / 63;

  let {
    events = [],
    stepEvents = [],
    scopeKey = '',
    turnKey = '',
    applySignal = 0,
    replayMode = false,
    players = [],
  }: Props = $props();

  let lastApplySignal: number | undefined;
  const gate = new AnimationEventGate();
  const timers: ReturnType<typeof setTimeout>[] = [];
  const releases: ReleaseClaim[] = [];
  let sprites = $state<Sprite[]>([]);
  let reduceMotion = $state(false);
  let generation = 0;
  let handSnapshots = new Map<number, HandSnapshot>();
  // Evolve handoffs that outlive the scope boundary: sprite id -> finish(). These
  // sprites and their claims are NOT torn down by endScope; they release only on
  // the destination-ready poll (or its safety timeout).
  const evolveHolds = new Map<string, () => void>();

  onMount(() => {
    if (typeof window.matchMedia !== 'function') {
      return;
    }
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => {
      reduceMotion = media.matches;
    };
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  });

  onDestroy(() => {
    endScope();
    for (const finish of [...evolveHolds.values()]) {
      finish();
    }
  });

  // Hand sources vanish from the DOM the moment the view moves a card out of
  // the hand, so geometry is captured before each render.
  $effect.pre(() => {
    void events;
    const snapshots = new Map<number, HandSnapshot>();
    for (const handElement of document.querySelectorAll('[data-card-anchor$=":hand"]')) {
      if (!(handElement instanceof HTMLElement) || handElement.closest('[data-anim-layer]')) {
        continue;
      }
      const match = handElement.dataset.cardAnchor?.match(/^player:(\d+):hand$/);
      const playerIndex = match ? Number(match[1]) : NaN;
      if (!Number.isFinite(playerIndex)) {
        continue;
      }
      const cards = new Map<number, HandCardSnapshot>();
      for (const frame of handElement.querySelectorAll('.hand-card-frame[data-card-serial]')) {
        if (!(frame instanceof HTMLElement) || frame.dataset.animHidden) {
          continue;
        }
        const serial = Number(frame.dataset.cardSerial);
        if (!Number.isFinite(serial)) {
          continue;
        }
        const visual = frame.querySelector('.card-tile');
        cards.set(serial, {
          frameRect: frame.getBoundingClientRect(),
          visualRect: visual instanceof HTMLElement ? visual.getBoundingClientRect() : frame.getBoundingClientRect(),
          frameElement: frame,
        });
      }
      snapshots.set(playerIndex, {
        concealed: handElement.classList.contains('concealed'),
        topHand: !!handElement.closest('.player-panel.top'),
        handRect: handElement.getBoundingClientRect(),
        cards,
      });
    }
    if (snapshots.size) {
      handSnapshots = snapshots;
    }
  });

  // Scrub mode: the replay timeline is being navigated faster than animations can
  // play. Sourced from the store (not a prop) to keep this off the shared,
  // contended App render path; guarded by replayMode so live play is unaffected.
  let scrub = $derived(replayMode && replayStore.scrubbing);

  $effect(() => {
    const scrubbing = scrub;
    const { scopeChanged, batch } = gate.update(events, scopeKey);
    const applyChanged = !replayMode && lastApplySignal !== undefined && applySignal !== lastApplySignal;
    lastApplySignal = applySignal;
    if (scrubbing) {
      // gate.update already consumed this view's events (no stale batch on exit);
      // drop all choreography and hard-purge so nothing lingers as an artifact.
      // untrack: purgeForScrub reads AND writes `sprites` (endScope's filter + the
      // length guard); without untrack the read subscribes this effect to
      // `sprites` and the write re-triggers it — an infinite loop
      // (effect_update_depth_exceeded) while scrubbing stays true, hard-freezing
      // the UI under a real drag.
      untrack(() => purgeForScrub());
      return;
    }
    if (scopeEnded(replayMode, { scopeChanged, applyChanged })) {
      endScope();
    }
    if (!batch.length || reduceMotion) {
      return;
    }

    const { motions, effects } = choreograph(batch, players, stepEvents.length ? stepEvents : batch);
    const mine = motions.filter((motion) => motion.space === 'viewport');
    if (!replayMode && (mine.length || effects.length)) {
      // Report how long this batch runs so the live stepper waits for it
      // (pad covers handoff and cleanup timers past the nominal durations).
      animationActivity.extendBy(scheduledEndMs(mine, effects) + 200);
    }
    const startedGeneration = generation;

    for (const motion of mine.filter((motion) => motion.style === 'hand-play')) {
      startHandPlay(motion, startedGeneration);
    }
    startDraws(mine.filter((motion) => motion.style === 'deck-draw'), startedGeneration);
    startResets(mine.filter((motion) => motion.style === 'hand-reset'), startedGeneration);
    startPrizeTakes(mine.filter((motion) => motion.style === 'prize-take'), startedGeneration);
    for (const motion of mine.filter((motion) => motion.style === 'damage-float')) {
      startDamageFloat(motion, startedGeneration);
    }
    for (const motion of mine.filter((motion) => motion.style === 'coin-flip')) {
      startCoinFlip(motion, startedGeneration);
    }
    for (const motion of mine.filter((motion) => motion.style === 'knock-out')) {
      startKnockOut(motion, startedGeneration);
    }
    for (const effect of effects) {
      if (effect.kind === 'attach-under') {
        startAttachUnder(effect, startedGeneration);
      } else if (effect.kind === 'prize-place') {
        startPrizePlace(effect, startedGeneration);
      } else if (effect.kind === 'lunge') {
        startLunge(effect, startedGeneration);
      } else {
        startAnnounce(effect, startedGeneration);
      }
    }
  });

  function startAnnounce(effect: TargetEffect, startedGeneration: number) {
    const attack = effect.kind === 'announce-attack';
    const attribute = attack ? 'data-attack-announce-active' : 'data-ability-announce-active';
    const nameVar = attack ? '--attack-name' : '--ability-name';
    const timer = setTimeout(() => {
      if (startedGeneration !== generation) {
        return;
      }
      const target = resolveAnchor(effect.anchor);
      if (!target) {
        return;
      }
      const release = applyTargetEffect(target.element, attribute, {
        [nameVar]: JSON.stringify(effect.label ?? ''),
      });
      releases.push(release);
      const cleanup = setTimeout(release, effect.durationMs);
      timers.push(cleanup);
    }, effect.startMs);
    timers.push(timer);
  }

  function startLunge(effect: TargetEffect, startedGeneration: number) {
    const timer = setTimeout(() => {
      if (startedGeneration !== generation) {
        return;
      }
      const attacker = resolveAnchor(effect.anchor);
      const target = effect.targetAnchor ? resolveAnchor(effect.targetAnchor) : null;
      if (!attacker || !target) {
        return;
      }
      const sourceRect = attacker.element.getBoundingClientRect();
      const targetRect = target.element.getBoundingClientRect();
      const dx = targetRect.left + targetRect.width / 2 - (sourceRect.left + sourceRect.width / 2);
      const dy = targetRect.top + targetRect.height / 2 - (sourceRect.top + sourceRect.height / 2);
      const distance = Math.max(1, Math.hypot(dx, dy));
      const release = applyTargetEffect(attacker.element, 'data-attack-lunge-active', {
        '--attack-lunge-x': `${(dx / distance * 22).toFixed(1)}px`,
        '--attack-lunge-y': `${(dy / distance * 22).toFixed(1)}px`,
        '--damage-visual-ms': `${effect.durationMs}ms`,
      });
      releases.push(release);
      const cleanup = setTimeout(release, effect.durationMs);
      timers.push(cleanup);
    }, effect.startMs);
    timers.push(timer);
  }

  function startDamageFloat(motion: CardMotion, startedGeneration: number) {
    if (motion.sprite.kind !== 'label') {
      return;
    }
    const target = resolveAnchor(motion.from);
    if (!target) {
      return;
    }
    const rect = target.element.getBoundingClientRect();
    if (rect.width <= 0) {
      return;
    }
    sprites = [...sprites, {
      id: motion.id,
      style: 'damage-float',
      text: motion.sprite.text,
      reveal: false,
      concealed: false,
      topHand: false,
      direct: false,
      evolve: false,
      css: [
        `left: ${rect.left + rect.width / 2}px`,
        `top: ${rect.top + rect.height * 0.42}px`,
        `--attack-delay: ${motion.startMs}ms`,
        `--damage-visual-ms: ${motion.durationMs}ms`,
      ].join('; '),
    }];
    const timer = setTimeout(() => {
      if (startedGeneration !== generation) {
        return;
      }
      sprites = sprites.filter((sprite) => sprite.id !== motion.id);
    }, motion.startMs + motion.durationMs);
    timers.push(timer);
  }

  function startCoinFlip(motion: CardMotion, startedGeneration: number) {
    const boardRect = document.querySelector('.playmat')?.getBoundingClientRect();
    const centerX = boardRect ? boardRect.left + boardRect.width / 2 : window.innerWidth / 2;
    const centerY = boardRect ? boardRect.top + boardRect.height * 0.5 : window.innerHeight * 0.47;
    const index = motion.coinIndex ?? 0;
    const count = motion.coinCount ?? 1;
    const offsetX = (index - (count - 1) / 2) * (coinSizePx * 1.2);
    const coinHead = motion.coinHead === true;
    sprites = [...sprites, {
      id: motion.id,
      style: 'coin-flip',
      text: coinHead ? 'Heads' : 'Tails',
      reveal: false,
      concealed: false,
      topHand: false,
      direct: false,
      evolve: false,
      coinHead,
      css: [
        `left: ${(centerX + offsetX).toFixed(1)}px`,
        `top: ${centerY.toFixed(1)}px`,
        `--coin-size: ${coinSizePx}px`,
        `--coin-delay: ${motion.startMs}ms`,
        `--coin-duration: ${motion.durationMs}ms`,
        `--coin-end-rotation: ${coinHead ? 3240 : 3420}deg`,
      ].join('; '),
    }];
    const timer = setTimeout(() => {
      if (startedGeneration !== generation) {
        return;
      }
      sprites = sprites.filter((sprite) => sprite.id !== motion.id);
    }, motion.startMs + motion.durationMs + 60);
    timers.push(timer);
  }

  function startKnockOut(motion: CardMotion, startedGeneration: number) {
    const padPx = 10;
    const tiltDeg = 22;
    const timer = setTimeout(() => {
      if (startedGeneration !== generation) {
        return;
      }
      const source = resolveAnchor(motion.from);
      const discard = resolveAnchor(motion.to);
      if (!source || !discard || motion.sprite.kind !== 'card') {
        return;
      }
      const sourceRect = cardVisual(source.element).getBoundingClientRect();
      const discardRect = discard.element.getBoundingClientRect();
      if (sourceRect.width <= 0 || discardRect.width <= 0) {
        return;
      }
      const spriteLeft = sourceRect.left - padPx;
      const spriteTop = sourceRect.top - padPx;
      const spriteWidth = sourceRect.width + padPx * 2;
      const spriteHeight = sourceRect.height + padPx * 2;
      const rotation = source.element.closest('.top-active-slot, .top-bench-row') ? 180 : 0;
      const sourceRelease = animVisibility.claim(source.element, 'contents');
      releases.push(sourceRelease);
      sprites = [...sprites, {
        id: motion.id,
        style: 'knock-out',
        card: motion.sprite.card,
        reveal: false,
        concealed: false,
        topHand: false,
        direct: false,
        evolve: false,
        css: [
          `left: ${spriteLeft}px`,
          `top: ${spriteTop}px`,
          `width: ${spriteWidth}px`,
          `height: ${spriteHeight}px`,
          `--ko-x: ${(discardRect.left + discardRect.width / 2 - (spriteLeft + spriteWidth / 2)).toFixed(1)}px`,
          `--ko-y: ${(discardRect.top + discardRect.height / 2 - (spriteTop + spriteHeight / 2)).toFixed(1)}px`,
          `--ko-rotation: ${rotation}deg`,
          `--ko-end-rotation: ${rotation + tiltDeg}deg`,
          `--ko-target-rotation: ${discard.element.closest('.top-piles') ? 180 : 0}deg`,
          `--ko-scale: ${clamp(discardRect.width / sourceRect.width, 0.35, 1).toFixed(3)}`,
          `--ko-pad: ${padPx}px`,
          '--attack-delay: 0ms',
        ].join('; '),
      }];
      const cleanup = setTimeout(() => {
        if (startedGeneration !== generation) {
          return;
        }
        sourceRelease();
        sprites = sprites.filter((sprite) => sprite.id !== motion.id);
      }, motion.durationMs + replayAnimationPhaseGapMs);
      timers.push(cleanup);
    }, motion.startMs);
    timers.push(timer);
  }

  function startHandPlay(motion: CardMotion, startedGeneration: number) {
    if (motion.sprite.kind !== 'card') {
      return;
    }
    const card = motion.sprite.card;
    const player = motion.player;
    const snapshot = handSnapshots.get(player);
    const target = resolveFirst([motion.to, ...(motion.toFallbacks ?? [])]);
    if (!target) {
      return;
    }
    const serial = motion.from.kind === 'hand-slot' ? motion.from.serial : undefined;
    // A discard recovery (Night Stretcher) reuses this flight but lifts from the
    // discard pile instead of a hand card — resolve the pile as its source rect.
    const sourceRect = motion.from.kind === 'discard'
      ? (resolveAnchor(motion.from)?.element.getBoundingClientRect() ?? null)
      : handSourceRect(player, serial, snapshot);
    const visualTarget = cardVisual(target.resolved.element);
    const targetRect = visualTarget.getBoundingClientRect();
    if (!sourceRect || sourceRect.width <= 0 || targetRect.width <= 0 || targetRect.height <= 0) {
      return;
    }

    const startQuad = snapshot?.topHand ? rotatedRectQuad(sourceRect) : rectQuad(sourceRect);
    const startTransform = cssMatrix3dForQuad(sourceRect.width, sourceRect.height, startQuad);
    const endTransform = cssMatrix3dForQuad(sourceRect.width, sourceRect.height, viewportQuad(visualTarget));
    if (!startTransform || !endTransform) {
      return;
    }

    const motionReleases: ReleaseClaim[] = [];
    if (motion.hideResolvedTarget) {
      const mode = hideModeForTarget(target.resolved.element, target.anchor);
      if (mode) {
        motionReleases.push(animVisibility.claim(target.resolved.element, mode));
      }
    }
    if (motion.evolve) {
      // NOTE: do NOT claim/hide the destination slot here. The evolved card flies
      // ONTO its pre-evolution (a stack), so the base must stay visible under the
      // descending sprite — hiding it from flight-start made the pre-evolution
      // vanish at the evolve start. The end-of-flight seam (evolved card not yet
      // decoded) is bridged by HOLDING the sprite over the slot until the card
      // paints (startEvolveHold), which covers it without hiding the base.
      motionReleases.push(applyTargetEffect(target.resolved.element, 'data-hand-evolve-animation-active', {
        '--hand-evolve-delay': `${motion.startMs}ms`,
        '--hand-evolve-move-ms': `${evolveMoveMs}ms`,
        '--hand-evolve-visible-ms': `${evolveVisibleMs}ms`,
      }));
    }
    // Evolve claims are owned by the hold (they must survive the scope boundary);
    // everything else releases on the normal per-scope schedule via endScope.
    if (!motion.evolve) {
      releases.push(...motionReleases);
    }

    const moveMs = motion.evolve ? evolveMoveMs : handPlayMoveMs;
    const visibleMs = motion.evolve ? evolveVisibleMs : moveMs;
    sprites = [...sprites, {
      id: motion.id,
      style: 'hand-play',
      card,
      reveal: false,
      concealed: false,
      topHand: false,
      direct: false,
      evolve: motion.evolve ?? false,
      css: [
        `width: ${sourceRect.width.toFixed(1)}px`,
        `height: ${sourceRect.height.toFixed(1)}px`,
        `--hand-play-start-transform: ${startTransform}`,
        `--hand-play-end-transform: ${endTransform}`,
        `--hand-play-delay: ${motion.startMs}ms`,
        `--hand-play-duration: ${moveMs}ms`,
        `--hand-evolve-visible-duration: ${evolveVisibleMs}ms`,
      ].join('; '),
    }];

    // Pile destinations only show the landed card when the next view advances
    // (a replay phase, or the next live step), so the sprite holds at its final
    // position until the scope ends instead of releasing on a timer — the same
    // hold-to-boundary handoff in both modes.
    const holdUntilScopeEnd = target.anchor.kind === 'discard' || target.anchor.kind === 'playZone';
    if (holdUntilScopeEnd) {
      return;
    }
    if (motion.evolve) {
      startEvolveHold(motion, target.resolved.element, motionReleases);
      return;
    }
    const timer = setTimeout(() => {
      if (startedGeneration !== generation) {
        return;
      }
      for (const release of motionReleases) {
        release();
      }
      sprites = sprites.filter((sprite) => sprite.id !== motion.id);
    }, motion.startMs + visibleMs + 24);
    timers.push(timer);
  }

  // Hold the evolve sprite + its destination claim past the scope boundary and
  // release them only once the evolved card element has rendered AND its art has
  // decoded (or a bounded safety fires). Fixes the base-card blink: endScope used
  // to clear the sprite the instant the next view landed, exposing the
  // not-yet-painted evolved card (see-through to its pre-evolution).
  function startEvolveHold(motion: CardMotion, slotElement: HTMLElement, motionReleases: ReleaseClaim[]) {
    const card = motion.sprite.kind === 'card' ? motion.sprite.card : undefined;
    const serial = card?.serial;
    const cardId = card?.id;
    let done = false;
    let poll: ReturnType<typeof setInterval> | undefined;
    let pollStart: ReturnType<typeof setTimeout>;
    let safety: ReturnType<typeof setTimeout>;
    const finish = () => {
      if (done) {
        return;
      }
      done = true;
      clearTimeout(pollStart);
      clearTimeout(safety);
      if (poll !== undefined) {
        clearInterval(poll);
      }
      for (const release of motionReleases) {
        release();
      }
      sprites = sprites.filter((sprite) => sprite.id !== motion.id);
      evolveHolds.delete(motion.id);
    };
    evolveHolds.set(motion.id, finish);
    const destinationReady = (): boolean => {
      for (const tile of slotElement.querySelectorAll('.card-tile')) {
        const matches = serial !== undefined
          ? tile.getAttribute('data-card-serial') === String(serial)
          : tile.getAttribute('data-card-id') === String(cardId);
        if (!matches) {
          continue;
        }
        const img = tile.querySelector('img');
        // A text-only card (no <img>) is ready as soon as its tile exists.
        return !img || (img.complete && img.naturalWidth > 0);
      }
      return false;
    };
    // Let the full evolve animation (flight + settle flair, evolveVisibleMs) play
    // before polling, so a cache-warm evolved card releases on the same beat it
    // used to — the hold only EXTENDS past that when the art hasn't painted yet,
    // never shortens the flourish.
    pollStart = setTimeout(() => {
      if (destinationReady()) {
        finish();
        return;
      }
      poll = setInterval(() => {
        if (destinationReady()) {
          finish();
        }
      }, evolveReadyPollMs);
    }, motion.startMs + evolveVisibleMs);
    safety = setTimeout(finish, motion.startMs + evolveVisibleMs + maxEvolveHoldMs);
  }

  function startAttachUnder(effect: TargetEffect, startedGeneration: number) {
    void startedGeneration;
    const target = resolveAnchor(effect.anchor);
    if (!target || effect.sourceSerial === undefined) {
      return;
    }
    const snapshot = handSnapshots.get(effect.player);
    const source = snapshot?.cards.get(effect.sourceSerial)
      ?? liveHandCardSnapshot(effect.player, effect.sourceSerial);
    if (!source) {
      return;
    }
    const targetRect = cardVisual(target.element).getBoundingClientRect();
    if (targetRect.width <= 0 || targetRect.height <= 0) {
      return;
    }
    const sourceCenter = centerOf(source.frameRect);
    const targetCenter = centerOf(targetRect);
    const startX = clamp((sourceCenter.x - targetCenter.x) / targetRect.width, -0.72, 0.72);
    const startY = clamp((sourceCenter.y - targetCenter.y) / targetRect.height, -0.82, 0.82);
    const release = applyTargetEffect(target.element, 'data-hand-attach-animation-active', {
      '--hand-attach-card-image': cssAssetUrl(cardFaceImageUrl(effect.card) ?? ''),
      '--hand-attach-start-x': `${(startX * 100).toFixed(1)}%`,
      '--hand-attach-start-y': `${(startY * 100).toFixed(1)}%`,
      '--hand-attach-start-rotation': target.element.closest('.top-active-slot, .bench-row.opponent') ? '180deg' : '0deg',
      '--hand-attach-delay': `${effect.startMs}ms`,
    });
    releases.push(release);
    const timer = setTimeout(release, effect.startMs + effect.durationMs + 24);
    timers.push(timer);
  }

  function startDraws(motions: CardMotion[], startedGeneration: number) {
    const byPlayer = groupMotionsByPlayer(motions);
    for (const [player, playerMotions] of byPlayer) {
      const deck = resolveAnchor({ kind: 'deck', player });
      const hand = resolveAnchor({ kind: 'hand', player });
      if (!deck || !hand) {
        continue;
      }
      const deckRect = deck.geometry.getBoundingClientRect();
      const handRect = hand.element.getBoundingClientRect();
      if (deckRect.width <= 0 || handRect.width <= 0) {
        continue;
      }
      const concealed = hand.element.classList.contains('concealed');
      const startCenter = centerOf(deckRect);
      const spriteWidth = deckRect.width;
      const spriteHeight = spriteWidth * cardRatio;
      const mulligan = playerMotions.some((motion) => motion.mulligan);
      const slots = handSlots(player);
      const claimed = new Map<HTMLElement, ReleaseClaim>();
      const claim = (element: HTMLElement) => {
        if (!claimed.has(element)) {
          const release = animVisibility.claim(element, 'element');
          claimed.set(element, release);
          releases.push(release);
        }
        return claimed.get(element)!;
      };
      if (mulligan) {
        for (const slot of slots) {
          claim(slot);
        }
      }

      let maxDelay = 0;
      playerMotions.forEach((motion, index) => {
        const target = resolveAnchor(motion.to)?.element;
        if (target && !mulligan) {
          claim(target);
        }
        const targetRect = target?.getBoundingClientRect() ?? fallbackHandTarget(handRect, index, playerMotions.length);
        const targetCenter = centerOf(targetRect);
        const card = motion.sprite.kind === 'card' ? motion.sprite.card : undefined;
        const reveal = !concealed && card?.id !== undefined;
        maxDelay = Math.max(maxDelay, motion.startMs);
        sprites = [...sprites, {
          id: motion.id,
          style: 'deck-draw',
          card,
          reveal,
          concealed,
          topHand: false,
          direct: false,
          evolve: false,
          css: [
            `left: ${startCenter.x - spriteWidth / 2}px`,
            `top: ${startCenter.y - spriteHeight / 2}px`,
            `width: ${spriteWidth}px`,
            `height: ${spriteHeight}px`,
            `--draw-x: ${(targetCenter.x - startCenter.x).toFixed(1)}px`,
            `--draw-y: ${(targetCenter.y - startCenter.y).toFixed(1)}px`,
            `--draw-scale: ${clamp(targetRect.width / spriteWidth, 0.5, 1.5).toFixed(3)}`,
            `--draw-mid-scale: ${(1 + (clamp(targetRect.width / spriteWidth, 0.5, 1.5) - 1) * 0.45).toFixed(3)}`,
            `--draw-arc-y: ${player === 0 ? -18 : 18}px`,
            `--draw-rotation: ${player === 0 ? -3 : 3}deg`,
            `--draw-delay: ${motion.startMs}ms`,
            `z-index: ${index + 1}`,
          ].join('; '),
        }];
        if (target) {
          const timer = setTimeout(() => {
            if (startedGeneration !== generation) {
              return;
            }
            claimed.get(target)?.();
          }, motion.startMs + drawHandoffMs);
          timers.push(timer);
        }
      });

      const spriteIds = new Set(playerMotions.map((motion) => motion.id));
      const timer = setTimeout(() => {
        if (startedGeneration !== generation) {
          return;
        }
        for (const release of claimed.values()) {
          release();
        }
        sprites = sprites.filter((sprite) => !spriteIds.has(sprite.id));
      }, maxDelay + drawMoveMs + 120);
      timers.push(timer);
    }
  }

  function startResets(motions: CardMotion[], startedGeneration: number) {
    if (!motions.length) {
      return;
    }
    const started: CardMotion[] = [];
    const sourceReleases: ReleaseClaim[] = [];
    for (const motion of motions) {
      const player = motion.player;
      const serial = motion.from.kind === 'hand-slot' ? motion.from.serial : undefined;
      const snapshot = handSnapshots.get(player);
      const entry = serial !== undefined ? snapshot?.cards.get(serial) : undefined;
      const deck = resolveAnchor({ kind: 'deck', player });
      if (!snapshot || !entry || !deck) {
        continue;
      }
      const deckRect = deck.geometry.getBoundingClientRect();
      if (deckRect.width <= 0 || entry.visualRect.width <= 0) {
        continue;
      }
      const deckCenter = centerOf(deckRect);
      const cardCenter = centerOf(entry.visualRect);
      const release = animVisibility.claim(entry.frameElement, 'element');
      releases.push(release);
      sourceReleases.push(release);
      started.push(motion);
      const card = motion.sprite.kind === 'card' ? motion.sprite.card : undefined;
      sprites = [...sprites, {
        id: motion.id,
        style: 'hand-reset',
        card,
        reveal: false,
        concealed: snapshot.concealed,
        topHand: snapshot.topHand,
        direct: false,
        evolve: false,
        css: [
          `left: ${entry.visualRect.left}px`,
          `top: ${entry.visualRect.top}px`,
          `width: ${entry.visualRect.width}px`,
          `height: ${entry.visualRect.height}px`,
          `--hand-reset-move-x: ${(deckCenter.x - cardCenter.x).toFixed(1)}px`,
          `--hand-reset-move-y: ${(deckCenter.y - cardCenter.y).toFixed(1)}px`,
          `--hand-reset-scale: ${clamp(deckRect.width / entry.visualRect.width, 0.5, 1.2).toFixed(3)}`,
          `--hand-reset-delay: ${motion.startMs}ms`,
          `--hand-reset-move-ms: ${resetMoveMs}ms`,
        ].join('; '),
      }];
    }
    if (!started.length) {
      return;
    }
    const spriteIds = new Set(started.map((motion) => motion.id));
    const timer = setTimeout(() => {
      if (startedGeneration !== generation) {
        return;
      }
      // Release the source frame claims now the sprites have landed. Both modes
      // now remove the reset cards from the phase view at display time (replay
      // via the HandToDeck source-view branch), so this releases claims on
      // already-departed elements — it never unhides a still-mounted old hand at
      // the next phase boundary, which was the replay-only shuffle flicker (the
      // top of the pre-shuffle hand flashing back before the draws).
      for (const release of sourceReleases) {
        release();
      }
      sprites = sprites.filter((sprite) => !spriteIds.has(sprite.id));
    }, Math.max(...started.map((motion) => motion.startMs)) + resetMoveMs + 120);
    timers.push(timer);
  }

  function startPrizeTakes(motions: CardMotion[], startedGeneration: number) {
    const byPlayer = groupMotionsByPlayer(motions);
    for (const [player, playerMotions] of byPlayer) {
      const hand = resolveAnchor({ kind: 'hand', player });
      if (!hand) {
        continue;
      }
      const handRect = hand.element.getBoundingClientRect();
      if (handRect.width <= 0 || handRect.height <= 0) {
        continue;
      }
      const count = playerMotions[0]?.takeCount ?? playerMotions.length;
      const sourceRects = prizeSourceRects(player, count);
      if (!sourceRects.length) {
        continue;
      }
      const concealed = hand.element.classList.contains('concealed');
      const layout = revealLayout(count);
      const targetReleases: ReleaseClaim[] = [];
      // Hide the taken prize slots the moment their sprites depart, so the
      // face-down card doesn't stay painted in place while the sprite flies —
      // the count decrements as part of the motion, not as a cleanup snap after.
      // These SOURCE-slot claims release ONLY via endScope (releases[]), NOT the
      // sprite-cleanup timer (targetReleases[]): the timer fires at prizeTakeMs,
      // but the settled view's prizesLeft decrement (which removes the slot from
      // the DOM) lands a phase-gap later at scope end. Releasing on the timer
      // un-hides the taken slot while it's still present — the residual re-show
      // flicker. Gate on the destination view landing, not the animation clock.
      for (const slot of prizeSourceSlots(player, count)) {
        releases.push(animVisibility.claim(slot, 'element'));
      }
      let maxEndMs = 0;

      playerMotions.forEach((motion) => {
        const index = motion.takeIndex ?? 0;
        const sourceRect = sourceRects[index] ?? sourceRects[sourceRects.length - 1];
        if (!sourceRect || sourceRect.width <= 0) {
          return;
        }
        const sourceCenter = centerOf(sourceRect);
        const revealTarget = layout.target(index);
        const targetElement = resolveAnchor(motion.to)?.element;
        const fallback = fallbackHandTarget(handRect, index, count);
        // Land at the hand's SETTLED card width (a settled sibling), taking the
        // POSITION from the incoming slot — the same reveal-to-hand landing the
        // searched-card reveal uses (settledHandLandingWidth). Measuring the
        // incoming slot's own width lands the sprite at a transient size that
        // then snaps to the real hand-card width.
        const targetCenter = centerOf(handCardVisualRect(targetElement) ?? fallback);
        const landingWidth = settledHandLandingWidth(handSlots(player), targetElement, fallback.width);
        const card = motion.sprite.kind === 'card' ? motion.sprite.card : undefined;
        const reveal = !concealed && card?.id !== undefined;
        // The source-slot claim + sprite must hold until the phase's settled
        // post-take view lands (the prize-count decrement), which the stepper
        // paces to the canonical prizeTakeMs. A concealed take's 520ms
        // (prizeTakeDirectMs) is only the visual motion speed (the .direct CSS
        // class); scheduling the claim release on it would repaint the taken
        // prize back into its face-down slot for the rest of the phase.
        maxEndMs = Math.max(maxEndMs, motion.startMs + actionAnimationTiming.prizeTakeMs);
        if (targetElement) {
          const release = animVisibility.claim(targetElement, 'element');
          releases.push(release);
          targetReleases.push(release);
        }
        sprites = [...sprites, {
          id: motion.id,
          style: 'prize-take',
          card: reveal && card ? { ...card, playerIndex: player } : card,
          reveal,
          concealed,
          topHand: false,
          direct: !reveal,
          evolve: false,
          css: [
            `left: ${sourceCenter.x - layout.cardWidth / 2}px`,
            `top: ${sourceCenter.y - layout.cardHeight / 2}px`,
            `width: ${layout.cardWidth}px`,
            `height: ${layout.cardHeight}px`,
            `--prize-source-scale: ${clamp(sourceRect.width / layout.cardWidth, 0.18, 0.85).toFixed(3)}`,
            `--prize-reveal-x: ${(revealTarget.x - sourceCenter.x).toFixed(1)}px`,
            `--prize-reveal-y: ${(revealTarget.y - sourceCenter.y).toFixed(1)}px`,
            `--prize-take-x: ${(targetCenter.x - sourceCenter.x).toFixed(1)}px`,
            `--prize-take-y: ${(targetCenter.y - sourceCenter.y).toFixed(1)}px`,
            `--prize-take-scale: ${clamp(landingWidth / layout.cardWidth, 0.25, 1.15).toFixed(3)}`,
            `--prize-take-rotation: ${concealed ? 180 : 0}deg`,
            `--prize-take-flip: ${concealed ? 0 : 180}deg`,
            `--prize-reveal-rotation: ${revealTarget.rotation.toFixed(1)}deg`,
            '--prize-overlay-z: 0px',
            `--prize-take-delay: ${motion.startMs}ms`,
            `z-index: ${index + 1}`,
          ].join('; '),
        }];
      });

      const spriteIds = new Set(playerMotions.map((motion) => motion.id));
      const timer = setTimeout(() => {
        if (startedGeneration !== generation) {
          return;
        }
        for (const release of targetReleases) {
          release();
        }
        sprites = sprites.filter((sprite) => !spriteIds.has(sprite.id));
      }, maxEndMs + 20);
      timers.push(timer);
    }
  }

  function startPrizePlace(effect: TargetEffect, startedGeneration: number) {
    void startedGeneration;
    const target = resolveAnchor(effect.anchor);
    const deck = resolveAnchor({ kind: 'deck', player: effect.player });
    const plane = boardPlane();
    if (!target || !deck || !plane) {
      return;
    }
    const deckRect = deck.geometry.getBoundingClientRect();
    if (deckRect.width <= 0 || deckRect.height <= 0) {
      return;
    }
    const mapper = planeMapper(plane);
    const deckCenter = mapper.pointFromViewport(centerOf(deckRect));
    const targetCenter = mapper.pointFromViewport(centerOf(target.element.getBoundingClientRect()));
    const isTopSide = !!target.element.closest('.top-piles');
    const startX = deckCenter.x - targetCenter.x;
    const startY = deckCenter.y - targetCenter.y;
    const release = applyTargetEffect(target.element, 'data-prize-animation-active', {
      '--prize-start-x': `${(isTopSide ? -startX : startX).toFixed(1)}px`,
      '--prize-start-y': `${(isTopSide ? -startY : startY).toFixed(1)}px`,
      '--prize-delay': `${effect.startMs}ms`,
      '--prize-z-index': `${effect.order}`,
    });
    releases.push(release);
    const timer = setTimeout(release, effect.startMs + prizePlaceHandoffMs);
    timers.push(timer);
  }

  function endScope() {
    generation += 1;
    for (const timer of timers) {
      clearTimeout(timer);
    }
    timers.length = 0;
    for (const release of releases) {
      release();
    }
    releases.length = 0;
    // Keep evolve-hold sprites alive across the boundary; they own their own
    // claims and timers and release on the destination-ready handoff, so the
    // evolved card's not-yet-decoded art never flashes its pre-evolution.
    sprites = sprites.filter((sprite) => evolveHolds.has(sprite.id));
  }

  // Scrub purges everything endScope PRESERVES — including evolve holds. A hold
  // exists to keep a not-yet-decoded evolved card from flashing its base; during a
  // rapid scrub nobody sees that paint, so the hold is pure liability (a sprite
  // that outlives its scope, drained only by a safety timer — exactly what piles
  // up as fast-scrub artifacts). finish() releases each hold's claim, clears its
  // timers, and drops its sprite; endScope() then clears the rest. Idempotent.
  function purgeForScrub() {
    for (const finish of [...evolveHolds.values()]) {
      finish();
    }
    endScope();
    if (sprites.length) {
      sprites = [];
    }
  }

  function resolveFirst(anchors: Anchor[]): { anchor: Anchor; resolved: ResolvedAnchor } | null {
    for (const anchor of anchors) {
      const resolved = resolveAnchor(anchor);
      if (resolved) {
        return { anchor, resolved };
      }
    }
    return null;
  }

  function hideModeForTarget(element: HTMLElement, anchor: Anchor): HideMode | null {
    // A discard landing may resolve to the pile's current top card while the
    // arriving card is deferred; hiding that unrelated card empties the pile.
    if (anchor.kind === 'discard' && !anchor.exact) {
      return null;
    }
    if (element.classList.contains('card-tile')) {
      return 'element';
    }
    if (element.classList.contains('board-slot') || element.dataset.pokemonSerial !== undefined) {
      return 'contents';
    }
    if (anchor.kind === 'playZone' || anchor.kind === 'stadium') {
      return 'contents';
    }
    return null;
  }

  function handSourceRect(player: number, serial: number | undefined, snapshot: HandSnapshot | undefined): DOMRect | null {
    if (serial !== undefined) {
      const snapshotRect = snapshot?.cards.get(serial)?.frameRect;
      if (snapshotRect) {
        return snapshotRect;
      }
      const live = liveHandCardSnapshot(player, serial);
      if (live) {
        return live.frameRect;
      }
    }
    const handRect = snapshot?.handRect ?? resolveAnchor({ kind: 'hand', player })?.element.getBoundingClientRect();
    if (!handRect || handRect.width <= 0) {
      return null;
    }
    const firstCard = snapshot?.cards.values().next().value;
    const width = firstCard?.frameRect.width ?? Math.min(handRect.width * 0.16, handRect.height / cardRatio);
    const height = firstCard?.frameRect.height ?? width * cardRatio;
    return new DOMRect(
      handRect.left + handRect.width / 2 - width / 2,
      handRect.top + handRect.height / 2 - height / 2,
      width,
      height,
    );
  }

  function liveHandCardSnapshot(player: number, serial: number): HandCardSnapshot | null {
    const frame = handSlots(player).find((slot) => Number(slot.dataset.cardSerial) === serial);
    if (!frame) {
      return null;
    }
    const visual = frame.querySelector('.card-tile');
    return {
      frameRect: frame.getBoundingClientRect(),
      visualRect: visual instanceof HTMLElement ? visual.getBoundingClientRect() : frame.getBoundingClientRect(),
      frameElement: frame,
    };
  }

  function prizeSlotElements(player: number): HTMLElement[] {
    return [...document.querySelectorAll(`[data-card-anchor^="player:${player}:prize:"]`)]
      .filter((element): element is HTMLElement => element instanceof HTMLElement && !element.closest('[data-anim-layer]'))
      .sort((a, b) => prizeIndex(a) - prizeIndex(b));
  }

  // The prize slots the taken prizes depart from. The pre-state view holds the
  // prizes about to be taken, so they are present in the DOM — the taken ones
  // are the last `count` slots (prizes are face-down and identical, so which is
  // immaterial). Returned so the take can both originate the sprite at the real
  // slot AND hide that slot while the sprite is in flight.
  function prizeSourceSlots(player: number, count: number): HTMLElement[] {
    const slots = prizeSlotElements(player);
    return slots.length >= count ? slots.slice(slots.length - count) : slots;
  }

  function prizeSourceRects(player: number, count: number): DOMRect[] {
    const sourceSlots = prizeSourceSlots(player, count);
    if (sourceSlots.length === count) {
      return sourceSlots.map((slot) => slot.getBoundingClientRect());
    }
    // Fallback: some taken prizes already left the DOM — extrapolate positions.
    const slots = prizeSlotElements(player);
    const grid = prizeGridForPlayer(player);
    if (!slots.length && !grid) {
      return [];
    }
    const firstMissingIndex = slots.length;
    return Array.from({ length: count }, (_, index) => prizeRectForIndex(slots, firstMissingIndex + index, grid));
  }

  function prizeIndex(element: HTMLElement): number {
    const value = Number((element.dataset.cardAnchor ?? '').split(':').at(-1));
    return Number.isFinite(value) ? value : 0;
  }

  function prizeRectForIndex(slots: HTMLElement[], index: number, grid: HTMLElement | null): DOMRect {
    const existing = slots.find((slot) => prizeIndex(slot) === index);
    if (existing) {
      return existing.getBoundingClientRect();
    }
    const firstRect = slots[0]?.getBoundingClientRect() ?? prizeGridCardRect(grid);
    const row = Math.floor(index / 2);
    const col = index % 2;
    const firstIndex = slots[0] ? prizeIndex(slots[0]) : 0;
    const firstRow = Math.floor(firstIndex / 2);
    const firstCol = firstIndex % 2;
    return new DOMRect(
      firstRect.left + (col - firstCol) * firstRect.width * 0.98,
      firstRect.top + (row - firstRow) * firstRect.width * 0.71,
      firstRect.width,
      firstRect.height,
    );
  }

  function prizeGridForPlayer(player: number): HTMLElement | null {
    const deckAnchor = document.querySelector(`[data-card-anchor="player:${player}:deck"]`);
    const grid = deckAnchor?.closest('.field-piles')?.querySelector('.prize-grid');
    return grid instanceof HTMLElement ? grid : null;
  }

  function prizeGridCardRect(grid: HTMLElement | null): DOMRect {
    const gridRect = grid?.getBoundingClientRect();
    if (!gridRect || gridRect.width <= 0 || gridRect.height <= 0) {
      return new DOMRect(0, 0, 0, 0);
    }
    const width = gridRect.width / 1.98;
    return new DOMRect(gridRect.left, gridRect.top, width, width * cardRatio);
  }

  function boardPlane(): HTMLElement | null {
    const plane = document.querySelector('.game-board-plane');
    return plane instanceof HTMLElement ? plane : null;
  }

  function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
  }

  let handPlaySprites = $derived(sprites.filter((sprite) => sprite.style === 'hand-play'));
  let drawSprites = $derived(sprites.filter((sprite) => sprite.style === 'deck-draw'));
  let resetSprites = $derived(sprites.filter((sprite) => sprite.style === 'hand-reset'));
  let prizeTakeSprites = $derived(sprites.filter((sprite) => sprite.style === 'prize-take'));
  let attackSprites = $derived(sprites.filter((sprite) => sprite.style === 'damage-float' || sprite.style === 'knock-out'));
  let coinSprites = $derived(sprites.filter((sprite) => sprite.style === 'coin-flip'));
</script>

<span class="viewport-anim-layer" data-anim-layer aria-hidden="true">
  <span class="fixed-sublayer attack-sublayer">
    {#each attackSprites as sprite (sprite.id)}
      {#if sprite.style === 'damage-float'}
        <span class="attack-damage-number" style={sprite.css}>{sprite.text}</span>
      {:else}
        <span class="attack-ko-card" style={sprite.css}>
          <span class="attack-ko-card-frame">
            <CardTile card={sprite.card} compact />
          </span>
        </span>
      {/if}
    {/each}
  </span>

  <span class="fixed-sublayer coin-sublayer">
    {#each coinSprites as sprite (sprite.id)}
      <span class="coin-flip-sprite" style={sprite.css}>
        <span class="coin-flip-coin">
          <span class="coin-face coin-heads">H</span>
          <span class="coin-face coin-tails">T</span>
        </span>
        <span class="coin-result-caption">{sprite.text}</span>
      </span>
    {/each}
  </span>

  <span class="fixed-sublayer draw-sublayer">
    {#each drawSprites as sprite (sprite.id)}
      <span class="draw-card" class:revealed={sprite.reveal} style={sprite.css}>
        <span class="draw-card-inner">
          <span class="flip-face flip-back" style={cardBackCssVar()}></span>
          <span class="flip-face flip-front" class:unrevealed={!sprite.reveal}>
            <CardTile card={sprite.card} compact />
          </span>
        </span>
      </span>
    {/each}
  </span>

  <span class="fixed-sublayer prize-take-sublayer">
    {#each prizeTakeSprites as sprite (sprite.id)}
      <span class="prize-take-card" class:direct={sprite.direct} class:revealing={!sprite.direct} class:revealed={sprite.reveal} style={sprite.css}>
        <span class="prize-take-card-inner">
          <span class="flip-face prize-back" style={cardBackCssVar()}></span>
          <span class="flip-face prize-front" class:unrevealed={!sprite.reveal}>
            <CardTile card={sprite.card} compact />
          </span>
        </span>
      </span>
    {/each}
  </span>

  <span class="fixed-sublayer reset-sublayer">
    {#each resetSprites as sprite (sprite.id)}
      <span class="hand-reset-card" class:top-hand={sprite.topHand} style={sprite.css}>
        <span class="hand-reset-card-motion" class:revealed={!sprite.concealed}>
          <span class="hand-reset-card-orientation">
            <span class="hand-reset-card-inner">
              <span class="flip-face reset-back" style={cardBackCssVar()}></span>
              {#if !sprite.concealed}
                <span class="flip-face reset-front">
                  <CardTile card={sprite.card} compact />
                </span>
              {/if}
            </span>
          </span>
        </span>
      </span>
    {/each}
  </span>

  <span class="fixed-sublayer hand-play-sublayer">
    {#each handPlaySprites as sprite (sprite.id)}
      <span class="hand-play-card" class:evolving={sprite.evolve} style={sprite.css}>
        <span class="hand-play-card-body">
          <CardTile card={sprite.card} compact />
        </span>
      </span>
    {/each}
  </span>
</span>

<style>
  .viewport-anim-layer {
    display: contents;
  }

  .fixed-sublayer {
    position: fixed;
    inset: 0;
    display: block;
    overflow: visible;
    pointer-events: none;
    transform-style: preserve-3d;
  }

  .attack-sublayer {
    z-index: 30;
  }

  .coin-sublayer {
    z-index: 44;
    perspective: 900px;
  }

  .draw-sublayer {
    z-index: 32;
  }

  .prize-take-sublayer {
    z-index: 41;
    perspective: 1200px;
  }

  .reset-sublayer {
    z-index: 76;
  }

  .hand-play-sublayer {
    z-index: 80;
    perspective: 1200px;
  }

  /* Generic hide-contents for non-board-slot containers (stadium buttons,
     play-zone frames); board slots have dedicated rules in the board layer. */
  :global([data-anim-hidden='contents']:not(.board-slot) > *) {
    visibility: hidden;
  }

  .flip-face {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    overflow: hidden;
    border-radius: inherit;
    box-shadow:
      0 10px 22px rgba(23, 30, 38, 0.22),
      0 0 0 1px rgba(18, 21, 26, 0.18);
    backface-visibility: hidden;
  }

  .flip-face :global(.card-tile) {
    width: 100%;
    height: 100%;
  }

  .flip-back,
  .reset-back,
  .prize-back {
    background:
      var(--card-back-image, var(--cardback-shade)),
      linear-gradient(135deg, rgba(255, 255, 255, 0.1), transparent 28%),
      repeating-linear-gradient(45deg, rgba(255, 255, 255, 0.08) 0 6px, transparent 6px 12px),
      linear-gradient(145deg, #203654, #111a2c);
    background-size: cover, auto, auto, auto;
    background-position: center;
  }

  /* --- coin flip --- */

  .coin-flip-sprite {
    position: fixed;
    display: grid;
    justify-items: center;
    width: var(--coin-size, 64px);
    height: calc(var(--coin-size, 64px) + 28px);
    pointer-events: none;
    transform: translate(-50%, -50%);
    transform-style: preserve-3d;
  }

  .coin-flip-coin {
    position: relative;
    display: block;
    width: var(--coin-size, 64px);
    height: var(--coin-size, 64px);
    border-radius: 50%;
    transform-style: preserve-3d;
    transform-origin: center;
    animation: coin-flip var(--coin-duration, 920ms) cubic-bezier(0.16, 0.84, 0.26, 1) var(--coin-delay) both;
    will-change: transform, opacity;
  }

  .coin-face {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    box-sizing: border-box;
    border-radius: 50%;
    backface-visibility: hidden;
    box-shadow:
      0 14px 26px rgba(15, 23, 42, 0.28),
      0 0 0 1px rgba(255, 255, 255, 0.48) inset,
      0 0 0 2px rgba(15, 23, 42, 0.22);
  }

  .coin-heads {
    transform: translateZ(1px);
    border: 2px solid rgba(255, 255, 255, 0.64);
    background:
      radial-gradient(circle at 34% 26%, rgba(255, 255, 255, 0.96) 0 8%, transparent 9%),
      radial-gradient(circle at 38% 30%, #fff7ad 0 0, #facc15 38%, #d97706 72%, #92400e 100%);
  }

  .coin-heads {
    color: rgba(120, 53, 15, 0.92);
    font-size: calc(var(--coin-size, 64px) * 0.46);
    font-weight: 950;
    line-height: 1;
    text-shadow: 0 2px 4px rgba(255, 255, 255, 0.4);
  }

  .coin-tails {
    transform: rotateX(180deg) translateZ(1px);
    border: 2px solid rgba(226, 232, 240, 0.5);
    background:
      radial-gradient(circle at 34% 26%, rgba(255, 255, 255, 0.36) 0 9%, transparent 10%),
      radial-gradient(circle at 50% 50%, #64748b 0 0, #334155 48%, #0f172a 100%);
    color: rgba(255, 255, 255, 0.92);
    font-size: calc(var(--coin-size, 64px) * 0.46);
    font-weight: 950;
    line-height: 1;
    text-shadow: 0 2px 6px rgba(15, 23, 42, 0.38);
  }

  .coin-result-caption {
    position: absolute;
    top: calc(var(--coin-size, 64px) + 7px);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 48px;
    height: 22px;
    padding: 0 9px;
    border-radius: 999px;
    background: rgba(17, 24, 39, 0.92);
    color: #fff;
    box-shadow: 0 8px 18px rgba(15, 23, 42, 0.28);
    font-size: 11px;
    font-weight: 900;
    line-height: 1;
    letter-spacing: 0;
    opacity: 0;
    transform: translateY(-2px) scale(0.94);
    animation: coin-result-caption var(--coin-duration, 920ms) ease-out var(--coin-delay) both;
  }

  @keyframes coin-flip {
    0% {
      opacity: 0;
      transform: translate3d(0, 18px, 0) scale(0.4) rotateX(0deg);
    }
    6% {
      opacity: 1;
      transform: translate3d(0, 8px, 0) scale(0.74) rotateX(180deg);
    }
    24% {
      opacity: 1;
      transform: translate3d(0, -34px, 0) scale(1) rotateX(720deg);
    }
    65% {
      opacity: 1;
      transform: translate3d(0, -10px, 0) scale(1) rotateX(var(--coin-end-rotation));
    }
    88% {
      opacity: 1;
      transform: translate3d(0, -10px, 0) scale(1) rotateX(var(--coin-end-rotation));
    }
    100% {
      opacity: 0;
      transform: translate3d(0, -18px, 0) scale(0.94) rotateX(var(--coin-end-rotation));
    }
  }

  @keyframes coin-result-caption {
    0%,
    64% {
      opacity: 0;
      transform: translateY(-2px) scale(0.94);
    }
    70%,
    88% {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
    100% {
      opacity: 0;
      transform: translateY(-4px) scale(0.98);
    }
  }

  /* --- deck draw --- */

  .draw-card {
    position: absolute;
    display: block;
    border-radius: 6px;
    pointer-events: none;
    transform-origin: center;
    transform-style: preserve-3d;
    animation: deck-draw-travel 320ms cubic-bezier(0.2, 0.82, 0.22, 1) var(--draw-delay) both;
    will-change: transform, opacity;
  }

  .draw-card-inner {
    position: absolute;
    inset: 0;
    display: block;
    border-radius: inherit;
    transform-style: preserve-3d;
    will-change: transform;
  }

  .draw-card.revealed .draw-card-inner {
    animation: deck-draw-flip 320ms ease-in-out var(--draw-delay) both;
  }

  .draw-card .flip-front {
    transform: rotateY(180deg);
    background: #f7f8fa;
  }

  .draw-card .flip-front.unrevealed {
    display: none;
  }

  @keyframes deck-draw-travel {
    0% {
      opacity: 0;
      transform: translate3d(0, 0, 0) scale(1) rotate(0deg);
    }
    1% {
      opacity: 1;
      transform: translate3d(0, 0, 0) scale(1) rotate(0deg);
    }
    48% {
      opacity: 1;
      transform:
        translate3d(calc(var(--draw-x) * 0.56), calc(var(--draw-y) * 0.56 + var(--draw-arc-y)), 0)
        scale(var(--draw-mid-scale))
        rotate(var(--draw-rotation));
    }
    88% {
      opacity: 1;
      transform: translate3d(var(--draw-x), var(--draw-y), 0) scale(var(--draw-scale)) rotate(0deg);
    }
    100% {
      opacity: 0;
      transform: translate3d(var(--draw-x), var(--draw-y), 0) scale(var(--draw-scale)) rotate(0deg);
    }
  }

  @keyframes deck-draw-flip {
    0% {
      transform: rotateY(0deg);
    }
    100% {
      transform: rotateY(180deg);
    }
  }

  /* --- prize take --- */

  .prize-take-card {
    position: absolute;
    display: block;
    border-radius: 9px;
    transform-origin: center;
    transform-style: preserve-3d;
    isolation: isolate;
    will-change: transform, opacity;
  }

  .prize-take-card.revealing {
    animation: prize-take-reveal 1180ms cubic-bezier(0.18, 0.86, 0.24, 1) var(--prize-take-delay) both;
  }

  .prize-take-card.direct {
    animation: prize-take-direct 520ms cubic-bezier(0.2, 0.82, 0.22, 1) var(--prize-take-delay) both;
  }

  .prize-take-card-inner {
    position: absolute;
    inset: 0;
    display: block;
    border-radius: inherit;
    transform-style: preserve-3d;
    will-change: transform;
  }

  .prize-take-card.revealed .prize-take-card-inner {
    animation: prize-take-flip 1180ms ease-in-out var(--prize-take-delay) both;
  }

  .prize-take-card .prize-back {
    transform: translateZ(0.2px);
  }

  .prize-take-card .prize-front {
    transform: rotateY(180deg) translateZ(0.2px);
    background: #f7f8fa;
  }

  .prize-take-card .prize-front.unrevealed {
    display: none;
  }

  @keyframes prize-take-reveal {
    0% {
      opacity: 0;
      transform:
        translate3d(0, 0, var(--prize-overlay-z))
        scale(var(--prize-source-scale))
        rotate(0deg);
    }
    2% {
      opacity: 1;
      transform:
        translate3d(0, 0, var(--prize-overlay-z))
        scale(var(--prize-source-scale))
        rotate(0deg);
    }
    42% {
      opacity: 1;
      transform:
        translate3d(var(--prize-reveal-x), var(--prize-reveal-y), var(--prize-overlay-z))
        scale(1)
        rotate(var(--prize-reveal-rotation));
    }
    68% {
      opacity: 1;
      transform:
        translate3d(var(--prize-reveal-x), var(--prize-reveal-y), var(--prize-overlay-z))
        scale(1)
        rotate(var(--prize-reveal-rotation));
    }
    96% {
      opacity: 1;
      transform:
        translate3d(var(--prize-take-x), var(--prize-take-y), var(--prize-overlay-z))
        scale(var(--prize-take-scale))
        rotate(var(--prize-take-rotation));
    }
    100% {
      opacity: 1;
      transform:
        translate3d(var(--prize-take-x), var(--prize-take-y), var(--prize-overlay-z))
        scale(var(--prize-take-scale))
        rotate(var(--prize-take-rotation));
    }
  }

  @keyframes prize-take-direct {
    0% {
      opacity: 0;
      transform:
        translate3d(0, 0, var(--prize-overlay-z))
        scale(var(--prize-source-scale))
        rotate(0deg);
    }
    1% {
      opacity: 1;
      transform:
        translate3d(0, 0, var(--prize-overlay-z))
        scale(var(--prize-source-scale))
        rotate(0deg);
    }
    88% {
      opacity: 1;
      transform:
        translate3d(var(--prize-take-x), var(--prize-take-y), var(--prize-overlay-z))
        scale(var(--prize-take-scale))
        rotate(var(--prize-take-rotation));
    }
    100% {
      opacity: 1;
      transform:
        translate3d(var(--prize-take-x), var(--prize-take-y), var(--prize-overlay-z))
        scale(var(--prize-take-scale))
        rotate(var(--prize-take-rotation));
    }
  }

  @keyframes prize-take-flip {
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
      transform: rotateY(var(--prize-take-flip));
    }
  }

  /* --- prize placement (target-owned) --- */

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
      var(--card-back-image, var(--cardback-shade)),
      linear-gradient(135deg, rgba(255, 255, 255, 0.1), transparent 28%),
      repeating-linear-gradient(45deg, rgba(255, 255, 255, 0.08) 0 6px, transparent 6px 12px),
      linear-gradient(145deg, #203654, #111a2c);
    background-size: cover, auto, auto, auto;
    background-position: center;
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

  /* --- hand reset --- */

  .hand-reset-card {
    position: absolute;
    display: block;
    border-radius: 6px;
    transform-origin: center;
    transform-style: preserve-3d;
    will-change: transform;
  }

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

  .hand-reset-card.top-hand .hand-reset-card-orientation {
    transform: rotate(180deg);
  }

  .hand-reset-card-motion.revealed .hand-reset-card-inner {
    animation: hand-reset-flip-to-back var(--hand-reset-move-ms) ease-in-out var(--hand-reset-delay) both;
  }

  .hand-reset-card .reset-front {
    background: #f7f8fa;
  }

  .hand-reset-card .reset-back {
    transform: rotateY(180deg);
  }

  .hand-reset-card-motion:not(.revealed) .reset-back {
    transform: rotateY(0deg);
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

  /* --- hand play / evolve --- */

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

  .hand-play-card-body :global(.card-tile) {
    width: 100%;
    height: 100%;
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

  /* --- attack / ability pulses --- */

  /* Announcing slots rise above sibling slots so the name bubble is never
     occluded by the active Pokemon. The bench rows and the active duel are
     sibling containers inside the board plane, so the container holding the
     announcing slot must rise as well. */
  :global(.board-slot[data-attack-announce-active='true']),
  :global(.board-slot[data-ability-announce-active='true']) {
    z-index: 30;
  }

  /* .bench-zone pins itself to z-index 1 (below .active-duel's 3) with the
     same specificity as a bare :has() rule, so name the class explicitly. */
  :global(.game-board-plane > .bench-zone:has([data-attack-announce-active='true'])),
  :global(.game-board-plane > .bench-zone:has([data-ability-announce-active='true'])) {
    z-index: 5;
  }

  :global(.board-slot[data-attack-announce-active='true']) {
    animation: attack-announcement-glow 520ms ease-out both;
  }

  :global(.board-slot[data-attack-announce-active='true']::after) {
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

  :global(.board-slot[data-ability-announce-active='true']),
  :global(.stadium-card[data-ability-announce-active='true']) {
    animation: ability-announcement-glow 560ms ease-out both;
  }

  :global(.stadium-card[data-ability-announce-active='true']::after) {
    content: var(--ability-name);
    position: absolute;
    left: 50%;
    top: -10px;
    z-index: 12;
    min-width: max-content;
    max-width: 220px;
    padding: 6px 10px;
    border: 1px solid rgba(186, 230, 253, 0.86);
    border-radius: 999px;
    background: rgba(8, 47, 73, 0.92);
    color: #ecfeff;
    box-shadow:
      0 10px 24px rgba(8, 47, 73, 0.28),
      0 0 0 5px rgba(14, 165, 233, 0.16);
    font-size: 12px;
    font-weight: 900;
    line-height: 1;
    text-align: center;
    transform: translate(-50%, -100%);
    animation: ability-name-pop 560ms ease-out both;
    pointer-events: none;
  }

  :global(.board-slot[data-ability-announce-active='true']::after) {
    content: var(--ability-name);
    position: absolute;
    left: 50%;
    top: -10px;
    z-index: 12;
    min-width: max-content;
    max-width: 220px;
    padding: 6px 10px;
    border: 1px solid rgba(186, 230, 253, 0.86);
    border-radius: 999px;
    background: rgba(8, 47, 73, 0.92);
    color: #ecfeff;
    box-shadow:
      0 10px 24px rgba(8, 47, 73, 0.28),
      0 0 0 5px rgba(14, 165, 233, 0.16);
    font-size: 12px;
    font-weight: 900;
    line-height: 1;
    text-align: center;
    transform: translate(-50%, -100%);
    animation: ability-name-pop 560ms ease-out both;
    pointer-events: none;
  }

  :global(.board-slot[data-attack-lunge-active='true']) {
    animation: attack-lunge var(--damage-visual-ms, 560ms) cubic-bezier(0.2, 0.82, 0.22, 1) both;
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

  .attack-ko-card-frame :global(.card-tile) {
    width: 100%;
    height: 100%;
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

  @keyframes ability-announcement-glow {
    0% {
      filter: drop-shadow(0 0 0 rgba(14, 165, 233, 0));
    }
    32% {
      filter:
        drop-shadow(0 0 10px rgba(14, 165, 233, 0.72))
        drop-shadow(0 0 22px rgba(34, 211, 238, 0.34));
    }
    100% {
      filter: drop-shadow(0 0 0 rgba(14, 165, 233, 0));
    }
  }

  @keyframes ability-name-pop {
    0% {
      opacity: 0;
      transform: translate(-50%, -88%) scale(0.92);
    }
    22% {
      opacity: 1;
      transform: translate(-50%, -118%) scale(1.04);
    }
    78% {
      opacity: 1;
      transform: translate(-50%, -112%) scale(1);
    }
    100% {
      opacity: 0;
      transform: translate(-50%, -124%) scale(0.98);
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

  /* --- attach / evolve target effects --- */

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
  :global([data-hand-evolve-animation-active='true'] > .pick-chips) {
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
    .draw-card,
    .draw-card.revealed .draw-card-inner,
    .prize-take-card.revealing,
    .prize-take-card.direct,
    .prize-take-card.revealed .prize-take-card-inner,
    .hand-reset-card-motion,
    .hand-reset-card-motion.revealed .hand-reset-card-inner,
    .hand-play-card,
    .hand-play-card.evolving .hand-play-card-body,
    .coin-flip-coin,
    .coin-result-caption,
    .attack-damage-number,
    .attack-ko-card,
    :global(.board-slot[data-attack-announce-active='true']),
    :global(.board-slot[data-ability-announce-active='true']),
    :global(.board-slot[data-attack-lunge-active='true']),
    :global([data-hand-attach-animation-active='true']::before),
    :global([data-hand-evolve-animation-active='true']::after) {
      animation: none;
    }
  }
</style>
