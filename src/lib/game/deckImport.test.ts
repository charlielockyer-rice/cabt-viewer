import { describe, expect, it } from 'vitest';
import { parseDeckList, SAMPLE_DECK } from './deckImport';

describe('deck import', () => {
  it('skips section count headers and expands the default deck to 60 cards', () => {
    const parsed = parseDeckList(SAMPLE_DECK);

    expect(parsed.errors).toEqual([]);
    expect(parsed.cards).toHaveLength(60);
    expect(parsed.cards).toContain('Mega Abomasnow ex MEG');
    expect(parsed.cards).toContain('Waitress ASC');
    expect(parsed.cards).not.toContain('Mega Abomasnow ex MEG 36');
    expect(parsed.cards).not.toContain('Waitress ASC 215');
    expect(parsed.cards).not.toContain('Pokemon: 10');
    expect(parsed.cards).not.toContain('Trainer: 15');
    expect(parsed.cards).not.toContain('Energy: 35');
  });

  it('normalizes accented names from deck exports', () => {
    const parsed = parseDeckList('1 Poké Pad POR 81');

    expect(parsed.errors).toEqual([]);
    expect(parsed.cards).toEqual(['Poke Pad POR']);
  });

  it('normalizes TCG Live basic energy shorthand', () => {
    const parsed = parseDeckList('7 Basic {W} Energy MEE 3');

    expect(parsed.errors).toEqual([]);
    expect(parsed.cards).toEqual([
      'Water Energy MEE',
      'Water Energy MEE',
      'Water Energy MEE',
      'Water Energy MEE',
      'Water Energy MEE',
      'Water Energy MEE',
      'Water Energy MEE',
    ]);
  });
});
