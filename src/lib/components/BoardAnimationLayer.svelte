<script lang="ts">
  import { onDestroy, onMount, tick, untrack } from 'svelte';
  import BoardSlot from './BoardSlot.svelte';
  import CardTile from './CardTile.svelte';
  import { localRectIn, localRectCenter, type LocalRect } from '../dom/planeGeometry';
  import { AnimationEventGate, scopeEnded } from '../anim/gate';
  import { animationActivity, scheduledEndMs } from '../anim/activity';
  import { resolveAnchor } from '../anim/anchors';
  import { AnimAttr } from '../anim/domContract';
  import { choreograph, type CardMotion } from '../anim/motions';
  import { animVisibility, type ReleaseClaim } from '../anim/visibility';
  import { claimSignature, boardClaimIsAuthoritative } from '../anim/settleClaim';
  import { replayStore } from '../../state/replay.svelte';
  import { cardBackCssVar } from '../game/cardAssets';
  import { replayAnimationPhaseGapMs } from '../game/replay';
  import type { ActionTimelineEvent, PlayerView } from '../game/types';

  type Props = {
    events?: ActionTimelineEvent[];
    scopeKey?: string | number;
    turnKey?: string | number;
    // Live scope-end boundary: bumps on every applied view. Sprites and claims
    // hold until it changes, then hand off at the newly-rendered destination —
    // replay's deterministic model. Ignored in replay (scopeKey owns it).
    applySignal?: number;
    replayMode?: boolean;
    players?: PlayerView[];
  };

  type RenderSprite = {
    id: string;
    motion: CardMotion;
    left: number;
    top: number;
    width: number;
    height: number;
    vars: string;
    opponentSide: boolean;
    measuring: boolean;
  };

  const settleMs = 40;

  let {
    events = [],
    scopeKey = '',
    turnKey = '',
    applySignal = 0,
    replayMode = false,
    players = [],
  }: Props = $props();

  let lastApplySignal: number | undefined;

  let layerElement = $state<HTMLElement>();
  let sprites = $state<RenderSprite[]>([]);
  let reduceMotion = $state(false);

  const gate = new AnimationEventGate();
  const timers: ReturnType<typeof setTimeout>[] = [];
  const settleTimers: ReturnType<typeof setTimeout>[] = [];
  const settleFrameIds: number[] = [];
  type ScopeClaim = { release: ReleaseClaim; element: HTMLElement; signature: string };
  const scopeClaims: ScopeClaim[] = [];
  const motionReleases = new Map<string, ReleaseClaim[]>();
  let generation = 0;
  let discardOrder = 0;
  // Live play swaps the view before this effect runs, so an attached card's
  // badge can already be gone. Pre-effect snapshots keep its last geometry.
  let attachedRects = new Map<number, LocalRect>();
  // Same idea for a Pokemon slot: a promotion's source view vacates the promoted
  // Pokemon from the bench so the bench reflows DURING the flight (#39). That
  // removes its slot from the DOM before the board-move launches, so we snapshot
  // every board Pokemon's card-tile rect (keyed by serial) from the pre-update
  // DOM and fly from it when the live source element is gone.
  let boardMoveSourceRects = new Map<number, LocalRect>();

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
    endScope({ settle: false });
    for (const timer of settleTimers) {
      clearTimeout(timer);
    }
    settleTimers.length = 0;
    for (const frameId of settleFrameIds) {
      cancelAnimationFrame(frameId);
    }
    settleFrameIds.length = 0;
  });

  $effect.pre(() => {
    void events;
    const plane = planeElement();
    if (!plane) {
      return;
    }
    const rects = new Map<number, LocalRect>();
    for (const element of document.querySelectorAll(`[${AnimAttr.energySerial}], [${AnimAttr.toolSerial}]`)) {
      if (!(element instanceof HTMLElement) || element.closest('[data-anim-layer]')) {
        continue;
      }
      const serial = Number(element.dataset.energySerial ?? element.dataset.toolSerial);
      if (!Number.isFinite(serial)) {
        continue;
      }
      const ownerCard = element.closest('.board-slot')?.querySelector('.card-tile');
      const rect = localRectIn(plane, ownerCard instanceof HTMLElement ? ownerCard : element);
      if (rect) {
        rects.set(serial, rect);
      }
    }
    if (rects.size) {
      attachedRects = rects;
    }
    const slotRects = new Map<number, LocalRect>();
    for (const slot of document.querySelectorAll(`.board-slot[${AnimAttr.pokemonSerial}]`)) {
      if (!(slot instanceof HTMLElement) || slot.closest('[data-anim-layer]')) {
        continue;
      }
      const serial = Number(slot.dataset.pokemonSerial);
      if (!Number.isFinite(serial)) {
        continue;
      }
      const rect = localRectIn(plane, slot.querySelector('.card-tile') ?? slot);
      if (rect && rect.width > 0) {
        slotRects.set(serial, rect);
      }
    }
    if (slotRects.size) {
      // MERGE, don't replace: a promotion's source view has already vacated the
      // promoted Pokemon by the time this runs, so its rect is absent from
      // slotRects — keep the last-known rect (captured while it was still on the
      // bench a view earlier) so the flight can launch from it. Present serials
      // are refreshed; only truly-departed ones retain a stale rect, and those
      // are read solely for the vacated-source flight that needs exactly that.
      const merged = new Map(boardMoveSourceRects);
      for (const [serial, rect] of slotRects) {
        merged.set(serial, rect);
      }
      boardMoveSourceRects = merged;
    }
  });

  // Scrub mode: the replay timeline is being navigated faster than animations can
  // play. Sourced from the store (not a prop) to keep this fix off the shared,
  // contended App/GameBoard render path; guarded by replayMode so live play is
  // never affected.
  let scrub = $derived(replayMode && replayStore.scrubbing);

  $effect(() => {
    const scrubbing = scrub;
    const { scopeChanged, batch } = gate.update(events, scopeKey);
    const applyChanged = !replayMode && lastApplySignal !== undefined && applySignal !== lastApplySignal;
    lastApplySignal = applySignal;
    if (scrubbing) {
      // gate.update already consumed this view's events (so no stale batch fires
      // when scrub ends); now drop all choreography and let the settled view show
      // bare. untrack: purgeForScrub reads AND writes `sprites`; without untrack
      // that read subscribes this effect to `sprites`, and the write re-triggers
      // it — an infinite loop (effect_update_depth_exceeded) while scrubbing stays
      // true, which hard-freezes the UI under a real drag.
      untrack(() => purgeForScrub());
      return;
    }
    if (scopeEnded(replayMode, { scopeChanged, applyChanged })) {
      endScope({ settle: true });
    }
    if (!batch.length || reduceMotion) {
      return;
    }
    startMotions(batch);
  });

  // Unlike endScope — which preserves gap-avoidance timing and may DEFER sprites
  // to the settle window — scrub purges unconditionally: nobody is watching the
  // choreography, so a lingering sprite or held claim is pure artifact, never a
  // gap worth protecting. Clear every timer, release every claim, drop every
  // sprite. Idempotent, so it is safe to run on each scrubbed view.
  function purgeForScrub() {
    generation += 1;
    for (const timer of timers) {
      clearTimeout(timer);
    }
    timers.length = 0;
    for (const timer of settleTimers) {
      clearTimeout(timer);
    }
    settleTimers.length = 0;
    for (const frameId of settleFrameIds) {
      cancelAnimationFrame(frameId);
    }
    settleFrameIds.length = 0;
    for (const claim of scopeClaims) {
      claim.release();
    }
    scopeClaims.length = 0;
    motionReleases.clear();
    if (sprites.length) {
      sprites = [];
    }
  }

  function startMotions(batch: ActionTimelineEvent[]) {
    const motions = choreograph(batch, players).motions.filter((motion) => motion.space === 'board');
    if (!motions.length) {
      return;
    }
    if (!replayMode) {
      // Report how long this batch runs so the live stepper waits for it before
      // applying the next view (which ends this scope). Pad covers the settle
      // window and the pre-paint handoff.
      animationActivity.extendBy(scheduledEndMs(motions) + settleMs + 60);
    }
    const startedGeneration = generation;
    for (const motion of motions) {
      applyClaims(motion, (claim) => claim.early === true);
    }
    for (const motion of motions) {
      const timer = setTimeout(() => {
        void beginMotion(motion, startedGeneration);
      }, motion.startMs);
      timers.push(timer);
    }
  }

  async function beginMotion(motion: CardMotion, startedGeneration: number) {
    if (startedGeneration !== generation) {
      return;
    }
    const plane = planeElement();
    if (!plane) {
      return;
    }

    if (motion.style === 'board-move') {
      await beginBoardMove(motion, plane, startedGeneration);
      return;
    }
    if (motion.style === 'attached-move') {
      beginAttachedMove(motion, plane);
      return;
    }
    if (motion.style === 'deck-shuffle') {
      beginDeckShuffle(motion, plane, startedGeneration);
      return;
    }
    beginDeckDiscard(motion, plane);
  }

  function beginDeckShuffle(motion: CardMotion, plane: HTMLElement, startedGeneration: number) {
    const deck = resolveAnchor(motion.from);
    if (!deck) {
      return;
    }
    const pileRect = localRectIn(plane, deck.element);
    if (!pileRect || pileRect.width <= 0) {
      return;
    }
    sprites = [...sprites, {
      id: motion.id,
      motion,
      left: pileRect.left,
      top: pileRect.top,
      width: pileRect.width,
      height: pileRect.height,
      vars: '',
      opponentSide: !!deck.element.closest('.top-piles'),
      measuring: false,
    }];
    const timer = setTimeout(() => {
      if (startedGeneration !== generation) {
        return;
      }
      sprites = sprites.filter((sprite) => sprite.id !== motion.id);
    }, motion.durationMs);
    timers.push(timer);
  }

  // Deterministic split/cross/settle offsets for the six shuffle cards.
  function shuffleCardStyle(index: number, opponent: boolean): string {
    const direction = opponent ? -1 : 1;
    const side = index % 2 === 0 ? -1 : 1;
    const depth = index - 2.5;
    return [
      `--shuffle-delay: ${index * 32}ms`,
      `--split-x: ${(side * (20 + index * 2)).toFixed(1)}px`,
      `--split-y: ${(direction * (-18 - Math.abs(depth) * 2)).toFixed(1)}px`,
      `--split-rotation: ${(side * (5 + index * 0.8)).toFixed(1)}deg`,
      `--cross-x: ${(-side * (15 + index)).toFixed(1)}px`,
      `--cross-y: ${(direction * (-4 + depth)).toFixed(1)}px`,
      `--cross-rotation: ${(-side * (4 + index * 0.5)).toFixed(1)}deg`,
      `--settle-x: ${(side * 4).toFixed(1)}px`,
      `--settle-y: ${(direction * 2).toFixed(1)}px`,
      `--settle-rotation: ${(side * 1.5).toFixed(1)}deg`,
      `--base-rotation: ${opponent ? 180 : 0}deg`,
      cardBackCssVar(),
    ].join('; ');
  }

  async function beginBoardMove(motion: CardMotion, plane: HTMLElement, startedGeneration: number) {
    const from = resolveAnchor(motion.from);
    const to = resolveAnchor(motion.to);
    if (!to) {
      return;
    }
    // A promotion's source view vacates the promoted Pokemon from the bench (#39),
    // so its slot element is already gone here — fly from the pre-vacate snapshot
    // instead. When the source IS still present (retreat/Teleport, or before the
    // view-side vacate lands), this is identical to reading from.geometry, so the
    // fallback is a safe no-op.
    const sourceSerial = motion.from.kind === 'pokemon' ? motion.from.serial : undefined;
    const fromRect = from
      ? localRectIn(plane, from.geometry)
      : (sourceSerial !== undefined ? boardMoveSourceRects.get(sourceSerial) ?? null : null);
    const toRect = localRectIn(plane, to.geometry);
    if (!fromRect || !toRect || fromRect.width <= 0 || toRect.width <= 0) {
      return;
    }

    const sprite: RenderSprite = {
      id: motion.id,
      motion,
      left: toRect.left,
      top: toRect.top,
      width: toRect.width,
      height: toRect.height,
      vars: boardMoveVars(fromRect, toRect, 0, 0),
      opponentSide: (from ? isOpponentSide(from.element) : false) || isOpponentSide(to.element),
      measuring: true,
    };
    sprites = [...sprites, sprite];
    await tick();
    if (startedGeneration !== generation) {
      return;
    }
    // Only the destination must still exist. A vacated source (from === null) has
    // no element to contain — the sprite flies from its snapshotted rect.
    if (!document.body.contains(to.element) || (from !== null && !document.body.contains(from.element))) {
      sprites = sprites.filter((item) => item.id !== sprite.id);
      return;
    }

    const correction = measureSpriteCorrection(sprite, to.geometry);
    applyClaims(motion, (claim) => claim.early !== true);
    sprites = sprites.map((item) => item.id === sprite.id
      ? { ...item, vars: boardMoveVars(fromRect, toRect, correction.x, correction.y), measuring: false }
      : item);
    // Sprite and claims hold until the scope ends (the next view is applied),
    // then hand off at the now-rendered destination — no per-motion poll.
  }

  function beginAttachedMove(motion: CardMotion, plane: HTMLElement) {
    const from = resolveAnchor(motion.from);
    const to = resolveAnchor(motion.to);
    if (!to) {
      return;
    }
    const serial = motion.from.kind === 'attached' ? motion.from.serial : undefined;
    const fromRect = from ? localRectIn(plane, from.geometry) : (serial !== undefined ? attachedRects.get(serial) ?? null : null);
    const toRect = localRectIn(plane, to.geometry);
    if (!fromRect || !toRect || fromRect.width <= 0 || toRect.width <= 0) {
      return;
    }

    const fromCenter = localRectCenter(fromRect);
    const toCenter = localRectCenter(toRect);
    const targetScale = Math.min(toRect.width / fromRect.width, toRect.height / fromRect.height);
    const targetRotation = to.element.closest('.top-piles') ? 180 : 0;
    const startRotation = from?.element.closest('.top-active-slot, .bench-row.opponent') ? 180 : targetRotation;
    applyClaims(motion, (claim) => claim.early !== true);
    sprites = [...sprites, {
      id: motion.id,
      motion,
      left: fromCenter.x - fromRect.width / 2,
      top: fromCenter.y - fromRect.height / 2,
      width: fromRect.width,
      height: fromRect.height,
      vars: [
        `--attached-move-x: ${(toCenter.x - fromCenter.x).toFixed(1)}px`,
        `--attached-move-y: ${(toCenter.y - fromCenter.y).toFixed(1)}px`,
        `--attached-move-target-scale: ${(Number.isFinite(targetScale) && targetScale > 0 ? targetScale : 1).toFixed(3)}`,
        `--attached-move-start-rotation: ${startRotation}deg`,
        `--attached-move-target-rotation: ${targetRotation}deg`,
      ].join('; '),
      opponentSide: false,
      measuring: false,
    }];
    // Holds until the scope ends (see beginBoardMove).
  }

  function beginDeckDiscard(motion: CardMotion, plane: HTMLElement) {
    const from = resolveAnchor(motion.from);
    const to = resolveAnchor(motion.to);
    if (!from || !to) {
      return;
    }
    const pile = from.element;
    const pileRect = localRectIn(plane, pile);
    const toRect = localRectIn(plane, to.geometry);
    if (!pileRect || !toRect || pileRect.width <= 0) {
      return;
    }
    const pileStyle = getComputedStyle(pile);
    const startX = pileRect.left + cssPixelValue(pileStyle.getPropertyValue('--deck-top-x'));
    const startY = pileRect.top + cssPixelValue(pileStyle.getPropertyValue('--deck-top-y'));

    sprites = [...sprites, {
      id: motion.id,
      motion,
      left: startX,
      top: startY,
      width: pileRect.width,
      height: pileRect.height,
      vars: [
        `--discard-x: ${(toRect.left - startX).toFixed(1)}px`,
        `--discard-y: ${(toRect.top - startY).toFixed(1)}px`,
        `--base-rotation: ${pile.closest('.top-piles') ? 180 : 0}deg`,
        `z-index: ${++discardOrder}`,
      ].join('; '),
      opponentSide: false,
      measuring: false,
    }];
    // Holds until the scope ends (see beginBoardMove).
  }

  function applyClaims(motion: CardMotion, includeClaim: (claim: CardMotion['hide'][number]) => boolean) {
    const releases = motionReleases.get(motion.id) ?? [];
    for (const claim of motion.hide) {
      if (!includeClaim(claim)) {
        continue;
      }
      const resolved = resolveAnchor(claim.anchor);
      if (!resolved) {
        continue;
      }
      const release = animVisibility.claim(resolved.element, claim.mode);
      releases.push(release);
      scopeClaims.push({ release, element: resolved.element, signature: claimSignature(resolved.element) });
    }
    motionReleases.set(motion.id, releases);
  }

  function releaseMotion(motionId: string) {
    const releases = motionReleases.get(motionId);
    if (!releases) {
      return;
    }
    motionReleases.delete(motionId);
    for (const release of releases) {
      release();
    }
  }

  function endScope({ settle = false }: { settle?: boolean } = {}) {
    generation += 1;
    const cleanupGeneration = generation;
    for (const timer of timers) {
      clearTimeout(timer);
    }
    timers.length = 0;
    const claims = [...scopeClaims];
    scopeClaims.length = 0;
    motionReleases.clear();
    const spriteIds = new Set(sprites.map((sprite) => sprite.id));

    // A claim whose destination is already authoritative releases now (and drops
    // its sprite synchronously below); one whose settled card may not have
    // painted yet defers past the settle window. Authoritative = the claimed
    // element left the DOM (an identity-keyed bench slot destroyed on a swap, its
    // arriving card already rendered in a fresh node) OR it is still attached but
    // now shows a different card (a position-keyed slot mutated in place). See
    // settleClaim.ts — holding a detached-node claim is what re-doubled the
    // switch drop-shadow after the bench was re-keyed by Pokemon identity.
    const releases: ReleaseClaim[] = [];
    for (const claim of claims) {
      if (boardClaimIsAuthoritative(claim.element, claim.signature)) {
        claim.release();
      } else {
        releases.push(claim.release);
      }
    }

    // The settleMs defer exists to avoid a GAP: hold a still-relevant claim (its
    // settled card may not have painted) until settleMs, then remove the sprite.
    // But when NO claim is held — a switch/retreat/promotion, where every claim
    // released immediately because its slot already shows the new occupant — the
    // destination is already authoritative, so deferring the sprite only OVERLAPS
    // it with the settled card for settleMs, doubling the card and its drop-shadow
    // (the "shadow flickers under both cards" at the settle). Tear those sprites
    // down on the next prepaint instead, so the sprite leaves the same beat the
    // settled cards un-hid. Release on the destination landing, not a fixed clock.
    if (settle && releases.length) {
      const timer = setTimeout(() => {
        for (const release of releases) {
          release();
        }
        removeSpritesAfterPrepaint(spriteIds, cleanupGeneration);
        const timerIndex = settleTimers.indexOf(timer);
        if (timerIndex >= 0) {
          settleTimers.splice(timerIndex, 1);
        }
      }, settleMs);
      settleTimers.push(timer);
      return;
    }

    for (const release of releases) {
      release();
    }
    // No held claim: the settled cards' elements already exist and just un-hid
    // this same tick, so drop the sprites synchronously in the same reactive
    // update — Svelte paints the un-hide and the sprite removal together, so
    // there is neither an overlap (double shadow) nor a gap.
    sprites = [];
  }

  function removeSpritesAfterPrepaint(spriteIds: Set<string>, cleanupGeneration: number) {
    if (!spriteIds.size) {
      return;
    }
    const firstFrameId = requestAnimationFrame(() => {
      removeSettleFrame(firstFrameId);
      const secondFrameId = requestAnimationFrame(() => {
        removeSettleFrame(secondFrameId);
        if (cleanupGeneration === generation) {
          sprites = sprites.filter((sprite) => !spriteIds.has(sprite.id));
        }
      });
      settleFrameIds.push(secondFrameId);
    });
    settleFrameIds.push(firstFrameId);
  }

  function removeSettleFrame(frameId: number) {
    const frameIndex = settleFrameIds.indexOf(frameId);
    if (frameIndex >= 0) {
      settleFrameIds.splice(frameIndex, 1);
    }
  }

  function measureSpriteCorrection(sprite: RenderSprite, target: HTMLElement) {
    const spriteElement = layerElement?.querySelector(`[data-board-move-id="${sprite.id}"] .card-tile`);
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

  function boardMoveVars(fromRect: LocalRect, toRect: LocalRect, correctionX: number, correctionY: number): string {
    return [
      `--board-move-source-slot-w: ${toRect.width}px`,
      `--board-move-start-x: ${(fromRect.left + fromRect.width / 2 - (toRect.left + toRect.width / 2)).toFixed(3)}px`,
      `--board-move-start-y: ${(fromRect.top + fromRect.height / 2 - (toRect.top + toRect.height / 2)).toFixed(3)}px`,
      `--board-move-start-scale: ${(fromRect.width / toRect.width).toFixed(6)}`,
      `--board-move-correction-x: ${correctionX.toFixed(3)}px`,
      `--board-move-correction-y: ${correctionY.toFixed(3)}px`,
    ].join('; ');
  }

  function isOpponentSide(element: HTMLElement): boolean {
    return !!element.closest('.top-active-slot, .bench-row.opponent, .top-stadium-card');
  }

  function planeElement(): HTMLElement | null {
    const plane = layerElement?.parentElement;
    return plane instanceof HTMLElement ? plane : null;
  }

  function cssPixelValue(value: string): number {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function spriteBaseStyle(sprite: RenderSprite): string {
    return [
      `left: ${sprite.left.toFixed(2)}px`,
      `top: ${sprite.top.toFixed(2)}px`,
      `width: ${sprite.width.toFixed(2)}px`,
      `height: ${sprite.height.toFixed(2)}px`,
      sprite.vars,
    ].join('; ');
  }

  let attachedSprites = $derived(sprites.filter((sprite) => sprite.motion.style === 'attached-move'));
  let discardSprites = $derived(sprites.filter((sprite) => sprite.motion.style === 'deck-discard'));
  let shuffleSprites = $derived(sprites.filter((sprite) => sprite.motion.style === 'deck-shuffle'));
  let boardMoveSprites = $derived(sprites.filter((sprite) => sprite.motion.style === 'board-move'));
</script>

<span class="board-anim-layer" data-anim-layer style={cardBackCssVar()} bind:this={layerElement} aria-hidden="true">
  <span class="anim-sublayer attached-sublayer">
    {#each attachedSprites as sprite (sprite.id)}
      <span class="attached-move-sprite" style={spriteBaseStyle(sprite)}>
        <span class="attached-move-card">
          {#if sprite.motion.sprite.kind === 'card'}
            <CardTile card={sprite.motion.sprite.card} compact />
          {/if}
        </span>
      </span>
    {/each}
  </span>

  <span class="anim-sublayer shuffle-sublayer">
    {#each shuffleSprites as sprite (sprite.id)}
      <span class="shuffle-stack" style={spriteBaseStyle(sprite)}>
        <span class="shuffle-glow"></span>
        {#each [0, 1, 2, 3, 4, 5] as index (index)}
          <span class="shuffle-card" style={shuffleCardStyle(index, sprite.opponentSide)}></span>
        {/each}
      </span>
    {/each}
  </span>

  <span class="anim-sublayer discard-sublayer">
    {#each discardSprites as sprite (sprite.id)}
      <span class="deck-discard-card" style={spriteBaseStyle(sprite)}>
        <span class="deck-discard-card-inner">
          <span class="deck-discard-face deck-discard-back" style={cardBackCssVar()}></span>
          <span class="deck-discard-face deck-discard-front">
            {#if sprite.motion.sprite.kind === 'flip-card'}
              <CardTile card={sprite.motion.sprite.card} compact />
            {/if}
          </span>
        </span>
      </span>
    {/each}
  </span>

  <span class="anim-sublayer board-move-sublayer">
    {#each boardMoveSprites as sprite (sprite.id)}
      <span
        class="board-move-card"
        class:opponent-side={sprite.opponentSide}
        class:measuring={sprite.measuring}
        class:to-deck={sprite.motion.toDeck}
        data-board-move-id={sprite.id}
        style={spriteBaseStyle(sprite)}
      >
        <span class="board-move-card-inner">
          {#if sprite.motion.sprite.kind === 'slot'}
            <BoardSlot slot={sprite.motion.sprite.slot} active={sprite.motion.sprite.activeSize} />
          {:else if sprite.motion.sprite.kind === 'card'}
            <CardTile card={sprite.motion.sprite.card} compact />
          {/if}
        </span>
      </span>
    {/each}
  </span>
</span>

<style>
  .board-anim-layer {
    display: contents;
  }

  .anim-sublayer {
    position: absolute;
    inset: 0;
    display: block;
    overflow: visible;
    pointer-events: none;
    transform-style: preserve-3d;
  }

  .attached-sublayer {
    z-index: 3;
  }

  .shuffle-sublayer {
    z-index: 8;
  }

  .discard-sublayer {
    z-index: 9;
  }

  .board-move-sublayer {
    z-index: 29;
  }

  /* Attached sprites slide out from under the owning Pokemon card. */
  :global(.game-board-plane .board-slot) {
    z-index: 4;
  }

  /* Central visibility manager output. `contents` empties a container while
     keeping its layout; `element` hides the element itself. */
  :global(.board-slot[data-anim-hidden]) {
    transition: none !important;
  }

  :global(.board-slot.empty[data-anim-hidden]) {
    border-color: transparent !important;
    background: transparent !important;
  }

  :global(.board-slot[data-anim-hidden] > .card-tile),
  :global(.board-slot[data-anim-hidden] > .pokemon-status),
  :global(.board-slot[data-anim-hidden] > .energy-badges),
  :global(.board-slot[data-anim-hidden] > .tool-card-preview),
  :global(.board-slot[data-anim-hidden] > .slot-badges),
  :global(.board-slot[data-anim-hidden] > .empty-zone) {
    opacity: 0;
  }

  :global([data-anim-hidden='element']) {
    visibility: hidden;
  }

  .board-move-card {
    position: absolute;
    display: block;
    transform-origin: 50% 50%;
    transform-style: preserve-3d;
    animation: board-card-move 520ms cubic-bezier(0.22, 0.78, 0.2, 1) both;
    will-change: transform;
  }

  .board-move-card.measuring {
    opacity: 0;
    animation: none;
    transform: translate3d(0, 0, 0) scale(1);
  }

  .board-move-card-inner {
    position: relative;
    display: block;
    width: 100%;
    height: 100%;
    transform-style: preserve-3d;
  }

  .board-move-card.to-deck .board-move-card-inner {
    animation: board-card-flip-to-back 520ms ease-in-out both;
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

  .attached-move-sprite {
    position: absolute;
    display: grid;
    place-items: center;
    transform-origin: center;
    animation: attached-card-move 360ms cubic-bezier(0.2, 0.82, 0.22, 1) both;
    will-change: transform, opacity;
  }

  .attached-move-card {
    display: block;
    width: 100%;
    height: 100%;
    overflow: hidden;
    border-radius: 5px;
    /* No opaque fill here OR on the inner card-tile (below): the decoded card art
       is the only surface. A near-white fill flashed before the (remote) art
       decoded — a harsh white card flying at the discard beat. The sprite renders
       BENEATH the owning Pokemon (attached-sublayer z-index 3 < board-slot 4), so
       an undecoded-transparent tile shows the board underneath, not white. */
    background: transparent;
    box-shadow:
      0 12px 26px rgba(23, 30, 38, 0.24),
      0 0 0 1px rgba(18, 21, 26, 0.18);
    pointer-events: none;
  }

  .attached-move-card :global(.card-tile) {
    width: 100%;
    height: 100%;
    pointer-events: none;
    /* The CardTile's own #f7f8fa surface is the remaining white flash (the
       container fill was already dropped): before a cold energy face image
       decodes, that near-white base paints on the flying energy. Suppress it —
       the decoded <img> covers the full tile, so nothing is lost once loaded. */
    background: transparent;
  }

  @keyframes attached-card-move {
    0% {
      opacity: 0;
      transform:
        translate3d(0, 0, 0)
        rotate(var(--attached-move-start-rotation))
        scale(1);
    }
    8% {
      opacity: 1;
      transform:
        translate3d(0, 0, 0)
        rotate(var(--attached-move-start-rotation))
        scale(1);
    }
    88%,
    100% {
      opacity: 1;
      transform:
        translate3d(var(--attached-move-x), var(--attached-move-y), 0)
        rotate(var(--attached-move-target-rotation))
        scale(var(--attached-move-target-scale));
    }
  }

  .deck-discard-card {
    position: absolute;
    display: block;
    border-radius: 5px;
    pointer-events: none;
    transform-style: preserve-3d;
    animation: deck-discard-travel 300ms cubic-bezier(0.24, 0.78, 0.24, 1) both;
    will-change: transform, opacity;
  }

  .deck-discard-card-inner {
    position: absolute;
    inset: 0;
    display: block;
    border-radius: inherit;
    transform-style: preserve-3d;
    animation: deck-discard-flip 300ms ease-in-out both;
    will-change: transform;
  }

  .deck-discard-face {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    overflow: hidden;
    border-radius: inherit;
    box-shadow:
      0 8px 18px rgba(23, 30, 38, 0.24),
      0 0 0 1px rgba(18, 21, 26, 0.18);
    backface-visibility: hidden;
  }

  .deck-discard-back {
    background:
      var(--card-back-image, var(--cardback-shade)),
      linear-gradient(135deg, rgba(255, 255, 255, 0.1), transparent 28%),
      repeating-linear-gradient(45deg, rgba(255, 255, 255, 0.08) 0 6px, transparent 6px 12px),
      linear-gradient(145deg, #203654, #111a2c);
    background-size: cover, auto, auto, auto;
    background-position: center;
  }

  .deck-discard-front {
    transform: rotateY(180deg);
    background: #f7f8fa;
  }

  .deck-discard-front :global(.card-tile) {
    width: 100%;
    height: 100%;
  }

  @keyframes deck-discard-travel {
    0% {
      opacity: 0;
      transform: translate3d(0, 0, 0) rotate(var(--base-rotation));
    }
    1% {
      opacity: 1;
      transform: translate3d(0, 0, 0) rotate(var(--base-rotation));
    }
    10% {
      opacity: 1;
      transform: translate3d(0, 0, 0) rotate(var(--base-rotation));
    }
    55% {
      opacity: 1;
      transform: translate3d(calc(var(--discard-x) * 0.58), calc(var(--discard-y) * 0.58 - 10px), 0) rotate(var(--base-rotation));
    }
    86% {
      opacity: 1;
      transform: translate3d(var(--discard-x), var(--discard-y), 0) rotate(var(--base-rotation));
    }
    96% {
      opacity: 1;
      transform: translate3d(var(--discard-x), var(--discard-y), 0) rotate(var(--base-rotation));
    }
    100% {
      opacity: 0;
      transform: translate3d(var(--discard-x), var(--discard-y), 0) rotate(var(--base-rotation));
    }
  }

  @keyframes deck-discard-flip {
    0% {
      transform: rotateY(0deg);
    }
    72%,
    100% {
      transform: rotateY(180deg);
    }
  }

  .shuffle-stack {
    position: absolute;
    display: block;
    border-radius: 5px;
    pointer-events: none;
  }

  .shuffle-card,
  .shuffle-glow {
    position: absolute;
    inset: 0;
    border-radius: inherit;
    pointer-events: none;
  }

  .shuffle-card {
    background:
      var(--card-back-image, var(--cardback-shade)),
      linear-gradient(135deg, rgba(255, 255, 255, 0.1), transparent 28%),
      repeating-linear-gradient(45deg, rgba(255, 255, 255, 0.08) 0 6px, transparent 6px 12px),
      linear-gradient(145deg, #203654, #111a2c);
    background-size: cover, auto, auto, auto;
    background-position: center;
    box-shadow:
      0 7px 16px rgba(23, 30, 38, 0.2),
      0 0 0 1px rgba(18, 21, 26, 0.16);
    opacity: 0;
    animation: shuffle-card 760ms cubic-bezier(0.2, 0.72, 0.22, 1) var(--shuffle-delay) both;
    will-change: transform, opacity;
  }

  .shuffle-glow {
    border: 1px solid rgba(82, 188, 168, 0.55);
    box-shadow:
      0 0 0 0 rgba(82, 188, 168, 0.22),
      0 0 22px rgba(82, 188, 168, 0.24);
    opacity: 0;
    animation: shuffle-glow 760ms ease-out both;
  }

  @keyframes shuffle-card {
    0% {
      opacity: 0;
      transform: translate3d(0, 0, 0) rotate(var(--base-rotation)) scale(0.98);
    }
    12% {
      opacity: 1;
      transform: translate3d(0, -6px, 0) rotate(var(--base-rotation)) scale(1.01);
    }
    38% {
      opacity: 1;
      transform: translate3d(var(--split-x), var(--split-y), 0) rotate(calc(var(--base-rotation) + var(--split-rotation))) scale(1.02);
    }
    62% {
      opacity: 1;
      transform: translate3d(var(--cross-x), var(--cross-y), 0) rotate(calc(var(--base-rotation) + var(--cross-rotation))) scale(1.01);
    }
    84% {
      opacity: 1;
      transform: translate3d(var(--settle-x), var(--settle-y), 0) rotate(calc(var(--base-rotation) + var(--settle-rotation))) scale(1);
    }
    100% {
      opacity: 0;
      transform: translate3d(0, 0, 0) rotate(var(--base-rotation)) scale(0.98);
    }
  }

  @keyframes shuffle-glow {
    0% {
      opacity: 0;
      transform: scale(0.98);
    }
    22% {
      opacity: 1;
      transform: scale(1.05);
      box-shadow:
        0 0 0 7px rgba(82, 188, 168, 0.14),
        0 0 24px rgba(82, 188, 168, 0.28);
    }
    100% {
      opacity: 0;
      transform: scale(1.14);
      box-shadow:
        0 0 0 16px rgba(82, 188, 168, 0),
        0 0 30px rgba(82, 188, 168, 0);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .board-move-card,
    .attached-move-sprite,
    .deck-discard-card,
    .deck-discard-card-inner,
    .shuffle-card,
    .shuffle-glow {
      animation: none;
    }
  }
</style>
