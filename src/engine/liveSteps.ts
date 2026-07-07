import { CabtLogType, type CabtCard, type CabtObservation } from '../lib/cabt/types';

type BridgeLog = Record<string, unknown>;

export type NormalizedObservation = {
  // The observation with both hands made explicit: the acting seat's hand is
  // the engine's, the other seat's is reconstructed (cached cards padded or
  // trimmed to handCount with synthetic-serial placeholders) so views never
  // flip between real cards and identity-less card backs.
  observation: CabtObservation;
  // Log lines this observation contributes to the canonical event stream:
  // re-deliveries are dropped, hidden-information encodings are downgraded
  // for concealed seats.
  newLogs: BridgeLog[];
};

// The engine delivers each seat the logs since that seat's last observation,
// so the two per-seat streams describe the same global event sequence twice —
// in full, in order, each in that seat's encoding (a draw is `DRAW` with the
// card to its owner, `DRAW_REVERSE` to the opponent). Content comparison
// cannot pair those variants, and it wrongly collapses legitimately identical
// lines (six face-down prize placements are six identical log objects).
//
// Position can: counting lines per seat stream gives every line a global
// event index, and an index below the canonical high-water mark is a
// re-delivery regardless of encoding. Verified against live engine games —
// see docs/audit-2026-07-07-viewer-play-pipeline.md (F4) and the env-gated
// bridge integration test.
export class LiveObservationNormalizer {
  private delivered = [0, 0];
  private canonicalCount = 0;
  private hands: Array<CabtCard[] | null> = [null, null];
  private nextSyntheticSerial = -1;

  constructor(private readonly concealedSeats: ReadonlySet<number> = new Set()) {}

  push(observation: CabtObservation): NormalizedObservation {
    const seat = observation.current?.yourIndex;
    if (!observation.current || (seat !== 0 && seat !== 1)) {
      return { observation, newLogs: [] };
    }

    const logs = observation.logs ?? [];
    const streamStart = this.delivered[seat];
    this.delivered[seat] = streamStart + logs.length;
    const freshFrom = Math.max(0, this.canonicalCount - streamStart);
    this.canonicalCount = Math.max(this.canonicalCount, streamStart + logs.length);
    const newLogs = logs.slice(freshFrom).map((log) => this.applyVisibility(log));

    return { observation: this.withStableHands(observation), newLogs };
  }

  // A concealed seat's draws arrive card-first in that seat's own
  // observations; emit them the way the engine tells the other seat instead,
  // so the timeline and draw animations don't reveal the card. Other
  // hidden-info encodings (deck searches) keep their first-delivery form for
  // now; choosing per-event encodings is bridge work (audit F4).
  private applyVisibility(log: BridgeLog): BridgeLog {
    const playerIndex = log.playerIndex;
    if (
      log.type === CabtLogType.DRAW
      && typeof playerIndex === 'number'
      && this.concealedSeats.has(playerIndex)
    ) {
      return { type: CabtLogType.DRAW_REVERSE, playerIndex };
    }
    return log;
  }

  private withStableHands(observation: CabtObservation): CabtObservation {
    const current = observation.current!;
    const players = current.players.map((player, seat) => {
      if (player.hand) {
        this.hands[seat] = player.hand;
        return player;
      }
      const hand = this.reconciledHand(this.hands[seat] ?? [], player.handCount, seat);
      this.hands[seat] = hand;
      return { ...player, hand };
    });
    return { ...observation, current: { ...current, players } };
  }

  // The engine only sends the acting seat's hand; the other seat's is carried
  // forward and reconciled against handCount so its length is always right.
  // Unknown additions become placeholders with stable negative serials (hand
  // anchors key on serials); removals take placeholders first, then trim from
  // the back. Contents refresh whenever that seat acts again.
  private reconciledHand(cards: CabtCard[], handCount: number, seat: number): CabtCard[] {
    if (cards.length === handCount) {
      return cards;
    }
    if (cards.length < handCount) {
      const padded = [...cards];
      while (padded.length < handCount) {
        padded.push({ id: 0, serial: this.nextSyntheticSerial--, playerIndex: seat });
      }
      return padded;
    }
    const trimmed = [...cards];
    for (let index = trimmed.length - 1; index >= 0 && trimmed.length > handCount; index -= 1) {
      if (isPlaceholder(trimmed[index])) {
        trimmed.splice(index, 1);
      }
    }
    return trimmed.slice(0, handCount);
  }
}

function isPlaceholder(card: CabtCard): boolean {
  return card.id === 0;
}
