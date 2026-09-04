// CABT delivers each seat the logs since that seat's last observation. The
// two seat streams therefore describe the same global event sequence twice,
// sometimes with different hidden-information encodings. Counting positions
// within each seat stream lets both live play and replay keep one canonical
// copy without collapsing legitimately identical events.
//
// The position is also the pairing key between the two encodings of one event:
// seat 0's line N and seat 1's line N are the same event told twice. Live play
// uses that to hand the browser the human seat's encoding of an agent-seat
// event (see liveSteps.ts).
export class CanonicalCabtLogStream<T> {
  private delivered = [0, 0];
  private canonicalCount = 0;

  // Global event index the seat's next delivery starts at.
  deliveredCount(seat: 0 | 1): number {
    return this.delivered[seat];
  }

  push(seat: unknown, logs: readonly T[]): T[] {
    return this.pushIndexed(seat, logs).map((entry) => entry.log);
  }

  // Same as `push`, pairing each new log with its global event index.
  pushIndexed(seat: unknown, logs: readonly T[]): Array<{ index: number; log: T }> {
    if (seat !== 0 && seat !== 1) {
      return [];
    }

    const streamStart = this.delivered[seat];
    this.delivered[seat] = streamStart + logs.length;
    const freshFrom = Math.max(0, this.canonicalCount - streamStart);
    this.canonicalCount = Math.max(this.canonicalCount, streamStart + logs.length);
    return logs.slice(freshFrom).map((log, offset) => ({ index: streamStart + freshFrom + offset, log }));
  }
}
