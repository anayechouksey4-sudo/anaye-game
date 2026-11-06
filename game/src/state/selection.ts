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
import { normalizePlate } from '../car/plates/plateText';
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
  /**
   * Driving assists (Handling v2 cars only): ABS pulse, a wheelspin cap and a light counter-steer
   * hand. 'off' is the raw model. Default on everywhere.
   */
  assists: 'on' | 'off';
}

export const DEFAULT_SETTINGS: Readonly<GameSettings> = Object.freeze({ sound: true, volume: 0.7, haptics: true, assists: 'on' as const });

export interface SelectionState {
  carId: string;
  trackId: string;
  /** The ☰ menu (pause / garage / maps / settings) is open. */
  menuOpen: boolean;
  settings: GameSettings;
  /**
   * The player's own number plate per car id (car/plates `normalizePlate` text, never empty); a
   * car without an entry wears its catalog default. Cosmetic: no physics, no best-time key.
   */
  plates: Readonly<Record<string, string>>;
  setCar: (id: string) => void;
  setTrack: (id: string) => void;
  setMenuOpen: (open: boolean) => void;
  toggleMenu: () => void;
  setSettings: (patch: Partial<GameSettings>) => void;
  /** Normalizes and stores a plate for a car ('' or an all-junk text removes it = back to the default). Returns what was stored. */
  setPlate: (carId: string, text: string) => string;
}

const STORAGE_KEY = 'squadhq.selection.v1';
/** Plates are kept for at most this many car ids (old saves with more keep the first ones). */
const MAX_PLATE_ENTRIES = 32;

interface Saved {
  carId?: unknown;
  trackId?: unknown;
  settings?: Partial<Record<keyof GameSettings, unknown>>;
  plates?: unknown;
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

function save(state: Pick<SelectionState, 'carId' | 'trackId' | 'settings' | 'plates'>): void {
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ carId: state.carId, trackId: state.trackId, settings: state.settings, plates: state.plates }),
    );
  } catch {
    // Storage blocked: choices just aren't remembered.
  }
}

/** Saved plates → clean map: string keys, normalized non-empty texts, at most MAX_PLATE_ENTRIES. */
function initialPlates(saved: Saved): Record<string, string> {
  const out: Record<string, string> = {};
  const raw = saved.plates;
  if (!raw || typeof raw !== 'object') return out;
  for (const [carId, value] of Object.entries(raw as Record<string, unknown>)) {
    if (Object.keys(out).length >= MAX_PLATE_ENTRIES) break;
    if (typeof carId !== 'string' || carId.length === 0 || carId.length > 32) continue;
    const text = normalizePlate(value);
    if (text) out[carId] = text;
  }
  return out;
}

function initialSettings(saved: Saved): GameSettings {
  const s = saved.settings ?? {};
  return {
    sound: typeof s.sound === 'boolean' ? s.sound : DEFAULT_SETTINGS.sound,
    volume: typeof s.volume === 'number' && Number.isFinite(s.volume) ? Math.min(1, Math.max(0, s.volume)) : DEFAULT_SETTINGS.volume,
    haptics: typeof s.haptics === 'boolean' ? s.haptics : DEFAULT_SETTINGS.haptics,
    assists: s.assists === 'off' ? 'off' : 'on',
  };
}

const saved = loadSaved();
const initialCarId = getQueryParam('car') ?? (typeof saved.carId === 'string' ? saved.carId : DEFAULT_CAR_ID);
const plates = initialPlates(saved);
// `?plate=` is a shareable link: it sets (and keeps) the plate of the car the link opens with.
const plateParam = normalizePlate(getQueryParam('plate'));
if (plateParam) plates[initialCarId] = plateParam;

export const useSelection = create<SelectionState>()((set, get) => ({
  carId: initialCarId,
  trackId: getQueryParam('track') ?? (typeof saved.trackId === 'string' ? saved.trackId : DEFAULT_TRACK_ID),
  menuOpen: false,
  settings: initialSettings(saved),
  plates,
  setPlate: (carId, text) => {
    const clean = normalizePlate(text);
    const next = { ...get().plates };
    if (clean) next[carId] = clean;
    else delete next[carId];
    set({ plates: next });
    save(get());
    return clean;
  },
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

if (plateParam) save(useSelection.getState());

/** Non-React access for physics callbacks, audio and haptics. */
export const selectionState = () => useSelection.getState();
