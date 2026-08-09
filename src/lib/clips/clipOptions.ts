import { CabtAreaType } from '../cabt/types';

// A clip names moves by option index, which is meaningless on its own. A
// recording with decision analysis carries real action labels; a plain replay
// does not, so this reads the frame's raw `select.option` and says what the
// option points at ("Evolve → Bench 4") instead of "Option 7".
//
// Deliberately structural: it never guesses which seat owns a slot, so it
// cannot mislabel a board reference. Pokemon names come from the analysis
// labels when the recording has them.
export function clipOptionLabel(select: unknown, optionIndex: number): string {
  const options = (select as { option?: unknown })?.option;
  const option = Array.isArray(options) ? options[optionIndex] : undefined;
  if (!option || typeof option !== 'object') {
    return '';
  }
  const value = option as Record<string, unknown>;
  const action = typeof value.type === 'string' ? value.type : '';
  if (!action) {
    return '';
  }
  const destination = zoneLabel(value.inPlayArea, value.inPlayIndex);
  if (destination) {
    return `${action} → ${destination}`;
  }
  const source = zoneLabel(value.area, value.index);
  return source ? `${action} · ${source}` : action;
}

function zoneLabel(area: unknown, index: unknown): string {
  if (typeof area !== 'number') {
    return '';
  }
  const position = typeof index === 'number' && Number.isInteger(index) && index >= 0
    ? index + 1
    : null;
  switch (area) {
    case CabtAreaType.ACTIVE:
      return 'Active';
    case CabtAreaType.BENCH:
      return position === null ? 'Bench' : `Bench ${position}`;
    case CabtAreaType.HAND:
      return position === null ? 'Hand' : `Hand ${position}`;
    case CabtAreaType.PRIZE:
      return position === null ? 'Prize' : `Prize ${position}`;
    case CabtAreaType.DECK:
      return 'Deck';
    case CabtAreaType.DISCARD:
      return 'Discard';
    case CabtAreaType.STADIUM:
      return 'Stadium';
    default:
      return '';
  }
}
