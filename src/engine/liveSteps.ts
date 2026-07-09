import { type CabtDataMaps } from '../lib/cabt/cabtProjection';
import { displayName } from '../lib/cabt/cardView';
import { synthesizeAnnounceLogs, type AnnounceContext, type AnnounceLog } from '../lib/cabt/announceSynthesis';
import {
  CabtAreaType,
  CabtCardType,
  CabtLogType,
  CabtSelectType,
  type CabtCard,
  type CabtObservation,
} from '../lib/cabt/types';

type BridgeLog = Record<string, unknown>;

export type NormalizedObservation = {
  // The observation with both hands made explicit: the acting seat's hand is
  // the engine's, the other seat's is the event-sourced tracked hand, so
  // views never flip between real cards and identity-less card backs.
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
  private hands: [CabtCard[], CabtCard[]] = [[], []];
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
    const rawNewLogs = logs.slice(freshFrom);

    // Event-source hands from the raw (pre-downgrade) canonical events, so
    // both hands stay concrete wherever the stream has delivered the cards.
    for (const log of rawNewLogs) {
      this.applyHandEvent(log);
    }

    return {
      observation: this.withStableHands(observation),
      newLogs: rawNewLogs.map((log) => this.applyVisibility(log)),
    };
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

  // Exact event-sourced hand state. The mapping is validated against real
  // engine games (every own-observation checkpoint across full games matches
  // with zero drift): DRAW / MOVE_CARD-to-hand append the concrete card;
  // their REVERSE encodings append an unknown; MOVE_CARD-from-hand removes by
  // serial; a reversed removal takes an unknown first (we may not know which
  // card left until the seat's own observation refreshes the hand); and the
  // PLAY / ATTACH / EVOLVE announcements are the only record of in-turn hand
  // plays, removing by exact serial.
  private applyHandEvent(log: BridgeLog): void {
    const seat = log.playerIndex;
    if (seat !== 0 && seat !== 1) {
      return;
    }
    const hand = this.hands[seat];
    const type = log.type;
    const serial = typeof log.serial === 'number' ? log.serial : undefined;
    const cardId = typeof log.cardId === 'number' ? log.cardId : 0;

    if (type === CabtLogType.DRAW) {
      hand.push({ id: cardId, serial, playerIndex: seat });
      return;
    }
    if (type === CabtLogType.DRAW_REVERSE) {
      hand.push(this.placeholder(seat));
      return;
    }
    if (type === CabtLogType.MOVE_CARD || type === CabtLogType.MOVE_CARD_REVERSE) {
      const reversed = type === CabtLogType.MOVE_CARD_REVERSE;
      if (log.toArea === CabtAreaType.HAND) {
        hand.push(reversed ? this.placeholder(seat) : { id: cardId, serial, playerIndex: seat });
        return;
      }
      if (log.fromArea === CabtAreaType.HAND) {
        this.removeFromHand(hand, reversed ? undefined : serial);
      }
      return;
    }
    if (type === CabtLogType.PLAY || type === CabtLogType.ATTACH || type === CabtLogType.EVOLVE) {
      const index = serial === undefined ? -1 : hand.findIndex((card) => card.serial === serial);
      if (index >= 0) {
        hand.splice(index, 1);
      }
    }
  }

  private removeFromHand(hand: CabtCard[], serial: number | undefined): void {
    if (serial !== undefined) {
      const exact = hand.findIndex((card) => card.serial === serial);
      if (exact >= 0) {
        hand.splice(exact, 1);
        return;
      }
    }
    const unknown = hand.findIndex((card) => isPlaceholder(card));
    if (unknown >= 0) {
      hand.splice(unknown, 1);
      return;
    }
    // A hidden removal with no unknowns tracked: one known card is actually
    // gone but the stream hasn't said which. Drop the newest; the seat's own
    // observation corrects any wrong guess.
    hand.pop();
  }

  private placeholder(seat: number): CabtCard {
    return { id: 0, serial: this.nextSyntheticSerial--, playerIndex: seat };
  }

  private withStableHands(observation: CabtObservation): CabtObservation {
    const current = observation.current!;
    const players = current.players.map((player, index) => {
      const seat = index as 0 | 1;
      if (player.hand) {
        this.hands[seat] = [...player.hand];
        return player;
      }
      this.reconcileToCount(seat, player.handCount);
      return { ...player, hand: [...this.hands[seat]] };
    });
    return { ...observation, current: { ...current, players } };
  }

  // Safety net over the event model: if an unmapped engine log ever touches a
  // hand, the count from the observation is authoritative. Unknown additions
  // become placeholders; removals take placeholders first, then the newest.
  private reconcileToCount(seat: 0 | 1, handCount: number): void {
    const hand = this.hands[seat];
    while (hand.length < handCount) {
      hand.push(this.placeholder(seat));
    }
    for (let index = hand.length - 1; index >= 0 && hand.length > handCount; index -= 1) {
      if (isPlaceholder(hand[index])) {
        hand.splice(index, 1);
      }
    }
    while (hand.length > handCount) {
      hand.pop();
    }
  }
}

function isPlaceholder(card: CabtCard): boolean {
  return card.id === 0;
}

// The engine never logs ability usage; both the live and replay pipelines
// reconstruct an `Ability` announce from the selected option (and silent
// evolve/attach triggers) via the shared rule core in announceSynthesis.ts.
// This adapter maps the live observation shapes onto that core's context.
export function logsWithSynthesizedAnnounce(
  previous: CabtObservation | null,
  action: number[] | null,
  previousNewLogs: BridgeLog[],
  newLogs: BridgeLog[],
  dataMaps: CabtDataMaps,
): BridgeLog[] {
  return synthesizeAnnounceLogs(liveAnnounceContext(previous, action, previousNewLogs, newLogs, dataMaps));
}

function liveAnnounceContext(
  previous: CabtObservation | null,
  action: number[] | null,
  previousNewLogs: BridgeLog[],
  newLogs: BridgeLog[],
  dataMaps: CabtDataMaps,
): AnnounceContext {
  const select = previous?.select ?? null;
  const index = action?.[0];
  const selectedOption = select && index !== undefined && Number.isInteger(index)
    ? (select.option[index] as unknown as AnnounceLog) ?? null
    : null;
  const current = previous?.current;
  return {
    selectedOption,
    selectedPlayerIndex: current?.yourIndex,
    select: (select as unknown as AnnounceLog) ?? null,
    isYesNoSelect: select?.type === CabtSelectType.YES_NO,
    previousLogs: previousNewLogs,
    newLogs,
    logTypeName: liveLogTypeName,
    players: (current?.players ?? []).map((player) => ({
      active: player.active ?? [],
      bench: player.bench ?? [],
      hand: player.hand ?? [],
    })),
    stadium: current?.stadium ?? [],
    cardMeta: (id) => {
      const data = dataMaps.cardData[id];
      if (!data) {
        return undefined;
      }
      return {
        isTrainer: data.cardType === CabtCardType.ITEM || data.cardType === CabtCardType.SUPPORTER,
        skills: data.skills ?? [],
      };
    },
    cardDisplayName: (id) => dataMaps.cardData[id]?.name,
    displayName,
  };
}

const liveLogTypeNames: Record<number, string> = {
  [CabtLogType.DRAW]: 'Draw',
  [CabtLogType.DRAW_REVERSE]: 'DrawReverse',
  [CabtLogType.ATTACH]: 'Attach',
  [CabtLogType.EVOLVE]: 'Evolve',
};

// Live logs carry the numeric CabtLogType; map the kinds the rule core tests
// to their canonical names (already-synthesized string types pass through).
function liveLogTypeName(log: BridgeLog): string {
  const type = log.type;
  if (typeof type === 'number' && type in liveLogTypeNames) {
    return liveLogTypeNames[type];
  }
  return String(type ?? '');
}
