import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EngineResponse, GameView } from '../lib/game/types';
import { SessionManager, type SessionController } from './sessions';

class FakeController implements SessionController {
  readonly commands: Array<{ type: string; payload?: any }> = [];
  closed = false;

  constructor(readonly sessionId: string) {}

  async handle(command: { type: string; payload?: any }): Promise<EngineResponse> {
    this.commands.push(command);
    return {
      ok: true,
      sessionId: this.sessionId,
      view: view(command.payload?.finished ? 7 : 1),
    };
  }

  saveReplay() {
    return { ok: true, id: this.sessionId, file: `${this.sessionId}.json` };
  }

  close(): void {
    this.closed = true;
  }
}

afterEach(() => {
  vi.useRealTimers();
});

describe('SessionManager', () => {
  it('routes concurrent sessions to their own controllers', async () => {
    const controllers: FakeController[] = [];
    const manager = createManager(controllers);

    const first = await manager.startGame({ player: 1 });
    const second = await manager.startGame({ player: 2 });
    expect(first.ok && first.sessionId).toBe('session-1');
    expect(second.ok && second.sessionId).toBe('session-2');

    await manager.handle({ type: 'select', payload: { sessionId: 'session-1', seq: 1, indexes: [0] } });
    await manager.handle({ type: 'select', payload: { sessionId: 'session-2', seq: 2, indexes: [1] } });

    expect(controllers[0].commands.at(-1)?.payload.seq).toBe(1);
    expect(controllers[1].commands.at(-1)?.payload.seq).toBe(2);
    manager.closeAll();
  });

  it('closes an existing session before starting play again', async () => {
    const controllers: FakeController[] = [];
    const manager = createManager(controllers);
    await manager.startGame({});

    const restarted = await manager.startGame({ sessionId: 'session-1' });

    expect(controllers[0].closed).toBe(true);
    expect(restarted.ok && restarted.sessionId).toBe('session-2');
    expect(manager.stats().active).toBe(1);
    manager.closeAll();
  });

  it('returns the table-full response without creating a controller', async () => {
    const controllers: FakeController[] = [];
    const manager = createManager(controllers, { maxSessions: 1 });
    await manager.startGame({});

    const response = await manager.startGame({});

    expect(response).toEqual({
      ok: false,
      error: 'The table is full — try again in a minute.',
      full: true,
    });
    expect(controllers).toHaveLength(1);
    manager.closeAll();
  });

  it('reaps idle and finished sessions on their respective timeouts', async () => {
    vi.useFakeTimers();
    const controllers: FakeController[] = [];
    const manager = createManager(controllers, { idleMs: 60_000, finishedMs: 5_000, reapIntervalMs: 1_000 });
    await manager.startGame({});
    await manager.startGame({});
    await manager.handle({ type: 'state', payload: { sessionId: 'session-2', finished: true } });

    await vi.advanceTimersByTimeAsync(6_000);
    expect(controllers[0].closed).toBe(false);
    expect(controllers[1].closed).toBe(true);

    await vi.advanceTimersByTimeAsync(55_000);
    expect(controllers[0].closed).toBe(true);
    expect(manager.stats()).toEqual({ active: 0, max: 6, finished: 0 });
    manager.closeAll();
  });

  it('returns a session error for an unknown id', async () => {
    const manager = createManager([]);

    const response = await manager.handle({ type: 'state', payload: { sessionId: 'missing' } });

    expect(response.ok).toBe(false);
    if (!response.ok) expect(response.error).toContain('session');
    manager.closeAll();
  });

  it('delegates replay saves to the matching session', async () => {
    const controllers: FakeController[] = [];
    const manager = createManager(controllers);
    await manager.startGame({});

    expect(manager.saveReplay('session-1')).toEqual({
      ok: true,
      id: 'session-1',
      file: 'session-1.json',
    });
    manager.closeAll();
  });

  it('closes every controller', async () => {
    const controllers: FakeController[] = [];
    const manager = createManager(controllers);
    await manager.startGame({});
    await manager.startGame({});

    manager.closeAll();

    expect(controllers.every((controller) => controller.closed)).toBe(true);
    expect(manager.stats().active).toBe(0);
  });
});

function createManager(controllers: FakeController[], options: ConstructorParameters<typeof SessionManager>[1] = {}) {
  return new SessionManager(() => {
    const controller = new FakeController(`session-${controllers.length + 1}`);
    controllers.push(controller);
    return controller;
  }, options);
}

function view(phase: number): GameView {
  return {
    ready: true,
    phase,
    phaseLabel: '',
    turn: 1,
    activePlayerIndex: 0,
    players: [],
    logs: [],
    events: [],
  };
}
