import type { EngineResponse } from './types';

type Command = {
  type: string;
  payload?: unknown;
};

export type PlayerControl = 'self' | 'agent';

type StartOptions = {
  player1Control?: PlayerControl;
  player2Control?: PlayerControl;
  player1AgentId?: string;
  player2AgentId?: string;
};

export type SaveReplayResponse = {
  ok: boolean;
  file?: string;
  id?: string;
  error?: string;
};

let currentSessionId = '';

async function send(command: Command): Promise<EngineResponse> {
  const commandWithSession = command.type === 'startGame' || !currentSessionId
    ? command
    : {
        ...command,
        payload: {
          ...(command.payload && typeof command.payload === 'object' ? command.payload : {}),
          sessionId: currentSessionId,
        },
      };
  const response = await fetch('/local-engine', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(commandWithSession),
  });
  const body = await response.json() as EngineResponse;
  if (body.ok && body.sessionId) {
    currentSessionId = body.sessionId;
  } else if (!body.ok && body.error.includes('session')) {
    currentSessionId = '';
  }
  return body;
}

export const localGameApi = {
  start(
    player1Deck: string[],
    player2Deck: string[],
    options: StartOptions = {},
  ) {
    const player1Control = options.player1Control ?? 'self';
    const player2Control = options.player2Control ?? 'agent';
    return send({
      type: 'startGame',
      payload: {
        player1: {
          name: 'Player 1',
          deck: player1Deck,
          control: player1Control,
          agentId: options.player1AgentId,
        },
        player2: {
          name: 'Player 2',
          deck: player2Deck,
          control: player2Control,
          agentId: options.player2AgentId,
        },
      },
    });
  },

  // The one gameplay command: answer the current decision with option indexes.
  select(seq: number, indexes: number[]) {
    return send({ type: 'select', payload: { seq, indexes } });
  },

  async saveReplay(): Promise<SaveReplayResponse> {
    const response = await fetch('/local-engine/save-replay', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: '{}',
    });
    return await response.json() as SaveReplayResponse;
  },
};
