import rawDecisionFixtures from './decisionFixtures.json';
import type { DecisionView } from '../game/types';

// Decision fixtures are captured from real engine games — the gallery
// documents what CABT actually emits. Regenerate with:
//   CABT_SAMPLE_SUBMISSION_DIR=… PYTHON=… npx tsx scripts/capture-decision-fixtures.ts
export type DecisionGalleryDemo = {
  key: string;
  title: string;
  decision: DecisionView;
};

export const decisionDemos = rawDecisionFixtures as DecisionGalleryDemo[];
