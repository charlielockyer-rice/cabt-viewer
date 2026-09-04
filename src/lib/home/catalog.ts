export type AgentOption = {
  id: string;
  name: string;
  description?: string;
  path?: string;
};

// A selectable deck in the picker, decoupled from agents. Served by the engine
// server from CABT_DECKS_FILE.
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

// The hosted quick-play matchup: one preconfigured bot and one deck per side,
// re-rolled by the engine server on every call (CABT_QUICKPLAY_FILE).
export type QuickPlayConfig = {
  agent: AgentOption;
  playerDeck: DeckOption;
  botDeck: DeckOption;
  public?: boolean;
};

export async function loadQuickPlayConfig(): Promise<QuickPlayConfig> {
  const response = await fetch('/local-engine/quickplay');
  const json = await response.json().catch(() => null);
  if (!response.ok || !json?.ok) {
    throw new Error(json?.error || `/local-engine/quickplay: ${response.status}`);
  }
  if (!json.agent?.id || !json.playerDeck?.deckUrl || !json.botDeck?.deckUrl) {
    throw new Error('/local-engine/quickplay: expected { agent, playerDeck, botDeck }');
  }
  return {
    agent: json.agent,
    playerDeck: json.playerDeck,
    botDeck: json.botDeck,
    ...(response.headers?.get('X-CABT-Public') === '1' ? { public: true } : {}),
  };
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
