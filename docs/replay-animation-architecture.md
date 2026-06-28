# Replay Animation Architecture Plan

## Goal

Preserve the current replay animation language while replacing the fragile
per-component ownership model. Moving card visuals should have exactly one
owner, real DOM visibility should be centrally controlled, and handoff from an
animated sprite to the final board state should be deterministic.

This plan is intended to eliminate the recurring class of bugs we have seen:
hand-card flicker, board Pokemon/tool flicker, missing cards after fast
scrubbing, duplicate discard/play-zone cards, cards snapping out of the tilted
board plane, and stale hidden attributes after replay scope changes.

## Current Failure Mode

Replay animation ownership is spread across many components. Board moves, hand
reset, deck draw, deck reveal, hand play, attached-card movement, discard
resolution, prize movement, attack, and ability animations all inspect events,
clone DOM, set hidden attributes, run timers, and clean up independently.

That creates three structural problems:

- Multiple components can hide or reveal the same visual at different times.
- DOM nodes can be replaced between phase views while a component still owns the
  old element reference.
- Timing and phase classification are duplicated between replay generation,
  replay state, and animation components.

The durable fix is to make temporary animation ownership an explicit replay
contract instead of something rediscovered from the DOM by each component.

## Target Model

### Typed Animation Anchors

Add a typed `AnimationAnchorRef` contract and matching `data-animation-*`
attributes for every place a card can start, travel through, or land.

The anchor model must distinguish a card visual from the slot or surface that
contains it. For example, a bench Pokemon card, a bench slot surface, a discard
top card, and a discard pile surface are separate anchors.

Required anchors:

- hand card
- hand insertion slot
- deck top
- discard top card
- discard pile surface
- play-zone card
- stadium card
- active Pokemon card
- bench Pokemon card
- bench slot surface
- attached energy
- attached tool
- prize card or back by index
- reveal/search card slot

### Central Visibility Manager

Replace component-local hidden maps and one-off hidden attributes with a central
token-based visibility manager.

Visibility claims should be keyed by semantic ownership, not only by
`HTMLElement`:

```ts
type AnimationVisibilityClaim = {
  scopeKey: string;
  anchor: AnimationAnchorRef;
  identity?: AnimationIdentity;
  role: 'source' | 'destination' | 'handoff';
};
```

The manager resolves claims onto the current DOM. If a phase change replaces an
element, the claim still applies to the newly resolved element until released.

Rules:

- Claims are ref-counted by anchor, identity, role, and scope.
- Scope cleanup releases all claims for stale replay phases.
- Handoff is standardized: reveal the destination DOM, wait for a prepaint
  window, then remove the sprite.
- Components should not set animation-specific hidden attributes directly once
  their path is migrated.

### Replay Animation Plan

Extend replay phases with explicit animation intent:

```ts
type ReplayAnimationPhasePlan = {
  key: string;
  label?: string;
  view: GameView;
  durationMs: number;
  motions: AnimationMotion[];
  visibilityClaims: AnimationVisibilityClaim[];
};
```

Each motion carries the information needed to render and hand off without
reclassifying events:

```ts
type AnimationMotion = {
  id: string;
  kind: string;
  identity?: AnimationIdentity;
  sourceAnchor?: AnimationAnchorRef;
  targetAnchor?: AnimationAnchorRef;
  coordinateSpace: 'board' | 'viewport' | 'cross-plane';
  startMs: number;
  durationMs: number;
  spriteVisual: AnimationSpriteVisual;
  handoffPolicy: AnimationHandoffPolicy;
};
```

The replay plan should carry phase and motion timing directly. Components should
not need to recompute offsets from event kind strings.

### Animation Orchestrator And Renderers

Use one orchestrator for ownership and several focused renderers for visuals.

The orchestrator owns:

- scope cleanup
- visibility claims
- stale timer guards
- reduced-motion behavior
- anchor resolution
- source/destination snapshot timing
- final handoff policy

Renderers only render sprites and effects:

- board-plane card moves
- viewport and cross-plane card moves
- reveal/search sessions
- ability, attack, and damage pulses

Avoid turning this into a single large component that owns every visual detail.

### Reveal/Search Sessions

Model deck search and reveal flows as a session, not as a generic card fan.

A reveal session can include:

- cards leaving deck
- revealed group holding on the board
- selected card identification
- selected card transitioning into the standard revealed-card presentation
- unselected cards returning to deck
- selected card moving to hand, attach target, or another destination
- shuffle motion

Pokegear should be the main proof case for this path.

## Migration Order

1. Add typed anchors and an anchor resolver without changing visual behavior.
2. Add and test the central visibility manager.
3. Convert board moves first. This covers Boss, Switch, active/bench swaps,
   counter-stadium displacement, and board-space discard movement.
4. Convert discard, play-zone, and stadium handoff ownership.
5. Convert hand arrivals: draw, prize take, reveal take, search-to-hand, and
   mulligan reset/draw.
6. Convert attached-card movement after board moves. Attached moves are harder
   because sources can disappear and old geometry may need to be snapshotted.
7. Convert reveal/search sessions, using Pokegear as the main acceptance case.
8. Convert ability, attack, damage, and other pulse effects to consume the same
   phase plan.
9. Delete obsolete component-local hidden attributes, refcount maps, clone
   timers, and duplicated timing code after each path is migrated.

During migration, gate old animation components off for phase keys handled by
the new orchestrator. The old and new systems must not animate or hide the same
event at the same time.

## Replay Data Contract

Keep `cabtReplay.ts` responsible for semantic grouping and projected phase
views, but move animation-specific hiding out of `GameView`.

The target state is:

- `GameView` describes real visible game state.
- `ReplayAnimationPhasePlan` describes temporary animation ownership and
  motion.
- The visibility manager decides what real DOM is hidden during the animation.

Existing `animationHidden` flags can remain as a legacy bridge only while their
animation path has not been migrated.

## Regression Coverage

Add focused tests for:

- Boss/Switch repeated prev-next: no Pokemon or tool flicker.
- Buddy-Buddy Poffin: multiple deck-to-bench placements stay one effect and
  land in the board frame.
- Manual repeated benching: two identical hand-to-bench actions stay separate.
- Mulligan fast-clicking: no missing hand cards and no partial outgoing card
  slivers.
- Pokegear: selected card reveals cleanly, unselected cards return, selected
  card lands in hand without flicker.
- Colress, Hilda, and Lillie-style search-to-hand effects.
- Enhanced Hammer: attached energy slides from under the owning Pokemon to the
  top of discard.
- Counter-stadium: old stadium moves to its owner's discard in board space.
- Discard pile count stays above incoming discard animations.
- Top/bottom player rotation does not invert owner discard or board anchors.
- Missing-anchor fallback fails without leaving real cards hidden forever.
- Reduced motion still performs deterministic handoff.

Run `npm test -- --run` and `npm run build` before committing meaningful
implementation slices.
