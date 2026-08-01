// CABT delivers each seat the logs since that seat's last observation. The
// two seat streams therefore describe the same global event sequence twice,
// sometimes with different hidden-information encodings. Counting positions
// within each seat stream lets both live play and replay keep one canonical
// copy without collapsing legitimately identical events.
export class CanonicalCabtLogStream<T> {
  private delivered = [0, 0];
  private canonicalCount = 0;

  push(seat: unknown, logs: readonly T[]): T[] {
    if (seat !== 0 && seat !== 1) {
      return [];
    }

    const streamStart = this.delivered[seat];
    this.delivered[seat] = streamStart + logs.length;
    const freshFrom = Math.max(0, this.canonicalCount - streamStart);
    this.canonicalCount = Math.max(this.canonicalCount, streamStart + logs.length);
    return logs.slice(freshFrom);
  }
}
