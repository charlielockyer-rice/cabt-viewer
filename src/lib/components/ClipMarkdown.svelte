<script lang="ts">
  import { formatClipMarkdown } from '../clips/clipMarkdown';

  type Props = {
    markdown?: string;
  };

  let { markdown = '' }: Props = $props();

  let paragraphs = $derived(formatClipMarkdown(markdown));
</script>

{#each paragraphs as paragraph}
  <p>
    {#each paragraph.lines as line, lineIndex}
      {#if lineIndex > 0}<br />{/if}{#each line as span}{#if span.style === 'bold'}<strong>{span.text}</strong>{:else if span.style === 'code'}<code>{span.text}</code>{:else}{span.text}{/if}{/each}
    {/each}
  </p>
{/each}

<style>
  p {
    margin: 0 0 6px;
    line-height: 1.45;
    overflow-wrap: anywhere;
  }

  p:last-child {
    margin-bottom: 0;
  }

  code {
    padding: 1px 4px;
    border-radius: 4px;
    background: var(--surface-inset-bg);
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.92em;
  }
</style>
