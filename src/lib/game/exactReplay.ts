import { CabtOptionType } from '../cabt/types';
import type { ReplayDecisionAnalysis } from './replayAnalysis';
import type { CardView, GameView, PlayerView } from './types';

// Exact mode intentionally skips choreography, but a played Item or Supporter
// still needs a visible home while its decision is being inspected. The raw
// result frame may keep the resolving card outside every public zone (Ultra
// Ball does this until its discard/search choices finish), so recover the card
// from the selected hand option or the effect source and place it in the same
// play zone the animated replay uses.
export function exactDecisionResultView(
  resultView: GameView | null,
  views: GameView[],
  stateIndex: number,
  rawSelect: unknown,
  analysis: ReplayDecisionAnalysis | null,
): GameView | null {
  if (!resultView || !analysis) {
    return resultView;
  }
  const select = recordValue(rawSelect);
  const played = trainerPlayedFromHand(views[stateIndex], select, analysis)
    ?? resolvingTrainerFromEffect(views, stateIndex, select);
  if (!played || !resultView.players[played.playerIndex]) {
    return resultView;
  }
  return {
    ...resultView,
    players: resultView.players.map((candidate, playerIndex) => (
      playerIndex === played.playerIndex
        ? playerWithCardInPlayZone(candidate, played.card)
        : candidate
    )),
  };
}

function trainerPlayedFromHand(
  sourceView: GameView | undefined,
  select: Record<string, unknown> | null,
  analysis: ReplayDecisionAnalysis,
): { playerIndex: number; card: CardView } | null {
  const playerIndex = analysis.playerIndex;
  const selectedIndex = analysis.playedSelection?.[0];
  const options = Array.isArray(select?.option) ? select.option : [];
  const option = typeof selectedIndex === 'number' ? recordValue(options[selectedIndex]) : null;
  if (playerIndex === undefined || Number(option?.type) !== CabtOptionType.PLAY) {
    return null;
  }
  const handIndex = Number(option?.index);
  const card = Number.isInteger(handIndex) ? sourceView?.players[playerIndex]?.hand[handIndex] : undefined;
  return card && isPlayZoneTrainer(card) ? { playerIndex, card } : null;
}

function resolvingTrainerFromEffect(
  views: GameView[],
  stateIndex: number,
  select: Record<string, unknown> | null,
): { playerIndex: number; card: CardView } | null {
  const effect = recordValue(select?.effect);
  const playerIndex = Number(effect?.playerIndex);
  if (!effect || !Number.isInteger(playerIndex)) {
    return null;
  }
  for (let index = stateIndex; index >= 0; index -= 1) {
    const player = views[index]?.players[playerIndex];
    const card = player ? cardsInPublicPlayerZones(player).find((candidate) => cardMatchesRef(candidate, effect)) : undefined;
    if (card) {
      return isPlayZoneTrainer(card) ? { playerIndex, card } : null;
    }
  }
  return null;
}

function playerWithCardInPlayZone(player: PlayerView, card: CardView): PlayerView {
  return {
    ...player,
    hand: player.hand.filter((candidate) => !sameCard(candidate, card)),
    discard: player.discard.filter((candidate) => !sameCard(candidate, card)),
    playZone: [
      ...player.playZone.filter((candidate) => !sameCard(candidate, card)),
      card,
    ],
  };
}

function cardsInPublicPlayerZones(player: PlayerView): CardView[] {
  return [...player.hand, ...player.discard, ...player.stadium, ...player.playZone];
}

function isPlayZoneTrainer(card: CardView): boolean {
  return card.trainerType === 'Item' || card.trainerType === 'Supporter';
}

function cardMatchesRef(card: CardView, ref: Record<string, unknown>): boolean {
  const serial = Number(ref.serial);
  if (Number.isFinite(serial)) {
    return card.serial === serial;
  }
  const id = Number(ref.id);
  return Number.isFinite(id) && card.id === id;
}

function sameCard(left: CardView, right: CardView): boolean {
  if (left.serial !== undefined && right.serial !== undefined) {
    return left.serial === right.serial;
  }
  return left.id === right.id && left.name === right.name;
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
