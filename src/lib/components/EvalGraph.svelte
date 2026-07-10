<script lang="ts">
  // Win-probability curves over a whole episode (the replay loss-review tool).
  // TWO layered lines — my seat's self-view value and the opponent's self-view
  // value — one point per that seat's decision state. Where they DIVERGE, that
  // gap IS the information asymmetry (each judges from what only it can see).
  // Click/drag anywhere to jump the replay to the nearest evaluated state.
  import type { EvalPoint } from '../../state/eval.svelte';

  type Props = {
    myPoints: EvalPoint[];
    oppPoints: EvalPoint[];
    stateCount: number;
    currentStateIndex: number;
    seek: (stateIndex: number) => void;
    myName?: string;
    oppName?: string;
    loading?: boolean;
  };

  let {
    myPoints, oppPoints, stateCount, currentStateIndex, seek,
    myName = 'You', oppName = 'Opponent', loading = false,
  }: Props = $props();

  const W = 1000;
  const H = 120;

  let span = $derived(Math.max(1, stateCount - 1));
  let hasAny = $derived(myPoints.length > 0 || oppPoints.length > 0);
  let x = (stateIndex: number) => (stateIndex / span) * W;
  let y = (pWin: number) => H - pWin * H;

  function linePath(points: EvalPoint[]): string {
    return points.length
      ? points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(p.stateIndex).toFixed(1)} ${y(p.pWin).toFixed(1)}`).join(' ')
      : '';
  }
  function areaPath(points: EvalPoint[]): string {
    if (!points.length) return '';
    return `${linePath(points)} L ${x(points.at(-1)!.stateIndex).toFixed(1)} ${H} L ${x(points[0].stateIndex).toFixed(1)} ${H} Z`;
  }
  function nearest(points: EvalPoint[], stateIndex: number): EvalPoint | null {
    let best: EvalPoint | null = null;
    let bestDist = Infinity;
    for (const p of points) {
      const d = Math.abs(p.stateIndex - stateIndex);
      if (d < bestDist) { bestDist = d; best = p; }
    }
    return best;
  }

  let myLine = $derived(linePath(myPoints));
  let myArea = $derived(areaPath(myPoints));
  let oppLine = $derived(linePath(oppPoints));
  let cursorX = $derived(x(Math.min(currentStateIndex, span)));
  let myAt = $derived(nearest(myPoints, currentStateIndex));
  let oppAt = $derived(nearest(oppPoints, currentStateIndex));

  let dragging = $state(false);
  function seekFromEvent(event: PointerEvent, el: SVGSVGElement) {
    const rect = el.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    const target = Math.round(frac * span);
    const n = nearest([...myPoints, ...oppPoints], target);
    seek(n ? n.stateIndex : target);
  }
  const pct = (p: EvalPoint | null) => (p ? `${Math.round(p.pWin * 100)}%` : '—');
</script>

<div class="eval-graph" class:empty={!hasAny}>
  {#if hasAny}
    <div class="legend">
      <span class="key mine"><i></i>{myName} {pct(myAt)}</span>
      <span class="key opp"><i></i>{oppName} {pct(oppAt)}</span>
    </div>
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      role="slider"
      tabindex="0"
      aria-label={`win probability lines for ${myName} and ${oppName} — click to jump`}
      aria-valuemin={0}
      aria-valuemax={span}
      aria-valuenow={currentStateIndex}
      onpointerdown={(e) => { dragging = true; (e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId); seekFromEvent(e, e.currentTarget as SVGSVGElement); }}
      onpointermove={(e) => { if (dragging) seekFromEvent(e, e.currentTarget as SVGSVGElement); }}
      onpointerup={(e) => { dragging = false; (e.currentTarget as SVGSVGElement).releasePointerCapture(e.pointerId); }}
    >
      <line class="mid" x1="0" y1={H / 2} x2={W} y2={H / 2} />
      <path class="area" d={myArea} />
      <path class="line mine" d={myLine} />
      <path class="line opp" d={oppLine} />
      <line class="cursor" x1={cursorX} y1="0" x2={cursorX} y2={H} />
      {#if myAt}<circle class="dot mine" cx={x(myAt.stateIndex)} cy={y(myAt.pWin)} r="6" />{/if}
      {#if oppAt}<circle class="dot opp" cx={x(oppAt.stateIndex)} cy={y(oppAt.pWin)} r="6" />{/if}
    </svg>
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

  .legend {
    position: absolute;
    top: 1px;
    left: 6px;
    display: flex;
    gap: 12px;
    font-size: 11px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    pointer-events: none;
    z-index: 1;
  }
  .key { display: inline-flex; align-items: center; gap: 4px; color: var(--text-secondary); }
  .key i { width: 10px; height: 2.5px; border-radius: 2px; display: inline-block; }
  .key.mine i { background: var(--accent-base); }
  .key.opp i { background: #d9772e; }

  svg { width: 100%; height: 100%; display: block; cursor: pointer; touch-action: none; overflow: visible; }

  .mid { stroke: var(--surface-glass-border); stroke-width: 1; stroke-dasharray: 4 5; vector-effect: non-scaling-stroke; }
  .area { fill: var(--accent-soft); }
  .line { fill: none; stroke-width: 2; vector-effect: non-scaling-stroke; stroke-linejoin: round; }
  .line.mine { stroke: var(--accent-base); }
  .line.opp { stroke: #d9772e; stroke-dasharray: 5 3; }
  .cursor { stroke: var(--text-primary); stroke-width: 1.5; vector-effect: non-scaling-stroke; opacity: 0.55; }
  .dot { stroke: var(--app-backdrop-bg); stroke-width: 2; vector-effect: non-scaling-stroke; }
  .dot.mine { fill: var(--accent-strong); }
  .dot.opp { fill: #d9772e; }

  .hint { font-size: 12px; color: var(--text-muted); padding: 0 8px; }
</style>
