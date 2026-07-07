import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { workspaceAgentDeckFile, workspaceAgentOptions, workspaceAgentPath } from './workspaceAgents';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cabt-agents-'));
const manifestFile = path.join(dir, 'agents.json');
fs.writeFileSync(
  manifestFile,
  JSON.stringify({
    agents: [
      { id: 'demo', name: 'Demo agent', description: 'test', path: 'demo/main.py', deck: 'decks/demo.csv', anyDeck: true },
      { id: 'no-deck', name: 'No deck' },
      { name: 'missing id, dropped' },
    ],
  }),
);

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('workspaceAgents', () => {
  it('returns [] without a manifest', () => {
    expect(workspaceAgentOptions(undefined)).toEqual([]);
    expect(workspaceAgentOptions(path.join(dir, 'nope.json'))).toEqual([]);
  });

  it('maps manifest entries to options with deck URLs', () => {
    const options = workspaceAgentOptions(manifestFile);
    expect(options).toHaveLength(2);
    expect(options[0]).toEqual({
      id: 'demo',
      name: 'Demo agent',
      description: 'test',
      deckUrl: '/local-engine/agent-decks/demo',
      anyDeck: true,
    });
    expect(options[1].deckUrl).toBeUndefined();
    expect(options[1].anyDeck).toBeUndefined();
  });

  it('resolves agent and deck paths relative to the manifest', () => {
    expect(workspaceAgentPath('demo', manifestFile)).toBe(path.join(dir, 'demo', 'main.py'));
    expect(workspaceAgentDeckFile('demo', manifestFile)).toBe(path.join(dir, 'decks', 'demo.csv'));
    expect(workspaceAgentPath('no-deck', manifestFile)).toBeUndefined();
    expect(workspaceAgentPath('missing', manifestFile)).toBeUndefined();
  });
});
