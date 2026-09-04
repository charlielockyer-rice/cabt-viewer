import { describe, expect, it } from 'vitest';
import { runLiveFixture, type LiveFixtureRun } from './__fixtures__/liveFixture';
import { concealObservation } from './liveSteps';
import { CabtAreaType, type CabtObservation } from '../lib/cabt/types';
import type { ActionTimelineEvent, CardView } from '../lib/game/types';

// Live play against an agent must send the browser nothing the human seat was
// not told. These drive recorded engine games through the identical path
// localEngine.appendSteps takes (buildLiveSteps, one bridge response at a
// time) and read what the client would receive.

const AGENT_SEAT = 1;
const HUMAN_SEAT = 0;

// The engine's own hidden-information encodings for the agent seat: a card
// identity on any of these would be information the human never received.
const hiddenMoves: Array<[from: number, to: number]> = [
  [CabtAreaType.DECK, CabtAreaType.LOOKING],
  [CabtAreaType.LOOKING, CabtAreaType.HAND],
  [CabtAreaType.LOOKING, CabtAreaType.DECK_BOTTOM],
  [CabtAreaType.PRIZE, CabtAreaType.HAND],
];

function isPlaceholder(card: CardView): boolean {
  return !card.id;
}

function eventParams(event: ActionTimelineEvent): Record<string, unknown> {
  return (event.params ?? {}) as Record<string, unknown>;
}

function allEvents(run: LiveFixtureRun): ActionTimelineEvent[] {
  return run.beats.flatMap((beat) => beat.view.actionTimeline ?? []);
}

// Card ids the human's own encoding named for the agent seat: an Ultra Ball
// search, a Poffin placement, a mulliganed hand (the engine reveals all three).
// Those may legitimately stay concrete in the concealed hand.
function revealedAgentCardIds(run: LiveFixtureRun): Set<number> {
  const ids = new Set<number>();
  for (const event of allEvents(run)) {
    if (event.playerIndex !== AGENT_SEAT) {
      continue;
    }
    const params = eventParams(event);
    const cardId = Number(params.cardId);
    if (!Number.isFinite(cardId)) {
      continue;
    }
    if (event.kind === 'Draw' || Number(params.toArea) === CabtAreaType.HAND) {
      ids.add(cardId);
    }
  }
  return ids;
}

describe('live concealment of the agent seat', () => {
  it.each(['recon-directive.json', 'mulligan-bot.json', 'judge-by-bot.json'])(
    'sends only placeholders for the agent hand in %s',
    (fixture) => {
      const run = runLiveFixture(fixture);
      const revealed = revealedAgentCardIds(run);
      expect(run.beats.length).toBeGreaterThan(0);

      for (const beat of run.beats) {
        for (const card of beat.view.players[AGENT_SEAT].hand) {
          if (isPlaceholder(card)) {
            continue;
          }
          // A concrete card is only allowed when the engine itself named it to
          // the human seat.
          expect(revealed.has(card.id as number)).toBe(true);
        }
      }
    },
  );

  it('never carries a card identity on an agent-seat hidden-zone event', () => {
    const run = runLiveFixture('recon-directive.json');
    const looks = allEvents(run).filter((event) => {
      const params = eventParams(event);
      return Number(params.fromArea) === CabtAreaType.DECK && Number(params.toArea) === CabtAreaType.LOOKING;
    });
    // The fixture is a Recon Directive game: both seats look at deck cards.
    expect(looks.length).toBeGreaterThan(0);

    for (const event of allEvents(run)) {
      if (event.playerIndex !== AGENT_SEAT) {
        continue;
      }
      const params = eventParams(event);
      const isHidden = event.kind === 'Draw'
        || hiddenMoves.some(([from, to]) => Number(params.fromArea) === from && Number(params.toArea) === to);
      if (!isHidden) {
        continue;
      }
      expect(params.cardId).toBeUndefined();
      expect(params.serial).toBeUndefined();
    }
  });

  it('leaves the human seat its own cards, in the engine encoding', () => {
    const run = runLiveFixture('recon-directive.json');

    for (const beat of run.beats) {
      for (const card of beat.view.players[HUMAN_SEAT].hand) {
        expect(isPlaceholder(card)).toBe(false);
      }
    }

    // The human's own Recon Directive look keeps its card identities.
    const ownLooks = allEvents(run).filter((event) => {
      const params = eventParams(event);
      return event.playerIndex === HUMAN_SEAT
        && Number(params.fromArea) === CabtAreaType.DECK
        && Number(params.toArea) === CabtAreaType.LOOKING;
    });
    expect(ownLooks.length).toBeGreaterThan(0);
    for (const event of ownLooks) {
      expect(eventParams(event).cardId).toBeDefined();
    }
  });

  it.each(['recon-directive.json', 'mulligan-both.json', 'judge-by-bot.json'])(
    'settles each response on the hand counts of the human observation in %s',
    (fixture) => {
      const run = runLiveFixture(fixture);
      let checked = 0;
      for (const response of run.responses) {
        const human = response.humanObservation;
        const last = response.beats.at(-1);
        if (!human?.current || !last) {
          continue;
        }
        checked += 1;
        expect(last.view.players.map((player) => player.hand.length))
          .toEqual(human.current.players.map((player) => player.handCount));
      }
      expect(checked).toBeGreaterThan(0);
    },
  );

  // Charlie's amendment: the client receives the HUMAN seat's encoding of every
  // event, not only of the agent's own. A Judge played by the agent redraws the
  // human's hand inside the agent's turn; the agent's stream calls those draws
  // face-down, the human's names them. Without the substitution the human
  // watches four blank cards arrive and only sees their real hand a turn later.
  it('shows the human their own Judge redraw immediately', () => {
    const run = runLiveFixture('judge-by-bot.json');
    const judgeResponse = run.responses.find((response) =>
      response.beats.some((beat) => (beat.view.actionTimeline ?? [])
        .some((event) => event.kind === 'Play' && event.playerIndex === AGENT_SEAT && event.message.includes('Judge'))));
    expect(judgeResponse).toBeDefined();

    const beats = judgeResponse!.beats;
    const judgeAt = beats.findIndex((beat) => (beat.view.actionTimeline ?? [])
      .some((event) => event.kind === 'Play' && event.playerIndex === AGENT_SEAT && event.message.includes('Judge')));
    const drawAt = beats.findIndex((beat, index) => index > judgeAt
      && (beat.view.actionTimeline ?? []).some((event) => event.kind === 'Draw' && event.playerIndex === HUMAN_SEAT));
    expect(drawAt).toBeGreaterThan(judgeAt);

    const human = judgeResponse!.humanObservation!.current!;
    const finalHand = human.players[HUMAN_SEAT].hand!.map((card) => card.id);
    expect(finalHand.length).toBeGreaterThan(0);

    for (const beat of beats.slice(drawAt)) {
      const hand = beat.view.players[HUMAN_SEAT].hand;
      // Every card the human holds for the rest of the agent's turn is a real
      // card, drawn from the hand the human's own observation reports.
      expect(hand.every((card) => !isPlaceholder(card))).toBe(true);
      expect(hand.length).toBeLessThanOrEqual(finalHand.length);
      expect(hand.map((card) => card.id)).toEqual(finalHand.slice(0, hand.length));
      // The agent's hand stays face-down throughout.
      expect(beat.view.players[AGENT_SEAT].hand.every(isPlaceholder)).toBe(true);
    }
  });

  it('writes concealed frames for the saved replay and keeps raw frames apart', () => {
    const run = runLiveFixture('recon-directive.json');
    expect(run.state.replayFrames.length).toBe(run.state.rawFrames.length);

    const agentFrames = run.state.replayFrames
      .map((frame, index) => ({ frame, raw: run.state.rawFrames[index] }))
      .filter(({ raw }) => raw.current?.yourIndex === AGENT_SEAT);
    expect(agentFrames.length).toBeGreaterThan(0);

    for (const { frame, raw } of agentFrames) {
      expect(frame.current!.looking).toEqual([]);
      expect(frame.select?.deck ?? null).toBeNull();
      for (const option of frame.select?.option ?? []) {
        expect(option.cardId ?? null).toBeNull();
        expect(option.serial ?? null).toBeNull();
      }
      // The raw frame keeps the acting seat's own hand — server-side only.
      expect(raw.current!.players[AGENT_SEAT].hand).not.toBeNull();
    }

    // At least one agent frame really did have something to hide.
    expect(agentFrames.some(({ raw }) => (raw.current!.looking ?? []).length > 0)).toBe(true);
    expect(agentFrames.some(({ raw }) => (raw.select?.option ?? []).some((option) => option.cardId))).toBe(true);
  });

  it('conceals an observation body without touching the human seat', () => {
    const observation: CabtObservation = {
      select: {
        type: 1,
        context: 1,
        minCount: 1,
        maxCount: 1,
        remainDamageCounter: 0,
        remainEnergyCost: 0,
        option: [{ type: 3, cardId: 99, serial: 7 }],
        deck: [{ id: 99, serial: 7, playerIndex: 1 }],
        contextCard: { id: 55, serial: 3, playerIndex: 1 },
        effect: null,
      },
      logs: [],
      current: {
        turn: 3,
        turnActionCount: 0,
        yourIndex: AGENT_SEAT,
        firstPlayer: 0,
        supporterPlayed: false,
        stadiumPlayed: false,
        energyAttached: false,
        retreated: false,
        result: -1,
        stadium: [],
        looking: [{ id: 12, serial: 4, playerIndex: 1 }],
        players: [
          player([{ id: 5, serial: 1, playerIndex: 0 }]),
          player([{ id: 6, serial: 2, playerIndex: 1 }]),
        ],
      },
    };

    const concealed = concealObservation(observation, new Set([AGENT_SEAT]));

    expect(concealed.current!.players[HUMAN_SEAT].hand).toEqual([{ id: 5, serial: 1, playerIndex: 0 }]);
    expect(concealed.current!.players[AGENT_SEAT].hand).toBeNull();
    expect(concealed.current!.players[AGENT_SEAT].handCount).toBe(1);
    expect(concealed.current!.looking).toEqual([]);
    expect(concealed.select!.deck).toBeNull();
    expect(concealed.select!.option).toEqual([{ type: 3, cardId: null, serial: null }]);
    // The play zone reads contextCard/effect; both are public.
    expect(concealed.select!.contextCard).toEqual({ id: 55, serial: 3, playerIndex: 1 });
    // The original is untouched — the raw frame still carries everything.
    expect(observation.current!.players[AGENT_SEAT].hand).toEqual([{ id: 6, serial: 2, playerIndex: 1 }]);
  });
});

function player(hand: Array<{ id: number; serial: number; playerIndex: number }>) {
  return {
    active: [null],
    bench: [],
    benchMax: 5,
    deckCount: 40,
    discard: [],
    prize: [],
    handCount: hand.length,
    hand,
    poisoned: false,
    burned: false,
    asleep: false,
    paralyzed: false,
    confused: false,
  };
}
