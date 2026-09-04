import { cabtObservationToGameView, type CabtDataMaps } from '../lib/cabt/cabtProjection';
import { displayName } from '../lib/cabt/cardView';
import { CanonicalCabtLogStream } from '../lib/cabt/canonicalLogs';
import { markPassAnnounceEvents, stepAnimationPhases } from '../lib/cabt/cabtReplay';
import { cabtLogsToTimeline } from '../lib/cabt/logFormat';
import { synthesizeAnnounceLogs, stampAttachSourceZones, type AnnounceContext, type AnnounceLog } from '../lib/cabt/announceSynthesis';
import {
  CabtAreaType,
  CabtCardType,
  CabtLogType,
  CabtSelectType,
  type CabtCard,
  type CabtObservation,
  type CabtOption,
  type CabtSelectData,
} from '../lib/cabt/types';
import type { ActionTimelineEvent, GameView, LogView, SeatView } from '../lib/game/types';

type BridgeLog = Record<string, unknown>;

export type NormalizedObservation = {
  // The observation the client may see: the concealed seat's hand replaced by
  // the event-sourced tracked hand (placeholders for anything the human seat's
  // encoding never revealed), its private reveal buffer and select payload
  // stripped. The acting seat's own hand is the engine's.
  observation: CabtObservation;
  // Log lines this observation contributes to the canonical event stream:
  // re-deliveries are dropped, and a concealed seat's lines are replaced by the
  // human seat's own encoding of the same global event.
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
// re-delivery regardless of encoding. Verified against live engine games by
// the env-gated bridge integration test.
//
// The same index is what makes concealment exact rather than hand-written: for
// an agent-seat event the engine has ALREADY told the human seat what the human
// is allowed to know about it, so we ship the human's line for that index
// instead of inventing a downgrade rule per event type. See `visibleLog`.
export class LiveObservationNormalizer {
  private readonly canonicalLogs = new CanonicalCabtLogStream<BridgeLog>();
  private hands: [CabtCard[], CabtCard[]] = [[], []];
  private nextSyntheticSerial = -1;

  constructor(private readonly concealedSeats: ReadonlySet<number> = new Set()) {}

  push(observation: CabtObservation): NormalizedObservation {
    return this.pushResponse([observation])[0];
  }

  // One bridge response: the human's just-answered observation, the agent's own
  // observations for the decisions it auto-played, and the human's next
  // observation. Because the human's delivery of an event can arrive AFTER the
  // agent's, the response is scanned for the human seat's encodings first, and
  // only then turned into steps.
  pushResponse(observations: readonly CabtObservation[]): NormalizedObservation[] {
    const visible = this.visibleEncodings(observations);
    return observations.map((observation) => this.pushObservation(observation, visible));
  }

  private pushObservation(observation: CabtObservation, visible: Map<number, BridgeLog>): NormalizedObservation {
    const seat = observation.current?.yourIndex;
    if (!observation.current || (seat !== 0 && seat !== 1)) {
      return { observation, newLogs: [] };
    }

    const newLogs = this.canonicalLogs
      .pushIndexed(seat, observation.logs ?? [])
      .map((entry) => this.visibleLog(entry.log, entry.index, visible));

    // Event-source hands from the VISIBLE events: a concealed seat's hand then
    // consists of placeholders except where the human's own encoding named a
    // card (an Ultra Ball search reveals what it took).
    for (const log of newLogs) {
      this.applyHandEvent(log);
    }

    return {
      observation: this.withStableHands(concealObservation(observation, this.concealedSeats)),
      newLogs,
    };
  }

  // Every global event index the UNCONCEALED seats deliver in this response,
  // in that seat's own encoding. First delivery wins, so an index the human
  // already owns keeps the log the canonical stream itself would return.
  private visibleEncodings(observations: readonly CabtObservation[]): Map<number, BridgeLog> {
    const visible = new Map<number, BridgeLog>();
    const delivered = [this.canonicalLogs.deliveredCount(0), this.canonicalLogs.deliveredCount(1)];
    for (const observation of observations) {
      const seat = observation.current?.yourIndex;
      if (seat !== 0 && seat !== 1) {
        continue;
      }
      const logs = observation.logs ?? [];
      const start = delivered[seat];
      delivered[seat] = start + logs.length;
      if (this.concealedSeats.has(seat)) {
        continue;
      }
      logs.forEach((log, offset) => {
        if (!visible.has(start + offset)) {
          visible.set(start + offset, log);
        }
      });
    }
    return visible;
  }

  // The concealment rule, in one place: an event the human seat also received
  // is emitted exactly as the ENGINE told the human. Nothing is invented, so
  // context-dependent reveals (Ultra Ball names the card it took, a Recon
  // Directive look does not) are right by construction.
  private visibleLog(log: BridgeLog, index: number, visible: Map<number, BridgeLog>): BridgeLog {
    const seen = visible.get(index);
    // Positional pairing is the canonical stream's contract; the actor is a
    // cheap cross-check that the two lines really are one event.
    if (seen && seen.playerIndex === log.playerIndex) {
      return seen;
    }
    const playerIndex = log.playerIndex;
    if (typeof playerIndex === 'number' && this.concealedSeats.has(playerIndex)) {
      return downgradedLog(log);
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

// APPROXIMATE fallback, used only when the human seat never delivered this
// event — the game ended inside the agent's turn, so no human observation
// follows it in the response. It conceals by area rather than by knowing what
// the engine would have said, so it over-conceals: a revealed DECK->HAND search
// (Ultra Ball, Poffin) that the human is allowed to see comes out face-down.
// Erring toward hidden is the safe direction, and the frames it affects are the
// last of a finished game.
function downgradedLog(log: BridgeLog): BridgeLog {
  if (log.type === CabtLogType.DRAW) {
    return { type: CabtLogType.DRAW_REVERSE, playerIndex: log.playerIndex };
  }
  if (log.type !== CabtLogType.MOVE_CARD || !movesThroughHiddenArea(log)) {
    return log;
  }
  const { cardId: _cardId, serial: _serial, ...rest } = log;
  return { ...rest, type: CabtLogType.MOVE_CARD_REVERSE };
}

// HAND->DECK (a mulligan return, a shuffle-back) is covered by DECK itself.
function movesThroughHiddenArea(log: BridgeLog): boolean {
  const hidden = (area: unknown) => area === CabtAreaType.DECK
    || area === CabtAreaType.LOOKING
    || area === CabtAreaType.PRIZE
    || area === CabtAreaType.DECK_BOTTOM;
  return hidden(log.fromArea) || hidden(log.toArea);
}

// The observation body carries hidden information the log stream does not: the
// agent's hand, the cards it is currently looking at, and the decision it is
// being asked to make (whose options and deck list name cards). Steps carry no
// decision, and the play zone only needs the public contextCard/effect, so all
// of it can go before projection.
export function concealObservation(
  observation: CabtObservation,
  concealedSeats: ReadonlySet<number>,
): CabtObservation {
  const current = observation.current;
  if (!current || !concealedSeats.size) {
    return observation;
  }
  const players = current.players.map((player, seat) => (
    concealedSeats.has(seat) && player.hand ? { ...player, hand: null } : player
  ));
  // `looking` and `select` belong to the seat the observation was addressed to.
  const concealedActor = concealedSeats.has(current.yourIndex);
  return {
    ...observation,
    select: concealedActor ? concealSelect(observation.select) : observation.select,
    current: {
      ...current,
      looking: concealedActor ? [] : current.looking,
      players,
    },
  };
}

function concealSelect(select: CabtSelectData | null): CabtSelectData | null {
  if (!select) {
    return null;
  }
  return {
    ...select,
    deck: null,
    option: select.option.map(concealOption),
  };
}

function concealOption(option: CabtOption): CabtOption {
  if (option.cardId == null && option.serial == null) {
    return option;
  }
  return { ...option, cardId: null, serial: null };
}

function isPlaceholder(card: CabtCard): boolean {
  return card.id === 0;
}

// Everything one live session needs to turn bridge responses into playback
// steps. Held by LocalEngineController; built here so tests can drive the exact
// same path from a recorded observation stream (see liveConceal.test.ts).
export type LiveStepState = {
  normalizer: LiveObservationNormalizer;
  dataMaps: CabtDataMaps;
  seats: SeatView[];
  // The concealed observation the client sees, and the raw one it must not.
  observation: CabtObservation | null;
  rawObservation: CabtObservation | null;
  logs: LogView[];
  logId: number;
  actionTimeline: ActionTimelineEvent[];
  timelineId: number;
  lastNewLogs: BridgeLog[];
  // Carries "did the current turn attack yet" across observations/selects, so
  // a TurnEnd reached without ever attacking (explicit pass, forced pass, an
  // effect ending the turn) gets flagged for the Pass announce — see
  // markPassAnnounceEvents in cabtReplay.ts, the rule shared with replay.
  passAnnounceState: { attackedThisTurn: boolean };
  // Concealed frames: what `saveReplay` writes as `visualize`.
  replayFrames: CabtObservation[];
  // Raw frames, each carrying its acting seat's own hand. Server-side file
  // only (`rawVisualize`), so an analysis replay can show each seat's view.
  rawFrames: CabtObservation[];
};

export function createLiveStepState(options: {
  concealedSeats?: ReadonlySet<number>;
  seats?: SeatView[];
  dataMaps?: CabtDataMaps;
} = {}): LiveStepState {
  return {
    normalizer: new LiveObservationNormalizer(options.concealedSeats),
    dataMaps: options.dataMaps ?? { cardData: {}, attacks: {} },
    seats: options.seats ?? [],
    observation: null,
    rawObservation: null,
    logs: [],
    logId: 1,
    actionTimeline: [],
    timelineId: 1,
    lastNewLogs: [],
    passAnnounceState: { attackedThisTurn: false },
    replayFrames: [],
    rawFrames: [],
  };
}

// One playback beat: the view the browser animates, plus the animation phase
// it came from. Only the view reaches the client; the key/label are what the
// offline probe and the tests read.
export type LiveStep = {
  view: GameView;
  key?: string;
  label?: string;
  durationMs?: number;
  // Which observation of the response this beat came from. One observation is
  // one engine batch, and several rules ("one mulligan beat per player per
  // batch") are stated in those terms.
  observationIndex: number;
};

// Live playback steps, shaped like replay's: each observation contributes
// exactly its own canonical events against the board state at that
// observation (seat-stabilized and concealed by the normalizer). Steps carry
// no prompts — they are history frames; only the final interactive view
// prompts.
export function buildLiveSteps(
  observations: readonly CabtObservation[],
  actions: ReadonlyArray<number[] | null>,
  state: LiveStepState,
): LiveStep[] {
  const normalized = state.normalizer.pushResponse(observations);
  const steps: LiveStep[] = [];
  let previous = state.observation;
  // A session that only ever saw concealed frames (or a test seeding one
  // observation) falls back to it: concealment only ever removes information.
  let rawPrevious = state.rawObservation ?? state.observation;
  for (let index = 0; index < normalized.length; index += 1) {
    const { observation, newLogs } = normalized[index];
    const previousObservation = previous;
    // The engine never logs ability usage; synthesize it from the selection
    // that produced this observation (and from a triggered attach), same as
    // replay's logsWithSynthesizedAbility. This reads the RAW previous
    // observation: an ability announce is public — which Pokemon used what —
    // and resolving it needs the select payload and hand the concealed
    // observation has already dropped. It only ever emits an `Ability` line
    // naming a card that is in play.
    const stepLogs = logsWithSynthesizedAnnounce(rawPrevious, actions[index] ?? null, state.lastNewLogs, newLogs, state.dataMaps);
    previous = observation;
    rawPrevious = observations[index];
    state.lastNewLogs = newLogs;
    state.observation = observation;
    state.rawObservation = observations[index];
    state.replayFrames.push(observation);
    state.rawFrames.push(observations[index]);
    if (!stepLogs.length) {
      continue;
    }
    // The engine resolves whole effects instantly; the player must watch
    // them happen. Replay's phase machinery splits the batch into typed
    // animation phases, each carrying the view of the world BEFORE that
    // phase resolves (pre-draw hands for both seats, the dying Pokemon
    // still standing for its knock-out, both switchers at their source
    // slots for a retreat). One live step per phase.
    const step = buildStep(state, observation, stepLogs);
    markPassAnnounceEvents(step.actionTimeline ?? [], state.passAnnounceState);
    const previousView = previousObservation
      ? {
          ...cabtObservationToGameView(previousObservation, state.logs, state.dataMaps, []),
          seats: state.seats,
        }
      : undefined;
    const phases = previousView
      ? stepAnimationPhases(previousView, step, step.actionTimeline ?? [])
      : undefined;
    if (phases?.length) {
      for (const phase of phases) {
        steps.push({
          view: { ...phase.view, seats: state.seats },
          key: phase.key,
          label: phase.label,
          durationMs: phase.durationMs,
          observationIndex: index,
        });
      }
    } else {
      steps.push({ view: step, observationIndex: index });
    }
  }
  return steps;
}

// Steps are history frames: projected without a decision, so playback
// never renders an interactive affordance. They carry seats like the
// interactive view does — hand concealment reads them.
function buildStep(state: LiveStepState, observation: CabtObservation, stepLogs: BridgeLog[]): GameView {
  const result = cabtLogsToTimeline(stepLogs, { nextId: state.timelineId });
  state.timelineId = result.nextId;
  state.actionTimeline = [...state.actionTimeline, ...result.events].slice(-200);
  for (const event of result.events) {
    state.logs = [...state.logs, { id: state.logId++, message: event.message }];
  }
  return {
    ...cabtObservationToGameView(observation, state.logs, state.dataMaps, result.events),
    seats: state.seats,
  };
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
  const context = liveAnnounceContext(previous, action, previousNewLogs, newLogs, dataMaps);
  stampAttachSourceZones(context);
  return synthesizeAnnounceLogs(context);
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
