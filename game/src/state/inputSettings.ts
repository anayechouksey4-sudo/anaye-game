/**
 * Input settings (☰ menu → SETTINGS → CONTROLS): steering source on phones, tilt range, invert and
 * the tilt calibration offset. Kept apart from `selection.ts` so the input layer (`src/input/*`)
 * depends on nothing from the HUD or the game stores and stays testable in node.
 *
 * Persisted under a versioned localStorage key (best-effort, field-by-field validation on load);
 * the gamepad has no setting: it is used whenever one is connected (AUTO).
 */
import { create } from 'zustand';

export type SteeringMode = 'touch' | 'tilt';

export interface InputSettings {
  /** Phones: on-screen ◀ ▶ pad, or tilting the phone. */
  steering: SteeringMode;
  /** Tilt angle (degrees past the dead zone) that gives full lock. */
  tiltMaxDeg: number;
  /** Swap left and right for tilt. */
  tiltInvert: boolean;
  /** Roll angle (degrees) the player holds the phone at; captured by CALIBRATE and when tilt is enabled. */
  tiltOffsetDeg: number;
}

export const TILT_MAX_DEG_MIN = 14;
export const TILT_MAX_DEG_MAX = 35;
/** The three presets the SETTINGS card offers. */
export const TILT_RANGE_PRESETS: readonly { deg: number; label: string }[] = [
  { deg: 14, label: 'QUICK' },
  { deg: 22, label: 'NORMAL' },
  { deg: 35, label: 'GENTLE' },
];

export const DEFAULT_INPUT_SETTINGS: Readonly<InputSettings> = Object.freeze({
  steering: 'touch',
  tiltMaxDeg: 22,
  tiltInvert: false,
  tiltOffsetDeg: 0,
});

export const INPUT_SETTINGS_KEY = 'gamerfleet.input.v1';

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Anything (a parsed save, junk) → valid settings; unknown or malformed fields fall back to the defaults. */
export function sanitizeInputSettings(raw: unknown): InputSettings {
  const s = raw && typeof raw === 'object' ? (raw as Partial<Record<keyof InputSettings, unknown>>) : {};
  return {
    steering: s.steering === 'tilt' ? 'tilt' : 'touch',
    tiltMaxDeg: typeof s.tiltMaxDeg === 'number' && Number.isFinite(s.tiltMaxDeg) ? clamp(s.tiltMaxDeg, TILT_MAX_DEG_MIN, TILT_MAX_DEG_MAX) : DEFAULT_INPUT_SETTINGS.tiltMaxDeg,
    tiltInvert: typeof s.tiltInvert === 'boolean' ? s.tiltInvert : DEFAULT_INPUT_SETTINGS.tiltInvert,
    tiltOffsetDeg: typeof s.tiltOffsetDeg === 'number' && Number.isFinite(s.tiltOffsetDeg) ? clamp(s.tiltOffsetDeg, -90, 90) : DEFAULT_INPUT_SETTINGS.tiltOffsetDeg,
  };
}

function load(): InputSettings {
  try {
    if (typeof window === 'undefined') return { ...DEFAULT_INPUT_SETTINGS };
    const raw = window.localStorage.getItem(INPUT_SETTINGS_KEY);
    return sanitizeInputSettings(raw ? JSON.parse(raw) : null);
  } catch {
    return { ...DEFAULT_INPUT_SETTINGS };
  }
}

function save(s: InputSettings): void {
  try {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(INPUT_SETTINGS_KEY, JSON.stringify({ steering: s.steering, tiltMaxDeg: s.tiltMaxDeg, tiltInvert: s.tiltInvert, tiltOffsetDeg: s.tiltOffsetDeg }));
  } catch {
    // Storage blocked: the choice lasts for this page only.
  }
}

interface InputSettingsState extends InputSettings {
  set: (patch: Partial<InputSettings>) => void;
  reset: () => void;
}

export const useInputSettings = create<InputSettingsState>()((set, get) => ({
  ...load(),
  set: (patch) => {
    const next = sanitizeInputSettings({ ...get(), ...patch });
    set(next);
    save(next);
  },
  reset: () => {
    set({ ...DEFAULT_INPUT_SETTINGS });
    save(DEFAULT_INPUT_SETTINGS);
  },
}));

/** Non-React access for the input loop. */
export const inputSettings = () => useInputSettings.getState();
