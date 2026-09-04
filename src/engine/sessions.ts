import type { EngineResponse } from '../lib/game/types';
import { LocalEngineController } from './localEngine';

type EngineCommand = {
  type: string;
  payload?: any;
};

type SaveReplayResponse = {
  ok: boolean;
  file?: string;
  id?: string;
  error?: string;
};

export type SessionController = {
  handle(command: EngineCommand): Promise<EngineResponse>;
  saveReplay(): SaveReplayResponse;
  close(): void;
};

export type SessionControllerFactory = () => SessionController;

type Session = {
  controller: SessionController;
  createdAt: number;
  lastActiveAt: number;
  finished: boolean;
};

type SessionManagerOptions = {
  maxSessions?: number;
  idleMs?: number;
  finishedMs?: number;
  reapIntervalMs?: number;
};

export type SessionResponse = EngineResponse & { full?: boolean };

const SESSION_EXPIRED = 'CABT session expired. Start a new game.';
const TABLE_FULL = 'The table is full — try again in a minute.';

export class SessionManager {
  private readonly sessions = new Map<string, Session>();
  private readonly startingControllers = new Set<SessionController>();
  private readonly maxSessions: number;
  private readonly idleMs: number;
  private readonly finishedMs: number;
  private readonly reaper: ReturnType<typeof setInterval>;
  private starting = 0;
  private closed = false;

  constructor(
    private readonly createController: SessionControllerFactory = () => new LocalEngineController(),
    options: SessionManagerOptions = {},
  ) {
    this.maxSessions = positiveNumber(options.maxSessions, process.env.CABT_MAX_SESSIONS, 6);
    this.idleMs = positiveNumber(options.idleMs, process.env.CABT_SESSION_IDLE_MS, 10 * 60_000);
    this.finishedMs = positiveNumber(options.finishedMs, process.env.CABT_SESSION_FINISHED_MS, 2 * 60_000);
    const reapIntervalMs = positiveNumber(options.reapIntervalMs, undefined, 30_000);
    this.reaper = setInterval(() => this.reap(), reapIntervalMs);
    this.reaper.unref?.();
  }

  async startGame(payload: any): Promise<SessionResponse> {
    const previousSessionId = payload?.sessionId;
    if (typeof previousSessionId === 'string') {
      this.closeSession(previousSessionId);
    }

    if (this.closed) {
      return { ok: false, error: 'CABT session manager is closed.' };
    }
    if (this.sessions.size + this.starting >= this.maxSessions) {
      return { ok: false, error: TABLE_FULL, full: true };
    }

    this.starting += 1;
    let controller: SessionController | undefined;
    try {
      controller = this.createController();
      this.startingControllers.add(controller);
      const response = await controller.handle({ type: 'startGame', payload });
      if (!response.ok) {
        controller.close();
        return response;
      }
      if (!response.sessionId) {
        controller.close();
        return { ok: false, error: 'CABT engine did not create a session.' };
      }
      if (this.closed) {
        controller.close();
        return { ok: false, error: 'CABT session manager is closed.' };
      }
      if (this.sessions.has(response.sessionId)) {
        controller.close();
        return { ok: false, error: 'CABT engine created a duplicate session id.' };
      }

      const now = Date.now();
      this.sessions.set(response.sessionId, {
        controller,
        createdAt: now,
        lastActiveAt: now,
        finished: response.view.phase === 7,
      });
      return response;
    } catch (error) {
      controller?.close();
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    } finally {
      if (controller) {
        this.startingControllers.delete(controller);
      }
      this.starting -= 1;
    }
  }

  async handle(command: EngineCommand): Promise<SessionResponse> {
    const session = this.findSession(command.payload?.sessionId);
    if (!session) {
      return { ok: false, error: SESSION_EXPIRED };
    }

    session.lastActiveAt = Date.now();
    const response = await session.controller.handle(command);
    session.lastActiveAt = Date.now();
    if (response.view?.phase === 7) {
      session.finished = true;
    }
    return response;
  }

  saveReplay(sessionId: unknown): SaveReplayResponse {
    const session = this.findSession(sessionId);
    if (!session) {
      return { ok: false, error: SESSION_EXPIRED };
    }
    session.lastActiveAt = Date.now();
    return session.controller.saveReplay();
  }

  stats(): { active: number; max: number; finished: number } {
    let finished = 0;
    for (const session of this.sessions.values()) {
      if (session.finished) finished += 1;
    }
    return { active: this.sessions.size, max: this.maxSessions, finished };
  }

  closeAll(): void {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.reaper);
    for (const sessionId of [...this.sessions.keys()]) {
      this.closeSession(sessionId);
    }
    for (const controller of this.startingControllers) {
      controller.close();
    }
    this.startingControllers.clear();
  }

  private findSession(sessionId: unknown): Session | undefined {
    return typeof sessionId === 'string' && sessionId ? this.sessions.get(sessionId) : undefined;
  }

  private reap(): void {
    const now = Date.now();
    for (const [sessionId, session] of this.sessions) {
      const timeout = session.finished ? this.finishedMs : this.idleMs;
      if (now - session.lastActiveAt > timeout) {
        this.closeSession(sessionId);
      }
    }
  }

  private closeSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    this.sessions.delete(sessionId);
    session.controller.close();
  }
}

function positiveNumber(value: number | undefined, environmentValue: string | undefined, fallback: number): number {
  const candidate = value ?? Number(environmentValue);
  return Number.isFinite(candidate) && candidate > 0 ? Math.floor(candidate) : fallback;
}
