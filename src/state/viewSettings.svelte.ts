import { replayStore } from './replay.svelte';

const DEFAULT_BOARD_TILT = 8;
const DEFAULT_BOARD_PERSPECTIVE = 1250;
const DEFAULT_BOARD_SCALE_Y = 94;
const DEFAULT_BOARD_LIFT = 0;

// How long the fade-mode side-switch holds its "no motion" gate. Slightly longer
// than the 300ms opacity dim so the freeze outlasts the dim on every path.
const SEAT_FADE_MS = 320;

export type ResolvedTheme = 'light' | 'dark';
export type ThemePreference = ResolvedTheme | 'system';

const THEME_STORAGE_KEY = 'cabt.theme';
const THEME_QUERY = '(prefers-color-scheme: dark)';

function isResolvedTheme(theme: string | null): theme is ResolvedTheme {
  return theme === 'light' || theme === 'dark';
}

function normalizeThemePreference(theme: string | null): ThemePreference {
  return theme === 'system' || isResolvedTheme(theme) ? theme : 'system';
}

function readStoredThemePreference(): ThemePreference {
  if (typeof window === 'undefined') {
    return 'system';
  }
  try {
    return normalizeThemePreference(window.localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return 'system';
  }
}

function readSystemTheme(): ResolvedTheme {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return 'light';
  }
  return window.matchMedia(THEME_QUERY).matches ? 'dark' : 'light';
}

class ViewSettingsStore {
  followActive = $state(true);
  debugZones = $state(false);
  showLogs = $state(false);
  // On by default so live games animate against each intermediate view
  // instead of one burst of the whole turn's events against the final board.
  animateActions = $state(true);
  showCardImages = $state(true);
  actionStepDelayMs = $state(650);
  viewIndex = $state(0);
  boardTilt = $state(DEFAULT_BOARD_TILT);
  boardPerspective = $state(DEFAULT_BOARD_PERSPECTIVE);
  boardScaleY = $state(DEFAULT_BOARD_SCALE_Y);
  boardLift = $state(DEFAULT_BOARD_LIFT);
  // How the board transitions when the follow-active seat flips top<->bottom.
  // 'flip' = the cards rotate/reposition into the new perspective;
  // 'fade' = the board dims out and the switch happens motionless underneath;
  // 'auto' (default) = flip for normal stepping / auto-play / clicking, but the
  //   motionless fade path while the scrub bar is driving fast navigation — that
  //   is exactly when a flip tears — including the debounced drag-release settle.
  seatTransition = $state<'flip' | 'fade' | 'auto'>('auto');
  // True for the brief window around a fade-mode side switch. It is the single
  // gate every side-switch motion consults so the ONLY thing that moves is the
  // opacity dim: BoardLayer freezes all CSS transitions while it is set, and
  // Hand/BenchZone run their Svelte animate:flip / in / out at duration 0 (a CSS
  // freeze cannot stop those Web-Animations flips — the "hands flying across the
  // screen" bug). Set at the SOURCE of the flip (followPlayer/switchToPlayer) so
  // it is live BEFORE the seat reposition renders, then auto-cleared.
  seatFadeActive = $state(false);
  seatFadeTimer: ReturnType<typeof setTimeout> | undefined = undefined;
  _themePreference = $state<ThemePreference>(readStoredThemePreference());
  systemTheme = $state<ResolvedTheme>(readSystemTheme());

  get themePreference(): ThemePreference {
    return this._themePreference;
  }

  set themePreference(themePreference: ThemePreference) {
    this.setThemePreference(themePreference);
  }

  get theme(): ResolvedTheme {
    return this._themePreference === 'system' ? this.systemTheme : this._themePreference;
  }

  setThemePreference(themePreference: ThemePreference) {
    this._themePreference = themePreference;
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(THEME_STORAGE_KEY, themePreference);
      } catch {
        // Theme selection still works for the current session when storage is unavailable.
      }
    }
  }

  setTheme(theme: ResolvedTheme) {
    this.setThemePreference(theme);
  }

  toggleTheme() {
    this.setTheme(this.theme === 'dark' ? 'light' : 'dark');
  }

  startThemeSync() {
    if (typeof window === 'undefined') {
      return () => {};
    }

    this.systemTheme = readSystemTheme();
    const media = typeof window.matchMedia === 'function' ? window.matchMedia(THEME_QUERY) : undefined;
    const handleMediaChange = () => {
      this.systemTheme = media?.matches ? 'dark' : 'light';
    };
    const handleStorage = (event: StorageEvent) => {
      if (event.key === THEME_STORAGE_KEY) {
        this._themePreference = normalizeThemePreference(event.newValue);
      }
    };

    media?.addEventListener('change', handleMediaChange);
    window.addEventListener('storage', handleStorage);

    return () => {
      media?.removeEventListener('change', handleMediaChange);
      window.removeEventListener('storage', handleStorage);
    };
  }

  resetPerspective() {
    this.boardTilt = DEFAULT_BOARD_TILT;
    this.boardPerspective = DEFAULT_BOARD_PERSPECTIVE;
    this.boardScaleY = DEFAULT_BOARD_SCALE_Y;
    this.boardLift = DEFAULT_BOARD_LIFT;
  }

  // Whether the NEXT seat switch should take the motionless fade path.
  // 'fade' always; 'flip' never; 'auto' only while the scrub bar is driving fast
  // navigation. replayStore.scrubbing is a debounced "navigation outpaces
  // animation" flag, so it stays true through the drag-release settle (the flip
  // that lands on the final active seat) — exactly the boundary that must fade —
  // and it is false during normal stepping, auto-play, keyboard nav, and all live
  // play, so those take the flip path.
  shouldFadeSeatSwitch(): boolean {
    if (this.seatTransition === 'fade') {
      return true;
    }
    if (this.seatTransition === 'flip') {
      return false;
    }
    return replayStore.scrubbing;
  }

  // Arm the fade-mode gate for one side switch. Called synchronously BEFORE the
  // viewIndex change so the flag is already set when the seat reposition renders
  // (Svelte flushes both together), which is what lets the animate:flip on the
  // hands read duration 0 on the very flush that would otherwise slide them.
  beginSeatFade() {
    this.seatFadeActive = true;
    if (this.seatFadeTimer !== undefined) {
      clearTimeout(this.seatFadeTimer);
    }
    this.seatFadeTimer = setTimeout(() => {
      this.seatFadeActive = false;
      this.seatFadeTimer = undefined;
    }, SEAT_FADE_MS);
  }

  followPlayer(playerIndex: number) {
    if (playerIndex !== this.viewIndex && this.shouldFadeSeatSwitch()) {
      this.beginSeatFade();
    }
    this.viewIndex = playerIndex;
  }

  switchToPlayer(playerIndex: number) {
    if (playerIndex !== this.viewIndex && this.shouldFadeSeatSwitch()) {
      this.beginSeatFade();
    }
    this.followActive = false;
    this.viewIndex = playerIndex;
  }

  resetView() {
    this.followActive = true;
    this.viewIndex = 0;
  }
}

export const viewSettingsStore = new ViewSettingsStore();
