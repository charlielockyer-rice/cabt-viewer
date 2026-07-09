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

---

# Round 2 (2026-07-09 later) — replay-path boundary residue + cosmetics

Charlie play-tested the REPLAY viewer against Kaggle episode 84924975 and found
that several round-1 fixes did not hold on the replay path. Root-caused against
the episode with a step/phase dumper (fork points he handed in). The unifying
rule extends round 1's Cluster A to **both modes**:

> A turn transition and any active-vacating event get their own beat, with a
> pre-view that carries forward the running projected state — cross-boundary
> events are absent from every pre-boundary view, and a board mutation shown in
> one beat never reverts on the next.

## Replay boundary/view-sync cluster (R1 / R2 / R3) — FIXED (`1e0e879`, `2fae9d8`)

Round 1 fixed the LIVE per-observation path (`e8dda91`) and added a replay test
(`cabtReplay.test.ts` "does not show a later turn-start draw…"), but that test
only exercises the `stepsForFrameGroups` path. In real play the action follows a
main-menu decision, so it is built as an **open step** (`openStepToReplayStep`)
— the path all three symptoms slipped through.

- **R1 — pre-boundary draw leak (frames 26/48, Itchy Pollen).** The open attack
  step left `displayView` undefined when its own frame carried a forced tail
  (`TurnEnd`/`TurnStart`), so `replay.svelte` fell back to `views[stateIndex]` —
  the raw frame-END view with the opponent's start-of-turn draw already applied
  (hand 7 on the attack step, revert to 6 on turn-end, then the draw animates).
  Fix: pass the forced tail as deferred projection context so the settled view
  projects to the open group's end, rebuilding hand/board from the pre-open state.
- **R2 — attack-caused switch reverts (frame 38/39, Abra Teleportation).** The
  engine puts the `Switch` in the transition frame; the builder attributes it to
  the attack step, but the `open` branch of `buildDecisionSteps` (unlike the
  `rootFrame` branch) dropped this frame's consumed leading groups from the
  trailing steps' projection base, so `TurnEnd`/`TurnStart` rebuilt from
  `views[index-1]` (pre-switch) and reverted the active until the next raw frame.
  Fix: prepend this frame's consumed leading groups as projection context.
- **R3 — ability-vacates-active promotion is instant (frames 50/51, Run Away
  Draw).** Two `applyReplayAreaDelta` branches imported the step's END board
  (promotion already done) on events that PRECEDE the promotion: the `ACTIVE`
  delta copied `currentPlayer.active` for both directions (so the vacate pulled
  the promoted Pokemon in), and the `PRE_EVOLUTION` delta whole-board resynced
  active/bench (re-promoting right after the vacate). Fix: a departure from
  `ACTIVE` vacates the slot (empty); a `PRE_EVOLUTION` move no longer touches the
  board (it changes one Pokemon's stack, like the Task 4 energy/tool fix — this
  **supersedes** the Notes bullet above that left PRE_EVOLUTION on whole-board
  resync). The promotion now animates bench→active from an empty-active pre-state.

Regression tests added (open-step path, not touching round-1 assertions): the
draw-leak guard, the switch-carry-forward guard, and the coalesced-promotion
guard (`active.empty` through the shuffle beat and on the BoardMove source view).

**R3 side question — why fork stateIndices skip (49 → 51):** view 50 is the
transient mid-ability observation (active vacated, promotion not yet applied).
The replay builder coalesces the ability's frames (50 + 51) into one decision
step, so 50 never becomes its own fork. Confirmed: it is the empty-active
intermediate the promotion beat now animates from — a multi-observation state,
exactly the "checkup/auto-resolution frames" hypothesis.

## Claim/handoff residue cluster (R4 / R6 / R7 FIXED, R5 documented)

Round-1 visibility claims that release at the wrong boundary in replay's paced
settle path (vs live's fast-advancing apply path). Two Sonnet investigators
root-caused these against the episode; the manager reached R6/R7 independently
and the reports converged.

- **R7 — Punk Up hides a same-id hand energy — FIXED (`b52f1ff`).** NOT a DOM
  claim: a view-projection removal. Punk Up attaches a Dark Energy from the
  DECK; the Attach event names the deck card's serial, absent from the hand.
  `removeBySerialOrCardId` (hand removal) fell through to cardId when the finite
  serial wasn't found, evicting the hand's other same-id Dark Energy until the
  next raw step rebuilt. Serial-strict fix: finite serial not found → return
  undefined, never fall through to cardId (mirrors `removeMovedCardFromZone`).
  The reveal/attach choreography is untouched. Episode step 67 / stateIndex 91.
- **R6 — prize-take flicker persists in replay — FIXED (`d27a967`).** Round-1
  (`9971f8c`) claims the source prize slots during the take, but a concealed
  take scheduled the claim release + sprite cleanup on `prizeTakeDirectMs`
  (520ms) while the phase holds for the canonical `prizeTakeMs` (1180ms) — a
  ~660ms window where the claim is gone but the settled post-take view hasn't
  landed, so the taken prize repaints in its slot. Schedule the claim/cleanup
  on the canonical `prizeTakeMs`; the 520ms stays visual-only (`.direct` CSS).
  Runtime timing (not headlessly verifiable). Episode step 68 / stateIndex 94.
- **R4 — Lillie shuffle old-hand flash — FIXED (`21ab3f6`).** Two compounding
  seams. (1) `animationSourceViewForPhase` listed `HandToDeck` in
  `animationPhaseUsesSourceView` but had no branch → fell through to
  `phaseStartView`, keeping the departing cards in the rendered hand all beat,
  where the sibling Play/Attach beats already drop them at motion launch. Added
  the branch (apply HAND→DECK moves at display time). (2) `startResets` skipped
  releasing the source claim in replay (`!replayMode`), deferring to `endScope`
  where the un-hide raced `Hand.svelte`'s out-transition → the flash; release on
  the same bounded schedule live uses. Fix (1) is headless-verified (phase hand
  now empty at stateIndex 45/85); fix (2) is runtime. One approved oracle
  reshape (the phased-views test asserted the pre-fix HandToDeck rendering).
- **R5 — evolution base-card blink — DOCUMENTED, not built (browser-rig
  follow-up, task #23).** Evolve is the only hand-play-family motion with no
  visibility claim on its destination (`motions.ts` evolve branch:
  `hide: []`, `hideResolvedTarget: !evolve` = false, `waitForDestinationCard:
  false`); it gets only the decorative chrome-fade effect, never covering the
  card art. So the pre-evolution card stays painted under the flying sprite, and
  when the sprite is removed the base shows for a beat if the evolved card's
  `<img>` hasn't decoded (main-thread jank — hence inconsistent across
  Alakazam/Kadabra/Dudunsparce). The investigator proposed a destination claim +
  destination-ready handoff replacing the `evolveVisibleMs` timer. **Refinement
  the manager found:** the timer is not the real coupling — `endScope()`
  (`ViewportAnimationLayer.svelte:790`) does `sprites = []` and releases ALL
  claims unconditionally on every scope change, so the evolve sprite is already
  cleared the instant the next view lands, and a destination claim would be
  released at that same tick. The robust fix therefore requires evolve to OPT OUT
  of `endScope`'s unconditional clear and hand off on a destination-ready poll
  (the evolved `cardId`/`serial` actually rendered in the slot), mirroring
  `BoardAnimationLayer.handOffWhenDestinationReady`, plus a destination
  `'contents'` claim held across that poll. This is an invasive change to the
  core scope-teardown path, is a paint-timing seam that headless tests cannot
  observe (synthetic tests lie about it — see `viewer-real-browser-probe`
  memory), and risks the evolve animation. Deferred to the real-browser rig
  rather than blind-shipped. Headlessly assertable precondition: `choreograph`
  emits zero hide claims and `waitForDestinationCard: false` for an Evolve event.

## Cosmetic (R8) — DOCUMENTED for a verified polish pass

Both are handoff-seam CSS/sprite issues; neither is verifiable headlessly (the
flicker is a paint-timing artifact) so they are documented, not blind-fixed —
verify any change with the real-browser rig (`viewer-real-browser-probe`).

- **Retreat shadow flicker.** `BoardSlot.svelte:191-196` transitions
  `box-shadow` and `filter` on `--transition-fast`. When a retreat swaps cards
  between slots, the settling slot's shadow/filter re-computes at the sprite→
  static handoff and the transition fires, reading as a shadow flicker under the
  card. Candidate fix: suppress the `box-shadow`/`filter` transition on slots
  that are receiving an animation handoff (a `data-anim-*` guard), or drop
  `box-shadow` from the transitioned properties if it is only wanted for hover.
- **Energy-discard white flash.** `.attached-move-card`
  (`BoardAnimationLayer.svelte:753-764`) fills `background: #f7f8fa` (near-white).
  On the first frame(s) of an energy attached→discard, that fill shows at card
  size before the inner `CardTile` paints — a harsh white flash on top of the
  card. Candidate fix: make the sprite background transparent (or the energy
  card-surface tone), or gate the sprite's opacity until the tile has painted.

## Pokemon Checkup (R9) — DESIGN NOTE, backlog (not built)

Between-turns status resolution (burn/poison ticks, sleep/paralysis checks)
arrives as `Poisoned`/`Burned`/`Asleep`/`Paralyzed`/`Confused` events, which the
coverage classifier rates **static** — so the checkup passes with no motion. Not
a bug; a coverage gap Charlie wants acknowledged. A checkup beat would be its own
step between `TurnEnd` and `TurnStart` (the builder already treats
`PokemonCheckup` as a forced group — see `forcedStepTypes`), animating each
status tick: a damage-float on the burned/poisoned Pokemon (reuse `damage-float`
+ `lunge`), a status-badge pulse for sleep/paralysis/confusion, and the coin flip
for wake/paralysis-recovery where the engine emits one. Keying on the status
event kind (not the card) gives every Pokemon the same treatment for free.
Requires: reclassify the status kinds to `polished`/`conditional` in
`actionAnimationCoverage.ts`, a checkup phase key + view in `cabtReplay.ts`, and a
status-tick motion in `motions.ts`. Deferred: additive, DOM-runtime, and better
built once the real-browser rig gates the status-badge visuals.

---

# Round 3 (2026-07-09, browser-verified) — the deferred items landed

Charlie approved local browser automation, so the three items deferred as
"paint-timing / DOM-runtime, unverifiable headlessly" were implemented AND
verified with the real-browser rig (Playwright + a private vite on 5174 loading
episode 84924975 in replay; Charlie's live 5173/8095 stack untouched). Method for
each: reproduce the defect with a per-frame DOM recorder (requestAnimationFrame),
CPU/network-throttled to force the seam, then prove it gone.

- **R5 — evolution base-card blink — FIXED (`c23a073`).** The evolve sprite + a
  destination `'contents'` claim now HOLD past `endScope`'s unconditional clear
  and release only when the evolved card element has rendered AND its `<img>`
  decoded (destination-ready poll, bounded safety). Polling starts after the
  full flourish (`evolveVisibleMs`) so a cache-warm evolve is unchanged. Rig
  evidence, identical throttle: blink frames (sprite gone AND evolved img
  undecoded) **70 → 0**; after-fix the sprite releases 34ms AFTER the paint vs
  ~580ms before it. Supersedes the "documented, not built" note above.

- **R8 — retreat cosmetics — FIXED (`c1a4262`).** (1) Shadow flicker: dropped
  `filter` from the `.board-slot` `--transition-fast` transition so a retreat's
  drop-shadow re-compute is instant, not animated. Verified: the slot's computed
  transition-property is now `background, box-shadow`. (2) White flash:
  `.attached-move-card` background `#f7f8fa` → `transparent` (the inner card-tile
  supplies the surface). Verified: near-white-bg-while-undecoded frames **3 → 0**.
  Supersedes the "documented for a verified polish pass" note above.

- **R18 / Task 9 — discard recovery flight — FIXED (`6696e75`).** DISCARD→HAND
  (Night Stretcher, Lana's Aid, Super Rod) now lifts from the discard pile and
  flies to the settled hand-card rect. Keyed on the MOVE so every recovery gets
  it free; reuses the hand-play flight (startHandPlay resolves the discard pile
  as the source when `from.kind === 'discard'`) — no new sprite/CSS. Coverage
  reclassified DISCARD→HAND static → polished (conditional without a cardId). Rig
  evidence: at the Lana's Aid 3-card recovery, **five hand-play sprites now fly
  discard→hand where there were zero**. One approved oracle reshape: the
  "uncommon static" coverage test's example moved to ENERGY→HAND (still static)
  plus positive DISCARD→HAND tests.

Still open: R9 (Pokemon Checkup animation) — design note only, not built.

The rig recipe (private vite 5174, no engine needed for replay, Playwright rAF
frame recorder, CDP CPU/network throttle to force paint-timing seams) is the tool
for the remaining paint-class work; see the `viewer-real-browser-probe` memory.

---

# Round 4 (2026-07-09, later) — the settle-seam rule + KO-seam fixes

Charlie's round-3 eyeball pass surfaced a cluster of settle/handoff seams
(residual prize flicker, retreat/Teleport shadow flicker, an evolve regression)
that all turned out to be ONE rule, verified with the real-browser rig.

## THE ROUND-4 RULE (the real deliverable)

**A visibility claim or animation sprite must release on the DESTINATION VIEW
LANDING — the view event that makes its hidden state redundant — never on a
fixed animation-duration clock.** A timer is only ever a *proxy* for "the view
has caught up"; every proxy that guesses wrong is a flicker. The failure comes
in two shapes:
- **GAP** — the claim/sprite releases BEFORE the destination renders → the thing
  it was covering shows blank for a beat (R5 evolve blink; the board-move
  gap-avoidance the settleMs defer protects).
- **OVERLAP** — the claim/sprite releases AFTER the destination is already
  authoritative → the destination and the sprite both render → a double (the #26
  switch double-shadow; the residual prize re-show is the same family from the
  other side).
The durable fix is always to gate release on the actual view event: an element
rendered+decoded, a count decremented, a scope/settle where the new occupant is
authoritative — not `setTimeout(prizeTakeMs)` / `settleMs`.

Fixes that now embody it: R4 (HandToDeck view drops the card so the reset claim
releases on a departed element), R5 (`c23a073` evolve sprite holds on a
destination-ready poll until the `<img>` decodes), the residual prize fix
(`d760688` — source-slot claim releases via endScope = the `prizesLeft`
decrement, not the sprite timer), #26 (`ca01cd8` — a switch's board-move sprites
drop synchronously with the settled un-hide, since their destination is already
authoritative).

## Timer-vs-view release-site inventory (audit these against the rule)

VIEW-GATED (correct):
- Evolve handoff — `ViewportAnimationLayer.startEvolveHold` destination-ready
  poll (evolved `<img>` decoded) + bounded safety.
- Prize SOURCE-slot claims — released via `endScope` (the `prizesLeft` decrement).
- Board-move switch settle — `BoardAnimationLayer.endScope`, no-held-claim path
  drops sprites synchronously with the un-hide.
- Hand-reset (Lillie) — the HandToDeck phase view drops the departing cards at
  display time, so the source claim releases on already-departed elements.

TIMER-GATED (still on a fixed clock — NOT bugs today, but audit before trusting;
each conversion needs its own rig evidence, do not batch-refactor):
- `startHandPlay` non-evolve (hand→board play): `motionReleases` at
  `startMs + visibleMs + 24`. Safe because the board slot is authoritative at the
  play, but clock-gated.
- `startPrizeTakes` TARGET hand-slot claim + sprite: `prizeTakeMs` timer (the
  taken card is in hand by then).
- `startResets` sprite + (now) source claim release: bounded `resetMoveMs + 120`.
- `BoardAnimationLayer` settle HELD-claim path: `settleMs` (40ms) — deliberate
  gap-avoidance for board-moves whose destination card may not have painted.
- Decorative sprite cleanups (damage-float, coin-flip, knock-out, deck-discard
  flip, attach-under, reveal-session leftovers): timers that remove NON-claim
  sprites — low risk (nothing hidden to leak), left as-is.

Still open: R9 (Pokemon Checkup animation, design note). #28 (bench resize) and
#29 (KO 4-step partition — held for Charlie's UX call; the flicker justification
was falsified: the KO motions already play sequentially, so the partition is a
pure step-clarity decision, not a flicker fix).

---

# #26 REOPENED — the switch shadow flicker is NOT fixed (ca01cd8 addressed a different seam)

Charlie hard-refreshed on a fresh 5173/8095 stack at 1151f0e (UNTHROTTLED) and
still sees the shadow flicker at the end of retreat/switch animations. So the
round-4 note above marking #26 "FIXED (ca01cd8)" is WRONG — corrected here.

What ca01cd8 actually fixed: a REAL but different seam — a ~65ms double-render
OVERLAP at the board-move settle (sprite + settled card both present). Measured
overlap 65ms→0. But that asserted element PRESENCE, never shadow CONTINUITY —
which is the thing Charlie perceives. The fix may even have turned the 65ms
double into a hard swap. A/B ca01cd8 (in vs reverted) as part of the redo.

LEADING HYPOTHESIS (geometry JUMP, not a presence gap): the board-move sprite
flies via a CSS transform — `--board-move-start-scale` = fromRect.width /
toRect.width, plus translate (BoardAnimationLayer ~460-465). A `box-shadow` on a
scaled/translated element renders SCALED and OFFSET with the transform, so the
flying card's shadow is a different size/blur/offset than the settled card's.
At the handoff the shadow JUMPS from the sprite's transformed shadow to the
settled card's normal shadow — present the whole time, but DISCONTINUOUS. It's
structural (shows unthrottled) and scales with the source↔dest size delta
(bench and active slots are different sizes), which explains "idk when it can
occur." This is failure shape (b) from the brief; rule it in/out with a geometry
trace before coding.

THE MISSING INVARIANT (Charlie's Q1 — "when are shadows supposed to show?"):
today the codebase states NO shadow-ownership invariant. A card's ambient shadow
(`CardTile` box-shadow) is carried by whichever element renders that card — the
settled slot tile OR the flying board-move sprite's tile — with no guarantee
that (1) exactly one is visible at any instant, or (2) their shadow GEOMETRY is
continuous across the handoff. The absence of that invariant is the bug. Target
invariant to implement and then guard: **a moving card's shadow is owned by
exactly one element at every instant from motion start to settle, and its
rendered shadow geometry (size/offset/blur) is continuous across every handoff —
in both live and replay.**

FIX DIRECTIONS to weigh (pick after the geometry trace):
- Keep the shadow off the scaled transform — put the ambient shadow on a
  non-scaled wrapper around the sprite's card, or counter-scale the shadow so its
  rendered geometry matches the settled card.
- Or the sprite carries NO shadow, and the settled card's shadow stays visible
  under the flying face the whole flight (claim the face, not the shadow).
- Or match the sprite's shadow to the settled geometry at the landing frame.

INVESTIGATION REQUIREMENTS (must, per lead): (i) BOTH live-play AND replay
retreats — the prior round only ever rigged REPLAY, which may be why the fix
missed; (ii) UNTHROTTLED as well as throttled (his Mac isn't janky — full-speed
repro ⇒ structural); (iii) record computed box-shadow + transform +
getBoundingClientRect PER FRAME through the handoff (geometry, not
presence/absence) to distinguish gap(a) / jump(b) / third-participant(c, e.g. the
vacated slot's shadow or a FLIP-animated bench neighbor); (iv) screencap the
exact flicker frame as eyeball evidence. Rig recipe: `viewer-real-browser-probe`
memory; episode 84924975 via `?view=replay&replay=<file>`.

## #26 RESOLVED — it was an OVERLAP, and the geometry-jump hypothesis was FALSIFIED

Per-frame geometry trace through the switch handoff (private vite 5174, Playwright
rAF recorder capturing each board-move sprite's effective transform scale +
tile `getBoundingClientRect` + the destination slots' `data-anim-hidden`/opacity;
episode 84924975 states 24 retreat and 38 Teleport; unthrottled AND 4× CPU).

**The jump hypothesis is wrong.** `getComputedStyle(tile).boxShadow` returns the
AUTHORED value (`0 3px 8px`) on both sprite and settled card — the scaled shadow
is a composite-time effect of the ancestor `transform: scale()`, so the real
signal is the sprite's effective scale at handoff. The trace shows the
board-card-move animation runs to completion: both swap sprites reach
`scale=1.0000` and HOLD there ~176ms before the sprite is removed. At the last
sprite frame scale is exactly 1, so rendered shadow blur = 8px = the settled
card's 8px. **No geometry jump** — in replay or live, throttled or not.

**It is an OVERLAP (failure shape b), and a REGRESSION from #28.** The timeline:

```
+1189ms  sprites=2   destinations HIDDEN (contents/op0)
+1812ms  sprites=2   destinations UN-HIDDEN  ← settled cards now render
+1886ms  sprites=0                           ← sprites removed ~57–74ms LATER
```

For ~7 frames / ~57ms both destination slots show their settled card AND the
scale-1 sprite sits exactly on top → each card drawn twice → doubled drop-shadow.
Identical window unthrottled (57ms) and at 4× CPU (58ms) = a fixed wall-clock
defer, not paint-timing = structural, exactly as Charlie reports.

Root cause: `ca01cd8` drops the switch sprite synchronously with the un-hide ONLY
when `claimSignature(element)` differs after the swap (its "destination already
authoritative" test). But `#28` (`1151f0e`) re-keyed the bench by Pokemon
identity, so on a swap the vacating occupant's bench slot NODE IS DESTROYED and
the arriving card renders in a fresh node. The claimed (now-detached) node keeps
its frozen dataset serial, so `claimSignature` still "matches" → the claim is
treated as still-relevant → `endScope` takes the deferred settle-timer branch
(40ms + 2 rAF) → both sprites linger over the already-authoritative settled cards.
`ca01cd8`'s synchronous drop silently stopped firing for switches the moment the
bench keying changed under it. (The active slot, keyed by player index, mutates
in place and DOES change signature — but one deferred bench claim forces the whole
`endScope` down the settle branch.)

Fix (`settleClaim.ts` + `BoardAnimationLayer.endScope`): the destination is
authoritative — release now, drop the sprite synchronously — when the claimed
element has LEFT THE DOCUMENT (`!element.isConnected`) OR is still attached but
now shows a different card. A detached identity-keyed node covers nothing; its
replacement is authoritative from creation. Only a still-attached same-card
element defers (the genuine "destination may not have painted" gap case). This
restores `ca01cd8`'s synchronous switch drop under identity-keyed slots and is
robust to future re-keying. Guarded by `settleClaim.test.ts` (detached → release;
attached-same → defer; attached-changed → release; full switch shape → all
release).

Rig evidence (settle-overlap frames = a switch sprite at scale≈1 while every
destination claim has already released):
- Replay retreat (state 24): **7 → 0** unthrottled; 7 (throttled) → 0.
- Replay Teleport (state 38): overlap window → **0** (single un-hide↔drop
  transition, no intermediate frame).
- LIVE agent-vs-agent retreat (copycat-v0, private engine 8096; sprites
  `410-active-72`/`410-bench-79`): **0** settle-overlap frames post-fix — the live
  path drives the identical two-sprite board-move through the same `endScope`, so
  the "replay-only rig gap" is closed.

Suite 309 green (+4 `settleClaim`), `tsc` clean. Commit: see git log for `#26`.
