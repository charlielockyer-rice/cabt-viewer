<script lang="ts">
  import CardTile from '../CardTile.svelte';
  import PromptPanel from './primitives/PromptPanel.svelte';
  import PromptIcon from './primitives/PromptIcon.svelte';
  import SelectableCard from './primitives/SelectableCard.svelte';
  import type { DecisionView } from '../../game/types';

  type Props = {
    decision: DecisionView;
    resolving?: boolean;
    onselect: (indexes: number[]) => void;
  };

  let { decision, resolving = false, onselect }: Props = $props();

  let selectedIndexes = $state<number[]>([]);
  let decisionSeq = $state(-1);

  $effect(() => {
    if (decisionSeq !== decision.seq) {
      decisionSeq = decision.seq;
      selectedIndexes = [];
    }
  });

  function toggleIndex(index: number) {
    selectedIndexes = selectedIndexes.includes(index)
      ? selectedIndexes.filter((item) => item !== index)
      : decision.max <= 1
        ? [index]
        : selectedIndexes.length < decision.max
          ? [...selectedIndexes, index]
          : selectedIndexes;
  }

  function submitSelectedIndexes() {
    if (selectedIndexes.length >= decision.min) {
      onselect(selectedIndexes);
      selectedIndexes = [];
    }
  }
</script>

<PromptPanel title={decision.message}>
  {#snippet icon()}<PromptIcon name="prize" />{/snippet}

  <div class="prize-prompt-grid">
    {#each decision.options as option (option.index)}
      <SelectableCard
        selected={selectedIndexes.includes(option.index)}
        disabled={resolving}
        onclick={() => toggleIndex(option.index)}
      >
        {#if option.card}
          <CardTile card={option.card} compact />
        {:else}
          <CardTile card={undefined} compact faceDown />
        {/if}
      </SelectableCard>
    {/each}
  </div>

  {#snippet actions()}
    <button class="primary" disabled={resolving || selectedIndexes.length < decision.min} onclick={submitSelectedIndexes}>
      Confirm
    </button>
  {/snippet}
</PromptPanel>
