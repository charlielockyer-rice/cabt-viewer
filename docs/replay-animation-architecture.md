# Replay Animation Architecture

## Purpose

The 2026 replay-animation rebuild makes animation intent an explicit contract
between replay data, semantic anchors, shared visibility ownership, and two
focused render layers. The goal is deterministic card motion and handoff without
component-local hiding, DOM cloning, or duplicated event classification.

## Data Flow

CABT input starts as engine frames plus logs. `cabtReplayToSnapshot` turns those
frames into replay data for the viewer. It is responsible for semantic grouping:
raw log lines become action timeline events, related events are grouped into
player-visible actions, and trainer effects that continue across multiple engine
frames are collapsed into a single replay step when that is the visible action.

For grouped steps, `cabtReplayToSnapshot` also builds per-phase projected
`GameView`s. A phase view is the real board state that should exist while one
part of the action animates, so animation components do not invent temporary
board state.

Replay steps expose animation phases as `{ key, view, actionTimeline,
durationMs }`.

The render layers receive the phase timeline and players, then call
`choreograph(events, players, context)`. `choreograph` is a pure classifier: it
does not read the DOM or mutate state. It returns card sprites and target-owned
CSS effects for that phase. The optional `context` is the whole step timeline,
used when a phase needs surrounding events, such as finding the attacker for a
standalone damage phase.

## Motion Contract

`choreograph` returns `{ motions: CardMotion[], effects: TargetEffect[] }`.

`CardMotion` is the sprite contract. Its fields are:

- `id`: stable motion identity for rendering and cleanup.
- `style`: visual path, such as `board-move`, `attached-move`, `deck-discard`,
  `hand-play`, `deck-draw`, `hand-reset`, `prize-take`, `knock-out`,
  `damage-float`, or `deck-shuffle`.
- `space`: `board` for tilted-plane sprites, or `viewport` for
  `position: fixed` sprites.
- `player`: the owning player index.
- `sprite`: Pokemon slot, card, flip-card, text label, or no rendered visual.
- `from` and `to`: semantic anchors for source and destination.
- `toFallbacks`: destination anchors tried in order when the primary `to`
  anchor does not resolve.
- `startMs` and `durationMs`: timing within the phase.
- `toDeck` and `fromDeck`: deck-direction flags.
- `waitForDestinationCard`: live-mode handoff waits for the exact destination
  card before releasing.
- `hide`: visibility claims to apply while the sprite owns the visual.
- `hideResolvedTarget`: for hand plays, hide the resolved destination.
- `evolve`: marks a hand play as an evolution flight, with target glow and slot
  chrome fade behavior.
- `mulligan`: refill existing hand slots by serial instead of appending.
- `takeIndex` and `takeCount`: prize-take group metadata used to extrapolate
  source positions after prize cards have left the DOM.

`TargetEffect` is for animations owned by the real target element:

- `id`: stable effect identity.
- `kind`: `attach-under`, `prize-place`, `announce-attack`, `announce-ability`,
  or `lunge`.
- `anchor`: semantic target anchor.
- `player`: owning player index.
- `card`: optional card payload for effects that need card data.
- `sourceSerial`: the hand-card serial an attachment visually departs from.
- `order`: placement order within a grouped effect.
- `label`: attack or ability text shown above a slot.
- `targetAnchor`: defender anchor for lunge effects.
- `startMs` and `durationMs`: timing within the phase.

## Anchors

Anchors are semantic DOM addresses, resolved at animation time by
`resolveAnchor`. They describe game locations, not component instances:

- `slot`: active or bench slot by player and index.
- `pokemon`: Pokemon by serial, or by card id plus player.
- `deck`: a player's deck pile.
- `discard`: discard pile, exact discard card, top card, or pile surface.
- `stadium`: a player's stadium card, optionally by serial.
- `attached`: attached energy or tool by attachment serial.
- `hand`: a player's hand container.
- `hand-slot`: a hand card slot by serial, index, or offset from the end.
- `prize`: prize slot by player and index.
- `playZone`: played-card zone, optionally by serial.

A resolved anchor returns both `element` and `geometry`. Visibility claims apply
to `element`; sprite measurements use `geometry`. These are usually the same
node, but deck geometry prefers the visible deck face, and attached-card
geometry uses the owning Pokemon card footprint instead of the small badge.

Resolution prefers precise identity where available. Discard anchors can target
the pile surface, require an exact card, or fall back from exact card to top card
to pile. Hand slots resolve by serial first, then `fromEnd`, then `index`.
Anchor queries skip `[data-anim-layer]` subtrees because sprites render real
board components and must never become their own source or destination.

## Visibility

All animation-time hiding goes through `animVisibility` in
`src/lib/anim/visibility.ts`. It has one public operation: claim an element with
mode `contents` or `element`, and receive a release function.

Claims are ref-counted per DOM element and per mode. If two motions hide the
same element, the first release cannot reveal it while the second claim is still
active. Element claims win over contents claims when both are present.

The manager writes exactly one attribute: `data-anim-hidden`. Its value is
`contents` or `element`; removing the last claim removes the attribute.
Animation components should not set animation-specific hidden attributes.

## Render Layers

`BoardAnimationLayer.svelte` renders board-space sprites inside the tilted
`.game-board-plane`. It handles board moves, attached-card moves, deck mill,
deck placement, and shuffles. Geometry is measured with `localRectIn`, which
accumulates offsets inside the untransformed board plane. The sprite inherits
the same 3D transform as the real cards, so in-plane motion needs no perspective
projection.

`ViewportAnimationLayer.svelte` renders viewport-space sprites with
`position: fixed`. It handles hand plays and evolutions, draws, mulligan resets,
prize takes, damage floats, knock-outs, and target effects. Cross-plane landings
use `planeGeometry.ts`; `cssMatrix3dForQuad` projects a flat sprite onto the
board destination quad.

Target effects use `applyTargetEffect` on real elements. Attach slide-under,
prize placement, attack and ability announcements, and lunges are not separate
card sprites unless the motion contract says they are.

Replay and live play use different handoff policies. In replay, sprites and hide
claims hold until the phase scope ends. Cleanup waits for a 40ms settle window
and two pre-paint frames before release. In live play, per-motion timers release
after travel; when required, the layer polls until the destination card exists.

## Invariants

Exactly one system animates a given event. Old animation paths must be gated off
for events owned by the new backbone.

Sprites render from view data through the normal board components, such as
`BoardSlot` and `CardTile`. They do not clone live DOM nodes.

All animation-time hiding goes through the visibility manager and the single
`data-anim-hidden` attribute.

Anchor queries skip `[data-anim-layer]` subtrees, so animation sprites cannot be
resolved as live source or destination elements.

The moving visual has one owner. If the final game state already contains the
destination card, that destination stays hidden only until the handoff. If the
final game state omits the source card, the layer uses the previous visual
state or a semantic sprite rather than letting the source disappear early.

Board-plane animations and viewport animations do not share coordinate systems.
Cards that start and end on the tilted board stay in the board plane. Cards
moving between hand and board use the viewport layer and explicit cross-plane
projection.

## Reveal Sessions

Reveal and search effects (deck to looking zone, selected cards to hand or an
attach target, the rest back to the deck) are a session, not independent
motions. `RevealSessionLayer.svelte` holds sprite state keyed by looking-zone
serial across replay phases: a phase change keeps the session alive when the
incoming phase continues the same reveal effect and clears it otherwise.
`attach-under` effects are consumed by two renderers with mutually exclusive
guards: the viewport layer plays a hand attachment when the source card is in
a hand; the reveal layer plays it when the source serial is a held session
sprite.

## Live Play

Live play shares the entire pipeline — choreographer, anchors, visibility,
renderers — **and the same phase / pre-state builder as replay**. A live engine
response is a batch of newly settled logs; `LocalEngineController.appendSteps`
event-sources both hands (`LiveObservationNormalizer`), synthesizes the ability
announces the engine never logs (`logsWithSynthesizedAnnounce`, the twin of
replay's `logsWithSynthesizedAbility`), and then builds each step through the
**same** `stepAnimationPhases` / `projectedViewForEvents` machinery replay uses.
So a live step animates its events against a per-phase *pre-state* view — the
board as it was *before* that beat — exactly like a replay step. There is no
longer any "animate the unseen tail against an already-updated board" path; that
older model is gone.

The gate is uniform (`AnimationEventGate`, see `gate.ts`): a scope is one
animation step — a replay phase or a live step — and each carries exactly its
own events, so a scope change animates the whole list and an unchanged scope
(the settled interactive view, or the cumulative log-panel timeline) animates
nothing. `App.svelte` sets `animationScopeKey = live-${lastTimelineEventId}` so
the key changes every live step.

What is still genuinely live-specific:

- **Pacing signal.** Replay is paced by its own phase timeline. Live is paced by
  the stepper in `game.svelte.ts`: show a step, wait the configured gap
  (50–2500ms), then wait for the layers to report idle. The layers publish a
  busy-until estimate through `animationActivity` (`activity.ts`) — this
  `extendBy` reporting runs only in live (`if (!replayMode)` in all three
  layers).
- **Scope/session boundary key.** Reveal sessions and per-scope cleanup key off
  the *turn* in live (`turnKey`) versus the per-step *scope key* in replay
  (`scopeChanged`), because a live reveal must survive multiple steps within one
  turn.
- **Sprite → destination handoff.** Replay holds board-space sprites until the
  phase scope ends (a 40ms settle plus two pre-paint frames, then release). Live
  instead releases per motion and, when required, polls until the destination
  card exists (`handOffWhenDestinationReady`, `handoffMaxWaitMs`). This is the
  "two clocks" the 2026-07-09 holistic audit flags for unification onto replay's
  deterministic hold-to-boundary model.

Principled live-only behaviour (not divergence to remove): interactive
decisions, concealed opponent hands and prize concealment, and the follow-active
camera. Everything downstream of "here is the next view" is shared.
