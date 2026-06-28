# Component Animation Notes

- Keep board and pile animations in the same transformed frame as the board. Prefer destination-owned animations, such as a pseudo-element or child anchored to the final slot, so the card does not snap when the animation hands off to the real UI.
- For animations that cross from flat UI into the tilted board, a fixed animation layer is acceptable only when it maps the card to the exact final viewport quad. Do not use approximate fixed overlays for board destinations.
- When replay state already contains the destination card, hide that real destination content until the animated card arrives. This avoids showing the animated card and final card at the same time.
- Drive animations from structured event fields, serials, and stable `data-*` anchors instead of parsing log text.

## Replay Animation Invariants

- Replay animations must be replayable. If a user scrubs away from a step and returns, the same phase should animate again. Use per-scope de-duping only to suppress duplicate work during the current render/phase, and clear it when the replay scope changes.
- Prefer phase-scoped action timelines for phase-owned animations. A replay step can contain several logical phases, and using the whole step timeline from a component that should animate one phase can cause skipped source states or duplicate animation.
- Guard replay phase timers against stale callbacks. A timer created for one step/phase must not advance a later step after the user scrubs.

## Board-Origin Cards

- Cards that start on the board and end on the board should stay in the board plane for the whole animation. Avoid viewport/fixed layers unless the animation explicitly transitions between UI coordinate systems.
- Cards that end on the board should also finish in the board plane. Deck-to-bench and deck-to-active effects, such as Buddy-Buddy Poffin, should use board-local motion layers rather than fixed reveal overlays; otherwise the card appears to leave the tilted table and snap back into perspective at handoff.
- If an attached card is represented as a small badge or crop on the board, do not animate a full card from the badge rectangle. Use the owning Pokemon card footprint when the intended effect is a full card sliding out from under that Pokemon.
- Preserve visual stacking intent: source Pokemon should be able to occlude a card that slides out from underneath it, but destination piles should not occlude cards that are landing on top of them.
- Target the visible destination surface, not the broad container. For discard piles, land on the `.discard-card-top .card-tile` when it exists; landing on the pile button/container often looks like the card goes to the bottom and then flickers to the top.
- Handoff should be identity-specific. Hide only the real destination card for the serial/card being animated, and keep the animated sprite alive long enough for the final DOM card to appear without a one-frame flash.
- Do not fade out a moving card before the destination card is painted underneath it. The usual handoff should be: keep the sprite fully visible through its final frame, reveal the destination DOM in the same position, then remove the sprite after a short settle window.
- For batched placement animations with staggered starts, such as two Poffin targets, do not let the first sprite hand off before the whole placement phase is ready. Earlier sprites may need to hold at their final position until the last staggered card and phase transition have caught up.

## Resolving Trainer Effects

- A played Trainer that has follow-up phases should stay in the play zone until every effect phase has resolved. Do not let it appear in discard during intermediate deck search, bench placement, attach, switch, draw, shuffle, or damage phases.
- Cards like Buddy-Buddy Poffin should read as one resolving effect: the Trainer is played, deck cards move to the board, the deck shuffles if needed, and only then does the Trainer move to discard. The Trainer should not flicker between play zone and discard while the benched Pokemon land.
- Search/reveal effects should make the chosen card visually clear. Keep selected cards distinct and stable while unselected revealed cards return or shuffle back, instead of splitting reveal and selection into unrelated-looking replay steps.
- When a selected reveal card later moves to hand, normalize from the selected card's current visual center at the start of the take phase. Avoid timer-based geometry rewrites at the end of the reveal phase; they create the small growth/shrink stutters that look like flicker.
