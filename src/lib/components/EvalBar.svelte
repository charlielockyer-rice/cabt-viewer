<script lang="ts">
  // Chess.com-style win-probability rail, LAYERED with both perspectives on one
  // axis (every reading is "my win chance"):
  //   - the solid light fill = P(I win) from MY seat's own observation.
  //   - a subordinate amber tick = the OPPONENT's view of my win chance, i.e.
  //     1 - P(they win) from THEIR own observation.
  // Each value head reads only its own seat's hidden info, so the two need not
  // agree; the gap between the fill and the tick is the information asymmetry.
  // "The true perspective is always between the two players" — the bracket.
  // (A future omniscient value slots in as a third marker inside that bracket.)

  type Props = {
    pWin: number | null;
    oppPWin?: number | null;
    myName?: string;
    opponentName?: string;
  };

  let { pWin, oppPWin = null, myName = 'You', opponentName = 'Opponent' }: Props = $props();

  let known = $derived(typeof pWin === 'number');
  let clamped = $derived(known ? Math.min(1, Math.max(0, pWin as number)) : 0.5);
  let myPct = $derived(Math.round(clamped * 100));
  let fillPct = $derived(clamped * 100);

  // Opponent's assessment of MY win chance = 1 - their P(they win).
  let oppKnown = $derived(typeof oppPWin === 'number');
  let oppMineView = $derived(oppKnown ? Math.min(1, Math.max(0, 1 - (oppPWin as number))) : null);
  let oppPct = $derived(oppMineView === null ? null : Math.round(oppMineView * 100));

  let tip = $derived(
    `Win probability on one axis (your chance to win). Solid = ${myName}'s own read`
    + `; amber tick = ${opponentName}'s read of your chances (1 − their self-estimate).`
    + ` Each sees only its own hidden info, so they can disagree — the gap between them`
    + ` brackets the true perspective.`,
  );
</script>

<div class="eval-bar" class:unknown={!known} title={tip}>
  <span class="cap top" class:leading={known && myPct < 50}>{known ? 100 - myPct : '—'}%</span>
  <div class="track">
    <div class="fill" style={`height: ${fillPct}%`}></div>
    <div class="midline"></div>
    {#if oppMineView !== null}
      <div class="opp-mark" style={`bottom: ${oppMineView * 100}%`} title={`${opponentName} rates your win chance ${oppPct}%`}></div>
    {/if}
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
    /* Neutral, chess.com-style: a light rail for my share against the dark
       slate track (the opponent's). No brand hue -- stays in the board palette. */
    background: linear-gradient(#eef1f5, #ccd3dc);
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

  /* The opponent's read of my win chance, mapped onto the same axis. Subordinate
     to the solid fill: a thin amber tick spanning the rail, so the gap to the
     fill top reads directly as the disagreement. Room stays for a third
     (omniscient) marker later. */
  .opp-mark {
    position: absolute;
    left: -2px;
    right: -2px;
    height: 0;
    border-top: 2px solid #d9772e;
    box-shadow: 0 0 3px rgba(217, 119, 46, 0.7);
    transform: translateY(1px);
    transition: bottom 420ms cubic-bezier(0.22, 1, 0.36, 1);
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
