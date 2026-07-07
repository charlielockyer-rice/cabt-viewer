// Shared animation-activity signal for live play. The render layers know how
// long the motions and effects they schedule will run (startMs + durationMs,
// plus handoff/settle padding), so they extend a single "busy until"
// timestamp when a batch starts. The live sequence stepper awaits idle before
// applying the next view, making playback strictly sequential instead of
// fixed-cadence. Replay never touches this: its pacing is owned by the
// replay store's phase timeline.

type Timed = { startMs: number; durationMs: number };

export function scheduledEndMs(...groups: Timed[][]): number {
  let end = 0;
  for (const group of groups) {
    for (const item of group) {
      end = Math.max(end, item.startMs + item.durationMs);
    }
  }
  return end;
}

export class AnimationActivity {
  private busyUntil = 0;

  extendBy(durationMs: number, now = Date.now()): void {
    this.busyUntil = Math.max(this.busyUntil, now + Math.max(0, durationMs));
  }

  remainingMs(now = Date.now()): number {
    return Math.max(0, this.busyUntil - now);
  }

  // Resolves when all reported animation activity has finished. Re-checks on
  // each tick because layers may extend the busy window while we wait (e.g.
  // destination polling). capMs bounds the total wait so a stuck poll can
  // never deadlock playback.
  async waitForIdle(capMs = 5000): Promise<void> {
    const started = Date.now();
    for (;;) {
      const now = Date.now();
      const remaining = Math.min(this.remainingMs(now), started + capMs - now);
      if (remaining <= 0) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, Math.min(remaining, 100)));
    }
  }
}

export const animationActivity = new AnimationActivity();
