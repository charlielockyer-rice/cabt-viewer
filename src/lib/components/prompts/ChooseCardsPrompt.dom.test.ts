// @vitest-environment happy-dom
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, expect, it, vi } from 'vitest';
import ChooseCardsPrompt from './ChooseCardsPrompt.svelte';
import type { CardView, DecisionView } from '../../game/types';

let app: Record<string, unknown> | undefined;

afterEach(() => {
  if (app) {
    unmount(app);
    app = undefined;
  }
  document.body.innerHTML = '';
});

function pokemon(name: string, stage: 'Basic' | 'Stage 1'): CardView {
  return { name, fullName: name, superType: 'Pokemon', stage };
}

function trainer(name: string): CardView {
  return { name, fullName: name, superType: 'Trainer', trainerType: 'Item' };
}

// Two of the six deck cards are legal picks (a Poffin-shaped search).
const deckDecision: DecisionView = {
  seq: 1,
  seat: 0,
  kind: 'choose-cards',
  message: 'Choose Bench Pokemon',
  min: 0,
  max: 2,
  options: [
    { index: 0, type: 3, area: 1, label: 'Applin', card: pokemon('Applin', 'Basic') },
    { index: 1, type: 3, area: 1, label: 'Snover', card: pokemon('Snover', 'Basic') },
  ],
  deckCards: [
    { card: pokemon('Applin', 'Basic'), optionIndex: 0 },
    { card: pokemon('Snover', 'Basic'), optionIndex: 1 },
    { card: pokemon('Abomasnow', 'Stage 1') },
    { card: trainer('Nest Ball') },
    { card: trainer('Ultra Ball') },
    { card: trainer('Switch') },
  ],
};

function mountPrompt(decision: DecisionView, onselect: (indexes: number[]) => void) {
  app = mount(ChooseCardsPrompt, { target: document.body, props: { decision, onselect } });
  flushSync();
}

function selectableButtons() {
  return [...document.querySelectorAll<HTMLButtonElement>('.search-card-scroll button.selectable-card')];
}

function fadedTiles() {
  return [...document.querySelectorAll<HTMLElement>('.deck-search-faded')];
}

function clickText(text: string) {
  const button = [...document.querySelectorAll<HTMLButtonElement>('button')]
    .find((candidate) => candidate.textContent?.trim() === text);
  button?.click();
  flushSync();
}

it('shows the whole deck: the legal picks first, the rest inert and faded', () => {
  const onselect = vi.fn();
  mountPrompt(deckDecision, onselect);

  expect(document.body.textContent).toContain('2 selectable of 6 cards in your deck');
  expect(selectableButtons()).toHaveLength(2);

  const faded = fadedTiles();
  expect(faded).toHaveLength(4);
  expect(faded.map((tile) => tile.querySelector('.card-tile')?.tagName)).toEqual(['DIV', 'DIV', 'DIV', 'DIV']);
  expect(faded.every((tile) => tile.getAttribute('aria-hidden') === 'true')).toBe(true);
  expect(faded.some((tile) => tile.querySelector('button'))).toBe(false);
  expect(document.body.textContent).toContain('Not selectable for this effect');
});

it('a faded deck card is not an affordance', () => {
  const onselect = vi.fn();
  mountPrompt(deckDecision, onselect);

  for (const tile of fadedTiles()) {
    (tile as HTMLElement).click();
    tile.querySelector<HTMLElement>('.card-tile')?.click();
  }
  flushSync();
  clickText('Confirm');

  expect(onselect).not.toHaveBeenCalled();
});

it('picking a deck card and confirming sends its engine option index', () => {
  const onselect = vi.fn();
  mountPrompt(deckDecision, onselect);

  selectableButtons()[1]?.click();
  flushSync();
  clickText('Confirm');

  expect(onselect).toHaveBeenCalledWith([1]);
});

it('renders the options alone when the decision carries no deck', () => {
  const onselect = vi.fn();
  const { deckCards: _deckCards, ...lookedAt } = deckDecision;
  mountPrompt(lookedAt, onselect);

  expect(selectableButtons()).toHaveLength(2);
  expect(fadedTiles()).toHaveLength(0);
  expect(document.body.textContent).not.toContain('cards in your deck');
  expect(document.body.textContent).not.toContain('Not selectable for this effect');

  selectableButtons()[0]?.click();
  flushSync();
  clickText('Confirm');

  expect(onselect).toHaveBeenCalledWith([0]);
});
