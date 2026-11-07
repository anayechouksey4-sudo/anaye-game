/**
 * Rivals / ghost settings (SETTINGS · RACE card, rivals/RivalsSettings.tsx), persisted under their
 * own versioned key so they survive independently of the selection store.
 */
import { create } from 'zustand';

export type RivalCount = 0 | 1 | 3;

export interface RivalSettings {
  /** How many medal-pace rivals start with the player (3 = gold + silver + bronze, 1 = gold only). */
  rivals: RivalCount;
  /** Replay the best run of this car on this map as a translucent shadow. */
  ghost: boolean;
  setRivals: (n: RivalCount) => void;
  setGhost: (on: boolean) => void;
}

export const RIVALS_STORAGE_KEY = 'gamerfleet.rivals.v1';

function load(): { rivals: RivalCount; ghost: boolean } {
  try {
    const raw = window.localStorage.getItem(RIVALS_STORAGE_KEY);
    const p: unknown = raw ? JSON.parse(raw) : null;
    const o = p && typeof p === 'object' ? (p as { rivals?: unknown; ghost?: unknown }) : {};
    return {
      rivals: o.rivals === 0 || o.rivals === 1 || o.rivals === 3 ? o.rivals : 3,
      ghost: typeof o.ghost === 'boolean' ? o.ghost : true,
    };
  } catch {
    return { rivals: 3, ghost: true };
  }
}

function save(s: { rivals: RivalCount; ghost: boolean }): void {
  try {
    window.localStorage.setItem(RIVALS_STORAGE_KEY, JSON.stringify({ rivals: s.rivals, ghost: s.ghost }));
  } catch {
    // Storage blocked: the choice just is not remembered.
  }
}

export const useRivalSettings = create<RivalSettings>()((set, get) => ({
  ...load(),
  setRivals: (rivals) => {
    if (rivals === get().rivals) return;
    set({ rivals });
    save(get());
  },
  setGhost: (ghost) => {
    if (ghost === get().ghost) return;
    set({ ghost });
    save(get());
  },
}));

export const rivalSettings = (): RivalSettings => useRivalSettings.getState();
