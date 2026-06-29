import {
  cabtCardToView,
  cabtFaceDownCard,
  cabtRetreatCost,
} from './replayCardData';
import type { CabtCardRef, CabtPlayerFrame, CabtPokemonRef, CabtVisualizeFrame } from './replayInput';
import { SlotType, targetFor, type GameView, type LogView, type PlayerView, type PokemonSlotView } from '../game/types';

export function frameToGameView(
  frame: CabtVisualizeFrame,
  playerNamesForReplay: string[],
  logs: LogView[],
  actionTimeline: GameView['actionTimeline'],
): GameView {
  const current = frame.current;
  const activePlayerIndex = clampPlayerIndex(current.yourIndex);
  const stadium = current.stadium ?? [];
  const players = current.players.map((player, index) =>
    buildPlayerView(player, index, activePlayerIndex, playerNamesForReplay[index] ?? `Player ${index + 1}`, stadiumForPlayer(stadium, index)),
  );
  return {
    ready: true,
    phase: current.result >= 0 ? 7 : 2,
    phaseLabel: current.result >= 0 ? 'Finished' : 'CABT replay',
    turn: current.turn,
    activePlayerIndex,
    activePlayerId: players[activePlayerIndex]?.id,
    winner: current.result >= 0 && current.result <= 1 ? current.result : current.result === 2 ? 3 : undefined,
    players,
    prompts: [],
    logs: [...logs],
    actionTimeline,
    events: [frame],
  };
}

function stadiumForPlayer(stadium: CabtCardRef[], playerIndex: number): CabtCardRef[] {
  const owned = stadium.filter((card) => card.playerIndex === playerIndex);
  if (owned.length) {
    return owned;
  }
  return playerIndex === 0
    ? stadium.filter((card) => card.playerIndex === undefined || card.playerIndex === null)
    : [];
}

function buildPlayerView(
  player: CabtPlayerFrame,
  index: number,
  activePlayerIndex: number,
  name: string,
  stadium: CabtCardRef[],
): PlayerView {
  const hand = player.hand ?? [];
  return {
    index,
    id: index,
    name,
    hand: hand.length ? hand.map(cabtCardToView) : Array.from({ length: player.handCount ?? 0 }, () => cabtFaceDownCard()),
    deckCount: player.deckCount ?? 0,
    discard: (player.discard ?? []).map(cabtCardToView),
    lostZone: [],
    stadium: stadium.map(cabtCardToView),
    playZone: [],
    prizesLeft: player.prize?.length ?? 0,
    active: pokemonToSlot(player.active?.[0] ?? null, index, 'active', 0, activePlayerIndex, player),
    bench: Array.from({ length: Math.max(player.benchMax ?? 5, player.bench?.length ?? 0) }, (_item, benchIndex) =>
      pokemonToSlot(player.bench?.[benchIndex] ?? null, index, 'bench', benchIndex, activePlayerIndex, player),
    ),
    playableCardIds: hand.map((card) => card.id),
    availableActions: {
      active: {
        attacks: [],
        abilities: [],
        retreat: { legal: false, targets: [] },
      },
      bench: (player.bench ?? []).map((_bench, benchIndex) => ({ index: benchIndex, abilities: [] })),
    },
  };
}

function pokemonToSlot(
  pokemonCard: CabtPokemonRef | null,
  ownerIndex: number,
  slot: 'active' | 'bench',
  index: number,
  activePlayerIndex: number,
  player: CabtPlayerFrame,
): PokemonSlotView {
  const slotType = slot === 'active' ? SlotType.ACTIVE : SlotType.BENCH;
  const pokemonView = pokemonCard ? cabtCardToView(pokemonCard) : undefined;
  const maxHp = pokemonCard?.maxHp ?? pokemonView?.hp ?? 0;
  const currentHp = pokemonCard?.hp ?? maxHp;
  return {
    ownerIndex,
    slot,
    index,
    target: targetFor(activePlayerIndex, ownerIndex, slotType, index),
    empty: !pokemonCard,
    pokemon: pokemonView,
    cards: pokemonView ? [pokemonView, ...(pokemonCard?.preEvolution ?? []).map(cabtCardToView)] : [],
    damage: Math.max(0, maxHp - currentHp),
    hp: maxHp,
    retreat: Array.from({ length: cabtRetreatCost(pokemonCard?.id) }, () => 'Colorless'),
    energy: (pokemonCard?.energyCards ?? []).map(cabtCardToView),
    tools: (pokemonCard?.tools ?? []).map(cabtCardToView),
    specialConditions: slot === 'active'
      ? [
          player.poisoned ? 'Poisoned' : null,
          player.burned ? 'Burned' : null,
          player.asleep ? 'Asleep' : null,
          player.paralyzed ? 'Paralyzed' : null,
          player.confused ? 'Confused' : null,
        ].filter((condition): condition is string => !!condition)
      : [],
  };
}

function clampPlayerIndex(index: number): number {
  return index === 1 ? 1 : 0;
}
