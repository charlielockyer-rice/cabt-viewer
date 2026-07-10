import fs from 'node:fs';
import path from 'node:path';

// Deck catalog served to the viewer's deck picker, decoupled from agents. The
// manifest (CABT_DECKS_FILE, default agent-lab/viewer/decks.json) lists every
// selectable deck — all Limitless archetypes (top-finisher lists) plus the
// Kaggle-provided decks — each pointing at a CSV of card ids. Mirrors
// workspaceAgents.ts; regenerate the manifest with decklists.viewer_decks.

export type WorkspaceDeck = {
  id: string;
  name: string;
  csv: string;
};

export type WorkspaceDeckOption = {
  id: string;
  name: string;
  deckUrl: string;
};

type LoadedDeckManifest = {
  decks: WorkspaceDeck[];
  dir: string;
};

export function loadDeckManifest(file = process.env.CABT_DECKS_FILE): LoadedDeckManifest | null {
  if (!file) {
    return null;
  }
  const resolved = path.resolve(file);
  if (!fs.existsSync(resolved)) {
    return null;
  }
  const json = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  const list = Array.isArray(json) ? json : json?.decks;
  if (!Array.isArray(list)) {
    return null;
  }
  const decks = list.filter(
    (deck): deck is WorkspaceDeck =>
      !!deck && typeof deck === 'object'
      && typeof deck.id === 'string' && typeof deck.name === 'string' && typeof deck.csv === 'string',
  );
  return { decks, dir: path.dirname(resolved) };
}

export function workspaceDeckOptions(file = process.env.CABT_DECKS_FILE): WorkspaceDeckOption[] {
  const manifest = loadDeckManifest(file);
  if (!manifest) {
    return [];
  }
  return manifest.decks.map((deck) => ({
    id: deck.id,
    name: deck.name,
    deckUrl: `/local-engine/deck-csv/${encodeURIComponent(deck.id)}`,
  }));
}

export function workspaceDeckCsvFile(deckId: string, file = process.env.CABT_DECKS_FILE): string | undefined {
  const manifest = loadDeckManifest(file);
  const deck = manifest?.decks.find((entry) => entry.id === deckId);
  if (!manifest || !deck) {
    return undefined;
  }
  return path.resolve(manifest.dir, deck.csv);
}
