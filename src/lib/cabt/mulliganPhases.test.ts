import { describe, expect, it } from 'vitest';
import { runLiveFixture, type LiveResponse } from '../../engine/__fixtures__/liveFixture';
import type { LiveStep } from '../../engine/liveSteps';
import type { ActionTimelineEvent, CardView } from '../game/types';
import { CabtAreaType } from './types';

// The engine resolves a player's whole mulligan sequence inside ONE
// observation: fail the Basic check, return seven cards, shuffle, draw seven,
// repeat — 19 times in mulligan-human.json. Animated cycle by cycle that is
// nearly a minute of shuffling, and every intermediate "drew 7" shows the
// FINAL hand, because the settled hand is the only one that exists. The run
// collapses to one beat per player per batch.

function mulliganBeats(response: LiveResponse): LiveStep[] {
  return response.beats.filter((beat) => beat.key?.startsWith('Mulligan:'));
}

function timeline(beat: LiveStep): ActionTimelineEvent[] {
  return beat.view.actionTimeline ?? [];
}

function isHandToDeck(event: ActionTimelineEvent): boolean {
  const params = (event.params ?? {}) as Record<string, unknown>;
  return (event.kind === 'MoveCard' || event.kind === 'MoveCardReverse')
    && Number(params.fromArea) === CabtAreaType.HAND
    && Number(params.toArea) === CabtAreaType.DECK;
}

function isDraw(event: ActionTimelineEvent): boolean {
  return event.kind === 'Draw' || event.kind === 'DrawReverse';
}

function handKey(hand: CardView[]): string {
  return hand.map((card) => card.serial ?? card.id ?? '?').join('/');
}

describe('mulligan beats', () => {
  it.each(['mulligan-human.json', 'mulligan-both.json', 'mulligan-bot.json'])(
    'emits at most one mulligan beat per player per batch in %s',
    (fixture) => {
      const run = runLiveFixture(fixture);
      const seen = new Set<string>();
      let beats = 0;
      for (const [responseIndex, response] of run.responses.entries()) {
        for (const beat of mulliganBeats(response)) {
          const key = `${responseIndex}:${beat.observationIndex}:${beat.key}`;
          expect(seen.has(key)).toBe(false);
          seen.add(key);
          beats += 1;
        }
      }
      expect(beats).toBeGreaterThan(0);
    },
  );

  it('collapses the human 19-cycle setup into two beats, one per batch', () => {
    const run = runLiveFixture('mulligan-human.json');
    const response = run.responses[0];

    // The 327-log observation resolved 18 more failed checks; the whole
    // response — opening draws, the opponent's setup and all of it — is four
    // beats. It was 60.
    expect(response.beats.length).toBeLessThanOrEqual(4);
    expect(mulliganBeats(response).map((beat) => beat.label)).toEqual([
      'Player 1 mulliganed ×1 — opponent may draw up to 1',
      'Player 1 mulliganed ×18 — opponent may draw up to 18',
    ]);

    // The beat is exactly: one return set, one shuffle, one deal, one announce.
    const beat = mulliganBeats(response)[1];
    const events = timeline(beat);
    expect(events.filter(isHandToDeck)).toHaveLength(7);
    expect(events.filter((event) => event.kind === 'Shuffle')).toHaveLength(1);
    expect(events.filter(isDraw)).toHaveLength(7);
    const announce = events.filter((event) => event.kind === 'Ability');
    expect(announce).toHaveLength(1);
    expect(announce[0].params).toMatchObject({ abilityName: 'Mulligan ×18', slotAnnounce: true });
    expect(events).toHaveLength(16);
    // return + shuffle + deal
    expect(beat.durationMs).toBe(720 + 980 + 530);
  });

  it('never deals the human an intermediate hand', () => {
    const run = runLiveFixture('mulligan-human.json');
    const response = run.responses[0];
    const settled = response.humanObservation!.current!.players[0];

    // Two full hands are ever shown: the opening one they mulligan away, and
    // the one they keep. Cycle-by-cycle animation showed twenty, all of them
    // the settled hand.
    const fullHands = response.beats
      .map((beat) => beat.view.players[0].hand)
      .filter((hand) => hand.length === 7);
    expect(new Set(fullHands.map(handKey)).size).toBe(2);
    expect(fullHands.at(-1)!.map((card) => card.serial)).toEqual(settled.hand!.map((card) => card.serial));

    // No beat holds a card the human neither opened with nor kept.
    const allowed = new Set(fullHands[0].map((card) => card.serial));
    for (const card of settled.hand!) {
      allowed.add(card.serial);
    }
    for (const beat of response.beats) {
      for (const card of beat.view.players[0].hand) {
        expect(allowed.has(card.serial)).toBe(true);
      }
    }
  });

  it('gives each player their own beat when both mulligan in one batch', () => {
    const run = runLiveFixture('mulligan-both.json');
    const response = run.responses[0];

    // The 272-event observation resolves both openings at once.
    expect(response.beats.length).toBeLessThanOrEqual(6);
    const batch = response.beats.filter((beat) => beat.observationIndex === 1);
    expect(batch.map((beat) => beat.key)).toEqual(['Mulligan:0', 'Mulligan:1']);
    expect(batch.map((beat) => beat.label)).toEqual([
      'Player 1 mulliganed ×9 — opponent may draw up to 9',
      // The agent's own mulligans hand the HUMAN the extra cards, so no advice.
      'Player 2 mulliganed ×8',
    ]);
  });

  it('returns the agent hand face-down and keeps its beat whole across batches', () => {
    const run = runLiveFixture('mulligan-bot.json');
    const beats = run.responses.flatMap(mulliganBeats);

    expect(beats.map((beat) => beat.label)).toEqual([
      'Player 2 mulliganed ×1',
      // The engine split this mulligan across observations (the human acted in
      // between); the failed check was announced by the first beat, so the
      // beat that resolves it does not count it again.
      'Player 2 redrew their opening hand.',
    ]);

    const resolving = timeline(beats[1]);
    const returns = resolving.filter(isHandToDeck);
    expect(returns).toHaveLength(7);
    for (const event of returns) {
      // A concealed hand goes back face-down, from the slots it is rendered in.
      expect(event.kind).toBe('MoveCardReverse');
      expect((event.params as Record<string, unknown>).cardId).toBeUndefined();
      expect((event.params as Record<string, unknown>).serial).toBeDefined();
    }
  });
});
