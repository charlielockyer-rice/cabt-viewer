import type { VisualAssetManifest } from './visualAssets';

export type CardImageConfig = {
  template?: string;
  cardBackUrl?: string;
};

export type SetImageInfo = {
  id: string;
};

export type CardImageInput = {
  imageUrl?: string;
  cardImage?: string;
  set?: string;
  setNumber?: string;
  name?: string;
  fullName?: string;
};

export const setImageMap: Record<string, string | SetImageInfo> = {
  BASE: 'base1',
  JUNGLE: 'base2',
  FOSSIL: 'base3',
  SIT: 'swsh12',
  ASR: 'swsh10',
  LOR: 'swsh11',
  SVI: 'sv1',
  SVE: 'sve',
  PAL: 'sv2',
  OBF: 'sv3',
  MEW: 'sv3pt5',
  PAR: 'sv4',
  PAF: 'sv4pt5',
  TEF: 'sv5',
  TWM: 'sv6',
  SFA: 'sv6pt5',
  SCR: 'sv7',
  SSP: 'sv8',
  PRE: 'sv8pt5',
  JTG: 'sv9',
  DRI: 'sv10',
  BLK: 'zsv10pt5',
  WHT: 'rsv10pt5',
  MEP: 'mep',
  MEE: 'mee',
  MEG: 'me1',
  M1L: 'me1',
  M1S: 'me1',
  PFL: 'me2',
  ASC: 'me2pt5',
  POR: 'me3',
  CRI: 'me4',
  PBL: 'me5',
  PROMO: 'svp',
  SVP: 'svp',
};

export function resolveCardImageUrl(card: CardImageInput, config = cardImageConfigFromEnv()): string | undefined {
  if (card.imageUrl || card.cardImage) {
    return card.imageUrl ?? card.cardImage;
  }
  if (card.name === 'Unknown' || card.fullName === 'Unknown') {
    return undefined;
  }
  const setInfo = getSetImageInfo(card.set);
  if (!card.setNumber) {
    return undefined;
  }
  const rawSetNumber = String(card.setNumber);
  const template = config.template?.trim();
  if (template) {
    return cardImageUrlFromTemplate(template, card, setInfo, rawSetNumber);
  }
  return undefined;
}

export function resolveCardImageUrlFromManifest(card: CardImageInput, manifest: VisualAssetManifest | undefined): string | undefined {
  const cards = manifest?.cards;
  if (!cards) {
    return undefined;
  }
  const setInfo = getSetImageInfo(card.set);
  const rawSetNumber = card.setNumber ? String(card.setNumber) : '';
  const explicit = manifestCardImageUrl(cards.images, card, setInfo, rawSetNumber);
  if (explicit) {
    return explicit;
  }
  if (!rawSetNumber) {
    return undefined;
  }
  if (cards.template) {
    return cardImageUrlFromTemplate(cards.template, card, setInfo, rawSetNumber);
  }
  return undefined;
}

export function resolveCardBackImageUrl(config = cardImageConfigFromEnv()): string | undefined {
  return config.cardBackUrl?.trim() || undefined;
}

export function resolveCardBackImageUrlFromManifest(manifest: VisualAssetManifest | undefined): string | undefined {
  return manifest?.cardBack?.trim() || undefined;
}

export function hasConfiguredCardImageSource(config = cardImageConfigFromEnv(), manifest?: VisualAssetManifest): boolean {
  const cards = manifest?.cards;
  return !!cards?.template?.trim() || !!cards?.images || !!config.template?.trim();
}

function manifestCardImageUrl(
  images: Record<string, string> | undefined,
  card: CardImageInput,
  setInfo: SetImageInfo | undefined,
  rawSetNumber: string,
): string | undefined {
  if (!images) {
    return undefined;
  }
  for (const key of cardImageKeys(card, setInfo, rawSetNumber)) {
    const image = images[key];
    if (image) {
      return image;
    }
  }
  return undefined;
}

function cardImageKeys(card: CardImageInput, setInfo: SetImageInfo | undefined, rawSetNumber: string): string[] {
  return [
    [card.set, rawSetNumber].filter(Boolean).join('-'),
    [card.set?.toUpperCase(), rawSetNumber].filter(Boolean).join('-'),
    [setInfo?.id, rawSetNumber].filter(Boolean).join('-'),
    [setInfo?.id?.toUpperCase(), rawSetNumber].filter(Boolean).join('-'),
    card.fullName ?? '',
    card.name ?? '',
  ].filter(Boolean);
}

function cardImageUrlFromTemplate(
  template: string,
  card: CardImageInput,
  setInfo: SetImageInfo | undefined,
  rawSetNumber: string,
): string {
  const fullName = card.fullName || card.name || '';
  const values: Record<string, string> = {
    set: card.set ?? '',
    setId: setInfo?.id ?? card.set ?? '',
    number: rawSetNumber,
    numberPadded: rawSetNumber.padStart(3, '0'),
    name: card.name ?? fullName,
    fullName,
  };
  return template.replace(/\{(set|setId|number|numberPadded|name|fullName)\}/g, (_, key: keyof typeof values) => {
    return encodeURIComponent(values[key]);
  });
}

function cardImageConfigFromEnv(): CardImageConfig {
  return {
    template: import.meta.env?.VITE_CABT_CARD_IMAGE_TEMPLATE,
    cardBackUrl: import.meta.env?.VITE_CABT_CARD_BACK_IMAGE_URL,
  };
}

export function getSetImageInfo(setCode: string | undefined): SetImageInfo | undefined {
  const info = setCode ? setImageMap[setCode] : undefined;
  if (!info) {
    return undefined;
  }
  return typeof info === 'string' ? { id: info } : info;
}
