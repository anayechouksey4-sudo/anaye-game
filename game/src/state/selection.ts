/**
 * Player choices that outlive a run: which car, which map, the ☰ menu, and settings.
 *
 * Kept apart from `store.ts` (physics, link, run) so the menu, garage, map select, audio and
 * haptics can share it without touching the hot game store. Persisted to localStorage
 * (best-effort: private mode / blocked storage just means choices reset on reload).
 *
 * Initial values: `?car=` / `?track=` in the URL win, then the saved choice, then the defaults.
 * Ids are stored as given; consumers validate them (car/catalog.ts `resolveCarId`,
 * track/registry.ts `resolveTrackId`) so an unknown id falls back to the default.
 */
import { create } from 'zustand';
import { getQueryParam } from '../config';

export const DEFAULT_CAR_ID = 'hypercar';
export const DEFAULT_TRACK_ID = 'chaos';

export interface GameSettings {
  /** Master sound switch (engine, tyres, effects). */
  sound: boolean;
  /** Master volume 0…1. */
  volume: number;
  /** navigator.vibrate feedback on phones (checkpoints, hits, landings, falls). */
  haptics: boolean;
}

export const DEFAULT_SETTINGS: Readonly<GameSettings> = Object.freeze({ sound: true, volume: 0.7, haptics: true });

export interface SelectionState {
  carId: string;
  trackId: string;
  /** The ☰ menu (pause / garage / maps / settings) is open. */
  menuOpen: boolean;
  settings: GameSettings;
  setCar: (id: string) => void;
  setTrack: (id: string) => void;
  setMenuOpen: (open: boolean) => void;
  toggleMenu: () => void;
  setSettings: (patch: Partial<GameSettings>) => void;
}

const STORAGE_KEY = 'squadhq.selection.v1';

interface Saved {
  carId?: unknown;
  trackId?: unknown;
  settings?: Partial<Record<keyof GameSettings, unknown>>;
}

function loadSaved(): Saved {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? (parsed as Saved) : {};
  } catch {
    return {};
  }
}

function save(state: Pick<SelectionState, 'carId' | 'trackId' | 'settings'>): void {
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ carId: state.carId, trackId: state.trackId, settings: state.settings }),
    );
  } catch {
    // Storage blocked: choices just aren't remembered.
  }
}

function initialSettings(saved: Saved): GameSettings {
  const s = saved.settings ?? {};
  return {
    sound: typeof s.sound === 'boolean' ? s.sound : DEFAULT_SETTINGS.sound,
    volume: typeof s.volume === 'number' && Number.isFinite(s.volume) ? Math.min(1, Math.max(0, s.volume)) : DEFAULT_SETTINGS.volume,
    haptics: typeof s.haptics === 'boolean' ? s.haptics : DEFAULT_SETTINGS.haptics,
  };
}

const saved = loadSaved();

export const useSelection = create<SelectionState>()((set, get) => ({
  carId: getQueryParam('car') ?? (typeof saved.carId === 'string' ? saved.carId : DEFAULT_CAR_ID),
  trackId: getQueryParam('track') ?? (typeof saved.trackId === 'string' ? saved.trackId : DEFAULT_TRACK_ID),
  menuOpen: false,
  settings: initialSettings(saved),
  setCar: (carId) => {
    if (carId === get().carId) return;
    set({ carId });
    save(get());
  },
  setTrack: (trackId) => {
    if (trackId === get().trackId) return;
    set({ trackId });
    save(get());
  },
  setMenuOpen: (menuOpen) => set({ menuOpen }),
  toggleMenu: () => set({ menuOpen: !get().menuOpen }),
  setSettings: (patch) => {
    set({ settings: { ...get().settings, ...patch } });
    save(get());
  },
}));

/** Non-React access for physics callbacks, audio and haptics. */
export const selectionState = () => useSelection.getState();
