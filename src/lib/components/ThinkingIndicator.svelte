<script lang="ts">
  // "Opponent is thinking…" indicator. Shown while a gameplay request is in
  // flight and the opponent seat is an agent — a slow (search-backed) agent
  // keeps it up for its whole think, a fast agent never crosses the threshold.
  // Agent-agnostic: purely the age of the awaited reply, no per-agent coupling.

  type Props = {
    name: string;
    since: number | null;
    thresholdMs?: number;
  };

  let { name, since, thresholdMs = 500 }: Props = $props();

  let now = $state(Date.now());

  // Tick only while awaiting a reply; stop as soon as it lands.
  $effect(() => {
    if (since === null) {
      return;
    }
    now = Date.now();
    const timer = setInterval(() => (now = Date.now()), 250);
    return () => clearInterval(timer);
  });

  let elapsedMs = $derived(since === null ? 0 : now - since);
  let visible = $derived(since !== null && elapsedMs >= thresholdMs);
  let seconds = $derived(Math.floor(elapsedMs / 1000));
</script>

{#if visible}
  <div class="thinking" role="status" aria-live="polite">
    <span class="dot"></span>
    <span>{name} is thinking… {seconds}s</span>
  </div>
{/if}

<style>
  .thinking {
    position: absolute;
    top: calc(var(--board-top-inset) + 8px);
    left: 50%;
    transform: translateX(-50%);
    z-index: 8;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 6px 13px;
    border-radius: 999px;
    border: 1px solid var(--surface-toolbar-border);
    background: var(--surface-toolbar-bg);
    box-shadow: var(--surface-toolbar-shadow);
    backdrop-filter: blur(var(--backdrop-blur));
    color: var(--text-secondary);
    font-size: 12px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    pointer-events: none;
  }

  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--accent-base);
    animation: thinking-pulse 1.1s ease-in-out infinite;
  }

  @keyframes thinking-pulse {
    0%, 100% { opacity: 0.35; transform: scale(0.85); }
    50% { opacity: 1; transform: scale(1.15); }
  }

  @media (prefers-reduced-motion: reduce) {
    .dot { animation: none; opacity: 0.8; }
  }
</style>
