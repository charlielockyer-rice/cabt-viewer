import fs from 'node:fs';
import { quickPlayMatchup } from './quickPlay';
import { workspaceAgentDeckFile } from './workspaceAgents';
import { workspaceDeckCsvFile } from './workspaceDecks';

const LOCKED_PATHS = new Set([
  '/local-engine/agents',
  '/local-engine/decks',
  '/local-engine/save-replay',
]);

export function publicModeEnabled(value = process.env.CABT_PUBLIC): boolean {
  return value === '1';
}

export function publicModeBlocks(pathname: string): boolean {
  return LOCKED_PATHS.has(pathname)
    || pathname.startsWith('/local-engine/agent-decks/')
    || pathname.startsWith('/local-engine/deck-csv/');
}

export function publicQuickPlayPayload(clientPayload: any): { ok: true; payload: any } | { ok: false; error: string } {
  const matchup = quickPlayMatchup();
  if (!matchup.ok) return matchup;

  const playerDeckFile = workspaceDeckCsvFile(matchup.playerDeck.id);
  const botDeckFile = matchup.botDeck.deckUrl.startsWith('/local-engine/agent-decks/')
    ? workspaceAgentDeckFile(matchup.agent.id)
    : workspaceDeckCsvFile(matchup.botDeck.id);
  if (!playerDeckFile || !fs.existsSync(playerDeckFile)) {
    return { ok: false, error: `Quick play player deck ${matchup.playerDeck.id} is unavailable.` };
  }
  if (!botDeckFile || !fs.existsSync(botDeckFile)) {
    return { ok: false, error: `Quick play bot deck ${matchup.botDeck.id} is unavailable.` };
  }

  return {
    ok: true,
    payload: {
      sessionId: typeof clientPayload?.sessionId === 'string' ? clientPayload.sessionId : undefined,
      player1: {
        name: 'Player 1',
        deck: readDeck(playerDeckFile),
        control: 'self',
      },
      player2: {
        name: 'Player 2',
        deck: readDeck(botDeckFile),
        control: 'agent',
        agentId: matchup.agent.id,
      },
    },
  };
}

function readDeck(file: string): string[] {
  return fs.readFileSync(file, 'utf8').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}
