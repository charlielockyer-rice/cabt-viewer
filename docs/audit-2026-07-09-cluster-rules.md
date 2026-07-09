# Viewer animation clusters — rules + root causes (2026-07-09)

Charlie surfaced seven live/replay animation issues (Tasks 3–9). They are not
seven independent bugs; they fall into three clusters that each share one piece
of machinery. This doc states, per cluster, the RULE the system should follow,
the current behavior, and the per-task root cause. Fixes implement against the
rule, and tests assert the rule generally (not just one repro).

Shared context established while investigating: **live play reuses the replay
phase machinery.** `localEngine.appendSteps` calls
`stepAnimationPhases(previousView, step, actionTimeline)` (exported from
`cabtReplay.ts`) and pushes one `GameView` per phase into the playback sequence.
`game.svelte.ts` then sets each phase view, waits a step delay, and waits for the
animation layers to report idle (the "one clock" hold-to-boundary from e39e69d).
The animation layers build motions from `view.actionTimeline` against
`view.players`. So a phase view is correct iff its `players` is the pre-state the
motion should animate against, and its `actionTimeline` is that phase's events.

---

## Cluster A — phase-boundary partitioning (Tasks 4, 5, 7)

Machinery: `animationEventPhases` / `animationPhaseKey` / `animationPhaseUsesSourceView`
/ `animationSourceViewForPhase` / `groupedStepAnimationPhases` in `cabtReplay.ts`.

### RULE
1. A step's event batch is split into typed phases; each phase renders against
   the board state BEFORE that phase resolves (its pre-state), and animates its
   own events forward.
2. **Turn transitions are hard boundaries.** Events after a `TurnStart` belong to
   the NEW turn and must form their own step(s), whose pre-state is the new
   turn's board — never fold a new-turn start-of-turn draw into the previous
   player's attack step. The seat/perspective switch happens at the boundary,
   before the draw animates, and the draw animates exactly once.
3. **A KO promotion is its own beat.** After a knockout resolves (departure +
   prize take), the defender's new active entering from the bench is a distinct
   phase with an empty-active pre-state and a bench→active motion — not folded
   into the KO aftermath.
4. **A board swap animates against the pre-swap board.** The card entering active
   wears the incoming Pokemon's face and travels bench→active; the card leaving
   active travels active→bench. This holds for Boss's Orders, retreat, and any
   effect-driven switch, whatever the underlying event shape.

### Current behavior / gaps
- **Task 4 — FIXED (commit c3e1c38).** Root cause was NOT the swap phase itself:
  a retreat discards the active's energy (ENERGY→DISCARD) then swaps (`Switch`),
  coalesced into one step, energy first. `applyReplayAreaDelta`'s ENERGY/TOOL
  branch resynced the whole `active`/`bench` to `currentPlayer` to update badges,
  importing the post-swap board POSITIONS into the running `phaseStartView`; the
  following BoardMove phase then built its "pre-swap" source view from that
  contaminated view. Boss's Orders has no preceding energy move, so it was fine.
  Fixed by making an energy/tool move update only the badges of the holding
  Pokemon (matched by serial, position preserved) — verified against real Kaggle
  frames 22-24 and regression-tested (swap phase view is pre-swap).
- **Task 5 — root cause pinned, live-path fix pending.** Rule 2 is ALREADY
  enforced in REPLAY: the step builder splits the Itchy-Pollen boundary batch
  (real frame 26 = [Attack, HPChange, TurnEnd, TurnStart, Draw]) into an attack
  step and a separate "turn started" step carrying the draw. The LIVE path does
  NOT: `localEngine.appendSteps` runs `stepAnimationPhases` on each whole
  observation and never splits at `TurnStart`, so the opponent's start-of-turn
  draw animates inside the attacker's step (then the seat flip re-renders and it
  re-animates). FIX (concrete mechanism): `replayActionGroups(events, turn)` is
  the reusable pure splitter — its `forcedStepTypes` = {TurnEnd, TurnStart,
  PokemonCheckup, Result} already start new groups. `localEngine.appendSteps`
  should split each observation's `stepLogs` into groups with it and emit a step
  per group, the new-turn group's view PROJECTED (post-transition, pre-draw)
  rather than the single bridge end-state — i.e. adopt replay's
  buildDecisionSteps/projection discipline on the live side instead of one step
  per observation. Two sub-parts: (1) the partition (step-level testable, low
  risk); (2) the seat-flip double-render (the second draw after the perspective
  switch) — a live-runtime concern still to be located (game.svelte.ts / the
  follow-active flip / turnKey release) needing Charlie's visual confirmation.
  Ship (1)+(2) together; a partition-only fix may still double-render.
- **Task 7 — same boundary machinery.** Real KO→promotion (frames 92-95): KO
  frame (active→discard + area-10 pre-evo stack→discard + energy→discard), then
  opponent prize-take frame, then a promotion frame [BENCH→ACTIVE, TurnEnd,
  TurnStart, Draw]. Promotion arrives bundled WITH the turn boundary, so it
  rides the same live split as Task 5. Replay isolates the promotion + new-turn
  draw; live needs the same TurnStart split, plus promotion as its own beat.

---

## Cluster B — visibility-claim serial-strict doctrine (Tasks 6, 8)

Machinery: `anchors.ts` `resolveAnchor` (+ `pokemonElement`, `discardCardElement`,
hand-slot resolution); `visibility.ts` claims; `RevealSessionLayer` /
`ViewportAnimationLayer` claim issuance.

### RULE
1. **A serial names exactly one physical card.** A claim carrying a serial
   resolves to that card's element or to nothing — it NEVER falls through to a
   cardId match that could hide a same-name copy. (Already true for
   `pokemonElement`; hand-slot resolution returns null rather than a positional
   stand-in when a serial is present.)
2. **Every departing card claims its source element** the moment its sprite
   leaves, so sprite and static card never coexist — the static clears as a
   claim handoff at the motion boundary, not as a post-animation snap.

### Current behavior / gaps
- **Task 6**: the prize-take path (`ViewportAnimationLayer`, prize-take branch)
  claims the TARGET hand slot but NOT the source prize slots — confirmed in code:
  it computes `prizeSourceRects` for origins but issues no visibility claim on
  the prize elements. So the taken prize cards stay painted in their slots during
  the flight and only clear when the post-animation view lands. Fix: claim the
  specific source prize slot elements (per-slot, real origins) for the taken
  prizes; the count decrement becomes the claim handoff. Both own and opponent.
- **Task 8**: Punk Up reveals/attaches Dark Energy from deck and same-id Dark
  Energy copies vanish from hand. The board `pokemonElement`, hand-slot, and
  reveal-session paths already resolve serial-strict in the code I read, so the
  offending claim is a remaining cardId-fallback (or serial-less claim) reaching
  hand tiles. NEEDS the real Punk Up reveal/attach batch to see which claim is
  issued for the deck-revealed card and how it resolves to hand copies; the fix
  extends Rule 1 to that site (claim nothing if the exact target can't resolve).

---

## Cluster C — reveal-session endpoint + coverage (Tasks 3, 9)

Machinery: `revealLayout.ts`, `RevealSessionLayer.takeRevealedCard` /
`handTargetForMotion`, `actionAnimationCoverage.ts`.

### RULE
1. **A card travelling into the hand lands at the settled hand-card rect** — the
   size and position the real card will occupy once the hand has re-laid-out —
   not a transient/placeholder size.
2. **A public zone move with known identity gets the reveal treatment.** A
   recovered/searched card whose identity both players may see is revealed, then
   travels to its destination.

### Current behavior / gaps
- **Task 3**: reveal→hand lands too small, then snaps to full size. Reveal-take
  (`RevealSessionLayer.takeRevealedCard`) targets the hand by SERIAL
  (`motion.to = {hand-slot, serial}`) and sizes the landing from
  `handCardVisualRect(target.element)` of that exact freshly-inserted slot — so
  it measures the incoming card mid-layout (narrow), and `exitScale =
  target.width / takeSource.width` lands the sprite at that narrow width. Draws
  target the hand by POSITION (`fromEnd`, serial undefined), measuring a settled
  slot. Fix: land the reveal-take at the settled hand-card rect (measure the
  destination the way draws do / defer to the settled slot), so endpoint = the
  real card's final rect. The target-rect derivation is unit-testable.
- **Task 9**: Night Stretcher (DISCARD→HAND recovery) plays static because
  `actionAnimationCoverage` classifies DISCARD→HAND as 'static'. Reclassify to
  'polished' when card identity is present, and add a reveal-style DISCARD→HAND
  motion (lift from discard, reveal, travel to hand — reusing the Task 3 landing
  geometry). Keying on the MOVE (DISCARD→HAND) rather than the card gives energy
  recovery abilities the same animation for free. Coordinate with Task 3.

---

## Notes

- Area code 10 = the pre-evolution stack, confirmed against
  `CabtAreaType.PRE_EVOLUTION` (types.ts). On a knockout the whole evolution
  stack empties to discard via area-10→discard MoveCards (real frame 93). The
  Task 4 fix deliberately left the PRE_EVOLUTION area-delta on the whole-board
  resync (unchanged) so KO discard handling is untouched.

## Status (end of 2026-07-09 night)

SHIPPED (green, pushed, real-data-backed tests):
- Task 1 — classifier unification (`a394469`).
- Task 2 — pre-state leak fix (`b830849`), validated on real episode 84924975
  (`bb004b2`): the real attach/placement frames coalesce into one step, so the
  same-step deferral covers Charlie's actual bug.
- Task 4 — retreat reversal (`c3e1c38`): energy/tool moves no longer resync
  whole board positions, so the swap phase renders pre-swap.
- Tasks 5 + 7 — live TurnStart split (`e8dda91`): the new turn's draw/promotion
  are their own beats in the correct perspective. (Seat-flip double-render is a
  separate runtime piece, pending Charlie's visual check.)
- Task 3 — reveal→hand lands at the settled sibling hand-card width (`0e42fe3`).
- Task 6 — prize take lifts + hides the real source prize slots (`9971f8c`).
- Task 10 (Charlie follow-on) — an on-attach-effect energy (Telepath/Enriching)
  announces its name at the attach beat (`40cd916`). Keyed on printed "When you
  attach this card" text (exactly 2 cards; a naive has-skills rule would have
  announced 37 passive Tools/energies as noise). One approved oracle reshape: two
  attach-announce fixtures that asserted a basic energy announcing an ability.

NOT LANDED:
- Task 8 — no Ability/Punk Up event in episode 84924975; needs a different
  decoded day or a synthesized triggered-attach fixture. Correctness bug, so
  worth the real repro before fixing.
- Task 9 — plan above; needs a discard-sourced reveal motion. The reveal session
  hardcodes the deck as the source in `RevealSessionLayer.spritesForPlayer`, so
  it needs a per-motion source (deck vs discard) gated on a new `discard-reveal`
  style, plus the coverage reclassify + a motions.test assertion. Additive but
  DOM-runtime; deferred rather than risk the working deck-search reveal headless.
  Reuses the Task 3 landing geometry once built.

Dev-log: `agent-lab/journal/2026-07-09-viewer-cluster-fixes.md` (with the
eyeball checklist for Charlie's morning game).
