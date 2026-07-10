import cardRows from './cardData.generated.json';
import attackRows from './attackData.generated.json';
import { actionAnimationTiming } from '../anim/timing';
import {
  projectHand,
  projectPhase,
  projectPokemonSlot,
  projectWinner,
  specialConditionsFor,
  stadiumForPlayer,
  type SlotResolvers,
} from './cabtProjection';
import { displayName } from './cardView';
import { classifyCard } from './cardClassify';
import { synthesizeAnnounceLogs, stampAttachSourceZones, type AnnounceContext, type AnnounceLog } from './announceSynthesis';
import { cabtLogsToTimeline } from './logFormat';
import { CabtAreaType, CabtOptionType } from './types';
import { resolveCardImageUrl } from '../game/cardImages';
import { type ActionTimelineEvent, type CardView, type GameView, type LogView, type PlayerView, type PokemonSlotView } from '../game/types';
import type { ReplayAnimationPhase, ReplaySnapshot, ReplayStep } from '../game/replay';

type CardRow = {
  id: number;
  name: string;
  set: string;
  setNumber: string;
  kind: string;
  rule: string;
  evolvesFrom: string;
  hp: number | null;
  type: string;
  retreat: number | null;
  attackName: string;
  attackCost: string;
  attackDamage: string;
  attackText: string;
  cardType: number;
  energyType?: number;
  basic?: boolean;
  stage1?: boolean;
  stage2?: boolean;
  retreatCost?: number;
  skills?: Array<{ name: string; text?: string }>;
  attacks?: number[];
};

type AttackRow = {
  attackId: number;
  name: string;
  text?: string;
  damage?: number;
  energies?: number[];
};

type CabtCardRef = {
  id: number;
  serial?: number;
  playerIndex?: number;
  name?: string;
};

type CabtPokemonRef = CabtCardRef & {
  hp?: number;
  maxHp?: number;
  energies?: number[];
  energyCards?: CabtCardRef[];
  tools?: CabtCardRef[];
  preEvolution?: CabtCardRef[];
};

type CabtPlayerFrame = {
  active?: CabtPokemonRef[];
  bench?: CabtPokemonRef[];
  benchMax?: number;
  deckCount?: number;
  discard?: CabtCardRef[];
  hand?: CabtCardRef[];
  handCount?: number;
  prize?: Array<CabtCardRef | null>;
  poisoned?: boolean;
  burned?: boolean;
  asleep?: boolean;
  paralyzed?: boolean;
  confused?: boolean;
};

type CabtVisualizeFrame = {
  logs?: Array<Record<string, unknown>>;
  select?: Record<string, unknown> | null;
  selected?: unknown;
  action?: unknown;
  obs?: unknown;
  current: {
    turn: number;
    yourIndex: number;
    result: number;
    stadium?: CabtCardRef[];
    players: CabtPlayerFrame[];
  };
};

type KaggleEnvironment = {
  id?: string;
  title?: string;
  rewards?: number[];
  statuses?: string[];
  steps?: Array<Array<{
    action?: unknown;
    observation?: Record<string, unknown>;
    status?: string;
    reward?: number;
    visualize?: unknown;
  }>>;
  info?: {
    TeamNames?: string[];
    EpisodeId?: string | number;
  };
};

type KaggleContext = {
  environment?: KaggleEnvironment;
};

type CabtRunnerJson = {
  visualize?: CabtVisualizeFrame[];
  steps?: Array<{ index?: number; action?: unknown; observation?: unknown }>;
};

const cardDatabase = new Map<number, CardRow>((cardRows as CardRow[]).map((card) => [card.id, card]));
const attackDatabase = new Map<number, AttackRow>((attackRows as AttackRow[]).map((attack) => [attack.attackId, attack]));

// Live steps share replay's phase machinery: a mutating batch becomes one
// view per animation phase, each phase animating against its own pre-state
// (both seats, hands/board/piles alike — the hand mutators degrade to counts
// when the concealed stream omits serials). This is the single source of
// "animations play against pre-state" truth; live must never grow its own
// per-symptom splits again.
export function stepAnimationPhases(
  previousView: GameView,
  currentView: GameView,
  events: ActionTimelineEvent[],
): ReplayAnimationPhase[] | undefined {
  // A turn transition is a hard boundary: events after a TurnStart belong to
  // the NEW turn and animate as their own beat(s) against the post-transition
  // pre-state — never folded into the previous player's action step. (Replay's
  // frame builder already splits here; this brings the live per-observation
  // path in line, so an attack-ends-turn or KO-promotion batch that arrives
  // with the opponent's start-of-turn draw doesn't animate the draw inside the
  // attacker's step.) Only TurnStart splits — every other batch stays whole so
  // the coalesced attach/placement and retreat sequences are unaffected.
  const segments = splitAtTurnStart(events);
  if (segments.length <= 1) {
    const group: ReplayActionGroup = { label: '', type: 'live', events, turn: 0 };
    return groupedStepAnimationPhases(previousView, currentView, [group], 0);
  }
  const phases: ReplayAnimationPhase[] = [];
  let base = previousView;
  let afterTurnStart = false;
  for (const segment of segments) {
    if (segment[0]?.kind === 'TurnStart') {
      afterTurnStart = true;
    }
    // A pre-transition beat keeps the ACTING turn's perspective (whose turn,
    // turn number, board orientation) — projecting toward the observation's
    // end state would flip the seat before the turn actually ends, which is the
    // bug: the attack (and the opponent's draw) render in the new turn's
    // perspective. The board/hand still come from the projection; only the
    // turn-owner metadata is pinned to the acting side.
    const perspective = afterTurnStart ? currentView : previousView;
    const segmentView: GameView = {
      ...projectedViewForEvents(base, currentView, segment),
      turn: perspective.turn,
      activePlayerIndex: perspective.activePlayerIndex,
      activePlayerId: perspective.activePlayerId,
      turnSeat: perspective.turnSeat,
    };
    const group: ReplayActionGroup = { label: '', type: 'live', events: segment, turn: 0 };
    const segmentPhases = groupedStepAnimationPhases(base, segmentView, [group], 0);
    if (segmentPhases?.length) {
      phases.push(...segmentPhases);
    } else if (segment.some((event) => animationPhaseKey(event))) {
      // A single-phase segment (e.g. the new turn's lone draw) that the grouped
      // builder collapses to nothing — emit it as its own beat/view.
      const keyEvent = segment.find((event) => animationPhaseKey(event));
      const key = keyEvent ? animationPhaseKey(keyEvent) ?? 'LiveSegment:0' : 'LiveSegment:0';
      phases.push({
        key,
        label: keyEvent?.message,
        view: { ...segmentView, actionTimeline: segment },
        actionTimeline: segment,
        durationMs: animationPhaseDurationMs(key, segment.filter((event) => animationPhaseKey(event) === key).length),
      });
    }
    base = segmentView;
  }
  return phases.length ? phases : undefined;
}

// Split an event batch so each TurnStart begins a new segment. A TurnStart with
// no preceding events in the current segment does not split (a pure new-turn
// observation stays one segment).
function splitAtTurnStart(events: ActionTimelineEvent[]): ActionTimelineEvent[][] {
  const segments: ActionTimelineEvent[][] = [];
  let current: ActionTimelineEvent[] = [];
  for (const event of events) {
    if (event.kind === 'TurnStart' && current.length) {
      segments.push(current);
      current = [];
    }
    current.push(event);
  }
  if (current.length) {
    segments.push(current);
  }
  return segments;
}

// A turn that ends without ever attacking (an explicit pass, a forced pass
// with no legal actions, or an effect that ends the turn) gets a "Pass"
// announce bubble over the ending player's active slot — the SAME bubble
// machinery an attack uses (motions.ts), just relabeled. It rides the
// existing (forced) TurnEnd step rather than inserting a new one: that step
// is already where the follow-active side switch to the next player happens
// (replayFollow.ts reads the TurnEnd event to flip), so the bubble lands
// right at that boundary with zero new scrubbable steps — the byte-identical
// step stream is untouched. The flag rides the TurnEnd event's own params so
// motions.ts stays a pure function of the event stream; both replay (below)
// and live (localEngine.ts) funnel through this one rule.
export function markPassAnnounceEvents(events: ActionTimelineEvent[], state: { attackedThisTurn: boolean }): void {
  for (const event of events) {
    if (event.kind === 'TurnStart') {
      state.attackedThisTurn = false;
    } else if (event.kind === 'Attack') {
      state.attackedThisTurn = true;
    } else if (event.kind === 'TurnEnd' && !state.attackedThisTurn) {
      const params = event.params as Record<string, unknown> | undefined;
      if (params) {
        params.passAnnounce = true;
      }
    }
  }
}

export function cabtReplayToSnapshot(input: unknown): ReplaySnapshot {
  const visualFrames = extractVisualizeFrames(input);
  if (!visualFrames.length) {
    throw new Error('CABT replay did not include visualize frames.');
  }

  const environment = replayEnvironment(input);
  const players = playerNames(input);
  const views: GameView[] = [];
  const logs: LogView[] = [];
  let logId = 1;
  let timelineId = 1;

  const frameEntries: ReplayFrameEntry[] = [];

  visualFrames.forEach((frame, index) => {
    const frameLogs = logsWithSynthesizedAbility(visualFrames[index - 1], frame);
    const timeline = cabtLogsToTimeline(frameLogs, { nextId: timelineId });
    timelineId = timeline.nextId;
    for (const entry of frameLogs) {
      logs.push({ id: logId++, message: formatLog(entry), params: entry });
    }
    const view = frameToGameView(frame, players, logs, timeline.events);
    views.push(view);
    const groups = replayActionGroups(timeline.events, frame.current.turn);
    frameEntries.push({ frame, view, groups });
  });

  // Flag pass-ending TurnEnds BEFORE buildDecisionSteps so the gated `Pass:`
  // animationPhaseKey fires while the phases are built — otherwise the flagged
  // TurnEnd step is phaseless and the bubble gets no dwell time on auto-play.
  // These are the same event objects the steps reference, walked in frame order
  // so the per-turn "did we attack" state threads correctly (mirrors live,
  // which marks each step before its phases are built).
  const passAnnounceState = { attackedThisTurn: false };
  for (const entry of frameEntries) {
    for (const group of entry.groups) {
      markPassAnnounceEvents(group.events, passAnnounceState);
    }
  }

  const steps = buildDecisionSteps(frameEntries, views);

  applyResolvingPlayedCards(steps, views);
  applyKnockOutDiscardTopOrdering(steps);

  steps.forEach((step, index) => {
    step.index = index;
    step.actionIndex = index === 0 ? null : index - 1;
  });

  const finalView = views.at(-1);
  const winner = typeof finalView?.winner === 'number' ? finalView.winner : -1;
  return {
    id: String(environment?.id ?? 'cabt-local-replay'),
    name: environment?.title ? `${environment.title} replay` : 'CABT replay',
    created: Date.now(),
    players: players.map((name, index) => ({ userId: index, name })),
    winner,
    stateCount: views.length,
    actionCount: Math.max(0, steps.length - 1),
    turnCount: Math.max(...views.map((view) => view.turn), 0),
    cardNames: [...new Set([...cardDatabase.values()].map((card) => card.name))],
    views,
    steps,
  };
}

type ReplayActionGroup = {
  label: string;
  type: string;
  events: ActionTimelineEvent[];
  turn: number;
};

type ReplayFrameEntry = {
  frame: CabtVisualizeFrame;
  view: GameView;
  groups: ReplayActionGroup[];
};

function logsWithSynthesizedAbility(
  previousFrame: CabtVisualizeFrame | undefined,
  frame: CabtVisualizeFrame,
): Array<Record<string, unknown>> {
  const logs = frame.logs ?? [];
  if (!previousFrame) {
    return logs;
  }
  const context = replayAnnounceContext(previousFrame, frame, logs);
  stampAttachSourceZones(context);
  return synthesizeAnnounceLogs(context);
}

// Maps a replay frame pair onto the shared announce rule core (announceSynthesis.ts).
function replayAnnounceContext(
  previousFrame: CabtVisualizeFrame,
  frame: CabtVisualizeFrame,
  logs: Array<Record<string, unknown>>,
): AnnounceContext {
  const selected = selectedOptionFromAction(previousFrame.select, frame.action);
  const current = previousFrame.current;
  return {
    selectedOption: selected?.option ?? null,
    selectedPlayerIndex: selected?.playerIndex,
    select: (previousFrame.select as AnnounceLog | null) ?? null,
    isYesNoSelect: String((previousFrame.select as Record<string, unknown> | null | undefined)?.type) === 'YesNo',
    previousLogs: previousFrame.logs ?? [],
    newLogs: logs,
    logTypeName: (log) => normalizedFrameLogType(log.type),
    players: (current.players ?? []).map((player) => ({
      active: player.active ?? [],
      bench: player.bench ?? [],
      hand: player.hand ?? [],
    })),
    stadium: current.stadium ?? [],
    cardMeta: (id) => {
      const data = cardDatabase.get(id);
      if (!data) {
        return undefined;
      }
      return {
        isTrainer: data.kind === 'Item' || data.kind === 'Supporter',
        skills: data.skills ?? [],
      };
    },
    cardDisplayName: (id) => cardDatabase.get(id)?.name,
    displayName,
  };
}

function selectedOptionFromAction(
  select: Record<string, unknown> | null | undefined,
  action: unknown,
): { playerIndex: number; option: Record<string, unknown> } | null {
  const options = Array.isArray(select?.option) ? select.option : [];
  if (!options.length || !Array.isArray(action)) {
    return null;
  }
  for (const [playerIndex, playerAction] of action.entries()) {
    const selectedIndex = selectedOptionIndex(playerAction);
    const option = selectedIndex === undefined ? undefined : options[selectedIndex];
    if (option && typeof option === 'object') {
      return { playerIndex, option: option as Record<string, unknown> };
    }
  }
  return null;
}

function selectedOptionIndex(playerAction: unknown): number | undefined {
  if (Array.isArray(playerAction)) {
    return numberField(playerAction[0]);
  }
  return numberField(playerAction);
}


function normalizedFrameLogType(type: unknown): string {
  return String(type ?? 'Event');
}

function numberField(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

// ---------------------------------------------------------------------------
// Decision-based step splitting.
//
// A replay step is one root decision and everything it caused. The frame
// stream records decisions directly: each frame's `action` answers the
// previous frame's `select`. A select offering an End option is the main
// action menu, so a frame that answers it starts a new step (play, attach,
// evolve, ability, attack, retreat, end turn). Any other select is a
// sub-decision whose consequences belong to the current step, and a frame
// without a select is engine auto-resolution that also continues the current
// step. Forced transitions (turn end/start, checkup, result) always cut, even
// mid-frame. The pre-game setup region (turn 0) keeps its per-group step
// shapes.
// ---------------------------------------------------------------------------

type OpenReplayStep = {
  startIndex: number;
  endIndex: number;
  consumedIndex: number;
  group: ReplayActionGroup;
};

function buildDecisionSteps(entries: ReplayFrameEntry[], views: GameView[]): ReplayStep[] {
  const steps: ReplayStep[] = [];
  let open: OpenReplayStep | null = null;

  const closeOpenStep = (): ReplayActionGroup | null => {
    if (!open) {
      return null;
    }
    steps.push(...openStepToReplaySteps(entries, views, open));
    const group = open.group;
    open = null;
    return group;
  };

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const groups = entry.groups;
    const setupFrame = entry.frame.current.turn === 0;
    const rootFrame = !setupFrame && index > 0 && frameShowsMainMenu(entries[index - 1].frame);
    if (rootFrame) {
      closeOpenStep();
    }

    if (!groups.length) {
      if (!open) {
        steps.push(fallbackStepForFrame(entry, index));
      }
      continue;
    }

    if (setupFrame) {
      // A mulligan's shuffle-back and redraw can arrive as separate groups or
      // in separate frames; both join as one step.
      const coalesced = coalesceMulliganGroups(groups);
      if (open && isMulliganReturnGroup(open.group) && mulliganRedrawContinues(coalesced[0], open.group)) {
        open.group.events.push(...coalesced[0].events);
        open.group.label = labelForGroup(open.group);
        open.endIndex = coalesced.length === 1 ? index : index - 1;
        open.consumedIndex = index;
        if (coalesced.length > 1) {
          const consumedGroup = closeOpenStep();
          const consumed = consumedGroup ? [consumedGroup] : [];
          steps.push(...stepsForFrameGroups(entry, views, index, [...consumed, ...coalesced.slice(1)], consumed.length));
        }
        continue;
      }
      closeOpenStep();
      const last = coalesced[coalesced.length - 1];
      if (isMulliganReturnGroup(last)) {
        steps.push(...stepsForFrameGroups(entry, views, index, coalesced, 0).slice(0, -1));
        open = { startIndex: index, endIndex: index, consumedIndex: index, group: last };
        continue;
      }
      steps.push(...stepsForFrameGroups(entry, views, index, coalesced, 0));
      continue;
    }

    const firstForced = groups.findIndex(isForcedStepGroup);
    const leadingCount = firstForced < 0 ? groups.length : firstForced;

    if (rootFrame) {
      if (leadingCount > 0) {
        open = {
          startIndex: index,
          endIndex: index,
          consumedIndex: index,
          group: mergedGroup(groups.slice(0, leadingCount)),
        };
      }
      if (leadingCount < groups.length) {
        const consumedGroup = closeOpenStep();
        const consumed = consumedGroup ? [consumedGroup] : [];
        steps.push(...stepsForFrameGroups(entry, views, index, [...consumed, ...groups.slice(leadingCount)], consumed.length));
      }
      continue;
    }

    if (open) {
      const leadingThisFrame = groups.slice(0, leadingCount);
      if (leadingCount > 0) {
        open.group.events.push(...leadingThisFrame.flatMap((group) => group.events));
        // The tail of an effect can share a frame with the next turn's events
        // (second damage hit + TurnEnd + draw). The merged step keeps the
        // previous frame as its state; the rest of the frame steps normally.
        open.endIndex = leadingCount === groups.length ? index : index - 1;
        open.consumedIndex = index;
      }
      if (leadingCount < groups.length) {
        closeOpenStep();
        // Carry this frame's consumed leading groups (e.g. an attack's Switch)
        // forward as projection context so the trailing turn-transition steps
        // don't rebuild their board from views[index-1], which predates them —
        // otherwise an active-vacating attack reverts to the old active on the
        // TurnEnd/TurnStart beats until the next raw frame lands. Only this
        // frame's leading groups are prepended: the open step's earlier-frame
        // events are already reflected in views[index-1]. Mirrors the rootFrame
        // branch above.
        const consumed = leadingThisFrame.length ? [mergedGroup(leadingThisFrame)] : [];
        steps.push(...stepsForFrameGroups(entry, views, index, [...consumed, ...groups.slice(leadingCount)], consumed.length));
      }
      continue;
    }

    // No decision context and nothing open: keep per-group steps. A lone
    // non-forced group stays open so auto-resolution frames can extend it.
    if (groups.length === 1 && leadingCount === 1) {
      open = { startIndex: index, endIndex: index, consumedIndex: index, group: mergedGroup(groups) };
      continue;
    }
    steps.push(...stepsForFrameGroups(entry, views, index, groups, 0));
  }

  closeOpenStep();
  return steps;
}

const forcedStepTypes = new Set(['TurnEnd', 'TurnStart', 'PokemonCheckup', 'Result']);

function isHandToDeckMove(event: ActionTimelineEvent): boolean {
  const params = event.params as Record<string, unknown> | undefined;
  return isMoveCardKind(event.kind)
    && Number(params?.fromArea) === CabtAreaType.HAND
    && Number(params?.toArea) === CabtAreaType.DECK;
}

// A turn-0 shuffle-back that has not redrawn yet — the redraw belongs to it.
function isMulliganReturnGroup(group: ReplayActionGroup): boolean {
  if (group.turn !== 0) {
    return false;
  }
  const firstReturn = group.events.findIndex(isHandToDeckMove);
  return firstReturn >= 0
    && group.events.some((event) => event.kind === 'Shuffle')
    && !group.events.slice(firstReturn).some((event) => event.kind === 'Draw');
}

// The redraw after a shuffle-back: starts with that player's draws and stays
// within mulligan vocabulary (a failed redraw can shuffle back again).
function mulliganRedrawContinues(group: ReplayActionGroup, openGroup: ReplayActionGroup): boolean {
  const player = openGroup.events.find(isHandToDeckMove)?.playerIndex;
  const first = group.events[0];
  return first?.kind === 'Draw' && first.playerIndex === player
    && group.events.every((event) => event.playerIndex === player
      && (event.kind === 'Draw' || event.kind === 'HasBasicPokemon' || event.kind === 'Shuffle' || isHandToDeckMove(event)));
}

function coalesceMulliganGroups(groups: ReplayActionGroup[]): ReplayActionGroup[] {
  const coalesced: ReplayActionGroup[] = [];
  for (const group of groups) {
    const previous = coalesced[coalesced.length - 1];
    if (previous && isMulliganReturnGroup(previous) && mulliganRedrawContinues(group, previous)) {
      previous.events = [...previous.events, ...group.events];
      previous.label = labelForGroup(previous);
      continue;
    }
    coalesced.push({ ...group });
  }
  return coalesced;
}

function isForcedStepGroup(group: ReplayActionGroup): boolean {
  return forcedStepTypes.has(group.type);
}

function frameShowsMainMenu(frame: CabtVisualizeFrame): boolean {
  const select = frame.select as Record<string, unknown> | null | undefined;
  return !!select && selectHasEndOption(select);
}

function mergedGroup(groups: ReplayActionGroup[]): ReplayActionGroup {
  return {
    ...groups[0],
    events: groups.flatMap((group) => group.events),
  };
}

function openStepToReplaySteps(entries: ReplayFrameEntry[], views: GameView[], open: OpenReplayStep): ReplayStep[] {
  const entry = entries[open.endIndex];
  const consumedEntry = entries[open.consumedIndex] ?? entry;
  // Finalize the merged group on the open step so callers that reuse it as
  // projection context see the same event order the step presents.
  const group = groupWithRevealResolutionOrdering(open.group);
  open.group = group;
  // When the open step's own frame was split — forced turn-transition groups
  // (TurnEnd/TurnStart/Checkup) follow the consumed action in the same frame —
  // the raw frame-end view (entry.view) has already applied those later events:
  // the next player's start-of-turn draw, a promotion. Rendering it leaks those
  // cross-boundary events onto this pre-boundary step (the attack step showing
  // the opponent already at 7 cards, then reverting). Pass the forced tail as
  // deferred context so the settled view projects to the open group's end,
  // rebuilding hand/board from the pre-open state. (A multi-frame open step
  // already force-projects via consumedIndex !== endIndex.)
  const forcedTail = open.consumedIndex === open.endIndex
    ? consumedEntry.groups.filter(isForcedStepGroup)
    : [];
  const previousView = views[open.startIndex - 1];

  // A knockout attack resolves as four distinct beats — attack (announce +
  // damage), the knockout(s), the prize draw(s), the promotion(s) — that Charlie
  // wants as separately scrubbable/forkable timeline steps rather than five
  // auto-advancing animation phases inside one step. Split the group at those
  // beat boundaries; every non-knockout action stays a single step (byte-
  // identical to before). The animation phases are computed once against the
  // whole group — the KnockOut/Damage classifiers require the Attack phase to be
  // present in the same pass — then sliced to the beat that owns each one, so a
  // beat's animations still play against the pre-state projected across the
  // earlier beats. Live playback already sequences these as phase views (one
  // clock); this only reshapes the replay step list.
  const beats = attackBeatPartition(
    group,
    animationEventPhases(group.events),
    groupedStepAnimationPhases(previousView, entry.view, [group], 0),
  );
  const contextGroups = beats
    ? [...beats.map((beat) => beat.group), ...forcedTail]
    : [group, ...forcedTail];

  const beatSources = beats
    ? beats.map((beat, beatIndex) => ({ group: beat.group, animationPhases: beat.animationPhases, groupIndex: beatIndex }))
    : [{ group, animationPhases: groupedStepAnimationPhases(previousView, entry.view, [group], 0), groupIndex: 0 }];

  return beatSources.map((source) => replayStepForFrame({
    view: entry.view,
    stateIndex: open.endIndex,
    label: source.group.label,
    type: source.group.type,
    actionTimeline: source.group.events,
    displayView: groupedStepDisplayView(
      previousView,
      consumedEntry.view,
      contextGroups,
      source.groupIndex,
      open.consumedIndex !== open.endIndex || (beats?.length ?? 0) > 1,
    ),
    animationPhases: source.animationPhases,
    payload: {
      events: source.group.events,
      select: entry.frame.select,
      selected: entry.frame.selected,
      action: entry.frame.action,
    },
  }));
}

type AttackBeat = {
  group: ReplayActionGroup;
  animationPhases: ReplayAnimationPhase[] | undefined;
};

type AttackBeatKind = 'attack' | 'ko' | 'prize' | 'promotion';

// Partition a knockout attack's merged group into ordered beats. Returns null
// (no split) for any group without a knockout — a plain attack, a retreat, an
// ability-driven promotion — so those keep their single-step shape. The beat of
// each animation phase is decided by its key against engine emission order:
// everything up to the first KnockOut is the attack beat; KnockOut phases the
// knockout beat; PrizeTake phases the prize beat; a BoardMove after the knockout
// the promotion beat. Empty beats collapse (a knockout that ends the game emits
// no prize/promotion beat).
function attackBeatPartition(
  group: ReplayActionGroup,
  eventPhases: AnimationEventPhase[],
  renderPhases: ReplayAnimationPhase[] | undefined,
): AttackBeat[] | null {
  const firstKnockOut = eventPhases.findIndex((phase) => phase.key.startsWith('KnockOut:'));
  if (firstKnockOut < 0) {
    return null;
  }
  const beatForPhase = (phaseIndex: number): AttackBeatKind => {
    const key = eventPhases[phaseIndex].key;
    if (key.startsWith('KnockOut:')) {
      return 'ko';
    }
    if (key.startsWith('PrizeTake:')) {
      return 'prize';
    }
    if (key.startsWith('BoardMove:') && phaseIndex > firstKnockOut) {
      return 'promotion';
    }
    return 'attack';
  };

  const eventBeat = new Map<ActionTimelineEvent, AttackBeatKind>();
  const phasesByBeat: Record<AttackBeatKind, ReplayAnimationPhase[]> = { attack: [], ko: [], prize: [], promotion: [] };
  eventPhases.forEach((phase, phaseIndex) => {
    const beat = beatForPhase(phaseIndex);
    for (const event of phase.events) {
      eventBeat.set(event, beat);
    }
    const renderPhase = renderPhases?.[phaseIndex];
    if (renderPhase) {
      phasesByBeat[beat].push(renderPhase);
    }
  });

  // Every group event lands in exactly one beat, order preserved; anything the
  // phase pass did not key (a leading event before the Attack) defaults to the
  // attack beat.
  const eventsByBeat: Record<AttackBeatKind, ActionTimelineEvent[]> = { attack: [], ko: [], prize: [], promotion: [] };
  for (const event of group.events) {
    eventsByBeat[eventBeat.get(event) ?? 'attack'].push(event);
  }

  const order: AttackBeatKind[] = ['attack', 'ko', 'prize', 'promotion'];
  const beats: AttackBeat[] = [];
  for (const beat of order) {
    const events = eventsByBeat[beat];
    if (!events.length) {
      continue;
    }
    beats.push({
      group: {
        ...group,
        events,
        type: beat === 'attack' ? group.type : attackBeatType(beat),
        label: beat === 'attack' ? group.label : attackBeatLabel(beat, events, phasesByBeat[beat]),
      },
      animationPhases: phasesByBeat[beat].length ? phasesByBeat[beat] : undefined,
    });
  }
  // A lone attack beat (no distinct consequence beat survived) is not a split.
  return beats.length > 1 ? beats : null;
}

function attackBeatType(beat: AttackBeatKind): string {
  if (beat === 'ko') {
    return 'KnockOut';
  }
  if (beat === 'prize') {
    return 'PrizeTake';
  }
  return 'Promotion';
}

function attackBeatLabel(beat: AttackBeatKind, events: ActionTimelineEvent[], phases: ReplayAnimationPhase[]): string {
  if (beat === 'ko') {
    return knockOutBeatLabel(events);
  }
  if (beat === 'promotion') {
    return promotionBeatLabel(events);
  }
  // Prize beat: reuse the PrizeTake phase label ("took X as a Prize card" /
  // "took N Prize cards").
  return phases[0]?.label ?? events[0]?.message ?? 'Prize card taken.';
}

function knockOutBeatLabel(events: ActionTimelineEvent[]): string {
  const knockOuts = events.filter(isKnockOutEvent);
  const names = knockOuts.map((event) => eventCardName(event));
  const playerIndex = knockOuts[0]?.playerIndex;
  const samePlayer = knockOuts.every((event) => event.playerIndex === playerIndex);
  if (!names.length) {
    return events[0]?.message ?? 'Pokemon Knocked Out.';
  }
  if (names.length === 1) {
    return `${playerLabel(playerIndex)}'s ${names[0]} was Knocked Out.`;
  }
  if (samePlayer && playerIndex !== undefined) {
    return `${playerLabel(playerIndex)}'s ${joinNames(names)} were Knocked Out.`;
  }
  return `${names.length} Pokemon were Knocked Out.`;
}

function promotionBeatLabel(events: ActionTimelineEvent[]): string {
  const promotions = events.filter((event) => {
    const params = event.params as Record<string, unknown> | undefined;
    return isMoveCardKind(event.kind) && isBoardPositionMove(Number(params?.fromArea), Number(params?.toArea));
  });
  const names = promotions.map((event) => eventCardName(event));
  const playerIndex = promotions[0]?.playerIndex;
  const samePlayer = promotions.every((event) => event.playerIndex === playerIndex);
  if (!names.length) {
    return events[0]?.message ?? 'Pokemon promoted to the Active Spot.';
  }
  if (samePlayer && playerIndex !== undefined) {
    return `${playerLabel(playerIndex)} promoted ${joinNames(names)} to the Active Spot.`;
  }
  return `${names.length} Pokemon were promoted to the Active Spot.`;
}

function joinNames(names: string[]): string {
  if (names.length <= 1) {
    return names[0] ?? '';
  }
  if (names.length === 2) {
    return `${names[0]} and ${names[1]}`;
  }
  return `${names.slice(0, -1).join(', ')}, and ${names.at(-1)}`;
}

function stepsForFrameGroups(
  entry: ReplayFrameEntry,
  views: GameView[],
  index: number,
  contextGroups: ReplayActionGroup[],
  startAt: number,
): ReplayStep[] {
  return contextGroups.slice(startAt).map((group, offset) => replayStepForFrame({
    view: entry.view,
    stateIndex: index,
    label: group.label,
    type: group.type,
    actionTimeline: group.events,
    displayView: groupedStepDisplayView(views[index - 1], entry.view, contextGroups, startAt + offset),
    animationPhases: groupedStepAnimationPhases(views[index - 1], entry.view, contextGroups, startAt + offset),
    payload: {
      events: group.events,
      select: entry.frame.select,
      selected: entry.frame.selected,
      action: entry.frame.action,
    },
  }));
}

function fallbackStepForFrame(entry: ReplayFrameEntry, index: number): ReplayStep {
  return replayStepForFrame({
    view: entry.view,
    stateIndex: index,
    label: stepLabel(entry.frame, index),
    type: String(entry.frame.select?.type ?? 'frame'),
    payload: {
      select: entry.frame.select,
      selected: entry.frame.selected,
      action: entry.frame.action,
    },
  });
}

// A reveal effect can put the picked card into the hand before returning the
// rest to the deck. Present returns before takes so the reveal session reads
// the way the table plays out: unpicked cards go back, the picked card lands
// in hand, then the deck shuffles.
function groupWithRevealResolutionOrdering(group: ReplayActionGroup): ReplayActionGroup {
  const takeEvents = group.events.filter((event) => isMoveBetween(event, CabtAreaType.LOOKING, CabtAreaType.HAND));
  if (
    !takeEvents.length
    || !group.events.some((event) => isMoveBetween(event, CabtAreaType.DECK, CabtAreaType.LOOKING))
    || !group.events.some((event) => isMoveBetween(event, CabtAreaType.LOOKING, CabtAreaType.DECK))
  ) {
    return group;
  }
  const shuffleEvents = group.events.filter((event) => event.kind === 'Shuffle');
  const beforeTakeEvents = group.events.filter((event) =>
    event.kind !== 'Shuffle' && !isMoveBetween(event, CabtAreaType.LOOKING, CabtAreaType.HAND));
  return {
    ...group,
    events: [...beforeTakeEvents, ...takeEvents, ...shuffleEvents],
  };
}

function selectHasEndOption(select: Record<string, unknown>): boolean {
  const options = Array.isArray(select.option) ? select.option : [];
  return options.some((option) => {
    const type = (option as Record<string, unknown> | null | undefined)?.type;
    return type === CabtOptionType.END || type === 'End';
  });
}

function isMoveBetween(event: ActionTimelineEvent, fromArea: number, toArea: number): boolean {
  const params = event.params as Record<string, unknown> | undefined;
  return isMoveCardKind(event.kind)
    && Number(params?.fromArea) === fromArea
    && Number(params?.toArea) === toArea;
}

function replayActionGroups(events: ActionTimelineEvent[], turn: number): ReplayActionGroup[] {
  const groups: ReplayActionGroup[] = [];
  let current: ReplayActionGroup | null = null;

  for (const event of events) {
    if (!current || startsReplayGroup(event, current)) {
      current = groupForEvent(event, current, turn);
      groups.push(current);
      continue;
    }
    current.events.push(event);
    current.label = labelForGroup(current);
  }

  return groups;
}

function startsReplayGroup(event: ActionTimelineEvent, current: ReplayActionGroup): boolean {
  const kind = event.kind ?? 'Event';
  if (isChoiceOrPhaseKind(kind)) {
    return true;
  }
  if (isCheckupKind(kind) && current.type === 'TurnEnd') {
    return true;
  }
  if (kind === 'Draw') {
    return current.type !== 'TurnStart'
      && current.type !== 'Draw'
      && !isChoiceConsequenceGroup(current.type);
  }
  if (isMoveCardKind(kind)) {
    return isMoveCardKind(current.type)
      && !sameMoveCardBatch(current.events.at(-1), event)
      && !sameBoardPositionMoveBatch(current.events.at(-1), event);
  }
  if (kind === 'HasBasicPokemon') {
    return current.type !== 'Draw' && current.type !== 'HasBasicPokemon';
  }
  return false;
}

function groupForEvent(event: ActionTimelineEvent, previous: ReplayActionGroup | null, turn: number): ReplayActionGroup {
  const type = isCheckupKind(event.kind) && previous?.type === 'TurnEnd' ? 'PokemonCheckup' : (event.kind ?? 'Event');
  const group = {
    label: event.message,
    type,
    events: [event],
    turn,
  };
  group.label = labelForGroup(group);
  return group;
}

function labelForGroup(group: ReplayActionGroup): string {
  if (group.type === 'PokemonCheckup') {
    return 'Pokemon Checkup.';
  }
  if (group.type === 'Draw') {
    return drawGroupLabel(group.events);
  }
  if (isMoveCardKind(group.type)) {
    return moveCardGroupLabel(group.events, group.turn);
  }
  return group.events[0]?.message ?? 'Event';
}

function isChoiceOrPhaseKind(kind: string): boolean {
  return [
    'Play',
    'Attach',
    'Evolve',
    'Devolve',
    'Ability',
    'Attack',
    'TurnEnd',
    'TurnStart',
    'Result',
  ].includes(kind);
}

function isChoiceConsequenceGroup(type: string): boolean {
  return ['Play', 'Attach', 'Evolve', 'Devolve', 'Ability', 'Attack'].includes(type);
}

function isCheckupKind(kind: string | undefined): boolean {
  return [
    'HPChange',
    'Poisoned',
    'Burned',
    'Asleep',
    'Paralyzed',
    'Confused',
    'Coin',
  ].includes(kind ?? '');
}

function isMoveCardKind(kind: string | undefined): boolean {
  return kind === 'MoveCard' || kind === 'MoveCardReverse';
}

function sameMoveCardBatch(previous: ActionTimelineEvent | undefined, next: ActionTimelineEvent): boolean {
  const previousParams = previous?.params as Record<string, unknown> | undefined;
  const nextParams = next.params as Record<string, unknown> | undefined;
  const fromArea = Number(nextParams?.fromArea);
  const toArea = Number(nextParams?.toArea);
  return previous?.playerIndex === next.playerIndex
    && Number(previousParams?.fromArea) === fromArea
    && Number(previousParams?.toArea) === toArea
    && isBatchedMoveDestination(fromArea, toArea);
}

function isBatchedMoveDestination(fromArea: number, toArea: number): boolean {
  if (toArea === CabtAreaType.ACTIVE || toArea === CabtAreaType.BENCH) {
    return fromArea === CabtAreaType.DECK;
  }
  return !isBoardPositionMove(fromArea, toArea);
}

function sameBoardPositionMoveBatch(previous: ActionTimelineEvent | undefined, next: ActionTimelineEvent): boolean {
  return previous?.playerIndex === next.playerIndex
    && isBoardPositionMoveEvent(previous)
    && isBoardPositionMoveEvent(next);
}

function isBoardPositionMoveEvent(event: ActionTimelineEvent | undefined): boolean {
  const params = event?.params as Record<string, unknown> | undefined;
  return isMoveCardKind(event?.kind) && isBoardPositionMove(Number(params?.fromArea), Number(params?.toArea));
}

function drawGroupLabel(events: ActionTimelineEvent[]): string {
  const drawEvents = events.filter((event) => event.kind === 'Draw');
  if (drawEvents.length === 0) {
    return events[0]?.message ?? 'Draw.';
  }
  if (drawEvents.length === 1 && events.length === 1) {
    return events[0].message;
  }

  const playerIndex = drawEvents[0].playerIndex;
  const samePlayer = drawEvents.every((event) => event.playerIndex === playerIndex);
  if (isMulliganRedrawGroup(events)) {
    if (!samePlayer || playerIndex === undefined) {
      return 'Players redrew opening hands.';
    }
    return `Player ${playerIndex + 1} redrew their opening hand.`;
  }
  if (isOpeningHandGroup(events)) {
    if (!samePlayer || playerIndex === undefined) {
      return 'Players drew opening hands.';
    }
    return `Player ${playerIndex + 1} drew an opening hand.`;
  }
  if (!samePlayer || playerIndex === undefined) {
    return `Players drew ${drawEvents.length} cards.`;
  }
  return `Player ${playerIndex + 1} drew ${drawEvents.length} cards.`;
}

function isOpeningHandGroup(events: ActionTimelineEvent[]): boolean {
  return events.some((event) => event.kind === 'HasBasicPokemon');
}

function isMulliganRedrawGroup(events: ActionTimelineEvent[]): boolean {
  return events.some((event) => event.kind === 'HasBasicPokemon' && (event.params as Record<string, unknown> | undefined)?.hasBasicPokemon === false)
    && events.some((event) => event.kind === 'Shuffle')
    && events.some((event) => {
      const params = event.params as Record<string, unknown> | undefined;
      return event.kind === 'MoveCard'
        && Number(params?.fromArea) === CabtAreaType.HAND
        && Number(params?.toArea) === CabtAreaType.DECK;
    });
}

function moveCardGroupLabel(events: ActionTimelineEvent[], turn: number): string {
  if (events.length === 1) {
    return events[0].message;
  }
  const moveEvents = events.filter((event) => isMoveCardKind(event.kind));
  const firstParams = moveEvents[0]?.params as Record<string, unknown> | undefined;
  const playerIndex = moveEvents[0]?.playerIndex;
  const samePlayer = moveEvents.every((event) => event.playerIndex === playerIndex);
  const allSameMove = moveEvents.every((event) => sameMoveCardBatch(moveEvents[0], event));
  if (
    samePlayer
    && playerIndex !== undefined
    && allSameMove
    && Number(firstParams?.fromArea) === CabtAreaType.DECK
    && Number(firstParams?.toArea) === CabtAreaType.PRIZE
  ) {
    if (turn === 0) {
      return `Player ${playerIndex + 1} set ${moveEvents.length} Prize cards.`;
    }
    return `Player ${playerIndex + 1} put ${moveEvents.length} cards from deck into their Prize cards.`;
  }
  if (
    samePlayer
    && playerIndex !== undefined
    && allSameMove
    && Number(firstParams?.fromArea) === CabtAreaType.HAND
    && Number(firstParams?.toArea) === CabtAreaType.DECK
    && events.some((event) => event.kind === 'Shuffle')
  ) {
    if (turn === 0) {
      if (events.some((event) => event.kind === 'Draw')) {
        return `Player ${playerIndex + 1} redrew their opening hand.`;
      }
      return `Player ${playerIndex + 1} shuffled their opening hand into their deck.`;
    }
    return `Player ${playerIndex + 1} shuffled ${moveEvents.length} cards from hand into their deck.`;
  }
  if (
    samePlayer
    && playerIndex !== undefined
    && allSameMove
    && Number(firstParams?.fromArea) === CabtAreaType.PRIZE
    && Number(firstParams?.toArea) === CabtAreaType.HAND
  ) {
    return `Player ${playerIndex + 1} took ${moveEvents.length} Prize cards.`;
  }
  return events[0].message;
}

function replayStepForFrame({
  view,
  stateIndex,
  label,
  type,
  payload,
  actionTimeline,
  displayView,
  animationPhases,
}: {
  view: GameView;
  stateIndex: number;
  label: string;
  type: string;
  payload: unknown;
  actionTimeline?: ReplayStep['actionTimeline'];
  displayView?: ReplayStep['displayView'];
  animationPhases?: ReplayStep['animationPhases'];
}): ReplayStep {
  const stepLabel = persistentActionLabel(label, actionTimeline);
  return {
    index: 0,
    label: stepLabel,
    stateIndex,
    actionIndex: null,
    sequence: stateIndex,
    turn: view.turn,
    phase: view.phase,
    activePlayerIndex: view.activePlayerIndex,
    type,
    payload,
    actionTimeline,
    displayView,
    animationPhases,
  };
}

function persistentActionLabel(label: string, events: ReplayStep['actionTimeline']): string {
  if (!events || events.length < 2) {
    return label;
  }
  const playEvent = events.find((event) => event.kind === 'Play');
  if (!playEvent) {
    return label;
  }
  const phases = animationEventPhases(events);
  const hasEffectPhase = phases.some((phase) =>
    phase.key.startsWith('HandToDeck:')
    || phase.key.startsWith('DeckDiscard:')
    || phase.key.startsWith('DeckReveal:')
    || phase.key.startsWith('DeckSearchReveal:')
    || phase.key.startsWith('DeckBoardPlace:')
    || phase.key.startsWith('DeckRevealReturn:')
    || phase.key.startsWith('DeckRevealTake:')
    || phase.key.startsWith('Draw:')
  );
  if (!hasEffectPhase) {
    return label;
  }

  const playerIndex = playEvent.playerIndex;
  const actor = playerLabel(playerIndex);
  const playedCard = eventCardName(playEvent);
  const clauses = [`played ${playedCard}`];
  let handToDeckWasSummarized = false;

  for (const phase of phases) {
    if (phase.key.startsWith('Play:')) {
      continue;
    }
    const count = phase.events.filter((event) => animationPhaseKey(event) === phase.key).length;
    if (phase.key.startsWith('HandToDeck:')) {
      clauses.push(`shuffled ${count} ${plural(count, 'card')} from hand into their deck`);
      handToDeckWasSummarized = true;
      continue;
    }
    if (phase.key.startsWith('Draw:')) {
      clauses.push(`drew ${count} ${plural(count, 'card')}`);
      continue;
    }
    if (phase.key.startsWith('DeckSearchReveal:')) {
      clauses.push(count === 1
        ? 'revealed a card from their deck and put it into their hand'
        : `revealed ${count} cards from their deck and put them into their hand`);
      continue;
    }
    if (phase.key.startsWith('DeckBoardPlace:')) {
      clauses.push(count === 1
        ? 'put a Pokemon from their deck onto the board'
        : `put ${count} Pokemon from their deck onto the board`);
      continue;
    }
    if (phase.key.startsWith('DeckRevealReturn:')) {
      clauses.push(`returned ${count} revealed ${plural(count, 'card')} to their deck`);
      continue;
    }
    if (phase.key.startsWith('DeckRevealTake:')) {
      clauses.push(count === 1
        ? 'put a revealed card into their hand'
        : `put ${count} revealed cards into their hand`);
      continue;
    }
    if (phase.key.startsWith('DeckReveal:')) {
      clauses.push(`revealed the top ${count} ${plural(count, 'card')} of their deck`);
      continue;
    }
    if (phase.key.startsWith('DeckDiscard:')) {
      clauses.push(`discarded ${count} ${plural(count, 'card')} from their deck`);
      continue;
    }
    if (phase.key.startsWith('Attach:')) {
      clauses.push(...phase.events
        .filter((event) => animationPhaseKey(event) === phase.key)
        .map((event) => eventMessageWithoutActor(event, actor)));
      continue;
    }
    if (phase.key.startsWith('Shuffle:') && !handToDeckWasSummarized) {
      clauses.push('shuffled their deck');
    }
  }

  return `${actor} ${joinClauses(clauses)}.`;
}

function eventCardName(event: ActionTimelineEvent): string {
  const params = event.params as Record<string, unknown> | undefined;
  return cardName(Number(params?.cardId));
}

function eventMessageWithoutActor(event: ActionTimelineEvent, actor: string): string {
  const text = event.message.replace(/\.$/, '');
  const withoutActor = text.startsWith(`${actor} `) ? text.slice(actor.length + 1) : text;
  return withoutActor.charAt(0).toLowerCase() + withoutActor.slice(1);
}

function joinClauses(clauses: string[]): string {
  if (clauses.length <= 1) {
    return clauses[0] ?? '';
  }
  if (clauses.length === 2) {
    return `${clauses[0]} and ${clauses[1]}`;
  }
  return `${clauses.slice(0, -1).join(', ')}, and ${clauses.at(-1)}`;
}

function groupedStepDisplayView(
  previousView: GameView | undefined,
  currentView: GameView,
  groups: ReplayActionGroup[],
  groupIndex: number,
  forceProjection = false,
): GameView | undefined {
  const group = groups[groupIndex];
  if (!previousView || !group) {
    return undefined;
  }
  const needsProjection = forceProjection || groups.length >= 2 || shouldProjectSingleGroup(currentView, group);
  if (!needsProjection) {
    return undefined;
  }

  const players = currentView.players.map((currentPlayer, playerIndex) => {
    const previousPlayer = previousView.players[playerIndex];
    if (!previousPlayer) {
      return currentPlayer;
    }
    return {
      ...currentPlayer,
      hand: [...previousPlayer.hand],
      deckCount: previousPlayer.deckCount,
      prizesLeft: previousPlayer.prizesLeft,
      active: previousPlayer.active,
      bench: previousPlayer.bench,
      discard: previousPlayer.discard,
      playZone: previousPlayer.playZone,
    };
  });
  const view: GameView = {
    ...currentView,
    players,
  };

  for (const group of groups.slice(0, groupIndex + 1)) {
    for (const event of group.events) {
      applyReplayEvent(view, currentView, event);
    }
  }

  // A board-state event in this group (e.g. a Special Energy attach) syncs the
  // whole board to the frame's end state, which includes Pokemon that a LATER
  // group of this frame places from the deck. Hold those arrivals off this
  // step's settled board so they don't flash in before their placement step.
  const laterGroupEvents = groups.slice(groupIndex + 1).flatMap((later) => later.events);
  return gameViewWithDeferredBoardArrivals(view, laterGroupEvents);
}

function groupedStepAnimationPhases(
  previousView: GameView | undefined,
  currentView: GameView,
  groups: ReplayActionGroup[],
  groupIndex: number,
): ReplayAnimationPhase[] | undefined {
  const group = groups[groupIndex];
  if (!previousView || !group) {
    return undefined;
  }
  const eventPhases = animationEventPhases(group.events);
  if (eventPhases.length <= 1 && !eventPhases.some(animationPhaseNeedsDedicatedView)) {
    return undefined;
  }

  let phaseStartView = projectedViewForEvents(previousView, currentView, groups.slice(0, groupIndex).flatMap((item) => item.events));
  const phases: ReplayAnimationPhase[] = [];
  for (const phase of eventPhases) {
    // Cards dumped from hand land on top of the discard, so the pile keeps
    // showing its previous top card while the sprites are in flight.
    const handToDiscardPhase = phase.key.startsWith('HandMove:') && phase.key.endsWith(`:${CabtAreaType.DISCARD}`);
    const projectedView = phase.usesSourceView
      ? animationSourceViewForPhase(phaseStartView, currentView, phase)
      : projectedViewForEvents(phaseStartView, currentView, phase.events, handToDiscardPhase ? { deferDiscardArrivals: true } : {});
    // Board-state events sync whole slots to the step's end state, which
    // would show energy/tool badges — and Pokemon that later phases place onto
    // the board — before their own phase plays. A Special Energy attach whose
    // effect benches Pokemon from the deck is the canonical case: the Attach
    // handler copies the end-state bench, flashing the incoming Pokemon during
    // the attach phase before the deck-placement phase animates them in. Strip
    // both the future attachments and the future board arrivals of this step.
    const futureEvents = eventPhases.slice(eventPhases.indexOf(phase) + 1).flatMap((later) => later.events);
    const phaseView = gameViewWithDeferredBoardArrivals(
      gameViewWithDeferredAttachments(projectedView, futureEvents),
      futureEvents,
    );
    phases.push({
      key: phase.key,
      label: animationPhaseLabel(phase),
      view: {
        ...phaseView,
        actionTimeline: phase.events,
      },
      actionTimeline: phase.events,
      durationMs: phase.durationMs + attachPhaseExtraMs(phase, phaseStartView),
    });
    phaseStartView = projectedViewForEvents(phaseStartView, currentView, phase.events);
  }
  return phases;
}

type AnimationEventPhase = {
  key: string;
  events: ActionTimelineEvent[];
  durationMs: number;
  usesSourceView: boolean;
};

function animationEventPhases(events: ActionTimelineEvent[]): AnimationEventPhase[] {
  const phases: AnimationEventPhase[] = [];
  for (const event of events) {
    const key = animationPhaseKeyForReplayEvent(event, phases);
    if (!key) {
      const last = phases.at(-1);
      if (last) {
        last.events.push(event);
      }
      continue;
    }
    const last = phases.at(-1);
    if (last && last.key === key && shouldContinueAnimationPhase(last, event)) {
      last.events.push(event);
      last.durationMs = animationPhaseDurationMs(key, last.events.length);
      continue;
    }
    phases.push({
      key,
      events: [event],
      durationMs: animationPhaseDurationMs(key, 1),
      usesSourceView: animationPhaseUsesSourceView(key),
    });
  }
  return phases.filter((phase) => phase.events.some((event) => animationPhaseKey(event)));
}

function shouldContinueAnimationPhase(phase: AnimationEventPhase, event: ActionTimelineEvent): boolean {
  const previousEvent = phase.events.at(-1);
  if (!isMoveCardKind(previousEvent?.kind) || !isMoveCardKind(event.kind)) {
    return true;
  }
  return sameMoveCardBatch(previousEvent, event) || sameBoardPositionMoveBatch(previousEvent, event);
}

function animationPhaseKeyForReplayEvent(event: ActionTimelineEvent, phases: AnimationEventPhase[]): string | null {
  const key = animationPhaseKey(event);
  if (!key) {
    return null;
  }
  if (key.startsWith('Damage:') && !phases.some((phase) => phase.key.startsWith('Attack:'))) {
    return null;
  }
  if (key.startsWith('KnockOut:') && !phases.some((phase) => phase.key.startsWith('Attack:'))) {
    return null;
  }
  if (key.startsWith('AttachedMove:') && phases.some((phase) => phase.key.startsWith('KnockOut:'))) {
    return null;
  }
  return key;
}

function animationPhaseLabel(phase: AnimationEventPhase): string | undefined {
  const event = phase.events.find((candidate) => animationPhaseKey(candidate));
  if (!event) {
    return undefined;
  }
  const actor = playerLabel(event.playerIndex);
  const cardEventCount = phase.events.filter((candidate) => animationPhaseKey(candidate) === phase.key).length;

  if (
    phase.key.startsWith('Play:')
    || phase.key.startsWith('Attach:')
    || phase.key.startsWith('Evolve:')
    || phase.key.startsWith('Shuffle:')
    || phase.key.startsWith('Attack:')
    || phase.key.startsWith('Damage:')
    || phase.key.startsWith('KnockOut:')
  ) {
    return event.message;
  }
  if (phase.key.startsWith('HandToDeck:')) {
    return `${actor} put ${cardEventCount} ${plural(cardEventCount, 'card')} from hand into their deck.`;
  }
  if (phase.key.startsWith('Draw:')) {
    return cardEventCount === 1 ? event.message : `${actor} drew ${cardEventCount} cards.`;
  }
  if (phase.key.startsWith('DeckDiscard:')) {
    return cardEventCount === 1 ? event.message : `${actor} discarded ${cardEventCount} cards from the deck.`;
  }
  if (phase.key.startsWith('DeckRevealReturn:')) {
    return `${actor} returned ${cardEventCount} revealed ${plural(cardEventCount, 'card')} to their deck.`;
  }
  if (phase.key.startsWith('DeckRevealTake:')) {
    return cardEventCount === 1
      ? event.message
      : `${actor} put ${cardEventCount} revealed cards into their hand.`;
  }
  if (phase.key.startsWith('PrizeTake:')) {
    return cardEventCount === 1 ? event.message : `${actor} took ${cardEventCount} Prize cards.`;
  }
  if (phase.key.startsWith('DeckSearchReveal:')) {
    return cardEventCount === 1
      ? `${actor} revealed a card from their deck and put it into their hand.`
      : `${actor} revealed ${cardEventCount} cards from their deck and put them into their hand.`;
  }
  if (phase.key.startsWith('DeckBoardPlace:')) {
    return cardEventCount === 1
      ? event.message
      : `${actor} put ${cardEventCount} Pokemon from their deck onto the board.`;
  }
  if (phase.key.startsWith('DeckReveal:')) {
    return `${actor} revealed the top ${cardEventCount} ${plural(cardEventCount, 'card')} of their deck.`;
  }
  return event.message;
}

function playerLabel(playerIndex: number | undefined): string {
  return playerIndex === undefined ? 'Game' : `Player ${playerIndex + 1}`;
}

function plural(count: number, singular: string): string {
  return count === 1 ? singular : `${singular}s`;
}

function animationPhaseKey(event: ActionTimelineEvent): string | null {
  const params = event.params as Record<string, unknown> | undefined;
  const fromArea = Number(params?.fromArea);
  const toArea = Number(params?.toArea);
  const playerKey = event.playerIndex ?? 'unknown';

  if (event.kind === 'Play' || event.kind === 'Attach' || event.kind === 'Evolve') {
    return `${event.kind}:${playerKey}`;
  }
  if (event.kind === 'Attack') {
    return `Attack:${playerKey}`;
  }
  if (event.kind === 'Ability') {
    return `Ability:${playerKey}`;
  }
  // A TurnEnd only earns its own phase key when it's flagged for the Pass
  // announce (markPassAnnounceEvents) — an ordinary TurnEnd (a turn that
  // ended via an attack) keeps NO key, so it silently rides the previous
  // phase's events as before. This narrow key exists solely so a bundled
  // live observation (TurnEnd+TurnStart+Draw in one batch) doesn't drop the
  // Pass-flagged TurnEnd when segmenting at the turn boundary — see
  // stepAnimationPhases' single-phase-segment fallback.
  if (event.kind === 'TurnEnd') {
    return (params?.passAnnounce ? `Pass:${playerKey}` : null);
  }
  if (event.kind === 'Switch') {
    return `BoardMove:${playerKey}`;
  }
  if (event.kind === 'HPChange') {
    return `Damage:${playerKey}`;
  }
  if (event.kind === 'Coin') {
    return `Coin:${playerKey}`;
  }
  // Reversed kinds are the live concealed-seat encoding of the same moves;
  // replay never emits them. They classify identically — a hidden hand→deck
  // is still a HandToDeck beat.
  if (isMoveCardKind(event.kind)) {
    if (isBoardPositionMove(fromArea, toArea)) {
      return `BoardMove:${playerKey}`;
    }
    if (isBoardToDeckMove(fromArea, toArea)) {
      return `BoardToDeck:${playerKey}`;
    }
    if (isKnockOutMove(fromArea, toArea)) {
      return `KnockOut:${playerKey}`;
    }
    if (fromArea === CabtAreaType.HAND && toArea === CabtAreaType.DECK) {
      return `HandToDeck:${playerKey}`;
    }
    if (fromArea === CabtAreaType.HAND) {
      return `HandMove:${playerKey}:${toArea}`;
    }
    if (fromArea === CabtAreaType.DECK && toArea === CabtAreaType.DISCARD) {
      return `DeckDiscard:${playerKey}`;
    }
    if (fromArea === CabtAreaType.DECK && toArea === CabtAreaType.LOOKING) {
      return `DeckReveal:${playerKey}`;
    }
    if (fromArea === CabtAreaType.DECK && toArea === CabtAreaType.HAND) {
      return `DeckSearchReveal:${playerKey}`;
    }
    if (fromArea === CabtAreaType.DECK && (toArea === CabtAreaType.ACTIVE || toArea === CabtAreaType.BENCH)) {
      return `DeckBoardPlace:${playerKey}`;
    }
    if (fromArea === CabtAreaType.LOOKING && toArea === CabtAreaType.DECK) {
      return `DeckRevealReturn:${playerKey}`;
    }
    if (fromArea === CabtAreaType.LOOKING && toArea === CabtAreaType.HAND) {
      return `DeckRevealTake:${playerKey}`;
    }
    if (fromArea === CabtAreaType.PRIZE && toArea === CabtAreaType.HAND) {
      return `PrizeTake:${playerKey}`;
    }
    if (isAttachedCardArea(fromArea) && isAttachedCardMoveDestination(toArea)) {
      return `AttachedMove:${playerKey}:${fromArea}->${toArea}`;
    }
    if (fromArea === CabtAreaType.STADIUM && toArea === CabtAreaType.DISCARD) {
      return `StadiumMove:${playerKey}:${fromArea}->${toArea}`;
    }
  }
  if (event.kind === 'Shuffle') {
    return `Shuffle:${playerKey}`;
  }
  if (event.kind === 'Draw' || event.kind === 'DrawReverse') {
    return `Draw:${playerKey}`;
  }
  return null;
}

function animationPhaseUsesSourceView(key: string): boolean {
  return key.startsWith('HandToDeck:')
    || key.startsWith('Evolve:')
    || key.startsWith('Ability:')
    || key.startsWith('Attack:')
    || key.startsWith('Damage:')
    || key.startsWith('KnockOut:')
    || key.startsWith('PrizeTake:')
    || key.startsWith('BoardToDeck:')
    || key.startsWith('BoardMove:')
    || key.startsWith('AttachedMove:')
    || key.startsWith('StadiumMove:');
}

function animationPhaseNeedsDedicatedView(phase: AnimationEventPhase): boolean {
  return phase.key.startsWith('Evolve:')
    || phase.key.startsWith('Ability:')
    || phase.key.startsWith('Attack:')
    || phase.key.startsWith('Pass:')
    || phase.key.startsWith('Damage:')
    || phase.key.startsWith('KnockOut:')
    || phase.key.startsWith('BoardToDeck:')
    || phase.key.startsWith('BoardMove:')
    || phase.key.startsWith('AttachedMove:')
    || phase.key.startsWith('StadiumMove:');
}

function animationSourceViewForPhase(
  phaseStartView: GameView,
  currentView: GameView,
  phase: AnimationEventPhase,
): GameView {
  if (phase.key.startsWith('Evolve:')) {
    return projectedViewForEvents(phaseStartView, currentView, phase.events, { deferBoardStateEvents: true });
  }
  if (phase.key.startsWith('Ability:') || phase.key.startsWith('Attack:') || phase.key.startsWith('Damage:')) {
    return projectedViewForEvents(phaseStartView, currentView, phase.events, { deferBoardStateEvents: true });
  }
  if (phase.key.startsWith('KnockOut:')) {
    return projectedViewForEvents(phaseStartView, currentView, phase.events, { deferMoveCardEvents: true });
  }
  if (phase.key.startsWith('HandToDeck:')) {
    // animationPhaseUsesSourceView lists HandToDeck, but without a branch here it
    // fell through to phaseStartView — leaving the departing cards in the hand
    // for the whole phase. Unlike a board departure, a hand-reset sprite flies
    // from a pre-phase hand SNAPSHOT (ViewportAnimationLayer captures the rects),
    // not the live slot, so the view can drop the cards at display time. Apply
    // the HAND->DECK moves immediately: the static hand cards leave when the
    // sprites launch, instead of staying hidden until the next phase boundary
    // and flashing back when their claim releases in the same tick they're
    // finally removed. Mirrors the live path, which has already removed them.
    return projectedViewForEvents(phaseStartView, currentView, phase.events);
  }
  if (phase.key.startsWith('BoardToDeck:')) {
    return projectedViewForEvents(phaseStartView, currentView, phase.events, { deferMoveCardEvents: true });
  }
  if (phase.key.startsWith('BoardMove:')) {
    const source = boardMoveSourceView(
      projectedViewForEvents(phaseStartView, currentView, phase.events, {
        deferBoardStateEvents: true,
        deferMoveCardEvents: true,
      }),
      phaseStartView,
      currentView,
    );
    // A composition-changing promotion (a bench Pokemon moves into an empty
    // active spot, with no reciprocal active->bench in the phase) vacates its
    // bench slot at flight LAUNCH so the surviving bench re-centers DURING the
    // ~520ms flight — one settle beat, not the two-stage "card lands, then the
    // bench slides" compression Charlie flagged (#34). A swap (retreat, Boss's
    // Orders, Teleport) keeps both cards at their source slots so the crossing
    // animates and the bench composition is unchanged — left untouched. The anim
    // layer's board-move sprite must snapshot the source rect before this view
    // vacates the slot; that companion lives in BoardAnimationLayer.
    return isPromotionVacatePhase(phase) ? benchVacatedForPromotion(source, phase) : source;
  }
  if (phase.key.startsWith('AttachedMove:')) {
    return projectedViewForEvents(phaseStartView, currentView, phase.events, { deferMoveCardEvents: true });
  }
  if (phase.key.startsWith('StadiumMove:')) {
    return projectedViewForEvents(phaseStartView, currentView, phase.events, { deferMoveCardEvents: true });
  }
  return phaseStartView;
}

// True when a BoardMove phase promotes a bench Pokemon into an empty active spot
// with no reciprocal active->bench move — i.e. the bench shrinks (a KO or
// ability-vacate promotion), as opposed to a swap (retreat / Boss's Orders /
// Teleport) where a card returns to the bench and its composition is unchanged.
// A BoardMove phase batches only same-player board-position moves, so this reads
// the whole phase without grouping by owner.
function isPromotionVacatePhase(phase: AnimationEventPhase): boolean {
  let promotes = false;
  for (const event of phase.events) {
    if (!isMoveCardKind(event.kind)) {
      continue;
    }
    const params = event.params as Record<string, unknown> | undefined;
    const fromArea = Number(params?.fromArea);
    const toArea = Number(params?.toArea);
    if (fromArea === CabtAreaType.ACTIVE && toArea === CabtAreaType.BENCH) {
      return false;
    }
    if (fromArea === CabtAreaType.BENCH && toArea === CabtAreaType.ACTIVE) {
      promotes = true;
    }
  }
  return promotes;
}

// Remove the promoted Pokemon from the bench of a promotion source view so the
// surviving bench is already compacted (occupied slots forward, empties back) —
// the settled bench, shown while the promotion sprite is still in flight. The
// phase's currentView predates the promotion frame, so the promoted card can't
// be dropped by copying the end-state bench (it is still on it there); it is
// removed explicitly by the serial(s) the BENCH->ACTIVE move(s) name.
function benchVacatedForPromotion(view: GameView, phase: AnimationEventPhase): GameView {
  const promotedByPlayer = new Map<number, Set<number>>();
  for (const event of phase.events) {
    const params = event.params as Record<string, unknown> | undefined;
    if (!isMoveCardKind(event.kind)
      || Number(params?.fromArea) !== CabtAreaType.BENCH
      || Number(params?.toArea) !== CabtAreaType.ACTIVE) {
      continue;
    }
    const serial = Number(params?.serial);
    if (event.playerIndex === undefined || !Number.isFinite(serial)) {
      continue;
    }
    const serials = promotedByPlayer.get(event.playerIndex) ?? new Set<number>();
    serials.add(serial);
    promotedByPlayer.set(event.playerIndex, serials);
  }
  if (!promotedByPlayer.size) {
    return view;
  }
  return {
    ...view,
    players: view.players.map((player, playerIndex) => {
      const promoted = promotedByPlayer.get(playerIndex);
      if (!promoted) {
        return player;
      }
      const isPromoted = (slot: PokemonSlotView) =>
        slot.pokemon?.serial !== undefined && promoted.has(slot.pokemon.serial);
      const occupied = player.bench.filter((slot) => !!slot.pokemon && !isPromoted(slot));
      const empties = player.bench
        .filter((slot) => !slot.pokemon || isPromoted(slot))
        .map((slot) => (isPromoted(slot) ? emptyBenchSlot(slot) : slot));
      return { ...player, bench: [...occupied, ...empties] };
    }),
  };
}

// A bench slot emptied by a departure, keeping its slot identity so the row
// renders an empty tile at the back rather than the promoted card.
function emptyBenchSlot(slot: PokemonSlotView): PokemonSlotView {
  return {
    ...slot,
    empty: true,
    pokemon: undefined,
    cards: [],
    damage: 0,
    hp: 0,
    retreat: [],
    energy: [],
    tools: [],
    specialConditions: [],
  };
}

function boardMoveSourceView(sourceView: GameView, phaseStartView: GameView, currentView: GameView): GameView {
  return {
    ...sourceView,
    players: sourceView.players.map((player, playerIndex) => {
      const phaseStartPlayer = phaseStartView.players[playerIndex];
      const currentPlayer = currentView.players[playerIndex];
      if (!phaseStartPlayer || !currentPlayer) {
        return player;
      }
      return {
        ...player,
        discard: mergedKnownCards(phaseStartPlayer.discard, currentPlayer.discard),
        playZone: mergedKnownCards(phaseStartPlayer.playZone, currentPlayer.playZone),
      };
    }),
  };
}

function mergedKnownCards(left: CardView[], right: CardView[]): CardView[] {
  return [
    ...left,
    ...right.filter((card) => !left.some((existing) => sameKnownCard(existing, card))),
  ];
}

function gameViewWithDeferredAttachments(view: GameView, futureEvents: ActionTimelineEvent[]): GameView {
  const serials = new Set(futureEvents
    .filter((event) => {
      const params = event.params as Record<string, unknown> | undefined;
      const toArea = Number(params?.toArea);
      return event.kind === 'Attach'
        || (isMoveCardKind(event.kind) && (toArea === CabtAreaType.ENERGY || toArea === CabtAreaType.TOOL));
    })
    .map((event) => Number((event.params as Record<string, unknown> | undefined)?.serial))
    .filter((serial) => Number.isFinite(serial)));
  if (!serials.size) {
    return view;
  }
  const stripSlot = (slot: PokemonSlotView): PokemonSlotView => ({
    ...slot,
    energy: slot.energy.filter((card) => card.serial === undefined || !serials.has(card.serial)),
    tools: slot.tools.filter((card) => card.serial === undefined || !serials.has(card.serial)),
  });
  return {
    ...view,
    players: view.players.map((player) => ({
      ...player,
      active: stripSlot(player.active),
      bench: player.bench.map(stripSlot),
    })),
  };
}

// The Pokemon-placement counterpart of gameViewWithDeferredAttachments: empty
// any board slot currently holding a Pokemon that ARRIVES onto the board in a
// later phase of this step (a deck search, an on-attach effect, etc.), so the
// slot stays in its pre-arrival state until that phase animates the Pokemon in.
// Board-to-board repositions (Switch/retreat) animate in their own dedicated
// view and are excluded — only off-board arrivals are held back.
function gameViewWithDeferredBoardArrivals(view: GameView, futureEvents: ActionTimelineEvent[]): GameView {
  const serials = new Set(futureEvents
    .filter((event) => {
      if (!isMoveCardKind(event.kind)) {
        return false;
      }
      const params = event.params as Record<string, unknown> | undefined;
      const fromArea = Number(params?.fromArea);
      const toArea = Number(params?.toArea);
      return (toArea === CabtAreaType.ACTIVE || toArea === CabtAreaType.BENCH)
        && fromArea !== CabtAreaType.ACTIVE
        && fromArea !== CabtAreaType.BENCH;
    })
    .map((event) => Number((event.params as Record<string, unknown> | undefined)?.serial))
    .filter((serial) => Number.isFinite(serial)));
  if (!serials.size) {
    return view;
  }
  const holdSlot = (slot: PokemonSlotView): PokemonSlotView =>
    slot.pokemon?.serial !== undefined && serials.has(slot.pokemon.serial)
      ? { ...slot, empty: true, pokemon: undefined, cards: [], damage: 0, hp: 0, retreat: [], energy: [], tools: [] }
      : slot;
  return {
    ...view,
    players: view.players.map((player) => ({
      ...player,
      active: holdSlot(player.active),
      bench: player.bench.map(holdSlot),
    })),
  };
}

// Hand/deck sourced attachments finish with attach-under after their departure
// motion, so the phase keeps owning the visual until that handoff completes.
function attachPhaseExtraMs(phase: AnimationEventPhase, phaseStartView: GameView): number {
  if (!phase.key.startsWith('Attach:')) {
    return 0;
  }
  const attachEvents = phase.events.filter((event) => event.kind === 'Attach');
  if (!attachEvents.length) {
    return 0;
  }
  const fromHand = attachEvents.some((event) => {
    const serial = Number((event.params as Record<string, unknown> | undefined)?.serial);
    return Number.isFinite(serial)
      && phaseStartView.players.some((player) => player.hand.some((card) => card.serial === serial));
  });
  return fromHand ? actionAnimationTiming.handMoveMs : actionAnimationTiming.deckRevealMs;
}

function animationPhaseDurationMs(key: string, count: number): number {
  const durationMs = animationPhaseCardDurationMs(key);
  const stepMs = animationPhaseStepMs(key);
  return count <= 0 ? 0 : durationMs + Math.max(0, count - 1) * stepMs;
}

function animationPhaseCardDurationMs(key: string): number {
  if (key.startsWith('Shuffle:')) {
    return actionAnimationTiming.deckShuffleMs;
  }
  if (key.startsWith('Draw:')) {
    return actionAnimationTiming.deckDrawMs;
  }
  if (key.startsWith('DeckDiscard:')) {
    return actionAnimationTiming.deckDiscardMs;
  }
  if (key.startsWith('DeckReveal:')) {
    return actionAnimationTiming.deckRevealMs;
  }
  if (key.startsWith('DeckSearchReveal:')) {
    return actionAnimationTiming.deckRevealMs;
  }
  if (key.startsWith('DeckBoardPlace:')) {
    return actionAnimationTiming.boardMoveMs;
  }
  if (key.startsWith('DeckRevealReturn:')) {
    return actionAnimationTiming.deckRevealReturnMs;
  }
  if (key.startsWith('DeckRevealTake:')) {
    return actionAnimationTiming.handMoveMs;
  }
  if (key.startsWith('PrizeTake:')) {
    return actionAnimationTiming.prizeTakeMs;
  }
  if (key.startsWith('AttachedMove:')) {
    return actionAnimationTiming.handMoveMs;
  }
  if (key.startsWith('StadiumMove:')) {
    return actionAnimationTiming.stadiumMoveMs;
  }
  if (key.startsWith('Evolve:')) {
    return actionAnimationTiming.evolveMs;
  }
  if (key.startsWith('Attack:')) {
    return actionAnimationTiming.attackAnnounceMs;
  }
  if (key.startsWith('Ability:')) {
    return actionAnimationTiming.abilityAnnounceMs;
  }
  if (key.startsWith('Pass:')) {
    return actionAnimationTiming.attackAnnounceMs;
  }
  if (key.startsWith('Damage:')) {
    return actionAnimationTiming.damageMs;
  }
  if (key.startsWith('Coin:')) {
    return actionAnimationTiming.coinFlipMs;
  }
  if (key.startsWith('KnockOut:')) {
    return actionAnimationTiming.knockOutMs;
  }
  if (key.startsWith('BoardToDeck:')) {
    return actionAnimationTiming.boardMoveMs;
  }
  if (key.startsWith('BoardMove:')) {
    return actionAnimationTiming.boardMoveMs;
  }
  return actionAnimationTiming.handMoveMs;
}

function animationPhaseStepMs(key: string): number {
  if (key.startsWith('Draw:')) {
    return actionAnimationTiming.deckDrawStepMs;
  }
  if (key.startsWith('DeckDiscard:')) {
    return actionAnimationTiming.deckDiscardStepMs;
  }
  if (key.startsWith('DeckReveal:')) {
    return actionAnimationTiming.deckRevealStepMs;
  }
  if (key.startsWith('DeckSearchReveal:')) {
    return actionAnimationTiming.deckRevealStepMs;
  }
  if (key.startsWith('DeckBoardPlace:')) {
    return actionAnimationTiming.handMoveStepMs;
  }
  if (key.startsWith('DeckRevealReturn:')) {
    return actionAnimationTiming.deckRevealReturnStepMs;
  }
  if (key.startsWith('DeckRevealTake:')) {
    return actionAnimationTiming.handMoveStepMs;
  }
  if (key.startsWith('PrizeTake:')) {
    return actionAnimationTiming.prizeTakeStepMs;
  }
  if (key.startsWith('AttachedMove:')) {
    return actionAnimationTiming.handMoveStepMs;
  }
  if (key.startsWith('StadiumMove:')) {
    return actionAnimationTiming.handMoveStepMs;
  }
  if (key.startsWith('Shuffle:')) {
    return actionAnimationTiming.deckShuffleMs;
  }
  if (key.startsWith('Attack:')) {
    return actionAnimationTiming.attackAnnounceMs;
  }
  if (key.startsWith('Ability:')) {
    return actionAnimationTiming.abilityAnnounceMs;
  }
  if (key.startsWith('Pass:')) {
    return actionAnimationTiming.attackAnnounceMs;
  }
  if (key.startsWith('Damage:')) {
    return 0;
  }
  if (key.startsWith('Coin:')) {
    return actionAnimationTiming.coinFlipStepMs;
  }
  if (key.startsWith('KnockOut:')) {
    return actionAnimationTiming.knockOutMs;
  }
  if (key.startsWith('BoardToDeck:')) {
    return actionAnimationTiming.handMoveStepMs;
  }
  if (key.startsWith('BoardMove:')) {
    return 0;
  }
  return actionAnimationTiming.handMoveStepMs;
}

function projectedViewForEvents(
  baseView: GameView,
  currentView: GameView,
  events: ActionTimelineEvent[],
  options: ProjectionOptions = {},
): GameView {
  const view: GameView = {
    ...currentView,
    players: currentView.players.map((currentPlayer, playerIndex) => {
      const basePlayer = baseView.players[playerIndex] ?? currentPlayer;
      return {
        ...currentPlayer,
        hand: [...basePlayer.hand],
        deckCount: basePlayer.deckCount,
        prizesLeft: basePlayer.prizesLeft,
        active: basePlayer.active,
        bench: basePlayer.bench,
        discard: basePlayer.discard,
        stadium: basePlayer.stadium,
        playZone: basePlayer.playZone,
      };
    }),
  };

  for (const event of events) {
    applyReplayEvent(view, currentView, event, options);
  }
  return view;
}

type ResolvingPlayedCard = {
  playerIndex: number;
  card: CardView;
};

function applyResolvingPlayedCards(steps: ReplayStep[], views: GameView[]): void {
  let resolving: ResolvingPlayedCard[] = [];

  for (const step of steps) {
    const baseView = views[step.stateIndex];
    if (!baseView) {
      continue;
    }

    for (const event of step.actionTimeline ?? []) {
      const resolvingCard = resolvingPlayedCardForEvent(baseView, event);
      if (resolvingCard && !resolving.some((entry) => entry.playerIndex === resolvingCard.playerIndex && sameKnownCard(entry.card, resolvingCard.card))) {
        resolving = [...resolving, resolvingCard];
      }
    }

    // A trainer whose effect resolves without any follow-up phases (e.g. a
    // turn-long boost item) still deserves the standard presentation: hold in
    // the play zone, then slide onto the discard. Synthesize that phase pair
    // so the in-step view transition drives the existing pile animation.
    if (!step.animationPhases?.length) {
      const instantResolved = resolving.filter((entry) =>
        stepContainsPlayForCard(step, entry.card)
        && playerHasDiscardCard(baseView.players[entry.playerIndex], entry.card));
      if (instantResolved.length) {
        const playerIndex = instantResolved[0].playerIndex;
        const holdingView = gameViewWithResolvingCards(step.displayView ?? baseView, instantResolved);
        step.animationPhases = [{
          key: `Play:${playerIndex}`,
          view: { ...holdingView, actionTimeline: step.actionTimeline ?? [] },
          actionTimeline: step.actionTimeline ?? [],
          durationMs: 700,
        }, {
          key: `PlayResolve:${playerIndex}`,
          view: { ...baseView, actionTimeline: [] },
          actionTimeline: [],
          durationMs: 460,
        }];
        step.displayView = baseView;
        resolving = resolving.filter((entry) => !instantResolved.some((resolved) => sameResolvingCard(resolved, entry)));
        continue;
      }
    }

    const displayResolved = resolving.filter((entry) =>
      shouldResolveCardInDisplay(step, entry)
      && playerHasDiscardCard(baseView.players[entry.playerIndex], entry.card));
    const displayResolving = resolving.filter((entry) =>
      !displayResolved.some((resolvedEntry) => sameResolvingCard(resolvedEntry, entry))
      && shouldShowResolvingCardInDisplay(step, baseView, entry));
    const phaseResolving = resolving.filter((entry) => shouldShowResolvingCardInPhase(step, baseView, entry));
    if (displayResolved.length) {
      const view = step.displayView ?? baseView;
      step.displayView = gameViewWithResolvedDiscards(view, displayResolved);
    }
    if (displayResolving.length) {
      const view = step.displayView ?? baseView;
      step.displayView = gameViewWithResolvingCards(view, displayResolving);
    }
    if (phaseResolving.length && step.animationPhases?.length) {
      step.animationPhases = step.animationPhases.map((phase) => ({
        ...phase,
        view: gameViewWithResolvingCards(phase.view, phaseResolving),
      }));
    }

    const visibleResolving = [...displayResolving, ...phaseResolving];
    resolving = resolving.flatMap((entry) => {
      if (!visibleResolving.some((visibleEntry) => sameResolvingCard(visibleEntry, entry))) {
        return [];
      }
      if (playerHasDiscardCard(baseView.players[entry.playerIndex], entry.card)) {
        return [];
      }
      if (displayResolved.some((resolvedEntry) => sameResolvingCard(resolvedEntry, entry))) {
        return [];
      }
      if (stepContainsPlayForCard(step, entry.card)) {
        return [entry];
      }
      return [entry];
    });
  }
}

function applyKnockOutDiscardTopOrdering(steps: ReplayStep[]): void {
  for (const step of steps) {
    const knockOutEvents = (step.actionTimeline ?? []).filter(isKnockOutEvent);
    if (!knockOutEvents.length) {
      continue;
    }

    if (step.displayView) {
      step.displayView = gameViewWithPromotedDiscardCards(step.displayView, knockOutEvents);
    }
    if (step.animationPhases?.length) {
      step.animationPhases = step.animationPhases.map((phase) => {
        if (!phase.key.startsWith('KnockOut:')) {
          return phase;
        }
        return {
          ...phase,
          view: gameViewWithPromotedDiscardCards(phase.view, phase.actionTimeline.filter(isKnockOutEvent)),
        };
      });
    }
  }
}

function gameViewWithPromotedDiscardCards(view: GameView, events: ActionTimelineEvent[]): GameView {
  return {
    ...view,
    players: view.players.map((player, playerIndex) => {
      const playerEvents = events.filter((event) => event.playerIndex === playerIndex);
      if (!playerEvents.length) {
        return player;
      }
      return playerEvents.reduce(promoteDiscardCardToTop, player);
    }),
  };
}

function promoteDiscardCardToTop(player: PlayerView, event: ActionTimelineEvent): PlayerView {
  const cardIndex = player.discard.findIndex((card) => eventCardMatches(card, event));
  if (cardIndex < 0 || cardIndex === player.discard.length - 1) {
    return player;
  }
  const discard = [...player.discard];
  const [card] = discard.splice(cardIndex, 1);
  return {
    ...player,
    discard: [...discard, card],
  };
}

function resolvingPlayedCardForEvent(view: GameView, event: ActionTimelineEvent): ResolvingPlayedCard | undefined {
  if (event.kind !== 'Play' || event.playerIndex === undefined) {
    return undefined;
  }
  const player = view.players[event.playerIndex];
  const card = cardViewFromEvent(event);
  if (!player || !card || card.id === undefined || playerHasCardInPlay(player, event) || !isResolvingTrainerCard(card.id)) {
    return undefined;
  }
  return { playerIndex: event.playerIndex, card };
}

function isResolvingTrainerCard(cardId: number): boolean {
  const kind = cardDatabase.get(cardId)?.kind ?? '';
  return kind === 'Item' || kind === 'Supporter';
}

function gameViewWithResolvingCards(view: GameView, resolving: ResolvingPlayedCard[]): GameView {
  const cardsByPlayer = new Map<number, CardView[]>();
  for (const entry of resolving) {
    const cards = cardsByPlayer.get(entry.playerIndex) ?? [];
    cardsByPlayer.set(entry.playerIndex, [...cards, entry.card]);
  }

  return {
    ...view,
    players: view.players.map((player, playerIndex) => {
      const pendingCards = cardsByPlayer.get(playerIndex) ?? [];
      if (!pendingCards.length) {
        return player;
      }
      return {
        ...player,
        discard: player.discard.filter((discardCard) => !pendingCards.some((card) => sameKnownCard(discardCard, card))),
        playZone: [
          ...player.playZone.filter((playZoneCard) => !pendingCards.some((card) => sameKnownCard(playZoneCard, card))),
          ...pendingCards,
        ],
      };
    }),
  };
}

function gameViewWithResolvedDiscards(view: GameView, resolving: ResolvingPlayedCard[]): GameView {
  const cardsByPlayer = new Map<number, CardView[]>();
  for (const entry of resolving) {
    const cards = cardsByPlayer.get(entry.playerIndex) ?? [];
    cardsByPlayer.set(entry.playerIndex, [...cards, entry.card]);
  }

  return {
    ...view,
    players: view.players.map((player, playerIndex) => {
      const resolvedCards = cardsByPlayer.get(playerIndex) ?? [];
      if (!resolvedCards.length) {
        return player;
      }
      return {
        ...player,
        playZone: player.playZone.filter((playZoneCard) => !resolvedCards.some((card) => sameKnownCard(playZoneCard, card))),
        discard: [
          ...player.discard.filter((discardCard) => !resolvedCards.some((card) => sameKnownCard(discardCard, card))),
          ...resolvedCards,
        ],
      };
    }),
  };
}

function shouldResolveCardInDisplay(step: ReplayStep, entry: ResolvingPlayedCard): boolean {
  return !!step.animationPhases?.length
    && (stepContainsPlayForCard(step, entry.card) || isCardEffectContinuationStep(step));
}

function shouldShowResolvingCardInDisplay(step: ReplayStep, baseView: GameView, entry: ResolvingPlayedCard): boolean {
  if (!playerHasDiscardCard(baseView.players[entry.playerIndex], entry.card)) {
    return true;
  }
  return stepContainsPlayForCard(step, entry.card) && !step.animationPhases?.length;
}

function shouldShowResolvingCardInPhase(step: ReplayStep, baseView: GameView, entry: ResolvingPlayedCard): boolean {
  return shouldShowResolvingCardInDisplay(step, baseView, entry)
    || stepContainsPlayForCard(step, entry.card)
    || isCardEffectContinuationStep(step);
}

function stepContainsPlayForCard(step: ReplayStep, card: CardView): boolean {
  return (step.actionTimeline ?? []).some((event) => event.kind === 'Play' && eventCardMatches(card, event));
}

function isCardEffectContinuationStep(step: ReplayStep): boolean {
  return (step.actionTimeline ?? []).some((event) => [
    'Switch',
    'MoveCard',
    'MoveCardReverse',
    'Draw',
    'DrawReverse',
    'Shuffle',
    'HPChange',
  ].includes(event.kind ?? ''));
}

function sameResolvingCard(left: ResolvingPlayedCard, right: ResolvingPlayedCard): boolean {
  return left.playerIndex === right.playerIndex && sameKnownCard(left.card, right.card);
}

function shouldProjectSingleGroup(currentView: GameView, group: ReplayActionGroup): boolean {
  return group.events.some((event) => event.kind === 'Play' && needsPlayedCardDiscardProjection(currentView, event));
}

function needsPlayedCardDiscardProjection(currentView: GameView, event: ActionTimelineEvent): boolean {
  const playerIndex = event.playerIndex;
  if (playerIndex === undefined) {
    return false;
  }
  const player = currentView.players[playerIndex];
  if (!player) {
    return false;
  }
  return !player.hand.some((card) => eventCardMatches(card, event))
    && !player.discard.some((card) => eventCardMatches(card, event))
    && !playerHasCardInPlay(player, event);
}

type ProjectionOptions = {
  deferBoardStateEvents?: boolean;
  deferMoveCardEvents?: boolean;
  // Keep the base discard while cards are still flying onto the pile.
  deferDiscardArrivals?: boolean;
};

function applyReplayEvent(
  view: GameView,
  currentView: GameView,
  event: ActionTimelineEvent,
  options: ProjectionOptions = {},
): void {
  const playerIndex = event.playerIndex;
  if (playerIndex === undefined || !view.players[playerIndex] || !currentView.players[playerIndex]) {
    return;
  }
  const player = view.players[playerIndex];
  const currentPlayer = currentView.players[playerIndex];

  if (event.kind === 'Draw' || event.kind === 'DrawReverse') {
    player.deckCount = Math.max(0, player.deckCount - 1);
    player.hand = addCardToHand(player, currentPlayer);
    return;
  }

  if (event.kind === 'Play') {
    player.hand = removeMovedCardFromHand(player.hand, event);
    if (playerHasCardInPlay(currentPlayer, event)) {
      player.active = currentPlayer.active;
      player.bench = currentPlayer.bench;
      player.stadium = currentPlayer.stadium;
      player.playZone = currentPlayer.playZone;
      return;
    }
    player.discard = addCardToDiscard(player, currentPlayer, event);
    return;
  }

  if (event.kind === 'Evolve') {
    player.hand = removeMovedCardFromHand(player.hand, event);
    if (!options.deferBoardStateEvents) {
      player.active = currentPlayer.active;
      player.bench = currentPlayer.bench;
      player.discard = currentPlayer.discard;
    }
    return;
  }

  if (event.kind === 'Attach') {
    player.hand = removeCardFromHandIfPresent(player.hand, event);
    if (!options.deferBoardStateEvents) {
      player.active = currentPlayer.active;
      player.bench = currentPlayer.bench;
      player.discard = currentPlayer.discard;
    }
    return;
  }

  if (event.kind === 'HPChange') {
    if (options.deferBoardStateEvents) {
      return;
    }
    if (applyDamageReplayEvent(player, event)) {
      return;
    }
    player.active = currentPlayer.active;
    player.bench = currentPlayer.bench;
    player.discard = currentPlayer.discard;
    return;
  }

  if (isBoardStateEvent(event.kind)) {
    if (options.deferBoardStateEvents) {
      return;
    }
    player.active = currentPlayer.active;
    player.bench = currentPlayer.bench;
    player.discard = currentPlayer.discard;
    return;
  }

  if (!isMoveCardKind(event.kind)) {
    return;
  }
  if (options.deferMoveCardEvents) {
    return;
  }

  const params = event.params as Record<string, unknown> | undefined;
  const fromArea = Number(params?.fromArea);
  const toArea = Number(params?.toArea);
  applyReplayAreaDelta(player, currentPlayer, fromArea, -1, event);
  if (options.deferDiscardArrivals && toArea === CabtAreaType.DISCARD) {
    return;
  }
  applyReplayAreaDelta(player, currentPlayer, toArea, 1, event);
}

function isKnockOutMove(fromArea: number, toArea: number): boolean {
  return toArea === CabtAreaType.DISCARD
    && (fromArea === CabtAreaType.ACTIVE || fromArea === CabtAreaType.BENCH);
}

function isBoardPositionMove(fromArea: number, toArea: number): boolean {
  return (fromArea === CabtAreaType.ACTIVE && toArea === CabtAreaType.BENCH)
    || (fromArea === CabtAreaType.BENCH && toArea === CabtAreaType.ACTIVE);
}

function isBoardToDeckMove(fromArea: number, toArea: number): boolean {
  return toArea === CabtAreaType.DECK
    && (fromArea === CabtAreaType.ACTIVE || fromArea === CabtAreaType.BENCH);
}

function isAttachedCardArea(area: number): boolean {
  return area === CabtAreaType.ENERGY
    || area === CabtAreaType.TOOL;
}

function isAttachedCardMoveDestination(area: number): boolean {
  return area === CabtAreaType.DISCARD
    || area === CabtAreaType.DECK;
}

function isKnockOutEvent(event: ActionTimelineEvent): boolean {
  const params = event.params as Record<string, unknown> | undefined;
  return isMoveCardKind(event.kind)
    && isKnockOutMove(Number(params?.fromArea), Number(params?.toArea));
}

function applyDamageReplayEvent(player: PlayerView, event: ActionTimelineEvent): boolean {
  const params = event.params as Record<string, unknown> | undefined;
  const serial = Number(params?.serial);
  const cardId = Number(params?.cardId);
  const value = Number(params?.value);
  if (!Number.isFinite(value)) {
    return false;
  }

  let updated = false;
  const updateSlot = (slot: PokemonSlotView): PokemonSlotView => {
    const matches = Number.isFinite(serial)
      ? slot.pokemon?.serial === serial
      : Number.isFinite(cardId) && slot.pokemon?.id === cardId;
    if (!matches) {
      return slot;
    }
    updated = true;
    return {
      ...slot,
      damage: Math.max(0, Math.round(slot.damage - value)),
    };
  };

  player.active = updateSlot(player.active);
  player.bench = player.bench.map(updateSlot);
  return updated;
}

function isBoardStateEvent(kind: string | undefined): boolean {
  return [
    'Attack',
    'Attach',
    'Evolve',
    'Devolve',
    'Switch',
    'HPChange',
    'Poisoned',
    'Burned',
    'Asleep',
    'Paralyzed',
    'Confused',
  ].includes(kind ?? '');
}

// An active slot emptied by a departure, keeping its slot identity (owner,
// position, target) so the board renders an empty active rather than the
// step-end occupant.
function vacatedActiveSlot(slot: PokemonSlotView): PokemonSlotView {
  return {
    ...slot,
    empty: true,
    pokemon: undefined,
    cards: [],
    damage: 0,
    hp: 0,
    retreat: [],
    energy: [],
    tools: [],
    specialConditions: [],
  };
}

function applyReplayAreaDelta(
  player: PlayerView,
  currentPlayer: PlayerView,
  area: number,
  delta: -1 | 1,
  event?: ActionTimelineEvent,
): void {
  if (area === CabtAreaType.DECK) {
    player.deckCount = Math.max(0, player.deckCount + delta);
    return;
  }
  if (area === CabtAreaType.HAND) {
    player.hand = delta > 0 ? addCardToHand(player, currentPlayer) : removeMovedCardFromHand(player.hand, event);
    return;
  }
  if (area === CabtAreaType.PRIZE) {
    player.prizesLeft = Math.max(0, player.prizesLeft + delta);
    return;
  }
  if (area === CabtAreaType.ACTIVE) {
    // A card ENTERING the active spot adopts the step's end-state occupant; a
    // card LEAVING vacates the slot. Copying currentPlayer.active on a departure
    // imports whatever ends up active by the step's end — so when an ability
    // vacates the active and a bench Pokemon is promoted later in the same step,
    // the vacate would pull the promoted Pokemon in and the promotion beat would
    // have nothing to animate (it instantly spawns). Emptying on departure keeps
    // the pre-promotion state so the BENCH->ACTIVE beat animates from the bench.
    player.active = delta > 0 ? currentPlayer.active : vacatedActiveSlot(player.active);
    return;
  }
  if (area === CabtAreaType.BENCH) {
    player.bench = delta > 0 ? addCardToBench(player, currentPlayer, event) : currentPlayer.bench;
    return;
  }
  if (area === CabtAreaType.DISCARD) {
    player.discard = currentPlayer.discard;
    return;
  }
  if (area === CabtAreaType.STADIUM) {
    player.stadium = delta > 0 ? currentPlayer.stadium : removeMovedCardFromZone(player.stadium, event);
    return;
  }
  if (area === CabtAreaType.ENERGY || area === CabtAreaType.TOOL) {
    // An energy/tool move changes only the attachment badges of the Pokemon
    // that holds the card — it never moves a Pokemon between active and bench.
    // Copying currentPlayer's whole active/bench would import board-position
    // changes from LATER phases of this step (a retreat discards energy from
    // the old active BEFORE the swap; importing the post-swap positions here
    // would make the following swap phase animate against a post-swap board,
    // reversing the crossing). Update the badges on the existing slots instead.
    syncAttachmentBadgesFromCurrent(player, currentPlayer);
    return;
  }
  if (area === CabtAreaType.PRE_EVOLUTION) {
    // A pre-evolution card leaves the stack of the Pokemon that holds it (its
    // whole evolution line is being shuffled/discarded away); like an
    // energy/tool move it never repositions a Pokemon between active and bench.
    // Copying currentPlayer's whole active/bench would import board-position
    // changes from LATER phases of this step — e.g. when Run Away Draw vacates
    // the active and a bench Pokemon is promoted afterwards, this resync pulls
    // the promoted Pokemon into active before its own promotion beat. The
    // accompanying ACTIVE/BENCH delta already vacates the departing slot.
  }
}

// Copy energy/tool badges from currentPlayer onto player's slots, matching by
// Pokemon serial so a Pokemon keeps its current board position even when it
// sits at a different slot in the end state.
function syncAttachmentBadgesFromCurrent(player: PlayerView, currentPlayer: PlayerView): void {
  const currentSlots = [currentPlayer.active, ...currentPlayer.bench];
  const withCurrentBadges = (slot: PokemonSlotView): PokemonSlotView => {
    const serial = slot.pokemon?.serial;
    if (serial === undefined) {
      return slot;
    }
    const match = currentSlots.find((candidate) => candidate.pokemon?.serial === serial);
    if (!match) {
      return slot;
    }
    return { ...slot, energy: match.energy, tools: match.tools };
  };
  player.active = withCurrentBadges(player.active);
  player.bench = player.bench.map(withCurrentBadges);
}

// Remove the first card the event names by serial, else the first it names by
// cardId; returns undefined when it names neither a present serial nor a
// present cardId, so each caller applies its own fallback. Hand serials are
// unique (the M1 invariant), so first-match removal equals filter-by-serial.
function removeBySerialOrCardId(cards: CardView[], event: ActionTimelineEvent | undefined): CardView[] | undefined {
  const params = event?.params as Record<string, unknown> | undefined;
  const serial = Number(params?.serial);
  // A serial names exactly one physical card. When the event carries a finite
  // serial, resolve by serial ONLY — a serial not present means the moved card
  // is not this hand's tracked copy (a deck-sourced Punk Up energy names its own
  // serial, absent from hand), so falling through to cardId would evict an
  // unrelated same-id copy (the hand's other Dark Energy) until the next raw
  // step rebuilds. Mirror removeMovedCardFromZone's serial-strict discipline;
  // the caller's fallback handles a genuinely untracked (face-down) move.
  if (Number.isFinite(serial)) {
    const index = cards.findIndex((card) => card.serial === serial);
    return index >= 0 ? removeAt(cards, index) : undefined;
  }

  const cardId = Number(params?.cardId);
  if (Number.isFinite(cardId)) {
    const index = cards.findIndex((card) => card.id === cardId);
    if (index >= 0) {
      return removeAt(cards, index);
    }
  }

  return undefined;
}

// Zone removal keeps its own shape: a finite serial removes by serial and
// returns without falling through to cardId (a zone can legitimately hold cards
// whose id matches but whose serial does not), and the empty-event fallback
// drops the last card rather than resizing.
function removeMovedCardFromZone(cards: CardView[], event: ActionTimelineEvent | undefined): CardView[] {
  const params = event?.params as Record<string, unknown> | undefined;
  const serial = Number(params?.serial);
  if (Number.isFinite(serial)) {
    return cards.filter((card) => card.serial !== serial);
  }

  const cardId = Number(params?.cardId);
  if (Number.isFinite(cardId)) {
    const index = cards.findIndex((card) => card.id === cardId);
    return index >= 0 ? removeAt(cards, index) : cards;
  }

  return cards.slice(0, -1);
}

function removeMovedCardFromHand(hand: CardView[], event: ActionTimelineEvent | undefined): CardView[] {
  return removeBySerialOrCardId(hand, event) ?? resizedHand(hand, hand.length - 1);
}

function removeCardFromHandIfPresent(hand: CardView[], event: ActionTimelineEvent | undefined): CardView[] {
  return removeBySerialOrCardId(hand, event) ?? hand;
}

function removeAt<T>(items: T[], index: number): T[] {
  return [...items.slice(0, index), ...items.slice(index + 1)];
}

function addCardToHand(player: PlayerView, currentPlayer: PlayerView): CardView[] {
  return [...player.hand, nextHandCardToAdd(player.hand, currentPlayer.hand)];
}

// The pre-state hand grows toward the settled hand one card per hand-add event.
// The positional pick (the settled card at the growing index) is correct when
// the settled hand is the pre-state hand plus appended cards — the common draw
// case. But when the settled hand reorders its known serials, that index can
// land on a serial the pre-state hand already holds, minting a duplicate that
// collides Hand.svelte's keyed each-block (reproduced: serial 99 doubled). So
// only trust the positional pick when it is genuinely new; otherwise take the
// first settled card whose serial the pre-state hand does not already hold.
export function nextHandCardToAdd(preHand: CardView[], currentHand: CardView[]): CardView {
  const present = new Set(
    preHand.map((card) => card.serial).filter((serial): serial is number => serial !== undefined),
  );
  const positional = currentHand[preHand.length];
  if (positional && (positional.serial === undefined || !present.has(positional.serial))) {
    return positional;
  }
  const novel = currentHand.find((card) => card.serial !== undefined && !present.has(card.serial));
  return novel ?? positional ?? faceDownCard();
}

function addCardToDiscard(player: PlayerView, currentPlayer: PlayerView, event: ActionTimelineEvent): CardView[] {
  const eventCard = cardViewFromEvent(event);
  const currentNewCard = currentPlayer.discard.find((card) => eventCardMatches(card, event));
  const nextCard = currentNewCard ?? eventCard ?? currentPlayer.discard.at(-1) ?? faceDownCard();
  if (player.discard.some((card) => sameKnownCard(card, nextCard))) {
    return player.discard;
  }
  return [...player.discard, nextCard];
}

function addCardToBench(player: PlayerView, currentPlayer: PlayerView, event: ActionTimelineEvent | undefined): PokemonSlotView[] {
  const params = event?.params as Record<string, unknown> | undefined;
  const explicitIndex = Number(params?.toIndex ?? params?.index ?? params?.benchIndex);
  const currentSlot = currentPlayer.bench.find((slot) => slot.pokemon && event && eventCardMatches(slot.pokemon, event));
  if (!currentSlot) {
    return player.bench;
  }

  const index = Number.isInteger(explicitIndex)
    ? explicitIndex
    : Number.isInteger(currentSlot.index)
      ? currentSlot.index
      : player.bench.findIndex((slot) => slot.empty);
  if (!Number.isInteger(index) || index < 0) {
    return player.bench;
  }

  const bench = player.bench.length ? [...player.bench] : currentPlayer.bench.map((slot) => ({ ...slot }));
  while (bench.length <= index && currentPlayer.bench[bench.length]) {
    bench.push(currentPlayer.bench[bench.length]);
  }
  if (!bench[index]) {
    return bench;
  }
  bench[index] = currentSlot;
  return bench;
}

function cardViewFromEvent(event: ActionTimelineEvent): CardView | undefined {
  const params = event.params as Record<string, unknown> | undefined;
  const cardId = Number(params?.cardId);
  if (!Number.isFinite(cardId)) {
    return undefined;
  }
  return cardToView({
    id: cardId,
    serial: Number.isFinite(Number(params?.serial)) ? Number(params?.serial) : undefined,
    playerIndex: event.playerIndex,
  });
}

function eventCardMatches(card: CardView, event: ActionTimelineEvent): boolean {
  const params = event.params as Record<string, unknown> | undefined;
  const serial = Number(params?.serial);
  if (Number.isFinite(serial)) {
    return card.serial === serial;
  }
  const cardId = Number(params?.cardId);
  return Number.isFinite(cardId) && card.id === cardId;
}

function sameKnownCard(left: CardView, right: CardView): boolean {
  if (left.serial !== undefined && right.serial !== undefined) {
    return left.serial === right.serial;
  }
  return left.id === right.id && left.name === right.name;
}

function playerHasDiscardCard(player: PlayerView | undefined, card: CardView): boolean {
  return !!player?.discard.some((discardCard) => sameKnownCard(discardCard, card));
}

function playerHasCardInPlay(player: PlayerView, event: ActionTimelineEvent): boolean {
  return [
    ...slotCards(player.active),
    ...player.bench.flatMap(slotCards),
    ...player.stadium,
    ...player.playZone,
  ].some((card) => eventCardMatches(card, event));
}

function slotCards(slot: PokemonSlotView): CardView[] {
  return [
    ...(slot.pokemon ? [slot.pokemon] : []),
    ...slot.cards,
    ...slot.energy,
    ...slot.tools,
  ];
}

function resizedHand(hand: CardView[], count: number): CardView[] {
  const nextCount = Math.max(0, Math.round(count));
  if (hand.length >= nextCount) {
    return hand.slice(0, nextCount);
  }
  return [
    ...hand,
    ...Array.from({ length: nextCount - hand.length }, () => faceDownCard()),
  ];
}

function extractVisualizeFrames(input: unknown): CabtVisualizeFrame[] {
  const runnerFrames = (input as CabtRunnerJson)?.visualize;
  if (Array.isArray(runnerFrames)) {
    return runnerFrames as CabtVisualizeFrame[];
  }

  const steps = replayEnvironment(input)?.steps;
  const frames = steps?.[0]?.[0]?.observation?.visualize;
  if (Array.isArray(frames)) {
    return frames as CabtVisualizeFrame[];
  }

  const firstStepFrames = (steps?.[0]?.[0] as { visualize?: unknown } | undefined)?.visualize;
  if (Array.isArray(firstStepFrames)) {
    return firstStepFrames as CabtVisualizeFrame[];
  }
  return [];
}

function replayEnvironment(input: unknown): KaggleEnvironment | undefined {
  const wrapped = (input as KaggleContext)?.environment;
  if (wrapped?.steps) {
    return wrapped;
  }
  const topLevel = input as KaggleEnvironment;
  if (Array.isArray(topLevel?.steps)) {
    return topLevel;
  }
  return wrapped;
}

// Replay frames project through the shared structural builders in
// cabtProjection with replay's own card-metadata resolvers (generated
// metadata instead of live bridge dataMaps).
const replaySlotResolvers: SlotResolvers = {
  cardView: (ref) => cardToView(ref),
  retreatCost: (cardId) => retreatCostFor(cardDatabase.get(cardId ?? -1)),
};

function frameToGameView(
  frame: CabtVisualizeFrame,
  playerNamesForReplay: string[],
  logs: LogView[],
  actionTimeline: GameView['actionTimeline'],
): GameView {
  const current = frame.current;
  const activePlayerIndex = clampPlayerIndex(current.yourIndex);
  const stadium = current.stadium ?? [];
  const players = current.players.map((player, index) =>
    buildPlayerView(player, index, activePlayerIndex, playerNamesForReplay[index] ?? `Player ${index + 1}`, stadiumForPlayer(stadium, index)),
  );
  return {
    ready: true,
    phase: projectPhase(current.result),
    phaseLabel: current.result >= 0 ? 'Finished' : 'CABT replay',
    turn: current.turn,
    activePlayerIndex,
    activePlayerId: players[activePlayerIndex]?.id,
    winner: projectWinner(current.result),
    players,
    logs: [...logs],
    actionTimeline,
    events: [frame],
  };
}

function buildPlayerView(
  player: CabtPlayerFrame,
  index: number,
  activePlayerIndex: number,
  name: string,
  stadium: CabtCardRef[],
): PlayerView {
  const hand = player.hand ?? [];
  const conditions = specialConditionsFor(player);
  return {
    index,
    id: index,
    name,
    hand: projectHand(hand.length ? hand : null, player.handCount ?? 0, replaySlotResolvers.cardView),
    deckCount: player.deckCount ?? 0,
    discard: (player.discard ?? []).map(cardToView),
    lostZone: [],
    stadium: stadium.map(cardToView),
    playZone: [],
    prizesLeft: player.prize?.length ?? 0,
    active: projectPokemonSlot(player.active?.[0] ?? null, index, 'active', 0, activePlayerIndex, conditions, replaySlotResolvers),
    bench: Array.from({ length: Math.max(player.benchMax ?? 5, player.bench?.length ?? 0) }, (_item, benchIndex) =>
      projectPokemonSlot(player.bench?.[benchIndex] ?? null, index, 'bench', benchIndex, activePlayerIndex, conditions, replaySlotResolvers),
    ),
    playableCardIds: hand.map((card) => card.id),
    availableActions: {
      active: {
        attacks: [],
        abilities: [],
        retreat: { legal: false, targets: [] },
      },
      bench: (player.bench ?? []).map((_bench, benchIndex) => ({ index: benchIndex, abilities: [] })),
    },
  };
}

// Exported for the 5c card-view differential decision packet
// (cardViewDifferential.test.ts) — the replay-side classifier under comparison.
export function cardToView(cardRef: CabtCardRef): CardView {
  const data = cardDatabase.get(cardRef.id);
  const rawName = cardRef.name || data?.name || `Card ${cardRef.id}`;
  const name = displayName(rawName);
  const view: CardView = {
    id: cardRef.id,
    serial: cardRef.serial,
    playerIndex: cardRef.playerIndex,
    name,
    fullName: name,
    set: data?.set || undefined,
    setNumber: data?.setNumber || undefined,
    ...classifyCard({
      cardType: data?.cardType ?? -1,
      energyType: data?.energyType,
      basic: data?.basic,
      stage1: data?.stage1,
      stage2: data?.stage2,
    }),
    evolvesFrom: data?.evolvesFrom || undefined,
    hp: data?.hp ?? undefined,
    retreat: Array.from({ length: retreatCostFor(data) }, () => 'Colorless'),
    powers: powersForCard(data),
    attacks: attacksForCard(data),
  };
  return {
    ...view,
    imageUrl: resolveCardImageUrl(view),
  };
}

function faceDownCard(): CardView {
  return {
    name: 'Card',
    fullName: 'Card',
  };
}

function playerNames(input: unknown): string[] {
  const names = replayEnvironment(input)?.info?.TeamNames;
  return names?.length ? names : ['Player 1', 'Player 2'];
}

function stepLabel(frame: CabtVisualizeFrame, index: number): string {
  const prizeSummary = prizeMoveSummary(frame.logs ?? []);
  if (prizeSummary) {
    return prizeSummary;
  }

  const attackSummary = attackLogSummary(frame.logs ?? []);
  if (attackSummary) {
    return attackSummary;
  }

  const latestLog = frame.logs?.at(-1);
  if (latestLog) {
    return formatLog(latestLog);
  }
  const selectType = frame.select?.type;
  const context = frame.select?.context;
  if (selectType || context) {
    return [selectType, context].filter(Boolean).join(' · ');
  }
  return index === 0 ? 'Initial state' : `Frame ${index}`;
}

function formatLog(log: Record<string, unknown>): string {
  const playerIndex = typeof log.playerIndex === 'number' ? log.playerIndex : undefined;
  const actor = playerIndex === undefined ? 'Game' : `Player ${playerIndex + 1}`;
  const card = cardName(Number(log.cardId));
  switch (log.type) {
    case 'TurnStart':
      return `${actor} turn started.`;
    case 'TurnEnd':
      return `${actor} ended their turn.`;
    case 'Draw':
      return `${actor} drew ${card}.`;
    case 'Play':
      return `${actor} played ${card}.`;
    case 'Attach':
      return `${actor} attached ${card}.`;
    case 'Attack':
      return `${actor} used ${attackNameForLog(log)} with ${card}.`;
    case 'Ability':
      return `${actor} used ${abilityNameForLog(log)} with ${card}.`;
    case 'MoveCard':
      if (Number(log.fromArea) === CabtAreaType.PRIZE && Number(log.toArea) === CabtAreaType.HAND) {
        return `${actor} took ${card} as a Prize card.`;
      }
      if (Number(log.fromArea) === CabtAreaType.DECK && Number(log.toArea) === CabtAreaType.PRIZE) {
        return `${actor} set a Prize card.`;
      }
      if (Number(log.fromArea) === CabtAreaType.HAND && Number(log.toArea) === CabtAreaType.DECK) {
        return `${actor} moved a card from hand to deck.`;
      }
      return `${actor} moved ${card} from ${areaName(log.fromArea)} to ${areaName(log.toArea)}.`;
    case 'HPChange':
      return `${actor}'s ${card} HP changed.`;
    case 'Result':
      return 'The battle finished.';
    default:
      return `${actor}: ${String(log.type ?? 'Event')}${Number.isFinite(Number(log.cardId)) ? ` ${card}` : ''}.`;
  }
}

function prizeMoveSummary(logs: Array<Record<string, unknown>>): string {
  const prizeMoves = logs.filter((log) => log.type === 'MoveCard' && Number(log.fromArea) === 6 && Number(log.toArea) === 2);
  if (!prizeMoves.length) {
    return '';
  }

  const playerIndex = typeof prizeMoves[0].playerIndex === 'number' ? prizeMoves[0].playerIndex : undefined;
  const samePlayer = prizeMoves.every((log) => log.playerIndex === playerIndex);
  if (!samePlayer || playerIndex === undefined) {
    return `Players took ${prizeMoves.length} Prize cards.`;
  }

  const actor = `Player ${playerIndex + 1}`;
  return prizeMoves.length === 1 ? `${actor} took 1 Prize card.` : `${actor} took ${prizeMoves.length} Prize cards.`;
}

function attackLogSummary(logs: Array<Record<string, unknown>>): string {
  const attack = logs.find((log) => log.type === 'Attack');
  return attack ? formatLog(attack) : '';
}

function areaName(area: unknown): string {
  const areaMap: Record<number, string> = {
    1: 'deck',
    2: 'hand',
    3: 'discard',
    4: 'active',
    5: 'bench',
    6: 'prize',
    7: 'stadium',
    8: 'energy',
    9: 'tool',
    10: 'evolution stack',
    11: 'player',
    12: 'selection',
  };
  return areaMap[Number(area)] ?? 'zone';
}

function cardName(id: number): string {
  return displayName(cardDatabase.get(id)?.name ?? (Number.isFinite(id) ? `Card ${id}` : 'a card'));
}

function attackNameForLog(log: Record<string, unknown>): string {
  const attack = attackDatabase.get(Number(log.attackId));
  if (attack?.name) {
    return displayName(attack.name);
  }
  return Number.isFinite(Number(log.attackId)) ? `attack ${log.attackId}` : 'an attack';
}

function abilityNameForLog(log: Record<string, unknown>): string {
  const explicit = typeof log.abilityName === 'string' ? log.abilityName.trim() : '';
  if (explicit) {
    return displayName(explicit);
  }
  return abilityNameForCard(cardDatabase.get(Number(log.cardId)));
}

function abilityNameForCard(data: CardRow | undefined): string {
  const skillName = data?.skills?.find((skill) => skill.name.trim())?.name.trim();
  return skillName ? displayName(skillName) : 'an Ability';
}

function powersForCard(data: CardRow | undefined): CardView['powers'] {
  const skills = data?.skills?.filter((skill) => skill.name.trim());
  if (!skills?.length) {
    return undefined;
  }
  return skills.map((skill) => ({
    name: displayName(skill.name.trim()),
    text: skill.text ?? '',
  }));
}

function attacksForCard(data: CardRow | undefined): CardView['attacks'] {
  if (!data) {
    return undefined;
  }
  const engineAttacks = data.attacks
    ?.map((attackId) => attackDatabase.get(attackId))
    .filter((attack): attack is AttackRow => !!attack);
  if (engineAttacks?.length) {
    return engineAttacks.map((attack) => ({
      name: displayName(attack.name),
      cost: (attack.energies ?? []).map(energyName),
      damage: attack.damage ? String(attack.damage) : '',
      text: attack.text ?? '',
    }));
  }
  if (!data.attackName) {
    return undefined;
  }
  return [{
    name: data.attackName,
    cost: energyCostLabels(data.attackCost),
    damage: data.attackDamage,
    text: data.attackText,
  }];
}

function retreatCostFor(data: CardRow | undefined): number {
  return data?.retreat ?? data?.retreatCost ?? 0;
}

function energyCostLabels(cost: string): string[] {
  return [...cost.matchAll(/\{([A-Z])\}/g)].map((match) => displayName(`{${match[1]}}`));
}

function energyName(energy: number): string {
  return [
    'Colorless',
    'Grass',
    'Fire',
    'Water',
    'Lightning',
    'Psychic',
    'Fighting',
    'Darkness',
    'Metal',
    'Dragon',
    'Rainbow',
    'Team Rocket',
  ][energy] ?? 'Colorless';
}

function clampPlayerIndex(index: number): number {
  return index === 1 ? 1 : 0;
}
