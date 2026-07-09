<script lang="ts">
  // Chess.com-style win-probability rail. Fills from the bottom with P(my seat
  // wins); the top remainder is the opponent's share. The value comes from
  // copycat-v1-20m's value head, always from MY seat's own observation — an
  // intentionally asymmetric read (it sees my hidden info, not the opponent's),
  // which is why the two seats' probabilities need not sum to 100%.

  type Props = {
    pWin: number | null;
    myName?: string;
    opponentName?: string;
  };

  let { pWin, myName = 'You', opponentName = 'Opponent' }: Props = $props();

  let known = $derived(typeof pWin === 'number');
  let clamped = $derived(known ? Math.min(1, Math.max(0, pWin as number)) : 0.5);
  let myPct = $derived(Math.round(clamped * 100));
  let fillPct = $derived(clamped * 100);
</script>

<div class="eval-bar" class:unknown={!known} title={`Win probability from ${myName}'s view, by copycat-v1-20m's value head. It reads only what ${myName} can see, so the two seats' odds need not add to 100%.`}>
  <span class="cap top" class:leading={known && myPct < 50}>{known ? 100 - myPct : '—'}%</span>
  <div class="track">
    <div class="fill" style={`height: ${fillPct}%`}></div>
    <div class="midline"></div>
  </div>
  <span class="cap bottom" class:leading={known && myPct >= 50}>{known ? myPct : '—'}%</span>
</div>

<style>
  .eval-bar {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    height: 100%;
    width: 100%;
  }

  .track {
    position: relative;
    flex: 1;
    width: 13px;
    border-radius: 7px;
    overflow: hidden;
    /* Opponent's share is the unfilled top of the rail. */
    background: linear-gradient(#3a4250, #2b313c);
    border: 1px solid var(--surface-glass-border);
    box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.35);
  }

  .fill {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    background: linear-gradient(var(--accent-base), var(--accent-strong));
    transition: height 420ms cubic-bezier(0.22, 1, 0.36, 1);
  }

  .midline {
    position: absolute;
    left: 0;
    right: 0;
    top: 50%;
    height: 1px;
    background: rgba(255, 255, 255, 0.42);
    pointer-events: none;
  }

  .cap {
    font-size: 10px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    color: var(--text-muted);
    line-height: 1;
    min-height: 10px;
    text-shadow: 0 1px 2px var(--app-backdrop-bg);
  }

  .cap.leading {
    color: var(--text-primary);
  }

  .eval-bar.unknown .track {
    opacity: 0.5;
  }

  .eval-bar.unknown .fill {
    background: var(--text-muted);
  }
</style>
