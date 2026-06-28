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

Animations should have one clear owner for the moving visual. When the final
game state already contains the destination card, hide that destination only
until the animated card hands off to it. When the final game state omits the
source card, snapshot the previous visual state and animate that snapshot rather
than letting the source disappear.

Keep card motion in the correct frame of reference for the whole animation. If a
card starts or ends in a tilted board zone, either animate inside that coordinate
system or smoothly transition between the hand and board transforms. Avoid end
snaps, duplicate cards, and placeholder overlays that visibly change badges,
card aspect ratios, or stack layout.

Polished animation coverage requires a real visible source anchor and a matching
motion component. Do not mark projected state changes as polished just because
the replay state updates correctly; pre-evolution stack cards and other hidden
sub-zones need explicit DOM anchors before they can claim motion coverage.

Timer-driven animation components must be scoped to the replay phase. Any
timeouts, sprite nodes, temporary CSS classes, and `data-*` hidden flags should
be tracked centrally and cleared on replay-scope changes and component destroy.
Stale timers that reveal or hide old DOM after scrubbing are a common source of
flicker.

For handoffs, keep exactly one visible owner. Hide the destination while the
sprite is moving, keep the sprite visible at the destination, then reveal the
real destination and remove the sprite in the same handoff moment. Avoid fading
the sprite out before the destination appears.

Board-plane animations and viewport/hand animations are different coordinate
spaces. A card that starts and ends on the tilted board should stay inside the
board plane. A card moving between the board and the hand needs an explicit
cross-plane transition; do not fake a hand target inside the tilted board layer.

## Checks

Do not run expensive checks reflexively after every small CSS tweak. Agents are
expected to reason carefully.

Run `npm run build` and `npm test` for larger changes, behavior changes, shared
component changes, prompt-selection logic, game-state logic, or before committing
a meaningful batch. For very small visual-only edits, a targeted inspection is
often enough.

## Public Boundary

Do not add Kaggle native binaries, raw competition bundles, or generated local
match artifacts to this repo. Local CABT play should consume user-supplied
resources through `CABT_SAMPLE_SUBMISSION_DIR`.
