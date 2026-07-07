import fs from 'node:fs';
import path from 'node:path';

export type WorkspaceAgent = {
  id: string;
  name: string;
  description?: string;
  path?: string;
  deck?: string;
};

export type WorkspaceAgentOption = {
  id: string;
  name: string;
  description?: string;
  deckUrl?: string;
};

type LoadedManifest = {
  agents: WorkspaceAgent[];
  dir: string;
};

export function loadWorkspaceManifest(file = process.env.CABT_AGENTS_FILE): LoadedManifest | null {
  if (!file) {
    return null;
  }
  const resolved = path.resolve(file);
  if (!fs.existsSync(resolved)) {
    return null;
  }
  const json = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  const list = Array.isArray(json) ? json : json?.agents;
  if (!Array.isArray(list)) {
    return null;
  }
  const agents = list.filter(
    (agent): agent is WorkspaceAgent =>
      !!agent && typeof agent === 'object' && typeof agent.id === 'string' && typeof agent.name === 'string',
  );
  return { agents, dir: path.dirname(resolved) };
}

export function workspaceAgentOptions(file = process.env.CABT_AGENTS_FILE): WorkspaceAgentOption[] {
  const manifest = loadWorkspaceManifest(file);
  if (!manifest) {
    return [];
  }
  return manifest.agents.map((agent) => ({
    id: agent.id,
    name: agent.name,
    description: agent.description,
    deckUrl: agent.deck ? `/local-engine/agent-decks/${encodeURIComponent(agent.id)}` : undefined,
  }));
}

export function workspaceAgentPath(agentId: string, file = process.env.CABT_AGENTS_FILE): string | undefined {
  const manifest = loadWorkspaceManifest(file);
  const agent = manifest?.agents.find((entry) => entry.id === agentId);
  if (!manifest || !agent?.path) {
    return undefined;
  }
  return path.resolve(manifest.dir, agent.path);
}

export function workspaceAgentDeckFile(agentId: string, file = process.env.CABT_AGENTS_FILE): string | undefined {
  const manifest = loadWorkspaceManifest(file);
  const agent = manifest?.agents.find((entry) => entry.id === agentId);
  if (!manifest || !agent?.deck) {
    return undefined;
  }
  return path.resolve(manifest.dir, agent.deck);
}
