import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { workspaceDeckCsvFile, workspaceDeckOptions } from './workspaceDecks';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cabt-decks-'));
const manifestFile = path.join(dir, 'decks.json');
fs.writeFileSync(
  manifestFile,
  JSON.stringify({
    decks: [
      { id: 'raging-bolt-ogerpon', name: 'Raging Bolt Ogerpon (P, 1st X)', csv: 'decks/raging-bolt-ogerpon.csv' },
      { id: 'kaggle-dragapult', name: 'Dragapult ex (Kaggle Provided)', csv: 'decks/kaggle-dragapult.csv' },
      { id: 'missing-csv', name: 'no csv field' },
    ],
  }),
);

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('workspaceDecks', () => {
  it('returns [] without a manifest', () => {
    expect(workspaceDeckOptions(undefined)).toEqual([]);
    expect(workspaceDeckOptions(path.join(dir, 'nope.json'))).toEqual([]);
  });

  it('maps valid deck entries to options with per-id CSV URLs', () => {
    const options = workspaceDeckOptions(manifestFile);
    expect(options).toHaveLength(2); // the entry missing `csv` is dropped
    expect(options[0]).toEqual({
      id: 'raging-bolt-ogerpon',
      name: 'Raging Bolt Ogerpon (P, 1st X)',
      deckUrl: '/local-engine/deck-csv/raging-bolt-ogerpon',
    });
    expect(options[1].deckUrl).toBe('/local-engine/deck-csv/kaggle-dragapult');
  });

  it('resolves a deck CSV path relative to the manifest', () => {
    expect(workspaceDeckCsvFile('kaggle-dragapult', manifestFile)).toBe(
      path.join(dir, 'decks', 'kaggle-dragapult.csv'),
    );
    expect(workspaceDeckCsvFile('missing-csv', manifestFile)).toBeUndefined();
    expect(workspaceDeckCsvFile('nope', manifestFile)).toBeUndefined();
  });
});
