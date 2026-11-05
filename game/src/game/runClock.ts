/**
 * The run timer, advanced in simulated time by RunController every physics step (so it is
 * frame-rate independent and freezes with the simulation). The store mirrors `elapsedMs` at
 * ~10 Hz for React consumers; read this object for the exact value.
 */
export const runClock = {
  elapsedMs: 0,
  /** True between the first throttle input and the finish line. */
  running: false,
};

export function resetRunClock(): void {
  runClock.elapsedMs = 0;
  runClock.running = false;
}
