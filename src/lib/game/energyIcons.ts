const basicEnergyTypes: Array<[RegExp, string]> = [
  [/\{G\}\s*Energy\b/i, 'grass'],
  [/\{R\}\s*Energy\b/i, 'fire'],
  [/\{W\}\s*Energy\b/i, 'water'],
  [/\{L\}\s*Energy\b/i, 'lightning'],
  [/\{P\}\s*Energy\b/i, 'psychic'],
  [/\{F\}\s*Energy\b/i, 'fighting'],
  [/\{D\}\s*Energy\b/i, 'darkness'],
  [/\{M\}\s*Energy\b/i, 'metal'],
  [/\bGrass Energy\b/i, 'grass'],
  [/\bFire Energy\b/i, 'fire'],
  [/\bWater Energy\b/i, 'water'],
  [/\bLightning Energy\b/i, 'lightning'],
  [/\bPsychic Energy\b/i, 'psychic'],
  [/\bFighting Energy\b/i, 'fighting'],
  [/\bDarkness Energy\b/i, 'darkness'],
  [/\bDark Energy\b/i, 'darkness'],
  [/\bMetal Energy\b/i, 'metal'],
  [/\bFairy Energy\b/i, 'fairy'],
  [/\bColorless Energy\b/i, 'colorless'],
];

export type EnergySymbolInfo = {
  type: string;
  label: string;
  letter: string;
  color: string;
  textColor: string;
  borderColor: string;
};


const energySymbols: Record<string, EnergySymbolInfo> = {
  grass: symbol('grass', 'Grass', '#49a853', '#f6fff5', '#2f7d3c'),
  fire: symbol('fire', 'Fire', '#e4563c', '#fff8f2', '#ae3027'),
  water: symbol('water', 'Water', '#3f8fd3', '#f3fbff', '#2466a7'),
  lightning: symbol('lightning', 'Lightning', '#f0c83f', '#2b2410', '#ba8d21'),
  psychic: symbol('psychic', 'Psychic', '#a65aae', '#fff4ff', '#783f82'),
  fighting: symbol('fighting', 'Fighting', '#b87942', '#fff8ef', '#865325'),
  darkness: symbol('darkness', 'Darkness', '#4a4d57', '#f7f8fb', '#2d3038'),
  metal: symbol('metal', 'Metal', '#9da8ae', '#172027', '#707b82'),
  colorless: symbol('colorless', 'Colorless', '#c7c9c2', '#202522', '#90948b'),
  fairy: symbol('fairy', 'Fairy', '#ee8cbd', '#fff7fc', '#bf5d91'),
  dragon: symbol('dragon', 'Dragon', '#c89b31', '#fff8e8', '#8d6a1d'),
};

function symbol(type: string, label: string, color: string, textColor: string, borderColor: string): EnergySymbolInfo {
  return {
    type,
    label,
    letter: type === 'fire' ? 'R' : type === 'fairy' ? 'Y' : label[0],
    color,
    textColor,
    borderColor,
  };
}

export function energySymbolInfo(card: { name?: string; fullName?: string; energyType?: string | number }): EnergySymbolInfo {
  const name = ((card.name ?? '') + ' ' + (card.fullName ?? '')).trim();
  const basic = basicEnergyTypes.find(([pattern]) => pattern.test(name));
  const type = basic?.[1] ?? normalizedTypeName(card.energyType) ?? 'colorless';
  return energySymbolInfoForType(type);
}

export function energySymbolInfoForType(cardType: string | number | undefined): EnergySymbolInfo {
  const type = normalizedTypeName(cardType) ?? 'colorless';
  return energySymbols[type] ?? energySymbols.colorless;
}

export function normalizedTypeName(cardType: string | number | undefined): string | undefined {
  if (cardType === undefined || cardType === null) {
    return undefined;
  }
  if (typeof cardType === 'number') {
    // Indexed by CabtEnergyType (cabt/types.ts): 0 Colorless .. 9 Dragon,
    // 10 Rainbow, 11 Team Rocket. Fairy is NOT a CABT energy type — the engine
    // never emits it as a number — so no numeric slot maps to 'fairy'; a legacy
    // Fairy Energy reaches its pip through the card-name path above. Rainbow and
    // Team Rocket have no dedicated pip and resolve to the neutral colorless one.
    return (
      [
        undefined,   // 0 Colorless (→ colorless downstream)
        'grass',     // 1
        'fire',      // 2
        'water',     // 3
        'lightning', // 4
        'psychic',   // 5
        'fighting',  // 6
        'darkness',  // 7
        'metal',     // 8
        'dragon',    // 9
        'colorless', // 10 Rainbow
        'colorless', // 11 Team Rocket
      ][cardType] ?? undefined
    );
  }
  const normalized = cardType.toLowerCase().replace(/[^a-z]/g, '');
  if (normalized === 'dark') {
    return 'darkness';
  }
  return (
    {
      g: 'grass',
      grass: 'grass',
      r: 'fire',
      fire: 'fire',
      w: 'water',
      water: 'water',
      l: 'lightning',
      lightning: 'lightning',
      p: 'psychic',
      psychic: 'psychic',
      f: 'fighting',
      fighting: 'fighting',
      d: 'darkness',
      dark: 'darkness',
      darkness: 'darkness',
      m: 'metal',
      metal: 'metal',
      c: 'colorless',
      colorless: 'colorless',
      fairy: 'fairy',
      y: 'fairy',
      dragon: 'dragon',
    }[normalized] ?? undefined
  );
}

export function pokemonTypeLabelFor(cardType: string | number | undefined): string {
  return cardType === undefined || cardType === null ? 'Pokemon' : energySymbolInfoForType(cardType).label;
}
