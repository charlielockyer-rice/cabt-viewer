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

  <SelectedCardStrip
    {cards}
    {selectedIndexes}
    slotCount={decision.max}
    onremove={removeSelectedIndex}
  />

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
</style>
