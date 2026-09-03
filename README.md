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
?view=replay&replay=<path>          # a file in public/game-logs
?view=replay&replayUrl=<url>        # any URL or same-origin path
&state=<frame>  &step=<step>        # open at an exact position
?view=clip&clip=<path>              # a cabt-clip-v1 guided tour
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

Finished games can be saved to `public/game-logs`, where they appear under
**Watch → Local logs**.

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
