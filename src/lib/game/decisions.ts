import { CabtAreaType, CabtOptionType } from '../cabt/types';
import type { BoardSlotRef, DecisionOptionView, DecisionView, PokemonSlotView } from './types';

// Pure helpers that turn the current DecisionView into UI affordances.
// Legality is option presence — nothing here guesses rules.

export function isMainDecision(decision: DecisionView | undefined): decision is DecisionView {
  return decision?.kind === 'main';
}

export function sameBoardRef(a: BoardSlotRef, b: BoardSlotRef): boolean {
  return a.ownerIndex === b.ownerIndex && a.slot === b.slot && a.index === b.index;
}

export function slotRef(slot: PokemonSlotView): BoardSlotRef {
  return { ownerIndex: slot.ownerIndex, slot: slot.slot, index: slot.index };
}

// Hand indexes the deciding seat can currently play (main phase only).
export function playableHandIndexes(decision: DecisionView | undefined, playerIndex: number): number[] {
  if (!isMainDecision(decision)) {
    return [];
  }
  const indexes = new Set<number>();
  for (const option of decision.options) {
    if (option.hand && option.hand.playerIndex === playerIndex) {
      indexes.add(option.hand.handIndex);
    }
  }
  return [...indexes];
}

export function optionsForHandCard(decision: DecisionView | undefined, playerIndex: number, handIndex: number): DecisionOptionView[] {
  if (!isMainDecision(decision)) {
    return [];
  }
  return decision.options.filter((option) =>
    option.hand && option.hand.playerIndex === playerIndex && option.hand.handIndex === handIndex);
}

// The option that plays the selected hand card onto a specific board slot
// (attach / evolve destinations).
export function handOptionForSlot(
  decision: DecisionView | undefined,
  playerIndex: number,
  handIndex: number,
  slot: BoardSlotRef,
): DecisionOptionView | undefined {
  return optionsForHandCard(decision, playerIndex, handIndex)
    .find((option) => option.boardTarget && sameBoardRef(option.boardTarget, slot));
}

// The option that plays the selected hand card without a board destination
// (trainers, and basics — the engine places those itself).
export function untargetedHandOption(
  decision: DecisionView | undefined,
  playerIndex: number,
  handIndex: number,
): DecisionOptionView | undefined {
  const options = optionsForHandCard(decision, playerIndex, handIndex);
  return options.find((option) => !option.boardTarget);
}

export function endTurnOption(decision: DecisionView | undefined): DecisionOptionView | undefined {
  if (!isMainDecision(decision)) {
    return undefined;
  }
  return decision.options.find((option) => option.type === CabtOptionType.END);
}

export function stadiumOption(decision: DecisionView | undefined): DecisionOptionView | undefined {
  if (!isMainDecision(decision)) {
    return undefined;
  }
  return decision.options.find((option) => option.area === CabtAreaType.STADIUM);
}

// A decision the player answers by clicking a board slot: a forced single
// choice whose options all name distinct slots (new active after a KO, switch
// targets, retreat destination, …). Attached-card choices (energy, tools)
// stay dialogs — a slot click can't disambiguate them.
export function boardDecisionOptions(decision: DecisionView | undefined): DecisionOptionView[] {
  if (!decision || decision.kind === 'main' || decision.min !== 1 || decision.max !== 1 || !decision.options.length) {
    return [];
  }
  if (!decision.options.every((option) => option.board && !option.attached)) {
    return [];
  }
  const keys = new Set(decision.options.map((option) => boardKey(option.board!)));
  return keys.size === decision.options.length ? decision.options : [];
}

export function boardOptionForSlot(decision: DecisionView | undefined, slot: BoardSlotRef): DecisionOptionView | undefined {
  return boardDecisionOptions(decision).find((option) => sameBoardRef(option.board!, slot));
}

// A decision answered by clicking the TARGET of a product option (the
// dedicated evolve select: hand card × board target). Targets may repeat
// across options — duplicate hand copies of the same card — so unlike
// boardDecisionOptions, distinctness is not required.
export function boardTargetDecisionOptions(decision: DecisionView | undefined): DecisionOptionView[] {
  if (!decision || decision.kind === 'main' || decision.min !== 1 || decision.max !== 1 || !decision.options.length) {
    return [];
  }
  return decision.options.every((option) => option.boardTarget && !option.attached) ? decision.options : [];
}

// The pick a click on this target slot commits. Duplicate hand copies of the
// SAME card are game-equivalent — the first option wins; distinct cards
// competing for one target are 'ambiguous' and need the dialog.
export function boardTargetPickForSlot(
  decision: DecisionView | undefined,
  slot: BoardSlotRef,
): DecisionOptionView | 'ambiguous' | undefined {
  const options = boardTargetDecisionOptions(decision)
    .filter((option) => sameBoardRef(option.boardTarget!, slot));
  if (!options.length) {
    return undefined;
  }
  const cardKeys = new Set(options.map((option) => option.card?.id ?? option.label));
  return cardKeys.size === 1 ? options[0] : 'ambiguous';
}

// Dialog caption for a product option: where the pick lands.
export function boardTargetCaption(option: DecisionOptionView): string | undefined {
  if (!option.boardTarget) {
    return undefined;
  }
  const slotName = option.boardTarget.slot === 'bench' ? `Bench ${option.boardTarget.index + 1}` : 'Active';
  return option.boardTargetCard ? `${option.boardTargetCard.name} · ${slotName}` : slotName;
}

function boardKey(ref: BoardSlotRef): string {
  return `${ref.ownerIndex}:${ref.slot}:${ref.index}`;
}

// Toggle an option in a prompt's multi-pick selection, honoring the select's
// max: single-pick swaps, full selections ignore further adds.
export function toggleSelectionIndex(selected: number[], index: number, max: number): number[] {
  if (selected.includes(index)) {
    return selected.filter((item) => item !== index);
  }
  if (max <= 1) {
    return [index];
  }
  return selected.length < max ? [...selected, index] : selected;
}
