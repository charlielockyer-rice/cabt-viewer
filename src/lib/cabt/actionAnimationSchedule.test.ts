import { describe, expect, it } from 'vitest';
import {
  actionAnimationPhaseKey,
  actionAnimationPhaseMayHavePlan,
  actionAnimationPhaseNeedsDedicatedView,
  actionAnimationPhaseUsesSourceView,
  actionAnimationTimelinePhaseKey,
  actionAnimationTimelinePhaseKeyForEvent,
} from './actionAnimationPhases';
import { actionAnimationBatchEvents, actionAnimationStartMs, actionAnimationTiming } from './actionAnimationSchedule';
import { CabtAreaType } from './types';
import type { ActionTimelineEvent } from '../game/types';

describe('actionAnimationStartMs', () => {
  it('sequences Lillie-style play, hand return, shuffle, and draw phases', () => {
    const events: ActionTimelineEvent[] = [
      event(1, 'Play', { cardId: 1227, serial: 80 }),
      event(2, 'MoveCard', { cardId: 3, serial: 102, fromArea: CabtAreaType.HAND, toArea: CabtAreaType.DECK }),
      event(3, 'MoveCard', { cardId: 3, serial: 100, fromArea: CabtAreaType.HAND, toArea: CabtAreaType.DECK }),
      event(4, 'Shuffle', {}),
      event(5, 'Draw', { cardId: 3, serial: 122 }),
      event(6, 'Draw', { cardId: 1145, serial: 77 }),
    ];

    expect(actionAnimationStartMs(events, events[0])).toBe(0);
    expect(actionAnimationStartMs(events, events[1])).toBe(actionAnimationTiming.handMoveMs);
    expect(actionAnimationStartMs(events, events[2])).toBe(actionAnimationTiming.handMoveMs + actionAnimationTiming.handMoveStepMs);
    expect(actionAnimationStartMs(events, events[3])).toBe(
      actionAnimationTiming.handMoveMs
        + actionAnimationTiming.handMoveMs
        + actionAnimationTiming.handMoveStepMs,
    );
    expect(actionAnimationStartMs(events, events[4])).toBe(
      actionAnimationTiming.handMoveMs
        + actionAnimationTiming.handMoveMs
        + actionAnimationTiming.handMoveStepMs
        + actionAnimationTiming.deckShuffleMs,
    );
    expect(actionAnimationStartMs(events, events[5])).toBe(
      actionAnimationTiming.handMoveMs
        + actionAnimationTiming.handMoveMs
        + actionAnimationTiming.handMoveStepMs
        + actionAnimationTiming.deckShuffleMs
        + actionAnimationTiming.deckDrawStepMs,
    );
  });

  it('sequences attack consequences in gameplay order', () => {
    const events: ActionTimelineEvent[] = [
      event(1, 'Attack', { cardId: 721 }),
      event(2, 'MoveCard', { cardId: 3, serial: 101, fromArea: CabtAreaType.DECK, toArea: CabtAreaType.DISCARD }),
      event(3, 'MoveCard', { cardId: 3, serial: 102, fromArea: CabtAreaType.DECK, toArea: CabtAreaType.DISCARD }),
      event(4, 'HpChange', { value: -200 }),
      event(5, 'MoveCard', { cardId: 721, serial: 64, fromArea: CabtAreaType.ACTIVE, toArea: CabtAreaType.DISCARD }),
    ];

    expect(actionAnimationStartMs(events, events[0])).toBe(0);
    expect(actionAnimationStartMs(events, events[1])).toBe(actionAnimationTiming.attackAnnounceMs);
    expect(actionAnimationStartMs(events, events[2])).toBe(
      actionAnimationTiming.attackAnnounceMs + actionAnimationTiming.deckDiscardStepMs,
    );
    expect(actionAnimationStartMs(events, events[3])).toBe(
      actionAnimationTiming.attackAnnounceMs
        + actionAnimationTiming.deckDiscardMs
        + actionAnimationTiming.deckDiscardStepMs,
    );
    expect(actionAnimationStartMs(events, events[4])).toBe(
      actionAnimationTiming.attackAnnounceMs
        + actionAnimationTiming.deckDiscardMs
        + actionAnimationTiming.deckDiscardStepMs
        + actionAnimationTiming.damageVisualMs,
    );
  });

  it('uses shared timeline filtering so knockout-owned attachments do not create a competing phase', () => {
    const events: ActionTimelineEvent[] = [
      event(1, 'Attack', { cardId: 721 }),
      event(2, 'HpChange', { value: -200 }),
      event(3, 'MoveCard', { cardId: 721, serial: 64, fromArea: CabtAreaType.ACTIVE, toArea: CabtAreaType.DISCARD }),
      event(4, 'MoveCard', { cardId: 3, serial: 96, fromArea: CabtAreaType.ENERGY, toArea: CabtAreaType.DISCARD }),
      event(5, 'Draw', { cardId: 3, serial: 12 }),
    ];

    expect(actionAnimationStartMs(events, events[1])).toBe(actionAnimationTiming.attackAnnounceMs);
    expect(actionAnimationStartMs(events, events[2])).toBe(
      actionAnimationTiming.attackAnnounceMs + actionAnimationTiming.damageVisualMs,
    );
    expect(actionAnimationStartMs(events, events[4])).toBe(
      actionAnimationTiming.attackAnnounceMs
        + actionAnimationTiming.damageVisualMs
        + actionAnimationTiming.knockOutMs,
    );
  });

  it('gives evolution its own animation duration before follow-up effects', () => {
    const events: ActionTimelineEvent[] = [
      event(1, 'Evolve', { cardId: 723, serial: 13 }),
      event(2, 'Shuffle', {}),
    ];

    expect(actionAnimationStartMs(events, events[0])).toBe(0);
    expect(actionAnimationStartMs(events, events[1])).toBe(actionAnimationTiming.evolveMs);
  });

  it('announces abilities before their follow-up effects', () => {
    const events: ActionTimelineEvent[] = [
      event(1, 'Ability', { cardId: 66, serial: 14, abilityName: 'Run Away Draw' }),
      event(2, 'Draw', { cardId: 3, serial: 12 }),
      event(3, 'Shuffle', {}),
    ];

    expect(actionAnimationStartMs(events, events[0])).toBe(0);
    expect(actionAnimationStartMs(events, events[1])).toBe(actionAnimationTiming.abilityAnnounceMs);
    expect(actionAnimationStartMs(events, events[2])).toBe(
      actionAnimationTiming.abilityAnnounceMs + actionAnimationTiming.deckDrawMs,
    );
  });

  it('announces coin flips before their follow-up effects', () => {
    const events: ActionTimelineEvent[] = [
      event(1, 'Coin', { head: true }),
      event(2, 'Draw', { cardId: 3, serial: 12 }),
    ];

    expect(actionAnimationStartMs(events, events[0])).toBe(0);
    expect(actionAnimationStartMs(events, events[1])).toBe(actionAnimationTiming.coinAnnounceMs);
  });

  it('announces board Pokemon changes before their follow-up effects', () => {
    const events: ActionTimelineEvent[] = [
      event(1, 'Change', { cardIdBefore: 721, cardIdAfter: 722, serial: 14 }),
      event(2, 'Draw', { cardId: 3, serial: 12 }),
    ];

    expect(actionAnimationStartMs(events, events[0])).toBe(0);
    expect(actionAnimationStartMs(events, events[1])).toBe(actionAnimationTiming.conditionAnnounceMs);
  });

  it('announces special conditions before their follow-up effects', () => {
    const events: ActionTimelineEvent[] = [
      event(1, 'Poisoned', { cardId: 721, serial: 14 }),
      event(2, 'HpChange', { cardId: 721, serial: 14, value: -10 }),
    ];

    expect(actionAnimationStartMs(events, events[0])).toBe(0);
    expect(actionAnimationStartMs(events, events[1])).toBe(actionAnimationTiming.conditionAnnounceMs);
  });

  it('sequences board Pokemon returning to deck before follow-up effects', () => {
    const events: ActionTimelineEvent[] = [
      event(1, 'MoveCard', { cardId: 66, serial: 14, fromArea: CabtAreaType.ACTIVE, toArea: CabtAreaType.DECK }),
      event(2, 'Shuffle', {}),
    ];

    expect(actionAnimationStartMs(events, events[0])).toBe(0);
    expect(actionAnimationStartMs(events, events[1])).toBe(actionAnimationTiming.boardMoveMs);
  });

  it('animates board position moves without staggering paired moves', () => {
    const events: ActionTimelineEvent[] = [
      event(1, 'MoveCard', { cardId: 722, serial: 10, fromArea: CabtAreaType.BENCH, toArea: CabtAreaType.ACTIVE }),
      event(2, 'MoveCard', { cardId: 721, serial: 11, fromArea: CabtAreaType.ACTIVE, toArea: CabtAreaType.BENCH }),
      event(3, 'Draw', { cardId: 3, serial: 12 }),
    ];

    expect(actionAnimationStartMs(events, events[0])).toBe(0);
    expect(actionAnimationStartMs(events, events[1])).toBe(0);
    expect(actionAnimationStartMs(events, events[2])).toBe(actionAnimationTiming.boardMoveMs);
  });

  it('sequences Switch as a single board move before follow-up effects', () => {
    const events: ActionTimelineEvent[] = [
      event(1, 'Switch', {
        cardIdActive: 304,
        cardIdBench: 878,
        serialActive: 79,
        serialBench: 81,
      }),
      event(2, 'Draw', { cardId: 3, serial: 12 }),
    ];

    expect(actionAnimationStartMs(events, events[0])).toBe(0);
    expect(actionAnimationStartMs(events, events[1])).toBe(actionAnimationTiming.boardMoveMs);
  });

  it('sequences deck reveal cards after a played supporter', () => {
    const events: ActionTimelineEvent[] = [
      event(1, 'Play', { cardId: 1235, serial: 26 }),
      event(2, 'MoveCard', { cardId: 3, serial: 32, fromArea: CabtAreaType.DECK, toArea: CabtAreaType.LOOKING }),
      event(3, 'MoveCard', { cardId: 3, serial: 58, fromArea: CabtAreaType.DECK, toArea: CabtAreaType.LOOKING }),
    ];

    expect(actionAnimationStartMs(events, events[1])).toBe(actionAnimationTiming.handMoveMs);
    expect(actionAnimationStartMs(events, events[2])).toBe(actionAnimationTiming.handMoveMs + actionAnimationTiming.deckRevealStepMs);
  });

  it('sequences deck search reveals before the follow-up shuffle', () => {
    const events: ActionTimelineEvent[] = [
      event(1, 'Play', { cardId: 1145, serial: 14 }),
      event(2, 'MoveCard', { cardId: 723, serial: 13, fromArea: CabtAreaType.DECK, toArea: CabtAreaType.HAND }),
      event(3, 'Shuffle', {}),
    ];

    expect(actionAnimationStartMs(events, events[1])).toBe(actionAnimationTiming.handMoveMs);
    expect(actionAnimationStartMs(events, events[2])).toBe(actionAnimationTiming.handMoveMs + actionAnimationTiming.deckRevealMs);
  });

  it('sequences deck-to-board placement before follow-up effects', () => {
    const events: ActionTimelineEvent[] = [
      event(1, 'MoveCard', { cardId: 722, serial: 13, fromArea: CabtAreaType.DECK, toArea: CabtAreaType.BENCH }),
      event(2, 'Shuffle', {}),
    ];

    expect(actionAnimationStartMs(events, events[0])).toBe(0);
    expect(actionAnimationStartMs(events, events[1])).toBe(actionAnimationTiming.boardMoveMs);
  });

  it('sequences revealed cards returning before the follow-up shuffle', () => {
    const events: ActionTimelineEvent[] = [
      event(1, 'MoveCard', { cardId: 3, serial: 58, fromArea: CabtAreaType.LOOKING, toArea: CabtAreaType.DECK }),
      event(2, 'MoveCard', { cardId: 1227, serial: 22, fromArea: CabtAreaType.LOOKING, toArea: CabtAreaType.DECK }),
      event(3, 'Shuffle', {}),
    ];

    expect(actionAnimationStartMs(events, events[1])).toBe(actionAnimationTiming.deckRevealReturnStepMs);
    expect(actionAnimationStartMs(events, events[2])).toBe(
      actionAnimationTiming.deckRevealReturnMs + actionAnimationTiming.deckRevealReturnStepMs,
    );
  });

  it('sequences revealed cards taken to hand before follow-up effects', () => {
    const events: ActionTimelineEvent[] = [
      event(1, 'MoveCard', { cardId: 1158, serial: 58, fromArea: CabtAreaType.LOOKING, toArea: CabtAreaType.HAND }),
      event(2, 'Shuffle', {}),
    ];

    expect(actionAnimationStartMs(events, events[0])).toBe(0);
    expect(actionAnimationStartMs(events, events[1])).toBe(actionAnimationTiming.handMoveMs);
  });

  it('sequences Prize takes before follow-up effects', () => {
    const events: ActionTimelineEvent[] = [
      event(1, 'MoveCard', { cardId: 96, serial: 120, fromArea: CabtAreaType.PRIZE, toArea: CabtAreaType.HAND }),
      event(2, 'MoveCard', { cardId: 1261, serial: 121, fromArea: CabtAreaType.PRIZE, toArea: CabtAreaType.HAND }),
      event(3, 'Shuffle', {}),
    ];

    expect(actionAnimationStartMs(events, events[1])).toBe(actionAnimationTiming.prizeTakeStepMs);
    expect(actionAnimationStartMs(events, events[2])).toBe(
      actionAnimationTiming.prizeTakeMs + actionAnimationTiming.prizeTakeStepMs,
    );
  });

  it('sequences attached energy moves before follow-up effects', () => {
    const events: ActionTimelineEvent[] = [
      event(1, 'MoveCard', { cardId: 3, serial: 12, fromArea: CabtAreaType.ENERGY, toArea: CabtAreaType.DISCARD }),
      event(2, 'Draw', { cardId: 4, serial: 13 }),
    ];

    expect(actionAnimationStartMs(events, events[0])).toBe(0);
    expect(actionAnimationStartMs(events, events[1])).toBe(actionAnimationTiming.handMoveMs);
  });

  it('sequences discard recovery moves before follow-up effects', () => {
    const events: ActionTimelineEvent[] = [
      event(1, 'MoveCard', { cardId: 66, serial: 12, fromArea: CabtAreaType.DISCARD, toArea: CabtAreaType.HAND }),
      event(2, 'MoveCard', { cardId: 305, serial: 13, fromArea: CabtAreaType.DISCARD, toArea: CabtAreaType.DECK }),
      event(3, 'Shuffle', {}),
    ];

    expect(actionAnimationStartMs(events, events[0])).toBe(0);
    expect(actionAnimationStartMs(events, events[1])).toBe(actionAnimationTiming.handMoveMs);
    expect(actionAnimationStartMs(events, events[2])).toBe(
      actionAnimationTiming.handMoveMs + actionAnimationTiming.handMoveMs,
    );
  });
});

describe('actionAnimationBatchEvents', () => {
  it('scopes live animation scheduling to newly appended timeline events', () => {
    const events: ActionTimelineEvent[] = [
      event(1, 'Play', { cardId: 1, serial: 10 }),
      event(2, 'Shuffle', {}),
      event(3, 'Play', { cardId: 2, serial: 11 }),
      event(4, 'Draw', { cardId: 3, serial: 12 }),
    ];

    expect(actionAnimationBatchEvents(events, new Set([1, 2]))).toEqual([
      events[2],
      events[3],
    ]);
    expect(actionAnimationStartMs(actionAnimationBatchEvents(events, new Set([1, 2])), events[3])).toBe(
      actionAnimationTiming.handMoveMs,
    );
  });

});

describe('actionAnimationPhaseKey', () => {
  it('uses the same semantic phase keys for scheduling and replay rendering', () => {
    expect(actionAnimationPhaseKey(event(1, 'MoveCard', {
      fromArea: CabtAreaType.ACTIVE,
      toArea: CabtAreaType.BENCH,
    }))).toBe('BoardMove:1');
    expect(actionAnimationPhaseKey(event(2, 'MoveCard', {
      fromArea: CabtAreaType.ENERGY,
      toArea: CabtAreaType.HAND,
    }))).toBe(`AttachedMove:1:${CabtAreaType.ENERGY}->${CabtAreaType.HAND}`);
    expect(actionAnimationPhaseKey(event(3, 'MoveCard', {
      fromArea: CabtAreaType.HAND,
      toArea: CabtAreaType.DECK,
    }))).toBe('HandToDeck:1');
    expect(actionAnimationPhaseKey(event(4, 'Poisoned', {}))).toBe('Condition:1');
    expect(actionAnimationPhaseKey(event(5, 'Change', {}))).toBe('Change:1');
    expect(actionAnimationPhaseKey(event(6, 'Devolve', {}))).toBe('Devolve:1');
    expect(actionAnimationPhaseKey(event(7, 'MoveAttached', {}))).toBe('MoveAttached:1');
  });

  it('keeps board and attached motions on source-owned phase views with animation plans', () => {
    const keys = [
      'BoardMove:0',
      'BoardToDeck:0',
      `AttachedMove:0:${CabtAreaType.TOOL}->${CabtAreaType.DISCARD}`,
      'StadiumMove:0:6->3',
    ];

    for (const key of keys) {
      expect(actionAnimationPhaseUsesSourceView(key)).toBe(true);
      expect(actionAnimationPhaseNeedsDedicatedView(key)).toBe(true);
      expect(actionAnimationPhaseMayHavePlan(key)).toBe(true);
    }
  });

  it('centralizes timeline-only suppression for non-attack damage and knockout-owned attachment moves', () => {
    const attack = event(1, 'Attack', {});
    const damage = event(2, 'HpChange', {});
    const knockOut = event(3, 'MoveCard', {
      fromArea: CabtAreaType.ACTIVE,
      toArea: CabtAreaType.DISCARD,
    });
    const attachedDiscard = event(4, 'MoveCard', {
      fromArea: CabtAreaType.ENERGY,
      toArea: CabtAreaType.DISCARD,
    });

    expect(actionAnimationTimelinePhaseKey(damage, [])).toBeNull();
    expect(actionAnimationTimelinePhaseKey(knockOut, [])).toBeNull();
    expect(actionAnimationTimelinePhaseKey(attack, [])).toBe('Attack:1');
    expect(actionAnimationTimelinePhaseKey(damage, ['Attack:1'])).toBe('Damage:1');
    expect(actionAnimationTimelinePhaseKey(damage, ['Condition:1'])).toBe('Damage:1');
    expect(actionAnimationTimelinePhaseKey(knockOut, ['Attack:1', 'Damage:1'])).toBe('KnockOut:1');
    expect(actionAnimationTimelinePhaseKey(attachedDiscard, ['Attack:1', 'Damage:1', 'KnockOut:1'])).toBeNull();
  });

  it('can classify an event against its full timeline batch for live component ownership checks', () => {
    const events = [
      event(1, 'Attack', {}),
      event(2, 'HpChange', {}),
      event(3, 'MoveCard', {
        fromArea: CabtAreaType.ACTIVE,
        toArea: CabtAreaType.DISCARD,
      }),
      event(4, 'MoveCard', {
        fromArea: CabtAreaType.ENERGY,
        toArea: CabtAreaType.DISCARD,
      }),
    ];

    expect(actionAnimationTimelinePhaseKeyForEvent(events, events[1])).toBe('Damage:1');
    expect(actionAnimationTimelinePhaseKeyForEvent(events, events[2])).toBe('KnockOut:1');
    expect(actionAnimationTimelinePhaseKeyForEvent(events, events[3])).toBeNull();
  });
});

function event(id: number, kind: string, params: Record<string, unknown>): ActionTimelineEvent {
  return {
    id,
    kind,
    playerIndex: 1,
    message: kind,
    params: {
      type: kind,
      playerIndex: 1,
      ...params,
    },
  };
}
