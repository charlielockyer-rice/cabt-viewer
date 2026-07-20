import { describe, expect, it } from 'vitest';
import { energySymbolInfo, energySymbolInfoForType, normalizedTypeName, pokemonTypeLabelFor } from './energyIcons';
import { CabtEnergyType } from '../cabt/types';

describe('energy and Pokemon type helpers', () => {
  it('resolves basic energy symbols from card names', () => {
    expect(energySymbolInfo({ name: 'Basic Psychic Energy' })).toMatchObject({ type: 'psychic', label: 'Psychic', letter: 'P' });
    expect(energySymbolInfo({ name: 'Basic {G} Energy' })).toMatchObject({ type: 'grass', label: 'Grass', letter: 'G' });
    expect(energySymbolInfo({ name: 'Basic Energy', energyType: 1 })).toMatchObject({ type: 'grass', label: 'Grass', letter: 'G' });
    expect(energySymbolInfo({ name: 'Unknown Special Energy' })).toMatchObject({ type: 'colorless', label: 'Colorless', letter: 'C' });
  });

  it('uses requested letters for fire and fairy symbols', () => {
    expect(energySymbolInfoForType('Fire')).toMatchObject({ type: 'fire', letter: 'R' });
    expect(energySymbolInfoForType('Fairy')).toMatchObject({ type: 'fairy', letter: 'Y' });
  });

  it('normalizes card type values for Pokemon badges', () => {
    expect(normalizedTypeName(4)).toBe('lightning');
    expect(normalizedTypeName('{G}')).toBe('grass');
    expect(normalizedTypeName('Dark')).toBe('darkness');
    expect(energySymbolInfoForType('Fire')).toMatchObject({ type: 'fire', label: 'Fire' });
    expect(pokemonTypeLabelFor('Psychic')).toBe('Psychic');
    expect(pokemonTypeLabelFor(undefined)).toBe('Pokemon');
  });

  // The numeric branch of normalizedTypeName is indexed by CabtEnergyType. It was
  // misaligned with that enum (an old TCG-online scale), so Dragon (9) rendered as
  // colorless and Rainbow (10) as a pink Fairy pip — e.g. Legacy Energy. Lock the
  // mapping to the engine's own enum so it can't drift back.
  it('maps CABT numeric energy types to the right symbol (no fairy/dragon collision)', () => {
    expect(normalizedTypeName(CabtEnergyType.GRASS)).toBe('grass');
    expect(normalizedTypeName(CabtEnergyType.FIRE)).toBe('fire');
    expect(normalizedTypeName(CabtEnergyType.WATER)).toBe('water');
    expect(normalizedTypeName(CabtEnergyType.LIGHTNING)).toBe('lightning');
    expect(normalizedTypeName(CabtEnergyType.PSYCHIC)).toBe('psychic');
    expect(normalizedTypeName(CabtEnergyType.FIGHTING)).toBe('fighting');
    expect(normalizedTypeName(CabtEnergyType.DARKNESS)).toBe('darkness');
    expect(normalizedTypeName(CabtEnergyType.METAL)).toBe('metal');
    // Dragon (9) is a real symbol — 35 Dragon Pokemon (Koraidon, Miraidon, …)
    // were rendering as gray colorless before this alignment.
    expect(normalizedTypeName(CabtEnergyType.DRAGON)).toBe('dragon');
    expect(pokemonTypeLabelFor(CabtEnergyType.DRAGON)).toBe('Dragon');
    // Rainbow (10) has no dedicated pip → colorless, and crucially NOT fairy.
    expect(normalizedTypeName(CabtEnergyType.RAINBOW)).not.toBe('fairy');
    expect(energySymbolInfoForType(CabtEnergyType.RAINBOW).type).toBe('colorless');
    expect(energySymbolInfoForType(CabtEnergyType.TEAM_ROCKET).type).toBe('colorless');
  });

  it('renders Legacy Energy (Rainbow, energyType 10) with a colorless pip, not the Fairy pink', () => {
    const symbol = energySymbolInfo({ name: 'Legacy Energy', energyType: CabtEnergyType.RAINBOW });
    expect(symbol.type).toBe('colorless');
  });

  it('still reaches the Fairy pip through the legacy card-name path', () => {
    expect(energySymbolInfo({ name: 'Fairy Energy' })).toMatchObject({ type: 'fairy', letter: 'Y' });
  });
});
