import { describe, expect, it } from 'vitest';
import { classifyAnimationCoverage } from './actionAnimationCoverage';
import { CabtAreaType } from './types';
import type { ActionTimelineEvent } from '../game/types';

describe('classifyAnimationCoverage', () => {
  it('recognizes polished deck reveal and search movement', () => {
    expect(classifyAnimationCoverage(event('MoveCard', {
      fromArea: CabtAreaType.DECK,
      toArea: CabtAreaType.LOOKING,
      cardId: 3,
      serial: 10,
    })).level).toBe('polished');

    expect(classifyAnimationCoverage(event('MoveCard', {
      fromArea: CabtAreaType.DECK,
      toArea: CabtAreaType.HAND,
      cardId: 3,
      serial: 10,
    })).level).toBe('polished');

    expect(classifyAnimationCoverage(event('MoveCard', {
      fromArea: CabtAreaType.DECK,
      toArea: CabtAreaType.BENCH,
      cardId: 722,
      serial: 11,
    })).label).toBe('Deck Pokemon placement to board');
  });

  it('marks reveal returns as conditional because they depend on held sprites', () => {
    const coverage = classifyAnimationCoverage(event('MoveCard', {
      fromArea: CabtAreaType.LOOKING,
      toArea: CabtAreaType.DECK,
      cardId: 3,
      serial: 10,
    }));

    expect(coverage.level).toBe('conditional');
    expect(coverage.notes[0]).toContain('reveal sprite');
  });

  it('marks reveal takes to hand as conditional because they depend on held sprites', () => {
    const coverage = classifyAnimationCoverage(event('MoveCard', {
      fromArea: CabtAreaType.LOOKING,
      toArea: CabtAreaType.HAND,
      cardId: 1158,
      serial: 10,
    }));

    expect(coverage.level).toBe('conditional');
    expect(coverage.label).toBe('Revealed card take to hand');
  });

  it('distinguishes attack knockouts from checkup knockouts', () => {
    const knockout = event('MoveCard', {
      fromArea: CabtAreaType.ACTIVE,
      toArea: CabtAreaType.DISCARD,
      cardId: 721,
      serial: 10,
    });

    expect(classifyAnimationCoverage(knockout, [event('Attack', { cardId: 99 }), knockout]).level).toBe('polished');
    expect(classifyAnimationCoverage(knockout, [knockout]).level).toBe('conditional');
  });

  it('flags complex board mutations without dedicated animation', () => {
    expect(classifyAnimationCoverage(event('MoveAttached', {
      cardId: 3,
      serial: 10,
    })).level).toBe('unsupported');
    expect(classifyAnimationCoverage(event('Devolve', {
      cardId: 723,
      serial: 10,
    })).level).toBe('unsupported');
  });

  it('recognizes board Pokemon changes as polished announcements when identity is present', () => {
    const coverage = classifyAnimationCoverage(event('Change', {
      cardIdBefore: 721,
      cardIdAfter: 722,
      serial: 14,
    }));

    expect(coverage.level).toBe('polished');
    expect(coverage.label).toBe('Board Pokemon change announcement');
  });

  it('marks board Pokemon changes conditional without an anchorable source identity', () => {
    const coverage = classifyAnimationCoverage(event('Change', {
      cardIdAfter: 722,
    }));

    expect(coverage.level).toBe('conditional');
    expect(coverage.notes[0]).toContain('source-matchable identity');
  });

  it('marks board Pokemon changes conditional without a player index', () => {
    const coverage = classifyAnimationCoverage({
      id: 1,
      kind: 'Change',
      message: 'Change',
      params: { type: 'Change', cardIdBefore: 721, cardIdAfter: 722, serial: 14 },
    });

    expect(coverage.level).toBe('conditional');
    expect(coverage.notes[0]).toContain('player index');
  });

  it('recognizes Switch as a polished active and bench board move', () => {
    const coverage = classifyAnimationCoverage(event('Switch', {
      cardIdActive: 304,
      cardIdBench: 878,
      serialActive: 79,
      serialBench: 81,
    }));

    expect(coverage.level).toBe('polished');
    expect(coverage.label).toBe('Active/bench switch');
  });

  it('recognizes attached energy moves as polished when serials are present', () => {
    const coverage = classifyAnimationCoverage(event('MoveCard', {
      fromArea: CabtAreaType.ENERGY,
      toArea: CabtAreaType.DISCARD,
      cardId: 3,
      serial: 12,
    }));

    expect(coverage.level).toBe('polished');
    expect(coverage.label).toBe('Attached card move');
  });

  it('recognizes ability announcements as polished when source identity is present', () => {
    const coverage = classifyAnimationCoverage(event('Ability', {
      cardId: 66,
      serial: 14,
      abilityName: 'Run Away Draw',
    }));

    expect(coverage.level).toBe('polished');
    expect(coverage.label).toBe('Ability announcement');
  });

  it('recognizes coin flips as polished announcements', () => {
    const coverage = classifyAnimationCoverage(event('Coin', { head: true }));

    expect(coverage.level).toBe('polished');
    expect(coverage.label).toBe('Coin flip announcement');
  });

  it('recognizes special conditions as polished announcements', () => {
    const coverage = classifyAnimationCoverage(event('Poisoned', {
      cardId: 721,
      serial: 14,
    }));

    expect(coverage.level).toBe('polished');
    expect(coverage.label).toBe('Special-condition announcement');
  });

  it('marks special-condition announcements conditional without a player index', () => {
    const coverage = classifyAnimationCoverage({
      id: 1,
      kind: 'Poisoned',
      message: 'Poisoned',
      params: { type: 'Poisoned', cardId: 721, serial: 14 },
    });

    expect(coverage.level).toBe('conditional');
    expect(coverage.notes[0]).toContain('player index');
  });

  it('recognizes board Pokemon returning to deck as polished', () => {
    const coverage = classifyAnimationCoverage(event('MoveCard', {
      fromArea: CabtAreaType.ACTIVE,
      toArea: CabtAreaType.DECK,
      cardId: 66,
      serial: 14,
    }));

    expect(coverage.level).toBe('polished');
    expect(coverage.label).toBe('Board Pokemon return to deck');
  });

  it('does not claim pre-evolution stack moves are polished without a source anchor', () => {
    const coverage = classifyAnimationCoverage(event('MoveCard', {
      fromArea: CabtAreaType.PRE_EVOLUTION,
      toArea: CabtAreaType.DECK,
      cardId: 65,
      serial: 12,
    }));

    expect(coverage.level).toBe('static');
    expect(coverage.label).toBe('Evolution stack move is projected but not animated');
  });

  it('counts attached-card moves to hand as polished when serials are available', () => {
    const coverage = classifyAnimationCoverage(event('MoveCard', {
      fromArea: CabtAreaType.ENERGY,
      toArea: CabtAreaType.HAND,
      cardId: 3,
      serial: 12,
    }));

    expect(coverage.level).toBe('polished');
    expect(coverage.label).toBe('Attached card return to hand');
  });

  it('marks attached-card moves to hand conditional without serials', () => {
    const coverage = classifyAnimationCoverage(event('MoveCard', {
      fromArea: CabtAreaType.TOOL,
      toArea: CabtAreaType.HAND,
      cardId: 99,
    }));

    expect(coverage.level).toBe('conditional');
    expect(coverage.label).toBe('Attached card return to hand');
  });

  it('flags uncommon zone movements as static state changes', () => {
    const coverage = classifyAnimationCoverage(event('MoveCard', {
      fromArea: CabtAreaType.PRIZE,
      toArea: CabtAreaType.DISCARD,
      cardId: 3,
      serial: 10,
    }));

    expect(coverage.level).toBe('static');
    expect(coverage.key).toBe('MoveCard:prize->discard');
  });

  it('recognizes discard recovery moves as polished', () => {
    expect(classifyAnimationCoverage(event('MoveCard', {
      fromArea: CabtAreaType.DISCARD,
      toArea: CabtAreaType.HAND,
      cardId: 66,
      serial: 11,
    })).label).toBe('Discard recovery to hand');

    expect(classifyAnimationCoverage(event('MoveCard', {
      fromArea: CabtAreaType.DISCARD,
      toArea: CabtAreaType.DECK,
      cardId: 305,
      serial: 17,
    })).level).toBe('polished');
  });
});

function event(kind: string, params: Record<string, unknown>): ActionTimelineEvent {
  return {
    id: 1,
    kind,
    playerIndex: 0,
    message: kind,
    params: {
      type: kind,
      playerIndex: 0,
      ...params,
    },
  };
}
