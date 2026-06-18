export type ParsedDeck = {
  cards: string[];
  errors: string[];
};

export const SAMPLE_DECK = `Pokemon: 10
2 Kyogre MEG 34
4 Snover MEG 35
4 Mega Abomasnow ex MEG 36

Trainer: 15
1 Maximum Belt TEF 154
4 Mega Signal MEG 121
2 Cyrano SSP 170
4 Lillie's Determination MEG 119
4 Waitress ASC 215

Energy: 35
35 Basic {W} Energy SVE 3`;

export function parseDeckList(text: string): ParsedDeck {
  const cards: string[] = [];
  const errors: string[] = [];
  const lines = text.split(/\r?\n/);

  lines.forEach((rawLine, idx) => {
    const line = rawLine.replace(/\s+#.*$/, '').trim();
    if (!line) {
      return;
    }
    if (/^[^\d:][^:]+:\s*\d+\s*$/.test(line)) {
      return;
    }

    const match = line.match(/^(\d+)\s+(.+)$/);
    const count = match ? Number(match[1]) : 1;
    const name = (match ? match[2] : line)?.trim() ?? '';
    if (!Number.isInteger(count) || count < 1 || count > 60) {
      errors.push(`Line ${idx + 1}: invalid count.`);
      return;
    }
    const tokens = name.split(/\s+/);
    const hasCollectorNumber = /^\d+[a-z]?$/i.test(tokens.at(-1) ?? '');
    const setCode = hasCollectorNumber ? tokens.at(-2) : tokens.at(-1);
    if (!name || !/^[A-Z0-9-]{2,8}$/.test(setCode ?? '')) {
      errors.push(`Line ${idx + 1}: card names must include a set code, for example "Ralts SIT".`);
      return;
    }
    const normalizedName = normalizeImportName(hasCollectorNumber ? tokens.slice(0, -1).join(' ') : name);
    for (let i = 0; i < count; i += 1) {
      cards.push(normalizedName);
    }
  });

  if (cards.length === 0) {
    errors.push('Deck is empty.');
  }

  return { cards, errors };
}

function normalizeImportName(name: string): string {
  const normalized = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return normalized.replace(/^Basic \{([A-Z])\} Energy\b/, (_match, type: string) => {
    const energyNames: Record<string, string> = {
      G: 'Grass',
      R: 'Fire',
      W: 'Water',
      L: 'Lightning',
      P: 'Psychic',
      F: 'Fighting',
      D: 'Darkness',
      M: 'Metal',
    };
    return `${energyNames[type] ?? type} Energy`;
  });
}
