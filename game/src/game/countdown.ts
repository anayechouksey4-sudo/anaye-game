/**
 * Start lights: 3 · 2 · 1 · GO at the start of every run — first load and map change (a new track
 * layout), restart and car change (the 'restart' event). A respawn mid-run never counts down.
 *
 * Counted in physics steps by RunController (after every step), so the lights freeze with the
 * ☰ menu's pause and are deterministic under `__RACER__.advance`. While counting:
 *   - throttle and brake from the keyboard / touch / gamepad read 0 (car/input.ts drive lock);
 *   - the run timer waits; RunController starts the run on the GO step.
 * Each step emits the 'countdown' game event ({ step: 3 | 2 | 1 | 0 }) for audio.
 *
 * A scripted driver (`__RACER__.setInput` with throttle > 0) skips the lights: the run then starts
 * on its first throttle, exactly as before the lights existed, so automated runs keep their timings.
 */
import { PHYSICS_DT } from '../config';
import { setDriveLock } from '../car/input';
import { useGameStore } from '../state/store';
import { emitGameEvent, onGameEvent } from './events';

export type CountdownStep = 3 | 2 | 1 | 0;

/** Seconds each light stays on: 3 → 2 → 1 → GO takes 3 × this of simulated time. */
export const COUNTDOWN_STEP_S = 0.8;
const STEPS_PER_LIGHT = Math.round(COUNTDOWN_STEP_S / PHYSICS_DT);

export interface CountdownSnapshot {
  /** Increments every time the lights are armed (one per run). */
  serial: number;
  /** Counting: the drive lock is on and the timer is waiting for GO. */
  active: boolean;
  /** Light showing: 3, 2, 1, 0 (= GO, after which `active` is false), or null before the first step. */
  step: CountdownStep | null;
}

const state = { serial: 0, active: false, step: null as CountdownStep | null, steps: 0 };
let snapshot: CountdownSnapshot = { serial: 0, active: false, step: null };
const listeners = new Set<() => void>();

function publish(): void {
  snapshot = { serial: state.serial, active: state.active, step: state.step };
  for (const listener of [...listeners]) listener();
}

/** Start a fresh countdown (the first light shows on the next physics step). */
export function armCountdown(): void {
  state.serial += 1;
  state.active = true;
  state.step = null;
  state.steps = 0;
  setDriveLock(true);
  publish();
}

/** Drop the lights without a GO (scripted driver). No-op when not counting. */
export function cancelCountdown(): void {
  if (!state.active) return;
  state.active = false;
  state.step = null;
  setDriveLock(false);
  publish();
}

/** Advance one physics step. Returns true on the step that shows GO (the run starts there). */
export function tickCountdown(): boolean {
  if (!state.active) return false;
  const step = Math.max(0, 3 - Math.floor(state.steps / STEPS_PER_LIGHT)) as CountdownStep;
  state.steps += 1;
  if (step === state.step) return false;
  state.step = step;
  if (step === 0) {
    state.active = false;
    setDriveLock(false);
  }
  publish();
  emitGameEvent('countdown', { step });
  return step === 0;
}

export const isCountdownActive = (): boolean => state.active;

/** React: `useSyncExternalStore(subscribeCountdown, getCountdownSnapshot)`. */
export function subscribeCountdown(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export const getCountdownSnapshot = (): CountdownSnapshot => snapshot;

// Arm on every new run. Module-level (not a React effect) so the very first layout registration,
// which happens in the track's layout effect before any sibling's effects run, is never missed.
onGameEvent('restart', armCountdown);
useGameStore.subscribe((s, prev) => {
  if (s.trackLayout && s.trackLayout !== prev.trackLayout) armCountdown();
});
