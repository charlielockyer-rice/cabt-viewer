import { describe, expect, it, vi } from 'vitest';
import { scheduleReplayAnimationGroupRemoval, scheduleReplayAnimationScopeClear } from './replayAnimationSpriteLifecycle';

describe('scheduleReplayAnimationScopeClear', () => {
  it('removes only the ids captured when the clear was scheduled', () => {
    vi.useFakeTimers();
    const timers: ReturnType<typeof setTimeout>[] = [];
    const removed: number[] = [];
    let items = [{ id: 1 }, { id: 2 }];

    scheduleReplayAnimationScopeClear({
      items,
      timers,
      delayMs: 40,
      removeIds(ids) {
        removed.push(...items.filter((item) => ids.has(item.id)).map((item) => item.id));
        items = items.filter((item) => !ids.has(item.id));
      },
    });
    items = [...items, { id: 3 }];

    vi.advanceTimersByTime(40);

    expect(removed).toEqual([1, 2]);
    expect(items).toEqual([{ id: 3 }]);
    expect(timers).toHaveLength(0);
    vi.useRealTimers();
  });

  it('does not schedule an empty clear', () => {
    vi.useFakeTimers();
    const timers: ReturnType<typeof setTimeout>[] = [];

    expect(scheduleReplayAnimationScopeClear({
      items: [],
      timers,
      delayMs: 40,
      removeIds() {
        throw new Error('empty clears should not run');
      },
    })).toBe(false);

    expect(timers).toHaveLength(0);
    vi.useRealTimers();
  });

  it('cancels existing local cleanup timers before scheduling the scope clear', () => {
    vi.useFakeTimers();
    const timers: ReturnType<typeof setTimeout>[] = [];
    let staleTimerRan = false;
    timers.push(setTimeout(() => {
      staleTimerRan = true;
    }, 10));

    scheduleReplayAnimationScopeClear({
      items: [{ id: 'old' }],
      timers,
      delayMs: 40,
      removeIds() {},
    });

    vi.advanceTimersByTime(10);
    expect(staleTimerRan).toBe(false);

    vi.advanceTimersByTime(30);
    expect(timers).toHaveLength(0);
    vi.useRealTimers();
  });
});

describe('scheduleReplayAnimationGroupRemoval', () => {
  it('removes the animation id when the planned motion group is ready for cleanup', () => {
    vi.useFakeTimers();
    const timers: ReturnType<typeof setTimeout>[] = [];
    const removed: number[] = [];

    expect(scheduleReplayAnimationGroupRemoval({
      item: { id: 4 },
      motions: [{
        startMs: 10,
        durationMs: 30,
        handoffPolicy: {
          hideSourceUntil: 'none',
          hideDestinationUntil: 'arrival',
          removeSprite: 'arrival',
        },
      }],
      timers,
      removeIds(ids) {
        removed.push(...ids);
      },
    })).toBe(true);

    vi.advanceTimersByTime(63);
    expect(removed).toEqual([]);

    vi.advanceTimersByTime(1);
    expect(removed).toEqual([4]);
    expect(timers).toHaveLength(0);
    vi.useRealTimers();
  });

  it('does not schedule group removal for scope-exit sprites', () => {
    vi.useFakeTimers();
    const timers: ReturnType<typeof setTimeout>[] = [];

    expect(scheduleReplayAnimationGroupRemoval({
      item: { id: 'held' },
      motions: [{
        startMs: 0,
        durationMs: 30,
        handoffPolicy: {
          hideSourceUntil: 'scope-exit',
          hideDestinationUntil: 'none',
          removeSprite: 'scope-exit',
        },
      }],
      timers,
      removeIds() {
        throw new Error('scope-exit sprites should not use timed group removal');
      },
    })).toBe(false);

    expect(timers).toHaveLength(0);
    vi.useRealTimers();
  });
});
