<script lang="ts">
  import CardTile from '../CardTile.svelte';
  import PromptPanel from './primitives/PromptPanel.svelte';
  import PromptIcon from './primitives/PromptIcon.svelte';
  import SelectableCard from './primitives/SelectableCard.svelte';
  import SelectedCardStrip from './primitives/SelectedCardStrip.svelte';
  import { toggleSelectionIndex } from '../../game/decisions';
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
    {#each cards as card (card.index)}
      <SelectableCard
        selected={selectedIndexes.includes(card.index)}
        disabled={resolving}
        onclick={() => toggleIndex(card.index)}
      >
        <CardTile {card} compact />
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
