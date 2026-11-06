/**
 * Auto-pause on an app switch. The phone player flips between Chrome and Termux (relay + dev
 * servers) all the time, takes calls, pulls down the notification shade: whenever the page goes
 * away mid-run, open the ☰ menu on RACE through the normal openMenu path, so they come back to the
 * PAUSED screen with everything frozen where it was and carry on with RESUME.
 *
 * Triggers: `visibilitychange` to hidden, `pagehide`, and on touch devices window `blur` (the shade,
 * split screen, a system dialog: Chrome stays visible but the player isn't looking). A desktop
 * window losing focus never pauses: a second monitor or a dashboard tab beside the game is normal.
 *
 * Only while there is something to freeze: a run in progress or the start lights counting, or free
 * roam in an open world (always driving, no timer to start), the menu closed and no results
 * showing. Never behind the touch start card (no run has really started) or after the finish. Opening the menu while it is open is a no-op, so repeated hides never stack
 * history entries (useMenuBackButton pushes one per open, deferred until the page is visible again).
 *
 * Why this freezes exactly: App.tsx pauses <Physics> from a selection subscription INSIDE the R3F
 * tree, so the pause commits in a microtask right after this handler, before the page can be
 * frozen or draw another frame. @react-three/rapier never steps while paused (no accumulator
 * growth), so the first frame back can't run up to 0.5 s of catch-up steps; the run clock, start
 * lights and hazards all count physics steps, so no time is added to the run. Touch fingers are
 * released by TouchControls (hidden tab / blur / menu open), and the audio ducks / suspends from
 * the same menu + visibility state as a manual pause.
 */
import { useEffect } from 'react';
import { isTouchDevice } from '../car/input';
import { carRuntime } from '../car/runtime';
import { isCountdownActive } from '../game/countdown';
import { selectionState } from '../state/selection';
import { gameState } from '../state/store';
import { TOUCH_CONTROLS } from './hudLayout';
import { openMenu, useHudUi } from './uiStore';

export type AutoPauseReason = 'hidden' | 'pagehide' | 'blur';

export interface AutoPauseRecord {
  reason: AutoPauseReason;
  /** performance.now() when it fired. */
  at: number;
  /** Physics step count at the pause (it must not move until RESUME). */
  stepCount: number;
  elapsedMs: number;
}

const log: AutoPauseRecord[] = [];

/** Auto-pauses so far this page load, oldest first (last 16), for tests and the console (`__HUD__.autoPauses()`). */
export const autoPauseLog = (): AutoPauseRecord[] => log.slice();

/** Is there a run (or start-light countdown) the player would lose ground in if it kept going? */
export function shouldAutoPause(): boolean {
  if (selectionState().menuOpen || useHudUi.getState().startGateOpen) return false;
  const { run, trackLayout } = gameState();
  if (trackLayout?.mode === 'roam') return true;
  if (run.finished) return false;
  if (typeof document !== 'undefined' && document.querySelector('[data-testid=results]')) return false;
  return run.started || isCountdownActive();
}

/** Pause now if a run is going (see shouldAutoPause). Returns whether it paused. */
export function autoPause(reason: AutoPauseReason): boolean {
  if (!shouldAutoPause()) return false;
  openMenu('race');
  log.push({ reason, at: performance.now(), stepCount: carRuntime.stepCount, elapsedMs: gameState().run.elapsedMs });
  if (log.length > 16) log.shift();
  return true;
}

/** Mount once (HUD). */
export function useAutoPause(): void {
  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') autoPause('hidden');
    };
    const onPageHide = () => autoPause('pagehide');
    const onBlur = () => autoPause('blur');
    const touch = TOUCH_CONTROLS || isTouchDevice();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    if (touch) window.addEventListener('blur', onBlur);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
      if (touch) window.removeEventListener('blur', onBlur);
    };
  }, []);
}
