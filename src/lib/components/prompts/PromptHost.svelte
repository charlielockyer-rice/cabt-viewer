<script lang="ts">
  import ChooseCardsPrompt from './ChooseCardsPrompt.svelte';
  import ChoosePrizePrompt from './ChoosePrizePrompt.svelte';
  import SelectPrompt from './SelectPrompt.svelte';
  import type { DecisionView } from '../../game/types';

  type Props = {
    decision: DecisionView;
    resolving?: boolean;
    onselect: (indexes: number[]) => void;
  };

  let { decision, resolving = false, onselect }: Props = $props();
</script>

{#if decision.kind === 'choose-prize'}
  <ChoosePrizePrompt {decision} {resolving} {onselect} />
{:else if decision.kind === 'choose-cards'}
  <ChooseCardsPrompt {decision} {resolving} {onselect} />
{:else if decision.kind === 'choose-option'}
  <SelectPrompt {decision} {resolving} {onselect} />
{/if}

<style>
  :global(.prompt-grid) {
    display: grid;
    gap: 8px;
    grid-template-columns: repeat(auto-fit, minmax(112px, 1fr));
  }

  :global(.prompt-grid button.selected) {
    outline: var(--selection-outline);
    outline-offset: 1px;
    border-color: var(--selection-border-strong);
    background: var(--selection-bg);
  }

  :global(.search-card-grid) {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(clamp(116px, 9vw, 142px), 1fr));
    gap: 12px;
    align-content: start;
    align-items: start;
    min-height: 0;
    max-height: min(52vh, 560px);
    overflow: auto;
    padding: 10px 12px 14px;
  }

  :global(.prize-prompt-grid) {
    display: grid;
    grid-template-columns: repeat(6, minmax(0, 1fr));
    gap: clamp(10px, 1.2vw, 16px);
    align-items: start;
    min-width: 0;
  }
</style>
