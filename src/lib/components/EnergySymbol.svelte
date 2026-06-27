<script lang="ts">
  import { energyImageUrl } from '../game/cardAssets';
  import { energySymbolInfo, energySymbolInfoForType, type EnergySymbolInfo } from '../game/energyIcons';
  import { energyImageSlug, energyImageType } from '../game/visualAssets';

  type Props = {
    card?: { name?: string; fullName?: string; energyType?: string | number };
    type?: string | number;
    paid?: boolean;
    title?: string;
    className?: string;
  };

  let {
    card,
    type,
    paid = true,
    title = '',
    className = '',
  }: Props = $props();

  let symbol = $derived<EnergySymbolInfo>(card ? energySymbolInfo(card) : energySymbolInfoForType(type));
  let label = $derived(title || symbol.label);
  let imageSrc = $derived(energyImageUrl(card, type));
  let specialImage = $derived(!!card && energyImageSlug(card, type) !== energyImageType(card, type));
  let symbolStyle = $derived([
    `--energy-symbol-bg: ${symbol.color}`,
    `--energy-symbol-fg: ${symbol.textColor}`,
    `--energy-symbol-border: ${symbol.borderColor}`,
  ].join('; '));
</script>

{#if imageSrc}
  <img
    class={`energy-symbol image-symbol ${symbol.type} ${className}`}
    class:unpaid={!paid}
    class:special-image={specialImage}
    src={imageSrc}
    alt={label}
    title={label}
    draggable="false"
  />
{:else}
  <span
    class={`energy-symbol ${symbol.type} ${className}`}
    class:unpaid={!paid}
    style={symbolStyle}
    title={label}
    aria-label={label}
  >
    {symbol.letter}
  </span>
{/if}

<style>
  .energy-symbol {
    display: inline-grid;
    place-items: center;
    width: 1.45em;
    height: 1.45em;
    min-width: 1.45em;
    border: 1px solid var(--energy-symbol-border);
    border-radius: 999px;
    background:
      radial-gradient(circle at 34% 24%, rgba(255, 255, 255, 0.52), transparent 30%),
      var(--energy-symbol-bg);
    box-shadow:
      inset 0 1px 1px rgba(255, 255, 255, 0.42),
      inset 0 -1px 2px rgba(0, 0, 0, 0.22),
      0 1px 3px rgba(18, 24, 34, 0.22);
    color: var(--energy-symbol-fg);
    font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
    font-size: 0.72em;
    font-weight: 950;
    line-height: 1;
    text-align: center;
    text-shadow: 0 1px 1px rgba(0, 0, 0, 0.18);
    user-select: none;
  }

  .energy-symbol.image-symbol {
    border: 0;
    background: transparent;
    box-shadow: none;
    object-fit: contain;
    pointer-events: none;
    -webkit-user-drag: none;
  }

  .energy-symbol.image-symbol.special-image {
    object-fit: cover;
    transform: scale(1.34);
  }

  .energy-symbol.unpaid {
    filter: grayscale(0.7);
    opacity: 0.46;
  }
</style>
