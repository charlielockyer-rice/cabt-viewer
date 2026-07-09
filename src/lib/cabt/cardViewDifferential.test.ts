// 5c DECISION PACKET (report-only, no production change to the classifiers).
//
// The live pipeline (cabtProjection.cabtCardToView) and the replay pipeline
// (cabtReplay.cardToView) each turn a card id into a CardView, but classify
// DIFFERENTLY: live from structured fields (cardType/energyType/basic), replay
// from kind-string matching. The generated card DB carries BOTH kind strings
// and cardType fields, so both classifiers can run side-by-side on the same
// rows here (no live bridge dataMaps needed) to quantify the disagreement — the
// number that decides whether unifying 5c is mechanical, per-card review, or a
// sign something deeper is off.
//
// Skipped by default (it is a report, not a guard, and prints a large table).
// Run it with: CABT_CARD_DIFFERENTIAL=1 npx vitest run cardViewDifferential
//
// NOTE for the follow-up: this compares both classifiers on the GENERATED JSON.
// Validating live specifically against real bridge-sourced dataMaps (whose
// shape can differ from the generated rows) remains part of the 5c follow-up.
import { describe, expect, it } from 'vitest';
import cardRows from './cardData.generated.json';
import attackRows from './attackData.generated.json';
import { cabtCardToView, type CabtDataMaps } from './cabtProjection';
import { cardToView } from './cabtReplay';
import type { CardView } from '../game/types';

const enabled = !!process.env.CABT_CARD_DIFFERENTIAL;

describe.skipIf(!enabled)('card-view builder differential (live vs replay)', () => {
  it('reports per-field disagreements over the full generated card DB', () => {
    const rows = cardRows as Array<Record<string, unknown>>;
    const dataMaps: CabtDataMaps = {
      cardData: Object.fromEntries(rows.map((row) => [Number(row.id), row])) as CabtDataMaps['cardData'],
      attacks: Object.fromEntries((attackRows as Array<Record<string, unknown>>).map((a) => [Number(a.attackId), a])) as CabtDataMaps['attacks'],
    };

    const fields: Array<keyof CardView> = ['superType', 'cardType', 'trainerType', 'energyType', 'stage'];
    const disagreeByField: Record<string, number> = Object.fromEntries(fields.map((f) => [f, 0]));
    let retreatDisagree = 0;
    const cardsWithAnyDisagreement: Array<Record<string, unknown>> = [];

    for (const row of rows) {
      const id = Number(row.id);
      const ref = { id, serial: 1, playerIndex: 0 };
      const live = cabtCardToView(ref, dataMaps);
      const replay = cardToView({ id, serial: 1, playerIndex: 0 } as never);

      const diffs: Record<string, unknown> = {};
      for (const field of fields) {
        if (live[field] !== replay[field]) {
          disagreeByField[field] += 1;
          diffs[field] = { live: live[field], replay: replay[field] };
        }
      }
      const liveRetreat = live.retreat?.length ?? 0;
      const replayRetreat = replay.retreat?.length ?? 0;
      if (liveRetreat !== replayRetreat) {
        retreatDisagree += 1;
        diffs.retreat = { live: liveRetreat, replay: replayRetreat };
      }
      if (Object.keys(diffs).length) {
        cardsWithAnyDisagreement.push({ id, name: row.name, kind: row.kind, cardType: row.cardType, diffs });
      }
    }

    const report = {
      totalCards: rows.length,
      cardsWithAnyDisagreement: cardsWithAnyDisagreement.length,
      disagreeByField: { ...disagreeByField, retreat: retreatDisagree },
      sample: cardsWithAnyDisagreement.slice(0, 40),
    };
    // eslint-disable-next-line no-console
    console.log('[5c card-view differential]', JSON.stringify(report, null, 2));

    expect(rows.length).toBeGreaterThan(1000);
  });
});
