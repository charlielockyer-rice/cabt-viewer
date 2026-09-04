<script lang="ts">
  import CardTile from '../CardTile.svelte';
  import PromptPanel from './primitives/PromptPanel.svelte';
  import PromptIcon from './primitives/PromptIcon.svelte';
  import SelectableCard from './primitives/SelectableCard.svelte';
  import SelectedCardStrip from './primitives/SelectedCardStrip.svelte';
  import { boardTargetCaption, toggleSelectionIndex } from '../../game/decisions';
  import type { DecisionView } from '../../game/types';

  type Props = {
    decision: DecisionView;
    resolving?: boolean;
    onselect: (indexes: number[]) => void;
  };

  let { decision, resolving = false, onselect }: Props = $props();

  let selectedIndexes = $state<number[]>([]);
  let decisionSeq = $state(-1);
  let cards = $derived(decision.options.map((option) => ({
    ...(option.card ?? { name: option.label, fullName: option.label }),
    index: option.index,
  })));
  let optionalSelection = $derived(decision.min === 0);
  let canSubmitSelection = $derived(selectedIndexes.length >= decision.min && selectedIndexes.length > 0);

  // A deck search shows the player their whole deck: the cards this effect can
  // take, then everything else faded out. Every other card prompt (a looked-at
  // set, a replay decision) has no deck payload and renders the options alone.
  let deckCards = $derived(decision.deckCards);
  let selectableDeckCards = $derived((deckCards ?? []).flatMap((item) =>
    item.optionIndex === undefined ? [] : [{ card: item.card, optionIndex: item.optionIndex }]));
  let unselectableDeckCards = $derived((deckCards ?? []).filter((item) => item.optionIndex === undefined));

  $effect(() => {
    if (decisionSeq !== decision.seq) {
      decisionSeq = decision.seq;
      selectedIndexes = [];
    }
  });

  function toggleIndex(index: number) {
    selectedIndexes = toggleSelectionIndex(selectedIndexes, index, decision.max);
  }

  function submitSelectedIndexes() {
    if (canSubmitSelection) {
      onselect(selectedIndexes);
      selectedIndexes = [];
    }
  }

  function removeSelectedIndex(index: number) {
    selectedIndexes = selectedIndexes.filter((item) => item !== index);
  }
</script>

<PromptPanel title={decision.message} variant="search">
  {#snippet icon()}<PromptIcon name="cards" />{/snippet}

  {#if deckCards}
    <p class="deck-search-summary">
      {selectableDeckCards.length} selectable of {deckCards.length} cards in your deck
    </p>
  {/if}

  <SelectedCardStrip
    {cards}
    {selectedIndexes}
    slotCount={decision.max}
    onremove={removeSelectedIndex}
  />

  <div class="search-card-scroll">
    {#if deckCards}
      <div class="search-card-grid">
        {#each selectableDeckCards as item (item.optionIndex)}
          {@const option = decision.options.find((candidate) => candidate.index === item.optionIndex)}
          {@const caption = option ? boardTargetCaption(option) : undefined}
          <SelectableCard
            selected={selectedIndexes.includes(item.optionIndex)}
            disabled={resolving}
            onclick={() => toggleIndex(item.optionIndex)}
          >
            <div class="card-option">
              <CardTile card={item.card} compact />
              {#if caption}
                <span class="card-target-caption">→ {caption}</span>
              {/if}
            </div>
          </SelectableCard>
        {/each}
      </div>

      <div class="deck-search-divider">
        <span>Not selectable for this effect</span>
      </div>

      <div class="search-card-grid">
        {#each unselectableDeckCards as item, position (position)}
          <div class="deck-search-faded" aria-hidden="true">
            <CardTile card={item.card} compact />
          </div>
        {/each}
      </div>
    {:else}
      <div class="search-card-grid">
        {#each decision.options as option, optionPosition (option.index)}
          {@const caption = boardTargetCaption(option)}
          <SelectableCard
            selected={selectedIndexes.includes(option.index)}
            disabled={resolving}
            onclick={() => toggleIndex(option.index)}
          >
            <div class="card-option" title={caption ? `${option.label}` : undefined}>
              <CardTile card={cards[optionPosition]} compact />
              {#if caption}
                <span class="card-target-caption">→ {caption}</span>
              {/if}
            </div>
          </SelectableCard>
        {/each}
      </div>
    {/if}
  </div>

  {#snippet actions()}
    {#if optionalSelection}
      <button disabled={resolving} onclick={() => onselect([])}>Skip</button>
    {/if}
    <button class="primary" disabled={resolving || !canSubmitSelection} onclick={submitSelectedIndexes}>
      Confirm
    </button>
  {/snippet}
</PromptPanel>

<style>
  .deck-search-summary {
    margin: 0;
    color: var(--text-secondary);
    font-size: 13px;
    font-weight: 700;
  }

  .card-option {
    display: grid;
    gap: 4px;
    justify-items: center;
  }

  .card-target-caption {
    max-width: 100%;
    overflow: hidden;
    color: var(--text-secondary);
    font-size: 11px;
    font-weight: 700;
    line-height: 1.2;
    text-align: center;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .deck-search-divider {
    margin-top: 6px;
    padding-top: 12px;
    border-top: 1px solid var(--surface-inset-border);
  }

  .deck-search-divider span {
    color: var(--text-muted);
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  /* The rest of the deck is context, not an affordance: same footprint as a
     SelectableCard so both grids line up, but inert and dimmed. */
  .deck-search-faded {
    display: grid;
    justify-items: center;
    min-width: 0;
    padding: 4px;
    border: 1px solid transparent;
    opacity: var(--deck-faded-opacity);
    filter: saturate(0.55);
    pointer-events: none;
  }

  .deck-search-faded :global(.card-tile) {
    width: 100%;
    box-shadow: 0 2px 5px rgba(23, 30, 38, 0.18);
  }
</style>
