import { formatCabtLog } from './logFormat';
import { CabtAreaType } from './types';

type ReplayStepLabelFrame = {
  logs?: Array<Record<string, unknown>>;
  select?: Record<string, unknown> | null;
};

export function cabtReplayStepLabel(frame: ReplayStepLabelFrame, index: number): string {
  const prizeSummary = prizeMoveSummary(frame.logs ?? []);
  if (prizeSummary) {
    return prizeSummary;
  }

  const attackSummary = attackLogSummary(frame.logs ?? []);
  if (attackSummary) {
    return attackSummary;
  }

  const latestLog = frame.logs?.at(-1);
  if (latestLog) {
    return formatCabtLog(latestLog);
  }
  const selectType = frame.select?.type;
  const context = frame.select?.context;
  if (selectType || context) {
    return [selectType, context].filter(Boolean).join(' · ');
  }
  return index === 0 ? 'Initial state' : `Frame ${index}`;
}

function prizeMoveSummary(logs: Array<Record<string, unknown>>): string {
  const prizeMoves = logs.filter((log) =>
    log.type === 'MoveCard'
    && Number(log.fromArea) === CabtAreaType.PRIZE
    && Number(log.toArea) === CabtAreaType.HAND,
  );
  if (!prizeMoves.length) {
    return '';
  }

  const playerIndex = typeof prizeMoves[0].playerIndex === 'number' ? prizeMoves[0].playerIndex : undefined;
  const samePlayer = prizeMoves.every((log) => log.playerIndex === playerIndex);
  if (!samePlayer || playerIndex === undefined) {
    return `Players took ${prizeMoves.length} Prize cards.`;
  }

  const actor = `Player ${playerIndex + 1}`;
  return prizeMoves.length === 1 ? `${actor} took 1 Prize card.` : `${actor} took ${prizeMoves.length} Prize cards.`;
}

function attackLogSummary(logs: Array<Record<string, unknown>>): string {
  const attack = logs.find((log) => log.type === 'Attack');
  return attack ? formatCabtLog(attack) : '';
}
