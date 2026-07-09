// Win-probability "eval bar" state (task #32). Fed by copycat-v1-20m's value
// head through the engine server's /local-engine/eval* routes (which proxy to
// the python eval sidecar). Always a DEDICATED evaluator, independent of which
// agent is being played — the bar answers "given what my seat can see, who is
// winning?" from ONE fixed seat's (hidden-info-asymmetric) observation.

export type EvalPoint = { stateIndex: number; pWin: number };

type LiveEvalResponse = { ok: boolean; pWin: number | null; seat: number; ready: boolean };
type ReplayEvalResponse = { ok: boolean; points: EvalPoint[]; ready: boolean };

class EvalStore {
  // P(the tracked seat wins) at the current live position, or null when the
  // sidecar can't answer (down, or the settled observation isn't this seat's).
  pWin = $state<number | null>(null);
  // Whether the sidecar answered at all this game (used to hide the bar when
  // the evaluator isn't running, rather than showing a stale/blank rail).
  live = $state(false);
  // The replay value curve: one point per decision state of the tracked seat.
  replayCurve = $state<EvalPoint[]>([]);
  replayLoading = $state(false);

  private liveToken = 0;
  private replayToken = 0;

  reset(): void {
    this.liveToken += 1;
    this.pWin = null;
    this.live = false;
  }

  clearReplay(): void {
    this.replayToken += 1;
    this.replayCurve = [];
    this.replayLoading = false;
  }

  // Refresh the live bar for `seat`. Out-of-order responses are dropped via a
  // monotonic token so a slow eval can never overwrite a newer position.
  async refreshLive(seat: number): Promise<void> {
    const token = ++this.liveToken;
    const result = await postJson<LiveEvalResponse>('/local-engine/eval', { seat });
    if (token !== this.liveToken) {
      return;
    }
    if (!result) {
      this.live = false;
      return;
    }
    this.live = result.ready || this.live;
    // Hold the last value across the opponent's turn (pWin=null) rather than
    // dropping the bar to empty; only replace it with a fresh number.
    if (typeof result.pWin === 'number') {
      this.pWin = result.pWin;
    }
  }

  async loadReplayCurve(
    frames: Array<{ current: unknown; select: unknown; stateIndex: number }>,
    seat: number,
    deck: number[],
  ): Promise<void> {
    const token = ++this.replayToken;
    this.replayLoading = true;
    this.replayCurve = [];
    const result = await postJson<ReplayEvalResponse>('/local-engine/eval-replay', { frames, seat, deck });
    if (token !== this.replayToken) {
      return;
    }
    this.replayCurve = result?.points ?? [];
    this.replayLoading = false;
  }

  // Nearest curve point at or before a state index — for the replay bar to
  // track the scrubber even between decision states.
  pWinAtState(stateIndex: number): number | null {
    let best: number | null = null;
    for (const point of this.replayCurve) {
      if (point.stateIndex <= stateIndex) {
        best = point.pWin;
      } else {
        break;
      }
    }
    return best ?? this.replayCurve[0]?.pWin ?? null;
  }
}

async function postJson<T>(path: string, body: unknown): Promise<T | null> {
  try {
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      return null;
    }
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

export const evalStore = new EvalStore();
