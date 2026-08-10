import {
  clipReplayCandidates,
  clipUrl,
  parseClip,
  type Clip,
  type ClipCompareItem,
  type ClipItem,
  type ClipPositionItem,
} from '../lib/clips/clipFormat';
import { replayStore } from './replay.svelte';

export type ClipSeekableItem = ClipPositionItem | ClipCompareItem;

export function isClipSeekable(item: ClipItem | null | undefined): item is ClipSeekableItem {
  return item?.kind === 'position' || item?.kind === 'compare';
}

// A clip is a tour over replays, not a replay of its own: every position it
// names is opened in the ONE replay store the board, timeline, and eval graph
// already read from. This store only decides which position is current.
class ClipStore {
  // True from the moment clip mode is entered, including while loading and
  // after a load failure — the app shell needs a mode, not a document.
  active = $state(false);
  clip = $state<Clip | null>(null);
  ref = $state('');
  selectedIndex = $state(-1);
  loading = $state(false);
  error = $state('');

  // Which replay ref the replay store currently holds. Consecutive items on
  // the same replay seek instead of refetching, so stepping through a clip
  // does not rebuild the same snapshot over and over.
  private loadedReplayRef = '';

  get items(): ClipItem[] {
    return this.clip?.items ?? [];
  }

  get selectedItem(): ClipItem | null {
    return this.items[this.selectedIndex] ?? null;
  }

  get selectedSeekableItem(): ClipSeekableItem | null {
    const item = this.selectedItem;
    return isClipSeekable(item) ? item : null;
  }

  async load(ref: string): Promise<void> {
    this.active = true;
    this.ref = ref;
    this.loading = true;
    this.error = '';
    this.clip = null;
    this.selectedIndex = -1;
    this.loadedReplayRef = '';
    try {
      const url = clipUrl(ref);
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`${url}: ${response.status}`);
      }
      this.clip = parseClip(await response.json());
    } catch (error) {
      this.clip = null;
      this.error = error instanceof Error ? error.message : String(error);
    } finally {
      this.loading = false;
    }
    if (!this.clip) {
      return;
    }
    // Open on the first item that has a board behind it, so the clip lands on
    // a position instead of a wall of prose.
    const firstSeekable = this.clip.items.findIndex(isClipSeekable);
    await this.selectItem(firstSeekable === -1 ? 0 : firstSeekable);
  }

  async selectItem(index: number): Promise<void> {
    const items = this.items;
    if (!items.length) {
      this.selectedIndex = -1;
      return;
    }
    const clamped = Math.min(items.length - 1, Math.max(0, Math.round(index)));
    this.selectedIndex = clamped;
    const item = items[clamped];
    if (!isClipSeekable(item)) {
      // A note leaves the board where it is; the reader keeps their position
      // while they read the aside.
      return;
    }
    if (this.loadedReplayRef === item.replay && replayStore.replay) {
      replayStore.setAnimationsEnabled(!this.exactFor(item));
      replayStore.setStateIndex(item.state);
      return;
    }
    this.loadedReplayRef = item.replay;
    await replayStore.loadFrom(clipReplayCandidates(item.replay), {
      stateIndex: item.state,
      exact: item.exact === true,
    });
    if (!replayStore.replay) {
      this.loadedReplayRef = '';
    }
  }

  async nextItem(): Promise<void> {
    const next = this.items.findIndex((item, index) => index > this.selectedIndex && isClipSeekable(item));
    if (next !== -1) {
      await this.selectItem(next);
    }
  }

  async previousItem(): Promise<void> {
    const previous = this.items
      .map((item, index) => ({ item, index }))
      .filter(({ item, index }) => index < this.selectedIndex && isClipSeekable(item))
      .at(-1)?.index;
    if (previous !== undefined) {
      await this.selectItem(previous);
    }
  }

  clear(): void {
    this.active = false;
    this.clip = null;
    this.ref = '';
    this.selectedIndex = -1;
    this.loading = false;
    this.error = '';
    this.loadedReplayRef = '';
  }

  // Exact-decision mode is an analysis-recording feature: a replay without
  // decision metadata has nothing exact to show, so the flag is ignored there
  // (the same rule the replay loader applies to `detail=exact`).
  private exactFor(item: ClipSeekableItem): boolean {
    return item.exact === true && replayStore.analysisVisibility.mode === 'analysis';
  }
}

export const clipStore = new ClipStore();
