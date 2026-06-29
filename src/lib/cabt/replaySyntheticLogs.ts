import {
  cabtAbilityNameForCardId,
  cabtDisplayName,
  cabtEvolutionTriggeredDrawSkill,
} from './replayCardData';
import { type CabtPokemonRef, type CabtVisualizeFrame } from './replayInput';
import { CabtAreaType, CabtOptionType } from './types';

export function logsWithSynthesizedAbility(
  previousFrame: CabtVisualizeFrame | undefined,
  frame: CabtVisualizeFrame,
): Array<Record<string, unknown>> {
  const logs = frame.logs ?? [];
  if (!previousFrame || logs.some((log) => normalizedFrameLogType(log.type) === 'Ability')) {
    return logs;
  }
  const abilityLog = abilityLogForSelectedOption(previousFrame, frame)
    ?? abilityLogForTriggeredEvolution(previousFrame, logs);
  return abilityLog ? [abilityLog, ...logs] : logs;
}

function abilityLogForSelectedOption(
  previousFrame: CabtVisualizeFrame,
  frame: CabtVisualizeFrame,
): Record<string, unknown> | null {
  const selected = selectedOptionFromAction(previousFrame.select, frame.action);
  const option = selected?.option;
  if (!option || normalizedOptionType(option.type) !== 'Ability') {
    return null;
  }
  const playerIndex = numberField(option.playerIndex) ?? selected.playerIndex;
  if (playerIndex === undefined) {
    return null;
  }
  const area = numberField(option.area);
  const index = numberField(option.index) ?? 0;
  const source = abilitySourceCard(previousFrame, playerIndex, area, index);
  const cardId = source?.id ?? numberField(option.cardId);
  if (cardId === undefined) {
    return null;
  }
  const abilityName = cabtAbilityNameForCardId(cardId);
  return {
    type: 'Ability',
    playerIndex,
    cardId,
    serial: source?.serial ?? numberField(option.serial),
    abilityName,
    area,
    index,
  };
}

type TriggeredEvolutionAbility = {
  playerIndex: number;
  cardId: number;
  serial?: number;
  abilityName: string;
  drawCount: number;
  area?: number;
  index?: number;
};

function abilityLogForTriggeredEvolution(
  previousFrame: CabtVisualizeFrame,
  logs: Array<Record<string, unknown>>,
): Record<string, unknown> | null {
  const trigger = triggeredEvolutionAbility(previousFrame);
  if (!trigger || !logsAreMatchingTriggeredDraws(logs, trigger)) {
    return null;
  }
  return {
    type: 'Ability',
    playerIndex: trigger.playerIndex,
    cardId: trigger.cardId,
    serial: trigger.serial,
    abilityName: trigger.abilityName,
    area: trigger.area,
    index: trigger.index,
    trigger: 'Evolve',
  };
}

function triggeredEvolutionAbility(frame: CabtVisualizeFrame): TriggeredEvolutionAbility | null {
  const evolveLog = [...(frame.logs ?? [])].reverse().find((log) => normalizedFrameLogType(log.type) === 'Evolve');
  const playerIndex = typeof evolveLog?.playerIndex === 'number' ? evolveLog.playerIndex : undefined;
  const cardId = Number(evolveLog?.cardId);
  if (playerIndex === undefined || !Number.isFinite(cardId)) {
    return null;
  }
  const skill = cabtEvolutionTriggeredDrawSkill(cardId);
  if (!skill) {
    return null;
  }
  const serial = numberField(evolveLog?.serial);
  const source = evolvedPokemonSource(frame, playerIndex, cardId, serial);
  return {
    playerIndex,
    cardId,
    serial,
    abilityName: cabtDisplayName(skill.name.trim()),
    drawCount: skill.drawCount,
    area: source?.area,
    index: source?.index,
  };
}

function evolvedPokemonSource(
  frame: CabtVisualizeFrame,
  playerIndex: number,
  cardId: number,
  serial: number | undefined,
): { area: number; index: number } | undefined {
  const player = frame.current.players[playerIndex];
  if (!player) {
    return undefined;
  }
  const activeIndex = (player.active ?? []).findIndex((pokemon) => pokemonRefMatches(pokemon, cardId, serial));
  if (activeIndex >= 0) {
    return { area: CabtAreaType.ACTIVE, index: activeIndex };
  }
  const benchIndex = (player.bench ?? []).findIndex((pokemon) => pokemonRefMatches(pokemon, cardId, serial));
  if (benchIndex >= 0) {
    return { area: CabtAreaType.BENCH, index: benchIndex };
  }
  return undefined;
}

function pokemonRefMatches(pokemon: CabtPokemonRef | undefined, cardId: number, serial: number | undefined): boolean {
  if (!pokemon) {
    return false;
  }
  if (serial !== undefined) {
    return pokemon.serial === serial;
  }
  return pokemon.id === cardId;
}

function logsAreMatchingTriggeredDraws(logs: Array<Record<string, unknown>>, trigger: TriggeredEvolutionAbility): boolean {
  if (logs.length !== trigger.drawCount) {
    return false;
  }
  return logs.every((log) => {
    const type = normalizedFrameLogType(log.type);
    return (type === 'Draw' || type === 'DrawReverse')
      && log.playerIndex === trigger.playerIndex;
  });
}

function selectedOptionFromAction(
  select: Record<string, unknown> | null | undefined,
  action: unknown,
): { playerIndex: number; option: Record<string, unknown> } | null {
  const options = Array.isArray(select?.option) ? select.option : [];
  if (!options.length || !Array.isArray(action)) {
    return null;
  }
  for (const [playerIndex, playerAction] of action.entries()) {
    const selectedIndex = selectedOptionIndex(playerAction);
    const option = selectedIndex === undefined ? undefined : options[selectedIndex];
    if (option && typeof option === 'object') {
      return { playerIndex, option: option as Record<string, unknown> };
    }
  }
  return null;
}

function selectedOptionIndex(playerAction: unknown): number | undefined {
  if (Array.isArray(playerAction)) {
    return numberField(playerAction[0]);
  }
  return numberField(playerAction);
}

function abilitySourceCard(
  frame: CabtVisualizeFrame,
  playerIndex: number,
  area: number | undefined,
  index: number,
): CabtPokemonRef | undefined {
  const player = frame.current.players[playerIndex];
  if (!player) {
    return undefined;
  }
  if (area === CabtAreaType.ACTIVE) {
    return player.active?.[index] ?? player.active?.[0];
  }
  if (area === CabtAreaType.BENCH) {
    return player.bench?.[index];
  }
  return undefined;
}

function normalizedOptionType(type: unknown): string {
  if (type === CabtOptionType.ABILITY) {
    return 'Ability';
  }
  return String(type ?? '');
}

function normalizedFrameLogType(type: unknown): string {
  return String(type ?? 'Event');
}

function numberField(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}
