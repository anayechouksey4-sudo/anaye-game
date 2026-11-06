/**
 * HUD-only state: which ☰ menu tab is showing and the HUD display preferences. The menu's open
 * flag itself is `useSelection().menuOpen` (App pauses physics from it, audio reads it).
 */
import { create } from 'zustand';
import { selectionState } from '../state/selection';

export type MenuTab = 'race' | 'garage' | 'maps' | 'physics' | 'settings' | 'squad';
export const MENU_TABS: readonly { id: MenuTab; label: string }[] = [
  { id: 'race', label: 'RACE' },
  { id: 'garage', label: 'GARAGE' },
  { id: 'maps', label: 'MAPS' },
  { id: 'physics', label: 'PHYSICS' },
  { id: 'settings', label: 'SETTINGS' },
  { id: 'squad', label: 'SQUAD' },
];

interface HudPrefs {
  /** Telemetry chip (phones) / panel (desktop). */
  telemetry: boolean;
}

interface HudUiState extends HudPrefs {
  menuTab: MenuTab;
  /** The touch "tap to race" card (StartGate) is up: the first run hasn't really started yet. */
  startGateOpen: boolean;
  setMenuTab: (tab: MenuTab) => void;
  setTelemetry: (on: boolean) => void;
  setStartGateOpen: (open: boolean) => void;
}

const PREFS_KEY = 'gamerfleet.hud.v1';

function loadPrefs(): HudPrefs {
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    const telemetry = parsed && typeof parsed === 'object' ? (parsed as { telemetry?: unknown }).telemetry : undefined;
    return { telemetry: typeof telemetry === 'boolean' ? telemetry : true };
  } catch {
    return { telemetry: true };
  }
}

function savePrefs(prefs: HudPrefs): void {
  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Storage blocked: the preference lasts for this page load only.
  }
}

export const useHudUi = create<HudUiState>()((set, get) => ({
  ...loadPrefs(),
  menuTab: 'race',
  startGateOpen: false,
  setMenuTab: (menuTab) => set({ menuTab }),
  setStartGateOpen: (startGateOpen) => {
    if (get().startGateOpen !== startGateOpen) set({ startGateOpen });
  },
  setTelemetry: (telemetry) => {
    set({ telemetry });
    savePrefs({ telemetry: get().telemetry });
  },
}));

/** Open the ☰ menu (pauses the game), on `tab` if given, else on RACE. */
export function openMenu(tab: MenuTab = 'race'): void {
  useHudUi.getState().setMenuTab(tab);
  selectionState().setMenuOpen(true);
}

export function closeMenu(): void {
  selectionState().setMenuOpen(false);
}
