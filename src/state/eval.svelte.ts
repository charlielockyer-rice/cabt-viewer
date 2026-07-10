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
  // The OPPONENT's self-view P(opponent wins) at their most recent decision —
  // the layered bar maps this to 1 - oppPWin (their read of my win chance).
  oppPWin = $state<number | null>(null);
  // Whether the sidecar answered at all this game (used to hide the bar when
  // the evaluator isn't running, rather than showing a stale/blank rail).
  live = $state(false);
  // Replay value curves, one per SEAT (index = seat). Each holds one point per
  // that seat's own decision state; the two lines interleave on the timeline and
  // their divergence is the information asymmetry. Both honest when the replay
  // carries raw/omniscient frames (each acting seat's own hand); otherwise the
  // opponent line is empty/degraded.
  replayCurves = $state<[EvalPoint[], EvalPoint[]]>([[], []]);
  replayLoading = $state(false);

  private liveToken = 0;
  private replayToken = 0;

  reset(): void {
    this.liveToken += 1;
    this.pWin = null;
    this.oppPWin = null;
    this.live = false;
  }

  clearReplay(): void {
    this.replayToken += 1;
    this.replayCurves = [[], []];
    this.replayLoading = false;
  }

  // Refresh the live bar for BOTH perspectives — my seat's self-view and the
  // opponent's. Out-of-order responses are dropped via a monotonic token so a
  // slow eval can never overwrite a newer position.
  async refreshLive(mySeat: number, oppSeat: number): Promise<void> {
    const token = ++this.liveToken;
    const [mine, opp] = await Promise.all([
      postJson<LiveEvalResponse>('/local-engine/eval', { seat: mySeat }),
      postJson<LiveEvalResponse>('/local-engine/eval', { seat: oppSeat }),
    ]);
    if (token !== this.liveToken) {
      return;
    }
    if (!mine && !opp) {
      this.live = false;
      return;
    }
    this.live = mine?.ready || opp?.ready || this.live;
    // Hold the last value across a turn where a seat isn't deciding (pWin=null)
    // rather than dropping to empty; only replace with a fresh number.
    if (typeof mine?.pWin === 'number') {
      this.pWin = mine.pWin;
    }
    if (typeof opp?.pWin === 'number') {
      this.oppPWin = opp.pWin;
    }
  }

  // Score the HONEST seats' own-view lines over the episode (each seat's frames
  // are filtered server-side to that seat's decisions). A seat whose hand the
  // replay concealed is skipped, so we never draw a degraded line for it.
  async loadReplayCurve(
    frames: Array<{ current: unknown; select: unknown; stateIndex: number }>,
    decks: number[][],
    honestSeats: [boolean, boolean],
  ): Promise<void> {
    const token = ++this.replayToken;
    this.replayLoading = true;
    this.replayCurves = [[], []];
    const seats = [0, 1].filter((seat) => honestSeats[seat]);
    const results = await Promise.all(
      seats.map((seat) =>
        postJson<ReplayEvalResponse>('/local-engine/eval-replay', { frames, seat, deck: decks[seat] ?? [] })),
    );
    if (token !== this.replayToken) {
      return;
    }
    const next: [EvalPoint[], EvalPoint[]] = [[], []];
    seats.forEach((seat, i) => { next[seat] = results[i]?.points ?? []; });
    this.replayCurves = next;
    this.replayLoading = false;
  }

  curveForSeat(seat: number): EvalPoint[] {
    return this.replayCurves[seat] ?? [];
  }

  // Nearest curve point at or before a state index for one seat — lets the bar
  // track the scrubber even between that seat's decision states.
  pWinAtState(stateIndex: number, seat: number): number | null {
    const curve = this.replayCurves[seat] ?? [];
    let best: number | null = null;
    for (const point of curve) {
      if (point.stateIndex <= stateIndex) {
        best = point.pWin;
      } else {
        break;
      }
    }
    return best ?? curve[0]?.pWin ?? null;
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
