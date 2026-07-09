// UNIFICATION GUARD (formerly the 5c decision packet, now a permanent check).
//
// Live play (cabtProjection.cabtCardToView), replay (cabtReplay.cardToView), and
// the animation sprite builder (cardView.cabtCardToView) each turn a card id into
// a CardView. They used to classify DIFFERENTLY — live from numeric fields, the
// other two from kind-string matching — which disagreed on 51 superTypes (Special
// Energy, plus Items/Tools the heuristics mistook for Pokemon) and every stage /
// trainerType encoding. They now all route through classifyCard, so a card id
// must yield ONE classification everywhere.
//
// This runs over the full generated card DB (both cardType numbers and kind
// strings present) and asserts ZERO disagreement on the classification fields.
// It is fast (~12ms) and part of the default suite: if any builder's classifier
// drifts, this fails.
import { describe, expect, it } from 'vitest';
import cardRows from './cardData.generated.json';
import attackRows from './attackData.generated.json';
import { cabtCardToView, type CabtDataMaps } from './cabtProjection';
import { cardToView } from './cabtReplay';
import { cabtCardToView as animCardToView } from './cardView';
import type { CardView } from '../game/types';

const CLASSIFICATION_FIELDS: Array<keyof CardView> = ['superType', 'cardType', 'trainerType', 'energyType', 'stage'];

describe('card-view classifier unification (live vs replay vs animation)', () => {
  const rows = cardRows as Array<Record<string, unknown>>;
  const dataMaps: CabtDataMaps = {
    cardData: Object.fromEntries(rows.map((row) => [Number(row.id), row])) as CabtDataMaps['cardData'],
    attacks: Object.fromEntries((attackRows as Array<Record<string, unknown>>).map((a) => [Number(a.attackId), a])) as CabtDataMaps['attacks'],
  };

  it('every builder classifies every card in the DB identically', () => {
    const disagreements: Array<Record<string, unknown>> = [];
    for (const row of rows) {
      const id = Number(row.id);
      const ref = { id, serial: 1, playerIndex: 0 };
      const live = cabtCardToView(ref, dataMaps);
      const replay = cardToView({ id, serial: 1, playerIndex: 0 } as never);
      const anim = animCardToView(id);

      const diffs: Record<string, unknown> = {};
      for (const field of CLASSIFICATION_FIELDS) {
        if (live[field] !== replay[field] || live[field] !== anim[field]) {
          diffs[field] = { live: live[field], replay: replay[field], anim: anim[field] };
        }
      }
      // Retreat length is structural, but shares the same live/replay divergence
      // history — guard it here too (animation view omits retreat).
      if ((live.retreat?.length ?? 0) !== (replay.retreat?.length ?? 0)) {
        diffs.retreat = { live: live.retreat?.length ?? 0, replay: replay.retreat?.length ?? 0 };
      }
      if (Object.keys(diffs).length) {
        disagreements.push({ id, name: row.name, kind: row.kind, cardType: row.cardType, diffs });
      }
    }
    expect(disagreements).toEqual([]);
  });

  it('classifies Special Energy as Energy (the corrected live bug)', () => {
    const specialEnergy = rows.filter((row) => Number(row.cardType) === 6);
    expect(specialEnergy.length).toBeGreaterThan(0);
    for (const row of specialEnergy) {
      expect(cabtCardToView({ id: Number(row.id), serial: 1, playerIndex: 0 }, dataMaps).superType).toBe('Energy');
    }
  });
});
