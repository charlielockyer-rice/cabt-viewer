# CABT Viewer Agent Notes

# Project Shape

This is the Svelte 5 viewer for CABT battle states and replays. The
goal is not to make a generic app shell or a demo UI. The goal is a readable,
fast, faithful play surface where the board state is obvious and the player can
act without fighting the interface.

## Keep It Simple

KISS: keep it simple. We do not like hacks. We like clean, robust code that
follows normal frontend and Svelte best practices. Dumb hacks, brittle special
cases, and clever fixes that only work for one screenshot are not acceptable.

## Build For Obviousness

Fight for obvious UI. If a card is playable, selected, attached, damaged,
hovered, or being targeted by a prompt, that state should be visually clear
without explanation. Prefer direct visual mappings over clever abstractions:
cards should look like cards, attachments should sit on the Pokemon they belong
to, and scroll/overflow affordances should appear where the player needs them.

When a visual detail feels wrong, fix the underlying layout or component rule
instead of piling on z-index tricks, magic offsets, or wrappers that only happen
to work for the current screenshot. Shadows, hover states, selected states,
masks, and overlays should have enough layout room to render cleanly.

Do not shrink important cards just to make overflow easier. Preserve card scale
and board readability unless the user explicitly asks for smaller cards. Prefer
scrolling, stable responsive tokens, and clear layout constraints.

## Svelte 5

Use Svelte 5 patterns. Prefer `$state`, `$derived`, and `$effect` for component
state and reactivity. Keep state local when it belongs to one component. Do not
introduce stores, context, or global coordination for one-off UI behavior.

Use the existing component primitives and tokens before adding new structure:
`CardTile`, `BoardSlot`, `Hand`, `SelectableCard`, `PromptPanel`, and the sizing
tokens in `TableShell.svelte` and `styles/tokens.css`.

## Rewrite Freely

We are not optimizing for extreme legacy compatibility inside this app. If a
first version of a feature needs to change a few prompts later, do not layer
compatibility slop on top of it. Remove or replace the earlier approach when
that produces simpler, clearer code.

It is fine to throw out code that no longer matches the product direction. Smart
agents can write better code than they can maintain a pile of special cases.
Prefer one clean current path over preserving several historical paths.

## Visual QA

For UI changes, reason through the actual states the player will see: active
Pokemon, benched Pokemon, hand cards, overflowing hands, prompt dialogs, hover,
selected, disabled, face-down, and attached-card states.

Watch especially for clipping, accidental shrinking, layout shifts, text
overlap, mismatched scale between active and bench views, and shadows or glows
being cut off by scroll containers.

## Animation Development

Read `docs/replay-animation-architecture.md` before touching animation code.
The short version: `choreograph()` in `src/lib/anim/motions.ts` is the single
classifier from timeline events to motions and target effects; the render
layers (`BoardAnimationLayer`, `ViewportAnimationLayer`, `RevealSessionLayer`)
resolve anchors and execute; all animation-time hiding goes through
`animVisibility` and the one `data-anim-hidden` attribute.

Rules that keep this system flicker-free:

- One system animates a given event. New animation behavior goes into the
  choreographer and an existing layer; do not add per-component event
  classification, private hidden attributes, or component-local hide maps.
- Sprites render from view data through `BoardSlot`/`CardTile`. Never clone
  live DOM for a sprite, and never let an anchor query resolve inside a
  `[data-anim-layer]` subtree.
- When the final game state already contains the destination card, hide that
  destination with a visibility claim only until handoff. When the final state
  omits the source, use the pre-render snapshots (hand cards, attached badges)
  rather than letting the source pop out early.
- Timers belong to a layer, guarded by its generation counter, and are cleared
  on scope changes and destroy. In replay, board-space sprites and claims hold
  until the phase scope ends; the phase transition is the handoff. Do not
  reveal old slots from inside a renderer.
- Board-plane and viewport animations are different coordinate spaces. A card
  that starts and ends on the tilted board stays inside the board plane
  (offset-sum geometry); a card crossing between hand and board uses the
  viewport layer and the homography in `planeGeometry.ts`.
- Preserve the animation look. Keyframes, easings, and timing constants are
  the product; change them deliberately, not as a refactor side effect.

Craft rules that keep motions reading as one physical event:

- Land on the visible destination surface, not the broad container. For discard
  piles that is the `.discard-card-top .card-tile`; landing on the pile button
  reads as the card going to the bottom and then flickering to the top.
- Handoff is identity-specific and paint-ordered: hide only the real
  destination card for the serial being animated, keep the sprite fully visible
  through its final frame, reveal the destination DOM underneath it, then
  remove the sprite after a short settle. Never fade the moving card out before
  the destination is painted.
- For staggered batch placements (two Poffin targets), earlier sprites hold at
  their final position until the whole placement phase and its transition have
  caught up; the first sprite must not hand off alone.
- If an attached card renders as a badge or crop, do not animate a full card
  out of the badge rectangle — use the owning Pokemon's card footprint. Source
  Pokemon may occlude a card sliding out from under them; destination piles must
  not occlude cards landing on top of them.
- A played Trainer with follow-up phases stays in the play zone until every
  phase has resolved. It must not flicker into discard during intermediate deck
  search, bench placement, attach, switch, draw, shuffle, or damage phases.
- Search/reveal effects must make the chosen card visually distinct and stable
  while the unselected revealed cards return to the deck. When a selected reveal
  card later moves to hand, normalize from its current visual center at the
  start of the take phase rather than rewriting geometry on a timer at the end
  of the reveal phase.

## Checks

Do not run expensive checks reflexively after every small CSS tweak. Agents are
expected to reason carefully.

Run `npm run build` and `npm test` for larger changes, behavior changes, shared
component changes, prompt-selection logic, game-state logic, or before committing
a meaningful batch. For very small visual-only edits, a targeted inspection is
often enough.

## Public Boundary

Do not add native engine binaries, engine bundles, or generated local match
artifacts to this repo. Local CABT play consumes user-supplied resources
through `CABT_ENGINE_DIR`.
