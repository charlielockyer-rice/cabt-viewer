# Audit: live-play animation integration (2026-07-07)

Scope: the four symptoms from tonight's Self-vs-copycat-v0 game, plus a fit
review of the animation backbone's live-play integration. Replay mode is not
in question — it follows `docs/replay-animation-architecture.md` and is well
tested. Live play is where the seams are.

## Executive summary

Live play violates the architecture's core premise in two ways. First, event
identity is broken: the engine delivers per-player *delta* logs, so the same
log lines arrive twice (once per perspective), and `localEngine.appendTimeline`
assigns fresh ids on every arrival (`localEngine.ts:490-492`) — the gate
tracks *ids*, not content, so every actor switch re-animates the previous
turn. Measured empirically through the bridge: on the agent's first
observation after a human action, **12 of 13 logs were duplicates** of
already-delivered lines. Second, live feeds the animation backbone cumulative
timelines against final board state (Step playback defaults off,
`viewSettings.svelte.ts:43`), while everything downstream was designed for
replay's per-phase projected views. The scattered live-only patches —
`knownHands`, synthesized playback prompts, agent-view filtering, the
sequence stepping loop — are compensations for that mismatch, and they leak
(placeholder hands without serials break anchors; hide claims land on
top-of-pile fallbacks). Root fix: give live play the same per-action phase
contract replay already has, and delete the patches.

## Symptom diagnoses

### 1. "After my turn finishes, the whole turn re-animates"

**Root cause: duplicate logs re-enter the timeline with new ids.**

The engine's observations carry logs since *that actor's* last observation.
When the turn passes to the agent, the agent's first observation re-contains
the human turn's logs. Probe through the real bridge (first-legal agent,
hydrapple mirror):

```
step3: actor=1 logs=17 dupes_of_earlier=2
step5: actor=1 logs=13 dupes_of_earlier=12   <- agent obs re-delivers human turn
```

`appendTimeline` converts every observation's logs with a fresh id range
(`localEngine.ts:489-492`, `cabtLogsToTimeline(logs, { nextId: this.timelineId })`)
and appends to the cumulative `actionTimeline`. `AnimationEventGate` batches
"unseen" events by **id** (`gate.ts:37-41`, `timing.ts:39-40`), so re-id'd
duplicates always animate. Every actor switch therefore replays the prior
turn's motions. This is the primary driver of symptoms 3 and 4 as well.

### 2. "Opponent's hand count wouldn't fully update"

**Root cause: perspective-flipping views plus re-fired draw animations
claiming hand slots.**

Live sequence views are built from whichever player's perspective the engine
observation happens to be (`demoEngine.ts:436-437`: `activePlayerIndex =
current.yourIndex`; hands render from `player.hand` when present, otherwise
`handCount` placeholder card backs, `demoEngine.ts:463-466`). During the agent's
turn the human-perspective hand data goes stale; `withKnownHands`
(`localEngine.ts:457-483`) patches a hand back in **only when the remembered
hand length equals the current `handCount`** — exactly the interesting moments
(draw, prize to hand, discard from hand) fail the check and fall back to
serial-less placeholders. Meanwhile each re-fired duplicate draw batch claims
hand-slot elements with mode `element` for the animation window
(`ViewportAnimationLayer.svelte:483-575`, `claim(target)` per draw), hiding
real card backs while sprites fly again. Net effect: the opponent's hand
visually lags or under-counts until claims release and a fresh
correct-perspective observation arrives.

### 3. "Prize cards I drew were hidden until the next turn, then re-drawn"

**Root cause: per-player log delivery delays the prize-take event, and the
knownHands length check hides the card meanwhile; the duplicate then
re-animates it.**

A KO + prize-take usually happens on the attack that ends your turn, so those
logs first arrive in the *agent's* observation (per-player delta). For the
whole opponent turn, views of your hand come from `withKnownHands` — but your
`handCount` grew by the prize card, the length check fails
(`localEngine.ts:470-472`), and your hand renders placeholders/stale content
without the prize card. When your next observation finally arrives with the
same logs again (duplicate), the prize-take animates a second time
(`ViewportAnimationLayer.svelte:645-737`) — the "re-drawn next turn" you saw.
`prizeSourceRects`/`takeIndex` extrapolation happily animates from already-empty
prize slots, which is correct for replay but masks the duplication here.

### 4. "Opponent's discard pile constantly went blank"

**Root cause: re-fired KO/discard/mill animations repeatedly hide the pile's
top card (or the pile), because live cards have no serials and discard anchors
degrade to coarse fallbacks.**

Live observations carry no `serial` on cards (serials are synthesized by the
replay pipeline; the bridge's raw player objects have none — verified against
a live bridge session). Discard motions hide
`{ kind: 'discard', exact: true, serial, cardId }` (`motions.ts:544-546,
582-584`); with `serial` undefined, `discardCardElement` matches **by cardId**
(`anchors.ts:136+`) — any copy, usually the top card — and non-exact discard
anchors fall back exact → top card → whole pile (`anchors.ts:54-61`). Combine
with symptom 1's re-fire storm: every actor switch re-claims the discard's
top card / pile element for the duration of a KO-or-mill animation, and a
small pile reads as blank over and over. `RevealSessionLayer` adds to this
during search-heavy turns (hydrapple!): its scope-change session clearing is
replay-gated (`RevealSessionLayer.svelte:82`), so live sessions and their
`contents` claims can linger until the next reveal batch.

## What fits well

- **The visibility manager** (`visibility.ts`): single attribute, ref-counted
  claims, one owner. Nothing else in the codebase hides cards. This is the
  strongest invariant and it held up under audit.
- **Semantic anchors with fallback chains** (`anchors.ts`): the design is
  right; live's problems are missing *data* (serials), not the resolver.
- **The motion contract + choreograph as pure classifier** (`motions.ts`):
  clean separation; layers don't classify events, tests cover grouping.
- **The gate as a concept** (`gate.ts`): 40 lines, one job, honestly
  documented. It does exactly what it promises — the inputs betray it.
- **Replay's phase pipeline** (`cabtReplay.ts` + projected phase views):
  the architecture doc's contract is real and tested (3.8k lines of tests).
- **Board/viewport layer split** and cross-plane projection: no coordinate
  system leaks found.

## What doesn't fit (ranked)

1. **Event identity is positional, not semantic** (`localEngine.ts:489-492`).
   Ids are assigned per arrival with no dedupe, while the engine's delivery
   is per-player and overlapping. This single mismatch produces most of what
   you saw. The gate's "unseen tail" premise requires stable identity.
2. **Live's data shape contradicts the backbone's contract.** Replay: each
   phase = its own events + a projected view of the board *as it should look
   during that phase*. Live: cumulative timeline + already-final board, one
   burst (Step playback off is the default — `viewSettings.svelte.ts:43`).
   Anchors then resolve against end-state DOM; sources have often already
   vanished; claims attach to whatever the fallback chain finds.
3. **The "one live adapter" claim is no longer true.** Beyond the gate,
   live-only compensations live in four places: `withKnownHands`
   (`localEngine.ts:457`), `revealPromptForLogs` synthesized prompts
   (`localEngine.ts:522`, with collision-prone `id: -this.timelineId`),
   `isAgentDecisionView` filtering (`localEngine.ts:513`), and the
   sequence-stepping loop with fixed delays in `gameStore.apply`
   (`game.svelte.ts:66-93`). Each is a patch over the data-shape mismatch.
4. **Perspective mixing.** Views inherit the observation's `yourIndex` as
   `activePlayerIndex` and hand visibility (`demoEngine.ts:436`), so live
   sequence views alternate perspective mid-turn. The viewer has a fixed seat;
   the view builder should too. `knownHands` exists only because of this.
5. **Serial-less live cards.** Replay synthesizes stable serials; live never
   did. Exact-card anchors, hand-slot-by-serial, attached-card anchors all
   silently degrade in live mode.
6. **Old prompt/selection layer is logically sound but visually parallel.**
   `promptSelectionModel.ts` / `setupSelectionModel.ts` are small, tested,
   pure models (good). But playback-only prompts synthesized from log
   patterns (`revealPromptForLogs`) duplicate what `RevealSessionLayer`
   already animates — two systems now own "show milled/revealed cards",
   violating the "exactly one system animates an event" invariant.

## Recommended path

**Unify live on the phase contract instead of patching the cumulative path.**
The local engine already receives per-decision observations (`autoSteps`);
those are natural phase boundaries. The shape:

1. **Stable event identity at the source.** In `appendTimeline`, dedupe
   incoming logs against a content-keyed cursor (the engine gives no log ids,
   so key on the serialized log + a monotonic per-game sequence that tolerates
   the per-player overlap). Duplicates get dropped, not re-id'd.
2. **A live step builder** that turns each observation's *new* logs into a
   step `{ events, view }` — the view being the board state *at that
   observation*, seat-fixed to the viewer (always render from the human's
   seat; opponent hand from `handCount`, own hand from the last own-perspective
   observation — this replaces `withKnownHands` with an explicit rule instead
   of a length heuristic). Synthesize serials the way the replay pipeline
   does, so anchors regain precision.
3. **Play steps through the same machinery replay uses** (the stepper in
   `gameStore.apply` becomes the one consumer; `animateActions` stops being a
   correctness switch and becomes pacing only). The gate keeps its replay
   scope behavior; its live "unseen tail" mode shrinks to a no-op and can be
   deleted.
4. **Delete the compensations**: `withKnownHands`, `revealPromptForLogs` (the
   reveal session layer already owns that animation), `isAgentDecisionView`
   filtering (the step builder simply doesn't emit steps for agent decision
   points).

This is a few focused days, mostly in `localEngine.ts`, reusing grouping
logic from `cabtReplay.ts` rather than duplicating it. It removes code on
net and makes live/replay share one honest contract, which is the
simplification you asked for.

| Old piece | Verdict | Note |
|---|---|---|
| `AnimationEventGate` live mode | **Replace** | Phase steps make "unseen tail" unnecessary; keep replay scope logic |
| `gameStore.apply` sequence loop (`game.svelte.ts:66`) | **Adapt** | Becomes the single step player for live phases; delays → pacing only |
| `withKnownHands` (`localEngine.ts:457`) | **Replace** | Seat-fixed view builder with explicit own-hand rule |
| `revealPromptForLogs` (`localEngine.ts:522`) | **Delete** | RevealSessionLayer owns reveal animation; prompt duplicated it |
| `isAgentDecisionView` (`localEngine.ts:513`) | **Delete** | Step builder emits no step for agent decision points |
| `promptSelectionModel` / `setupSelectionModel` | **Keep** | Pure, tested input models; restyle later if desired |
| `cabtLogsToTimeline` (`logFormat.ts`) | **Adapt** | Add content-keyed identity + dedupe cursor |
| Anchors / visibility / choreograph / layers | **Keep** | Feed them correct data; they already behave |

## Quick fixes (status as of 2026-07-07 evening)

1. **IMPLEMENTED — log dedupe.** `src/engine/logDedupe.ts` (content-signature
   sliding window, 300 entries) filters every observation's logs in
   `appendTimeline` before `cabtLogsToTimeline`; the deduper resets with the
   session. Unit tests in `src/engine/logDedupe.test.ts`. Verified against a
   live bridge session: 39 of 90 delivered logs were re-deliveries and all
   were dropped, including the actor-switch observations behind symptom 1
   (worst case raw=13 → kept=3).
2. **IMPLEMENTED — turn-boundary claim release.** All three animation layers
   take a `turnKey` prop (`turn-${game.turn}` in live, constant in replay)
   and run `endScope()` / `clearSession()` when it changes, so no claim,
   sprite, or reveal session outlives the turn that created it.
3. **IMPLEMENTED — Step playback defaults ON** (`viewSettings.svelte.ts`), so
   live events animate against each intermediate view instead of one burst
   against the final board.
4. **IMPLEMENTED — live reveal-session clearing** via the same `turnKey`
   boundary in `RevealSessionLayer` (replay behavior unchanged; sessions that
   continue into the incoming batch still survive the boundary).
5. **IMPLEMENTED — animation-gated sequential playback** (follow-up to the
   fixed-cadence problem: agent actions overlapped into garbled animations).
   `src/lib/anim/activity.ts` is a shared busy-until signal: when a layer
   schedules a live batch it reports the batch's scheduled end
   (`scheduledEndMs` + handoff/settle padding), and `gameStore.apply` awaits
   idle before applying the next sequence view (and before the first view of
   a new response). "Step ms" is now the *minimum gap between views*, not the
   cadence; per-step waits are capped at 5s so a stuck destination poll can't
   deadlock playback. Playback-prompt confirms are unchanged. Replay pacing
   untouched (it never consults the signal). Note this is interim mechanics:
   the structural live-step builder below subsumes it — once live produces
   proper phases with durations, the stepper can pace from phase metadata the
   way replay does, and the busy-signal becomes a safety net only.

### Still outstanding

- **Dev overlay for stuck hides**: `animVisibility.hiddenCount()` already
  exists; surface it in the debug settings panel to catch claim leaks early.
- **Dedupe caveat** and **the "Recommended path" section above** —
  **LANDED same day.** The seat-fixed live step builder shipped
  (`src/engine/liveSteps.ts` + reworked `localEngine.appendSteps`), with
  positional per-seat-stream dedupe instead of content dedupe (it pairs the
  perspective-variant draws this caveat worried about — measured at roughly
  one variant pair per draw, not "occasional"). `withKnownHands`,
  `revealPromptForLogs`, `isAgentDecisionView`, `logDedupe`, and the gate's
  live mode are deleted. Details and divergences:
  `docs/audit-2026-07-07-viewer-play-pipeline.md`, "Implementation
  addendum". One correction to this document: live observations do carry
  card serials on known cards (probe-verified); only hidden hand cards
  needed synthesized identity.
