// Win-probability "eval bar" state (task #32). Fed by copycat-v1-20m's value
// head through the engine server's /local-engine/eval* routes (which proxy to
// the python eval sidecar). Always a DEDICATED evaluator, independent of which
// agent is being played — the bar answers "given what my seat can see, who is
// winning?" from ONE fixed seat's (hidden-info-asymmetric) observation.

export type EvalPoint = { stateIndex: number; pWin: number };
export type OmniscientFrame = { current: unknown; select: unknown; stateIndex: number; searchBeginInput: string | null };

type LiveEvalResponse = { ok: boolean; pWin: number | null; seat: number; ready: boolean };
type ReplayEvalResponse = { ok: boolean; points: EvalPoint[]; ready: boolean };
type OmniscientResponse = { ok: boolean; points: Array<{ stateIndex: number; qWin: number }>; ready: boolean };

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
  // The near-omniscient "judge's line" per seat (#45 T2): the searched value of
  // each seat's best move with the opponent's hidden state pinned to what the
  // replay recorded. ON-DEMAND (heavy exchange-depth search) — computed only when
  // the user asks, then cached here for the rest of the session. `omniscientReady`
  // gates the UI: idle -> not requested; loading -> computing; then the curves (or
  // `unavailable` when no honest+seeded frames exist to judge).
  omniscientCurves = $state<[EvalPoint[], EvalPoint[]]>([[], []]);
  omniscientState = $state<'idle' | 'loading' | 'ready' | 'unavailable'>('idle');

  private liveToken = 0;
  private replayToken = 0;
  private omniscientToken = 0;

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
    this.omniscientToken += 1;
    this.omniscientCurves = [[], []];
    this.omniscientState = 'idle';
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

  // Compute the near-omniscient judge's line on demand. Only honest seats are
  // judged (a seat needs its own hand present for the value axis); each seat's
  // search additionally needs the frames' searchBeginInput, so a replay lacking
  // it yields no points -> 'unavailable'. Idempotent per token; safe to await.
  async analyzeOmniscient(
    frames: OmniscientFrame[],
    decks: number[][],
    honestSeats: [boolean, boolean],
  ): Promise<void> {
    const token = ++this.omniscientToken;
    this.omniscientState = 'loading';
    this.omniscientCurves = [[], []];
    const seats = [0, 1].filter((seat) => honestSeats[seat]);
    const results = await Promise.all(
      seats.map((seat) =>
        postJson<OmniscientResponse>('/local-engine/analyze-omniscient', {
          frames, seat, deckSelf: decks[seat] ?? [], oppDeck: decks[seat === 0 ? 1 : 0] ?? [],
        })),
    );
    if (token !== this.omniscientToken) {
      return;
    }
    const next: [EvalPoint[], EvalPoint[]] = [[], []];
    seats.forEach((seat, i) => {
      next[seat] = (results[i]?.points ?? []).map((p) => ({ stateIndex: p.stateIndex, pWin: p.qWin }));
    });
    this.omniscientCurves = next;
    this.omniscientState = (next[0].length || next[1].length) ? 'ready' : 'unavailable';
  }

  omniscientForSeat(seat: number): EvalPoint[] {
    return this.omniscientCurves[seat] ?? [];
  }

  omniscientAt(stateIndex: number, seat: number): number | null {
    return nearestAtOrBefore(this.omniscientCurves[seat] ?? [], stateIndex);
  }

  curveForSeat(seat: number): EvalPoint[] {
    return this.replayCurves[seat] ?? [];
  }

  // Nearest curve point at or before a state index for one seat — lets the bar
  // track the scrubber even between that seat's decision states.
  pWinAtState(stateIndex: number, seat: number): number | null {
    return nearestAtOrBefore(this.replayCurves[seat] ?? [], stateIndex);
  }
}

// Nearest curve point at or before a state index — lets a bar/marker track the
// scrubber between that seat's decision states. Falls back to the first point so
// a marker shows from the start rather than popping in at the first decision.
function nearestAtOrBefore(curve: EvalPoint[], stateIndex: number): number | null {
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
