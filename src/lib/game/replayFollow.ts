import type { ReplayStep } from './replay';

export function replayFollowPlayerForPosition(
  steps: Array<Pick<ReplayStep, 'actionTimeline'>> | null | undefined,
  stepIndex: number,
): number | undefined {
  if (!steps?.length) {
    return undefined;
  }
  const clampedIndex = Math.min(steps.length - 1, Math.max(0, Math.round(stepIndex)));
  for (let index = clampedIndex; index >= 0; index -= 1) {
    const playerIndex = replayFollowPlayerForStep(steps[index]);
    if (playerIndex !== undefined) {
      return playerIndex;
    }
  }
  return undefined;
}

export function replayFollowPlayerForStep(step: Pick<ReplayStep, 'actionTimeline'> | null | undefined): number | undefined {
  const events = step?.actionTimeline ?? [];
  const turnStart = events.find((event) => event.kind === 'TurnStart' && isPlayerIndex(event.playerIndex));
  if (isPlayerIndex(turnStart?.playerIndex)) {
    return turnStart.playerIndex;
  }

  const turnEnd = events.find((event) => event.kind === 'TurnEnd' && isPlayerIndex(event.playerIndex));
  if (isPlayerIndex(turnEnd?.playerIndex)) {
    // A pass-announced TurnEnd HOLDS the perspective on the ending player so the
    // "Pass" bubble plays out fully over their active BEFORE any side switch —
    // the flip defers to the next TurnStart step (its own beat, which dwells
    // after the Pass phase). Without this the flip fired on the Pass step itself,
    // concurrent with the bubble. An ordinary (attack-ended) TurnEnd flips at
    // turn end as before — no bubble there to wait on.
    const passAnnounce = !!(turnEnd.params as Record<string, unknown> | undefined)?.passAnnounce;
    return passAnnounce ? turnEnd.playerIndex : otherPlayerIndex(turnEnd.playerIndex);
  }

  return undefined;
}

function otherPlayerIndex(playerIndex: number): number {
  return playerIndex === 0 ? 1 : 0;
}

function isPlayerIndex(value: unknown): value is 0 | 1 {
  return value === 0 || value === 1;
}
