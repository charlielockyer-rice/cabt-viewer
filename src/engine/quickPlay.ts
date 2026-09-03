import fs from 'node:fs';
import path from 'node:path';
import { workspaceAgentOptions } from './workspaceAgents';
import { workspaceAgentDeckFile } from './workspaceAgents';
import { workspaceDeckCsvFile, workspaceDeckOptions, type WorkspaceDeckOption } from './workspaceDecks';

// The hosted "quick play" matchup: one preconfigured bot, one pool of player
// decks, one pool of bot decks. A friend lands on ?view=play and gets a game
// without choosing anything. The manifest (CABT_QUICKPLAY_FILE) names ids from
// the same catalogs the pickers use (CABT_AGENTS_FILE, CABT_DECKS_FILE), so it
// is validated at request time — it is edited by hand. A deck-locked agent
// (paired `deck`, no `anyDeck`) overrides `botDecks` with its own deck.

export type QuickPlayManifest = {
  agentId: string;
  playerDecks: string[];
  botDecks: string[];
  // Highest card id the bot's model can encode. A deck with a newer card
  // makes the model fall back to first-legal on every decision that sees it,
  // silently; refusing here turns that into a visible error.
  maxCardId?: number;
};

export type QuickPlayAgent = {
  id: string;
  name: string;
  description?: string;
};

export type QuickPlayMatchup = {
  ok: true;
  agent: QuickPlayAgent;
  playerDeck: WorkspaceDeckOption;
  botDeck: WorkspaceDeckOption;
};

export type QuickPlayFailure = {
  ok: false;
  error: string;
};

type Options = {
  file?: string;
  agentsFile?: string;
  decksFile?: string;
  /** Seam for tests; defaults to a uniform random pick. */
  pick?: <T>(items: T[]) => T;
};

function randomPick<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

export function quickPlayMatchup(options: Options = {}): QuickPlayMatchup | QuickPlayFailure {
  const {
    file = process.env.CABT_QUICKPLAY_FILE,
    agentsFile = process.env.CABT_AGENTS_FILE,
    decksFile = process.env.CABT_DECKS_FILE,
    pick = randomPick,
  } = options;

  if (!file) {
    return { ok: false, error: 'Quick play is not configured (CABT_QUICKPLAY_FILE is unset).' };
  }
  const resolved = path.resolve(file);
  if (!fs.existsSync(resolved)) {
    return { ok: false, error: `Quick play manifest not found: ${resolved}` };
  }

  let manifest: Partial<QuickPlayManifest>;
  try {
    manifest = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  } catch (error) {
    return { ok: false, error: `Quick play manifest is not valid JSON: ${error instanceof Error ? error.message : String(error)}` };
  }

  const agentId = typeof manifest?.agentId === 'string' ? manifest.agentId : '';
  if (!agentId) {
    return { ok: false, error: 'Quick play manifest needs an "agentId".' };
  }
  const agent = workspaceAgentOptions(agentsFile).find((option) => option.id === agentId);
  if (!agent) {
    return { ok: false, error: `Quick play agent ${agentId} is not in the agent catalog.` };
  }

  // A deck-locked agent (paired `deck`, no `anyDeck`) always brings its own
  // deck; `botDecks` only applies to agents that can play anything.
  const lockedDeck: WorkspaceDeckOption | undefined = agent.deckUrl && !agent.anyDeck
    ? { id: agent.id, name: `${agent.name}'s deck`, deckUrl: agent.deckUrl }
    : undefined;

  const playerDeckIds = deckIdList(manifest?.playerDecks);
  const botDeckIds = lockedDeck ? [] : deckIdList(manifest?.botDecks);
  if (!playerDeckIds.length) {
    return { ok: false, error: 'Quick play manifest needs a non-empty "playerDecks" list.' };
  }
  if (!lockedDeck && !botDeckIds.length) {
    return { ok: false, error: 'Quick play manifest needs a non-empty "botDecks" list.' };
  }

  const decks = workspaceDeckOptions(decksFile);
  const unknown = [...playerDeckIds, ...botDeckIds].find((id) => !decks.some((deck) => deck.id === id));
  if (unknown) {
    return { ok: false, error: `Quick play deck ${unknown} is not in the deck catalog.` };
  }

  const deckById = (id: string) => decks.find((deck) => deck.id === id)!;
  const playerDeck = deckById(pick(playerDeckIds));
  const botDeck = lockedDeck ?? deckById(pick(botDeckIds));

  const maxCardId = typeof manifest?.maxCardId === 'number' ? manifest.maxCardId : undefined;
  if (maxCardId !== undefined) {
    for (const [role, deck, file] of [
      ['player', playerDeck, workspaceDeckCsvFile(playerDeck.id, decksFile)],
      ['bot', botDeck, lockedDeck ? workspaceAgentDeckFile(agent.id, agentsFile) : workspaceDeckCsvFile(botDeck.id, decksFile)],
    ] as const) {
      const outside = deckCardIdsOutside(file, maxCardId);
      if (outside.length) {
        return {
          ok: false,
          error: `Quick play ${role} deck ${deck.id} has card ids the bot's model cannot encode (max ${maxCardId}): ${outside.join(', ')}.`,
        };
      }
    }
  }

  return {
    ok: true,
    agent: { id: agent.id, name: agent.name, description: agent.description },
    playerDeck,
    botDeck,
  };
}

function deckCardIdsOutside(file: string | undefined, maxCardId: number): number[] {
  if (!file || !fs.existsSync(file)) {
    return [];
  }
  const ids = fs.readFileSync(file, 'utf8').split(/\r?\n/).map((line) => Number(line.trim())).filter((id) => Number.isFinite(id));
  return [...new Set(ids.filter((id) => id > maxCardId))].sort((a, b) => a - b);
}

function deckIdList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string' && !!id) : [];
}
