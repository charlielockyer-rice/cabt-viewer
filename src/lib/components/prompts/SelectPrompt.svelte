<script lang="ts">
  import PromptPanel from './primitives/PromptPanel.svelte';
  import { labelFor } from '../../game/labels';
  import type { DecisionView } from '../../game/types';

  type Props = {
    decision: DecisionView;
    resolving?: boolean;
    onselect: (indexes: number[]) => void;
  };

  let { decision, resolving = false, onselect }: Props = $props();
</script>

<PromptPanel title={decision.message}>
  <div class="prompt-grid">
    {#each decision.options as option (option.index)}
      <button disabled={resolving} onclick={() => onselect([option.index])}>{labelFor(option.label)}</button>
    {/each}
  </div>
</PromptPanel>
