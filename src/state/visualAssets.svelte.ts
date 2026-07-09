import type { VisualAssetManifest } from '../lib/game/visualAssets';

class VisualAssetsStore {
  manifest = $state<VisualAssetManifest | undefined>();
  private loadedUrl = '';

  async loadConfiguredManifest() {
    const url = import.meta.env?.VITE_CABT_VISUAL_ASSET_MANIFEST?.trim();
    if (!url || url === this.loadedUrl) {
      return;
    }
    this.loadedUrl = url;
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      this.manifest = await response.json() as VisualAssetManifest;
    } catch {
      this.manifest = undefined;
    }
  }
}

export const visualAssetsStore = new VisualAssetsStore();
