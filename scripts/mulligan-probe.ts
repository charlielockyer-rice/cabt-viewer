// Offline probe: run a recorded observation sequence through the SAME live
// pipeline the engine server uses (normalize + conceal -> synthesized
// announces -> timeline -> animation phases) and print what each playback beat
// would show the browser.
//
//   npx tsx scripts/mulligan-probe.ts src/engine/__fixtures__/mulligan-human.json
//
// Recorded fixtures store the observations in engine delivery order. Live play
// receives them a bridge RESPONSE at a time — a run of the agent's own
// observations followed by the human's next one — and concealment is
// response-scoped (an agent-seat event is emitted in the human's encoding of
// the same event), so the probe regroups them the way the bridge would.
import fs from 'node:fs';
import { buildLiveSteps, createLiveStepState } from '../src/engine/liveSteps';
import { type CabtDataMaps } from '../src/lib/cabt/cabtProjection';
import type { CabtObservation } from '../src/lib/cabt/types';
import type { GameView } from '../src/lib/game/types';

const file = process.argv[2];
const recorded = JSON.parse(fs.readFileSync(file, 'utf8')) as {
  steps: Array<{ observation: CabtObservation; action: number[] | null }>;
  cards: any[];
  attacks: any[];
};
const dataMaps: CabtDataMaps = {
  cardData: Object.fromEntries(recorded.cards.map((card) => [card.cardId, card])),
  attacks: Object.fromEntries(recorded.attacks.map((attack) => [attack.attackId, attack])),
};

// Human is seat 0, bot is seat 1 -> the bot's seat is concealed, like live play.
const HUMAN_SEAT = 0;
const state = createLiveStepState({
  concealedSeats: new Set([1]),
  seats: [{ control: 'self', name: 'Player 1' }, { control: 'agent', name: 'Player 2' }],
  dataMaps,
});

function hand(view: GameView, seat: number): string {
  const player = view.players[seat];
  if (!player) return '-';
  const cards = player.hand.map((card) => (card.id === undefined || card.name === 'Card' ? '?' : card.name.slice(0, 8)));
  return `${cards.length}[${cards.join(',')}]`;
}

function eventSummary(view: GameView): string {
  const kinds = new Map<string, number>();
  for (const event of view.actionTimeline ?? []) {
    const params = (event.params ?? {}) as Record<string, unknown>;
    const key = `${event.kind}${params.fromArea !== undefined ? ` ${params.fromArea}->${params.toArea}` : ''} p${event.playerIndex}`;
    kinds.set(key, (kinds.get(key) ?? 0) + 1);
  }
  return [...kinds].map(([kind, count]) => `${count}x ${kind}`).join(', ');
}

let response: Array<{ observation: CabtObservation; action: number[] | null }> = [];
let responseIndex = 0;
let observationIndex = 0;
for (const step of recorded.steps) {
  response.push(step);
  const isResponseEnd = step.observation.current?.yourIndex === HUMAN_SEAT
    && step !== recorded.steps[0];
  if (!isResponseEnd && step !== recorded.steps.at(-1)) {
    continue;
  }
  const first = observationIndex;
  observationIndex += response.length;
  const seatRun = response.map((entry) => entry.observation.current?.yourIndex).join(',');
  const steps = buildLiveSteps(
    response.map((entry) => entry.observation),
    response.map((entry) => entry.action),
    state,
  );
  console.log(`\n== response ${responseIndex++} (observations ${first}..${observationIndex - 1}, seats ${seatRun}) -> ${steps.length} beats`);
  for (const [index, beat] of steps.entries()) {
    console.log(`   beat ${index}: key=${beat.key ?? '-'} ${beat.durationMs ?? 0}ms "${beat.label ?? ''}"`);
    console.log(`      P1 hand ${hand(beat.view, 0)} | P2 hand ${hand(beat.view, 1)} | decks ${beat.view.players.map((player) => player.deckCount).join('/')}`);
    console.log(`      events: ${eventSummary(beat.view)}`);
  }
  response = [];
}
