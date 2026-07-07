import { describe, expect, it } from 'vitest';
import { AnimationActivity, scheduledEndMs } from './activity';

describe('scheduledEndMs', () => {
  it('returns the max end across groups', () => {
    const motions = [
      { startMs: 0, durationMs: 300 },
      { startMs: 400, durationMs: 500 },
    ];
    const effects = [{ startMs: 100, durationMs: 250 }];
    expect(scheduledEndMs(motions, effects)).toBe(900);
  });

  it('returns 0 for empty batches', () => {
    expect(scheduledEndMs([], [])).toBe(0);
  });
});

describe('AnimationActivity', () => {
  it('reports remaining time after extendBy and idles once elapsed', async () => {
    const activity = new AnimationActivity();
    activity.extendBy(60);
    expect(activity.remainingMs()).toBeGreaterThan(0);
    await activity.waitForIdle();
    expect(activity.remainingMs()).toBe(0);
  });

  it('is idle immediately when nothing was scheduled', async () => {
    const activity = new AnimationActivity();
    const started = Date.now();
    await activity.waitForIdle();
    expect(Date.now() - started).toBeLessThan(30);
  });

  it('keeps waiting when extended mid-wait', async () => {
    const activity = new AnimationActivity();
    activity.extendBy(40);
    setTimeout(() => activity.extendBy(80), 20);
    const started = Date.now();
    await activity.waitForIdle();
    expect(Date.now() - started).toBeGreaterThanOrEqual(90);
  });

  it('caps the total wait so a runaway extension cannot deadlock', async () => {
    const activity = new AnimationActivity();
    activity.extendBy(60_000);
    const started = Date.now();
    await activity.waitForIdle(120);
    expect(Date.now() - started).toBeLessThan(1_000);
  });
});
