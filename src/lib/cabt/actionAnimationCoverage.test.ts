import { describe, expect, it } from 'vitest';
import { classifyAnimationCoverage, type AnimationCoverageLevel } from './actionAnimationCoverage';
import { cabtLogKindNames } from './logFormat';
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

  it('does not claim attached-card moves to hand are polished without a cross-plane animation', () => {
    const coverage = classifyAnimationCoverage(event('MoveCard', {
      fromArea: CabtAreaType.ENERGY,
      toArea: CabtAreaType.HAND,
      cardId: 3,
      serial: 12,
    }));

    expect(coverage.level).toBe('static');
    expect(coverage.label).toBe('Attached card to hand needs a cross-plane animation');
  });

  it('flags uncommon zone movements as static state changes', () => {
    // DISCARD->HAND recovery moves are now animated by design (the discard-
    // recovery flight); attached-energy-to-hand remains a genuinely static,
    // un-animated move, so it replaces it as the "uncommon static" example.
    const coverage = classifyAnimationCoverage(event('MoveCard', {
      fromArea: CabtAreaType.ENERGY,
      toArea: CabtAreaType.HAND,
      cardId: 3,
      serial: 10,
    }));

    expect(coverage.level).toBe('static');
    expect(coverage.key).toBe('MoveCard:energy->hand');
  });

  it('animates a discard recovery to hand, gated on the card identity', () => {
    const withId = classifyAnimationCoverage(event('MoveCard', {
      fromArea: CabtAreaType.DISCARD,
      toArea: CabtAreaType.HAND,
      cardId: 3,
      serial: 10,
    }));
    expect(withId.level).toBe('polished');
    expect(withId.key).toBe('MoveCard:discard->hand');

    const withoutId = classifyAnimationCoverage(event('MoveCard', {
      fromArea: CabtAreaType.DISCARD,
      toArea: CabtAreaType.HAND,
      serial: 10,
    }));
    expect(withoutId.level).toBe('conditional');
    expect(withoutId.key).toBe('MoveCard:discard->hand');
  });

  // TOTALITY GUARD (promoted from example-based): enumerate every timeline kind
  // the pipeline can emit and assert the classifier maps each to a real level,
  // and that 'unsupported' appears ONLY for the documented set. Adding a new
  // CabtLogType (which extends cabtLogKindNames) forces a coverage decision:
  // if it falls through to the unsupported fallback, this fails until it is
  // either given real coverage or added — deliberately — to the documented set.
  describe('coverage totality over the classifier domain', () => {
    // The domain: every mapped timeline kind, plus the synthesized 'Ability'
    // (never a raw log type). HP changes are canonicalized to 'HPChange' at
    // ingestion, so the classifier only ever sees that spelling.
    const domain = [...new Set([...cabtLogKindNames, 'Ability'])];

    // Kinds with no dedicated motion today — a state change with no animation.
    // Changing this set is a deliberate coverage decision, not an accident.
    const documentedUnsupported = new Set(['Devolve', 'Change', 'MoveAttached']);

    // Rich identity/area params so identity-gated kinds resolve to their best
    // (non-unsupported) case; the point is which KINDS are unsupported, not the
    // conditional/polished split, which the example tests above cover.
    const richParams = {
      cardId: 66,
      serial: 14,
      cardIdTarget: 99,
      serialTarget: 5,
      cardIdActive: 304,
      cardIdBench: 878,
      serialActive: 79,
      serialBench: 81,
      cardIdBefore: 1,
      cardIdAfter: 2,
      fromArea: CabtAreaType.DECK,
      toArea: CabtAreaType.HAND,
      attackId: 9,
      abilityName: 'Test Ability',
    };
    const validLevels: AnimationCoverageLevel[] = ['polished', 'conditional', 'static', 'unsupported'];

    it('enumerates a non-trivial domain', () => {
      expect(domain.length).toBeGreaterThan(20);
    });

    it('classifies every kind to a valid level, unsupported only for the documented set', () => {
      const unsupported = new Set<string>();
      for (const kind of domain) {
        const coverage = classifyAnimationCoverage(event(kind, richParams), [event('Attack', { cardId: 99 })]);
        expect(validLevels, `kind ${kind} produced an unknown level`).toContain(coverage.level);
        if (coverage.level === 'unsupported') {
          unsupported.add(kind);
        }
      }
      expect([...unsupported].sort()).toEqual([...documentedUnsupported].sort());
    });

    it('keeps the documented unsupported set accurate (each really is unsupported)', () => {
      for (const kind of documentedUnsupported) {
        expect(classifyAnimationCoverage(event(kind, richParams)).level, kind).toBe('unsupported');
      }
    });
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
