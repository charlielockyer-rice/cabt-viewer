# Task: the select-only interaction contract + deletion sweep

Status: **DONE** (2026-07-07). Step 3 landed as `7b272c9` (the select
contract: GameView.decision + seats/turnSeat, one `select {seq, indexes}`
command, decisions.ts gesture mapping, captured gallery fixtures, demo
mini-engine deleted). Step 5 landed as `37834f6` (the deletion sweep —
`git show 37834f6` lists everything removed; GameView.prompts and
PromptView went with it since nothing read them). Verified per the
discipline below: 178 unit + 6 real-engine integration tests (including a
full game driven purely through select indexes), tsc + vite build clean,
cabtReplay suite unchanged. See the audit's migration-order section for
the live status of all five steps.

## Context: what already landed (all on anim-backbone, pushed)

- `c015b17` play-pipeline audit (the design source for this task)
- `5b8d458` live step builder: `src/engine/liveSteps.ts` normalizer —
  positional per-seat-stream dedupe (line position IS identity), seat-stable
  views, hidden-info downgrade of concealed seats' draws; deleted
  withKnownHands / revealPromptForLogs / isAgentDecisionView / logDedupe /
  gate live mode
- `fb3813f` bridge hygiene: protocol stdout dup'd + fd1→stderr, request
  timeouts (CABT_BRIDGE_TIMEOUT_MS)
- `267b311` single projection: `cabtProjection.ts` owns observation→GameView
  for live AND replay; winner/draw + stadium drift fixed
- Earlier: sequential live playback (`anim/activity.ts`), anyDeck agents,
  workspace agents manifest, turn-boundary claim release

Baseline to preserve: 233 unit + 5 integration tests green
(`npx vitest run`; integration suite is env-gated — it spawns the real
bridge with CABT_SAMPLE_SUBMISSION_DIR pointing at
`../agent-lab/official/sample_submission` and plays full games in ~2.5s),
`tsc -p tsconfig.build.json --noEmit` clean. The 3,844-line cabtReplay
suite passing unchanged is the replay-regression oracle.

## Step 3: the engine's select becomes the only interaction contract

Goal: every UI affordance derives from the engine's actual option list;
one command carries indexes back. Legality = presence in the list, never a
client-side guess.

Design (from the audit's "from-scratch shape"):

1. `GameView` grows a `decision` field, projected 1:1 in `cabtProjection.ts`
   from EVERY engine select, main phase included:
   `{ seq, seat, kind, minCount, maxCount,
      options: [{ index, kind, card, source, target, label }] }`
   The option projection already ships in pieces (the prompt path carries
   option indexes end-to-end today; ActionTranslator-style labeling exists);
   this consolidates it as the single source.
2. One command: `select { seq, indexes }` in localEngine's handle(). The
   `seq` echo guards against acting on a stale decision.
3. Board affordances (hand plays, attacks, abilities, retreat, stadium,
   pass) become renderings of `decision.options` filtered by kind — the
   gesture layer maps a click to an option index instead of synthesizing a
   semantic command.
4. DELETE once nothing calls them: the eight semantic commands
   (`playCard`/`attack`/`useAbility`/`useStadium`/`retreat`/`passTurn`/...),
   the option predicate matchers (`matchesPlayCardOption` etc.), client
   legality guessing (`playTargets.ts` playableCardIds and friends),
   `pendingRetreatTarget` (cross-request smuggled state), and the
   DISCARD_ENERGY two-layer batching.

Port order that keeps every commit green: dialogs/prompts first (already
index-based, smallest delta), then board gestures, then delete the old
command path.

Known warts this must fix by construction (verify each): Cancel buttons on
prompts that can never succeed (null → [] → minCount violation), clicks
inviting moves the engine rejects (error-toast UX), retreat state leaking
across requests.

## Step 5: the deletion sweep

After step 3 the ptcg-server-era layer is unreachable from live play:
~1,900 lines — the 20-class prompt taxonomy (live CABT emits 4), SetupDock
/ CHOOSE_STARTING_POKEMONS flow, the three board strategies
(choosePokemon/damageTransfer/putDamage), attach-energy assignment
machinery, `targets.ts` protocols, the 931-line demo mini-engine
(CABT_ENGINE_MODE=demo) if nothing else holds it, dead /replays endpoints.

Charlie's explicit call: **delete outright, no archive directory** — git
history is the archive; record the deletion commit hash HERE and in the
audit doc so retrieval is one `git show` away. Keep the prompt gallery
alive but regenerate its fixtures from captured real engine selects (it
becomes documentation of what CABT actually emits).

## Discipline (unchanged from the whole effort)

- Separate green commits per step; push to origin anim-backbone as you go.
- Replay byte-identical (cabtReplay suite unchanged = evidence).
- Headless bridge probes for live invariants after UI rework: full
  human-simulated game via `select` indexes; no duplicate events; stable
  perspective; concealment holds.
- Update the audit doc's migration section as steps land.
- Commit messages end with:
  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
- Expect a human QA cycle after step 3 (Charlie plays, reports feel);
  don't declare done on tests alone.

## Why this is worth it (for whoever picks this up)

This is the root fix for the remaining live-play inconsistencies: the
translation sandwich (client guesses legality → semantic command → server
reverse-matches onto options) is where "click looks legal but bounces"
lives. After this, humans, agents, and replays all speak the engine's one
language, and the viewer gets ~2k lines smaller.
