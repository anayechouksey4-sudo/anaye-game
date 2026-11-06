/**
 * `window.__HUD__` — the menu, start lights and results for tests and the console (installed by
 * the HUD). The car/run surface stays on `window.__RACER__`.
 */
import { useEffect } from 'react';
import { getCountdownSnapshot, type CountdownSnapshot } from '../game/countdown';
import { onGameEvent } from '../game/events';
import { carRuntime } from '../car/runtime';
import { jumpReach, medalsFor, type JumpReach } from '../state/records';
import { selectionState } from '../state/selection';
import type { TrackMedals } from '../track/catalog';
import { autoPauseLog, type AutoPauseRecord } from './autoPause';
import { closeMenu, minimapStats, openMenu, useHudUi, type MenuTab } from './uiStore';

export interface HudDebugHandle {
  /** Start-light state: { serial, active, step } (step 3/2/1, 0 = GO, null before the first light). */
  countdown(): CountdownSnapshot;
  /** The last 32 'countdown' game events as emitted: { step, stepCount (physics step it fired on), at (performance.now) }. */
  countdownEvents(): { step: number; stepCount: number; at: number }[];
  menu: {
    open(tab?: MenuTab): void;
    close(): void;
    isOpen(): boolean;
    tab(): MenuTab;
  };
  /** Whether the results screen is showing. */
  resultsVisible(): boolean;
  /** Auto-pauses on an app switch so far (hud/autoPause.ts): reason, time, physics step and run time at the pause. */
  autoPauses(): AutoPauseRecord[];
  /** Medal times (ms) for a car on a map (state/records.ts medalsFor; defaults to the current pick). */
  medals(trackId?: string, carId?: string): TrackMedals | null;
  /** Big-jump reach for a car on a map (records.ts jumpReach; null = no big jump there), with the scan time. */
  reach(trackId?: string, carId?: string): (JumpReach & { ms: number }) | null;
  /**
   * Open-world minimap disc: its rect (CSS px) for overlap tests, or null when it is not on screen
   * (no open world, hidden by a rule, menu open); plus its render / frame counters.
   */
  minimap(): MinimapProbe | null;
  /** The minimap's counters even while it is hidden (renders must not grow while driving). */
  minimapStats(): typeof minimapStats & { frameMsMean: number };
}

export interface MinimapProbe {
  x: number;
  y: number;
  width: number;
  height: number;
  right: number;
  bottom: number;
}

declare global {
  interface Window {
    __HUD__?: HudDebugHandle;
  }
}

export function useHudDebugHandle(): void {
  useEffect(() => {
    const log: { step: number; stepCount: number; at: number }[] = [];
    const offCountdown = onGameEvent('countdown', ({ step }) => {
      log.push({ step, stepCount: carRuntime.stepCount, at: performance.now() });
      if (log.length > 32) log.shift();
    });
    const handle: HudDebugHandle = {
      countdown: getCountdownSnapshot,
      countdownEvents: () => log.slice(),
      menu: {
        open: (tab) => openMenu(tab),
        close: closeMenu,
        isOpen: () => selectionState().menuOpen,
        tab: () => useHudUi.getState().menuTab,
      },
      resultsVisible: () => document.querySelector('[data-testid=results]') !== null,
      autoPauses: autoPauseLog,
      medals: (trackId = selectionState().trackId, carId = selectionState().carId) => medalsFor(trackId, carId),
      reach: (trackId = selectionState().trackId, carId = selectionState().carId) => {
        const t0 = performance.now();
        const reach = jumpReach(trackId, carId);
        return reach && { ...reach, ms: performance.now() - t0 };
      },
      minimap: () => {
        const el = document.querySelector<HTMLElement>('[data-testid=minimap]');
        if (!el) return null;
        const style = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        if (style.display === 'none' || style.visibility === 'hidden' || r.width === 0 || r.height === 0) return null;
        return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom };
      },
      minimapStats: () => ({ ...minimapStats, frameMsMean: minimapStats.frames > 0 ? minimapStats.frameMsTotal / minimapStats.frames : 0 }),
    };
    window.__HUD__ = handle;
    return () => {
      offCountdown();
      if (window.__HUD__ === handle) delete window.__HUD__;
    };
  }, []);
}
