# Animation & visual-fidelity architecture audit — 2026-07-09

**Scope:** the live-play animation pipeline of cabt-viewer (branch `main`, the merged rebuild).
**Mandate:** audit only. No production code was changed. This document plus one committed
probe (`src/probes/wholeGameSwapInertness.probe.dom.test.ts`) are the deliverable.
**Goal:** identify the *classes* of remaining visual defect structurally, so they can be
fixed as classes rather than squashed one instance at a time.

The document has two halves. The **top half is for Charlie** — plain language, every mechanism
explained through what you actually see on screen. The **bottom half is for the implementing
agent** — the event×pipeline matrix and file:line specifics.

**Companion:** [`audit-2026-07-09-viewer-holistic.md`](./audit-2026-07-09-viewer-holistic.md)
covers play-path-vs-replay-path divergence, the module relationship & boundary map, and the
tech-debt census. Read alongside this doc — the "two clocks" divergence there is the structural
root of the M3/M4 handoff seam described below.

---

# PART 1 — For Charlie

## Verdict in one paragraph

The rebuild is structurally sound. The keying/identity fixes from the July 8 work genuinely
hold: I drove a *whole real game of yours* (`pasted-507c3b0f.json`, 146 board states) through
the renderer and checked, at every single state change, whether the discard pile's top card or
any card in a hand kept the same physical DOM element when it should have. Across **72 discard-top
checks and 1,340 hand-card checks, zero cards lost their element** — so the "discard top flickers
when it shouldn't" and "cards blink" families are, at the *data/keying* level, fixed. What remains
is **not one bug but four distinct mechanisms**, three of them living in the *timing* seam between
"the board has already updated to show the new state" and "the flying-card animation is still
catching up." One of them I reproduced outright. The prompt-boxes-disappear North Star is
**not** blocked by the current architecture, but it is not supported by it either: today the
pretty fanned cards you see during a search are decoration that literally cannot be clicked.

## How the machine works, as a story

Think of every game action as passing down an assembly line:

1. **The engine** (Python, one process per game) tells each of the two seats what happened,
   in that seat's own private language — your draw is a real card to you, a face-down card to
   your opponent. A normaliser stitches those two tellings into one honest, ordered story and,
   crucially, keeps a running model of *both* hands so a card never flips between "real" and
   "card-back" as the view refreshes.

2. **The step builder** slices that story into beats and, for each beat, produces a *pre-state
   view* — a snapshot of the board as it looked *just before* this beat — so that a card can be
   drawn flying *from* where it started rather than teleporting.

3. **The choreographer** looks at each beat and decides what should move: a draw becomes a card
   flying deck→hand, an attack becomes a name banner plus a lunge plus a damage number, a
   knockout becomes a card tumbling to the discard. It is a pure function — the same code runs
   for replays and for live play.

4. **The animation layers** turn those instructions into actual moving sprites, and — this is the
   subtle part — while a sprite is flying, they *hide* the real card at its destination (a
   "visibility claim") so you don't see two copies. When the sprite lands, the claim is released
   and the real card appears. Claims are reference-counted so two overlapping animations can hide
   the same spot without one of them un-hiding it too early.

5. **The board** renders the settled state: piles, hands, bench, active.

The **pacing** works like this: the live stepper shows a beat, waits a small fixed gap
(50–2500ms, your setting), then waits for the animation layers to report "I'm idle" before
showing the next beat. The layers report how long they'll be busy by adding up their sprites'
durations. So playback is *content-aware* — a big shuffle genuinely takes longer than a single
draw — rather than a fixed drumbeat.

## What's still wrong, explained by what you see

### 1. The opponent's hand can briefly try to key two cards as the same card — REPRODUCED

This is the one hard defect I caught. In your real game, at one specific moment (the opponent
moving a hidden card to hand), the opponent's tracked hand momentarily held **two cards both
labelled serial 99**: `[91, 95, 105, 96, 121, 99, 99]`. The renderer identifies each hand card
by its serial so it can keep the same element as the hand shuffles around. Two cards claiming
the same identity is a contradiction: in development the framework throws an error; in the
shipped build it silently reuses one element for the wrong card and drops the other — which
presents as **a hand card flickering or briefly showing the wrong face** during the opponent's
turn. It happens rarely (one frame in this whole game), which matches "residual flicker I can't
pin down." Root cause is upstream, in how the hidden opponent hand is tracked — a placeholder
and a real card, or two reused serials, collide.

### 2. At every turn handoff, the whole hand blinks — REPRODUCED (but it's "intended" behaviour biting back)

The board shows *you* at the bottom. When "follow the active player" is on (the default), the
moment the turn passes, the bottom seat flips to the new active player. That flip **rebuilds both
players' hands and piles from scratch** — every card image reloads, every hand re-runs its
fan-out animation. I reproduced this at five separate turn boundaries in your game. It's doing
what it was told (the camera follows the active player), but the *implementation* of that follow
is a full remount, so what you perceive is the entire hand flashing at each turn change. This is
very likely a chunk of what you're calling "switching inconsistencies."

### 3. Cards that "bounce back and forth" — the flying-sprite handoff seam — HYPOTHESIZED (code-evidenced)

When a card flies to a slot, the real slot is hidden until the sprite arrives, then the layer
*polls up to 300ms* for the destination to actually show the card before handing off. Two things
can make a card appear to snap or jump back: (a) if the destination view hasn't rendered the
landed card by the time the poll gives up, the sprite is removed and the real card pops in a beat
late — a stutter; (b) the *pre-state* snapshot for the next beat can momentarily show a card at
its old location while the previous beat's sprite is still settling, so the eye sees it "go back."
I could not pin the exact frames without a real-browser capture (this seam is timing-and-layout
dependent, and my headless harness deliberately runs with animations off to isolate keying), so
I'm flagging it as the strongest *hypothesis* for "bouncing," with the code paths named in Part 2.

### 4. The discard-top "change when it shouldn't" is NOT a keying bug anymore — RECLASSIFIED

I specifically hunted the discard-top instability and the keying is clean (see the verdict
numbers). So if you still see the discard top flicker, it is **not** the pile forgetting which
card is on top — it's a flying sprite or the "resolving card" animation briefly drawing over the
pile top during the handoff. That's mechanism #3's family, not an identity bug. This matters
because it changes the fix: don't touch the pile keying (it's right); fix the handoff overlap.

## Top 5 mechanisms, with evidence status

| # | Mechanism | You see | Evidence |
|---|-----------|---------|----------|
| 1 | Duplicate tracked serials collide the hand's keyed list | A hand card flickers / shows wrong face, rarely, on opponent turns | **Reproduced** (probe + data scan: 1 frame, serial 99 doubled) |
| 2 | "Follow active" flips the seat by remounting both hands+piles | Whole hand flashes at every turn handoff | **Reproduced** (5 turn boundaries in your game) |
| 3 | Flying-sprite → real-card handoff seam (poll timeout + pre-state holes) | A card snaps or bounces back near its destination | **Hypothesized**, code paths identified |
| 4 | Discard-top overlap during handoff (keying itself is sound) | Discard top flickers momentarily | **Reclassified**: keying **confirmed stable**; residual is timing overlap (hypothesized) |
| 5 | Reveal-session sprite lifecycle relies on every step changing the scope key + a resolution beat | A searched/revealed card lingers or double-plays under fast input | **Hypothesized**, safety-net exists |

## The prompt-boxes-disappear future

Your North Star: no dialog boxes — you pick by clicking cards directly in the fanned display.
**The current architecture does not fight this, but it does not support it either.** Today the
fanned reveal cards are drawn in a layer that is explicitly `pointer-events: none`, marked
`aria-hidden`, and deliberately excluded from every "what did I click" query. They are decoration.
The things you actually click are separate DOM (board slots, prompt components). So "the thing you
see" and "the thing you click" are two different trees. To reach the North Star, those trees must
merge: either the fanned/animated cards become real, hit-testable, engine-option-bound elements,
or the real selectable card elements animate in place. **Heads-up:** the reveal layer uses the
same 3D-perspective CSS that once broke board click-detection in Chromium (the `transform-style`
fix). Making sprites clickable will re-enter that exact hazard, and — per your team's own history
— synthetic test clicks *lie* about it; only a real mouse catches it. So this feature needs the
real-browser rig as a first-class part of its test plan, not an afterthought.

## Recommended order (point-fix vs structural)

| Order | Fix | Class or instance? | Effort |
|-------|-----|--------------------|--------|
| 1 | Dedupe tracked-hand serials at the source (normaliser/replay), + a hard "no duplicate hand serials in any view" guard | **Class** (kills mechanism #1 for all cards) | **S** (½ day) |
| 2 | Promote the whole-game swap-inertness probe to a hard CI guard; extend it to drive the *live* stepper, not just state swaps | **Class** (locks the fixed keying down forever) | **S–M** (1 day) |
| 3 | Make "follow active" flip the seat *without remounting* (swap which panel is top/bottom via CSS/order, keep card elements) | **Class** (mechanism #2, and removes a whole family of turn-boundary flashes) | **M** (1–2 days) |
| 4 | Close the sprite-handoff seam: guarantee the destination card is rendered *before* the claim releases (event-driven handoff, not a 300ms poll); audit every pre-state view for holes | **Class** (mechanisms #3 & #4) | **M–L** (2–4 days) |
| 5 | Real-browser MutationObserver capture harness as a permanent, runnable rig (isolated 8096/5174 + Playwright real-mouse) to verify #3/#4 and gate the no-prompt future | **Infrastructure** | **M** (1–2 days) |
| 6 | (North Star, not now) Unify the animated-card tree with the selectable tree | **Structural** | **L+** |

---

# PART 2 — For the implementing agent

## Pipeline, end to end (file:line)

```
engine (cabt_bridge.py, localEngine.ts)
  → per-seat dedupe + hand event-sourcing         src/engine/liveSteps.ts  (LiveObservationNormalizer)
  → phase step builder / pre-state views          src/lib/cabt/cabtReplay.ts ; replay.svelte.ts
  → projection → GameView                          src/lib/cabt/cabtProjection.ts
  → live playback sequencing                       src/state/game.svelte.ts (applyNow)
  → activity signal (busy-until)                   src/lib/anim/activity.ts
  → choreography (pure)                            src/lib/anim/motions.ts (choreograph)
  → anchors / visibility claims                    src/lib/anim/anchors.ts ; visibility.ts
  → layers (sprites + claims)                      ViewportAnimationLayer.svelte ; BoardAnimationLayer.svelte ; RevealSessionLayer.svelte
  → board DOM / piles / hand                       CenterPiles.svelte ; Hand.svelte ; BoardSlot.svelte ; CardTile.svelte
  → CSS
scope/turn keys wired at                           App.svelte:81-95  (animationScopeKey / animationStepEvents / animationTurnKey)
gate ("animate only on scope change")              src/lib/anim/gate.ts
```

**Key scope semantics** (`App.svelte:81-95`): `animationScopeKey = live-${lastTimelineEventId}`
changes every step; `animationTurnKey = turn-${game.turn}`; `animationEvents` is `[]` on the
settled interactive view (so the cumulative log-panel timeline never re-enters the layers) and
the step's own events during `playingSequence`. The gate (`gate.ts`) only emits a batch when the
scope key changes, so pre-existing state never animates and each step animates exactly its own events.

## Event kind × pipeline matrix

Motion style, space, anchors, visibility claims, and the known structural risk per canonical
event kind. All references are `src/lib/anim/motions.ts` unless noted.

| Event kind (→ areas) | Motion style / effect | Space | `from` → `to` anchors | Visibility claims | Coverage | Known structural risk |
|---|---|---|---|---|---|---|
| `Draw` / `DrawReverse` | `deck-draw` | viewport | `deck` → `hand-slot` (`fromEnd`, or `index` on mulligan) | claims each target hand slot `element`, released at ~88% of travel | polished | Target resolves by position (`fromEnd`) not serial for normal draws — arriving-card ordering assumption |
| `Coin` | `coin-flip` | viewport | `deck`→`deck` (nominal) | none | polished | Purely decorative; centred on `.playmat` |
| `Play` (hand→active/bench/discard/stadium) | `hand-play` | viewport | `hand-slot(serial)` → `pokemon`/`stadium`/`discard(exact)` + fallbacks | `hideResolvedTarget` via `hideModeForTarget` (null for non-exact discard) | polished/conditional | Fallback chain can resolve to discard *top* if own card absent; guarded by `hideModeForTarget` (ViewportAnimationLayer:795) |
| `Evolve` | `hand-play` (evolve flight) | viewport | `hand-slot` → `pokemon(target serial)` + fallback to base | target glow effect, no hide | polished/conditional | Depends on target serial/cardId resolving to the live slot |
| `Attach` (hand or deck-ability) | `hand-play` **or** `reveal`+attach handoff; `attach-under` effect | viewport | `hand-slot`/`deck` → `pokemon` | badge claim during handoff (RevealSessionLayer:246) | polished/conditional | Deck-attach (Punk-Up) path routes through reveal session; hand-membership check `motions.ts:845` |
| `Attack` | `announce-attack` + `lunge` (damage phase) | viewport (effect) | `pokemon(attacker)` / fallback active slot | none (target-owned CSS) | polished | Identity-less attacks fall back to active slot 0 (`motions.ts:250`) |
| `Ability` | `announce-ability` | viewport (effect) | `pokemon` or `stadium` | none | polished/conditional | Ability logs are *synthesised* from selected option (`liveSteps.ts:197`); missing identity → no announce |
| `HpChange`/`HPChange` | `damage-float` + `lunge` | viewport | `pokemon(target)` | none | polished/conditional | Needs serial/cardId; multi-target lands simultaneously |
| `Shuffle` | `deck-shuffle` | board | `deck`→`deck` | none | polished | Decorative six-card flourish |
| `Switch` | two `board-move` | board | active↔bench (`pokemon` serial/cardId) | both slots `contents` | polished/conditional | Two sprites cross; each hides both endpoints |
| `MoveCard` DECK→DISCARD | `deck-discard` (flip) | board | `deck` → `discard(surface)` | none (surface = pile) | polished | z-index `++discardOrder` is monotonic, never reset (BoardAnimationLayer:356) |
| `MoveCard` DECK→LOOKING/HAND | `reveal` / `search-reveal` | viewport | `deck` → fan / `hand-slot` | search: target slot `element` | conditional | Reveal-session lifecycle (see #5) |
| `MoveCard` LOOKING→HAND/DECK | `reveal-take` / `reveal-return` | viewport | session sprite → `hand-slot`/`deck` | take: target slot `element` | conditional | Depends on `revealSerial` matching a live session sprite |
| `MoveCard` attached→DISCARD/DECK | `attached-move` | board | `attached(serial)` → `discard`/`deck` | `from` `element` + discard `exact` `element` | polished/conditional | Uses pre-effect snapshot `attachedRects` (BoardAnimationLayer:67) because badge vanishes on swap |
| `MoveCard` STADIUM→DISCARD | `board-move` | board | `stadium` → `discard(serial,cardId)` | stadium + discard `exact` `element`; `waitForDestinationCard` | polished | One of two paths that waits for the exact destination card |
| `MoveCard` HAND→DECK | `hand-reset` | viewport | `hand-slot(serial)` → `deck` | source frame `element` | polished | Mulligan batches share a step with draws (`mulligan` flag) |
| `MoveCard` DECK→ACTIVE/BENCH | `board-move` | board | `deck` → `pokemon` | target `contents` **early** | polished | Deck-placement uses `early` claim so the slot is hidden before the flight |
| `MoveCard` ACTIVE/BENCH→DECK | `board-move` (flip to back) | board | `pokemon` → `deck` | source `contents` | polished | — |
| `MoveCard` BENCH→ACTIVE | `board-move` | board | `pokemon` → active slot | both `contents` | polished | — |
| `MoveCard` ACTIVE/BENCH→DISCARD | `knock-out` | viewport | `pokemon` → `discard(surface)` | source `contents` | polished/conditional | `conditional` when not preceded by an `Attack` in the step |
| `MoveCard` ACTIVE→BENCH (retreat pair) | `board-move` | board | `pokemon` → paired bench slot | both `contents` | polished/conditional | Destination inferred from the paired BENCH→ACTIVE event (`motions.ts:947`) |
| `MoveCard` PRIZE→HAND | `prize-take` | viewport | `prize(index)` → `hand-slot(serial, fromEnd)` | target slot `element` | polished | Source rects extrapolated for prize slots already gone from DOM (ViewportAnimationLayer:852) |
| `MoveCardReverse` DECK→PRIZE | `prize-place` effect | viewport (target-owned) | `deck` → `prize(index)` | none | polished | Index computed from `prizesLeft - placeCount + index` |

### Coverage classifier (`src/lib/cabt/actionAnimationCoverage.ts`)

Four levels: **`polished`** (bespoke animation), **`conditional`** (animates only when required
identity/context is present, else static), **`static`** (state-only, no motion), **`unsupported`**
(no classification). The classifier is the enumeration domain for "have we covered every action";
its guard test (`actionAnimationCoverage.test.ts`) asserts the mapping is total over the observed
event kinds. Use it + `agent-lab/experiments/select-inventory/` as the exhaustive action domain
when extending the probe.

## The instability catalog — structural detail

### M1. Duplicate tracked-hand serials → keyed-each collision — REPRODUCED

- **Where it renders:** `Hand.svelte:54` — key is `card.serial ?? \`${card.id}:${card.name}:${index}\``.
  Two hand cards with the same serial produce a duplicate key.
- **Where it originates:** the opponent (concealed) hand is event-sourced, not read from the
  engine — `liveSteps.ts:95-149` (`applyHandEvent` / `removeFromHand`) for live, and the
  equivalent tracked-hand logic in `cabtReplay.ts`. Placeholders use *negative synthetic*
  serials (`liveSteps.ts:151`), so a `99`+`99` collision means **two real (or one real + one
  mis-serialised) cards share a positive serial** — a tracking defect, not a placeholder issue.
- **Reproduction:** `pasted-507c3b0f.json`, replay step 9 settled view (a `MoveCardReverse`,
  player 1), hand serials `[91,95,105,96,121,99,99]`. In dev Svelte throws
  `each_key_duplicate`; in prod it silently mis-reconciles.
- **Fix (class):** dedupe serials where the tracked hand is built; never emit two cards with the
  same serial in a `PlayerView.hand`. Add the guard in M-guard below.

### M2. Follow-active seat flip remounts both panels — REPRODUCED

- **Where:** `App.svelte:201` — `bottomPlayer = game.players[viewIndex]`, and the follow-active
  effect (`App.svelte:273`) calls `switchToPlayer` (`viewSettings.svelte.ts:122`) when the acting
  player changes. Because `viewIndex` selects which `PlayerView` is the bottom `PlayerPanel`, the
  flip **swaps the component instances**, unmounting and remounting both hands and pile stacks
  (fresh `<img>` loads, hand FLIP re-init).
- **Reproduction:** the probe's first pass (seat *not* pinned) flagged full hand-frame recreation
  at swaps 10/23/30/44/92 — the turn boundaries. Pinning the seat (`followActive=false`) removes
  all of them, proving the flip is the cause, not the state swap.
- **Fix (class):** make the seat flip a *presentation* change (CSS order / grid-area / transform)
  over stable component instances keyed by `player.index`, so card elements survive the flip.

### M3. Sprite→destination handoff seam — HYPOTHESIZED (code-evidenced)

- **Board moves:** `BoardAnimationLayer.svelte:402-428` `handOffWhenDestinationReady` polls every
  `handoffPollMs=16` up to `handoffMaxWaitMs=300`, then releases claims and removes the sprite on
  *ready OR timeout OR detach*. On **timeout** the real card may not yet be rendered → a beat-late
  pop. `settleMs=40` + double-rAF removal (`removeSpritesAfterPrepaint:486`) is the anti-flash
  guard, but it assumes the destination is ready.
- **Pre-state holes:** each live step animates its own events against the *pre-state* view
  (`liveSteps.ts` / `cabtReplay` phases). If any event kind lacks a pre-state beat, the card
  renders at its destination first, then animates from origin — the classic "render at
  destination, then snap." Audit every classifier branch that returns a motion for a `waitFor`-less
  destination.
- **Live stepper coupling:** `game.svelte.ts:84-118` — `wait(clampedActionStepDelay)` (50–2500ms)
  then `animationActivity.waitForIdle(5000)`. The layers `extendBy(scheduledEndMs + pad)`
  (Viewport:166, Board:141, Reveal:100). The cap (`maxStepWaitMs=5000`) means a stuck poll never
  deadlocks but *can* cut an animation short and swap the next view over it.
- **Fix (class):** replace the 300ms poll with an event-driven handoff — release the claim only
  when the destination card element actually exists (MutationObserver or a post-render callback),
  and give every motion a guaranteed pre-state so nothing renders at its destination before it flies.

### M4. Discard-top is keying-sound; residual is overlap — RECLASSIFIED

- **Confirmed stable:** `CenterPiles.svelte:90-96` `visibleDiscardCards` keys the top two by card
  identity (`serial-id-name`), never by layer index — so a new top lands without remounting the
  covered card. The probe confirms 0 top-node churn over 72 checks.
- **Anchor safety:** `anchors.ts:46-63` — default (non-`exact`) discard resolution can return the
  *current* top when the target card isn't in the pile yet; `hideModeForTarget`
  (ViewportAnimationLayer:795) returns `null` for non-exact discard precisely so a claim can't
  hide the wrong top. This is correct; keep it.
- **Residual (hypothesized):** the `deck-discard` sprite and the `resolving-discard` animation
  (`CenterPiles.svelte:168`) draw over the pile top during handoff; `.resolving-discard-target`
  is `visibility:hidden` (`CenterPiles.svelte:579`) for 380ms. A mistimed release shows the pile
  top blink. This is M3's family — fix the handoff, not the keying.

### M5. Reveal-session lifecycle — HYPOTHESIZED (safety-netted)

- **Where:** `RevealSessionLayer.svelte`. Sessions start on `reveal`/`search-reveal`, hold in
  `held` mode across steps within a turn, and conclude on a resolution batch
  (`reveal-take`/`reveal-return`/attach). `concludeSessionLeftovers` (:126) is the safety net:
  any sprite the resolution batch didn't address returns to the deck rather than stranding.
- **Fragility:** session boundary is `scopeChanged` (replay) or `turnChanged` (live) (:88-90).
  Live `scopeKey` changes every step (`App.svelte:83`), so a session relies on the *turn* key to
  survive multi-step reveals — correct, but tightly coupled. A resolution encoding the classifier
  doesn't map degrades to `concludeSessionLeftovers` (good), but rapid interleave of a new command
  mid-session depends on `clearSession` firing on the turn-key change.
- **Fix:** mostly point-hardening; verify with the real-browser rig under fast input. No structural
  change required unless the no-prompt future routes selection through this layer (then see below).

## The no-prompt-boxes future — what the layer must gain

- **Today:** reveal/fan sprites are `pointer-events: none` (`RevealSessionLayer.svelte:698`),
  `aria-hidden`, inside `[data-anim-layer]`, and `anchors.ts:159-166` `query()` *excludes*
  `[data-anim-layer]` from every lookup. Selection flows through prompt components +
  `selection.svelte.ts`, never the anim layer. **The fanned cards cannot be clicked.**
- **Needed:** (a) sprites become hit-testable and carry their engine option (serial→option map);
  (b) the 3D-perspective CSS on `.deck-reveal-animation` / hand-play sublayers re-enters the
  Chromium hit-testing hazard fixed for the board by `transform-style: flat` (commit e9745e2) —
  budget for it and test with a **real mouse** (synthetic `.click()` bypasses hit-testing and
  will pass falsely; see `viewer-real-browser-probe` memory + the 8096/5174 rig);
  (c) a unified tree so "seen" == "clickable".
- **Verdict:** not blocked, not supported. It is a structural merge of the animated tree and the
  selectable tree, gated by the real-browser rig.

## The probe (committed, additive)

`src/probes/wholeGameSwapInertness.probe.dom.test.ts` — happy-dom, drives a **whole real game**
(`public/game-logs/pasted-507c3b0f.json`, 146 states) through the live board and asserts:

- **discard-top identity stability:** when the logical top card is unchanged between two
  consecutive views, its DOM node must be the same element. Result: **72 checks, 0 churn**.
- **persistent hand-card identity:** a hand card present with the same serial before and after a
  swap must keep its DOM frame. Result: **1,340 checks, 0 churn** (seat pinned).
- **open finding (reported, not asserted):** duplicate hand serials — **1 frame** in this game
  (M1). Printed in the probe's console report.

Run: `npx vitest run src/probes/wholeGameSwapInertness.probe.dom.test.ts`. The console report
(`[swap-inertness probe] {...}`) prints counts + the duplicate-serial frames.

**Deliberate scoping the next agent must know:**
- Animations run *off* (0-size rects in happy-dom) to isolate reactive-DOM keying. It does **not**
  cover M3/M4 timing — those need the real-browser rig.
- The seat is **pinned** (`followActive=false`) so M2's remount doesn't mask the keying check.
  Un-pinning reproduces M2 (churn at turn boundaries) — a useful second mode.
- It skips the 1 duplicate-serial frame to avoid the dev-only `each_key_duplicate` throw; that
  frame is captured as data-level evidence instead.

**Promotion path:** once M1 is fixed at the source, add a hard guard
`expect(duplicateHandSerialFrames(views)).toEqual([])` and extend the harness to drive the *live*
`game.svelte` stepper (via `LocalEngineController`, as `App.dom.test.ts` does) so the settle/handoff
seam (M3) is exercised, not just state swaps.

## Existing guards to build on

- `src/App.stability.dom.test.ts` — asserts a decision-target slot is *inert* at idle and that
  playback of one pick never touches the other slots (nodes, classes, `data-anim-hidden`). This is
  the single-step inertness guard; the new probe is its **whole-game** generalisation. Merge their
  philosophies: extend App.stability to run a MutationObserver over a full game, failing on **any**
  unexpected boundary mutation.
- `src/App.handStability.dom.test.ts`, `src/App.dom.test.ts` — hand + click-path DOM guards.
- `actionAnimationCoverage.test.ts` — totality of the classifier.
- Env-gated real-engine integration: `CABT_ENGINE_MODE=native`,
  `PYTHON=.../agent-lab/.venv/bin/python`, `CABT_SAMPLE_SUBMISSION_DIR=.../sample_submission`.

## Known history folded in (do not re-file)

preserve-3d board hit-testing (fixed, `transform-style:flat`, e9745e2); discard blank from
keyed-by-layer remount (fixed, key by card identity — **re-confirmed stable here**); hand flicker
from positional serial fallback (fixed, serial resolves exactly or not at all — anchors.ts:89);
reveal sprites stranded (fixed, guaranteed session conclusion — RevealSessionLayer:126); per-seat
stream dedupe by position not content (F4, liveSteps.ts:37). The pattern the history shows —
most defects were identity/keying/claim-lifecycle, several only visible to a real mouse — holds:
M1 is identity, M2 is remount-lifecycle, M3/M4 are claim-lifecycle timing, and M3/M4 plus the
no-prompt future are exactly the real-mouse-only class.
