# Component Animation Notes

- Keep board and pile animations in the same transformed frame as the board. Prefer destination-owned animations, such as a pseudo-element or child anchored to the final slot, so the card does not snap when the animation hands off to the real UI.
- For animations that cross from flat UI into the tilted board, a fixed animation layer is acceptable only when it maps the card to the exact final viewport quad. Do not use approximate fixed overlays for board destinations.
- When replay state already contains the destination card, hide that real destination content until the animated card arrives. This avoids showing the animated card and final card at the same time.
- Drive animations from structured event fields, serials, and stable `data-*` anchors instead of parsing log text.

## Replay Animation Invariants

- Fully migrate replay animations to phase plans. Once a replay animation is plan-owned, remove the old replay event branch instead of keeping a parallel fallback; live/non-replay event animation can remain as a separate path when the interactive viewer still needs it.
- Do not preserve compatibility scaffolding for newly written replay animation code. This animation system is young enough that a clean replacement is better than a stack of legacy branches, retry paths, or one-off fallback selectors.
- Planned replay motions must resolve exact semantic anchors. If a motion supplies a serial/card/name identity, do not retry against the broad anchor without that identity; broad retries can grab the wrong DOM element and cause alternating flicker.
- Visibility and handoff should be owned by the phase plan. If a planned motion cannot find its source or destination, fix the plan's anchor/phase view instead of adding a component-local fallback selector.
- Replay visibility claims are derived from motion `handoffPolicy`; do not add caller-supplied claim lists or component-local hidden attributes for planned replay paths. Local fallback attributes are only acceptable for live/non-replay animation paths that do not yet have a phase plan.
- Replay animations must be replayable. If a user scrubs away from a step and returns, the same phase should animate again. Use per-scope de-duping only to suppress duplicate work during the current render/phase, and clear it when the replay scope changes.
- Prefer phase-scoped action timelines for phase-owned animations. A replay step can contain several logical phases, and using the whole step timeline from a component that should animate one phase can cause skipped source states or duplicate animation.
- Guard replay phase timers against stale callbacks. A timer created for one step/phase must not advance a later step after the user scrubs.
- Migrated replay paths should have one owner for moving card visuals. Use central source/destination visibility claims for the phase; do not add component-local hidden maps, hidden attributes, or timer cleanup systems for those paths.
- Keep source cards in the phase view while a motion owns them, and hide them through visibility claims until handoff. Do not project the source away and then rebuild it with local snapshots unless the source truly is absent from the final replay state.
- Evolve animations should target the board slot/Pokemon stack, not a hand-style viewport target. Hide the moving evolution card as needed, but do not hide the pre-evolution destination stack; it should remain the visible landing context.

## Board-Origin Cards

- Cards that start on the board and end on the board should stay in the board plane for the whole animation. Avoid viewport/fixed layers unless the animation explicitly transitions between UI coordinate systems.
- Resolve board-plane source and target rectangles through the shared DOM geometry helpers. Do not add component-local offset-parent or viewport fallbacks that can silently pull a card out of the tilted board frame.
- Cards that end on the board should also finish in the board plane. Deck-to-bench and deck-to-active effects, such as Buddy-Buddy Poffin, should use board-local motion layers rather than fixed reveal overlays; otherwise the card appears to leave the tilted table and snap back into perspective at handoff.
- If an attached card is represented as a small badge or crop on the board, do not animate a full card from the badge rectangle. Use the owning Pokemon card footprint when the intended effect is a full card sliding out from under that Pokemon.
- Preserve visual stacking intent: source Pokemon should be able to occlude a card that slides out from underneath it, but destination piles should not occlude cards that are landing on top of them.
- Target the visible destination surface, not the broad container. For discard piles, land on the `.discard-card-top .card-tile` when it exists; landing on the pile button/container often looks like the card goes to the bottom and then flickers to the top.
- Handoff should be identity-specific. Hide only the real destination card for the serial/card being animated, and keep the animated sprite alive long enough for the final DOM card to appear without a one-frame flash.
- Do not fade out a moving card before the destination card is painted underneath it. The usual handoff should be: keep the sprite fully visible through its final frame, reveal the destination DOM in the same position, then remove the sprite after a short settle window.
- For batched placement animations with staggered starts, such as two Poffin targets, do not let the first sprite hand off before the whole placement phase is ready. Earlier sprites may need to hold at their final position until the last staggered card and phase transition have caught up.

## Resolving Trainer Effects

- A played Trainer that has follow-up phases should stay in the play zone until every effect phase has resolved. Do not let it appear in discard during intermediate deck search, bench placement, attach, switch, draw, shuffle, or damage phases.
- Resolving Trainer cleanup must be tied to the specific played card that owns the effect. Do not use a broad event-kind list such as "any Switch/Draw/Shuffle means the current resolving card is done"; unrelated later actions can then discard or hide the wrong play-zone card.
- Cards like Buddy-Buddy Poffin should read as one resolving effect: the Trainer is played, deck cards move to the board, the deck shuffles if needed, and only then does the Trainer move to discard. The Trainer should not flicker between play zone and discard while the benched Pokemon land.
- Search/reveal effects should make the chosen card visually clear. Keep selected cards distinct and stable while unselected revealed cards return or shuffle back, instead of splitting reveal and selection into unrelated-looking replay steps.
- When a selected reveal card later moves to hand, normalize from the selected card's current visual center at the start of the take phase. Avoid timer-based geometry rewrites at the end of the reveal phase; they create the small growth/shrink stutters that look like flicker.
