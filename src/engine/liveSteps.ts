import { cardForOption, type CabtDataMaps } from '../lib/cabt/cabtProjection';
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

// A play that draws (a supporter, Lillie-style mulligans) delivers its cause
// and its draws in one observation, but the coherent deal is two beats: the
// play/shuffle against a hand WITHOUT the incoming cards, then the draws
// landing. Split the trailing multi-draw run into its own step and give the
// first step a true pre-draw view, so a drawn card can never be visible
// before its deal animation. (Replay does the same with projected phase
// views.)
export type DrawStepSplit = {
  prefix: BridgeLog[];
  draws: BridgeLog[];
  // The observation as it looked before the draws resolved.
  preDrawObservation: CabtObservation;
};

export function splitTrailingDraws(observation: CabtObservation, logs: BridgeLog[]): DrawStepSplit | null {
  let start = logs.length;
  while (start > 0 && isDrawLog(logs[start - 1])) {
    start -= 1;
  }
  const draws = logs.slice(start);
  const prefix = logs.slice(0, start);
  const seat = draws[0]?.playerIndex;
  if (draws.length < 2 || !prefix.length || (seat !== 0 && seat !== 1)) {
    return null;
  }
  if (!draws.every((log) => log.playerIndex === seat)) {
    return null;
  }
  const current = observation.current;
  const player = current?.players[seat];
  if (!current || !player?.hand) {
    return null;
  }

  const drawnSerials = new Set(draws
    .filter((log) => log.type === CabtLogType.DRAW && typeof log.serial === 'number')
    .map((log) => log.serial as number));
  let reversedToDrop = draws.filter((log) => log.type === CabtLogType.DRAW_REVERSE).length;
  const preDrawHand: CabtCard[] = [];
  for (let index = player.hand.length - 1; index >= 0; index -= 1) {
    const card = player.hand[index];
    if (card.serial !== undefined && drawnSerials.has(card.serial)) {
      drawnSerials.delete(card.serial);
      continue;
    }
    if (reversedToDrop > 0 && isPlaceholder(card)) {
      reversedToDrop -= 1;
      continue;
    }
    preDrawHand.unshift(card);
  }

  const players = current.players.map((candidate, index) => (index === seat
    ? {
        ...candidate,
        hand: preDrawHand,
        handCount: preDrawHand.length,
        deckCount: candidate.deckCount + draws.length,
      }
    : candidate));
  return {
    prefix,
    draws,
    preDrawObservation: { ...observation, current: { ...current, players } },
  };
}

function isDrawLog(log: BridgeLog): boolean {
  return log.type === CabtLogType.DRAW || log.type === CabtLogType.DRAW_REVERSE;
}

// A knock-out delivers the attack, the board→discard departure, and its
// aftermath (prize takes, turn end) in one observation — whose board no
// longer contains the dying Pokemon. The departure must animate against a
// view where its source instance still exists, or the anchor degrades and
// the board corrects abruptly. Split the step at the discard-cleanup
// boundary and restore the departed Pokemon (with its stack and
// attachments, from the previous observation) into the first beat's view.
export type KnockOutSplit = {
  departure: BridgeLog[];
  rest: BridgeLog[];
  // The observation with the knocked-out Pokemon still in its slot.
  departureObservation: CabtObservation;
};

const BOARD_AREAS = new Set<unknown>([CabtAreaType.ACTIVE, CabtAreaType.BENCH]);
const CLEANUP_FROM_AREAS = new Set<unknown>([
  CabtAreaType.ACTIVE,
  CabtAreaType.BENCH,
  CabtAreaType.ENERGY,
  CabtAreaType.TOOL,
  CabtAreaType.PRE_EVOLUTION,
]);

export function splitKnockOut(
  previous: CabtObservation | null,
  observation: CabtObservation,
  logs: BridgeLog[],
): KnockOutSplit | null {
  const current = observation.current;
  if (!current || !previous?.current) {
    return null;
  }
  const knockOuts = logs.filter((log) =>
    log.type === CabtLogType.MOVE_CARD
    && BOARD_AREAS.has(log.fromArea)
    && log.toArea === CabtAreaType.DISCARD
    && typeof log.serial === 'number');
  if (!knockOuts.length) {
    return null;
  }

  // The departure beat runs through the last discard-cleanup line (the
  // Pokemon itself, then its attachments and evolution stack).
  let cleanupEnd = -1;
  logs.forEach((log, index) => {
    const isCleanup = (log.type === CabtLogType.MOVE_CARD || log.type === CabtLogType.MOVE_CARD_REVERSE)
      && log.toArea === CabtAreaType.DISCARD
      && CLEANUP_FROM_AREAS.has(log.fromArea);
    if (isCleanup) {
      cleanupEnd = index;
    }
  });
  const departure = logs.slice(0, cleanupEnd + 1);
  // Aftermath (prize takes, turn end) becomes its own beat against the true
  // board; when nothing follows, the next step or interactive view corrects
  // the restored slot after the fall animates.
  const rest = logs.slice(cleanupEnd + 1);

  // Restore each departed Pokemon into its (now empty) slot from the
  // previous observation, matched by serial so a same-name copy can never
  // stand in.
  let restored = false;
  const players = current.players.map((player, seat) => {
    const previousPlayer = previous.current!.players[seat];
    let active = player.active;
    let bench = player.bench;
    for (const knockOut of knockOuts) {
      if (knockOut.playerIndex !== seat) {
        continue;
      }
      if (knockOut.fromArea === CabtAreaType.ACTIVE) {
        const departed = previousPlayer?.active?.find((pokemon) => pokemon?.serial === knockOut.serial);
        if (departed && !active[0]) {
          active = [departed, ...active.slice(1)];
          restored = true;
        }
      } else {
        const index = previousPlayer?.bench?.findIndex((pokemon) => pokemon?.serial === knockOut.serial) ?? -1;
        if (index >= 0 && !bench[index]) {
          bench = bench.map((pokemon, benchIndex) => (benchIndex === index ? previousPlayer!.bench[index] : pokemon));
          restored = true;
        }
      }
    }
    return active === player.active && bench === player.bench ? player : { ...player, active, bench };
  });
  if (!restored) {
    return null;
  }

  return {
    departure,
    rest,
    departureObservation: { ...observation, current: { ...current, players } },
  };
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
