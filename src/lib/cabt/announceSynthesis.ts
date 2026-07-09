import { CabtAreaType } from './types';

// The engine never logs ability usage; both the live and replay pipelines
// reconstruct an `Ability` announce from "which option was selected" (and from
// silent triggers — evolve-draw, attach). Those two reconstructions were
// near-identical twins over different input shapes (live observations vs replay
// frames, live `cardType` numbers vs replay `kind` strings). This is their one
// shared rule core; each pipeline builds an AnnounceContext adapter and calls
// synthesizeAnnounceLogs. Replay is the byte-identical oracle, so the canonical
// helpers here match replay's behaviour (first non-empty skill name, displayName,
// an "an Ability" fallback); live gains that robustness for edge cases while
// staying identical for every real card.

export type AnnounceLog = Record<string, unknown>;

export type AnnounceCardRef = {
  id: number;
  serial?: number;
};

// Normalized card metadata: each pipeline maps its own card record onto this.
export type AnnounceMeta = {
  // True for Items/Supporters — trainer cards have no ability to announce.
  isTrainer: boolean;
  skills: Array<{ name: string; text?: string }>;
};

export type AnnouncePlayer = {
  active?: (AnnounceCardRef | null | undefined)[];
  bench?: (AnnounceCardRef | null | undefined)[];
  hand?: (AnnounceCardRef | null | undefined)[] | null;
};

export type AnnounceContext = {
  // The option the acting seat selected on the previous decision, already
  // resolved from the raw action by the adapter (the encodings differ).
  selectedOption: AnnounceLog | null;
  selectedPlayerIndex: number | undefined;
  // The previous decision's select payload (for the YesNo confirmed-trigger)
  // and whether it was a YesNo prompt (the type encoding differs per pipeline).
  select: AnnounceLog | null;
  isYesNoSelect: boolean;
  // Logs from the previous step (evolve trigger) and this step (draws/attach).
  previousLogs: AnnounceLog[];
  newLogs: AnnounceLog[];
  // A log's canonical kind name — the two pipelines encode log.type differently
  // (live numeric CabtLogType, replay string), so the adapter normalizes it.
  logTypeName: (log: AnnounceLog) => string;
  // The board and stadium as they were BEFORE this step (source/hand/active).
  players: AnnouncePlayer[];
  stadium: AnnounceCardRef[];
  // Normalized metadata lookup, a card's display name (for the attach announce),
  // and the canonical display-name transform for a raw skill string.
  cardMeta: (id: number) => AnnounceMeta | undefined;
  cardDisplayName: (id: number) => string | undefined;
  displayName: (name: string) => string;
};

// Fold the synthesized announce into a step's log stream. The four
// selection-driven cases prepend a single announce; a triggered attach instead
// inserts the announce right after the attach, so the badge shows over the
// attach and not before it.
export function synthesizeAnnounceLogs(context: AnnounceContext): AnnounceLog[] {
  const { newLogs } = context;
  if (newLogs.some((log) => context.logTypeName(log) === 'Ability')) {
    return newLogs;
  }
  const announce = abilityLogForSelectedOption(context)
    ?? retreatLogForSelectedOption(context)
    ?? abilityLogForConfirmedTrigger(context)
    ?? abilityLogForTriggeredEvolution(context);
  if (announce) {
    return [announce, ...newLogs];
  }
  const attach = abilityLogForTriggeredAttach(context);
  return attach ? logsWithInsertedLog(newLogs, attach.afterIndex, attach.log) : newLogs;
}

function optionType(option: AnnounceLog | null): unknown {
  return option?.type;
}

function abilityLogForSelectedOption(context: AnnounceContext): AnnounceLog | null {
  const option = context.selectedOption;
  if (!option || normalizedOptionTypeName(optionType(option)) !== 'Ability') {
    return null;
  }
  const playerIndex = numberField(option.playerIndex) ?? context.selectedPlayerIndex;
  if (playerIndex === undefined) {
    return null;
  }
  const area = numberField(option.area);
  const index = numberField(option.index) ?? 0;
  const source = resolveAnnounceSource(context, playerIndex, area, index);
  const cardId = source?.id ?? numberField(option.cardId);
  if (cardId === undefined) {
    return null;
  }
  return {
    type: 'Ability',
    playerIndex,
    cardId,
    serial: source?.serial ?? numberField(option.serial),
    abilityName: abilityNameForCard(context, cardId),
    area,
    index,
  };
}

// Retreating is chosen from the main menu like an ability; announcing it the
// same way gives the badge over the retreating active.
function retreatLogForSelectedOption(context: AnnounceContext): AnnounceLog | null {
  const option = context.selectedOption;
  if (!option || normalizedOptionTypeName(optionType(option)) !== 'Retreat') {
    return null;
  }
  const playerIndex = numberField(option.playerIndex) ?? context.selectedPlayerIndex;
  if (playerIndex === undefined) {
    return null;
  }
  const active = context.players[playerIndex]?.active?.[0];
  if (!active) {
    return null;
  }
  return {
    type: 'Ability',
    playerIndex,
    cardId: active.id,
    serial: active.serial,
    abilityName: 'Retreat',
  };
}

// Triggered abilities (e.g. Punk Up after evolving) are offered as a YesNo
// confirmation whose contextCard names the source; no Ability option is ever
// selected, so answering Yes is the only signal to announce from.
function abilityLogForConfirmedTrigger(context: AnnounceContext): AnnounceLog | null {
  const select = context.select;
  if (!select || !context.isYesNoSelect) {
    return null;
  }
  const contextCard = select.contextCard as AnnounceLog | null | undefined;
  const cardId = numberField(contextCard?.id);
  const playerIndex = numberField(contextCard?.playerIndex);
  if (cardId === undefined || playerIndex === undefined) {
    return null;
  }
  const meta = context.cardMeta(cardId);
  if (!meta || meta.isTrainer || !meta.skills.length) {
    return null;
  }
  if (normalizedOptionTypeName(optionType(context.selectedOption)) !== 'Yes') {
    return null;
  }
  return {
    type: 'Ability',
    playerIndex,
    cardId,
    serial: numberField(contextCard?.serial),
    abilityName: abilityNameForCard(context, cardId),
  };
}

// On-evolve draw abilities ("when you play this Pokemon from your hand to evolve
// … draw N cards") trigger silently: the previous step evolved, this step is
// exactly those draws.
function abilityLogForTriggeredEvolution(context: AnnounceContext): AnnounceLog | null {
  const evolveLog = [...context.previousLogs].reverse().find((log) => context.logTypeName(log) === 'Evolve');
  const playerIndex = numberField(evolveLog?.playerIndex);
  const cardId = numberField(evolveLog?.cardId);
  if (evolveLog === undefined || playerIndex === undefined || cardId === undefined) {
    return null;
  }
  const skill = evolutionTriggeredDrawSkill(context, cardId);
  if (!skill || context.newLogs.length !== skill.drawCount) {
    return null;
  }
  const allDraws = context.newLogs.every((log) => {
    const name = context.logTypeName(log);
    return (name === 'Draw' || name === 'DrawReverse') && numberField(log.playerIndex) === playerIndex;
  });
  if (!allDraws) {
    return null;
  }
  const source = evolvedPokemonSource(context, playerIndex, cardId, numberField(evolveLog?.serial));
  return {
    type: 'Ability',
    playerIndex,
    cardId,
    serial: numberField(evolveLog?.serial),
    abilityName: context.displayName(skill.name.trim()),
    area: source?.area,
    index: source?.index,
    trigger: 'Evolve',
  };
}

// A hand card attached this step whose effect then resolves (there are further,
// non-Attach logs after it in the same batch) is a triggered ability — announce
// it over the attaching card.
function abilityLogForTriggeredAttach(context: AnnounceContext): { afterIndex: number; log: AnnounceLog } | null {
  const { newLogs } = context;
  const attachIndex = newLogs.findIndex((log) =>
    context.logTypeName(log) === 'Attach'
    && attachedCardWasInHand(context, log)
    && attachedCardHasOnAttachEffect(context, numberField(log.cardId)));
  if (attachIndex < 0) {
    return null;
  }
  const attach = newLogs[attachIndex];
  const cardId = numberField(attach.cardId);
  const playerIndex = numberField(attach.playerIndex);
  if (cardId === undefined || playerIndex === undefined) {
    return null;
  }
  return {
    afterIndex: attachIndex,
    log: {
      type: 'Ability',
      playerIndex,
      cardId,
      serial: numberField(attach.serial),
      cardIdTarget: numberField(attach.cardIdTarget),
      serialTarget: numberField(attach.serialTarget),
      abilityName: cardName(context, cardId),
      trigger: 'Attach',
    },
  };
}

// A card announces its own name on attach only when it carries an ON-ATTACH
// effect (printed "When you attach this card ..." — e.g. Telepath Psychic
// Energy's deck search, Enriching Energy). Plain basic energies (no skill) and
// passive/continuous Special Energies and Tools stay silent: an ability-style
// bubble that resolved nothing would read as noise. This keys on the card, not
// on a same-frame follow-up event, so the announce fires at the attach beat
// even when the effect's own events land in the NEXT frame (the real card-19
// shape: attach in one frame, deck placements in the next).
function attachedCardHasOnAttachEffect(context: AnnounceContext, cardId: number | undefined): boolean {
  if (cardId === undefined) {
    return false;
  }
  return (context.cardMeta(cardId)?.skills ?? []).some((skill) =>
    /when you attach this/i.test(skill.text ?? ''));
}

function attachedCardWasInHand(context: AnnounceContext, log: AnnounceLog): boolean {
  const playerIndex = numberField(log.playerIndex);
  const player = playerIndex === undefined ? undefined : context.players[playerIndex];
  if (!player) {
    return false;
  }
  const serial = numberField(log.serial);
  const cardId = numberField(log.cardId);
  return (player.hand ?? []).some((card) =>
    !!card && (serial !== undefined ? card.serial === serial : cardId !== undefined && card.id === cardId));
}

function resolveAnnounceSource(
  context: AnnounceContext,
  playerIndex: number,
  area: number | undefined,
  index: number,
): AnnounceCardRef | undefined {
  if (area === CabtAreaType.STADIUM) {
    return context.stadium[index] ?? context.stadium[0] ?? undefined;
  }
  const player = context.players[playerIndex];
  if (!player) {
    return undefined;
  }
  if (area === CabtAreaType.ACTIVE) {
    return player.active?.[index] ?? player.active?.[0] ?? undefined;
  }
  if (area === CabtAreaType.BENCH) {
    return player.bench?.[index] ?? undefined;
  }
  return undefined;
}

function evolvedPokemonSource(
  context: AnnounceContext,
  playerIndex: number,
  cardId: number,
  serial: number | undefined,
): { area: number; index: number } | undefined {
  const player = context.players[playerIndex];
  if (!player) {
    return undefined;
  }
  const matches = (pokemon: AnnounceCardRef | null | undefined) =>
    !!pokemon && (serial !== undefined ? pokemon.serial === serial : pokemon.id === cardId);
  const activeIndex = (player.active ?? []).findIndex(matches);
  if (activeIndex >= 0) {
    return { area: CabtAreaType.ACTIVE, index: activeIndex };
  }
  const benchIndex = (player.bench ?? []).findIndex(matches);
  if (benchIndex >= 0) {
    return { area: CabtAreaType.BENCH, index: benchIndex };
  }
  return undefined;
}

function evolutionTriggeredDrawSkill(
  context: AnnounceContext,
  cardId: number,
): { name: string; drawCount: number } | null {
  const meta = context.cardMeta(cardId);
  for (const skill of meta?.skills ?? []) {
    const text = (skill.text ?? '')
      .toLowerCase()
      .replaceAll('é', 'e')
      .replaceAll(/\s+/g, ' ')
      .trim();
    if (!text.includes('when you play this pokemon from your hand to evolve')) {
      continue;
    }
    const drawCount = Number(text.match(/\bdraw\s+(\d+)\s+cards?\b/)?.[1]);
    if (Number.isFinite(drawCount) && drawCount > 0 && skill.name.trim()) {
      return { name: skill.name, drawCount };
    }
  }
  return null;
}

function abilityNameForCard(context: AnnounceContext, cardId: number): string {
  const skillName = context.cardMeta(cardId)?.skills.find((skill) => skill.name.trim())?.name.trim();
  return skillName ? context.displayName(skillName) : 'an Ability';
}

function cardName(context: AnnounceContext, id: number): string {
  return context.displayName(context.cardDisplayName(id) ?? (Number.isFinite(id) ? `Card ${id}` : 'a card'));
}

function logsWithInsertedLog(logs: AnnounceLog[], afterIndex: number, log: AnnounceLog): AnnounceLog[] {
  return [...logs.slice(0, afterIndex + 1), log, ...logs.slice(afterIndex + 1)];
}

function numberField(value: unknown): number | undefined {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

// Option types arrive as either the numeric CabtOptionType code or a PascalCase
// string; normalize the ones the rules test.
function normalizedOptionTypeName(type: unknown): string {
  const names: Record<number, string> = { 10: 'Ability', 12: 'Retreat', 1: 'Yes' };
  if (typeof type === 'number' && type in names) {
    return names[type];
  }
  return String(type ?? '');
}
