import { cardForOption, type CabtDataMaps } from '../lib/cabt/cabtProjection';
import { displayName } from '../lib/cabt/cardView';
import {
  CabtAreaType,
  CabtCardType,
  CabtLogType,
  CabtOptionType,
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

// The engine never logs ability usage — the only signal is which option was
// selected on the previous observation. Synthesize the same `Ability`
// announce log the replay pipeline synthesizes (choreograph renders it as
// the label bubble over the source Pokemon before the effects resolve).
// Mirrors cabtReplay.ts's logsWithSynthesizedAbility for the live shapes.
export function synthesizedAnnounceLog(
  previous: CabtObservation | null,
  action: number[] | null,
  previousNewLogs: BridgeLog[],
  newLogs: BridgeLog[],
  dataMaps: CabtDataMaps,
): BridgeLog | null {
  if (newLogs.some((log) => log.type === 'Ability')) {
    return null;
  }
  return abilityLogForSelectedOption(previous, action, dataMaps)
    ?? retreatLogForSelectedOption(previous, action)
    ?? abilityLogForConfirmedTrigger(previous, action, dataMaps)
    ?? abilityLogForTriggeredEvolution(previousNewLogs, newLogs, dataMaps);
}

// Fold the synthesized ability announce into a step's log stream, mirroring
// cabtReplay.ts's logsWithSynthesizedAbility: the four selection-driven cases
// prepend a single announce; a triggered attach (attaching a hand card whose
// effect then resolves as further logs in the same step) instead INSERTS the
// announce right after the attach, so the badge shows over the attach, not
// before it. Live had only the prepend cases — this closes the attach gap.
export function logsWithSynthesizedAnnounce(
  previous: CabtObservation | null,
  action: number[] | null,
  previousNewLogs: BridgeLog[],
  newLogs: BridgeLog[],
  dataMaps: CabtDataMaps,
): BridgeLog[] {
  if (newLogs.some((log) => log.type === 'Ability')) {
    return newLogs;
  }
  const announce = synthesizedAnnounceLog(previous, action, previousNewLogs, newLogs, dataMaps);
  if (announce) {
    return [announce, ...newLogs];
  }
  const attach = abilityLogForTriggeredAttach(previous, newLogs, dataMaps);
  return attach ? logsWithInsertedLog(newLogs, attach.afterIndex, attach.log) : newLogs;
}

function selectedOption(previous: CabtObservation | null, action: number[] | null) {
  const select = previous?.select;
  const index = action?.[0];
  if (!select || index === undefined || !Number.isInteger(index)) {
    return undefined;
  }
  return select.option[index];
}

function abilityLogForSelectedOption(
  previous: CabtObservation | null,
  action: number[] | null,
  dataMaps: CabtDataMaps,
): BridgeLog | null {
  const option = selectedOption(previous, action);
  if (!option || option.type !== CabtOptionType.ABILITY || !previous) {
    return null;
  }
  const playerIndex = option.playerIndex ?? previous.current?.yourIndex;
  const source = cardForOption(option, previous);
  const cardId = source?.id ?? option.cardId;
  if (playerIndex === undefined || cardId === undefined || cardId === null) {
    return null;
  }
  return {
    type: 'Ability',
    playerIndex,
    cardId,
    serial: source?.serial ?? option.serial ?? undefined,
    abilityName: dataMaps.cardData[cardId]?.skills?.[0]?.name,
    area: option.area ?? undefined,
    index: option.index ?? undefined,
  };
}

// Retreating is chosen from the main menu like an ability; announcing it the
// same way gives the badge over the retreating Pokemon.
function retreatLogForSelectedOption(
  previous: CabtObservation | null,
  action: number[] | null,
): BridgeLog | null {
  const option = selectedOption(previous, action);
  if (!option || option.type !== CabtOptionType.RETREAT || !previous?.current) {
    return null;
  }
  const playerIndex = option.playerIndex ?? previous.current.yourIndex;
  const active = previous.current.players[playerIndex]?.active?.[0];
  if (!active) {
    return null;
  }
  return {
    type: 'Ability',
    playerIndex,
    cardId: active.id,
    serial: active.serial,
    abilityName: 'Retreat',
  };
}

// Triggered abilities (e.g. Punk Up after evolving) are offered as a YesNo
// confirmation whose contextCard names the source; no Ability option is ever
// selected, so answering Yes is the only signal to announce from.
function abilityLogForConfirmedTrigger(
  previous: CabtObservation | null,
  action: number[] | null,
  dataMaps: CabtDataMaps,
): BridgeLog | null {
  const select = previous?.select;
  if (!select || select.type !== CabtSelectType.YES_NO) {
    return null;
  }
  const option = selectedOption(previous, action);
  if (option?.type !== CabtOptionType.YES) {
    return null;
  }
  const contextCard = select.contextCard;
  if (!contextCard || contextCard.playerIndex === undefined) {
    return null;
  }
  const data = dataMaps.cardData[contextCard.id];
  if (!data?.skills?.length || data.cardType === CabtCardType.ITEM || data.cardType === CabtCardType.SUPPORTER) {
    return null;
  }
  return {
    type: 'Ability',
    playerIndex: contextCard.playerIndex,
    cardId: contextCard.id,
    serial: contextCard.serial,
    abilityName: data.skills[0]?.name,
  };
}

// On-evolve draw abilities ("when you play this Pokemon from your hand to
// evolve … draw N cards") trigger silently: the previous step evolved, this
// step is exactly those draws.
function abilityLogForTriggeredEvolution(
  previousNewLogs: BridgeLog[],
  newLogs: BridgeLog[],
  dataMaps: CabtDataMaps,
): BridgeLog | null {
  const evolveLog = [...previousNewLogs].reverse().find((log) => log.type === CabtLogType.EVOLVE);
  const playerIndex = typeof evolveLog?.playerIndex === 'number' ? evolveLog.playerIndex : undefined;
  const cardId = typeof evolveLog?.cardId === 'number' ? evolveLog.cardId : undefined;
  if (playerIndex === undefined || cardId === undefined) {
    return null;
  }
  const skill = evolutionTriggeredDrawSkill(dataMaps.cardData[cardId]);
  if (!skill || newLogs.length !== skill.drawCount) {
    return null;
  }
  const allDraws = newLogs.every((log) =>
    (log.type === CabtLogType.DRAW || log.type === CabtLogType.DRAW_REVERSE)
    && log.playerIndex === playerIndex);
  if (!allDraws) {
    return null;
  }
  return {
    type: 'Ability',
    playerIndex,
    cardId,
    serial: typeof evolveLog?.serial === 'number' ? evolveLog.serial : undefined,
    abilityName: skill.name,
    trigger: 'Evolve',
  };
}

function evolutionTriggeredDrawSkill(
  data: CabtDataMaps['cardData'][number] | undefined,
): { name: string; drawCount: number } | null {
  for (const skill of data?.skills ?? []) {
    const text = (skill.text ?? '')
      .toLowerCase()
      .replaceAll('é', 'e')
      .replaceAll(/\s+/g, ' ')
      .trim();
    if (!text.includes('when you play this pokemon from your hand to evolve')) {
      continue;
    }
    const drawCount = Number(text.match(/\bdraw\s+(\d+)\s+cards?\b/)?.[1]);
    if (Number.isFinite(drawCount) && drawCount > 0 && skill.name.trim()) {
      return { name: skill.name, drawCount };
    }
  }
  return null;
}

// A hand card attached this step whose effect then resolves (there are further,
// non-Attach logs after it in the same batch) is a triggered ability — announce
// it over the attaching card. Ported from cabtReplay.ts's abilityLogForTriggeredAttach.
function abilityLogForTriggeredAttach(
  previous: CabtObservation | null,
  newLogs: BridgeLog[],
  dataMaps: CabtDataMaps,
): { afterIndex: number; log: BridgeLog } | null {
  const attachIndex = newLogs.findIndex((log, index) =>
    log.type === CabtLogType.ATTACH
    && newLogs.slice(index + 1).some((candidate) => candidate.type !== CabtLogType.ATTACH)
    && attachedCardWasInHand(previous, log));
  if (attachIndex < 0) {
    return null;
  }
  const attach = newLogs[attachIndex];
  const cardId = numberField(attach.cardId);
  const playerIndex = numberField(attach.playerIndex);
  if (cardId === undefined || playerIndex === undefined) {
    return null;
  }
  return {
    afterIndex: attachIndex,
    log: {
      type: 'Ability',
      playerIndex,
      cardId,
      serial: numberField(attach.serial),
      cardIdTarget: numberField(attach.cardIdTarget),
      serialTarget: numberField(attach.serialTarget),
      abilityName: cardName(cardId, dataMaps),
      trigger: 'Attach',
    },
  };
}

function attachedCardWasInHand(previous: CabtObservation | null, log: BridgeLog): boolean {
  const playerIndex = numberField(log.playerIndex);
  const player = playerIndex === undefined ? undefined : previous?.current?.players[playerIndex];
  if (!player) {
    return false;
  }
  const serial = numberField(log.serial);
  const cardId = numberField(log.cardId);
  return (player.hand ?? []).some((card) =>
    serial !== undefined ? card.serial === serial : cardId !== undefined && card.id === cardId);
}

function logsWithInsertedLog(logs: BridgeLog[], afterIndex: number, log: BridgeLog): BridgeLog[] {
  return [...logs.slice(0, afterIndex + 1), log, ...logs.slice(afterIndex + 1)];
}

function numberField(value: unknown): number | undefined {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

function cardName(id: number, dataMaps: CabtDataMaps): string {
  return displayName(dataMaps.cardData[id]?.name ?? (Number.isFinite(id) ? `Card ${id}` : 'a card'));
}
