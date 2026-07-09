# CABT Viewer

Svelte 5 viewer for CABT, the Card Battle environment used by the Kaggle
Pokemon TCG AI Battle Challenge.

This repo contains the viewer, replay support, generated card metadata, and a
thin optional local engine bridge. It also includes public sample agents adapted
from Kaggle-provided examples. It does not include Kaggle's native CABT engine
files or raw card CSV.

![CABT Viewer replay preview](public/preview.png)

## Requirements

- Node.js `>=20.19.0 <25`
- npm
- Optional for local CABT play on macOS: a native `cg/libcg.dylib` in your
  `sample_submission`, or Docker as a fallback
- Optional for local CABT play: Kaggle's provided `sample_submission`
  directory from the competition data bundle

The provided CABT engine ships native Linux x86-64 and Windows x64 libraries.
On macOS, the bridge uses a native `cg/libcg.dylib` when your
`sample_submission` includes one, and otherwise runs the Linux library through
Docker.

## Quick Start

```bash
npm ci
npm run dev:web
```

Open `http://localhost:5173/?view=replay`.

The app loads generated sample replay fixtures from `public/game-logs`. You can
also pass a replay URL:

```text
http://localhost:5173/?view=replay&replayUrl=https://example.com/cabt-replay.json
```

Replay viewing does not require Python, Docker, Kaggle native libraries, or a
local agent.

## Optional User-Supplied Card Images

The viewer is usable without Pokemon card images. Card faces, energy symbols,
and card backs use generated text/CSS fallbacks unless you explicitly configure
your own image source in a local `.env` file.

The recommended setup is one visual asset manifest:

```bash
VITE_CABT_VISUAL_ASSET_MANIFEST=/local-card-images/manifest.json
```

Manifest example:

```json
{
  "cards": {
    "template": "/local-card-images/cards/{set}/{number}.png",
    "images": {
      "MEG-35": "/local-card-images/cards/MEG/35.png"
    }
  },
  "energy": {
    "grass": "/local-card-images/energy/grass.webp",
    "fire": "/local-card-images/energy/fire.webp",
    "water": "/local-card-images/energy/water.webp"
  }
}
```

The committed example lives at
`docs/visual-asset-manifest.example.json`. Files under
`public/local-card-images/` are ignored by git, so they can be used for local
image packs without committing those assets.

Manifest image values may be same-origin paths like `/local-card-images/...` or
absolute HTTPS URLs for images you host elsewhere. The app does not proxy or
bundle those files; the browser loads the configured URLs directly. Add
`cardBack` when you want a card-back image, and add `energy` entries when you
want image-backed energy symbols from your own files.

For a local mirror or your own hosted files, use a template instead:

```bash
VITE_CABT_CARD_IMAGE_TEMPLATE=/local-card-images/{set}/{number}.png
VITE_CABT_CARD_BACK_IMAGE_URL=/local-card-images/cardback.png
VITE_CABT_ENERGY_IMAGE_TEMPLATE=/local-card-images/energy/{slug}.webp
```

Template tokens are `{set}`, `{setId}`, `{number}`, `{numberPadded}`, `{name}`,
and `{fullName}` for card faces. Energy-image templates support `{type}`,
`{name}`, and `{slug}`. Use `{setId}` when your hosted image layout expects the
app's mapped external set id instead of the raw CABT set code.

Templates can also point at your own hosted images:

```bash
VITE_CABT_CARD_IMAGE_TEMPLATE=https://assets.example.com/cabt/cards/{set}/{number}.png
VITE_CABT_CARD_BACK_IMAGE_URL=https://assets.example.com/cabt/cardback.png
VITE_CABT_ENERGY_IMAGE_TEMPLATE=https://assets.example.com/cabt/energy/{slug}.webp
```

For the Scrydex image CDN, use the `{setId}` token — `setImageMap` in
`src/lib/game/cardImages.ts` translates CABT set codes (MEG, ASC, SVE, ...)
into Scrydex set ids (me1, me2pt5, sve, ...). The final path segment picks the
size: `small`, `medium`, or `large`.

```bash
VITE_CABT_CARD_IMAGE_TEMPLATE=https://images.scrydex.com/pokemon/{setId}-{number}/large
```

## Run Local CABT Play

Local play requires the Kaggle-provided sample submission files:

```text
sample_submission/
  main.py
  deck.csv
  cg/
    api.py
    game.py
    sim.py
    utils.py
    libcg.so
    cg.dll
```

Point the bridge at that directory:

```bash
export CABT_SAMPLE_SUBMISSION_DIR=/absolute/path/to/sample_submission
npm run dev
```

Then open `http://localhost:5173`.

The opponent selector includes:

- `First legal option`: generic fallback policy that uses the editable opponent
  deck text box.
- `Official random sample (Mega Abomasnow)`: Kaggle sample-submission policy
  with its Mega Abomasnow ex deck.
- `Rule-based Mega Lucario ex`: Kaggle notebook sample with its deck.
- `Rule-based Dragapult ex`: Kaggle notebook sample with its deck.

Deck-backed sample agents load their bundled `deck.csv` into the opponent deck
box and make it read-only so the agent and deck stay paired.

On Linux, the bridge uses your local Python. On macOS, it uses your local
Python too when `CABT_SAMPLE_SUBMISSION_DIR` contains a native `cg/libcg.dylib`;
otherwise it starts Docker with `--platform linux/amd64` and mounts
`CABT_SAMPLE_SUBMISSION_DIR` read-only into the container. Set
`CABT_ENGINE_MODE=native` to force the local-Python path (and `PYTHON` to choose
the interpreter — useful when agents need extra packages such as torch), or
`CABT_ENGINE_MODE=docker` to force the Docker path even when a `libcg.dylib` is
present.

### Workspace agents

Besides the bundled agents in `public/agents/agents.json`, the local engine
server can offer agents defined outside this repo. Point `CABT_AGENTS_FILE` at
a JSON manifest:

```json
{
  "agents": [
    {
      "id": "my-agent",
      "name": "My agent",
      "description": "Shown in the picker.",
      "path": "my_agent.py",
      "deck": "decks/my-deck.csv"
    }
  ]
}
```

`path` (the python file exporting `agent(obs) -> list[int]`) and `deck` (one
card id per line) are resolved relative to the manifest file. The server
merges these into the agent picker and serves each paired deck at
`/local-engine/agent-decks/<id>`. Missing manifest or missing env var simply
means no extra agents.

Set `"anyDeck": true` for deck-general agents: the paired deck becomes a
default instead of a lock, so the deck picker stays editable for that seat.
Before battle start the bridge calls the agent module's optional
`set_deck(deck, seat)` hook with the seat's actual 60-card list, letting
deck-conditioned models adapt to whatever they're given.

If you only want to inspect the UI without CABT native engine resources, use
the replay viewer, or the prompt gallery (`/?view=prompt-gallery`) for the
decision dialogs.

Dev servers bind to `127.0.0.1` by default. To test from another device on your
LAN, run `npm run dev:lan`.

## Regenerate CABT Metadata

Generated metadata is committed in `src/lib/cabt` so a fresh clone can show
card names, set numbers, images, HP, retreat costs, abilities, and attacks in
replay mode without starting the native CABT engine.

Most users do not need to regenerate it. Maintainers can refresh it from the
Kaggle-provided card CSV and sample submission.

By default, the generator expects these local, ignored paths inside this repo:

```text
data/EN_Card_Data.csv
sample_submission/
```

Use Docker on macOS:

```bash
npm run generate:cabt-data:docker
```

On Linux, or any machine that can load the provided native CABT library
directly, you can run:

```bash
npm run generate:cabt-data
```

You can override those paths:

```bash
npm run generate:cabt-data -- \
  --card-csv /absolute/path/to/EN_Card_Data.csv \
  --sample-submission /absolute/path/to/sample_submission
```

The Docker helper mounts this repo at `/workspace`. For arbitrary external
paths, either run the native command on Linux or adapt the Docker mount paths.

## Data Contract

The viewer speaks a normalized `GameView` shape internally, but the CABT adapter
understands:

- Kaggle environment replay contexts where `environment.steps[0][0]` contains
  CABT `visualize` frames.
- Lower-level local runner JSON with a top-level `visualize` array.
- Live CABT observations from `cg.game.battle_start` / `battle_select`.

The local engine bridge follows the official agent interaction shape:

- before battle start, each agent supplies a 60-card deck;
- during battle, actions are arrays of option indexes;
- each index refers to an item in the current `obs.select.option` list.

## Useful Scripts

```bash
npm run dev       # local engine server + Vite dev server
npm run dev:lan   # same as dev, but binds to 0.0.0.0 for LAN testing
npm run dev:web   # Vite dev server only
npm run dev:web:lan
npm run audit:animations -- --source kaggle --days 2 --episodes-per-day 6
npm run generate:cabt-data:docker
npm test          # Vitest suite
npm run build     # TypeScript + production build
```

## Notes

- Full card art and card backs are opt-in through local `.env` image source
  settings. Without those settings, the viewer renders text/CSS fallbacks.
- `dist/`, `node_modules/`, and local `.env` files are ignored and should not be
  committed.

## License

MIT.
