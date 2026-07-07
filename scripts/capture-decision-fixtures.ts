// Captures real engine decisions for the prompt gallery: plays a first-legal
// game through the bridge and records one projected DecisionView per kind
// (plus a few distinct contexts), so the gallery documents what CABT
// actually emits instead of hand-written shapes.
//
//   CABT_SAMPLE_SUBMISSION_DIR=… PYTHON=… npx tsx scripts/capture-decision-fixtures.ts
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { projectDecision, type CabtDataMaps } from '../src/lib/cabt/cabtProjection';
import type { CabtObservation } from '../src/lib/cabt/types';
import rawCardRows from '../src/lib/cabt/cardData.generated.json';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_ROOT = path.resolve(__dirname, '..');
const BRIDGE_PATH = path.join(FRONTEND_ROOT, 'src', 'engine', 'cabt_bridge.py');
const DECK_PATH = path.join(FRONTEND_ROOT, 'public', 'agents', 'official-random-abomasnow', 'deck.csv');
const OUT_PATH = path.join(FRONTEND_ROOT, 'src', 'lib', 'prompt-gallery', 'decisionFixtures.json');

const sampleSubmissionDir = process.env.CABT_SAMPLE_SUBMISSION_DIR;
if (!sampleSubmissionDir) {
  console.error('CABT_SAMPLE_SUBMISSION_DIR is required.');
  process.exit(1);
}

const rows = new Map((rawCardRows as Array<{ id: number; set: string; setNumber: string }>).map((row) => [row.id, row]));

function toDataMaps(cards: any[], attacks: any[]): CabtDataMaps {
  return {
    cardData: Object.fromEntries(cards.map((card) => {
      const row = rows.get(card.cardId);
      return [card.cardId, row ? { ...card, set: row.set, setNumber: row.setNumber } : card];
    })),
    attacks: Object.fromEntries(attacks.map((attack) => [attack.attackId, attack])),
  };
}

async function main() {
  const python = process.env.PYTHON ?? 'python3';
  const child = spawn(python, [BRIDGE_PATH], {
    env: { ...process.env, CABT_SAMPLE_SUBMISSION_DIR: sampleSubmissionDir },
  });
  const lines = readline.createInterface({ input: child.stdout });
  const pending: Array<(value: any) => void> = [];
  lines.on('line', (line) => {
    try {
      pending.shift()?.(JSON.parse(line));
    } catch {
      // ignore non-protocol output
    }
  });
  const request = (message: Record<string, unknown>) =>
    new Promise<any>((resolve) => {
      pending.push(resolve);
      child.stdin.write(`${JSON.stringify(message)}\n`);
    });

  const deck = fs.readFileSync(DECK_PATH, 'utf8').split('\n').filter(Boolean).map(Number);
  const response = await request({
    id: 1,
    command: 'start',
    deck0: deck,
    deck1: deck,
    agentPaths: [null, null],
    agentControlled: [true, true],
  });
  if (!response.ok) {
    throw new Error(response.error);
  }
  const dataMaps = toDataMaps(response.cards, response.attacks);

  const captured = new Map<string, { key: string; title: string; decision: unknown }>();
  let seq = 1;
  for (const observation of response.autoSteps as CabtObservation[]) {
    const decision = projectDecision(observation, seq++, dataMaps);
    if (!decision || !decision.options.length) {
      continue;
    }
    const context = (observation.select as { context?: number } | null)?.context ?? -1;
    const key = `${decision.kind}-context-${context}`;
    if (!captured.has(key)) {
      captured.set(key, {
        key,
        title: `${decision.kind} · ${decision.message}`,
        decision,
      });
    }
  }

  const fixtures = [...captured.values()];
  fs.writeFileSync(OUT_PATH, `${JSON.stringify(fixtures, null, 2)}\n`);
  console.log(`captured ${fixtures.length} decision fixtures -> ${OUT_PATH}`);
  for (const fixture of fixtures) {
    console.log(`  ${fixture.key}`);
  }
  child.kill('SIGKILL');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
