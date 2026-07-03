<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import CardTile from './CardTile.svelte';
  import { AnimationEventGate } from '../anim/gate';
  import { applyTargetEffect } from '../anim/effects';
  import { handSlots, resolveAnchor, type Anchor, type ResolvedAnchor } from '../anim/anchors';
  import { choreograph, type CardMotion, type TargetEffect } from '../anim/motions';
  import { animVisibility, type HideMode, type ReleaseClaim } from '../anim/visibility';
  import { cardBackCssVar, cardFaceImageUrl, cssAssetUrl } from '../game/cardAssets';
  import { replayAnimationPhaseGapMs } from '../game/replay';
  import { actionAnimationTiming } from '../cabt/actionAnimationSchedule';
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
    scopeKey?: string | number;
    replayMode?: boolean;
    players?: PlayerView[];
  };

  type Sprite = {
    id: string;
    style: CardMotion['style'];
    card?: CardView;
    reveal: boolean;
    concealed: boolean;
    topHand: boolean;
    direct: boolean;
    evolve: boolean;
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
  const drawMoveMs = actionAnimationTiming.deckDrawMs;
  const drawHandoffMs = Math.round(drawMoveMs * 0.88);
  const resetMoveMs = 360;
  const prizeTakeDirectMs = 520;
  const prizePlaceHandoffMs = 304;
  const cardRatio = 88 / 63;

  let {
    events = [],
    scopeKey = '',
    replayMode = false,
    players = [],
  }: Props = $props();

  const gate = new AnimationEventGate();
  const timers: ReturnType<typeof setTimeout>[] = [];
  const releases: ReleaseClaim[] = [];
  let sprites = $state<Sprite[]>([]);
  let reduceMotion = $state(false);
  let generation = 0;
  let handSnapshots = new Map<number, HandSnapshot>();

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

  $effect(() => {
    const { scopeChanged, batch } = gate.update(events, scopeKey, replayMode);
    if (scopeChanged && replayMode) {
      endScope();
    }
    if (!batch.length || reduceMotion) {
      return;
    }

    const { motions, effects } = choreograph(batch, players);
    const mine = motions.filter((motion) => motion.space === 'viewport');
    const startedGeneration = generation;

    for (const motion of mine.filter((motion) => motion.style === 'hand-play')) {
      startHandPlay(motion, startedGeneration);
    }
    startDraws(mine.filter((motion) => motion.style === 'deck-draw'), startedGeneration);
    startResets(mine.filter((motion) => motion.style === 'hand-reset'), startedGeneration);
    startPrizeTakes(mine.filter((motion) => motion.style === 'prize-take'), startedGeneration);
    for (const effect of effects) {
      if (effect.kind === 'attach-under') {
        startAttachUnder(effect, startedGeneration);
      } else {
        startPrizePlace(effect, startedGeneration);
      }
    }
  });

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
    const sourceRect = handSourceRect(player, serial, snapshot);
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

    if (motion.hideResolvedTarget) {
      const mode = hideModeForTarget(target.resolved.element, target.anchor);
      if (mode) {
        releases.push(animVisibility.claim(target.resolved.element, mode));
      }
    }
    if (motion.evolve) {
      releases.push(applyTargetEffect(target.resolved.element, 'data-hand-evolve-animation-active', {
        '--hand-evolve-delay': `${motion.startMs}ms`,
        '--hand-evolve-move-ms': `${evolveMoveMs}ms`,
        '--hand-evolve-visible-ms': `${evolveVisibleMs}ms`,
      }));
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

    const timer = setTimeout(() => {
      if (startedGeneration !== generation) {
        return;
      }
      sprites = sprites.filter((sprite) => sprite.id !== motion.id);
    }, motion.startMs + visibleMs + 24);
    timers.push(timer);
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
    const byPlayer = groupByPlayer(motions);
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
      releases.push(animVisibility.claim(entry.frameElement, 'element'));
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
      sprites = sprites.filter((sprite) => !spriteIds.has(sprite.id));
    }, Math.max(...started.map((motion) => motion.startMs)) + resetMoveMs + 120);
    timers.push(timer);
  }

  function startPrizeTakes(motions: CardMotion[], startedGeneration: number) {
    const byPlayer = groupByPlayer(motions);
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
        const targetRect = handCardVisualRect(targetElement) ?? fallbackHandTarget(handRect, index, count);
        const targetCenter = centerOf(targetRect);
        const card = motion.sprite.kind === 'card' ? motion.sprite.card : undefined;
        const reveal = !concealed && card?.id !== undefined;
        const durationMs = reveal ? actionAnimationTiming.prizeTakeMs : prizeTakeDirectMs;
        maxEndMs = Math.max(maxEndMs, motion.startMs + durationMs);
        if (targetElement) {
          releases.push(animVisibility.claim(targetElement, 'element'));
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
            `--prize-take-scale: ${clamp(targetRect.width / layout.cardWidth, 0.25, 1.15).toFixed(3)}`,
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
    sprites = [];
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

  function cardVisual(element: HTMLElement): HTMLElement {
    if (element.classList.contains('card-tile')) {
      return element;
    }
    const cardTile = element.querySelector('.card-tile');
    return cardTile instanceof HTMLElement ? cardTile : element;
  }

  function handCardVisualRect(element: HTMLElement | undefined): DOMRect | undefined {
    if (!element) {
      return undefined;
    }
    const rect = cardVisual(element).getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 ? rect : undefined;
  }

  function fallbackHandTarget(handRect: DOMRect, index: number, count: number): DOMRect {
    const width = Math.min(handRect.height / cardRatio, handRect.width / Math.max(1, count));
    const height = width * cardRatio;
    const step = Math.min(width * 0.82, handRect.width / Math.max(1, count));
    const centerX = handRect.left + handRect.width / 2 + (index - (count - 1) / 2) * step;
    const centerY = handRect.top + handRect.height / 2;
    return new DOMRect(centerX - width / 2, centerY - height / 2, width, height);
  }

  function prizeSourceRects(player: number, count: number): DOMRect[] {
    const slots = [...document.querySelectorAll(`[data-card-anchor^="player:${player}:prize:"]`)]
      .filter((element): element is HTMLElement => element instanceof HTMLElement && !element.closest('[data-anim-layer]'))
      .sort((a, b) => prizeIndex(a) - prizeIndex(b));
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
    const maxByHeight = revealBandHeight / (cardRatio * (rows + Math.max(0, rows - 1) * 0.08));
    const maxReadableWidth = Math.min(viewportWidth < 760 ? 174 : 252, availableWidth, maxByHeight);
    const countScale = count <= 1 ? 1 : count <= 2 ? 0.9 : count <= 4 ? 0.78 : count <= 6 ? 0.68 : 0.58;
    const desiredCardWidth = maxReadableWidth * countScale;
    const maxByWidth = availableWidth / (1 + spacingRatio * Math.max(0, columns - 1));
    const cardWidth = Math.max(minCardWidth, Math.min(maxReadableWidth, desiredCardWidth, maxByWidth));
    const cardHeight = cardWidth * cardRatio;
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

  function boardPlane(): HTMLElement | null {
    const plane = document.querySelector('.game-board-plane');
    return plane instanceof HTMLElement ? plane : null;
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

  function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
  }

  let handPlaySprites = $derived(sprites.filter((sprite) => sprite.style === 'hand-play'));
  let drawSprites = $derived(sprites.filter((sprite) => sprite.style === 'deck-draw'));
  let resetSprites = $derived(sprites.filter((sprite) => sprite.style === 'hand-reset'));
  let prizeTakeSprites = $derived(sprites.filter((sprite) => sprite.style === 'prize-take'));
</script>

<span class="viewport-anim-layer" data-anim-layer aria-hidden="true">
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
    :global([data-hand-attach-animation-active='true']::before),
    :global([data-hand-evolve-animation-active='true']::after) {
      animation: none;
    }
  }
</style>
