import cardRows from './cardData.generated.json';
import attackRows from './attackData.generated.json';
import { CabtAreaType, CabtLogType } from './types';
import type { ActionTimelineEvent } from '../game/types';

type CardRow = {
  id: number;
  name: string;
};

type AttackRow = {
  attackId: number;
  name: string;
};

const cardDatabase = new Map<number, CardRow>((cardRows as CardRow[]).map((card) => [card.id, card]));
const attackDatabase = new Map<number, AttackRow>((attackRows as AttackRow[]).map((attack) => [attack.attackId, attack]));

const logTypeNames: Record<number, string> = {
  [CabtLogType.SHUFFLE]: 'Shuffle',
  [CabtLogType.HAS_BASIC_POKEMON]: 'HasBasicPokemon',
  [CabtLogType.TURN_START]: 'TurnStart',
  [CabtLogType.TURN_END]: 'TurnEnd',
  [CabtLogType.DRAW]: 'Draw',
  [CabtLogType.DRAW_REVERSE]: 'DrawReverse',
  [CabtLogType.MOVE_CARD]: 'MoveCard',
  [CabtLogType.MOVE_CARD_REVERSE]: 'MoveCardReverse',
  [CabtLogType.SWITCH]: 'Switch',
  [CabtLogType.CHANGE]: 'Change',
  [CabtLogType.PLAY]: 'Play',
  [CabtLogType.ATTACH]: 'Attach',
  [CabtLogType.EVOLVE]: 'Evolve',
  [CabtLogType.DEVOLVE]: 'Devolve',
  [CabtLogType.MOVE_ATTACHED]: 'MoveAttached',
  [CabtLogType.ATTACK]: 'Attack',
  [CabtLogType.HP_CHANGE]: 'HPChange',
  [CabtLogType.POISONED]: 'Poisoned',
  [CabtLogType.BURNED]: 'Burned',
  [CabtLogType.ASLEEP]: 'Asleep',
  [CabtLogType.PARALYZED]: 'Paralyzed',
  [CabtLogType.CONFUSED]: 'Confused',
  [CabtLogType.COIN]: 'Coin',
  [CabtLogType.RESULT]: 'Result',
};

export function formatCabtLog(log: Record<string, unknown>): string {
  const type = normalizedLogType(log.type);
  const playerIndex = typeof log.playerIndex === 'number' ? log.playerIndex : undefined;
  const actor = playerIndex === undefined ? 'Game' : `Player ${playerIndex + 1}`;
  const card = cardName(Number(log.cardId));
  const target = cardName(Number(log.cardIdTarget));

  switch (type) {
    case 'Shuffle':
      return `${actor} shuffled their deck.`;
    case 'HasBasicPokemon':
      return `${actor} ${log.hasBasicPokemon ? 'has' : 'does not have'} a Basic Pokemon.`;
    case 'TurnStart':
      return `${actor} turn started.`;
    case 'TurnEnd':
      return `${actor} ended their turn.`;
    case 'Draw':
      return `${actor} drew ${card}.`;
    case 'DrawReverse':
      return `${actor} drew a card.`;
    case 'Play':
      return `${actor} played ${card}.`;
    case 'Attach':
      return `${actor} attached ${card}${Number.isFinite(Number(log.cardIdTarget)) ? ` to ${target}` : ''}.`;
    case 'Evolve':
      return `${actor} evolved into ${card}.`;
    case 'Devolve':
      return `${actor} devolved ${card}.`;
    case 'Attack':
      return `${actor} used ${attackName(Number(log.attackId))} with ${card}.`;
    case 'MoveCard':
      return moveCardMessage(actor, card, log);
    case 'MoveCardReverse':
      return `${actor} moved a facedown card from ${areaName(log.fromArea)} to ${areaName(log.toArea)}.`;
    case 'Switch':
      return `${actor} switched ${cardName(Number(log.cardIdActive))} with ${cardName(Number(log.cardIdBench))}.`;
    case 'Change':
      return `${actor} changed ${cardName(Number(log.cardIdBefore))} into ${cardName(Number(log.cardIdAfter))}.`;
    case 'MoveAttached':
      return `${actor} moved ${card}.`;
    case 'HPChange':
      return hpChangeMessage(actor, card, log);
    case 'Poisoned':
      return `${actor}'s ${card} ${log.isRecover ? 'recovered from poison' : 'was poisoned'}.`;
    case 'Burned':
      return `${actor}'s ${card} ${log.isRecover ? 'recovered from burn' : 'was burned'}.`;
    case 'Asleep':
      return `${actor}'s ${card} ${log.isRecover ? 'woke up' : 'fell asleep'}.`;
    case 'Paralyzed':
      return `${actor}'s ${card} ${log.isRecover ? 'recovered from paralysis' : 'was paralyzed'}.`;
    case 'Confused':
      return `${actor}'s ${card} ${log.isRecover ? 'recovered from confusion' : 'was confused'}.`;
    case 'Coin':
      return `${actor} flipped ${log.head ? 'heads' : 'tails'}.`;
    case 'Result':
      return 'The battle finished.';
    default:
      return `${actor}: ${String(type ?? 'Event')}${Number.isFinite(Number(log.cardId)) ? ` ${card}` : ''}.`;
  }
}

export function cabtLogsToTimeline(
  logs: Array<Record<string, unknown>>,
  options: { nextId?: number } = {},
): { events: ActionTimelineEvent[]; nextId: number } {
  let nextId = options.nextId ?? 1;
  const events = logs.map((log) => ({
    id: nextId++,
    message: formatCabtLog(log),
    playerIndex: typeof log.playerIndex === 'number' ? log.playerIndex : undefined,
    kind: normalizedLogType(log.type),
    params: log,
  }));
  return { events, nextId };
}

function normalizedLogType(type: unknown): string {
  if (typeof type === 'number') {
    return logTypeNames[type] ?? `Log ${type}`;
  }
  return String(type ?? 'Event');
}

function moveCardMessage(actor: string, card: string, log: Record<string, unknown>) {
  if (Number(log.fromArea) === CabtAreaType.PRIZE && Number(log.toArea) === CabtAreaType.HAND) {
    return `${actor} took ${card} as a Prize card.`;
  }
  if (Number(log.fromArea) === CabtAreaType.DECK && Number(log.toArea) === CabtAreaType.PRIZE) {
    return `${actor} set a Prize card.`;
  }
  if (Number(log.fromArea) === CabtAreaType.HAND && Number(log.toArea) === CabtAreaType.DECK) {
    return `${actor} moved a card from hand to deck.`;
  }
  if (Number(log.fromArea) === CabtAreaType.DECK && Number(log.toArea) === CabtAreaType.DISCARD) {
    return `${actor} discarded ${card} from the deck.`;
  }
  return `${actor} moved ${card} from ${areaName(log.fromArea)} to ${areaName(log.toArea)}.`;
}

function hpChangeMessage(actor: string, card: string, log: Record<string, unknown>) {
  const value = Number(log.value);
  if (!Number.isFinite(value) || value === 0) {
    return `${actor}'s ${card} HP changed.`;
  }
  const amount = Math.abs(value);
  if (value < 0) {
    return `${actor}'s ${card} took ${amount} damage.`;
  }
  return `${actor}'s ${card} recovered ${amount} HP.`;
}

function areaName(area: unknown): string {
  const areaMap: Record<number, string> = {
    [CabtAreaType.DECK]: 'deck',
    [CabtAreaType.HAND]: 'hand',
    [CabtAreaType.DISCARD]: 'discard',
    [CabtAreaType.ACTIVE]: 'active',
    [CabtAreaType.BENCH]: 'bench',
    [CabtAreaType.PRIZE]: 'prize',
    [CabtAreaType.STADIUM]: 'stadium',
    [CabtAreaType.ENERGY]: 'energy',
    [CabtAreaType.TOOL]: 'tool',
    [CabtAreaType.PRE_EVOLUTION]: 'evolution stack',
    [CabtAreaType.PLAYER]: 'player',
    [CabtAreaType.LOOKING]: 'selection',
  };
  return areaMap[Number(area)] ?? 'zone';
}

function cardName(id: number): string {
  return displayName(cardDatabase.get(id)?.name ?? (Number.isFinite(id) ? `Card ${id}` : 'a card'));
}

function attackName(id: number): string {
  const attack = attackDatabase.get(id);
  if (attack?.name) {
    return displayName(attack.name);
  }
  return Number.isFinite(id) ? `attack ${id}` : 'an attack';
}

function displayName(name: string): string {
  const energyNames: Record<string, string> = {
    '{C}': 'Colorless',
    '{G}': 'Grass',
    '{R}': 'Fire',
    '{W}': 'Water',
    '{L}': 'Lightning',
    '{P}': 'Psychic',
    '{F}': 'Fighting',
    '{D}': 'Darkness',
    '{M}': 'Metal',
  };
  return energyNames[name] ?? name.replace(/\{([A-Z])\}/g, (_match, symbol) => energyNames[`{${symbol}}`] ?? symbol);
}
