<script lang="ts">
  import { cardBackImageUrl, cardFaceImageUrl } from '../game/cardAssets';
  import type { CardView } from '../game/types';

  type Props = {
    card?: CardView;
    compact?: boolean;
    selected?: boolean;
    draggable?: boolean;
    disabled?: boolean;
    interactive?: boolean;
    faceDown?: boolean;
    playable?: boolean;
    damage?: number;
    testId?: string;
    onclick?: (event: MouseEvent) => void;
    ondragstart?: (event: DragEvent) => void;
    ondragend?: (event: DragEvent) => void;
  };

  let {
    card,
    compact = false,
    selected = false,
    draggable = false,
    disabled = false,
    interactive = false,
    faceDown = false,
    playable = false,
    damage = 0,
    testId = '',
    onclick,
    ondragstart,
    ondragend,
  }: Props = $props();

  let failedImageUrl = $state('');

  let imageUrl = $derived(faceDown ? cardBackImageUrl() : cardFaceImageUrl(card));
  let lastImageUrl = $state<string | undefined>();
  let showImage = $derived(!!imageUrl && failedImageUrl !== imageUrl);
  let label = $derived(faceDown ? 'Card' : (card?.name ?? 'Empty'));
  let setLabel = $derived(!faceDown && card?.set ? [card.set, card.setNumber].filter(Boolean).join(' ') : '');
  let typeClass = $derived(faceDown
    ? 'back'
    : card?.energyType !== undefined || card?.superType === 'Energy' || card?.name?.includes('Energy')
      ? 'energy'
      : card?.trainerType !== undefined || card?.superType === 'Trainer'
        ? 'trainer'
        : card
          ? 'pokemon'
          : 'empty');
  let typeLabel = $derived(faceDown
    ? 'CABT'
    : typeClass === 'energy'
      ? 'Energy'
      : typeClass === 'trainer'
        ? 'Trainer'
        : typeClass === 'pokemon'
          ? 'Pokemon'
          : 'Card');

  $effect(() => {
    if (imageUrl !== lastImageUrl) {
      failedImageUrl = '';
      lastImageUrl = imageUrl;
    }
  });

  function preventSelection(event: Event) {
    event.preventDefault();
  }
</script>

{#if interactive}
  <button
    type="button"
    class:selected
    class:compact
    class:playable
    class={`card-tile ${typeClass}`}
    draggable={draggable && !disabled}
    {disabled}
    data-testid={testId || undefined}
    data-card-id={card?.id ?? undefined}
    data-card-serial={card?.serial ?? undefined}
    data-card-player-index={card?.playerIndex ?? undefined}
    title={card?.fullName ?? label}
    {onclick}
    {ondragstart}
    {ondragend}
    onselectstart={preventSelection}
  >
    {#if showImage}
      <img src={imageUrl} alt="" loading="eager" decoding="sync" draggable="false" onerror={() => (failedImageUrl = imageUrl ?? '')} />
    {:else}
      <span class="fallback-card">
        <span class="fallback-kind">{typeLabel}</span>
        <span class="fallback-name">{label}</span>
        {#if setLabel}
          <span class="fallback-set">{setLabel}</span>
        {/if}
      </span>
    {/if}
    {#if damage > 0}
      <span class="damage-counter" class:triple-digit={damage >= 100} title={`${damage} damage`}>
        <span class="damage-counter-value">{damage}</span>
      </span>
    {/if}
  </button>
{:else}
  <div
    class:selected
    class:compact
    class:playable
    class={`card-tile ${typeClass}`}
    data-testid={testId || undefined}
    data-card-id={card?.id ?? undefined}
    data-card-serial={card?.serial ?? undefined}
    data-card-player-index={card?.playerIndex ?? undefined}
    title={card?.fullName ?? label}
  >
    {#if showImage}
      <img src={imageUrl} alt="" loading="eager" decoding="sync" draggable="false" onerror={() => (failedImageUrl = imageUrl ?? '')} />
    {:else}
      <span class="fallback-card">
        <span class="fallback-kind">{typeLabel}</span>
        <span class="fallback-name">{label}</span>
        {#if setLabel}
          <span class="fallback-set">{setLabel}</span>
        {/if}
      </span>
    {/if}
    {#if damage > 0}
      <span class="damage-counter" class:triple-digit={damage >= 100} title={`${damage} damage`}>
        <span class="damage-counter-value">{damage}</span>
      </span>
    {/if}
  </div>
{/if}

<style>
  .card-tile {
    position: relative;
    z-index: 0;
    width: var(--card-w, clamp(58px, 5.3vw, 88px));
    aspect-ratio: 63 / 88;
    display: grid;
    place-items: stretch;
    padding: 0;
    overflow: hidden;
    border: 0;
    border-radius: 5px;
    background: #f7f8fa;
    box-shadow: 0 3px 8px rgba(23, 30, 38, 0.28);
    transition: transform 120ms ease, box-shadow 120ms ease, outline-color 120ms ease, filter 120ms ease;
  }

  button.card-tile:hover:not(:disabled) {
    z-index: 4;
    transform: translateY(-6px);
    box-shadow: var(--glow-hover-shadow);
    filter: saturate(1.05);
  }

  .card-tile.compact {
    width: var(--card-w, clamp(62px, 5.7vw, 92px));
  }

  .card-tile.selected {
    z-index: 3;
    transform: translateY(-6px);
    outline: 0;
    box-shadow: var(--glow-selected-shadow);
  }

  button.card-tile.selected:hover:not(:disabled) {
    box-shadow: var(--glow-selected-shadow);
  }

  .card-tile.playable {
    outline: 0;
    box-shadow: var(--glow-playable-shadow);
  }

  button.card-tile.selected:disabled {
    opacity: 1;
  }

  .card-tile img {
    width: 100%;
    height: 100%;
    object-fit: fill;
    display: block;
    pointer-events: none;
    -webkit-user-drag: none;
  }

  .fallback-card {
    position: relative;
    display: grid;
    grid-template-rows: minmax(14px, 0.16fr) 1fr minmax(14px, 0.18fr);
    align-items: center;
    justify-items: center;
    height: 100%;
    padding: 8% 8% 7%;
    border: 1px solid rgba(52, 64, 78, 0.18);
    border-radius: inherit;
    background:
      linear-gradient(180deg, rgba(255, 255, 255, 0.72), rgba(255, 255, 255, 0) 28%),
      linear-gradient(145deg, rgba(248, 250, 252, 0.92), rgba(226, 232, 240, 0.94));
    color: #18212d;
    box-sizing: border-box;
  }

  .card-tile.pokemon .fallback-card {
    background:
      linear-gradient(180deg, rgba(255, 255, 255, 0.7), rgba(255, 255, 255, 0) 30%),
      linear-gradient(145deg, #eaf4ee, #b8d7c4);
  }

  .card-tile.energy .fallback-card {
    background:
      linear-gradient(180deg, rgba(255, 255, 255, 0.72), rgba(255, 255, 255, 0) 30%),
      linear-gradient(145deg, #fff6c2, #dfc04d);
  }

  .card-tile.trainer .fallback-card {
    background:
      linear-gradient(180deg, rgba(255, 255, 255, 0.72), rgba(255, 255, 255, 0) 30%),
      linear-gradient(145deg, #f8fafc, #cbd5e1);
  }

  .card-tile.back .fallback-card {
    background:
      linear-gradient(135deg, rgba(255, 255, 255, 0.1), transparent 28%),
      repeating-linear-gradient(45deg, rgba(255, 255, 255, 0.08) 0 6px, transparent 6px 12px),
      linear-gradient(145deg, #203654, #111a2c);
    color: #edf4ff;
  }

  .fallback-kind,
  .fallback-set {
    max-width: 100%;
    overflow: hidden;
    color: rgba(24, 33, 45, 0.68);
    font-size: clamp(7px, calc(var(--card-w, 88px) * 0.105), 10px);
    font-weight: 850;
    letter-spacing: 0;
    line-height: 1;
    text-overflow: ellipsis;
    text-transform: uppercase;
    white-space: nowrap;
  }

  .card-tile.back .fallback-kind,
  .card-tile.back .fallback-set {
    color: rgba(237, 244, 255, 0.76);
  }

  .fallback-name {
    display: -webkit-box;
    max-width: 100%;
    overflow: hidden;
    text-align: center;
    color: inherit;
    font-size: clamp(9px, calc(var(--card-w, 88px) * 0.14), 13px);
    font-weight: 950;
    letter-spacing: 0;
    line-height: 1.08;
    overflow-wrap: anywhere;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 5;
  }

  .damage-counter {
    position: absolute;
    top: 32%;
    left: 50%;
    z-index: 10;
    display: inline-grid;
    place-items: center;
    width: clamp(34px, calc(var(--slot-card-w, var(--card-w, 88px)) * 0.38), 66px);
    height: clamp(34px, calc(var(--slot-card-w, var(--card-w, 88px)) * 0.38), 66px);
    padding: 0;
    border-radius: 999px;
    border: 1px solid rgba(128, 76, 18, 0.46);
    background:
      radial-gradient(circle at 34% 24%, rgba(255, 232, 121, 0.9), transparent 34%),
      linear-gradient(180deg, #ffb03d 0%, #f39023 54%, #c97018 100%);
    box-shadow:
      0 3px 8px rgba(95, 48, 13, 0.28),
      inset 0 2px 2px rgba(255, 236, 155, 0.7),
      inset 0 -2px 3px rgba(128, 60, 10, 0.34);
    color: #fff8df;
    font-size: clamp(15px, calc(var(--slot-card-w, var(--card-w, 88px)) * 0.19), 30px);
    font-weight: 950;
    line-height: 1;
    -webkit-text-stroke: 1.3px #1f1f1f;
    paint-order: stroke fill;
    transform: translate(-50%, -50%);
    pointer-events: none;
    text-shadow: none;
  }

  .damage-counter-value {
    display: inline-block;
  }

  .damage-counter.triple-digit {
    font-size: clamp(13px, calc(var(--slot-card-w, var(--card-w, 88px)) * 0.165), 26px);
  }
</style>
