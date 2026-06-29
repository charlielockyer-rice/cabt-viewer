import { CabtAreaType } from './types';
import type { ActionTimelineEvent } from '../game/types';

export type AnimationCoverageLevel = 'polished' | 'conditional' | 'static' | 'unsupported';

export type AnimationCoverageClassification = {
  key: string;
  level: AnimationCoverageLevel;
  label: string;
  notes: string[];
};

const polishedMoveAreas = new Set([
  moveKey(CabtAreaType.DECK, CabtAreaType.PRIZE),
  moveKey(CabtAreaType.PRIZE, CabtAreaType.HAND),
  moveKey(CabtAreaType.DECK, CabtAreaType.DISCARD),
  moveKey(CabtAreaType.DECK, CabtAreaType.HAND),
  moveKey(CabtAreaType.DISCARD, CabtAreaType.HAND),
  moveKey(CabtAreaType.DISCARD, CabtAreaType.DECK),
  moveKey(CabtAreaType.DECK, CabtAreaType.ACTIVE),
  moveKey(CabtAreaType.DECK, CabtAreaType.BENCH),
  moveKey(CabtAreaType.DECK, CabtAreaType.LOOKING),
  moveKey(CabtAreaType.LOOKING, CabtAreaType.DECK),
  moveKey(CabtAreaType.LOOKING, CabtAreaType.HAND),
  moveKey(CabtAreaType.HAND, CabtAreaType.DECK),
  moveKey(CabtAreaType.HAND, CabtAreaType.DISCARD),
  moveKey(CabtAreaType.HAND, CabtAreaType.ACTIVE),
  moveKey(CabtAreaType.HAND, CabtAreaType.BENCH),
  moveKey(CabtAreaType.ENERGY, CabtAreaType.DISCARD),
  moveKey(CabtAreaType.ENERGY, CabtAreaType.DECK),
  moveKey(CabtAreaType.TOOL, CabtAreaType.DISCARD),
  moveKey(CabtAreaType.TOOL, CabtAreaType.DECK),
  moveKey(CabtAreaType.STADIUM, CabtAreaType.DISCARD),
  moveKey(CabtAreaType.ACTIVE, CabtAreaType.BENCH),
  moveKey(CabtAreaType.BENCH, CabtAreaType.ACTIVE),
  moveKey(CabtAreaType.ACTIVE, CabtAreaType.DECK),
  moveKey(CabtAreaType.BENCH, CabtAreaType.DECK),
  moveKey(CabtAreaType.ACTIVE, CabtAreaType.DISCARD),
  moveKey(CabtAreaType.BENCH, CabtAreaType.DISCARD),
]);

export function classifyAnimationCoverage(
  event: ActionTimelineEvent,
  stepEvents: ActionTimelineEvent[] = [],
): AnimationCoverageClassification {
  const params = event.params as Record<string, unknown> | undefined;
  const kind = event.kind ?? 'Event';
  const notes: string[] = [];

  if (kind === 'MoveCard' || kind === 'MoveCardReverse') {
    const fromArea = Number(params?.fromArea);
    const toArea = Number(params?.toArea);
    const key = `${kind}:${areaName(fromArea)}->${areaName(toArea)}`;

    if (kind === 'MoveCardReverse') {
      if (fromArea === CabtAreaType.DECK && toArea === CabtAreaType.PRIZE) {
        return {
          key,
          level: 'polished',
          label: 'Facedown Prize placement pulse',
          notes,
        };
      }
      if (fromArea === CabtAreaType.PRIZE && toArea === CabtAreaType.HAND) {
        return {
          key,
          level: 'polished',
          label: 'Facedown Prize take',
          notes,
        };
      }
      return {
        key,
        level: 'static',
        label: 'Facedown zone move is logged but has no bespoke motion',
        notes: ['Only Prize setup/take paths are animated for facedown MoveCardReverse events.'],
      };
    }

    const shape = moveKey(fromArea, toArea);
    if (fromArea === CabtAreaType.PRE_EVOLUTION) {
      return {
        key,
        level: 'static',
        label: 'Evolution stack move is projected but not animated',
        notes: ['Pre-evolution cards do not have a visible source anchor yet, so this must not be counted as polished animation coverage.'],
      };
    }

    if (isAttachedCardArea(fromArea) && toArea === CabtAreaType.HAND) {
      if (!hasFiniteNumber(params?.serial)) {
        notes.push('Attached-card returns to hand need serials to find the visible source badge or tool preview.');
        return { key, level: 'conditional', label: 'Attached card return to hand', notes };
      }
      return { key, level: 'polished', label: 'Attached card return to hand', notes };
    }

    if (!polishedMoveAreas.has(shape)) {
      return {
        key,
        level: 'static',
        label: 'Zone move is projected in state but not animated',
        notes: ['This source/destination pair does not map to a current motion component.'],
      };
    }

    if (fromArea === CabtAreaType.LOOKING && toArea === CabtAreaType.DECK) {
      notes.push('Depends on the reveal sprite still being held from an earlier deck reveal phase.');
      return { key, level: 'conditional', label: 'Revealed card return', notes };
    }

    if (fromArea === CabtAreaType.LOOKING && toArea === CabtAreaType.HAND) {
      notes.push('Depends on the reveal sprite still being held from an earlier deck reveal phase.');
      return { key, level: 'conditional', label: 'Revealed card take to hand', notes };
    }

    if (fromArea === CabtAreaType.DECK && (toArea === CabtAreaType.ACTIVE || toArea === CabtAreaType.BENCH)) {
      notes.push('Uses the final board slot as the handoff target; visually verify deck-search effects with multiple placements.');
      return { key, level: 'polished', label: 'Deck Pokemon placement to board', notes };
    }

    if (isAttachedCardArea(fromArea) && isAttachedMoveDestination(toArea)) {
      if (!hasFiniteNumber(params?.serial)) {
        notes.push('Attached-card moves need serials to find the visible source badge or tool preview.');
        return { key, level: 'conditional', label: 'Attached card move', notes };
      }
      return { key, level: 'polished', label: 'Attached card move', notes };
    }

    if (toArea === CabtAreaType.DISCARD && (fromArea === CabtAreaType.ACTIVE || fromArea === CabtAreaType.BENCH)) {
      if (!stepEvents.some((candidate) => candidate.kind === 'Attack')) {
        notes.push('Knockout motion is strongest when grouped after an Attack event; checkup KOs may lack the attack context.');
        return { key, level: 'conditional', label: 'Board Pokemon to discard / knockout', notes };
      }
      return { key, level: 'polished', label: 'Attack knockout to discard', notes };
    }

    if (toArea === CabtAreaType.DECK && (fromArea === CabtAreaType.ACTIVE || fromArea === CabtAreaType.BENCH)) {
      return { key, level: 'polished', label: 'Board Pokemon return to deck', notes };
    }

    if (fromArea === CabtAreaType.HAND && !hasFiniteNumber(params?.serial)) {
      notes.push('Hand-origin animations use serials to find the exact source card; missing serials may fall back or skip.');
      return { key, level: 'conditional', label: 'Hand card move', notes };
    }

    if (fromArea === CabtAreaType.DISCARD && (toArea === CabtAreaType.HAND || toArea === CabtAreaType.DECK)) {
      notes.push('Uses the visible discard card when present, otherwise starts from the discard pile surface.');
      return { key, level: 'polished', label: moveLabel(fromArea, toArea), notes };
    }

    return {
      key,
      level: 'polished',
      label: moveLabel(fromArea, toArea),
      notes,
    };
  }

  if (kind === 'Play') {
    if (!hasFiniteNumber(params?.cardId)) {
      notes.push('Missing cardId prevents a faithful animated card face.');
      return { key: kind, level: 'conditional', label: 'Card play', notes };
    }
    return { key: kind, level: 'polished', label: 'Card play from hand', notes };
  }

  if (kind === 'Attach') {
    if (!hasFiniteNumber(params?.serialTarget) && !hasFiniteNumber(params?.cardIdTarget)) {
      notes.push('Attach animations need target identity to find the destination Pokemon.');
      return { key: kind, level: 'conditional', label: 'Attachment to Pokemon', notes };
    }
    return { key: kind, level: 'polished', label: 'Attachment to Pokemon', notes };
  }

  if (kind === 'Evolve') {
    if (!hasFiniteNumber(params?.serialTarget) && !hasFiniteNumber(params?.cardIdTarget)) {
      notes.push('Evolution hiding/handoff relies on target identity when available.');
      return { key: kind, level: 'conditional', label: 'Evolution overlay', notes };
    }
    return { key: kind, level: 'polished', label: 'Evolution overlay', notes };
  }

  if (kind === 'Attack') {
    if (!hasFiniteNumber(params?.serial) && !hasFiniteNumber(params?.cardId)) {
      notes.push('Attack lunge/announcement needs attacker identity to find the board slot.');
      return { key: kind, level: 'conditional', label: 'Attack announcement', notes };
    }
    return { key: kind, level: 'polished', label: 'Attack announcement and lunge', notes };
  }

  if (kind === 'Ability') {
    if (!hasFiniteNumber(params?.serial) && !hasFiniteNumber(params?.cardId)) {
      notes.push('Ability announcement needs source identity to find the board slot.');
      return { key: kind, level: 'conditional', label: 'Ability announcement', notes };
    }
    return { key: kind, level: 'polished', label: 'Ability announcement', notes };
  }

  if (kind === 'Coin') {
    return { key: kind, level: 'polished', label: 'Coin flip announcement', notes };
  }

  if (kind === 'Switch') {
    if (
      (!hasFiniteNumber(params?.serialActive) && !hasFiniteNumber(params?.cardIdActive))
      || (!hasFiniteNumber(params?.serialBench) && !hasFiniteNumber(params?.cardIdBench))
    ) {
      notes.push('Switch motion needs both active and bench Pokemon identities to find board slots.');
      return { key: kind, level: 'conditional', label: 'Active/bench switch', notes };
    }
    return { key: kind, level: 'polished', label: 'Active/bench switch', notes };
  }

  if (kind === 'HPChange' || kind === 'HpChange') {
    if (!stepEvents.some((candidate) => candidate.kind === 'Attack')) {
      notes.push('Damage counters update, but non-attack HP changes have weaker motion context.');
      return { key: 'HPChange', level: 'conditional', label: 'HP change / damage badge', notes };
    }
    return { key: 'HPChange', level: 'polished', label: 'Attack damage badge', notes };
  }

  if (kind === 'Shuffle') {
    return { key: kind, level: 'polished', label: 'Deck shuffle', notes };
  }

  if (kind === 'Draw' || kind === 'DrawReverse') {
    return { key: kind, level: 'polished', label: 'Deck draw to hand', notes };
  }

  if (['TurnStart', 'TurnEnd', 'HasBasicPokemon', 'Result'].includes(kind)) {
    return { key: kind, level: 'static', label: 'Timeline/state-only phase marker', notes };
  }

  if (['Poisoned', 'Burned', 'Asleep', 'Paralyzed', 'Confused'].includes(kind)) {
    return {
      key: kind,
      level: 'static',
      label: 'Checkup or special-condition state change',
      notes: ['The board state updates, but there is no dedicated condition animation yet.'],
    };
  }

  if (['Devolve', 'Change', 'MoveAttached'].includes(kind)) {
    return {
      key: kind,
      level: 'unsupported',
      label: 'Complex board mutation without dedicated animation',
      notes: ['This is likely to look like a sudden state change unless it happens inside another animated group.'],
    };
  }

  return {
    key: kind,
    level: 'unsupported',
    label: 'Unclassified CABT event',
    notes: ['No current animation mapping was found for this event kind.'],
  };
}

export function animationCoverageRank(level: AnimationCoverageLevel): number {
  switch (level) {
    case 'polished':
      return 0;
    case 'conditional':
      return 1;
    case 'static':
      return 2;
    case 'unsupported':
      return 3;
    default:
      return 4;
  }
}

export function areaName(area: number): string {
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
    [CabtAreaType.PRE_EVOLUTION]: 'evolution-stack',
    [CabtAreaType.PLAYER]: 'player',
    [CabtAreaType.LOOKING]: 'looking',
  };
  return areaMap[area] ?? `area-${area}`;
}

function moveLabel(fromArea: number, toArea: number): string {
  if (fromArea === CabtAreaType.DECK && toArea === CabtAreaType.PRIZE) return 'Prize setup';
  if (fromArea === CabtAreaType.PRIZE && toArea === CabtAreaType.HAND) return 'Prize take';
  if (fromArea === CabtAreaType.DECK && toArea === CabtAreaType.DISCARD) return 'Deck discard';
  if (fromArea === CabtAreaType.DECK && toArea === CabtAreaType.HAND) return 'Deck search reveal to hand';
  if (fromArea === CabtAreaType.DISCARD && toArea === CabtAreaType.HAND) return 'Discard recovery to hand';
  if (fromArea === CabtAreaType.DISCARD && toArea === CabtAreaType.DECK) return 'Discard recovery to deck';
  if (fromArea === CabtAreaType.DECK && toArea === CabtAreaType.LOOKING) return 'Deck reveal';
  if (fromArea === CabtAreaType.HAND && toArea === CabtAreaType.DECK) return 'Hand reset to deck';
  if (fromArea === CabtAreaType.ACTIVE && toArea === CabtAreaType.BENCH) return 'Active to bench board move';
  if (fromArea === CabtAreaType.BENCH && toArea === CabtAreaType.ACTIVE) return 'Bench to active board move';
  if (toArea === CabtAreaType.DECK && (fromArea === CabtAreaType.ACTIVE || fromArea === CabtAreaType.BENCH)) return 'Board Pokemon return to deck';
  if (fromArea === CabtAreaType.HAND) return 'Hand card move';
  return 'Animated zone move';
}

function moveKey(fromArea: number, toArea: number): string {
  return `${fromArea}->${toArea}`;
}

function hasFiniteNumber(value: unknown): boolean {
  return Number.isFinite(Number(value));
}

function isAttachedMoveDestination(area: number): boolean {
  return area === CabtAreaType.DISCARD
    || area === CabtAreaType.DECK;
}

function isAttachedCardArea(area: number): boolean {
  return area === CabtAreaType.ENERGY
    || area === CabtAreaType.TOOL;
}
