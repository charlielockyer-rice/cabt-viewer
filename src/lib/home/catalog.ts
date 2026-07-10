export type AgentOption = {
  id: string;
  name: string;
  description?: string;
  path?: string;
  // Rule-based agents may name a catalog deck to SOFT-select when chosen
  // (never a lock — the picker stays free). General agents have none.
  preferredDeck?: string;
};

// A selectable deck in the picker, decoupled from agents. Served by the engine
// server from CABT_DECKS_FILE (all Limitless archetypes + Kaggle decks).
export type DeckOption = {
  id: string;
  name: string;
  deckUrl: string;
};

export type GameLogEntry = {
  id: string;
  name: string;
  file: string;
  createdAt?: string;
  players?: string[];
  description?: string;
};

const FALLBACK_AGENT: AgentOption = {
  id: 'first-legal',
  name: 'First legal option',
  description: 'Uses the first legal CABT selection whenever the local engine controls the opponent.',
};

export async function loadAgentOptions(): Promise<AgentOption[]> {
  const [bundled, workspace] = await Promise.all([
    loadJsonList<AgentOption>('/agents/agents.json', 'agents'),
    // Optional extra agents served by the local engine server from
    // CABT_AGENTS_FILE; absent (or server down) is not an error.
    loadJsonList<AgentOption>('/local-engine/agents', 'agents').catch(() => [] as AgentOption[]),
  ]);
  const agents = [...bundled];
  for (const agent of workspace) {
    if (!agents.some((existing) => existing.id === agent.id)) {
      agents.push(agent);
    }
  }
  return agents.length ? agents : [FALLBACK_AGENT];
}

export async function loadGameLogs(): Promise<GameLogEntry[]> {
  return loadJsonList<GameLogEntry>('/game-logs/logs.json', 'logs');
}

// The deck catalog is engine-served only (CABT_DECKS_FILE); a down engine just
// means an empty picker (the engine is required to play anyway).
export async function loadDeckOptions(): Promise<DeckOption[]> {
  const decks = await loadJsonList<DeckOption>('/local-engine/decks', 'decks').catch(() => [] as DeckOption[]);
  return decks.filter((deck) => typeof deck.deckUrl === 'string' && typeof deck.name === 'string');
}

async function loadJsonList<T extends { id?: unknown }>(url: string, key: string): Promise<T[]> {
  const response = await fetch(url);
  if (!response.ok) {
    if (response.status === 404) {
      return [];
    }
    throw new Error(`${url}: ${response.status}`);
  }

  const json = await response.json();
  const list = Array.isArray(json) ? json : json?.[key];
  if (!Array.isArray(list)) {
    throw new Error(`${url}: expected an array or { "${key}": [...] }`);
  }
  return list.filter((item): item is T => !!item && typeof item === 'object' && typeof item.id === 'string');
}
