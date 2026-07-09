# cabt-viewer holistic audit — 2026-07-09 (companion)

**Companion to** [`audit-2026-07-09-animation-architecture.md`](./audit-2026-07-09-animation-architecture.md)
(the animation/visual-fidelity half). This doc covers the three additions Charlie asked for:
**(1) play path vs replay path**, **(2) the module relationship & boundary map**, **(3) the
tech-debt census**. Judged against his bar: *"a simple, reusable, well-built system we can truly
stand on."*

**Audit only** — zero production changes. Top half plain-language for Charlie; bottom half
file:line for implementers. All prior-audit findings (the July-7 `F1`–`F7` sweep) are treated as
**landed** — verified still-clean where relevant, not re-filed as new.

---

# PART 1 — For Charlie

## The one-paragraph verdict

The bones are good and you can stand on them. The engine→projection→choreography→layers→DOM
spine is cleanly layered: the low-level animation code never reaches up into app state, the
choreographer is one pure function shared by both live play and replay, and the fossil ptcg
codebase from the sweep is genuinely gone. What's left is **not rot, it's drift and duplication
in three specific seams**, plus a set of small janitorial items. The most important structural
finding is that **live play and replay have quietly grown two different clocks**: replay uses a
clean, deterministic "hold each flying card until the next state officially arrives" model, while
live play reinvented that with a 300ms guess-and-poll. That single divergence is the root of the
"bounce-back" feeling from the other doc *and* the biggest "these are two drifting copies" smell.
The fix direction is the same for both: **make live play borrow replay's deterministic model** so
there is one clock, not two.

## 1. Play path vs replay path — where they agree, where they've drifted

Think of it as two ways of feeding the same animation machine. Live play is you clicking; replay
is a saved game being scrubbed. They *should* share everything downstream of "here is the next
state," and mostly they do — but three copies have grown apart:

- **The two clocks (the important one).** Replay is paced by a phase timeline: each beat has a
  known duration, and a flying card is simply held in place until the beat ends, then the real
  card underneath is revealed — deterministic, no guessing. Live play instead starts a timer per
  flying card and then *polls the board up to 300ms* asking "has the real card shown up yet?"
  before handing off. Same card, same animation, **two completely different landing mechanisms** —
  and the live one is the fragile one (it's the M3/M4 bounce-back from the other doc). This is the
  divergence most worth removing: give live play replay's hold-to-boundary model.

- **Two card-description builders.** The *structure* of a board view (hands, bench, slots, prizes,
  winner) is built by one shared set of functions — that unification is real and well done, via a
  clean "plug in your card-metadata source" seam. But the very last step, turning a card id into
  its name/type/stage, exists **twice**: once for live (reads the live engine's card data) and once
  for replay (reads generated card data). They produce the same shape today, but nothing stops them
  from drifting — a card that classifies differently in replay than in live would be a silent
  inconsistency.

- **Two "the AI used an ability" guessers.** The engine never logs ability use, so both paths
  reconstruct it from "which option was chosen." That reconstruction is written **twice** —
  once for live observations, once for replay frames — as near-identical twins (the live copy's
  comment literally says it mirrors the replay copy). Two copies of the same guesswork will drift.

Everything else that differs between the two is **principled**: replay has no interactivity or
concealed opponent hands; live has decisions, prize concealment, and the follow-active camera.
Those *should* differ. The three above are drift that should be collapsed to one copy each.

## 2. Module map — is it well-built?

Yes, mostly. In plain terms: the code is stacked in clean layers and the lower layers don't reach
up into the higher ones (the animation math doesn't know about app state; the projection doesn't
know about components). That's the good kind of boring. The coupling that *does* cross layers is
deliberate and small: two shared "signal boards" (one tracks how long animations will run so the
player-input pacing can wait for them; one is the single owner of "hide this card while it's
mid-flight"). Having exactly one owner for each of those is a strength — keep it.

The leaks are minor and local:
- One component (the center piles / discard area) reaches into the page with its own hand-rolled
  element lookups instead of using the shared "find this card's element" helper that the animation
  layers use. So there are two ways to answer "where is this card on screen," and only one of them
  is the blessed one.
- The "how the animation finds elements" contract is an invisible handshake made of magic
  attribute names (`data-card-anchor`, `data-pokemon-serial`, …) sprinkled across components and
  queried by string. It works, but it's the kind of thing that breaks silently when someone renames
  a class — and it's the exact surface the no-prompt-boxes future has to build on.
- A few files have grown large (the replay builder is ~2,800 lines, one animation layer ~2,000).
  Not wrong, but they're doing several jobs each and are the first places future confusion will hide.

## 3. Tech-debt census — the janitorial list

Nothing alarming; a tidy backlog. Full rated list is in Part 2. Highlights:
- The animation-coverage "guard" is really nine hand-picked examples wearing a guard's uniform — it
  checks specific cases, not that *every* action is covered. (You already sensed this.) Making it
  exhaustive is a small, high-value change.
- The ability/announce guessers and the card-description builders are duplicated (see §1) — the
  main "two copies" debt.
- The one genuinely open item from the last sweep is still open: there's a built-in counter for
  "how many cards are currently hidden mid-animation" but nothing shows it, so a stuck hide (a card
  that never un-hides) can't be caught in the moment. A tiny debug readout closes that.

## The shape of the system to stand on

If Charlie wants "simple, reusable, well-built," the target is not a rewrite — it's **collapsing
the drift into single sources of truth**, in this order:

1. **One clock.** Live play adopts replay's deterministic hold-to-boundary handoff. Removes the
   300ms poll, kills bounce-back (M3/M4), and makes live and replay *provably* render the same way.
2. **One projection leaf.** Merge the two card-description builders behind the existing metadata-source
   seam so there is one classifier, two data sources.
3. **One announce-synthesizer.** Normalize live and replay to a common shape, then run one copy.
4. **One "where is this card" helper.** Route the stray component lookups through the shared anchor
   resolver; make the magic-attribute contract explicit and tested.
5. **Exhaustive guards, not examples.** Promote the coverage test and the whole-game inertness probe
   (from the other doc) into real totality/regression guards.

That is five consolidations, each independently shippable, each removing a whole class of "why do
these two behave differently" bugs — which is exactly the reliability Charlie is asking for.

---

# PART 2 — For the implementing agent

## A. Play path vs replay path — divergence inventory (file:line)

**Shared, principled core (keep):**
- `choreograph()` (`src/lib/anim/motions.ts:109`) is a pure function of `(events, players, context)`;
  both paths call it. This is the correct shared seam.
- Structural projection is shared via dependency injection: `SlotResolvers`
  (`cabtProjection.ts`) — `projectHand`, `projectPokemonSlot`, `stadiumForPlayer`,
  `specialConditionsFor`, `projectPhase`, `projectWinner` are called by *both* live
  (`cabtObservationToGameView`, `cabtProjection.ts:159`) and replay (`frameToGameView` /
  `buildPlayerView`, `cabtReplay.ts:2490`/`2517`). The July-7 267b311 unification is **real and
  well-architected** — replay injects `replaySlotResolvers` (`cabtReplay.ts:2485`) so the only
  intended difference is the card-metadata source (generated JSON vs live bridge `dataMaps`).

**Divergence D1 — the two clocks (ACCIDENTAL drift, highest value to remove).**
- Replay pacing: owned by `replay.svelte.ts` phase timeline (`scheduleAnimationPhase`,
  `replay.svelte.ts:221`); layers hold sprites to scope end + 40ms settle + double-rAF
  (`BoardAnimationLayer.svelte:465-501` `endScope({settle})`, `removeSpritesAfterPrepaint`).
- Live pacing: `game.svelte.ts:84-118` stepper (`wait(clampedActionStepDelay)` +
  `animationActivity.waitForIdle(5000)`); layers self-time via per-motion timers +
  `handOffWhenDestinationReady` polling (`BoardAnimationLayer.svelte:402-428`, `handoffMaxWaitMs=300`)
  + `animationActivity.extendBy` busy-until (`activity.ts`).
- The mode branches that implement this split:
  - Boundary key: live `turnChanged` (turnKey) vs replay `scopeChanged` (scopeKey) —
    `BoardAnimationLayer.svelte:122`/`124`, `ViewportAnimationLayer.svelte:152`/`154`,
    `RevealSessionLayer.svelte:88`/`90` (`sessionBoundary = replayMode ? scopeChanged : turnChanged`).
  - Activity reporting only in live: `if (!replayMode) …extendBy` — `BoardAnimationLayer.svelte:138`,
    `ViewportAnimationLayer.svelte:163`, `RevealSessionLayer.svelte:97,179`.
  - Cleanup skipped in replay (scope-end handles it): `BoardAnimationLayer.svelte:269,316,362`
    (`if (replayMode) return` before per-motion cleanup timers);
    `ViewportAnimationLayer.svelte:447` `holdUntilScopeEnd = replayMode && (discard|playZone)`;
    `ViewportAnimationLayer.svelte:648` `if (!replayMode)` release reset sources.
- **Why it matters:** the *same* action can land differently by mode. Replay's hold-to-scope-end is
  robust; live's poll-with-300ms-cap is the M3/M4 bounce/snap seam from the animation doc.
  **Fix:** give live a deterministic "hold until the authoritative next view is applied" boundary
  (the stepper already serializes via `applyQueue` and `waitForIdle`; the layers could release on an
  explicit "next-view-applied" signal instead of polling the DOM).

**Divergence D2 — two card-description builders (ACCIDENTAL drift).**
- Live leaf: `cabtCardToView` (`cabtProjection.ts:405`). Replay leaf: `cardToView`
  (`cabtReplay.ts:2553`). Both independently compute `superType`/`cardType`/`trainerType`/
  `energyType`/`stage` from card kind. The structural builders are shared; only this leaf is doubled.
- **Fix:** the `SlotResolvers.cardView` seam already exists — make both call one classifier that
  takes a metadata lookup, so there is one classification, two data sources.

**Divergence D3 — two announce-synthesizers (ACCIDENTAL drift).**
- Live: `synthesizedAnnounceLog` + `abilityLogForSelectedOption` + `retreatLogForSelectedOption` +
  `abilityLogForConfirmedTrigger` + `abilityLogForTriggeredEvolution` (`liveSteps.ts:197-337`).
- Replay: `logsWithSynthesizedAbility` + `abilityLogForSelectedOption` + `retreatLogForSelectedOption`
  (`cabtReplay.ts:208-303`). Near-identical twins; the live comment (`liveSteps.ts:196`) says it
  mirrors the replay copy.
- **Fix:** normalize the two inputs (live observation vs replay frame) to a common `{previous,
  action}` shape, then share one synthesizer. NEEDS-DESIGN (input shapes differ) but high drift-risk.

**Principled divergences (keep):** interactivity/decisions (live only), concealed opponent hands +
prize concealment (live only — `liveSteps.ts` `LiveObservationNormalizer`, concealed seats),
follow-active seat flip (live only — `App.svelte:273`), replay animation phases + pre-state views
(replay only — `cabtReplay.ts` `projectedViewForEvents:1773`). Hand tracking is genuinely two
implementations (`LiveObservationNormalizer` event-sourcing vs `cabtReplay` tracked hands) because
the inputs differ (per-seat live streams vs full replay frames) — but see the M1 duplicate-serial
finding in the animation doc; both trackers should share a "never emit duplicate serials" invariant.

## B. Module relationship & boundary map

**Layer dependency direction (verified — clean, no inversions):**
```
engine/ (localEngine, liveSteps, server)
   ↓ imports
lib/cabt/ (cabtProjection, cabtReplay, types, cardView, logFormat, actionAnimationCoverage)
   ↓
lib/anim/ (motions, anchors, timing, visibility, activity, gate, effects, revealLayout)   ← pure; imports only lib/game types
   ↓
lib/components/*.svelte
   ↓
state/*.svelte.ts   (stores)      App.svelte (top)
```
- **No layering inversions:** `grep` confirms `src/lib/anim/*` and `src/lib/cabt/*` import **no**
  `state/*.svelte` stores and no components. The animation math is fully decoupled from app state.
- **Deliberate cross-layer channel (keep):** two module-level singletons are the shared bus —
  `animationActivity` (`activity.ts`, busy-until, read by `game.svelte`) and `animVisibility`
  (`visibility.ts`, ref-counted single owner of `data-anim-hidden`, used by all 3 layers). Single
  owner each = good. Caveat: global mutable singletons leak state across tests unless reset (the
  probe/`App.stability` tests rely on `gameStore.reset()`; there is no `animVisibility.reset()`).

**Leaky boundaries (file:line):**
1. **CenterPiles bypasses the anchor resolver.** `CenterPiles.svelte` does its own raw
   `document.querySelector('[data-card-anchor="player:…:playZone"] .card-tile')` /
   `discardCardElement` (`CenterPiles.svelte:155,169,189-196`) instead of `anchors.ts`'s
   `resolveAnchor`. Only the 3 anim layers import `anchors.ts`; CenterPiles reimplements a subset →
   two answers to "where is this card." **WORTH-A-SLICE:** route through `resolveAnchor`.
2. **The implicit DOM-attribute contract.** The animation↔board handshake is string-queried magic
   attributes (`data-card-anchor`, `data-pokemon-serial`, `data-card-serial`, `data-anim-layer`,
   `data-hand-card-slot`, `.card-tile`, `.game-board-plane`, `.board-slot`). Producers are scattered
   across `CenterPiles`, `BoardSlot`, `Hand`, `GameBoard`, `CardTile`; consumers are `anchors.ts` +
   the layers + CenterPiles. No single registry of the contract → renames break it silently. This is
   also the surface the no-prompt future must extend. **NEEDS-DESIGN:** a typed anchor-attribute
   module both sides import.
3. **Raw `querySelector` counts** (bypassing anchors): `ViewportAnimationLayer.svelte` 9,
   `BoardAnimationLayer.svelte` 5, `CenterPiles.svelte` 4, `RevealSessionLayer.svelte` 3. The layers
   are expected to (they own geometry), but much of their querying could go through `anchors.ts`.

**God-modules (line counts):** `cabtReplay.ts` **2796**, `ViewportAnimationLayer.svelte` **2052**,
`App.svelte` **1083**, `cabtProjection.ts` 674, `localEngine.ts` 667, `GameBoard.svelte` 397.
`cabtReplay.ts` does log parsing + hand tracking + announce synthesis + projection + phase building
in one file — the top split candidate.

## C. Tech-debt census (rated)

**Duplicated logic (the main debt):**
- **D2 card-description builders** (`cabtProjection.ts:405` `cabtCardToView` vs `cabtReplay.ts:2553`
  `cardToView`) — two independent card classifiers. **WORTH-A-SLICE.**
- **D3 announce-synthesizers** (`liveSteps.ts:197-337` vs `cabtReplay.ts:208-303`) — two copies of
  ability/retreat announce reconstruction. **NEEDS-DESIGN** (differing input shapes).
- **Card-key string** `${serial}-${id}-${name}` hand-built in `CenterPiles.svelte:93` (`visibleDiscardCards`),
  `CenterPiles.svelte:113` (`cardKey`), `Hand.svelte:54`, and the probe — 4 copies, no shared helper.
  **TRIVIAL:** one exported `cardKey()`.
- **DOM-geometry helpers** (`centerOf`, `clamp`, `groupByPlayer`, rect→quad) re-inlined across
  `ViewportAnimationLayer.svelte`, `BoardAnimationLayer.svelte`, `RevealSessionLayer.svelte`,
  `CenterPiles.svelte`; some already exist in `planeGeometry.ts`. **WORTH-A-SLICE:** consolidate to one util.

**Tests posing as guards:**
- `actionAnimationCoverage.test.ts` is **example-based** (~9 assertions on specific classifications),
  not an exhaustiveness guard — the only totality comes from the source's `unsupported` fallthrough.
  **WORTH-A-SLICE:** drive it over the full select-shape inventory
  (`agent-lab/experiments/select-inventory/`) so every action kind is asserted.
- Thin coverage on the god-modules: `cabtReplay.ts` (2796 lines) and `ViewportAnimationLayer.svelte`
  (2052 lines, no component-level render test). The new whole-game inertness probe is the first
  whole-game render assertion; extend it to drive the live stepper (see animation doc).

**Naming drift & compatibility shims:**
- **`HpChange` / `HPChange` dual-casing shim** — handled defensively in **17 places**
  (`timing.ts:109`, `motions.ts:175`, `actionAnimationCoverage.ts`, etc.), because the event stream
  can carry either casing. **WORTH-A-SLICE:** normalize to one casing at the projection boundary,
  then handle one. Same smell to check for `Draw`/`DrawReverse`, `MoveCard`/`MoveCardReverse`
  (those are semantically distinct — NOT a shim — keep).
- The two projection leaves and two announce-synthesizers (D2/D3) are also naming/logic drift.

**Stale docs/comments:**
- `docs/replay-animation-architecture.md`'s live-play section is **superseded** by the July-7 audits
  (per the prior digest) but not marked as such. **TRIVIAL:** add a superseded banner + pointer.
- Verify no comments still reference `demoEngine`/`ptcg` (spot-check clean; low risk).

**Unused / thin flags & config:**
- URL params in use: `?view=replay` (`App.svelte:708`), `?replay=` / `?replayUrl=`
  (`replay.svelte.ts:267,271`). The `?debug=clickability` instrument (landed 0e72c57) is a debug-only
  flag — keep but document. **Audit action:** confirm each `viewSettings` field is read somewhere
  (the parallel census sweep is enumerating these; none confirmed dead yet).

**Open item carried from July-7 (still open):** `animVisibility.hiddenCount()` (`visibility.ts:36`)
exists but is surfaced in **no** debug panel → a stuck/leaked hide (card that never un-hides) can't
be caught live. Also `animVisibility` has **no `reset()`**, so its global claim map can leak across
tests. **TRIVIAL–WORTH-A-SLICE:** add a `?debug=` hidden-count readout + a test-reset hook.

**Positive findings (verified clean — do not re-file):**
- ptcg fossil layer fully deleted (`gameApi.ts`, `demoEngine.ts`, `prompts.ts`, `targets.ts`,
  `logDedupe.ts` all absent; `withKnownHands`/`revealPromptForLogs`/`isAgentDecisionView`/
  `actionAnimationBatchEvents`/`pendingRetreatTarget` gone).
- **Zero** `TODO`/`FIXME`/`HACK`/`@ts-ignore`/`@ts-expect-error` markers in `src/` (excluding the
  probe) — no marker debt.
- No `gamemath`/`game-math` naming survivors in `src/`.
- No layering inversions (anim/ and cabt/ import no state/components).

**Rating summary:** the debt is **light**. Nothing is NEEDS-DESIGN except D3 (announce-synthesizer
merge) and the implicit DOM-attribute contract (§B leak #2). Everything else is TRIVIAL or
WORTH-A-SLICE. The codebase is in good shape to stand on; the work is consolidation, not repair.

## Cross-links

- Animation/visual-fidelity mechanisms (M1–M5), the whole-game inertness probe, and the
  no-prompt-boxes assessment: [`audit-2026-07-09-animation-architecture.md`](./audit-2026-07-09-animation-architecture.md).
- Prior sweep (`F1`–`F7`, all landed 2026-07-07): `audit-2026-07-07-viewer-play-pipeline.md`,
  `audit-2026-07-07-live-play-animation.md`, `replay-animation-architecture.md`.
