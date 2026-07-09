<script lang="ts">
  // Win-probability curve over a whole episode (the replay loss-review tool).
  // One point per decision state of the tracked seat; value cliffs = blunders.
  // Click/drag anywhere to jump the replay to the nearest evaluated state.
  import type { EvalPoint } from '../../state/eval.svelte';

  type Props = {
    points: EvalPoint[];
    stateCount: number;
    currentStateIndex: number;
    seek: (stateIndex: number) => void;
    myName?: string;
    loading?: boolean;
  };

  let { points, stateCount, currentStateIndex, seek, myName = 'You', loading = false }: Props = $props();

  const W = 1000;
  const H = 120;

  let span = $derived(Math.max(1, stateCount - 1));
  let x = (stateIndex: number) => (stateIndex / span) * W;
  let y = (pWin: number) => H - pWin * H;

  let linePath = $derived(
    points.length
      ? points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(p.stateIndex).toFixed(1)} ${y(p.pWin).toFixed(1)}`).join(' ')
      : '',
  );
  let areaPath = $derived(
    points.length
      ? `${linePath} L ${x(points.at(-1)!.stateIndex).toFixed(1)} ${H} L ${x(points[0].stateIndex).toFixed(1)} ${H} Z`
      : '',
  );
  let cursorX = $derived(x(Math.min(currentStateIndex, span)));
  let currentP = $derived(nearestPoint(currentStateIndex));

  function nearestPoint(stateIndex: number): EvalPoint | null {
    let best: EvalPoint | null = null;
    let bestDist = Infinity;
    for (const p of points) {
      const d = Math.abs(p.stateIndex - stateIndex);
      if (d < bestDist) {
        bestDist = d;
        best = p;
      }
    }
    return best;
  }

  let dragging = $state(false);

  function seekFromEvent(event: PointerEvent, el: SVGSVGElement) {
    const rect = el.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    const target = Math.round(frac * span);
    const nearest = nearestPoint(target);
    seek(nearest ? nearest.stateIndex : target);
  }
</script>

<div class="eval-graph" class:empty={!points.length}>
  {#if points.length}
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      role="slider"
      tabindex="0"
      aria-label={`${myName} win probability over the game — click to jump`}
      aria-valuemin={0}
      aria-valuemax={span}
      aria-valuenow={currentStateIndex}
      onpointerdown={(e) => { dragging = true; (e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId); seekFromEvent(e, e.currentTarget as SVGSVGElement); }}
      onpointermove={(e) => { if (dragging) seekFromEvent(e, e.currentTarget as SVGSVGElement); }}
      onpointerup={(e) => { dragging = false; (e.currentTarget as SVGSVGElement).releasePointerCapture(e.pointerId); }}
    >
      <line class="mid" x1="0" y1={H / 2} x2={W} y2={H / 2} />
      <path class="area" d={areaPath} />
      <path class="line" d={linePath} />
      <line class="cursor" x1={cursorX} y1="0" x2={cursorX} y2={H} />
      {#if currentP}
        <circle class="dot" cx={x(currentP.stateIndex)} cy={y(currentP.pWin)} r="7" />
      {/if}
    </svg>
    <span class="reading">{currentP ? `${Math.round(currentP.pWin * 100)}%` : '—'}</span>
  {:else}
    <span class="hint">{loading ? 'Evaluating…' : 'No eval curve (evaluator off or decks unavailable for this replay).'}</span>
  {/if}
</div>

<style>
  .eval-graph {
    position: relative;
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
  }

  svg {
    width: 100%;
    height: 100%;
    display: block;
    cursor: pointer;
    touch-action: none;
    overflow: visible;
  }

  .mid {
    stroke: var(--surface-glass-border);
    stroke-width: 1;
    stroke-dasharray: 4 5;
    vector-effect: non-scaling-stroke;
  }

  .area {
    fill: var(--accent-soft);
  }

  .line {
    fill: none;
    stroke: var(--accent-base);
    stroke-width: 2;
    vector-effect: non-scaling-stroke;
    stroke-linejoin: round;
  }

  .cursor {
    stroke: var(--text-primary);
    stroke-width: 1.5;
    vector-effect: non-scaling-stroke;
    opacity: 0.55;
  }

  .dot {
    fill: var(--accent-strong);
    stroke: var(--app-backdrop-bg);
    stroke-width: 2;
    vector-effect: non-scaling-stroke;
  }

  .reading {
    position: absolute;
    top: 2px;
    right: 4px;
    font-size: 11px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    color: var(--text-secondary);
    pointer-events: none;
  }

  .hint {
    font-size: 12px;
    color: var(--text-muted);
    padding: 0 8px;
  }
</style>
