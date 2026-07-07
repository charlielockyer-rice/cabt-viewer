<script lang="ts">
  import PromptHost from '../prompts/PromptHost.svelte';
  import { decisionDemos } from '../../prompt-gallery/fixtures';

  let results = $state<Record<string, string>>({});

  function recordResult(key: string, indexes: number[]) {
    results = {
      ...results,
      [key]: JSON.stringify(indexes),
    };
  }
</script>

<main class="prompt-gallery">
  <header class="prompt-gallery-header">
    <div>
      <p>Prompt gallery</p>
      <h1>Engine Decision Review</h1>
      <span>Every panel below renders a decision captured from a real CABT game — this is the engine's own select model, projected.</span>
    </div>
    <a href="/">Back to game</a>
  </header>

  <section class="decision-demos">
    {#each decisionDemos as demo (demo.key)}
      <article class="decision-demo">
        <header>
          <strong>{demo.title}</strong>
          <span>{demo.key} · seat {demo.decision.seat} · pick {demo.decision.min}–{demo.decision.max} of {demo.decision.options.length}</span>
        </header>
        <div class="decision-demo-host" class:main-decision={demo.decision.kind === 'main'}>
          {#if demo.decision.kind === 'main'}
            <ul class="main-option-list">
              {#each demo.decision.options as option (option.index)}
                <li>
                  <button onclick={() => recordResult(demo.key, [option.index])}>
                    <span class="option-index">#{option.index}</span>
                    {option.label}
                    {#if option.boardTarget}
                      <span class="option-meta">→ {option.boardTarget.slot} {option.boardTarget.index}</span>
                    {/if}
                  </button>
                </li>
              {/each}
            </ul>
          {:else}
            <PromptHost decision={demo.decision} onselect={(indexes) => recordResult(demo.key, indexes)} />
          {/if}
        </div>
        {#if results[demo.key]}
          <footer>selected indexes: <code>{results[demo.key]}</code></footer>
        {/if}
      </article>
    {/each}
  </section>
</main>

<style>
  .prompt-gallery {
    min-height: 100vh;
    padding: 28px clamp(16px, 4vw, 48px) 64px;
    display: grid;
    gap: 24px;
    align-content: start;
    background: var(--app-bg, #10151c);
    color: var(--text-secondary);
  }

  .prompt-gallery-header {
    display: flex;
    align-items: end;
    justify-content: space-between;
    gap: 16px;
  }

  .prompt-gallery-header p {
    margin: 0;
    color: var(--text-muted);
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }

  .prompt-gallery-header h1 {
    margin: 2px 0 4px;
    color: var(--text-primary);
    font-size: 24px;
  }

  .prompt-gallery-header span {
    color: var(--text-muted);
    font-size: 13px;
  }

  .prompt-gallery-header a {
    color: var(--accent-base, #6ea8e8);
    font-weight: 700;
  }

  .decision-demos {
    display: grid;
    gap: 28px;
  }

  .decision-demo {
    display: grid;
    gap: 12px;
    padding: 16px;
    border: 1px solid var(--surface-glass-border, rgba(140, 160, 190, 0.25));
    border-radius: 10px;
    background: var(--surface-glass-bg, rgba(22, 30, 40, 0.8));
  }

  .decision-demo header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
  }

  .decision-demo header strong {
    color: var(--text-primary);
    font-size: 15px;
  }

  .decision-demo header span {
    color: var(--text-muted);
    font-size: 12px;
  }

  .decision-demo-host {
    position: relative;
    display: grid;
    justify-items: center;
  }

  .main-option-list {
    width: 100%;
    margin: 0;
    padding: 0;
    list-style: none;
    display: grid;
    gap: 6px;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  }

  .main-option-list button {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    border-radius: 7px;
    border: 1px solid var(--button-border, rgba(140, 160, 190, 0.3));
    background: var(--button-bg, rgba(30, 40, 54, 0.9));
    color: var(--button-text, #dbe6f3);
    font-size: 12px;
    text-align: left;
  }

  .option-index {
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }

  .option-meta {
    margin-left: auto;
    color: var(--text-muted);
    font-size: 11px;
  }

  .decision-demo footer {
    color: var(--text-muted);
    font-size: 12px;
  }

  .decision-demo footer code {
    color: var(--text-primary);
  }
</style>
