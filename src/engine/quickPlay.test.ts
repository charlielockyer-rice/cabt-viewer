import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { quickPlayMatchup } from './quickPlay';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cabt-quickplay-'));

const agentsFile = path.join(dir, 'agents.json');
fs.writeFileSync(
  agentsFile,
  JSON.stringify({
    agents: [
      { id: 'copycat-v1-20m', name: 'Copycat v1 (20M)', description: 'Imitation policy.', path: 'agents/copycat.py' },
      { id: 'locked-bot', name: 'Locked bot', path: 'agents/locked.py', deck: 'decks/locked.csv' },
      { id: 'flexible-bot', name: 'Flexible bot', path: 'agents/flex.py', deck: 'decks/flex.csv', anyDeck: true },
    ],
  }),
);

const decksFile = path.join(dir, 'decks.json');
fs.writeFileSync(
  decksFile,
  JSON.stringify({
    decks: [
      { id: 'dragapult-dusknoir', name: 'Dragapult Dusknoir', csv: 'decks/dragapult-dusknoir.csv' },
      { id: 'raging-bolt-ogerpon', name: 'Raging Bolt Ogerpon', csv: 'decks/raging-bolt-ogerpon.csv' },
    ],
  }),
);

fs.mkdirSync(path.join(dir, 'decks'), { recursive: true });
fs.writeFileSync(path.join(dir, 'decks/dragapult-dusknoir.csv'), '119\n120\n121\n');
fs.writeFileSync(path.join(dir, 'decks/raging-bolt-ogerpon.csv'), '119\n1381\n1500\n');
fs.writeFileSync(path.join(dir, 'decks/locked.csv'), '119\n');

function writeManifest(name: string, body: unknown): string {
  const file = path.join(dir, name);
  fs.writeFileSync(file, JSON.stringify(body));
  return file;
}

const manifestFile = writeManifest('quickplay.json', {
  agentId: 'copycat-v1-20m',
  playerDecks: ['dragapult-dusknoir', 'raging-bolt-ogerpon'],
  botDecks: ['raging-bolt-ogerpon'],
});

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('quickPlayMatchup', () => {
  it('resolves the agent and one deck per side', () => {
    const matchup = quickPlayMatchup({
      file: manifestFile,
      agentsFile,
      decksFile,
      pick: (items) => items[items.length - 1],
    });
    expect(matchup).toEqual({
      ok: true,
      agent: { id: 'copycat-v1-20m', name: 'Copycat v1 (20M)', description: 'Imitation policy.' },
      playerDeck: {
        id: 'raging-bolt-ogerpon',
        name: 'Raging Bolt Ogerpon',
        deckUrl: '/local-engine/deck-csv/raging-bolt-ogerpon',
      },
      botDeck: {
        id: 'raging-bolt-ogerpon',
        name: 'Raging Bolt Ogerpon',
        deckUrl: '/local-engine/deck-csv/raging-bolt-ogerpon',
      },
    });
  });

  it('picks each side independently from its own list', () => {
    const matchup = quickPlayMatchup({
      file: manifestFile,
      agentsFile,
      decksFile,
      pick: (items) => items[0],
    });
    expect(matchup.ok).toBe(true);
    expect(matchup.ok && matchup.playerDeck.id).toBe('dragapult-dusknoir');
    expect(matchup.ok && matchup.botDeck.id).toBe('raging-bolt-ogerpon');
  });

  it('fails when quick play is unconfigured or the manifest is missing', () => {
    expect(quickPlayMatchup({ file: undefined, agentsFile, decksFile })).toEqual({
      ok: false,
      error: 'Quick play is not configured (CABT_QUICKPLAY_FILE is unset).',
    });
    const missing = path.join(dir, 'nope.json');
    expect(quickPlayMatchup({ file: missing, agentsFile, decksFile })).toEqual({
      ok: false,
      error: `Quick play manifest not found: ${missing}`,
    });
  });

  it('fails on an unknown deck id even when the roll would not pick it', () => {
    const file = writeManifest('quickplay-bad-deck.json', {
      agentId: 'copycat-v1-20m',
      playerDecks: ['dragapult-dusknoir', 'gholdengo-typo'],
      botDecks: ['dragapult-dusknoir'],
    });
    expect(quickPlayMatchup({ file, agentsFile, decksFile, pick: (items) => items[0] })).toEqual({
      ok: false,
      error: 'Quick play deck gholdengo-typo is not in the deck catalog.',
    });
  });

  it('fails on an unknown agent id and on an empty deck list', () => {
    const badAgent = writeManifest('quickplay-bad-agent.json', {
      agentId: 'not-an-agent',
      playerDecks: ['dragapult-dusknoir'],
      botDecks: ['dragapult-dusknoir'],
    });
    expect(quickPlayMatchup({ file: badAgent, agentsFile, decksFile })).toEqual({
      ok: false,
      error: 'Quick play agent not-an-agent is not in the agent catalog.',
    });

    const noDecks = writeManifest('quickplay-no-decks.json', {
      agentId: 'copycat-v1-20m',
      playerDecks: [],
      botDecks: ['dragapult-dusknoir'],
    });
    expect(quickPlayMatchup({ file: noDecks, agentsFile, decksFile })).toEqual({
      ok: false,
      error: 'Quick play manifest needs a non-empty "playerDecks" list.',
    });
  });

  it('gives a deck-locked agent its paired deck and ignores botDecks', () => {
    const file = writeManifest('quickplay-locked.json', {
      agentId: 'locked-bot',
      playerDecks: ['dragapult-dusknoir'],
      botDecks: ['gholdengo-typo'],
    });
    const matchup = quickPlayMatchup({ file, agentsFile, decksFile, pick: (items) => items[0] });
    expect(matchup).toEqual({
      ok: true,
      agent: { id: 'locked-bot', name: 'Locked bot', description: undefined },
      playerDeck: {
        id: 'dragapult-dusknoir',
        name: 'Dragapult Dusknoir',
        deckUrl: '/local-engine/deck-csv/dragapult-dusknoir',
      },
      botDeck: {
        id: 'locked-bot',
        name: "Locked bot's deck",
        deckUrl: '/local-engine/agent-decks/locked-bot',
      },
    });

    // An `anyDeck` agent rolls from botDecks like any unpaired agent.
    const flexible = writeManifest('quickplay-flexible.json', {
      agentId: 'flexible-bot',
      playerDecks: ['dragapult-dusknoir'],
      botDecks: ['raging-bolt-ogerpon'],
    });
    const rolled = quickPlayMatchup({ file: flexible, agentsFile, decksFile, pick: (items) => items[0] });
    expect(rolled.ok && rolled.botDeck.id).toBe('raging-bolt-ogerpon');
  });

  it('refuses a deck with card ids past maxCardId, naming them', () => {
    const file = writeManifest('quickplay-vocab.json', {
      agentId: 'copycat-v1-20m',
      playerDecks: ['dragapult-dusknoir'],
      botDecks: ['raging-bolt-ogerpon'],
      maxCardId: 1271,
    });
    expect(quickPlayMatchup({ file, agentsFile, decksFile, pick: (items) => items[0] })).toEqual({
      ok: false,
      error: "Quick play bot deck raging-bolt-ogerpon has card ids the bot's model cannot encode (max 1271): 1381, 1500.",
    });

    // Within the vocabulary: unchanged result. Without maxCardId: no check.
    const fine = writeManifest('quickplay-vocab-ok.json', {
      agentId: 'copycat-v1-20m',
      playerDecks: ['dragapult-dusknoir'],
      botDecks: ['dragapult-dusknoir'],
      maxCardId: 1271,
    });
    expect(quickPlayMatchup({ file: fine, agentsFile, decksFile, pick: (items) => items[0] }).ok).toBe(true);
    const unchecked = writeManifest('quickplay-vocab-off.json', {
      agentId: 'copycat-v1-20m',
      playerDecks: ['dragapult-dusknoir'],
      botDecks: ['raging-bolt-ogerpon'],
    });
    expect(quickPlayMatchup({ file: unchecked, agentsFile, decksFile, pick: (items) => items[0] }).ok).toBe(true);
  });
});
