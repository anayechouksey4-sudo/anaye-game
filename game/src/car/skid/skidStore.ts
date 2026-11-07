/**
 * The SKID MARKS setting (ON / OFF), persisted like the HUD preferences: its own versioned
 * localStorage key, read once at load with a field-by-field check, written on every change, and
 * every storage access in try/catch (a blocked storage just loses persistence for this page load).
 * Non-React readers (SkidMarks' frame loop) use `skidSettings()`.
 */
import { create } from 'zustand';

export const SKID_PREFS_KEY = 'gamerfleet.skid.v1';

export interface SkidPrefs {
  /** Lay tyre marks where the car slides. */
  marks: boolean;
}

export const DEFAULT_SKID_PREFS: Readonly<SkidPrefs> = Object.freeze({ marks: true });

interface SkidSettingsState extends SkidPrefs {
  setMarks: (on: boolean) => void;
}

/** Validate a parsed JSON value field by field (anything unexpected falls back to the default). */
export function readSkidPrefs(parsed: unknown): SkidPrefs {
  const saved = parsed && typeof parsed === 'object' ? (parsed as { marks?: unknown }) : {};
  return { marks: typeof saved.marks === 'boolean' ? saved.marks : DEFAULT_SKID_PREFS.marks };
}

function loadPrefs(): SkidPrefs {
  try {
    const raw = window.localStorage.getItem(SKID_PREFS_KEY);
    return readSkidPrefs(raw ? JSON.parse(raw) : null);
  } catch {
    return { ...DEFAULT_SKID_PREFS };
  }
}

function savePrefs(prefs: SkidPrefs): void {
  try {
    window.localStorage.setItem(SKID_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Storage blocked: the setting lasts for this page load only.
  }
}

export const useSkidSettings = create<SkidSettingsState>()((set, get) => ({
  ...loadPrefs(),
  setMarks: (marks) => {
    if (get().marks === marks) return;
    set({ marks });
    savePrefs({ marks });
  },
}));

export const skidSettings = (): SkidSettingsState => useSkidSettings.getState();
