/**
 * HUD-only state: which ☰ menu tab is showing and the HUD display preferences. The menu's open
 * flag itself is `useSelection().menuOpen` (App pauses physics from it, audio reads it).
 */
import { create } from 'zustand';
import { selectionState } from '../state/selection';
import { useWorldHud } from '../state/worldRuntime';

export type MenuTab = 'race' | 'garage' | 'drivers' | 'ride' | 'maps' | 'physics' | 'settings' | 'squad' | 'friends';
/** Nine tabs: three rows of three in portrait (menu.css), a rail in landscape. GARAGE · DRIVERS · MY RIDE sit together; SQUAD · FRIENDS close the grid. */
export const MENU_TABS: readonly { id: MenuTab; label: string }[] = [
  { id: 'race', label: 'RACE' },
  { id: 'garage', label: 'GARAGE' },
  { id: 'drivers', label: 'DRIVERS' },
  { id: 'ride', label: 'MY RIDE' },
  { id: 'maps', label: 'MAPS' },
  { id: 'physics', label: 'PHYSICS' },
  { id: 'settings', label: 'SETTINGS' },
  { id: 'squad', label: 'SQUAD' },
  { id: 'friends', label: 'FRIENDS' },
];

interface HudPrefs {
  /** Telemetry chip (phones) / panel (desktop). */
  telemetry: boolean;
  /** Open-world minimap disc (SETTINGS · MINIMAP; only shows on an open world). */
  minimap: boolean;
}

interface HudUiState extends HudPrefs {
  menuTab: MenuTab;
  /** The touch "tap to race" card (StartGate) is up: the first run hasn't really started yet. */
  startGateOpen: boolean;
  /** The results card is showing (the minimap steps aside for it). */
  resultsOpen: boolean;
  setMenuTab: (tab: MenuTab) => void;
  setTelemetry: (on: boolean) => void;
  setMinimap: (on: boolean) => void;
  setStartGateOpen: (open: boolean) => void;
  setResultsOpen: (open: boolean) => void;
}

const PREFS_KEY = 'gamerfleet.hud.v1';

function loadPrefs(): HudPrefs {
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    const saved = parsed && typeof parsed === 'object' ? (parsed as { telemetry?: unknown; minimap?: unknown }) : {};
    return {
      telemetry: typeof saved.telemetry === 'boolean' ? saved.telemetry : true,
      minimap: typeof saved.minimap === 'boolean' ? saved.minimap : true,
    };
  } catch {
    return { telemetry: true, minimap: true };
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
  resultsOpen: false,
  setMenuTab: (menuTab) => set({ menuTab }),
  setStartGateOpen: (startGateOpen) => {
    if (get().startGateOpen !== startGateOpen) set({ startGateOpen });
  },
  setResultsOpen: (resultsOpen) => {
    if (get().resultsOpen !== resultsOpen) set({ resultsOpen });
  },
  setTelemetry: (telemetry) => {
    set({ telemetry });
    savePrefs({ telemetry: get().telemetry, minimap: get().minimap });
  },
  setMinimap: (minimap) => {
    set({ minimap });
    savePrefs({ telemetry: get().telemetry, minimap: get().minimap });
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

/** Minimap dev / test counters (read by `__HUD__.minimapStats()`; Minimap.tsx, a lazy chunk, writes them). */
export const minimapStats = {
  /** React renders of the minimap (must not grow while driving). */
  renders: 0,
  /** rAF updates that did work (disc visible). */
  frames: 0,
  /** Main-thread time spent in those updates, ms (sum and worst). */
  frameMsTotal: 0,
  frameMsMax: 0,
  /** Base picture paints (once per minimap image). */
  basePaints: 0,
  /** Overlay redraws (route / markers / accent changed). */
  overlayPaints: 0,
};

/** Is the minimap disc meant to show (open world drivable, setting on, no results)? Orientation rules live in minimap.css. */
export function useMinimapShown(): boolean {
  const active = useWorldHud((s) => s.active && s.minimap !== null && s.loading === null);
  const pref = useHudUi((s) => s.minimap);
  const results = useHudUi((s) => s.resultsOpen);
  return active && pref && !results;
}
