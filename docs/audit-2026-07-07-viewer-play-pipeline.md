# Audit: the live-play pipeline around the animations (2026-07-07)

Scope: the whole viewer play pipeline — App.svelte game flow → server.ts →
localEngine.ts → cabt_bridge.py → engine and back — plus seat/perspective
handling, format proliferation, the prompt system, this week's integration
seams, and the "should the viewer consume cabt_service?" question. This is the
layer yesterday's audit (`audit-2026-07-07-live-play-animation.md`) did *not*
go deep on. Baseline before any judgment: `npx vitest run` 225/225 green,
`tsc -p tsconfig.build.json --noEmit` clean. Claims marked "probe" were
verified against the real engine via a headless bridge session
(agent-vs-agent full game, official Abomasnow deck mirror).

## Executive summary

The live-play layer is two codebases wearing one trenchcoat. Underneath is a
small, honest CABT core: a 232-line bridge speaking raw engine observations,
an option-index prompt path that already matches the engine's select model
end-to-end, and a pure observation→GameView projection. On top is the fossil
of a different engine — the ptcg-server-era interaction layer: a 20-class
prompt taxonomy of which live CABT emits **four**, a semantic command API
(`playCard`/`attack`-by-name/`useAbility`-by-name) that must be
reverse-matched onto engine options by predicates, client-side legality
guessing that contradicts the engine, and roughly two thousand lines of
board-prompt machinery (SetupDock, attach-energy assignment, damage
strategies, target protocols) that is **unreachable in live play** — only the
prompt gallery can trigger it. The inconsistencies Charlie still sees are
mostly this layer fighting the engine's model: clicks that look legal but
bounce off the engine, Cancel buttons that can never succeed, retreat state
smuggled across requests, and a seat model where "active player" means
"whoever the engine is asking right now."

Two projections of the same data (live vs replay) have already drifted —
they disagree on what a draw result is. And event identity, patched
yesterday with content-dedupe, is measurably still broken at the source:
in the probed game, 35 of 36 draws were delivered twice in different
per-seat encodings (both pass the filter), while six identical prize-set
log lines inside one observation were collapsed to one (the filter
over-fires). Both directions are wrong; only the bridge can fix identity.

The from-scratch shape is one idea: **the engine's select is the only
interaction contract.** Project every select (main phase included) as a
decision with indexed options; every UI affordance derives from those
options; one `select` command carries indexes back. That deletes the
matchers, the legality guessing, the taxonomy, and most of App.svelte's
wiring — and it composes cleanly with yesterday's seat-fixed step-builder
plan. Verdict on cabt_service: don't consume it (it's an LLM decision
boundary without per-step observations, in a private repo feeding a public
one); converge the agent contract and protocol shape instead.

## The pipeline as-built

```
App.svelte (1,520 lines: mode/seat state, gesture wiring, prompt routing)
  └─ httpClient.ts  POST /local-engine {type, payload, sessionId}
       └─ vite proxy → server.ts (:8095, thin HTTP shim + agents/decks/save)
            └─ LocalEngineController (localEngine.ts, 975 lines)
                 ├─ command switch → option predicate matchers → applySelection
                 ├─ CabtBridgeClient (spawn, JSON-lines, no timeout)
                 │    └─ cabt_bridge.py (232 lines: battle_start/select,
                 │         in-process agent(obs) seats, auto-play loop)
                 ├─ withKnownHands / logDeduper / appendTimeline / replayFrames
                 └─ cabtObservationToGameView (demoEngine.ts) → GameView
                      └─ EngineResponse {view, sequence[], sessionId}
                           └─ gameStore.apply: animation-gated sequence playback
```

Replay is a parallel universe: Kaggle/saved JSON → `cabtReplayToSnapshot`
(cabtReplay.ts, 2,806 lines) → its own `frameToGameView` → `replayStore`.
Live and replay meet only at the GameView type and the animation layers.

## Findings, ranked by architectural weight

### F1. The interaction layer is a fossil of another engine, and most of it is dead in live play

**What.** The viewer's UI-facing contracts are inherited from a
ptcg-server-style engine and were never re-derived for CABT:

- A semantic command API — `playCard(playerIndex, handIndex, target)`,
  `attack(name)`, `useAbility(name, target)`, `concede`, … (`gameApi.ts:3-12`,
  `httpClient.ts:129-159`).
- A 20-class prompt taxonomy (`prompts.ts:3-23`) with a matching PromptHost
  dispatch (`PromptHost.svelte:46-79`).
- The `PlayerType`/`SlotType`/`CardTarget` addressing scheme and magic phase
  numbers 0/2/7 (`types.ts:1-21`, `demoEngine.ts:441`).
- Naming residue: `hostedAvailableActionsScope` (`httpClient.ts:55`).

Live CABT emits exactly four prompt classes: `ChoosePrizePrompt`,
`ChooseCardsPrompt`, `SelectPrompt` (`demoEngine.ts:593,618,646`) and the
playback-only `ConfirmCardsPrompt` (`localEngine.ts:539`). Everything else in
the taxonomy is produced **only by prompt-gallery fixtures**
(`src/lib/prompt-gallery/fixtures.ts`); `cabtReplay.ts` emits zero prompts
(`cabtReplay.ts:2477`, `prompts: []`). Consequently all of the following can
never trigger in a real game:

- The setup board-placement flow: `SetupDock.svelte`, `setupSelection*`,
  `getSetupPromptUiState` — gated on `message === 'CHOOSE_STARTING_POKEMONS'`
  (`App.svelte:318`), a message no CABT path produces (live setup arrives as
  a `ChooseCardsPrompt` titled "Choose Active Pokemon",
  `demoEngine.ts:874`). Real setup is a card-list dialog; the nicer
  board-placement UX is dead weight.
- The three board strategies (`createPutDamageStrategy`,
  `createDamageTransferStrategy`, `createChoosePokemonStrategy`,
  `App.svelte:356-382`), `damageTransferStore`, the attach-energy assignment
  machinery in `promptSelectionStore`, and the whole
  `targets.ts` blocked/`playerType` field protocol (`targets.ts:54-91`).
- `AttachEnergyPrompt`, `EnergyTransferPrompt`, `CoinFlipPrompt`,
  `WaitPrompt`, `ChooseAttackPrompt`, `ShuffleOrderPrompt`, mulligan/alert
  hosts; the `ShuffleDeckPrompt` and `GO_FIRST` auto-resolve rules
  (`prompts.ts:85-95`).
- ~1,900 lines in these modules alone (excluding their tests), plus several
  hundred lines of `App.svelte` wiring (`App.svelte:241-350, 1015-1203`).

Adjacent dead code in the same layer: `concede` is in the toolbar but always
errors (`localEngine.ts:137`); `listReplays`/`loadReplay`/`loadReplayData`
and the `/local-engine/replays*` endpoints are stubs with no callers
(`localEngine.ts:157-170`, `server.ts:65-90`); `hostedAvailableActionsScope`
/`hostedAvailableActionsOptions` and `localGameApi.state()` have zero call
sites (`httpClient.ts:55-77,114-116`); `commandApi` is a `$derived` of a
constant (`App.svelte:130`); `CabtObservation.search_begin_input` is set only
by the demo controller and read by nothing (`types.ts:236`,
`demoEngine.ts:239`).

**Why it matters.** This is the staleness the owner senses. Every live-play
change threads through contracts that live play cannot exercise, App.svelte
carries ~10 derived chains for prompts that never appear, and the prompt
gallery — not the game — is what keeps this code "used." It also inverts the
testing story: the best-tested interaction code is the unreachable half.

### F2. The command surface duplicates the engine's select model — legality is guessed client-side, then re-derived server-side, and both guesses can be wrong

**What.** The engine's `select.option` list is a complete, indexed statement
of what is legal right now. The viewer ignores it in the main phase and
reconstructs it twice:

1. **Client-side guessing.** Board affordances come from card metadata, not
   options: `canPlayCardToSlot` treats any name-matching evolution as
   playable (`playTargets.ts:50-52` — no `appearThisTurn`, no first-turn
   rule), any energy as attachable (`playTargets.ts:74-76` — no
   once-per-turn check), and `playableCardIds` is literally the whole hand
   (`demoEngine.ts:478`). `availableActions` (attacks/abilities/retreat) is
   option-derived and correct (`demoEngine.ts:735-773`) — so the same view
   mixes real legality with guessed legality.
2. **Server-side re-matching.** `playCard`/`attack`/`useAbility`/`retreat`/
   `passTurn` are translated back into an option index by predicates —
   `matchesPlayCardOption`, `matchesAttackOption` (attack **by name**,
   `localEngine.ts:576-581`), `matchesAbilityOption` (ability by first-skill
   name, `localEngine.ts:583-601,616-619`). A miss throws "That action is not
   currently legal in the CABT engine" (`localEngine.ts:270`).

When the guess and the engine disagree, the user gets an error toast for a
click the UI invited. Meanwhile the **prompt path already does it right**:
prompts carry option indexes end-to-end (`demoEngine.ts:599,624` →
`ChooseCardsPrompt.svelte:68` → `resolvePrompt` →
`normalizePromptSelection` → `applySelection`, `localEngine.ts:642-653`).
Two interaction paradigms coexist in one controller; the lossy one owns the
main phase.

Concrete warts this produces today:

- **Cancel buttons that cannot succeed.** Live prompt components offer
  Cancel resolving `null` (`SelectPrompt.svelte:102`,
  `ChooseCardsPrompt.svelte:133`, `ChoosePrizePrompt.svelte:102`); `null`
  normalizes to `[]` (`localEngine.ts:643-645`), and any select with
  `minCount >= 1` — i.e. nearly all of them — throws "Selection must contain
  1-1 option(s)" (`localEngine.ts:283-285`). Engine prompts are not
  cancellable; the affordance is a lie inherited from an engine where it
  wasn't.
- **Cross-request retreat state.** `pendingRetreatTarget`
  (`localEngine.ts:103,250-261,391-418`) smuggles the bench choice past
  intermediate energy-discard prompts by auto-consuming any later select
  that happens to contain a matching BENCH option for that seat. It is
  cleared only when consumed, on failure of the initial RETREAT match, or on
  session reset — there is no abandon path, so it survives arbitrary
  interleavings and can claim a later, unrelated bench choice.
- **The DISCARD_ENERGY batching special case.** The engine asks for energies
  one at a time; the UI wants one multi-select. The compensation spans both
  layers: `repeatedEnergyPaymentCount` fakes min/max in the projection
  (`demoEngine.ts:662-685`) and `applyRepeatedSingleSelections` replays
  single selects, re-finding each card by serial as options reshuffle
  (`localEngine.ts:310-357`). ~90 lines to hide one honest sequence of
  prompts.

**Why it matters.** This layer is where "issues and inconsistencies in live
play" are structurally guaranteed: two legality oracles that can disagree,
name-string action identity, hidden cross-request state, and error paths as
UX. None of it would exist if affordances were projections of options.

### F3. The seat model conflates "seat being asked" with "turn player", and hand knowledge is a count-based heuristic

**What.** Probe results against the real engine: `players[]` is seat-stable
(card `playerIndex` always equals array index), exactly the seat matching
`yourIndex` has a non-null hand, and `yourIndex` flips **mid-turn** whenever
the engine needs the other seat's input — in one probed game, 4 of 9 flips
were mid-turn (setup placement, `DRAW_COUNT`, and two KO-replacement
`TO_ACTIVE` selects). The projection nevertheless defines
`activePlayerIndex = current.yourIndex` (`demoEngine.ts:436`) and everything
downstream treats it as "whose turn it is": the status bar
(`App.svelte:1263`), board-follow rotation (`App.svelte:384-388`), action
gating (`canPlayerAct`, `playTargets.ts:87-89`), and `targetToCabt`'s
actor-relative addressing (`localEngine.ts:968-975`). The turn player is
actually derivable statelessly — `(firstPlayer + turn - 1) % 2` — but no
GameView field carries it, nor the viewer's own seat.

The same missing seat model forced `withKnownHands`
(`localEngine.ts:460-485`): hands vanish whenever the other seat is being
asked, so a cache re-attaches the last known hand — but only when
`handCount` matches the cached length. Equal-count changes (discard one,
draw one) silently show stale cards; unequal counts degrade to serial-less
placeholders (`demoEngine.ts:466-467`), which yesterday's audit traced into
animation symptoms 2 and 3. Seat control is *also* duplicated: the server
tracks `playerControls` (`localEngine.ts:108,229`) while the client keeps its
own copy in `activePlayerControls` (`App.svelte:105,503`) because GameView
says nothing about seats; a reload desynchronizes them (module-level
`currentSessionId`, `httpClient.ts:27`, means the client can't reattach
anyway).

**Why it matters.** Perspective is the suspected source of remaining
live-play weirdness, and the model confirms it: the UI's one
"active player" concept is three distinct concepts (viewer seat, turn seat,
deciding seat) that only coincide in the happy path. Every mid-turn forced
select momentarily relabels the game as the opponent's.

### F4. Event identity is still unsolved at the source — the dedupe filter both under- and over-fires (probe-verified)

**What.** Yesterday's quick fix (content-keyed sliding window,
`logDedupe.ts`) treats log content as identity. The engine's delivery makes
that wrong in both directions:

- **Perspective-variant duplicates pass.** The engine re-delivers each seat's
  missed events in *that seat's* encoding: the drawing seat gets `Draw` with
  `cardId`, the other seat gets `DrawReverse` without. Probed game: 36 `Draw`
  vs 35 `DrawReverse` in one stream — essentially **every draw arrives
  twice**, in content the filter cannot pair. Both become timeline events
  ("Player 2 drew Abomasnow." then "Player 2 drew a card.",
  `logFormat.ts:63-66`), so draws can double-animate — and the concrete
  variant **leaks hidden information**: agent-seat observations flow through
  `appendTimeline` regardless of seat (`localEngine.ts:487-518`), so the
  human-visible timeline (`LogPanel`) names the opponent's drawn cards.
  Yesterday's doc called this "occasional"; it is the common case.
- **Legitimate repeats are eaten.** Six identical prize-set lines
  (`{type:7, fromArea:1(DECK), toArea:6(PRIZE)}`, no serial) arrived inside
  one observation; the content-set keeps one (`logDedupe.ts:24-31` has no
  multiplicity), so five prize placements produce no event. Any repeated
  identical action within the 300-line window (same-result attack two turns
  running, multi-card reverse mills) is silently dropped.
- Total measured redundancy: 125 of 249 delivered lines were exact
  re-deliveries — the deduper is load-bearing, and it's the wrong tool.

**Why it matters.** The animation backbone's core premise is stable event
identity (yesterday's finding #1). Content-dedupe in the controller cannot
manufacture identity that the transport destroyed. Only the bridge — which
sees every observation in order — can build a canonical event stream: keep
per-seat delivery cursors, emit each physical event once (preferring the
information-rich encoding for the *viewer's* seat and the reversed encoding
for hidden info), and tag it with a monotonic sequence number.

### F5. Format proliferation: two GameView projections, two observation typings, three option→card resolvers — already drifting

**What.** Representations currently in play:

1. Raw `CabtObservation` (`types.ts:232-237`) — bridge payload. Load-bearing.
2. `CabtVisualizeFrame` (`cabtReplay.ts:39-84`) — the same engine frame
   retyped independently for replay. Pure duplication.
3. `GameView` (`game/types.ts:147-160`) — the UI projection. Load-bearing.
4. Saved local replays: pseudo-Kaggle `{visualize, environment}`
   (`localEngine.ts:183-192`) — good convergence (one reader), but frames are
   saved *hydrated* with `withKnownHands` output, and they land in
   `public/game-logs/` which is not gitignored (runtime artifacts appear as
   untracked repo files; `public/local-replays` is ignored but unused).
5. Kaggle episode JSON (`cabtReplay.ts:86-106`) — external, must support.
6. `ReplaySnapshot`/`ReplayStep` (`game/replay.ts`) — replay pipeline output.

The duplications that hurt:

- **Two projections.** `cabtObservationToGameView` (`demoEngine.ts:415-452`)
  vs `frameToGameView` (`cabtReplay.ts:2455-2481`) — parallel
  `buildPlayerView`s, parallel `stadiumForPlayer`s, and **divergent winner
  semantics**: replay maps engine result 2 → `winner: 3` → "Draw"
  (`cabtReplay.ts:2474`, `App.svelte:404-411`), live passes result through
  (`demoEngine.ts:445`) so a drawn live game reads "Game finished" and
  `saveReplay` records `result 2` (`localEngine.ts:202`).
- **Three option→card resolvers.** `cardForOption`+`attachedCardForOption`
  exist in localEngine (`localEngine.ts:367-389,955-966`) and demoEngine
  (`demoEngine.ts:810-861`) with different area coverage (demoEngine handles
  `cardId`/`deck`/`LOOKING`; localEngine's copy handles `LOOKING`/`STADIUM`
  but not `deck`), plus the replay pipeline's own frame-side lookups.
- **A third engine.** `CabtDemoController` (`demoEngine.ts:150-413`) is a
  931-line file whose top half is a hand-rolled mini-engine used only for
  `CABT_ENGINE_MODE=demo` and two scaffold tests — and it shares its module
  with the load-bearing projection, which is why the projection lives in a
  file named "demoEngine".

**Why it matters.** Semantic decisions (winner mapping, hand visibility,
stadium ownership, option resolution) must be made once. Today each is made
two or three times, and the drift is no longer hypothetical.

### F6. Bridge protocol robustness: unbounded waits and an unguarded stdout

**What.** `CabtBridgeClient.request` registers a pending promise with **no
timeout** (`localEngine.ts:698-704`); a wedged native engine or a lost
response hangs the HTTP request forever. And responses *can* be lost:
agents run in-process in the bridge, so `print()` writes to the protocol
stream. The viewer tolerates whole non-JSON lines (`localEngine.ts:761-768`,
commit a126b72), but an agent printing **without a trailing newline** glues
its output to the next JSON response — the merged line fails parsing, is
dropped, and the pending request never resolves. The principled fix is in
the bridge: point `sys.stdout` at stderr for the process and keep a private
handle to the real stdout for protocol writes (`cabt_bridge.py:228`).
Smaller: the parse-error path reuses a stale `message` id
(`cabt_bridge.py:227`), and macOS still defaults to Docker
(`localEngine.ts:786-820`) even though the engine now ships native
mac-arm64 builds — and Docker mode breaks workspace agents, whose manifest
paths resolve to absolute host paths (`workspaceAgents.ts:66`) that don't
exist inside the `/workspace` mount. Workspace agents effectively require
`CABT_ENGINE_MODE=native`; nothing says so.

**Why it matters.** These are exactly the failure modes of "agent seats +
subprocess protocol", i.e. the new integration surface. Every one is a
silent hang or an environment-dependent break rather than an error message.

### F7. Two repos, two agent contracts, two engine adapters

**What.** The bridge and the harness have independently grown the same
organs: engine adaptation (`cabt_bridge.Session` vs `CabtEngineAdapter`,
`engine.py:44-121`), the auto-play-until-human loop (`cabt_bridge.py:135-150`
vs `session.py:203-224`), Kaggle agent loading (`load_agent`,
`cabt_bridge.py:47-85` vs `PythonFunctionPlayer`, `players.py:82-121`), and
deck validation. Worse, they diverge on the deck-general agent contract: the
viewer **pushes** with a module-level `set_deck(deck, seat)` hook
(`cabt_bridge.py:47-50,106-108`) while the harness **pulls** with
`choose_deck(seat)` / a null-observation `agent()` call (`players.py:90-92`).
Both semantics are legitimate (the viewer assigns decks; the harness lets
agents bring theirs), but an anyDeck agent like copycat needs a shim per
repo, and nothing documents which hook is canonical.

**Why it matters.** The agent contract is the thing third parties (and your
own farm) write against. Two dialects means every agent grows
compatibility code, and drift compounds — see F6's stdout problem, which the
harness solves differently (out-of-process stdio service) than the viewer
(in-process + tolerant parser).

## What fits well

Being fair — a lot of the CABT-native core is right:

- **The bridge is the right kind of boundary.** 232 dependency-free lines,
  JSON-lines, raw observations, spawn-per-game neutralizing the engine's
  one-battle-per-process global state (`localEngine.ts:220`,
  `cabt_bridge.py:88-169`). Nothing here fights the engine.
- **The prompt path is the correct model, already shipped.** Option indexes
  flow untranslated from `select.option` to the click handler and back
  (`demoEngine.ts:599` → `ChooseCardsPrompt.svelte:68` →
  `localEngine.ts:642-653`). The from-scratch shape below is "do this
  everywhere", not something new.
- **Stale-prompt rejection server-side** before touching the bridge
  (`localEngine.ts:295-308`), with a test proving no bridge call
  (`localEngine.test.ts:434-486`).
- **The projection is a pure function** (`cabtObservationToGameView`) — no
  store coupling, trivially testable; the problem is its duplicate, not its
  design.
- **`workspaceAgents.ts` is a model integration seam**: 76 lines, pure
  manifest reading, tested, with the deck served through a clean endpoint
  (`server.ts:52-63`) and graceful absence (`catalog.ts:29-31`).
- **`saveReplay` converging on the Kaggle envelope** means one replay reader
  for three sources — the right instinct even before the cleanup F5 asks for.
- **`gameStore.apply`'s generation guards** around the async playback loop
  (`game.svelte.ts:41-122`) are careful and, as far as inspection and tests
  show, correct.
- **anyDeck's default-not-lock behavior** is implemented exactly as designed
  (`App.svelte:180-207`), with the locked/anyDeck distinction honored at
  start (`forcedDeckSource`, `App.svelte:565-567`).

## The from-scratch shape

Design premise: the animation backbone (per-phase steps, semantic anchors)
and multi-agent play (0, 1, or 2 human seats) are first-class; the engine's
select is the *only* interaction contract; every semantic decision is made
once.

**1. Selects all the way down.** GameView grows one field:

```
decision?: {
  seq: number;              // monotonic per game, assigned by the bridge
  seat: number;             // who the engine is asking
  kind: 'main' | 'choose-cards' | 'choose-option' | 'choose-prize' | ...
  min: number; max: number;
  options: Array<{ index; kind; card?; source?; target?; attackId?; label }>;
}
```

projected 1:1 from `select` (main phase included). Every affordance — hand
glow, attack button, retreat target, dialog row — derives from
`decision.options`; legality is presence. One command replaces eight:
`{type:'select', seq, indexes}`. The stale check becomes `seq` equality
(replacing the whole-state hash `promptIdForObservation`,
`demoEngine.ts:698-703`). Gesture→option mapping (click card, click bench
slot) moves client-side where the options already are, deleting the server
matchers, `pendingRetreatTarget` (retreat becomes: select RETREAT, engine
prompts for bench, UI shows it — or auto-answers it from the drag target,
as *UI* policy), the Cancel lie, and the energy-batching pair (the UI can
replay single selects itself, or just show the honest sequence).

**2. Seats as data.** GameView carries `viewerSeat`, `turnSeat`
(`(firstPlayer + turn - 1) % 2`), and `seats: [{control, name}]` from the
server's `playerControls`. `activePlayerIndex` disappears in favor of
`decision.seat` where "who is being asked" is meant. The client's
`activePlayerControls` copy dies. Views are always projected from the
viewer's fixed seat: own hand from the last own-seat observation, opponent
hand as count — an explicit rule replacing the `withKnownHands` length
heuristic (this is yesterday's step-builder item 2; the seat model here is
what makes it expressible).

**3. Identity at the bridge.** The bridge tags each response observation
with `seq` and emits a canonical event stream: per-seat delivery cursors so
each physical event appears once, hidden-info encoding chosen by the
viewer's seat, stable synthesized serials. `logDedupe` and the timeline id
counter die; the animation gate gets the stable identity it was designed
for. (This subsumes yesterday's "content-keyed cursor" sketch — cursors in
the bridge, not content hashing in the controller.)

**4. One projection module.** A single `cabtProjection.ts` owning
observation→GameView, option→card resolution, winner mapping, stadium
ownership — parameterized by hand-visibility policy (viewer-seat vs replay
omniscient). `cabtReplay.ts` keeps its grouping/phase pipeline but consumes
the shared projector; `CabtVisualizeFrame` folds into `CabtObservation`.
The demo controller is replaced by a recorded fixture (a saved real game
drives the gallery and offline dev better than a hand-rolled mini-engine).

**5. Prompt system.** `className` string dispatch shrinks to the CABT
`decision.kind` enum; PromptHost maps kinds to the four real components
(cards / options / prizes / reveal) plus the board-strip. The gallery keeps
its harness but its fixtures become captured real `select` payloads, so
gallery and game can no longer diverge. Board-driven setup placement — the
one genuinely desirable piece of the dead layer — gets rebuilt in miniature
against `SETUP_ACTIVE_POKEMON`/`SETUP_BENCH_POKEMON` decisions.

### Keep / adapt / replace / delete

| Piece | Verdict | Note |
|---|---|---|
| `cabt_bridge.py` | **Adapt** | stdout guard, seq numbers, per-seat cursors, canonical events |
| `CabtBridgeClient` | **Adapt** | add request timeout; otherwise keep |
| `server.ts` | **Keep** | drop dead `/replays*` endpoints |
| Command switch + matchers + `pendingRetreatTarget` + energy batcher (`localEngine.ts`) | **Replace** | single `select` command; gestures map client-side |
| `cabtObservationToGameView` (demoEngine.ts) | **Adapt** | becomes the one projector, new module |
| `CabtDemoController` + demo data | **Delete** | recorded-game fixture replaces `CABT_ENGINE_MODE=demo` |
| `frameToGameView` + frame types (cabtReplay.ts) | **Replace** | consume shared projector; keep grouping/phases |
| `prompts.ts` taxonomy, PromptHost dispatch | **Replace** | `decision.kind` enum |
| `playTargets.ts` legality guessing | **Replace** | derive from `decision.options` |
| SetupDock, `setupSelection*`, attach machinery, `damageTransfer*`, `strategies/`, `targets.ts` | **Delete** | live-unreachable; rebuild setup placement small, from decisions |
| `gameApi.ts`, `hostedAvailableActions*`, `concede`, `state()` | **Delete** | dead or always-error |
| `withKnownHands`, `revealPromptForLogs`, `isAgentDecisionView`, `logDedupe` | **Delete** | per yesterday's plan, enabled by 2+3 |
| `httpClient.ts` | **Adapt** | one `select` sender + start/save |
| `saveReplay` + Kaggle envelope | **Keep** | write raw (unhydrated) frames; move output under a gitignored dir |
| `workspaceAgents.ts`, agents/decks endpoints, anyDeck flow | **Keep** | align deck hook with harness (F7) |
| `gameStore.apply` playback, animation layers | **Keep** | consume steps per yesterday's table |

### Migration order

Each step lands green on its own:

1. **Bridge hygiene** (F6): stdout→stderr guard, request timeout, `seq` on
   responses. No UI change; kills the hang class.
2. **One projector** (F5): merge the two GameViews and three resolvers into
   `cabtProjection.ts`; fix the winner mapping; replay tests keep passing.
3. **Decisions** (F2/F1): project `decision` alongside existing prompts;
   port dialogs, then board gestures, to option indexes; delete matchers,
   semantic commands, legality guessing, Cancel-on-mandatory.
4. **Seat model + step builder** (F3/F4): `viewerSeat`/`turnSeat`, canonical
   bridge events, seat-fixed step stream — this is yesterday's recommended
   path, now with the data model it needs. Delete the four compensations.
5. **The sweep** (F1/F5): remove dead prompt components/stores/strategies,
   demo controller, dead endpoints; regenerate gallery fixtures from
   captured selects.

Steps 1–2 are pure risk reduction and can land this week; 3 is the big
unlock; 4 is the animation-contract payoff; 5 is the deletion dividend
(net LOC strongly negative).

## Should the viewer consume cabt_service instead?

**No — keep the in-repo bridge; converge the contracts.**

What consuming it would buy: one engine adapter, one agent loader, one
auto-play loop (~150 duplicated lines today), seeds, decision recording,
and a protocol already designed for external drivers
(`cabt_service/protocol.py:38-50`).

Why it loses:

- **It's a decision boundary, not a visualization feed.** `choose_action`
  returns opponent auto-play as `{player, source, labels}` summaries
  (`session.py:296-300`) — no per-step observations. The viewer's animation
  pipeline lives on exactly those intermediate observations (`autoSteps`).
  Feeding the viewer would require a protocol extension (per-step
  `after_observation` streaming), i.e. redesigning the service into what
  the bridge already is.
- **The repo boundary points the wrong way.** The harness is private; the
  viewer is public. Today a public clone plus the Kaggle bundle gives
  working live play. A dependency on private code breaks that, and the
  service can't be vendored into the public repo.
- **The duplication is small and cold.** The overlapping code is ~150
  stable lines that change when the engine changes (rarely), not when the
  viewer changes (weekly).

What *should* converge:

- **The agent contract (F7).** Pick one deck-hook story — support
  `set_deck(deck, seat)` in the harness's `PythonFunctionPlayer` (push) and
  keep `choose_deck` as the pull for self-decked agents — and document it in
  one place both repos cite.
- **Protocol shape.** Adopt the service's envelope (`{id, ok, result|error}`)
  and error style in the bridge so tooling and mental models transfer; the
  bridge effectively becomes "cabt_service's little sibling with an
  observation stream", by design rather than accident.
- **Revisit only if** the harness becomes public/pip-installable *and* grows
  an observation-streaming mode; then the bridge could shrink to a launcher.

## Test coverage of the play path

Baseline: 225 tests green, tsc clean. Distribution is inverted relative to
risk:

- **Strong**: replay pipeline (`cabtReplay.test.ts`, plus animation tests —
  ~3.8k lines), pure input models (`promptSelectionModel`,
  `setupSelectionModel` — much of which guards live-dead code, see F1),
  `logDedupe`, `workspaceAgents`, deck import, episodes parsing.
- **Thin where it hurts**: `localEngine.test.ts` tests private internals via
  `as any` with hand-built option shapes (`localEngine.test.ts:96-174`) and
  mocked bridges — it *encodes* the matchers' assumptions about engine
  payloads rather than verifying them. Nothing anywhere runs
  `cabt_bridge.py`; nothing plays a game through the real engine; nothing
  covers `withKnownHands`, `server.ts`, or the App.svelte flow (zero
  component tests). Every live-play regression this week was found by
  playing.
- **Cheapest high-value addition**: one env-gated integration test
  (`CABT_SAMPLE_SUBMISSION_DIR` present → spawn the real bridge, play an
  agent-vs-agent game — the probe for this audit did so in ~2s) asserting
  the invariants this audit leaned on: seat-stable `players[]`, hand
  visibility ≡ `yourIndex`, monotonic decision flow, result mapping, and —
  once F4 lands — no duplicate canonical events. Second: a golden-file test
  replaying a recorded bridge session through `LocalEngineController` and
  snapshotting `view`/`sequence`, so controller changes diff visibly.

## Probe appendix

Probes ran headless against the real engine (Abomasnow mirror,
first-legal agents, both seats auto): 41-step and 31-step games.
Key numbers cited above: `yourIndex` flips 9 (4 mid-turn: contexts
`SETUP_ACTIVE_POKEMON`, `DRAW_COUNT`, `TO_ACTIVE`×2); hand-visible seat ==
`yourIndex` at 100% of steps; `players[]` seat-stable at 100%; 249 log
lines delivered with 125 exact re-deliveries; `Draw`:36 vs `DrawReverse`:35;
6 identical same-observation prize-set lines (`type:7, 1→6`).
