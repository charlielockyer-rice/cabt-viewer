import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildLiveSteps, createLiveStepState, type LiveStep, type LiveStepState } from '../liveSteps';
import type { CabtDataMaps } from '../../lib/cabt/cabtProjection';
import type { CabtObservation } from '../../lib/cabt/types';
import type { SeatView } from '../../lib/game/types';

// Recorded live games (human = seat 0, agent = seat 1) captured from the real
// CABT bridge: every observation the engine delivered, in delivery order, with
// the selection that produced it and the bridge's card/attack tables.
//
// The engine alternates seats; the bridge hands the server a RESPONSE at a time
// — the human's answered observation, the agent's own observations for the
// decisions it auto-played, then the human's next observation. Concealment is
// response-scoped, so the fixtures are regrouped that way before replaying them
// through buildLiveSteps: this is the exact path localEngine.appendSteps takes.
export type RecordedStep = {
  observation: CabtObservation;
  action: number[] | null;
};

export type LiveFixture = {
  steps: RecordedStep[];
  dataMaps: CabtDataMaps;
};

const HUMAN_SEAT = 0;
const fixtureDir = path.dirname(fileURLToPath(import.meta.url));

export function loadLiveFixture(name: string): LiveFixture {
  const recorded = JSON.parse(fs.readFileSync(path.join(fixtureDir, name), 'utf8')) as {
    steps: RecordedStep[];
    cards: Array<{ cardId: number }>;
    attacks: Array<{ attackId: number }>;
  };
  return {
    steps: recorded.steps,
    dataMaps: {
      cardData: Object.fromEntries(recorded.cards.map((card) => [card.cardId, card])) as CabtDataMaps['cardData'],
      attacks: Object.fromEntries(recorded.attacks.map((attack) => [attack.attackId, attack])) as CabtDataMaps['attacks'],
    },
  };
}

export type LiveResponse = {
  // The observations of one bridge response and the beats they produced.
  observations: RecordedStep[];
  beats: LiveStep[];
  // The human's observation that closed the response, when there was one.
  humanObservation: CabtObservation | undefined;
};

export type LiveFixtureRun = {
  responses: LiveResponse[];
  beats: LiveStep[];
  state: LiveStepState;
};

const liveSeats: SeatView[] = [
  { control: 'self', name: 'Player 1' },
  { control: 'agent', name: 'Player 2' },
];

export function runLiveFixture(name: string): LiveFixtureRun {
  const { steps, dataMaps } = loadLiveFixture(name);
  const state = createLiveStepState({ concealedSeats: new Set([1]), seats: liveSeats, dataMaps });
  const responses: LiveResponse[] = [];
  let pending: RecordedStep[] = [];
  for (const [index, step] of steps.entries()) {
    pending.push(step);
    const closesResponse = index > 0 && step.observation.current?.yourIndex === HUMAN_SEAT;
    if (!closesResponse && index < steps.length - 1) {
      continue;
    }
    const beats = buildLiveSteps(
      pending.map((entry) => entry.observation),
      pending.map((entry) => entry.action),
      state,
    );
    const last = pending.at(-1)?.observation;
    responses.push({
      observations: pending,
      beats,
      humanObservation: last?.current?.yourIndex === HUMAN_SEAT ? last : undefined,
    });
    pending = [];
  }
  return { responses, beats: responses.flatMap((response) => response.beats), state };
}
