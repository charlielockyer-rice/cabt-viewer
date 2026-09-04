# CABT Viewer

Svelte 5 viewer for CABT, the Pokemon TCG Card Battle environment. It does two
things:

- **Watch** a recorded game — from a replay URL, a local path, or a saved local
  match — with the full animation pipeline, the replay timeline, clips, and the
  search inspector for annotated games.
- **Play** a game yourself against a local agent, through a thin bridge to the
  CABT engine.

The repo holds the viewer, replay support and generated card metadata. It does
not hold the native CABT engine or the raw card CSV.

![CABT Viewer replay preview](public/preview.png)

## Quick Start

```bash
npm ci
npm run dev:web
```

Open `http://localhost:5173/?view=replay` for the bundled sample, or point it at
any replay:

```text
http://localhost:5173/?view=replay&replayUrl=https://example.com/game.json
http://localhost:5173/?view=replay&replayUrl=/cabt-artifacts/viewer-inbox/game.json
```

Watching needs nothing but Node — no python, no engine, no agent.

## URL Contract

Agents generate these links; they are stable.

```text
?view=replay&replay=<path>          # under public/game-logs, else /cabt-artifacts
?view=replay&replayUrl=<url>        # any URL or same-origin path
&state=<frame>  &step=<step>        # open at an exact position
?view=clip&clip=<path>              # a cabt-clip-v1 guided tour
?view=play                          # quick play against the preconfigured bot
?view=prompt-gallery                # the decision-dialog gallery
```

The viewer keeps `state`/`step` in the URL while you scrub, and **Copy position
link** copies a link that reopens the same position. `/cabt-artifacts` and
`/local-engine` are proxied by the dev server (see `vite.config.ts`).

## Local Play

Local play needs a CABT engine directory containing `cg/` (`api.py`, `game.py`,
`sim.py`, `utils.py`, `libcg.dylib` or `libcg.so`):

```bash
export CABT_ENGINE_DIR=/absolute/path/to/cabt-engine
export PYTHON=python3          # optional; the interpreter the bridge runs
npm run dev
```

Then open `http://localhost:5173`. The bridge always runs `$PYTHON` locally
against `src/engine/cabt_bridge.py`. Dev servers bind to `127.0.0.1`; use
`npm run dev:lan` to reach them from another device.

The agent picker offers the bundled `First legal option` plus any agents listed
in `CABT_AGENTS_FILE`; the deck picker lists whatever `CABT_DECKS_FILE` names.
An agent entry is `{ id, name, description?, path?, deck?, anyDeck? }`, where
`path` (a python file exporting `agent(obs) -> list[int]`) and `deck` (one card
id per line) resolve relative to the manifest. `"anyDeck": true` makes the
paired deck a default rather than a lock; before battle start the bridge calls
the module's optional `set_deck(deck, seat)` hook with the seat's actual 60
cards. Missing manifests just mean no extra agents or decks.

When you play against an agent the engine server conceals the agent seat; the
browser only receives the human seat's encoding. CABT delivers every event to
both seats — to its owner card-first, to the opponent face-down — so the server
replaces each of the agent's log lines with the human's own delivery of the same
event, and strips the agent's hand, looks and prompt from the observation before
projecting it. Nothing is hand-written, so context-dependent reveals land right:
a mulliganed hand and an Ultra Ball search stay named, a Recon Directive look
does not. The same substitution runs the other way — a Judge the agent plays
redraws your hand mid-turn, and you see your real cards immediately instead of
card backs.

Finished games can be saved to `public/game-logs`, where they appear under
**Watch → Local logs**. Saved replays carry the concealed frames; the raw
per-seat frames stay in the file's `rawVisualize` for analysis. Quick play
(below) has no save button: a hosted build is served from a snapshot that
never sees the engine host's `public/game-logs`.

### Engine server and sessions

`src/engine/server.ts` (`npm run dev:engine`, `LOCAL_ENGINE_HOST`/`PORT`,
default `127.0.0.1:8095`) hosts many games at once. `src/engine/sessions.ts`
keeps one `LocalEngineController` — one Python bridge process, one engine
battle — per game, keyed by a 128-bit random session id that the client sends
with every command. The id is the only credential for a game.

| Env | Default | Effect |
|---|---|---|
| `CABT_MAX_SESSIONS` | `6` | concurrent games; beyond it `startGame` answers `503 {"error": "The table is full — try again in a minute.", "full": true}` |
| `CABT_SESSION_IDLE_MS` | `600000` | close a game that has had no request for this long |
| `CABT_SESSION_FINISHED_MS` | `120000` | close a finished game this long after its last request |
| `CABT_PUBLIC` | unset | `1` locks the server down for a public deployment (below) |

A `startGame` that carries a session id closes that game first (that is
"Play again"), SIGINT/SIGTERM close every bridge, and
`GET /local-engine/health` reports `{"sessions": {"active", "max", "finished"}}`.
Each bridge is a Python process holding the model, roughly 330 MiB for a 12M
policy, so the cap is a memory budget. The bridge is spawned per game either
way, so per-session bridges add no startup cost.

With `CABT_PUBLIC=1`, `/local-engine/agents`, `/decks`, `/deck-csv/*`,
`/agent-decks/*` and `/save-replay` answer 404, and every `startGame` ignores
the client's decks and agent: the server builds the game from the quick-play
matchup and reads the deck files itself. `GET /local-engine/quickplay` then
carries `X-CABT-Public: 1`, which tells the client not to fetch decks. The
picker-based Play tab does not work against a public server; only `?view=play`
does.

### Quick play

`?view=play` is the hosted one-button game: a friend lands on it, sees the
bot's name and both deck names, presses **Start game**, and gets **Play again**
at the end. Nothing is chosen. Build with `VITE_CABT_DEFAULT_VIEW=play` to make
a bare `/` open there too (the dev build leaves it unset).

The matchup comes from `CABT_QUICKPLAY_FILE`, read by the engine server on
every `GET /local-engine/quickplay`, so the decks re-roll each game:

```json
{
  "agentId": "v42-general-12m",
  "playerDecks": ["dragapult-0903"],
  "botDecks": ["dragapult-0903"],
  "maxCardId": 1271
}
```

`agentId` names an agent from `CABT_AGENTS_FILE`; the deck ids name decks from
`CABT_DECKS_FILE`. One deck is picked at random per side (a mirror is fine).
A deck-locked agent — one with a paired `deck` and no `"anyDeck": true` — plays
that deck instead, and `botDecks` is ignored. Optional `maxCardId` rejects any
deck containing a higher card id — the guard for models whose card vocabulary
stops before the engine's card pool. Anything unset, missing or misspelled
answers 404 with the reason, which the quick-play screen shows.

Deck-search prompts show the whole deck sorted (Pokemon by stage, then
Trainers, then Energy); the selectable cards come first in full color and the
rest are faded and inert. The sort is also the privacy boundary: the engine
sends the deck in its real order.

## Card Images

Without configuration, faces, energy symbols and card backs render as generated
text/CSS. To use your own images, set one of these in `.env` (see
`.env.example`, and `docs/visual-asset-manifest.example.json`):

```bash
# One manifest for faces, backs and energy symbols.
VITE_CABT_VISUAL_ASSET_MANIFEST=/local-card-images/manifest.json

# Or templates, local or hosted.
VITE_CABT_CARD_IMAGE_TEMPLATE=/local-card-images/{set}/{number}.png
VITE_CABT_CARD_BACK_IMAGE_URL=/local-card-images/cardback.png
VITE_CABT_ENERGY_IMAGE_TEMPLATE=/local-card-images/energy/{slug}.webp
```

Face tokens: `{set}`, `{setId}`, `{number}`, `{numberPadded}`, `{name}`,
`{fullName}`. Energy tokens: `{type}`, `{name}`, `{slug}`. `{setId}` maps CABT
set codes to external CDN set ids via `setImageMap` in
`src/lib/game/cardImages.ts`, e.g.
`https://images.scrydex.com/pokemon/{setId}-{number}/large`. Files under
`public/local-card-images/` are git-ignored.

## Replay Formats

The adapter reads top-level episode envelopes (`environment.steps[0][0]`
carrying CABT `visualize` frames), local runner JSON with a top-level
`visualize` array, and live observations from `cg.game.battle_start` /
`battle_select`. Harness replays that declare a raw `source.format` (the raw
episode envelope, `cabt-match-result`, `cabt-service-game-jsonl`) keep the
engine's overlapping per-seat log deliveries, which the adapter folds into one
canonical event stream; saved live games mark themselves
`cabt-live-observations`. An optional per-frame `analysis` object drives the
decision comparison panel and search inspector — replays without it render the
same, minus those panels.

## Scripts

```bash
npm run dev            # local engine server + Vite dev server
npm run dev:lan        # same, bound to 0.0.0.0 for LAN testing
npm run dev:web        # Vite dev server only
npm run dev:web:lan
npm run generate:cabt-data -- --card-csv <EN_Card_Data.csv> --engine-dir <dir>
npm test               # Vitest suite
npm run build          # TypeScript + production build
```

Generated card metadata is committed in `src/lib/cabt`, so a fresh clone renders
card names, images, HP, retreat costs, abilities and attacks without the engine.
Regenerating it is a maintainer task.

## License

MIT.
