import { readFileSync } from 'node:fs';
import { cabtReplayToSnapshot } from './src/lib/cabt/cabtReplay';

const [, , path] = process.argv;
const raw = JSON.parse(readFileSync(path, 'utf8'));
const root = raw.environment ?? raw;
let data = root.visualize ? root : root.steps[0][0].visualize;
if (typeof data === 'string') {
  data = JSON.parse(data);
}
const snapshot = cabtReplayToSnapshot(Array.isArray(data) ? { visualize: data } : data);
for (const step of snapshot.steps) {
  const kinds = (step.actionTimeline ?? []).map((event) => event.kind).join(',');
  console.log(`${step.stateIndex} | ${step.label} | ${kinds}`);
}
