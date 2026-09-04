import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { publicModeBlocks, publicModeEnabled, publicQuickPlayPayload } from './publicMode';

let tempDir = '';

afterEach(() => {
  delete process.env.CABT_AGENTS_FILE;
  delete process.env.CABT_DECKS_FILE;
  delete process.env.CABT_QUICKPLAY_FILE;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  tempDir = '';
});

describe('public engine policy', () => {
  it('only enables public mode for CABT_PUBLIC=1', () => {
    expect(publicModeEnabled('1')).toBe(true);
    expect(publicModeEnabled('0')).toBe(false);
    expect(publicModeEnabled(undefined)).toBe(false);
  });

  it.each([
    '/local-engine/agents',
    '/local-engine/agent-decks/demo',
    '/local-engine/decks',
    '/local-engine/deck-csv/demo',
    '/local-engine/save-replay',
  ])('blocks %s', (pathname) => {
    expect(publicModeBlocks(pathname)).toBe(true);
  });

  it.each([
    '/local-engine/health',
    '/local-engine/quickplay',
    '/local-engine',
    '/local-engine/deck-csvish/demo',
  ])('allows %s', (pathname) => {
    expect(publicModeBlocks(pathname)).toBe(false);
  });

  it('builds starts only from the configured quick-play matchup', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cabt-public-'));
    fs.writeFileSync(path.join(tempDir, 'agents.json'), JSON.stringify({
      agents: [{ id: 'safe-bot', name: 'Safe bot', path: 'bot.py', anyDeck: true }],
    }));
    fs.writeFileSync(path.join(tempDir, 'decks.json'), JSON.stringify({
      decks: [
        { id: 'player', name: 'Player deck', csv: 'player.csv' },
        { id: 'bot', name: 'Bot deck', csv: 'bot.csv' },
      ],
    }));
    fs.writeFileSync(path.join(tempDir, 'quickplay.json'), JSON.stringify({
      agentId: 'safe-bot',
      playerDecks: ['player'],
      botDecks: ['bot'],
    }));
    fs.writeFileSync(path.join(tempDir, 'player.csv'), `${Array(60).fill('11').join('\n')}\n`);
    fs.writeFileSync(path.join(tempDir, 'bot.csv'), `${Array(60).fill('22').join('\n')}\n`);
    process.env.CABT_AGENTS_FILE = path.join(tempDir, 'agents.json');
    process.env.CABT_DECKS_FILE = path.join(tempDir, 'decks.json');
    process.env.CABT_QUICKPLAY_FILE = path.join(tempDir, 'quickplay.json');

    const result = publicQuickPlayPayload({
      sessionId: 'old-session',
      player1: { deck: ['attacker card'], control: 'agent', agentId: 'attacker' },
      player2: { deck: ['attacker card'], control: 'self' },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload).toEqual({
      sessionId: 'old-session',
      player1: { name: 'Player 1', deck: Array(60).fill('11'), control: 'self' },
      player2: {
        name: 'Player 2',
        deck: Array(60).fill('22'),
        control: 'agent',
        agentId: 'safe-bot',
      },
    });
  });
});
