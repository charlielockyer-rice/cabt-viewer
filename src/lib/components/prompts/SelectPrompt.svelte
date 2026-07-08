<script lang="ts">
  import PromptPanel from './primitives/PromptPanel.svelte';
  import { labelFor } from '../../game/labels';
  import { toggleSelectionIndex } from '../../game/decisions';
  import type { DecisionView } from '../../game/types';

  // The universal fallback: labeled option buttons that can complete any
  // select the engine emits. Single-pick answers on the click; multi-pick
  // toggles up to `max` and confirms; `min` 0 offers Skip.
  type Props = {
    decision: DecisionView;
    resolving?: boolean;
    onselect: (indexes: number[]) => void;
  };

  let { decision, resolving = false, onselect }: Props = $props();

  let multiPick = $derived(decision.max > 1);
  let selectedIndexes = $state<number[]>([]);
  let decisionSeq = $state(-1);
  let canSubmitSelection = $derived(selectedIndexes.length >= decision.min && selectedIndexes.length > 0);

  $effect(() => {
    if (decisionSeq !== decision.seq) {
      decisionSeq = decision.seq;
      selectedIndexes = [];
    }
  });

  function clickOption(index: number) {
    if (!multiPick) {
      onselect([index]);
      return;
    }
    selectedIndexes = toggleSelectionIndex(selectedIndexes, index, decision.max);
  }

  function submitSelectedIndexes() {
    if (canSubmitSelection) {
      onselect(selectedIndexes);
      selectedIndexes = [];
    }
  }
</script>

<PromptPanel
  title={decision.message}
  subtitle={multiPick ? `Choose ${decision.min === decision.max ? decision.min : `${decision.min}–${decision.max}`}` : undefined}
>
  <div class="prompt-grid">
    {#each decision.options as option (option.index)}
      <button
        class:selected={multiPick && selectedIndexes.includes(option.index)}
        disabled={resolving}
        onclick={() => clickOption(option.index)}
      >{labelFor(option.label)}</button>
    {/each}
  </div>

  {#snippet actions()}
    {#if decision.min === 0}
      <button disabled={resolving} onclick={() => onselect([])}>Skip</button>
    {/if}
    {#if multiPick}
      <button class="primary" disabled={resolving || !canSubmitSelection} onclick={submitSelectedIndexes}>
        Confirm
      </button>
    {/if}
  {/snippet}
</PromptPanel>
