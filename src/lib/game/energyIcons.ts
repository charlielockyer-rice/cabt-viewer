const basicEnergyIcons: Array<[RegExp, string]> = [
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

const customEnergyIcons: Record<string, string> = {
  'Double Turbo Energy': '/assets/energy/double-turbo.png',
  'Jet Energy': '/assets/energy/jet.png',
  'Gift Energy': '/assets/energy/gift.png',
  'Mist Energy': '/assets/energy/mist.png',
  'Luminous Energy': '/assets/energy/luminous.webp',
  'Reversal Energy': '/assets/energy/reversal.webp',
  'Therapeutic Energy': '/assets/energy/therapeutic.webp',
  'Medical Energy': '/assets/energy/medical.webp',
  'Boomerang Energy': '/assets/energy/boomerang.webp',
  'Spiky Energy': '/assets/energy/spiky.webp',
  "Team Rocket's Energy": '/assets/energy/team-rockets.webp',
  'Prism Energy': '/assets/energy/prism.webp',
  'Ignition Energy': '/assets/energy/ignition.webp',
  'Enriching Energy': '/assets/energy/enriching.webp',
  'Legacy Energy': '/assets/energy/legacy.png',
  'Neo Upper Energy': '/assets/energy/neo-upper.png',
  'Rock Fighting Energy': '/assets/energy/rock-fighting.webp',
  'Growth Grass Energy': '/assets/energy/growth-grass.webp',
  'Telepath Psychic Energy': '/assets/energy/telepath-psychic.webp',
};

export function energyIconSrc(card: { name?: string; fullName?: string; energyType?: string | number }): string {
  const name = card.name || card.fullName || '';
  if (customEnergyIcons[name]) {
    return customEnergyIcons[name];
  }
  const basic = basicEnergyIcons.find(([pattern]) => pattern.test(name));
  const type = basic?.[1] ?? normalizedTypeName(card.energyType);
  return type ? `/assets/energy-icons/${type}.webp` : '/assets/energy-icons/colorless.webp';
}

export function normalizedTypeName(cardType: string | number | undefined): string | undefined {
  if (cardType === undefined || cardType === null) {
    return undefined;
  }
  if (typeof cardType === 'number') {
    return (
      [
        undefined,
        'grass',
        'fire',
        'water',
        'lightning',
        'psychic',
        'fighting',
        'darkness',
        'metal',
        'colorless',
        'fairy',
        'dragon',
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
      darkness: 'darkness',
      m: 'metal',
      metal: 'metal',
      c: 'colorless',
      colorless: 'colorless',
      fairy: 'fairy',
      dragon: 'dragon',
    }[normalized] ?? undefined
  );
}

export function pokemonTypeIconSrc(cardType: string | number | undefined): string | undefined {
  const type = normalizedTypeName(cardType);
  return type ? `/assets/energy-icons/${type}.webp` : undefined;
}

export function pokemonTypeLabelFor(cardType: string | number | undefined): string {
  const type = normalizedTypeName(cardType);
  return type ? type[0].toUpperCase() + type.slice(1) : 'Pokemon';
}
